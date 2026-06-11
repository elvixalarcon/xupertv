const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../db');
const { extractSlugFromPath } = require('./movieDedup');
const { registerDownloadJob, clearDownloadJob } = require('./vodDownloadProgress');
const { prepareUploadedVideo, applyVideoPrepResult } = require('./videoPrep');

const ROOT = path.join(__dirname, '..', '..');
const MOVIES_DIR = path.join(ROOT, 'data', 'movies');
const DATA = path.join(ROOT, 'data');

function safeFilename(title, year) {
  return String(title || 'pelicula')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) + (year ? `_${year}` : '') + '.mkv';
}

function destBaseFromMovie(movie) {
  const vp = movie.video_path || '';
  const moviesDir = MOVIES_DIR;
  let slug = extractSlugFromPath(vp);
  if (!slug || slug === '-' || slug.length < 2) {
    return safeFilename(movie.title, movie.year).replace(/\.mkv$/i, '');
  }

  if (fs.existsSync(moviesDir)) {
    const needle = (slug || path.basename(vp, path.extname(vp)))
      .replace(/^pending_/, '')
      .replace(/-/g, '_')
      .slice(0, 14)
      .toLowerCase();
    if (needle.length >= 6) {
      const hit = fs.readdirSync(moviesDir).find((f) =>
        f.toLowerCase().includes(needle) && !f.endsWith('.ytdl')
      );
      if (hit) {
        return hit
          .replace(/\.(mkv|mp4)\.part.*$/i, '')
          .replace(/\.(mkv|mp4)$/i, '')
          .replace(/\.part$/i, '');
      }
    }
  }

  if (vp.includes('pending_') && slug) {
    return safeFilename(
      slug.replace(/-/g, ' ').replace(/\s+\d{4}$/, ''),
      movie.year
    ).replace('.mkv', '');
  }
  return path.basename(vp, path.extname(vp));
}

function logRelForMovie(movie, slug, source = 'auto') {
  const s = slug || extractSlugFromPath(movie.video_path) || '';
  const isCinecalidad = source === 'cinecalidad' || String(movie.genre || '').includes('Cinecalidad');
  const isAllcalidad = source === 'allcalidad'
    || String(movie.genre || '').includes('AllCalidad')
    || (s && !isCinecalidad && !s.includes('cuevana') && /-\d{4}$/.test(s));
  if (isCinecalidad && s) return `winscp/import-cinecalidad-${s}.log`;
  if (isAllcalidad && s) return `winscp/import-${s}.log`;
  if (s) return `winscp/import-cuevana-${s}.log`;
  return `winscp/import-${destBaseFromMovie(movie)}.log`;
}

function ytDlpCommand() {
  if (process.env.YT_DLP_BIN) return process.env.YT_DLP_BIN;
  const { execSync } = require('child_process');
  try {
    const bin = execSync('command -v yt-dlp 2>/dev/null', { encoding: 'utf8' }).trim();
    if (bin) return bin;
  } catch { /* ignore */ }
  return 'python3';
}

function ytDlpArgs(args) {
  const cmd = ytDlpCommand();
  return cmd === 'python3' ? ['-m', 'yt_dlp', ...args] : args;
}

/** Mejor calidad disponible sin tope de resolución. */
const FORMAT_MAX_QUALITY = 'bestvideo*+bestaudio/best';

