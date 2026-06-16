const fs = require('fs');
const path = require('path');
const db = require('../db');
const { extractSlugFromPath, slugVariants } = require('./movieDedup');

const DATA = path.join(__dirname, '..', '..', 'data');
const JOBS_FILE = path.join(DATA, 'vod-downloads.json');
const WINSCP_DIR = path.join(DATA, 'winscp');
const SERIES_WINSCP = path.join(DATA, 'winscp', 'series');

function parseSizeToken(raw) {
  const m = String(raw || '').trim().match(/^([\d.]+)\s*(GiB|MiB|KiB|GB|MB|KB|B)?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = (m[2] || 'B').toUpperCase();
  const mult = {
    B: 1,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3
  };
  return Math.round(n * (mult[u] || 1));
}

function readTail(filePath, maxBytes = 120000) {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(Math.min(maxBytes, stat.size));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8').replace(/\r/g, '\n');
  } catch {
    return '';
  }
}

function parseYtDlpLog(tail) {
  if (!tail) return null;

  const fragTotalMatch = tail.match(/Total fragments:\s*(\d+)/i);
  const fragTotal = fragTotalMatch ? parseInt(fragTotalMatch[1], 10) : null;

  const lines = tail.split(/\r?\n/).filter((l) => l.includes('[download]'));
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const m = line.match(
      /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*(?:GiB|MiB|KiB|GB|MB|KB|B))\s+at\s+([\d.]+\s*(?:\w+\/s|B\/s))(?:\s+ETA\s+([^(\r\n]+))?(?:\s*\(frag\s+(\d+)\/(\d+)\))?/i
    );
    if (!m) continue;
    const percent = parseFloat(m[1]);
    const totalBytes = parseSizeToken(m[2]);
    const downloadedBytes = totalBytes > 0 ? Math.round((totalBytes * percent) / 100) : 0;
    const fragCurrent = m[5] ? parseInt(m[5], 10) : null;
    const fragOf = m[6] ? parseInt(m[6], 10) : fragTotal;
    let percentFromFrag = null;
    if (fragCurrent != null && fragOf > 0) {
      percentFromFrag = Math.round((fragCurrent / fragOf) * 1000) / 10;
    }
    return {
      percent: percentFromFrag != null ? Math.max(percent, percentFromFrag) : percent,
      total_bytes: totalBytes,
      downloaded_bytes: downloadedBytes,
      speed: m[3].trim(),
      eta: (m[4] || '').trim() || null,
      frag_current: fragCurrent,
      frag_total: fragOf || fragTotal,
      status: 'downloading',
      message: fragCurrent != null && fragOf ? `Fragmento ${fragCurrent}/${fragOf}` : null
    };
  }

  if (fragTotal) {
    return {
      percent: 0,
      total_bytes: 0,
      downloaded_bytes: 0,
      speed: null,
      eta: null,
      frag_current: 0,
      frag_total: fragTotal,
      status: 'starting',
      message: `Preparando ${fragTotal} fragmentos…`
    };
  }

  if (/Merger|Merging|ffmpeg/i.test(tail)) {
    return {
      percent: 99,
      status: 'merging',
      message: 'Uniendo audio y video…'
    };
  }

  return null;
}

function dirPartialBytes(destBase) {
  const moviesDir = path.join(DATA, 'movies');
  if (!destBase || !fs.existsSync(moviesDir)) return { bytes: 0, files: [] };
  let bytes = 0;
  const files = [];
  const bases = new Set([destBase]);
  for (const v of slugVariants(destBase.replace(/^pending_/, ''))) {
    bases.add(v);
    bases.add(v.replace(/-/g, '_'));
  }
  for (const name of fs.readdirSync(moviesDir)) {
    const low = name.toLowerCase();
    const hit = [...bases].some((b) => b && low.includes(String(b).toLowerCase()));
    if (!hit) continue;
    const full = path.join(moviesDir, name);
    try {
      const st = fs.statSync(full);
      if (st.isFile()) {
        bytes += st.size;
        files.push({ name, bytes: st.size });
      }
    } catch { /* ignore */ }
  }
  return { bytes, files };
}

