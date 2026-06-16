const API_BASE = 'https://api.jamendo.com/v3.0';

export function getClientId() {
  return localStorage.getItem('jamendo_client_id') || '';
}

export function setClientId(id) {
  localStorage.setItem('jamendo_client_id', id.trim());
}

function requireClientId() {
  const id = getClientId();
  if (!id) throw new Error('CONFIG');
  return id;
}

async function jamendoGet(path, params = {}) {
  const client_id = requireClientId();
  const qs = new URLSearchParams({
    client_id,
    format: 'json',
    ...params,
  });
  const res = await fetch(`${API_BASE}${path}?${qs}`);
  if (!res.ok) throw new Error(`Jamendo HTTP ${res.status}`);
  const data = await res.json();
  if (data.headers?.status !== 'success') {
    throw new Error(data.headers?.code_detail || 'Error Jamendo');
  }
  return data;
}

export function normalizeTrack(t) {
  return {
    id: String(t.id),
    title: t.name || 'Sin título',
    artist: t.artist_name || 'Artista desconocido',
    album: t.album_name || '',
    duration: Number(t.duration) || 0,
    image: t.image || t.album_image || '',
    streamUrl: t.audio || '',
    downloadUrl: t.audiodownload || '',
    downloadAllowed: Boolean(t.audiodownload_allowed),
    licenseUrl: t.license_ccurl || '',
    jamendoUrl: t.shareurl || `https://www.jamendo.com/track/${t.id}`,
  };
}

export async function searchTracks(query, limit = 30) {
  const data = await jamendoGet('/tracks/', {
    search: query,
    limit: String(limit),
    include: 'musicinfo',
    audioformat: 'mp32',
    audiodlformat: 'mp32',
  });
  return (data.results || []).map(normalizeTrack);
}

export async function fetchPopular(limit = 24) {
  const data = await jamendoGet('/tracks/', {
    limit: String(limit),
    order: 'popularity_total_desc',
    include: 'musicinfo',
    audioformat: 'mp32',
    audiodlformat: 'mp32',
  });
  return (data.results || []).map(normalizeTrack);
}

export async function fetchFeaturedAlbums(limit = 12) {
  const data = await jamendoGet('/albums/', {
    limit: String(limit),
    order: 'popularity_total_desc',
    imagesize: '200',
  });
  return (data.results || []).map((a) => ({
    id: String(a.id),
    name: a.name,
    artist: a.artist_name,
    image: a.image,
    trackCount: a.tracks || 0,
  }));
}

export async function fetchAlbumTracks(albumId) {
  const data = await jamendoGet('/tracks/', {
    album_id: albumId,
    include: 'musicinfo',
    audioformat: 'mp32',
    audiodlformat: 'mp32',
  });
  return (data.results || []).map(normalizeTrack);
}

export function streamFileUrl(trackId) {
  const client_id = getClientId();
  return `${API_BASE}/tracks/file/?client_id=${encodeURIComponent(client_id)}&id=${trackId}&action=stream`;
}

export function downloadFileUrl(trackId) {
  const client_id = getClientId();
  return `${API_BASE}/tracks/file/?client_id=${encodeURIComponent(client_id)}&id=${trackId}&action=download`;
}
