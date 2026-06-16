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

function recommendedQualityFromHeight(height) {
  const h = parseInt(height, 10) || 0;
  if (h >= 1080) return '1080';
  if (h >= 720) return '720';
  if (h >= 480) return '480';
  return 'max';
}

/** Opciones de descarga según altura máxima detectada en el enlace. */
function availableQualitiesForHeight(maxH) {
  const h = parseInt(maxH, 10) || 0;
  const opts = [];
  if (h >= 2160) opts.push({ value: 'max', label: 'Máxima — 4K / mejor disponible' });
  if (h >= 1080) opts.push({ value: '1080', label: 'Full HD — 1080p' });
  if (h >= 720) opts.push({ value: '720', label: 'HD — 720p' });
  if (h >= 480) opts.push({ value: '480', label: 'SD — 480p' });
  if (!opts.length) {
    opts.push(
      { value: 'max', label: 'Máxima — mejor disponible' },
      { value: '1080', label: 'Full HD — 1080p' },
      { value: '720', label: 'HD — 720p' },
      { value: '480', label: 'SD — 480p' }
    );
  }
  return opts;
}

function buildQualityProbeResult(maxH, embeds = []) {
  const height = parseInt(maxH, 10) || 0;
  return {
    stream_max_height: height,
    stream_quality_label: heightToQualityLabel(height),
    recommended_quality: recommendedQualityFromHeight(height),
    available_qualities: availableQualitiesForHeight(height),
    embeds: embeds.map((e) => ({
      host: e.host,
      type: e.type,
      max_height: e.maxHeight || 0,
      quality_label: heightToQualityLabel(e.maxHeight || 0)
    }))
  };
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
  recommendedQualityFromHeight,
  availableQualitiesForHeight,
  buildQualityProbeResult,
  probeVideoQuality,
  probeVideoQualityFromPublic,
  absPathFromPublic
};