const QUALITY_PRESETS = {
  max: {
    label: 'Máxima (4K / mejor disponible)',
    sort: ['--format-sort', 'res:2160,res:1440,res:1080,res:720,codec:h264,lang:es'],
    formats: [
      'bestvideo*[height>=1080]+bestaudio/bestvideo*[height>=720]+bestaudio/bestvideo*+bestaudio/best',
      FORMAT_MAX_QUALITY,
      'best'
    ]
  },
  '1080': {
    label: 'Full HD 1080p',
    sort: ['--format-sort', 'res:1080,res:720,codec:h264,lang:es'],
    formats: [
      'bestvideo*[height<=1080][height>=720]+bestaudio/bestvideo*[height<=1080]+bestaudio/best[height<=1080]',
      'best[height<=1080]',
      'best'
    ]
  },
  '720': {
    label: 'HD 720p',
    sort: ['--format-sort', 'res:720,res:480,codec:h264,lang:es'],
    formats: [
      'bestvideo*[height<=720][height>=480]+bestaudio/bestvideo*[height<=720]+bestaudio/best[height<=720]',
      'best[height<=720]',
      'best'
    ]
  },
  '480': {
    label: 'SD 480p',
    sort: ['--format-sort', 'res:480,codec:h264,lang:es'],
    formats: [
      'bestvideo*[height<=480]+bestaudio/best[height<=480]',
      'best[height<=480]',
      'worstvideo*+bestaudio/worst'
    ]
  }
};

function resolveQualityOptions(quality) {
  const key = QUALITY_PRESETS[quality] ? quality : 'max';
  return { key, ...QUALITY_PRESETS[key] };
}

/** Prioriza según preset de calidad. */
function qualitySortArgs(quality) {
  return resolveQualityOptions(quality).sort;
}

/** Prioriza 4K → 1080p → 720p (preset máxima). */
const YTDLP_QUALITY_SORT = qualitySortArgs('max');

/** Goodstream / embeds AllCalidad: pistas Full HD primero (2611 ≈ 1920×960). */
const FORMAT_GOODSTREAM_MAX = [
  '2611+audio0-Español',
  '2611+audio0-English',
  '918+audio0-Español',
  '918+audio0-English',
  '441+audio0-Español',
  '441+audio0-English',
  'bestvideo*[height>=1080]+bestaudio',
  'bestvideo*+bestaudio',
  'best'
].join('/');

const HLS_CONCURRENT_FRAGMENTS = parseInt(process.env.VOD_HLS_FRAGMENTS || '16', 10) || 16;

const FORMAT_HD_FALLBACKS = [
  'bestvideo*[height>=1080]+bestaudio/bestvideo*[height>=720]+bestaudio/bestvideo*+bestaudio/best',
  FORMAT_MAX_QUALITY,
  'best'
];

function ytdlpJson(url, extraArgs = []) {
  const { spawnSync } = require('child_process');
  const bin = ytDlpCommand();
  const args = ytDlpArgs(['-J', '--no-playlist', ...extraArgs, url]);
  const r = spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 90000
  });
  if (r.status !== 0) throw new Error(r.stderr || 'yt-dlp -J falló');
  return JSON.parse(r.stdout);
}

/** Altura máxima disponible en un manifest HLS/embed. */
function probeStreamMaxHeight(url, referer) {
  try {
    const extra = referer ? ['--referer', referer] : [];
    const data = ytdlpJson(url, extra);
    const heights = (data.formats || [])
      .filter((f) => f.vcodec && f.vcodec !== 'none')
      .map((f) => f.height || 0);
    const maxHeight = heights.length ? Math.max(...heights) : 0;
    const best = (data.formats || [])
      .filter((f) => f.vcodec && f.vcodec !== 'none' && f.height)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    return {
      maxHeight,
      formatId: best?.format_id || null,
      tbr: best?.tbr || 0,
      width: best?.width || 0,
      height: best?.height || 0
    };
  } catch {
    return { maxHeight: 0, formatId: null, tbr: 0, width: 0, height: 0 };
  }
}

function pickYtdlpFormatForQuality(url, referer, quality = '1080') {
  try {
    const extra = referer ? ['--referer', referer] : [];
    const data = ytdlpJson(url, extra);
    const minH = { max: 1080, '1080': 1080, '720': 720, '480': 360 }[quality] || 720;
    const video = (data.formats || [])
      .filter((f) => f.vcodec && f.vcodec !== 'none' && f.height)
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    const pick = video.find((f) => (f.height || 0) >= minH) || video[0];
    if (!pick?.format_id) return null;
    return `${pick.format_id}+bestaudio/best[height<=${pick.height}]/${pick.format_id}`;
  } catch {
    return null;
  }
}

