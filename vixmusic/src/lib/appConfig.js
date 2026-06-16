import { Capacitor } from '@capacitor/core';

const DEFAULT_SERVER = 'http://5.5.5.8/vixmusic';
const DEFAULT_API = `${DEFAULT_SERVER}/api`;

let cached = null;

export async function loadAppConfig() {
  if (cached) return cached;
  try {
    const base = import.meta.env.BASE_URL || '/';
    const res = await fetch(`${base}app-config.json`, { cache: 'no-store' });
    if (res.ok) {
      cached = await res.json();
      return cached;
    }
  } catch {
    /* ignore */
  }
  cached = { serverUrl: DEFAULT_SERVER, apiUrl: DEFAULT_API };
  return cached;
}

export function getServerUrl() {
  const url = cached?.serverUrl || DEFAULT_SERVER;
  return url.replace(/\/$/, '');
}

export function getApiBase() {
  if (Capacitor.isNativePlatform()) {
    const url = cached?.apiUrl || DEFAULT_API;
    return url.replace(/\/$/, '');
  }
  const base = import.meta.env.BASE_URL || '/';
  return `${base}api`.replace(/([^:]\/)\/+/g, '$1');
}
