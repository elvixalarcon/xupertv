const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');

function runProcess(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let err = '';
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `${bin} exited ${code}`));
    });
  });
}

function probeStreams(filePath) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-show_streams', '-of', 'json', filePath];
    const ff = spawn('ffprobe', args);
    let out = '';
    ff.stdout.on('data', (c) => { out += c; });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try {
        resolve(JSON.parse(out).streams || []);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function getMediaDurationSec(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${JSON.stringify(filePath)}`,
      { encoding: 'utf8', timeout: 20000 }
    );
    return parseFloat(String(out).trim()) || 0;
  } catch {
    return 0;
  }
}

function isValidVideoFile(filePath, minDurationSec = 0) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const { execSync } = require('child_process');
    execSync(`ffprobe -v error -i ${JSON.stringify(filePath)}`, { stdio: 'pipe', timeout: 15000 });
    if (minDurationSec > 0) {
      const dur = getMediaDurationSec(filePath);
      if (dur > 0 && dur < minDurationSec) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function canStreamCopy(filePath) {
  try {
    const streams = await probeStreams(filePath);
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    const vOk = video && ['h264', 'avc1', 'hevc', 'h265'].includes(String(video.codec_name || '').toLowerCase());
    const aOk = !audio || ['aac', 'mp3'].includes(String(audio.codec_name || '').toLowerCase());
    return vOk && aOk;
  } catch {
    return false;
  }
}

function outputPathFor(inputPath) {
  const dir = path.dirname(inputPath);
  const stem = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, `${stem}.mp4`);
}

function toPublicPath(absPath) {
  const rel = path.relative(DATA, absPath).replace(/\\/g, '/');
  return `/uploads/${rel}`;
}

function remuxToMp4(inputPath, outputPath, copy) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath];
  if (copy) {
    args.push('-c', 'copy');
  } else {
    args.push(
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k'
    );
  }
  args.push('-movflags', '+faststart', outputPath);
  return runProcess('ffmpeg', args);
}

function cleanupOriginal(inputPath, outputPath) {
  if (inputPath !== outputPath && fs.existsSync(inputPath)) {
    fs.unlinkSync(inputPath);
  }
}

async function prepareUploadedVideo(absPath) {
  if (!absPath || !fs.existsSync(absPath)) {
    throw new Error('Archivo de video no encontrado');
  }

  const ext = path.extname(absPath).toLowerCase();
  const outputPath = outputPathFor(absPath);
  const publicPath = toPublicPath(outputPath);

  if (ext === '.mp4' && absPath === outputPath) {
    const tempOut = `${outputPath}.opt.mp4`;
    await remuxToMp4(absPath, tempOut, true);
    fs.renameSync(tempOut, outputPath);
    return { publicPath, mode: 'ready' };
  }

  if (ext === '.mkv' && (await canStreamCopy(absPath))) {
    await remuxToMp4(absPath, outputPath, true);
    if (!isValidVideoFile(outputPath)) throw new Error('MP4 inválido tras remux MKV');
    cleanupOriginal(absPath, outputPath);
    return { publicPath: toPublicPath(outputPath), mode: 'ready' };
  }

  if (await canStreamCopy(absPath)) {
    await remuxToMp4(absPath, outputPath, true);
    if (!isValidVideoFile(outputPath)) throw new Error('MP4 inválido tras remux');
    cleanupOriginal(absPath, outputPath);
    return { publicPath, mode: 'ready' };
  }

  const promise = remuxToMp4(absPath, outputPath, false)
    .then(() => {
      if (!isValidVideoFile(outputPath)) throw new Error('MP4 inválido tras transcode');
      cleanupOriginal(absPath, outputPath);
    });

  return { publicPath: toPublicPath(absPath), mode: 'background', promise, keepMkv: true };
}

function updateVideoPath(table, id, publicPath) {
  const db = require('../db');
  db.prepare(`UPDATE ${table} SET video_path = ? WHERE id = ?`).run(publicPath, id);
}

function applyVideoPrepResult(prep, id, kind, currentPublicPath) {
  const table = kind === 'movie' ? 'movies' : 'episodes';
  if (prep.mode === 'ready') {
    updateVideoPath(table, id, prep.publicPath);
    return { publicPath: prep.publicPath, processing: false };
  }
  const mp4Target = prep.publicPath;
  prep.promise
    .then(() => {
      const absMp4 = path.join(DATA, mp4Target.replace(/^\/uploads\//, ''));
      if (!isValidVideoFile(absMp4)) {
        console.warn('[videoPrep] MP4 no válido, se mantiene MKV:', currentPublicPath);
        return;
      }
      updateVideoPath(table, id, mp4Target);
      try {
        const { clearPrepJob } = require('./vodDownloadProgress');
        clearPrepJob(id);
      } catch { /* ignore */ }
      console.log('[videoPrep] Transcodificado:', mp4Target);
    })
    .catch((err) => console.error('[videoPrep] Error en segundo plano:', err.message));
  return { publicPath: currentPublicPath, processing: true };
}

function scheduleVideoPrep(absPath, id, kind) {
  prepareUploadedVideo(absPath)
    .then((prep) => applyVideoPrepResult(prep, id, kind))
    .catch((err) => console.error('[videoPrep] Error:', err.message));
}

/** Convierte MKV → MP4 (remux rápido) para reproducción en app/TV. */
async function ensureMovieMp4(movieId) {
  const db = require('../db');
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(movieId);
  if (!movie?.video_path) return { skipped: true, reason: 'no_movie' };

  const base = movie.video_path.split('?')[0];
  if (!/\.mkv$/i.test(base)) return { skipped: true, reason: 'not_mkv' };

  const mp4Path = base.replace(/\.mkv$/i, '.mp4');
  const mkvAbs = path.join(DATA, base.replace(/^\/uploads\//, ''));
  const mp4Abs = path.join(DATA, mp4Path.replace(/^\/uploads\//, ''));
  const mkvDur = isValidVideoFile(mkvAbs) ? getMediaDurationSec(mkvAbs) : 0;
  const mp4Dur = isValidVideoFile(mp4Abs) ? getMediaDurationSec(mp4Abs) : 0;
  if (isValidVideoFile(mp4Abs) && mp4Dur > 0 && mp4Dur < 300 && mkvDur > mp4Dur + 60) {
    try { fs.unlinkSync(mp4Abs); } catch { /* ignore */ }
  } else if (isValidVideoFile(mp4Abs)) {
    if (movie.video_path !== mp4Path) {
      db.prepare('UPDATE movies SET video_path = ? WHERE id = ?').run(mp4Path, movieId);
    }
    try {
      const { clearPrepJob } = require('./vodDownloadProgress');
      clearPrepJob(movieId);
    } catch { /* ignore */ }
    return { ok: true, publicPath: mp4Path, existed: true };
  }

  if (!isValidVideoFile(mkvAbs)) return { ok: false, error: 'mkv_invalid' };

  const { registerPrepJob, clearPrepJob } = require('./vodDownloadProgress');
  registerPrepJob(movieId, { status: 'converting', format: 'mp4', source: path.basename(mkvAbs) });

  try {
    const prep = await prepareUploadedVideo(mkvAbs);
    const applied = applyVideoPrepResult(prep, movieId, 'movie', base);
    if (prep.mode === 'ready') clearPrepJob(movieId);
    return { ok: true, publicPath: applied.publicPath, mode: prep.mode };
  } catch (e) {
    clearPrepJob(movieId);
    return { ok: false, error: e.message };
  }
}

function listMoviesNeedingMp4(limit = 3) {
  const db = require('../db');
  return db.prepare(`
    SELECT id, title, video_path FROM movies
    WHERE COALESCE(available, 1) = 1
      AND video_path LIKE '%.mkv'
      AND video_path LIKE '/uploads/movies/%'
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  prepareUploadedVideo,
  scheduleVideoPrep,
  applyVideoPrepResult,
  ensureMovieMp4,
  listMoviesNeedingMp4,
  getMediaDurationSec,
  isValidVideoFile,
  toPublicPath,
  canStreamCopy,
  outputPathFor
};
