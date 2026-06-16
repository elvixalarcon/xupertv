import { getApiBase } from './appConfig';
import { httpFetch } from './http';
import { getPipedAudioStreamUrl } from '../api/piped';

/** Obtiene URL de audio: Piped primero, yt-dlp en servidor como respaldo. */
export async function resolveAudioStream(videoId, alternateIds = []) {
  const ids = [videoId, ...alternateIds].filter(Boolean);
  let lastErr;

  try {
    return await getPipedAudioStreamUrl(videoId, alternateIds);
  } catch (e) {
    lastErr = e;
  }

  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const api = getApiBase();
      const res = await httpFetch(
        `${api}/resolve-audio?id=${encodeURIComponent(id)}`,
        { responseType: 'json', timeout: 90000 },
      );
      const data = await res.json();
      if (data?.ok && data?.url) {
        return {
          url: data.url,
          videoId: data.videoId || id,
          mimeType: data.mimeType || 'audio/mp4',
        };
      }
      if (data?.error) throw new Error(data.error);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('No se pudo obtener el audio');
}
