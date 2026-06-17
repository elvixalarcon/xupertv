const cache = new Map();

export function getCachedAudioBlob(videoId) {
  return cache.get(videoId) || null;
}

export function setCachedAudioBlob(videoId, blobUrl) {
  if (!videoId || !blobUrl) return;
  const prev = cache.get(videoId);
  if (prev && prev !== blobUrl && prev.startsWith('blob:')) {
    URL.revokeObjectURL(prev);
  }
  cache.set(videoId, blobUrl);
}

export function clearAudioCache() {
  for (const url of cache.values()) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
  cache.clear();
}
