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
  const slug = extractSlugFromPath(vp);

  if (vp.includes('pending_') && slug) {
    return safeFilename(
      slug.replace(/-/g, ' ').replace(/\s+\d{4}$/, ''),
      movie.year
    ).replace('.mkv', '');
  }

  if (!slug || slug === '-' || slug.length < 2) {
    return safeFilename(movie.title, movie.year).replace(/\.mkv$/i, '');
  }

  if (fs.existsSync(MOVIES_DIR)) {
    const needle = slug.replace(/^pending_/, '').replace(/-/g, '_').toLowerCase();
    if (needle.length >= 12) {
      const hit = fs.readdirSync(MOVIES_DIR).find((f) => {
        if (f.endsWith('.ytdl') || f.includes('.part')) return false;
        const base = f.replace(/\.(mkv|mp4)$/i, '').toLowerCase();
        return base.includes(needle);
      });
      if (hit) {
        return hit
          .replace(/\.(mkv|mp4)\.part.*$/i, '')
          .replace(/\.(mkv|mp4)$/i, '')
          .replace(/\.part$/i, '');
      }
    }
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
  '918+audio0-Español',
  '441+audio0-Español',
  'bestvideo*[height>=1080]+bestaudio[language^=es]',
  'bestvideo*+bestaudio[language^=es]',
  'best[language^=es]',
  'best'
].join('/');

const FORMAT_GOODSTREAM_1080 = [
  '2611+audio0-Español',
  'bestvideo*[height<=1080][height>=1000]+bestaudio[language^=es]',
  'best[height<=1080][height>=1000][language^=es]',
  'best[height<=1080][language^=es]'
].join('/');

const FORMAT_GOODSTREAM_720 = [
  '918+audio0-Español',
  '441+audio0-Español',
  'bestvideo*[height<=720][height>=600]+bestaudio[language^=es]',
  'best[height<=720][language^=es]'
].join('/');

