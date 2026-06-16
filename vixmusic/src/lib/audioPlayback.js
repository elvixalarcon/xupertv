import { Capacitor } from '@capacitor/core';
import { getApiBase } from './appConfig';
import { httpGetBlob } from './http';

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

export function resolveStreamPlaybackUrl(cdnUrl) {
  if (!isNativePlayback()) return cdnUrl;
  return getProxiedStreamUrl(cdnUrl);
}

/** Descarga el audio completo y devuelve blob URL (respaldo para segundo plano). */
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