function runYtDlp(args, logPath, tag = 'vod') {
  return new Promise((resolve, reject) => {
    const cmd = ytDlpCommand();
    const fullArgs = ytDlpArgs(args);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`\n[${tag}] ${new Date().toISOString()}\n`);
    const proc = spawn(cmd, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const tee = (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
    };
    proc.stdout.on('data', tee);
    proc.stderr.on('data', tee);
    proc.on('error', (err) => {
      logStream.end();
      reject(err);
    });
    proc.on('close', (code) => {
      logStream.end();
      if (code !== 0) return reject(new Error(`yt-dlp código ${code}`));
      resolve();
    });
  });
}

/** Descarga HLS (m3u8) en máxima calidad; referer obligatorio en hosts como vimeos. */
function runHlsDownload(m3u8Url, outPath, logPath, options = {}) {
  const referer = options.referer || 'https://allcalidad.re/';
  const origin = options.origin || (() => {
    try { return new URL(referer).origin; } catch { return referer; }
  })();
  const q = resolveQualityOptions(options.quality);
  const picked = pickYtdlpFormatForQuality(m3u8Url, referer, options.quality);
  const formatAttempts = picked
    ? [picked, ...(options.formats || q.formats)]
    : (options.formats || q.formats);
  return (async () => {
    let lastErr;
    for (const fmt of formatAttempts) {
      try {
        await runYtDlp([
          ...q.sort,
          '-f', fmt,
          '--merge-output-format', 'mkv',
          '--continue',
          '--concurrent-fragments', String(HLS_CONCURRENT_FRAGMENTS),
          '--hls-use-mpegts',
          '--no-playlist',
          '--referer', referer,
          '--add-header', `Origin:${origin}`,
          '-o', outPath,
          m3u8Url
        ], logPath, options.tag || 'hls');
        return;
      } catch (err) {
        lastErr = err;
        if (!/format is not available/i.test(err.message)) throw err;
      }
    }
    throw lastErr || new Error('No se pudo descargar el stream HLS');
  })();
}

/** Descarga Cuevana (HLS m3u8). */
function runCuevanaDownload(m3u8Url, outPath, logPath, quality = 'max') {
  return runHlsDownload(m3u8Url, outPath, logPath, {
    referer: 'https://cuevana3.cl/',
    tag: 'cuevana',
    quality
  });
}

/** Descarga desde cualquier URL que soporte yt-dlp (páginas web / embeds). */
function runGenericWebDownload(pageUrl, outPath, logPath, quality = 'max') {
  const q = resolveQualityOptions(quality);
  const formatAttempts = q.formats;
  return (async () => {
    let lastErr;
    for (const fmt of formatAttempts) {
      try {
        await runYtDlp([
          ...q.sort,
          '-f', fmt,
          '--merge-output-format', 'mkv',
          '--continue',
          '--concurrent-fragments', String(HLS_CONCURRENT_FRAGMENTS),
          '--no-playlist',
          '-o', outPath,
          pageUrl
        ], logPath, 'web');
        return;
      } catch (err) {
        lastErr = err;
        if (!/format is not available|unsupported url|no suitable/i.test(err.message)) throw err;
      }
    }
    throw lastErr || new Error('No se pudo extraer video de esta página');
  })();
}

