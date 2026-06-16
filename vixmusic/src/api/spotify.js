const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

let clientId = '';
let clientSecret = '';
let tokenCache = { access: '', expires: 0 };

export function getSpotifyClientId() {
  return localStorage.getItem('spotify_client_id') || clientId || '';
}

export function getSpotifyClientSecret() {
  return localStorage.getItem('spotify_client_secret') || clientSecret || '';
}

export function setSpotifyCredentials(id, secret) {
  localStorage.setItem('spotify_client_id', id.trim());
  localStorage.setItem('spotify_client_secret', secret.trim());
  tokenCache = { access: '', expires: 0 };
}

export function isSpotifyConfigured() {
  return getSpotifyClientId() !== '' && getSpotifyClientSecret() !== '';
}

export function applySpotifyFromServer(id, secret) {
  if (id) clientId = id;
  if (secret) clientSecret = secret;
}

function msToLabel(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function getToken() {
  if (!isSpotifyConfigured()) throw new Error('SPOTIFY_CONFIG');
  const now = Date.now();
  if (tokenCache.access && tokenCache.expires > now + 5000) {
    return tokenCache.access;
  }
  const basic = btoa(`${getSpotifyClientId()}:${getSpotifyClientSecret()}`);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || 'Error de Spotify');
  }
  tokenCache = {
    access: data.access_token,
    expires: now + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.access;
}

async function spotifyGet(path, params = {}) {
  const token = await getToken();
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API}${path}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Spotify ${res.status}`);
  }
  return data;
}

export function normalizeSpotifyTrack(item) {
  const img = item.album?.images?.[1]?.url || item.album?.images?.[0]?.url || '';
  const artists = (item.artists || []).map((a) => a.name).join(', ');
  return {
    id: `spotify-${item.id}`,
    spotifyId: item.id,
    videoId: null,
    title: item.name || 'Sin título',
    artist: artists || 'Artista',
    album: item.album?.name || '',
    duration: Math.floor((item.duration_ms || 0) / 1000),
    durationLabel: msToLabel(item.duration_ms || 0),
    image: img,
    source: 'spotify',
    spotifyUrl: item.external_urls?.spotify || '',
  };
}

export async function searchSpotifyTracks(query, limit = 25) {
  const data = await spotifyGet('/search', {
    q: query,
    type: 'track',
    limit: String(Math.min(limit, 50)),
    market: 'MX',
  });
  return (data.tracks?.items || []).map(normalizeSpotifyTrack);
}

export function normalizeSpotifyArtist(item) {
  const img = item.images?.[0]?.url || item.images?.[1]?.url || '';
  return {
    id: item.id,
    spotifyArtistId: item.id,
    name: item.name || 'Artista',
    image: img,
    followers: item.followers?.total || 0,
    genres: item.genres || [],
    source: 'spotify',
  };
}

export async function searchSpotifyArtists(query, limit = 20) {
  const data = await spotifyGet('/search', {
    q: query,
    type: 'artist',
    limit: String(Math.min(limit, 50)),
    market: 'MX',
  });
  return (data.artists?.items || []).map(normalizeSpotifyArtist);
}

export async function getSpotifyArtist(id) {
  const data = await spotifyGet(`/artists/${id}`, {});
  return normalizeSpotifyArtist(data);
}

export async function getSpotifyArtistTopTracks(id, limit = 20) {
  const data = await spotifyGet(`/artists/${id}/top-tracks`, {
    market: 'MX',
  });
  return (data.tracks || []).slice(0, limit).map(normalizeSpotifyTrack);
}

export async function getSpotifyRelatedArtists(id) {
  const data = await spotifyGet(`/artists/${id}/related-artists`, {});
  return (data.artists || []).slice(0, 12).map(normalizeSpotifyArtist);
}

export async function fetchFeaturedArtists(limit = 10) {
  const genres = ['reggaeton', 'latin', 'pop', 'rock', 'salsa'];
  const g = genres[Math.floor(Math.random() * genres.length)];
  return searchSpotifyArtists(`genre:${g}`, limit);
}

export async function fetchSpotifyFeatured(limit = 20) {
  const data = await spotifyGet('/search', {
    q: 'year:2024',
    type: 'track',
    limit: String(limit),
    market: 'MX',
  });
  return (data.tracks?.items || []).map(normalizeSpotifyTrack);
}
