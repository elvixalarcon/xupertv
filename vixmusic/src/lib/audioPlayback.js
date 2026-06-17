import { Capacitor } from '@capacitor/core';
import { getApiBase } from './appConfig';
import { httpGetBlob } from './http';
import { getCachedAudioBlob, setCachedAudioBlob } from './audioCache';

export const YT_STREAM_HEADERS = {
  Referer: 'https://www.youtube.com/',
  Origin: 'https://www.youtube.com',
};

const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

let unlocked = false;

/** iOS/Android exigen gesto de usuario; desbloquea el elemento Audio al primer toque. */
export function unlockAudioElement(audio) {
  if (!audio || unlocked) return;
  unlocked = true;
  const prev = audio.src;
  const prevMuted = audio.muted;
  audio.muted = true;
  audio.src = SILENT_WAV;
  const p = audio.play();
  if (p && typeof p.then === 'function') {
    p.then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = prevMuted;
      if (prev) audio.src = prev;
      else audio.removeAttribute('src');
    }).catch(() => {
      audio.muted = prevMuted;
    });
  }
}

export function isNativePlayback() {
  return Capacitor.isNativePlatform();
}

/** URL reproducible en WebView móvil (proxy con Referer en el servidor). */
export function getProxiedStreamUrl(cdnUrl) {
  const api = getApiBase();
  return `${api}/stream?url=${encodeURIComponent(cdnUrl)}`;
}

export function getServerPlayUrl(videoId, itag = '') {
  const api = getApiBase();
  const q = itag ? `&itag=${encodeURIComponent(itag)}` : '';
  return `${api}/play?id=${encodeURIComponent(videoId)}${q}`;
}

export function resolveStreamPlaybackUrl(cdnUrl) {
  if (!isNativePlayback()) return cdnUrl;
  return getProxiedStreamUrl(cdnUrl);
}

function buildNativeSources(stream) {
  const videoId = stream.videoId;
  if (!videoId) return [];

  const api = getApiBase();
  return [
    { playUrl: getServerPlayUrl(videoId, '140'), mimeType: 'audio/mp4', itag: '140' },
    { playUrl: getServerPlayUrl(videoId, '251'), mimeType: 'audio/webm', itag: '251' },
    { playUrl: getServerPlayUrl(videoId), mimeType: stream.mimeType || 'audio/mp4', itag: stream.itag || 'ba' },
  ];
}

function waitForMediaReady(audio, timeoutMs) {
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('loadeddata', onReady);
      audio.removeEventListener('error', onError);
    };
    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      cleanup();
      ok ? resolve() : reject(err);
    };
    const onReady = () => finish(true);
    const onError = () => finish(false, new Error(mapAudioError(audio)));
    const timer = setTimeout(
      () => finish(false, new Error('Tiempo de espera agotado')),
      timeoutMs,
    );

    audio.addEventListener('canplay', onReady);
    audio.addEventListener('loadeddata', onReady);
    audio.addEventListener('error', onError, { once: true });
  });
}

async function applyAudioSrc(audio, src, { timeoutMs = 8000, autoplay = true } = {}) {
  audio.src = src;
  audio.load();
  await waitForMediaReady(audio, timeoutMs);
  if (autoplay) await audio.play();
}

/** Inicia streaming sin descargar el archivo completo. */
export async function startStreamPlayback(audio, src, { timeoutMs = 8000, autoplay = true } = {}) {
  await applyAudioSrc(audio, src, { timeoutMs, autoplay });
}

async function downloadPlayBlob(playUrl, mimeType) {
  const blob = await httpGetBlob(playUrl, 180000);
  return URL.createObjectURL(new Blob([blob], { type: mimeType || 'audio/mp4' }));
}

/**
 * Reproducción fiable en apps nativas:
 * 1) caché de sesión  2) stream corto  3) descarga vía /api/play
 */
export async function playNativeAudioTrack(audio, stream, { autoplay = true, onPhase } = {}) {
  const videoId = stream.videoId;
  if (!videoId) throw new Error('Sin ID de vídeo');

  const cached = getCachedAudioBlob(videoId);
  if (cached) {
    onPhase?.('cache');
    await applyAudioSrc(audio, cached, { timeoutMs: 6000, autoplay });
    return { mode: 'cache' };
  }

  const sources = buildNativeSources(stream);

  const blobJobs = sources.map((src) =>
    downloadPlayBlob(src.playUrl, src.mimeType).catch(() => null),
  );

  onPhase?.('stream');
  for (const src of sources) {
    try {
      await applyAudioSrc(audio, src.playUrl, { timeoutMs: 2500, autoplay });
      return { mode: 'stream', itag: src.itag };
    } catch {
      audio.removeAttribute('src');
      audio.load();
    }
  }

  onPhase?.('download');
  let lastErr;
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i];
    try {
      let blobUrl = await blobJobs[i];
      if (!blobUrl) {
        blobUrl = await downloadPlayBlob(src.playUrl, src.mimeType);
      }
      setCachedAudioBlob(videoId, blobUrl);
      await applyAudioSrc(audio, blobUrl, { timeoutMs: 12000, autoplay });
      return { mode: 'blob', itag: src.itag };
    } catch (e) {
      lastErr = e;
      audio.removeAttribute('src');
      audio.load();
    }
  }

  throw lastErr || new Error('No se pudo reproducir el audio');
}

/** Descarga el audio completo y devuelve blob URL (respaldo). */
export async function fetchStreamBlobUrl(cdnUrl, mimeType = 'audio/mp4') {
  const attempts = isNativePlayback()
    ? [getProxiedStreamUrl(cdnUrl), cdnUrl]
    : [cdnUrl];
  const headers = isNativePlayback() ? {} : YT_STREAM_HEADERS;
  let lastErr;
  for (const fetchUrl of attempts) {
    try {
      const blob = await httpGetBlob(fetchUrl, 180000, headers);
      return URL.createObjectURL(new Blob([blob], { type: mimeType || 'audio/mp4' }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No se pudo descargar el audio');
}

export function mapAudioError(audio) {
  const code = audio?.error?.code;
  if (code === 1) return 'Reproducción cancelada';
  if (code === 2) return 'Error de red al reproducir';
  if (code === 3) return 'Formato de audio no soportado';
  if (code === 4) return 'Fuente de audio no disponible';
  return 'No se pudo reproducir el audio';
}