/** Descarga AllCalidad (goodstream / embeds). */
function runAllcalidadDownload(embedUrl, outPath, logPath, quality = 'max') {
  const q = resolveQualityOptions(quality);
  const baseArgs = [
    ...q.sort,
    '--merge-output-format', 'mkv',
    '--continue',
    '--concurrent-fragments', String(HLS_CONCURRENT_FRAGMENTS),
    '--hls-use-mpegts',
    '--no-playlist',
    '-o', outPath,
    embedUrl
  ];
  const formatAttempts = quality === 'max'
    ? [
      ['-f', FORMAT_GOODSTREAM_MAX],
      ...q.formats.map((f) => ['-f', f]),
      ['-f', '2567+audio0-Español/947+audio0-Español/best']
    ]
    : [
      ...q.formats.map((f) => ['-f', f]),
      ['-f', '918+audio0-Español/441+audio0-Español/best[height<=1080]/best']
    ];
  return (async () => {
    let lastErr;
    for (const fmt of formatAttempts) {
      try {
        await runYtDlp([...fmt, ...baseArgs], logPath, 'allcalidad');
        return;
      } catch (err) {
        lastErr = err;
        if (!/format is not available/i.test(err.message)) throw err;
      }
    }
    throw lastErr || new Error('No se pudo descargar el video');
  })();
}

function findFinishedFile(destBase) {
  if (!fs.existsSync(MOVIES_DIR)) return null;
  const { isValidVideoFile } = require('./videoPrep');
  const prefix = destBase.slice(0, Math.min(20, destBase.length));
  const candidates = [];
  for (const name of fs.readdirSync(MOVIES_DIR)) {
    if (!name.startsWith(prefix) || name.includes('.part') || name.includes('.ytdl')) continue;
    if (!/\.(mkv|mp4)$/i.test(name)) continue;
    const full = path.join(MOVIES_DIR, name);
    try {
      if (fs.statSync(full).size < 10 * 1024 * 1024) continue;
      if (!isValidVideoFile(full)) continue;
      candidates.push(full);
    } catch { /* ignore */ }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const ext = (p) => path.extname(p).toLowerCase();
    if (ext(a) === '.mkv' && ext(b) !== '.mkv') return -1;
    if (ext(b) === '.mkv' && ext(a) !== '.mkv') return 1;
    return fs.statSync(b).size - fs.statSync(a).size;
  });
  return candidates[0];
}

function hasPartialFiles(destBase) {
  if (!fs.existsSync(MOVIES_DIR)) return false;
  return fs.readdirSync(MOVIES_DIR).some((f) =>
    f.includes(destBase.slice(0, 12)) && (f.endsWith('.part') || f.endsWith('.mp4') || f.endsWith('.ytdl'))
  );
}

/** Borra archivos previos al volver a descargar (evita falso «99% finalizando»). */
function clearMovieFilesForRedownload(destBase, slug = '') {
  if (!fs.existsSync(MOVIES_DIR)) return;
  const { slugVariants } = require('./movieDedup');
  const needles = new Set();
  if (destBase) {
    needles.add(String(destBase).toLowerCase());
    needles.add(String(destBase).toLowerCase().slice(0, 12));
  }
  if (slug) {
    for (const v of slugVariants(slug)) {
      needles.add(v.toLowerCase());
      needles.add(v.replace(/-/g, '_').toLowerCase());
    }
  }
  for (const name of fs.readdirSync(MOVIES_DIR)) {
    const low = name.toLowerCase();
    if (name.includes('.part') || name.includes('.ytdl')) {
      if ([...needles].some((n) => n && low.includes(n))) {
        try { fs.unlinkSync(path.join(MOVIES_DIR, name)); } catch { /* ignore */ }
      }
      continue;
    }
    if (!/\.(mkv|mp4)$/i.test(name)) continue;
    if (![...needles].some((n) => n && (low.startsWith(n) || low.includes(n)))) continue;
    try { fs.unlinkSync(path.join(MOVIES_DIR, name)); } catch { /* ignore */ }
  }
}

