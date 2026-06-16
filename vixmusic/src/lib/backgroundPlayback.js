import { registerPlugin, Capacitor } from '@capacitor/core';

const BackgroundAudio = registerPlugin('BackgroundAudio');

export async function requestPlaybackPermissions() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await BackgroundAudio.requestPermissions();
  } catch {
    /* ignore */
  }
}

export async function startBackgroundPlayback(track) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await BackgroundAudio.start({
      title: track?.title || 'VixMusic',
      artist: track?.artist || '',
    });
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
