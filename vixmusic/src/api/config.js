import { applySpotifyFromServer, setSpotifyCredentials, getSpotifyClientId, getSpotifyClientSecret } from './spotify';

export async function initAppConfig() {
  try {
    const base = import.meta.env.BASE_URL || '/';
    const res = await fetch(`${base}config.json`, { cache: 'no-store' });
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
  return {
    spotify: Boolean(getSpotifyClientId() && getSpotifyClientSecret()),
  };
}

export function saveUserConfig({ spotifyId, spotifySecret }) {
  if (spotifyId?.trim() && spotifySecret?.trim()) {
    setSpotifyCredentials(spotifyId, spotifySecret);
  }
}

export { getSpotifyClientId, getSpotifyClientSecret };
