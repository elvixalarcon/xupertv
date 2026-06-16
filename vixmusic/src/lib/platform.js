import { Capacitor } from '@capacitor/core';

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export function getRouterBasename() {
  return isNativeApp() ? '' : '/vixmusic';
}

export function assetUrl(path) {
  const base = import.meta.env.BASE_URL || '/';
  const p = path.startsWith('/') ? path.slice(1) : path;
  return `${base}${p}`;
}