function findLogForDestBase(destBase, slug) {
  if (!fs.existsSync(WINSCP_DIR)) return null;
  const candidates = [];
  if (slug) {
    candidates.push(`import-cinecalidad-${slug}.log`);
    candidates.push(`import-cuevana-${slug}.log`);
    candidates.push(`import-${slug}.log`);
  }
  if (destBase) {
    candidates.push(`import-cuevana-${destBase}.log`);
    candidates.push(`import-${destBase}.log`);
    const pendingSlug = destBase.replace(/^pending_/, '');
    if (pendingSlug !== destBase) {
      candidates.push(`import-cuevana-${pendingSlug}.log`);
      candidates.push(`import-${pendingSlug}.log`);
    }
  }

  for (const name of [...new Set(candidates)]) {
    const full = path.join(WINSCP_DIR, name);
    if (fs.existsSync(full)) return full;
  }

  return null;
}

function loadJobs() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return {};
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveJobs(jobs) {
  fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

function registerDownloadJob(movieId, { logFile, destBase, slug, quality, source, media_url, updating } = {}) {
  const jobs = loadJobs();
  const key = String(movieId);
  jobs[key] = { ...(jobs[key] || {}), movie_id: movieId };
  jobs[key].log_file = logFile || null;
  jobs[key].dest_base = destBase || null;
  jobs[key].slug = slug || null;
  if (quality) jobs[key].quality = quality;
  if (source) jobs[key].source = source;
  if (media_url) jobs[key].media_url = media_url;
  if (updating) jobs[key].updating = true;
  else delete jobs[key].updating;
  jobs[key].started_at = new Date().toISOString();
  jobs[key].updated_at = new Date().toISOString();
  saveJobs(jobs);
}

function getDownloadJob(movieId) {
  return loadJobs()[String(movieId)] || null;
}

function clearDownloadJob(movieId) {
  const jobs = loadJobs();
  const key = String(movieId);
  if (!jobs[key]) return;
  delete jobs[key].log_file;
  delete jobs[key].dest_base;
  delete jobs[key].slug;
  delete jobs[key].updating;
  delete jobs[key].quality;
  delete jobs[key].started_at;
  delete jobs[key].updated_at;
  if (!jobs[key].prep) delete jobs[key];
  else saveJobs(jobs);
}

function registerPrepJob(movieId, { status = 'converting', format = 'mp4', source = '' } = {}) {
  const jobs = loadJobs();
  const key = String(movieId);
  jobs[key] = jobs[key] || { movie_id: movieId };
  jobs[key].prep = { status, format, source, updated_at: new Date().toISOString() };
  saveJobs(jobs);
}

function clearPrepJob(movieId) {
  const jobs = loadJobs();
  const key = String(movieId);
  if (jobs[key]?.prep) {
    delete jobs[key].prep;
    if (!jobs[key].log_file && !jobs[key].dest_base) delete jobs[key];
    else saveJobs(jobs);
  }
}

function getPrepJob(movieId) {
  return loadJobs()[String(movieId)]?.prep || null;
}

function formatBytes(n) {
  if (!n || n < 1) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v * 10) / 10} ${u[i]}`;
}

function isYtDlpActivePid(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    if (/^State:\s+Z/m.test(status)) return false;
    return true;
  } catch {
    return false;
  }
}

function isYtDlpRunning() {
  try {
    const { execSync } = require('child_process');
    const pids = execSync('pgrep -x yt-dlp 2>/dev/null || true', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    if (pids.some((pid) => isYtDlpActivePid(pid))) return true;
    const out = execSync('pgrep -af "^yt-dlp " 2>/dev/null || true', { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).some((l) => {
      if (/pgrep|sh -c|grep|node |import-allcalidad|process-(vod|series)/i.test(l)) return false;
      const m = l.match(/^(\d+)\s+/);
      if (!m || !isYtDlpActivePid(m[1])) return false;
      return /\byt-dlp\b/.test(l);
    });
  } catch {
    return false;
  }
}

function isFfmpegPrepRunning(destBase) {
  try {
    const { execSync } = require('child_process');
    const out = execSync('pgrep -af ffmpeg 2>/dev/null || true', { encoding: 'utf8' });
    const needle = destBase.slice(0, 12);
    return out.split('\n').some((l) => l.includes('ffmpeg') && l.includes(needle));
  } catch {
    return false;
  }
}

function findFinishedFile(destBase) {
  const moviesDir = path.join(DATA, 'movies');
  if (!destBase || !fs.existsSync(moviesDir)) return null;
  const exact = path.join(moviesDir, `${destBase}.mkv`);
  if (fs.existsSync(exact) && fs.statSync(exact).size > 50 * 1024 * 1024) return exact;
  const prefix = destBase.slice(0, Math.min(20, destBase.length));
  const found = fs.readdirSync(moviesDir).find((f) =>
    f.startsWith(prefix) && (f.endsWith('.mkv') || f.endsWith('.mp4'))
    && !f.includes('.part') && !f.includes('.ytdl')
  );
  return found ? path.join(moviesDir, found) : null;
}

function logIsStale(logPath, maxAgeMs = 5 * 60 * 1000) {
  try {
    const st = fs.statSync(logPath);
    return Date.now() - st.mtimeMs > maxAgeMs;
  } catch {
    return true;
  }
}

function getMovieDownloadProgress(movie) {
  if (!movie) return { active: false, status: 'unknown', percent: 0 };

  const jobs = loadJobs();
  const job = jobs[String(movie.id)] || {};
  const { qualityLabelFromPreset } = require('./videoQuality');
  const targetQuality = qualityLabelFromPreset(job.quality);
  const isUpdating = !!job.updating;
  const pending = Number(movie.available) === 0;
  const activeJob = !!(job.log_file && (pending || isUpdating));

  if (!pending && !activeJob) {
    const prep = getPrepJob(movie.id);
    if (prep?.status === 'converting') {
      return {
        active: true,
        status: 'processing',
        percent: 99,
        message: `Convirtiendo a ${(prep.format || 'mp4').toUpperCase()} (ya se puede ver en MKV)`,
        playable_format: 'mkv',
        target_quality: targetQuality || null
      };
    }
    const qMsg = movie.video_quality ? movie.video_quality : 'Disponible';
    return {
      active: false,
      status: 'ready',
      percent: 100,
      message: qMsg,
      video_quality: movie.video_quality || null
    };
  }
  const prep = getPrepJob(movie.id);
  const vp = movie.video_path || '';
  const isExternal = /^https?:\/\//i.test(vp);

  if (prep?.status === 'converting') {
    const destBase = job.dest_base || path.basename(vp, path.extname(vp));
    return {
      active: true,
      status: 'processing',
      percent: 99,
      message: `Convirtiendo a ${(prep.format || 'mp4').toUpperCase()}…`,
      detail: 'Ya reproducible en MKV',
      playable_format: 'mkv',
      converting_format: prep.format || 'mp4'
    };
  }

  const slug = job.slug || extractSlugFromPath(movie.video_path);
  let destBase = job.dest_base
    || path.basename(movie.video_path || '', path.extname(movie.video_path || ''));
  if (destBase.startsWith('pending_') && slug) {
    destBase = path.basename(safeFilenameFromMovie(movie), '.mkv') || destBase;
  }

  let logPath = null;
  if (job.log_file) {
    logPath = path.isAbsolute(job.log_file) ? job.log_file : path.join(DATA, job.log_file);
  } else if (slug) {
    logPath = findLogForDestBase(destBase, slug);
  }

  if (isExternal && !slug && !job.log_file) {
    return {
      active: false,
      status: 'pending',
      percent: 0,
      message: 'Sin descarga local — importar desde Cuevana/AllCalidad',
      downloaded_human: '0 B'
    };
  }

  let finished = findFinishedFile(destBase);
  if (!finished) {
    try {
      const { findFinishedFileForMovie } = require('./vodYtDlp');
      finished = findFinishedFileForMovie(movie, job);
    } catch { /* ignore */ }
  }
  const partial = dirPartialBytes(destBase);
  const logTail = logPath ? readTail(logPath) : '';
  const parsed = logTail ? parseYtDlpLog(logTail) : null;
  const ytdlp = isYtDlpRunning();
  const ffmpegPrep = isFfmpegPrepRunning(destBase);
  const logHasDownload = !!(logTail && (/\[download\]/i.test(logTail) || /Total fragments/i.test(logTail)));
  const logStale = logPath ? logIsStale(logPath, isUpdating ? 2 * 60 * 1000 : 5 * 60 * 1000) : false;
  const freshLog = logPath && !logStale && (logHasDownload || ytdlp);
  const skipFinished = isUpdating && (ytdlp || freshLog || partial.bytes > 0);

  if (finished && ffmpegPrep && !skipFinished) {
    return {
      active: true,
      status: 'processing',
      percent: 99,
      downloaded_human: formatBytes(fs.statSync(finished).size),
      total_human: 'Convirtiendo a MP4…',
      message: 'Preparando video para reproducción…',
      log_file: logPath ? path.relative(DATA, logPath) : null
    };
  }

  if (finished && !ytdlp && !skipFinished) {
    return {
      active: true,
      status: 'processing',
      percent: 99,
      downloaded_human: formatBytes(fs.statSync(finished).size),
      message: isUpdating ? 'Actualizando — finalizando en catálogo…' : 'Archivo listo — finalizando en catálogo…',
      target_quality: targetQuality || null,
      updating: isUpdating,
      log_file: logPath ? path.relative(DATA, logPath) : null
    };
  }

  let percent = parsed?.percent ?? 0;
  let totalBytes = parsed?.total_bytes || 0;
  let downloadedBytes = parsed?.downloaded_bytes || 0;
  let dlStatus = null;
  let message = null;

  // HLS por fragmentos: el % del log es por pista (~78 MiB), no del archivo final
  if (parsed?.frag_current != null && parsed?.frag_total > 0) {
    const fc = parsed.frag_current;
    const ft = parsed.frag_total;
    if (fc >= ft - 1) {
      percent = 99;
      dlStatus = ytdlp ? 'merging' : 'processing';
      message = ytdlp ? 'Uniendo audio y video…' : 'Descarga completa — preparando archivo…';
    } else {
      percent = Math.min(98, Math.round((fc / ft) * 1000) / 10);
    }
    downloadedBytes = partial.bytes || downloadedBytes;
    if (partial.bytes > 500 * 1024 * 1024) {
      totalBytes = partial.bytes;
    }
  } else if (partial.bytes > 0 && totalBytes > 500 * 1024 * 1024) {
    const pctFromFile = Math.min(99.9, (partial.bytes / totalBytes) * 100);
    if (pctFromFile > percent) {
      percent = Math.round(pctFromFile * 10) / 10;
      downloadedBytes = partial.bytes;
    }
  } else if (partial.bytes > 0) {
    downloadedBytes = partial.bytes;
    if (!percent && partial.bytes > 50 * 1024 * 1024) percent = 1;
  }

  let status = dlStatus || parsed?.status || (partial.bytes > 0 ? 'downloading' : 'queued');

  const stalled = logStale && !ytdlp && !ffmpegPrep && partial.bytes > 0 && percent < 98;
  if (stalled) {
    status = 'stalled';
  }

  const active = stalled
    ? false
    : !!(parsed || partial.bytes > 0 || (logHasDownload && ytdlp) || ffmpegPrep || dlStatus === 'merging');

  if (!message) message = parsed?.message || null;
  const updatingPrefix = isUpdating && targetQuality ? `Actualizando ${targetQuality}` : (isUpdating ? 'Actualizando' : '');
  if (!message) {
    if (stalled) message = 'Descarga detenida — pulsa Reanudar';
    else if (ffmpegPrep) message = 'Convirtiendo a MP4…';
    else if (active && percent > 0) message = updatingPrefix ? `${updatingPrefix}…` : 'Descargando…';
    else if (logHasDownload && !parsed) message = updatingPrefix ? `${updatingPrefix} — iniciando…` : 'Iniciando descarga…';
    else if (ytdlp) message = updatingPrefix ? `${updatingPrefix} — en cola` : 'En cola (otra descarga activa)';
    else {
      const { getSetting } = require('./settings');
      const paused = getSetting('vod_downloads_paused', '0') === '1'
        || getSetting('vod_queue_enabled', '1') === '0';
      message = paused
        ? 'Cola pausada — pulsa «Descargar todas las pendientes» o Reanudar'
        : (updatingPrefix || 'En cola — pulsa Reanudar o «Descargar todas las pendientes»');
    }
  } else if (updatingPrefix && !/actualizando/i.test(message)) {
    message = `${updatingPrefix} — ${message}`;
  }

  if (percent >= 99 && status === 'downloading' && !ytdlp && !ffmpegPrep) {
    status = 'merging';
    message = message || 'Finalizando archivo…';
  }

  return {
    active,
    status: isUpdating && active && status === 'queued' ? 'downloading' : status,
    percent: Math.min(100, Math.max(0, percent)),
    total_bytes: totalBytes,
    downloaded_bytes: downloadedBytes,
    downloaded_human: formatBytes(downloadedBytes || partial.bytes),
    total_human: (parsed?.frag_current != null && parsed?.frag_total > 0)
      ? `${parsed.frag_current}/${parsed.frag_total} fragmentos`
      : (totalBytes > 100 * 1024 * 1024 ? formatBytes(totalBytes) : null),
    speed: parsed?.speed || null,
    eta: parsed?.eta || null,
    frag_current: parsed?.frag_current ?? null,
    frag_total: parsed?.frag_total ?? null,
    message,
    target_quality: targetQuality || null,
    updating: isUpdating,
    partial_files: partial.files.length,
    log_file: logPath ? path.relative(DATA, logPath) : null
  };
}

function safeFilenameFromMovie(movie) {
  const title = movie.title || 'pelicula';
  const year = movie.year || '';
  return String(title)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) + (year ? `_${year}` : '') + '.mkv';
}

function getPendingMoviesProgress() {
  const out = {};
  const pending = db.prepare('SELECT * FROM movies WHERE COALESCE(available, 1) = 0').all();
  for (const m of pending) {
    out[m.id] = getMovieDownloadProgress(m);
  }
  return out;
}

function episodeJobKey(episodeId) {
  return `ep:${episodeId}`;
}

function parseEpisodePath(videoPath) {
  const m = String(videoPath || '').match(/\/series\/([^/]+)\/(S\d+E\d+)/i);
  if (!m) return null;
  return { folder: decodeURIComponent(m[1]), destBase: m[2] };
}

function dirPartialBytesEpisode(folder, destBase) {
  const dir = path.join(SERIES_WINSCP, folder);
  if (!folder || !destBase || !fs.existsSync(dir)) return { bytes: 0, files: [] };
  let bytes = 0;
  const files = [];
  const lowBase = destBase.toLowerCase();
  for (const name of fs.readdirSync(dir)) {
    const low = name.toLowerCase();
    if (!low.startsWith(lowBase)) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.isFile()) {
        bytes += st.size;
        files.push({ name, bytes: st.size });
      }
    } catch { /* ignore */ }
  }
  return { bytes, files };
}

function findSeriesLog(destBase, season, episode, slug) {
  if (!fs.existsSync(WINSCP_DIR)) return null;
  const suffix = `-s${season}e${episode}.log`;
  const candidates = [];
  if (slug) candidates.push(`import-series-${slug}${suffix}`);
  for (const name of fs.readdirSync(WINSCP_DIR)) {
    if (!name.startsWith('import-series-') || !name.endsWith(suffix)) continue;
    if (destBase && !name.toLowerCase().includes(destBase.toLowerCase().slice(0, 6))) {
      /* still match by suffix */
    }
    candidates.push(name);
  }
  for (const name of [...new Set(candidates)]) {
    const full = path.join(WINSCP_DIR, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function findFinishedEpisodeFile(folder, destBase) {
  const dir = path.join(SERIES_WINSCP, folder);
  if (!folder || !destBase || !fs.existsSync(dir)) return null;
  const exact = path.join(dir, `${destBase}.mkv`);
  if (fs.existsSync(exact) && fs.statSync(exact).size >= 50 * 1024 * 1024) return exact;
  const lowBase = destBase.toLowerCase();
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().startsWith(lowBase)) continue;
    if (!/\.(mkv|mp4)$/i.test(name) || name.includes('.part') || name.includes('.ytdl')) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).size >= 50 * 1024 * 1024) return full;
    } catch { /* ignore */ }
  }
  return null;
}

function registerEpisodeDownloadJob(episodeId, { logFile, destBase, folder, season, episode, slug } = {}) {
  const jobs = loadJobs();
  const key = episodeJobKey(episodeId);
  jobs[key] = {
    ...(jobs[key] || {}),
    episode_id: episodeId,
    log_file: logFile || null,
    dest_base: destBase || null,
    folder: folder || null,
    season: season ?? null,
    episode: episode ?? null,
    slug: slug || null,
    updated_at: new Date().toISOString()
  };
  saveJobs(jobs);
}

function clearEpisodeDownloadJob(episodeId) {
  const jobs = loadJobs();
  const key = episodeJobKey(episodeId);
  if (!jobs[key]) return;
  delete jobs[key];
  saveJobs(jobs);
}

function getEpisodeDownloadProgress(episode) {
  if (!episode) return { active: false, status: 'unknown', percent: 0 };
  if (Number(episode.available) !== 0) {
    return { active: false, status: 'ready', percent: 100, message: 'Disponible' };
  }

  const parsed = parseEpisodePath(episode.video_path);
  const jobs = loadJobs();
  const job = jobs[episodeJobKey(episode.id)] || {};
  const folder = job.folder || parsed?.folder || '';
  const destBase = job.dest_base || parsed?.destBase || '';
  const season = job.season ?? episode.season ?? 1;
  const epNum = job.episode ?? episode.episode ?? 1;
  const slug = job.slug || '';

  let logPath = null;
  if (job.log_file) {
    logPath = path.isAbsolute(job.log_file) ? job.log_file : path.join(DATA, job.log_file);
  } else if (folder && destBase) {
    logPath = findSeriesLog(destBase, season, epNum, slug);
  }

  const finished = folder && destBase ? findFinishedEpisodeFile(folder, destBase) : null;
  const partial = dirPartialBytesEpisode(folder, destBase);
  const logTail = logPath ? readTail(logPath) : '';
  const parsedLog = logTail ? parseYtDlpLog(logTail) : null;
  const ytdlp = isYtDlpRunning();
  const logHasDownload = !!(logTail && (/\[download\]/i.test(logTail) || /Total fragments/i.test(logTail)));
  const logStale = logPath ? logIsStale(logPath) : false;

  if (finished && !ytdlp) {
    return {
      active: true,
      status: 'processing',
      percent: 99,
      downloaded_human: formatBytes(fs.statSync(finished).size),
      message: 'Archivo listo — finalizando en catálogo…',
      log_file: logPath ? path.relative(DATA, logPath) : null
    };
  }

  let percent = parsedLog?.percent ?? 0;
  let totalBytes = parsedLog?.total_bytes || 0;
  let downloadedBytes = parsedLog?.downloaded_bytes || 0;
  let dlStatus = null;
  let message = null;

  if (parsedLog?.frag_current != null && parsedLog?.frag_total > 0) {
    const fc = parsedLog.frag_current;
    const ft = parsedLog.frag_total;
    if (fc >= ft - 1) {
      percent = 99;
      dlStatus = ytdlp ? 'merging' : 'processing';
      message = ytdlp ? 'Uniendo audio y video…' : 'Descarga completa — guardando…';
    } else {
      percent = Math.min(98, Math.round((fc / ft) * 1000) / 10);
    }
    downloadedBytes = partial.bytes || downloadedBytes;
    if (partial.bytes > 200 * 1024 * 1024) totalBytes = partial.bytes;
  } else if (partial.bytes > 0 && totalBytes > 100 * 1024 * 1024) {
    const pctFromFile = Math.min(99.9, (partial.bytes / totalBytes) * 100);
    if (pctFromFile > percent) {
      percent = Math.round(pctFromFile * 10) / 10;
      downloadedBytes = partial.bytes;
    }
  } else if (partial.bytes > 0) {
    downloadedBytes = partial.bytes;
    if (!percent && partial.bytes > 20 * 1024 * 1024) percent = 1;
  }

  let status = dlStatus || parsedLog?.status || (partial.bytes > 0 ? 'downloading' : 'queued');
  const stalled = logStale && !ytdlp && partial.bytes > 0 && percent < 98;
  if (stalled) status = 'stalled';

  const active = stalled
    ? false
    : !!(parsedLog || partial.bytes > 0 || (logHasDownload && ytdlp) || dlStatus === 'merging');

  if (!message) {
    if (stalled) message = 'Descarga detenida — pulsa Reanudar';
    else if (active && percent > 0) message = 'Descargando capítulo…';
    else if (logHasDownload && !parsedLog) message = 'Iniciando descarga…';
    else if (ytdlp) message = 'En cola (otra descarga activa)';
    else message = 'Pendiente — cola automática';
  }

  return {
    active,
    status,
    percent: Math.min(100, Math.max(0, percent)),
    total_bytes: totalBytes,
    downloaded_bytes: downloadedBytes,
    downloaded_human: formatBytes(downloadedBytes || partial.bytes),
    total_human: (parsedLog?.frag_current != null && parsedLog?.frag_total > 0)
      ? `${parsedLog.frag_current}/${parsedLog.frag_total} fragmentos`
      : (totalBytes > 50 * 1024 * 1024 ? formatBytes(totalBytes) : null),
    speed: parsedLog?.speed || null,
    eta: parsedLog?.eta || null,
    frag_current: parsedLog?.frag_current ?? null,
    frag_total: parsedLog?.frag_total ?? null,
    message,
    partial_files: partial.files.length,
    log_file: logPath ? path.relative(DATA, logPath) : null
  };
}

function getPendingEpisodesProgress(seriesId = null) {
  const sql = seriesId
    ? 'SELECT * FROM episodes WHERE series_id = ? AND COALESCE(available, 1) = 0 ORDER BY season, episode'
    : 'SELECT * FROM episodes WHERE COALESCE(available, 1) = 0 ORDER BY series_id, season, episode';
  const rows = seriesId
    ? db.prepare(sql).all(seriesId)
    : db.prepare(sql).all();
  const out = {};
  for (const ep of rows) {
    out[ep.id] = getEpisodeDownloadProgress(ep);
  }
  return out;
}

module.exports = {
  loadJobs,
  registerDownloadJob,
  getDownloadJob,
  clearDownloadJob,
  registerPrepJob,
  clearPrepJob,
  getPrepJob,
  getMovieDownloadProgress,
  getPendingMoviesProgress,
  registerEpisodeDownloadJob,
  clearEpisodeDownloadJob,
  getEpisodeDownloadProgress,
  getPendingEpisodesProgress,
  formatBytes,
  isYtDlpRunning
};
