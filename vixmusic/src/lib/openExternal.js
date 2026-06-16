import { Capacitor, registerPlugin } from '@capacitor/core';

const BackgroundAudio = registerPlugin('BackgroundAudio');

/** Abre URL en navegador/descargador del sistema (APK, IPA, etc.). */
export async function openExternalUrl(url) {
  if (!url) return;

  if (Capacitor.getPlatform() === 'android') {
    await BackgroundAudio.openUrl({ url });
    return;
  }

  if (Capacitor.isNativePlatform()) {
    const opened = window.open(url, '_blank');
    if (!opened) window.location.assign(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
