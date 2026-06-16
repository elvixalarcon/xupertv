const INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.darkness.services',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.orangenet.cc',
];

function videoIdFromUrl(url = '') {
  const m = String(url).match(/[?&]v=([^&]+)/) || String(url).match(/\/watch\?v=([^&]+)/);
  if (m) return m[1];
  const short = String(url).match(/\/shorts\/([^/?]+)/);
  return short?.[1] || '';
}

function formatDuration(sec) {
  const s = Number(sec) || 0;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function normalizePipedItem(item) {
  const videoId = videoIdFromUrl(item.url) || item.id || '';
  if (!videoId || item.type !== 'stream') return null;
  const thumb = item.thumbnail || '';
  return {
    id: videoId,
    videoId,
    title: item.title || 'Sin título',
    artist: item.uploaderName || 'YouTube',
    album: '',
    duration: Number(item.duration) || 0,
    durationLabel: formatDuration(item.duration),
    image: thumb,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

export async function pipedSearch(query, maxResults = 25) {
  let lastErr;
  for (const base of INSTANCES) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(query)}&filter=videos`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`Piped ${res.status}`);
      const data = await res.json();
      const items = (data.items || [])
        .map(normalizePipedItem)
        .filter(Boolean)
        .slice(0, maxResults);
      if (items.length) return items;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No hay instancias Piped disponibles');
}

async function fetchStreams(videoId) {
  let lastErr;
  for (const base of INSTANCES) {
    try {
      const res = await fetchWithTimeout(`${base}/streams/${videoId}`, 20000);
      if (!res.ok) throw new Error(`Piped ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.message || data.error);
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No se pudo conectar con el servidor de audio');
}

function pickAudioUrl(streamsData) {
  const audio = [...(streamsData.audioStreams || [])].sort(
    (a, b) => (b.bitrate || 0) - (a.bitrate || 0),
  );
  if (audio[0]?.url) {
    return { url: audio[0].url, mimeType: audio[0].mimeType || 'audio/mp4' };
  }

  const muxed = [...(streamsData.videoStreams || [])]
    .filter((s) => !s.videoOnly && s.url)
    .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
  if (muxed[0]?.url) {
    return { url: muxed[0].url, mimeType: muxed[0].mimeType || 'video/mp4' };
  }
  return null;
}

/** Obtiene URL directa de audio para descargar / offline */
export async function getPipedAudioStreamUrl(videoId, alternateIds = []) {
  const ids = [videoId, ...alternateIds].filter(Boolean);
  const seen = new Set();
  let lastErr;

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const data = await fetchStreams(id);
      const pick = pickAudioUrl(data);
      if (pick) return { ...pick, videoId: id };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('No se pudo obtener el audio para descargar');
}
