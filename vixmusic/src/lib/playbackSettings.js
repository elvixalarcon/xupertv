const COMPAT_KEY = 'vixmusic_compat_playback';

/** Modo compatible: prueba más versiones hasta que una suene */
export function getCompatPlayback() {
  const v = localStorage.getItem(COMPAT_KEY);
  return v === null ? true : v === '1';
}

export function setCompatPlayback(enabled) {
  localStorage.setItem(COMPAT_KEY, enabled ? '1' : '0');
}