async function finalizeDownloadedMovie(movieId, absVideo, videoPath) {
  const { toPublicPath, prepareUploadedVideo, applyVideoPrepResult } = require('./videoPrep');
  const { registerPrepJob, clearDownloadJob, clearPrepJob } = require('./vodDownloadProgress');

  clearDownloadJob(movieId);

  let publicPath = videoPath.startsWith('/uploads/')
    ? videoPath
    : toPublicPath(absVideo);
  const ext = path.extname(absVideo).toLowerCase();

  if (ext === '.mkv') {
    registerPrepJob(movieId, {
      status: 'converting',
      format: 'mp4',
      source: path.basename(absVideo)
    });
    try {
      console.log(`[vodYtDlp] #${movieId} preparando MP4 reproducible…`);
      const prep = await prepareUploadedVideo(absVideo);
      const applied = applyVideoPrepResult(prep, movieId, 'movie', publicPath);
      publicPath = applied.publicPath || publicPath;
      if (prep.mode === 'ready') {
        const { getMediaDurationSec, isValidVideoFile } = require('./videoPrep');
        const mp4Abs = path.join(DATA, publicPath.replace(/^\/uploads\//, ''));
        const mp4Dur = getMediaDurationSec(mp4Abs);
        const mkvDur = getMediaDurationSec(absVideo);
        if (mp4Dur > 0 && mp4Dur < 300 && mkvDur > mp4Dur + 60) {
          try { fs.unlinkSync(mp4Abs); } catch { /* ignore */ }
          publicPath = toPublicPath(absVideo);
          db.prepare('UPDATE movies SET video_path=?, available=1 WHERE id=?').run(publicPath, movieId);
          console.warn(`[vodYtDlp] #${movieId} MP4 demasiado corto (${Math.round(mp4Dur)}s) — se mantiene MKV`);
        } else if (!isValidVideoFile(mp4Abs, 120)) {
          publicPath = toPublicPath(absVideo);
          db.prepare('UPDATE movies SET video_path=?, available=1 WHERE id=?').run(publicPath, movieId);
          console.warn(`[vodYtDlp] #${movieId} MP4 inválido — se mantiene MKV`);
        }
        clearPrepJob(movieId);
        console.log(`[vodYtDlp] #${movieId} MP4 listo: ${path.basename(publicPath)}`);
      } else {
        db.prepare('UPDATE movies SET video_path=?, available=1 WHERE id=?').run(publicPath, movieId);
        setImmediate(() => {
          require('./tmdbMetadata').autoSyncMovieTmdbIfNeeded(movieId).catch(() => {});
        });
        console.log(`[vodYtDlp] #${movieId} transcodificación MP4 en segundo plano`);
        return publicPath;
      }
    } catch (e) {
      clearPrepJob(movieId);
      console.warn(`[vodYtDlp] #${movieId} remux MP4:`, e.message);
    }
  }

  let videoQuality = '';
  try {
    const absFinal = path.join(DATA, publicPath.replace(/^\/uploads\//, ''));
    const { probeVideoQuality } = require('./videoQuality');
    videoQuality = probeVideoQuality(absFinal);
    const job = require('./vodDownloadProgress').getDownloadJob(movieId);
    if (!videoQuality && job?.quality) {
      const { qualityLabelFromPreset } = require('./videoQuality');
      videoQuality = qualityLabelFromPreset(job.quality);
    }
  } catch { /* ignore */ }

  db.prepare('UPDATE movies SET video_path=?, available=1, video_quality=? WHERE id=?')
    .run(publicPath, videoQuality || null, movieId);

  setImmediate(() => {
    require('./tmdbMetadata').autoSyncMovieTmdbIfNeeded(movieId).catch((err) => {
      console.warn(`[vodYtDlp] TMDB auto #${movieId}:`, err.message);
    });
  });

  try {
    const { execSync } = require('child_process');
    const abs = path.join(DATA, publicPath.replace(/^\/uploads\//, ''));
    const probe = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,bit_rate -of csv=p=0 ${JSON.stringify(abs)}`,
      { encoding: 'utf8', timeout: 20000 }
    ).trim().split('\n')[0];
    const [w, h, br] = probe.split(',');
    const height = parseInt(h, 10) || 0;
    const width = parseInt(w, 10) || 0;
    console.log(`[vodYtDlp] #${movieId} video ${width}x${height} ~${Math.round((parseInt(br, 10) || 0) / 1000)}kbps`);
    if (height > 0 && height < 720) {
      console.warn(`[vodYtDlp] #${movieId} calidad baja (${height}p) — prueba descargar desde AllCalidad en 1080p`);
    }
  } catch { /* ignore */ }

  console.log(`[vodYtDlp] #${movieId} disponible: ${publicPath}`);
  return publicPath;
}

function detectSource(movie, slug) {
  const s = slug || extractSlugFromPath(movie.video_path) || '';
  const vp = movie.video_path || '';
  if (String(movie.genre || '').trim() === 'Web' || s.startsWith('web-')) return 'web';
  if (String(movie.genre || '').includes('Cinecalidad') || vp.includes('pending_cinecalidad_')) return 'cinecalidad';
  if (String(movie.genre || '').includes('AllCalidad')) return 'allcalidad';
  if (s && /-\d{4}$/.test(s)) return 'allcalidad';
  if (vp.includes('pending_') && extractSlugFromPath(vp)?.match(/-\d{4}$/)) return 'allcalidad';
  return 'cuevana';
}

async function resolveCinecalidadUrl(slug) {
  const { parseMoviePage, resolveBestStream } = require('./cinecalidad');
  const page = await parseMoviePage(slug);
  const stream = await resolveBestStream(page, 'max');
  if (stream.m3u8) {
    return { url: stream.m3u8, referer: stream.referer, type: stream.type, slug: page.slug };
  }
  if (stream.embedUrl) {
    return { url: stream.embedUrl, referer: stream.referer || 'https://www.cinecalidad.am/', type: stream.type, slug: page.slug };
  }
  throw new Error('Sin stream en Cinecalidad');
}

async function runCinecalidadDownload(slug, outPath, logPath, quality = 'max') {
  const r = await resolveCinecalidadUrl(slug);
  const outFile = outPath.replace(/%\(ext\)s$/, 'mkv').replace(/\.%\(ext\)s$/, '.mkv');
  if (r.type === 'vimeos-hls' && /\.m3u8/i.test(r.url)) {
    await runHlsDownload(r.url, outFile, logPath, {
      referer: r.referer,
      tag: 'cinecalidad',
      quality
    });
    return;
  }
  await runAllcalidadDownload(r.url, outPath, logPath, quality);
}

async function resolveAllcalidadUrl(slug, year = 2026) {
  const https = require('https');
  const FAST_API = 'https://allcalidad.re/api/rest';
  const fetchJson = (url) => new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
  let s = slug;
  if (s && !/-\d{4}$/.test(s)) s = `${s}-${year}`;
  const single = await fetchJson(
    `${FAST_API}/single?post_name=${encodeURIComponent(s)}&post_type=movies`
  );
  if (single.error || !single.data) throw new Error(`AllCalidad: ${single.message || 'no encontrada'}`);
  const player = await fetchJson(`${FAST_API}/player?post_id=${single.data._id}&_any=1`);
  const gs = (player.data?.embeds || []).find((e) => /goodstream/i.test(e.url || ''));
  if (!gs?.url) throw new Error('Sin reproductor goodstream');
  return { url: gs.url, slug: s };
}

async function resolveCuevanaUrl(slug) {
  const { parseMoviePage, resolveBestStream } = require('./cuevana');
  const movie = await parseMoviePage(slug);
  const stream = await resolveBestStream(movie);
  if (!stream?.m3u8) throw new Error('Sin stream HLS en Cuevana');
  return { url: stream.m3u8, slug: movie.slug };
}

/**
 * Reanuda o completa la descarga de una película pendiente.
 */
async function resumeMovieDownload(movieId, options = {}) {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(movieId);
  if (!movie) throw new Error('Película no encontrada');
  if (Number(movie.available) === 1) return { ok: true, skipped: true, reason: 'ya disponible' };

  const { getDownloadJob } = require('./vodDownloadProgress');
  const job = getDownloadJob(movieId) || {};
  const slug = options.slug
    || job.slug
    || extractSlugFromPath(movie.video_path)
    || options.slugHint;
  const source = options.source || job.source || detectSource(movie, slug);
  const quality = options.quality || job.quality || require('./settings').getSetting('vod_default_quality', '1080');
  const destBase = job.dest_base || destBaseFromMovie(movie);
  const outPath = path.join(MOVIES_DIR, `${destBase}.%(ext)s`);
  const logRel = logRelForMovie(movie, slug, source);
  const logAbs = path.join(DATA, logRel);

  const finished = findFinishedFile(destBase);
  if (finished) {
    const vp = `/uploads/movies/${path.basename(finished)}`;
    await finalizeDownloadedMovie(movieId, finished, vp);
    return { ok: true, resumed: false, finalized: true, path: finished };
  }

  registerDownloadJob(movieId, { logFile: logRel, destBase, slug, quality, source, media_url: job.media_url });

  console.log(`[vod-resume] #${movieId} ${movie.title} (${source}, ${quality}) → ${destBase}`);

  const outFile = path.join(MOVIES_DIR, `${destBase}.mkv`);
  if (source === 'web') {
    const pageUrl = job.media_url || options.media_url;
    if (!pageUrl) throw new Error('URL web perdida — vuelve a importar desde el buscador');
    await runGenericWebDownload(pageUrl, outPath, logAbs, quality);
  } else if (source === 'allcalidad') {
    if (!slug) throw new Error('Falta slug AllCalidad (ej. pelicula-2026)');
    const r = await resolveAllcalidadUrl(slug, movie.year);
    await runAllcalidadDownload(r.url, outPath, logAbs, quality);
  } else if (source === 'cinecalidad') {
    if (!slug) throw new Error('Falta slug Cinecalidad (ej. pearl-harbor)');
    await runCinecalidadDownload(slug, outPath, logAbs, quality);
  } else {
    if (!slug) throw new Error('Falta slug Cuevana');
    const { parseMoviePage, resolveBestStream } = require('./cuevana');
    const meta = await parseMoviePage(slug);
    const stream = await resolveBestStream(meta, quality);
    if (!stream?.m3u8) throw new Error('Sin stream HLS en Cuevana');
    await runCuevanaDownload(stream.m3u8, outFile, logAbs, quality);
  }

  const mk = findFinishedFile(destBase);
  if (!mk) {
    return { ok: false, error: 'No se generó archivo final .mkv', destBase, log: logRel };
  }
  const vp = `/uploads/movies/${path.basename(mk)}`;
  await finalizeDownloadedMovie(movieId, mk, vp);
  return { ok: true, resumed: true, path: mk, source };
}

/** Películas pendientes con archivos parciales y sin yt-dlp activo global. */
function listResumableMovies() {
  const pending = db.prepare('SELECT * FROM movies WHERE COALESCE(available, 1) = 0').all();
  return pending.filter((m) => {
    const base = destBaseFromMovie(m);
    return hasPartialFiles(base) || extractSlugFromPath(m.video_path);
  });
}

module.exports = {
  safeFilename,
  destBaseFromMovie,
  logRelForMovie,
  QUALITY_PRESETS,
  resolveQualityOptions,
  runCuevanaDownload,
  runHlsDownload,
  runGenericWebDownload,
  runAllcalidadDownload,
  probeStreamMaxHeight,
  pickYtdlpFormatForQuality,
  findFinishedFile,
  hasPartialFiles,
  finalizeDownloadedMovie,
  resumeMovieDownload,
  listResumableMovies,
  detectSource,
  resolveAllcalidadUrl,
  resolveCinecalidadUrl,
  runCinecalidadDownload,
  clearMovieFilesForRedownload,
  MOVIES_DIR,
  DATA
};
