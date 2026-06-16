import { getApiBase } from '../lib/appConfig';
import { httpFetch } from '../lib/http';

const TOKEN_KEY = 'vixmusic_auth_token';

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAuthToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await httpFetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
    responseType: 'json',
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: 'Respuesta inválida del servidor' };
  }

  if (!data || typeof data !== 'object') {
    data = { ok: false, error: 'El servidor no respondió correctamente' };
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const vixApi = {
  health: () => request('/health'),
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request('/auth/me'),
  updateProfile: (body) => request('/auth/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (body) => request('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }),
  listFavorites: () => request('/favorites'),
  addFavorite: (track) => request('/favorites', { method: 'POST', body: JSON.stringify({ track }) }),
  removeFavorite: (id) => request(`/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  syncFavorites: (tracks) => request('/favorites/sync', { method: 'POST', body: JSON.stringify({ tracks }) }),
  listPlaylists: () => request('/playlists'),
  createPlaylist: (body) => request('/playlists', { method: 'POST', body: JSON.stringify(body) }),
  getPlaylist: (id) => request(`/playlists/${id}`),
  updatePlaylist: (id, body) => request(`/playlists/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deletePlaylist: (id) => request(`/playlists/${id}`, { method: 'DELETE' }),
  addPlaylistTrack: (id, track) => request(`/playlists/${id}/tracks`, { method: 'POST', body: JSON.stringify({ track }) }),
  removePlaylistTrack: (id, trackId) => request(`/playlists/${id}/tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' }),
  addHistory: (track) => request('/history', { method: 'POST', body: JSON.stringify({ track }) }),
  recommendations: () => request('/recommendations'),
  adminUsers: () => request('/admin/users'),
  adminCreateUser: (body) => request('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  adminUpdateUser: (id, body) => request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  adminDeleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  adminSettings: () => request('/admin/settings'),
  adminPatchSettings: (body) => request('/admin/settings', { method: 'PATCH', body: JSON.stringify(body) }),
};
