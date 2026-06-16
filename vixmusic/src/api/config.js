import { applySpotifyFromServer } from './spotify';
import { loadAppConfig, getServerUrl } from '../lib/appConfig';
import { httpFetch } from '../lib/http';
import { Capacitor } from '@capacitor/core';

export async function initAppConfig() {
  await loadAppConfig();

  try {
    const base = import.meta.env.BASE_URL || '/';
    const configUrl = Capacitor.isNativePlatform()
      ? `${getServerUrl()}/config.json`
      : `${base}config.json`;
    const res = await httpFetch(configUrl, { cache: 'no-store', timeout: 8000 });
    if (!res.ok) return;
    const j = await res.json();
    const sid = (j.spotify_client_id || '').trim();
    const sec = (j.spotify_client_secret || '').trim();
    applySpotifyFromServer(sid, sec);
    if (sid) localStorage.setItem('spotify_client_id', sid);
    if (sec) localStorage.setItem('spotify_client_secret', sec);
  } catch {
    /* ignore */
  }

  localStorage.removeItem('youtube_api_key');
}

export function getConfigStatus() {
  return { ready: true };
}
