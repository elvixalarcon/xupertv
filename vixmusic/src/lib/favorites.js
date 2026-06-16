const KEY = 'vixmusic_favorites';

export function listFavorites() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function isFavorite(id) {
  return listFavorites().some((t) => t.id === id);
}

export function toggleFavorite(track) {
  const list = listFavorites();
  const idx = list.findIndex((t) => t.id === track.id);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.unshift({ ...track, savedAt: Date.now() });
  }
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

export function removeFavorite(id) {
  const list = listFavorites().filter((t) => t.id !== id);
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}
