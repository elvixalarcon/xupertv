import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { httpGetBlob } from './http';
import { openExternalUrl } from './openExternal';

const BackgroundAudio = registerPlugin('BackgroundAudio');
const DISMISS_KEY = 'vixmusic_update_dismissed';

export async function getDismissedUpdateVersion() {
  try {
    const { value } = await Preferences.get({ key: DISMISS_KEY });
    return value || '';
  } catch {
    return '';
  }
}

export async function dismissUpdateVersion(version) {
  try {
    await Preferences.set({ key: DISMISS_KEY, value: String(version) });
  } catch {
    /* ignore */
  }
}

export function isRemoteUpdateAvailable(remote, info) {
  if (!remote?.version) return false;
  const remoteCode = Number(remote.versionCode || remote.build || 0);
  const localCode = Number(info.build || 0);
  if (remoteCode > 0 && localCode > 0 && remoteCode <= localCode) return false;

  const a = String(remote.version).split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(info.version).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return remoteCode > 0 && localCode > 0 && remoteCode > localCode;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function downloadAndInstallApk(url, onProgress) {
  onProgress?.(8, 'Descargando actualización…');
  const blob = await httpGetBlob(url, 300000);
  onProgress?.(62, 'Guardando en el dispositivo…');

  const buffer = new Uint8Array(await blob.arrayBuffer());
  const fileName = 'VixMusic-update.apk';

  try {
    await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache });
  } catch {
    /* no existía */
  }

  await Filesystem.writeFile({
    path: fileName,
    data: bytesToBase64(buffer),
    directory: Directory.Cache,
  });

  onProgress?.(88, 'Abriendo instalador…');
  await BackgroundAudio.installApk({ fileName });
  onProgress?.(100, 'Confirma la instalación en pantalla');
}

export async function startPlatformUpdate(update, onProgress) {
  if (Capacitor.getPlatform() === 'android') {
    await downloadAndInstallApk(update.url, onProgress);
    return;
  }
  onProgress?.(20, 'Abriendo enlace…');
  await openExternalUrl(update.url);
  onProgress?.(100, 'Descarga iniciada');
}
