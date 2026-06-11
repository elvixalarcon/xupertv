const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');

function heightToQualityLabel(height) {
  const h = parseInt(height, 10) || 0;
  if (h >= 2160) return '4K';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  if (h > 0) return `${h}p`;
  return '';
}

function qualityLabelFromPreset(preset) {
  const map = { max: 'Máxima', '1080': '1080p', '720': '720p', '480': '480p' };
  return map[preset] || preset || '';
}

function absPathFromPublic(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const rel = publicPath.replace(/^\/uploads\//, '').split('?')[0];
  return path.join(DATA, rel);
}

function probeVideoQuality(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return '';
  try {
    const { execSync } = require('child_process');
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 ${JSON.stringify(absPath)}`,
      { encoding: 'utf8', timeout: 12000 }
    );
    const height = parseInt(String(out).trim().split('\n')[0], 10);
    return heightToQualityLabel(height);
  } catch {
    return '';
  }
}

function probeVideoQualityFromPublic(publicPath) {
  return probeVideoQuality(absPathFromPublic(publicPath));
}

module.exports = {
  heightToQualityLabel,
  qualityLabelFromPreset,
  probeVideoQuality,
  probeVideoQualityFromPublic,
  absPathFromPublic
};
