import { registerPlugin, Capacitor } from '@capacitor/core';

const BackgroundAudio = registerPlugin('BackgroundAudio');

let mediaListener = null;
let playbackListener = null;

export const isNativePlatformPlayer = ['android', 'ios'].includes(Capacitor.getPlatform());
/** @deprecated use isNativePlatformPlayer */
export const isAndroidNativePlayer = isNativePlatformPlayer;

export async function requestPlaybackPermissions() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await BackgroundAudio.requestPermissions();
  } catch {
    /* ignore */
  }
}

function trackPayload(track, playing = true, volume = 1) {
  return {
    title: track?.title || 'VixMusic',
    artist: track?.artist || '',
    imageUrl: track?.image || '',
    playing,
    volume,
  };
}

/** Reproduce con reproductor nativo (ExoPlayer / AVPlayer) — funciona con pantalla apagada. */
export function playNativeStream(track, playUrl, volume = 1) {
  return new Promise((resolve, reject) => {
    let settled = false;
    playbackListener?.remove?.();

    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      playbackListener?.remove?.();
      playbackListener = null;
      ok ? resolve() : reject(err || new Error('No se pudo iniciar la reproducción'));
    };

    const timer = setTimeout(() => finish(false, new Error('Tiempo de espera agotado')), 25000);

    playbackListener = BackgroundAudio.addListener('playbackEvent', (event) => {
      if (event?.type === 'ready' || event?.type === 'playing') finish(true);
      if (event?.type === 'error') finish(false, new Error('Error de reproducción'));
    });

    BackgroundAudio.play({
      ...trackPayload(track, true, volume),
      playUrl,
    }).catch((e) => finish(false, e));
  });
}

export async function getNativePlaybackStatus() {
  if (!isNativePlatformPlayer) return { playing: false, position: 0, duration: 0 };
  try {
    return await BackgroundAudio.getPlaybackStatus();
  } catch {
    return { playing: false, position: 0, duration: 0 };
  }
}

export async function setNativePlaying(playing) {
  if (!isNativePlatformPlayer) return;
  try {
    await BackgroundAudio.setPlaying({ playing });
  } catch {
    /* ignore */
  }
}

export async function setNativeVolume(volume) {
  if (!isNativePlatformPlayer) return;
  try {
    await BackgroundAudio.setVolume({ volume: volume / 100 });
  } catch {
    /* ignore */
  }
}

export async function seekNativePlayback(seconds) {
  if (!isNativePlatformPlayer) return;
  try {
    await BackgroundAudio.seek({ position: seconds });
  } catch {
    /* ignore */
  }
}

export async function startBackgroundPlayback(track, playing = true) {
  if (!Capacitor.isNativePlatform()) return;
  if (isNativePlatformPlayer) return;
  try {
    await BackgroundAudio.start(trackPayload(track, playing));
  } catch {
    /* ignore */
  }
}

export async function updateBackgroundPlayback(track, playing = true) {
  if (!Capacitor.isNativePlatform() || !track) return;
  if (isNativePlatformPlayer) {
    await setNativePlaying(playing);
    return;
  }
  try {
    if (BackgroundAudio.update) {
      await BackgroundAudio.update(trackPayload(track, playing));
    } else {
      await BackgroundAudio.start(trackPayload(track, playing));
    }
  } catch {
    /* ignore */
  }
}

export async function stopBackgroundPlayback() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await BackgroundAudio.stop();
  } catch {
    /* ignore */
  }
}

export function onBackgroundMediaAction(handler) {
  if (!Capacitor.isNativePlatform()) return () => {};
  mediaListener?.remove?.();
  mediaListener = BackgroundAudio.addListener('mediaAction', (event) => {
    handler?.(event?.action);
  });
  return () => {
    mediaListener?.remove?.();
    mediaListener = null;
  };
}

export function onNativePlaybackEvent(handler) {
  if (!isNativePlatformPlayer) return () => {};
  const sub = BackgroundAudio.addListener('playbackEvent', handler);
  return () => sub.remove();
}
