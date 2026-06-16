const KEY = 'vixmusic_play_history';
const MAX = 80;

export function listPlayHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addPlayHistory(track) {
  if (!track?.id) return listPlayHistory();
  const item = { ...track, playedAt: Date.now() };
  const list = listPlayHistory().filter((t) => t.id !== track.id);
  list.unshift(item);
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  return list;
}
