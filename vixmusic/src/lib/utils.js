export function formatTime(sec) {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}
