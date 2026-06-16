import { getApiBase } from './appConfig';
import { httpFetch } from './http';
import { isNativePlayback } from './audioPlayback';
import { getPipedAudioStreamUrl } from '../api/piped';

const CACHE_TTL_MS = 4 * 60 * 1000;
const streamCache = new Map();

function getCachedStream(videoId) {
  const entry = streamCache.get(videoId);
  if (!entry || Date.now() > entry.exp) {
    streamCache.delete(videoId);
    return null;
  }
  return entry.data;
}

function cacheStream(videoId, data) {
  streamCache.set(videoId, { data, exp: Date.now() + CACHE_TTL_MS });
}

async function resolveViaServerApi(ids) {
  const seen = new Set();
  let lastErr;

  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const cached = getCachedStream(id);
    if (cached) return cached;

    try {
      const api = getApiBase();
      const res = await httpFetch(
        `${api}/resolve-audio?id=${encodeURIComponent(id)}`,
        { responseType: 'json', timeout: 45000 },
      );
      const data = await res.json();
      if (data?.ok && data?.url) {
        const result = {
          url: data.url,
          videoId: data.videoId || id,
          mimeType: data.mimeType || 'audio/mp4',
        };
        cacheStream(id, result);
        return result;
      }
      if (data?.error) throw new Error(data.error);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('No se pudo obtener el audio');
}

/** Obtiene URL de audio: servidor directo en apps, Piped + servidor en web. */
export async function resolveAudioStream(videoId, alternateIds = []) {
  const ids = [videoId, ...alternateIds].filter(Boolean);

  if (isNativePlayback()) {
    return resolveViaServerApi(ids);
  }

  let lastErr;
  try {
    const piped = await getPipedAudioStreamUrl(videoId, alternateIds);
    cacheStream(piped.videoId || videoId, piped);
    return piped;
  } catch (e) {
    lastErr = e;
  }

  return resolveViaServerApi(ids);
}
