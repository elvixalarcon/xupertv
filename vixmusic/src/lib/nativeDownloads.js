import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { getOfflineId } from './offlineIds';

const OFFLINE_DIR = 'offline';
const INDEX_PATH = 'offline/index.json';

function safeFileName(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function readIndex() {
  try {
    const res = await Filesystem.readFile({
      path: INDEX_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const list = JSON.parse(res.data);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeIndex(list) {
  await Filesystem.mkdir({
    path: OFFLINE_DIR,
    directory: Directory.Data,
    recursive: true,
  }).catch(() => {});
  await Filesystem.writeFile({
    path: INDEX_PATH,
    data: JSON.stringify(list),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('No se pudo leer el audio'));
        return;
      }
      resolve(dataUrl.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error || new Error('Error al leer audio'));
    reader.readAsDataURL(blob);
  });
}

function extForMime(mime) {
  if (!mime) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  return 'audio';
}

export async function nativeListDownloads() {
  return readIndex();
}

export async function nativeGetDownload(id) {
  const list = await readIndex();
  return list.find((d) => d.id === id) || null;
}

export async function nativeGetDownloadForTrack(track) {
  return nativeGetDownload(getOfflineId(track));
}

export async function nativeIsTrackDownloaded(track) {
  const rec = await nativeGetDownloadForTrack(track);
  return Boolean(rec?.filePath);
}

export async function nativeSaveDownload(track, blob, videoId) {
  const id = getOfflineId(track);
  const mime = blob.type || 'audio/mp4';
  const filePath = `${OFFLINE_DIR}/${safeFileName(id)}.${extForMime(mime)}`;
  const base64 = await blobToBase64(blob);
  if (!base64) throw new Error('Archivo vacío');

  await Filesystem.mkdir({
    path: OFFLINE_DIR,
    directory: Directory.Data,
    recursive: true,
  }).catch(() => {});

  await Filesystem.writeFile({
    path: filePath,
    data: base64,
    directory: Directory.Data,
  });

  const record = {
    id,
    title: track.title,
    artist: track.artist,
    album: track.album || '',
    duration: track.duration || 0,
    image: track.image || '',
    videoId: videoId || track.videoId || '',
    spotifyId: track.spotifyId || '',
    source: track.source || '',
    savedAt: Date.now(),
    filePath,
    mime,
    size: blob.size,
    native: true,
  };

  const list = await readIndex();
  const next = list.filter((d) => d.id !== id);
  next.unshift(record);
  await writeIndex(next);
  return record;
}

export async function nativeRemoveDownload(id) {
  const list = await readIndex();
  const rec = list.find((d) => d.id === id);
  if (rec?.filePath) {
    await Filesystem.deleteFile({
      path: rec.filePath,
      directory: Directory.Data,
    }).catch(() => {});
  }
  await writeIndex(list.filter((d) => d.id !== id));
}

export async function nativeGetPlaybackUrl(record) {
  if (!record?.filePath) return null;
  const { uri } = await Filesystem.getUri({
    path: record.filePath,
    directory: Directory.Data,
  });
  return Capacitor.convertFileSrc(uri);
}

export async function nativeGetDownloadsSize() {
  const list = await readIndex();
  let total = 0;
  for (const item of list) {
    if (item.size) {
      total += item.size;
      continue;
    }
    if (!item.filePath) continue;
    try {
      const stat = await Filesystem.stat({
        path: item.filePath,
        directory: Directory.Data,
      });
      total += stat.size || 0;
    } catch {
      /* ignore */
    }
  }
  return total;
}
