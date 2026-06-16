import { getOfflineId } from './offlineIds';
import { isNativeApp } from './platform';
import {
  nativeGetDownload,
  nativeGetDownloadForTrack,
  nativeGetDownloadsSize,
  nativeGetPlaybackUrl,
  nativeIsTrackDownloaded,
  nativeListDownloads,
  nativeRemoveDownload,
  nativeSaveDownload,
} from './nativeDownloads';

const DB_NAME = 'vixmusic';
const DB_VER = 1;
const STORE = 'tracks';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function webListDownloads() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function webGetDownload(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function webSaveDownload(track, blob, videoId) {
  const id = getOfflineId(track);
  const db = await openDb();
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
    blob,
    size: blob.size,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

async function webRemoveDownload(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function webGetDownloadsSize() {
  const items = await webListDownloads();
  return items.reduce((n, t) => n + (t.blob?.size || t.size || 0), 0);
}

export async function listDownloads() {
  if (isNativeApp()) return nativeListDownloads();
  return webListDownloads();
}

export async function getDownload(id) {
  if (isNativeApp()) return nativeGetDownload(id);
  return webGetDownload(id);
}

export async function getDownloadForTrack(track) {
  if (isNativeApp()) return nativeGetDownloadForTrack(track);
  return webGetDownload(getOfflineId(track));
}

export async function isTrackDownloaded(track) {
  if (isNativeApp()) return nativeIsTrackDownloaded(track);
  const rec = await getDownloadForTrack(track);
  return Boolean(rec?.blob);
}

export async function saveDownload(track, blob, videoId) {
  if (isNativeApp()) return nativeSaveDownload(track, blob, videoId);
  return webSaveDownload(track, blob, videoId);
}

export async function removeDownload(id) {
  if (isNativeApp()) return nativeRemoveDownload(id);
  return webRemoveDownload(id);
}

export async function removeDownloadForTrack(track) {
  return removeDownload(getOfflineId(track));
}

export function blobUrl(record) {
  if (!record?.blob) return null;
  return URL.createObjectURL(record.blob);
}

export async function getPlaybackUrl(record) {
  if (!record) return null;
  if (isNativeApp() && record.filePath) {
    return nativeGetPlaybackUrl(record);
  }
  return blobUrl(record);
}

export function hasOfflineAudio(record) {
  return Boolean(record?.blob || record?.filePath);
}

export async function getDownloadsSize() {
  if (isNativeApp()) return nativeGetDownloadsSize();
  return webGetDownloadsSize();
}

export function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}
