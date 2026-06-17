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

function normalizeStreamResult(data, fallbackId) {
  if (!data?.url) return null;
  return {
    url: data.url,
    videoId: data.videoId || fallbackId,
    mimeType: data.mimeType || 'audio/mp4',
    itag: data.itag || '',
    sources: Array.isArray(data.sources) ? data.sources : [],
  };
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
      const result = normalizeStreamResult(data, id);
      if (result) {
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

async function resolveViaPiped(ids) {
  const seen = new Set();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const piped = await getPipedAudioStreamUrl(id, []);
      const result = {
        url: piped.url,
        videoId: piped.videoId || id,
        mimeType: piped.mimeType || 'audio/mp4',
        itag: '',
        sources: [{ url: piped.url, mimeType: piped.mimeType || 'audio/mp4', itag: 'piped' }],
      };
      cacheStream(result.videoId, result);
      return result;
    } catch {
      /* siguiente id */
    }
  }
  return null;
}

async function resolveRace(ids) {
  const cached = getCachedStream(ids[0]);
  if (cached) return cached;

  const results = await Promise.allSettled([
    resolveViaServerApi(ids),
    resolveViaPiped(ids),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      cacheStream(result.value.videoId || ids[0], result.value);
      return result.value;
    }
  }

  const errors = results
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message)
    .filter(Boolean);
  throw new Error(errors[0] || 'No se pudo obtener el audio');
}

/** Obtiene URL de audio: servidor + Piped en paralelo. */
export async function resolveAudioStream(videoId, alternateIds = []) {
  const ids = [videoId, ...alternateIds].filter(Boolean);

  if (isNativePlayback()) {
    return resolveRace(ids);
  }

  let lastErr;
  try {
    const piped = await getPipedAudioStreamUrl(videoId, alternateIds);
    const result = {
      url: piped.url,
      videoId: piped.videoId || videoId,
      mimeType: piped.mimeType || 'audio/mp4',
      itag: '',
      sources: [{ url: piped.url, mimeType: piped.mimeType || 'audio/mp4', itag: 'piped' }],
    };
    cacheStream(piped.videoId || videoId, result);
    return result;
  } catch (e) {
    lastErr = e;
  }

  return resolveViaServerApi(ids).catch((e) => {
    throw lastErr || e;
  });
}