function goodstreamFormatForQuality(quality) {
  if (quality === '1080') return FORMAT_GOODSTREAM_1080;
  if (quality === '720') return FORMAT_GOODSTREAM_720;
  if (quality === '480') return '441+audio0-Español/best[height<=480][language^=es]/best[height<=480]';
  return FORMAT_GOODSTREAM_MAX;
}

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
      if (code !== 0) {
        let detail = `yt-dlp código ${code}`;
        try {
          const tail = fs.readFileSync(logPath, 'utf8').slice(-4000);
          const errLine = tail.split('\n').reverse().find((l) => /^ERROR:/i.test(l.trim()));
          if (errLine) detail = errLine.replace(/^ERROR:\s*/i, '').trim();
        } catch { /* ignore */ }
        return reject(new Error(detail));
      }
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
          '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
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
  const gsFmt = goodstreamFormatForQuality(quality);
  const formatAttempts = quality === 'max'
    ? [
      ['-f', FORMAT_GOODSTREAM_MAX],
      ...q.formats.map((f) => ['-f', f]),
      ['-f', '2567+audio0-Español/947+audio0-Español/best']
    ]
    : [
      ['-f', gsFmt],
      ...q.formats.map((f) => ['-f', f]),
      ['-f', FORMAT_GOODSTREAM_MAX]
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
  if (!destBase || !fs.existsSync(MOVIES_DIR)) return null;
  const { isValidVideoFile } = require('./videoPrep');
  for (const ext of ['.mkv', '.mp4']) {
    const exact = path.join(MOVIES_DIR, `${destBase}${ext}`);
    try {
      if (fs.existsSync(exact) && fs.statSync(exact).size >= 10 * 1024 * 1024 && isValidVideoFile(exact)) {
        return exact;
      }
    } catch { /* ignore */ }
  }
  const candidates = [];
  for (const name of fs.readdirSync(MOVIES_DIR)) {
    if (!name.startsWith(destBase) || name.includes('.part') || name.includes('.ytdl')) continue;
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

/** Busca video terminado por dest_base, slug o ruta pending (import web). */
function findFinishedFileForMovie(movie, job = {}) {
  const destBase = job.dest_base || destBaseFromMovie(movie);
  let hit = findFinishedFile(destBase);
  if (hit) return hit;

  const slug = job.slug || extractSlugFromPath(movie.video_path);
  if (slug) {
    const { slugVariants } = require('./movieDedup');
    const yearSuffix = String(movie.year || slug.match(/-(\d{4})$/)?.[1] || '');
    for (const v of slugVariants(slug)) {
      const needle = v.replace(/-/g, '_');
      if (needle.length < 12) continue;
      hit = fs.readdirSync(MOVIES_DIR).find((name) => {
        if (name.includes('.part') || name.includes('.ytdl')) return false;
        if (!/\.(mkv|mp4)$/i.test(name)) return false;
        const lower = name.toLowerCase();
        if (!lower.includes(needle.toLowerCase())) return false;
        return !yearSuffix || lower.includes(yearSuffix);
      });
      if (hit) {
        const full = path.join(MOVIES_DIR, hit);
        try {
          const { isValidVideoFile } = require('./videoPrep');
          if (fs.statSync(full).size >= 10 * 1024 * 1024 && isValidVideoFile(full)) return full;
        } catch { /* ignore */ }
      }
    }
  }

  const titleBase = safeFilename(movie.title, movie.year).replace(/\.mkv$/i, '');
  if (titleBase && titleBase !== destBase) {
    hit = findFinishedFile(titleBase);
    if (hit) return hit;
  }

  const vp = movie.video_path || '';
  if (vp.startsWith('/uploads/movies/') && !vp.includes('pending_')) {
    const full = path.join(DATA, vp.replace(/^\/uploads\//, ''));
    try {
      const { isValidVideoFile } = require('./videoPrep');
      if (fs.existsSync(full) && fs.statSync(full).size >= 5 * 1024 * 1024 && isValidVideoFile(full)) {
        return full;
      }
    } catch { /* ignore */ }
  }
  return null;
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
        db.prepare(`
          UPDATE movies SET video_path=?, available=1, created_at=CURRENT_TIMESTAMP WHERE id=?
        `).run(publicPath, movieId);
        setImmediate(() => {
          const row = db.prepare('SELECT genre FROM movies WHERE id = ?').get(movieId);
          const { autoSyncMovieTmdbIfNeeded, isImportPlaceholderGenre } = require('./tmdbMetadata');
          autoSyncMovieTmdbIfNeeded(movieId, { force: isImportPlaceholderGenre(row?.genre) }).catch(() => {});
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

  db.prepare(`
    UPDATE movies SET video_path=?, available=1, video_quality=?, created_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(publicPath, videoQuality || null, movieId);

  setImmediate(() => {
    const row = db.prepare('SELECT genre FROM movies WHERE id = ?').get(movieId);
    const { autoSyncMovieTmdbIfNeeded, isImportPlaceholderGenre } = require('./tmdbMetadata');
    const force = isImportPlaceholderGenre(row?.genre);
    autoSyncMovieTmdbIfNeeded(movieId, { force }).catch((err) => {
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

async function resolveCinecalidadUrl(slug, quality = 'max') {
  const { parseMoviePage, resolveBestStream } = require('./cinecalidad');
  const page = await parseMoviePage(slug);
  const stream = await resolveBestStream(page, quality);
  if (stream.m3u8) {
    return { url: stream.m3u8, referer: stream.referer, type: stream.type, slug: page.slug };
  }
  if (stream.embedUrl) {
    return { url: stream.embedUrl, referer: stream.referer || 'https://www.cinecalidad.am/', type: stream.type, slug: page.slug };
  }
  throw new Error('Sin stream en Cinecalidad');
}

async function runCinecalidadDownload(slug, outPath, logPath, quality = 'max') {
  const r = await resolveCinecalidadUrl(slug, quality);
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

function fetchAllcalidadJson(url) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchAllcalidadPlayerEmbeds(slug, year = 2026) {
  const FAST_API = 'https://allcalidad.re/api/rest';
  let s = slug;
  if (s && !/-\d{4}$/.test(s)) s = `${s}-${year}`;
  const single = await fetchAllcalidadJson(
    `${FAST_API}/single?post_name=${encodeURIComponent(s)}&post_type=movies`
  );
  if (single.error || !single.data) {
    throw new Error(`AllCalidad: ${single.message || 'no encontrada'}`);
  }
  const player = await fetchAllcalidadJson(`${FAST_API}/player?post_id=${single.data._id}&_any=1`);
  return { slug: s, embeds: player.data?.embeds || [] };
}

async function probeAllcalidadEmbedCandidate(emb) {
  const pageUrl = emb.url || '';
  if (!pageUrl) return null;
  const { resolveVimeosEmbedUrl, maxHeightFromM3u8 } = require('./vimeosEmbed');

  if (/vimeos/i.test(pageUrl)) {
    try {
      const m3u8 = await resolveVimeosEmbedUrl(pageUrl, pageUrl);
      let maxHeight = await maxHeightFromM3u8(m3u8, pageUrl);
      if (!maxHeight) maxHeight = probeStreamMaxHeight(m3u8, pageUrl).maxHeight || 0;
      if (!m3u8) return null;
      return {
        type: 'hls',
        url: m3u8,
        referer: pageUrl,
        maxHeight,
        host: 'vimeos',
        downloadable: true
      };
    } catch (err) {
      console.warn('[allcalidad] vimeos embed:', err.message);
      return null;
    }
  }

  if (/goodstream/i.test(pageUrl)) {
    let maxHeight = 0;
    try {
      maxHeight = probeStreamMaxHeight(pageUrl, 'https://allcalidad.re/').maxHeight || 0;
    } catch { /* ignore */ }
    if (!maxHeight) maxHeight = 1080;
    return {
      type: 'goodstream',
      url: pageUrl,
      referer: 'https://allcalidad.re/',
      maxHeight,
      host: 'goodstream',
      downloadable: true
    };
  }

  if (/hlswish|wishfast/i.test(pageUrl)) {
    let maxHeight = 0;
    try {
      maxHeight = probeStreamMaxHeight(pageUrl, 'https://allcalidad.re/').maxHeight || 0;
    } catch { /* ignore */ }
    if (!maxHeight) maxHeight = 720;
    return {
      type: 'embed',
      url: pageUrl,
      referer: 'https://allcalidad.re/',
      maxHeight,
      host: 'hlswish',
      downloadable: true
    };
  }

  if (/filemoon/i.test(pageUrl)) {
    try {
      const { resolveM3u8FromHostPage } = require('./cuevana');
      const m3u8 = await resolveM3u8FromHostPage(pageUrl);
      if (!m3u8) return null;
      let maxHeight = await maxHeightFromM3u8(m3u8, pageUrl);
      if (!maxHeight) maxHeight = probeStreamMaxHeight(m3u8, pageUrl).maxHeight || 0;
      return {
        type: 'hls',
        url: m3u8,
        referer: pageUrl,
        maxHeight,
        host: 'filemoon',
        downloadable: !!maxHeight
      };
    } catch { /* ignore */ }
  }

  return null;
}

async function probeAllcalidadEmbedCandidateFast(emb) {
  const pageUrl = emb.url || '';
  if (!pageUrl) return null;

  if (/goodstream/i.test(pageUrl)) {
    return {
      type: 'goodstream',
      url: pageUrl,
      referer: 'https://allcalidad.re/',
      maxHeight: 1080,
      host: 'goodstream',
      downloadable: true
    };
  }

  if (/hlswish|wishfast/i.test(pageUrl)) {
    return {
      type: 'embed',
      url: pageUrl,
      referer: 'https://allcalidad.re/',
      maxHeight: 720,
      host: 'hlswish',
      downloadable: true
    };
  }

  if (/vimeos/i.test(pageUrl)) {
    try {
      const { resolveVimeosEmbedUrl } = require('./vimeosEmbed');
      const m3u8 = await resolveVimeosEmbedUrl(pageUrl, pageUrl);
      if (!m3u8) return null;
      return {
        type: 'hls',
        url: m3u8,
        referer: pageUrl,
        maxHeight: 1080,
        host: 'vimeos',
        downloadable: true
      };
    } catch (err) {
      console.warn('[allcalidad] fast vimeos:', err.message);
      return null;
    }
  }

  if (/\.m3u8/i.test(pageUrl)) {
    return {
      type: 'hls',
      url: pageUrl,
      referer: 'https://allcalidad.re/',
      maxHeight: 1080,
      host: 'hls',
      downloadable: true
    };
  }

  return null;
}

const allcalidadCandidatesCache = new Map();
const ALLCALIDAD_CANDIDATES_MS = 30 * 60 * 1000;

async function listAllcalidadStreamCandidatesFast(slug, year = 2026) {
  const cacheKey = `${slug}:${year}`;
  const hit = allcalidadCandidatesCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ALLCALIDAD_CANDIDATES_MS) {
    return hit.candidates;
  }

  const { slug: s, embeds } = await fetchAllcalidadPlayerEmbeds(slug, year);
  const sorted = [...embeds].sort((a, b) => {
    const urlA = a.url || '';
    const urlB = b.url || '';
    if (/goodstream/i.test(urlA)) return -1;
    if (/goodstream/i.test(urlB)) return 1;
    if (/vimeos/i.test(urlA)) return -1;
    if (/vimeos/i.test(urlB)) return 1;
    if (/hlswish|wishfast/i.test(urlA)) return -1;
    return 0;
  });

  const candidates = [];
  for (const emb of sorted.slice(0, 3)) {
    const c = await probeAllcalidadEmbedCandidateFast(emb);
    if (c?.url) candidates.push({ ...c, slug: s });
    if (candidates.length >= 2) break;
  }

  if (!candidates.length) {
    return listAllcalidadStreamCandidates(slug, year);
  }

  allcalidadCandidatesCache.set(cacheKey, { at: Date.now(), candidates });
  return candidates;
}

/** Lista reproductores AllCalidad ordenados por calidad máxima detectada. */
async function listAllcalidadStreamCandidates(slug, year = 2026) {
  const { slug: s, embeds } = await fetchAllcalidadPlayerEmbeds(slug, year);
  const candidates = [];
  for (const emb of embeds) {
    const hit = await probeAllcalidadEmbedCandidate(emb);
    if (hit?.url) candidates.push({ ...hit, slug: s });
  }
  candidates.sort((a, b) => (b.maxHeight || 0) - (a.maxHeight || 0));
  return candidates;
}

/** Detecta calidades disponibles en todos los embeds de una película AllCalidad. */
async function probeAllcalidadQualities(slug, year = 2026) {
  const { buildQualityProbeResult } = require('./videoQuality');
  const candidates = await listAllcalidadStreamCandidates(slug, year);
  if (!candidates.length) {
    throw new Error('Sin reproductor descargable en AllCalidad');
  }
  const maxH = Math.max(...candidates.map((c) => c.maxHeight || 0));
  return buildQualityProbeResult(maxH, candidates);
}

function pickAllcalidadCandidate(candidates, quality = 'max') {
  if (!candidates.length) return null;

  const targetH = { max: 0, '1080': 1080, '720': 720, '480': 480 }[quality] ?? 1080;

  // Goodstream suele ser la única fuente real en 1080p; no descartarla si el usuario la pidió.
  if (quality === '1080' || quality === 'max') {
    const bestGs = candidates
      .filter((c) => c.host === 'goodstream' && (c.maxHeight || 0) >= 1000)
      .sort((a, b) => (b.maxHeight || 0) - (a.maxHeight || 0))[0];
    if (bestGs) {
      if (quality === '1080') return bestGs;
      const top = candidates[0];
      if (!top || top.host === 'goodstream' || (bestGs.maxHeight || 0) >= (top.maxHeight || 0)) {
        return bestGs;
      }
    }
  }

  const alt = candidates.filter((c) => c.host !== 'goodstream');
  const list = alt.length ? alt : candidates;

  if (quality === 'max') return list[0];

  const suitable = list
    .filter((c) => (c.maxHeight || 0) >= targetH)
    .sort((a, b) => (a.maxHeight || 0) - (b.maxHeight || 0));
  if (suitable.length) return suitable[0];

  const below = list
    .filter((c) => (c.maxHeight || 0) < targetH)
    .sort((a, b) => (b.maxHeight || 0) - (a.maxHeight || 0));
  if (below.length) return below[0];

  return candidates.find((c) => c.host === 'goodstream') || list[0] || candidates[0];
}

/** m3u8 fresco de vimeos (tokens expiran; obligatorio al reanudar .part). */
async function resolveFreshVimeosHls(slug, year) {
  const { resolveVimeosEmbedUrl } = require('./vimeosEmbed');
  const { embeds } = await fetchAllcalidadPlayerEmbeds(slug, year);
  const emb = embeds.find((e) => /vimeos/i.test(e.url || ''));
  if (!emb?.url) return null;
  const m3u8 = await resolveVimeosEmbedUrl(emb.url, emb.url);
  return { url: m3u8, referer: emb.url, host: 'vimeos', type: 'hls' };
}

async function runAllcalidadStreamDownload(slug, year, quality, outPath, outFile, logAbs, destBase) {
  const resuming = !!(destBase && hasPartialFiles(destBase));
  const q = quality;
  let r;
  if (resuming) {
    const fresh = await resolveFreshVimeosHls(slug, year);
    if (fresh?.url) {
      r = fresh;
      console.log(`[allcalidad] ${slug}: reanudando HLS vimeos (token fresco)`);
    } else {
      r = await resolveAllcalidadUrl(slug, year, { quality: q });
    }
  } else {
    r = await resolveAllcalidadUrl(slug, year, { quality: q });
  }
  const hlsOpts = {
    referer: r.referer || 'https://allcalidad.re/',
    tag: 'allcalidad',
    quality: q
  };
  if (r.type === 'hls' || /\.m3u8/i.test(r.url)) {
    await runHlsDownload(r.url, outFile, logAbs, hlsOpts);
    return;
  }
  try {
    await runAllcalidadDownload(r.url, outPath, logAbs, q);
  } catch (err) {
    const candidates = await listAllcalidadStreamCandidates(slug, year);
    const hls = candidates.find((c) => c.type === 'hls' || c.host === 'vimeos');
    if (!hls?.url) throw err;
    console.warn(`[allcalidad] ${slug}: embed ${r.host || r.type} falló — vimeos HLS (${q})`);
    await runHlsDownload(hls.url, outFile, logAbs, { ...hlsOpts, quality: q });
  }
}

async function resolveAllcalidadUrl(slug, year = 2026, options = {}) {
  const quality = options.quality || 'max';
  const fast = options.fast !== false;
  const candidates = fast
    ? await listAllcalidadStreamCandidatesFast(slug, year)
    : await listAllcalidadStreamCandidates(slug, year);
  const picked = pickAllcalidadCandidate(candidates, quality);
  if (!picked) throw new Error('Sin reproductor descargable en AllCalidad');
  return {
    type: picked.type,
    url: picked.url,
    referer: picked.referer,
    slug: picked.slug,
    maxHeight: picked.maxHeight,
    host: picked.host
  };
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
  const source = options.source || job.source || detectSource(movie, job.slug || options.slug);
  const { normalizeSlugForSource } = require('./movieDedup');
  const slug = normalizeSlugForSource(
    options.slug || job.slug || extractSlugFromPath(movie.video_path) || options.slugHint,
    source
  );
  const quality = options.quality || job.quality || require('./settings').getSetting('vod_default_quality', '1080');
  const destBase = job.dest_base || destBaseFromMovie(movie);
  const outPath = path.join(MOVIES_DIR, `${destBase}.%(ext)s`);
  const logRel = logRelForMovie(movie, slug, source);
  const logAbs = path.join(DATA, logRel);

  const finished = findFinishedFileForMovie(movie, job);
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
    await runAllcalidadStreamDownload(slug, movie.year, quality, outPath, outFile, logAbs, destBase);
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

function ytdlpGetUrl(url, referer, formatStr) {
  const { spawnSync } = require('child_process');
  const args = ytDlpArgs([
    '-g',
    '-f', formatStr,
    '--no-playlist',
    ...(referer ? ['--referer', referer] : []),
    url
  ]);
  const r = spawnSync(ytDlpCommand(), args, {
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (r.status !== 0) return null;
  const line = r.stdout.trim().split('\n').find((l) => /\.m3u8/i.test(l));
  return line || null;
}

/** URL HLS de reproducción priorizando audio español latino (sin inglés). */
function extractSpanishLatinoPlaybackUrl(url, referer, quality = '1080') {
  const { isSpanishFormat, isEnglishFormat } = require('./spanishLatino');
  const targetH = { max: 0, '1080': 1080, '720': 720, '480': 480 }[quality] ?? 1080;

  if (/goodstream/i.test(url)) {
    const gs = ytdlpGetUrl(url, referer, goodstreamFormatForQuality(quality));
    if (gs) return gs;
  }

  try {
    const extra = referer ? ['--referer', referer] : [];
    const data = ytdlpJson(url, extra);
    const hlsFormats = (data.formats || [])
      .filter((f) => f.url && f.vcodec && f.vcodec !== 'none' && /\.m3u8/i.test(f.url));

    const spanish = hlsFormats.filter(isSpanishFormat);
    const pool = spanish.length
      ? spanish
      : hlsFormats.filter((f) => !isEnglishFormat(f));

    const sorted = pool.sort((a, b) => {
      const ah = a.height || 0;
      const bh = b.height || 0;
      if (quality !== 'max' && targetH) {
        return Math.abs(ah - targetH) - Math.abs(bh - targetH);
      }
      return bh - ah;
    });

    if (sorted[0]?.url) return sorted[0].url;
    if (/\.m3u8/i.test(data.url || '')) return data.url;
  } catch (err) {
    console.warn('[vodYtDlp] spanish hls:', err.message);
  }
  return null;
}

module.exports = {
  ytdlpJson,
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
  findFinishedFileForMovie,
  hasPartialFiles,
  finalizeDownloadedMovie,
  resumeMovieDownload,
  listResumableMovies,
  detectSource,
  resolveAllcalidadUrl,
  pickAllcalidadCandidate,
  probeAllcalidadQualities,
  listAllcalidadStreamCandidates,
  resolveCinecalidadUrl,
  runCinecalidadDownload,
  extractSpanishLatinoPlaybackUrl,
  clearMovieFilesForRedownload,
  MOVIES_DIR,
  DATA
};
