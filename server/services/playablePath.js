const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA = path.join(__dirname, '..', '..', 'data');

function absFromPublic(videoPath) {
  const rel = String(videoPath || '').split('?')[0].replace(/^\/uploads\//, '');
  return path.join(DATA, rel);
}

function probeContainerFormat(fullPath) {
  try {
    const fmt = execSync(
      `ffprobe -v error -show_entries format=format_name -of csv=p=0 ${JSON.stringify(fullPath)}`,
      { encoding: 'utf8', timeout: 15000 }
    ).trim().toLowerCase();
    return fmt;
  } catch {
    return '';
  }
}

function isRealMp4Container(fullPath) {
  const fmt = probeContainerFormat(fullPath);
  if (!fmt) return false;
  if (fmt.includes('mpegts') || fmt === 'mpeg-ts' || fmt === 'ts') return false;
  return fmt.includes('mov') || fmt.includes('mp4') || fmt.includes('m4v') || fmt.includes('3gp');
}

function isValidMediaFile(fullPath) {
  if (!fullPath || !fs.existsSync(fullPath)) return false;
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size < 5 * 1024 * 1024) return false;
    execSync(`ffprobe -v error -i ${JSON.stringify(fullPath)}`, {
      stdio: 'pipe',
      timeout: 15000
    });
    if (/\.mp4$/i.test(fullPath) && !isRealMp4Container(fullPath)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Elige la ruta reproducible: MP4 solo si es válido; si no, MKV original.
 */
function resolvePlayablePath(videoPath) {
  if (!videoPath || !videoPath.startsWith('/uploads/')) return videoPath;

  const base = videoPath.split('?')[0];
  const full = absFromPublic(base);

  if (/\.mp4$/i.test(base)) {
    if (isValidMediaFile(full)) return base;
    const mkvPath = base.replace(/\.mp4$/i, '.mkv');
    const mkvFull = absFromPublic(mkvPath);
    if (isValidMediaFile(mkvFull)) return mkvPath;
    return base;
  }

  if (/\.mkv$/i.test(base)) {
    const mp4Path = base.replace(/\.mkv$/i, '.mp4');
    const mp4Full = absFromPublic(mp4Path);
    if (isValidMediaFile(mp4Full)) return mp4Path;
    if (isValidMediaFile(full)) return base;
    return base;
  }

  if (isValidMediaFile(full)) return base;
  return base;
}

function resolveSubtitlePath(videoPath, explicitPath = '') {
  if (explicitPath && String(explicitPath).trim()) {
    return explicitPath.startsWith('/') ? explicitPath : `/${explicitPath}`;
  }
  if (!videoPath || !videoPath.startsWith('/uploads/')) return '';
  const base = videoPath.split('?')[0].replace(/\.[^.]+$/, '');
  for (const ext of ['.vtt', '.srt', '.es.vtt', '.spa.vtt']) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(absFromPublic(candidate))) return candidate;
  }
  return '';
}

module.exports = { resolvePlayablePath, resolveSubtitlePath, isValidMediaFile, absFromPublic };
