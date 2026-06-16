import { looksLikePodcast } from '../api/unified';
import { searchMusic } from '../api/youtube';

function normArtist(name = '') {
  return String(name).trim().toLowerCase();
}

function isMusicTrack(track) {
  return track?.id && !looksLikePodcast(track);
}

function dedupeTracks(tracks, seen = new Set()) {
  const out = [];
  for (const track of tracks) {
    if (!track?.id || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

function scoreArtists(favorites, history) {
  const scores = new Map();
  for (const track of favorites) {
    const artist = normArtist(track.artist);
    if (!artist) continue;
    scores.set(artist, (scores.get(artist) || 0) + 3);
  }
  for (const track of history) {
    const artist = normArtist(track.artist);
    if (!artist) continue;
    scores.set(artist, (scores.get(artist) || 0) + 1);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

function extractArtists(favorites, history, topArtists, limit = 10) {
  const order = new Map(topArtists.map((name, index) => [name, index]));
  const seen = new Set();
  const artists = [];

  for (const track of [...favorites, ...history]) {
    const name = String(track.artist || '').trim();
    const key = normArtist(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    artists.push({
      id: track.spotifyArtistId || `artist-${encodeURIComponent(name)}`,
      name,
      image: track.artistImage || track.image || '',
      spotifyId: track.spotifyArtistId || null,
      source: track.source || 'youtube',
    });
  }

  artists.sort((a, b) => {
    const ai = order.get(normArtist(a.name)) ?? 99;
    const bi = order.get(normArtist(b.name)) ?? 99;
    return ai - bi;
  });

  return artists.slice(0, limit);
}

function buildForYou(favorites, history, topArtists) {
  const favIds = new Set(favorites.map((t) => t.id));
  const topSet = new Set(topArtists);
  const items = [];

  for (const track of history) {
    if (items.length >= 12) break;
    if (topSet.has(normArtist(track.artist)) && !favIds.has(track.id)) {
      items.push(track);
    }
  }

  for (const track of favorites) {
    if (items.length >= 12) break;
    if (!items.some((t) => t.id === track.id)) items.push(track);
  }

  for (const track of history) {
    if (items.length >= 12) break;
    if (!items.some((t) => t.id === track.id)) items.push(track);
  }

  return items;
}

function buildHint(topArtists, hasTaste) {
  if (!hasTaste) return 'Marca canciones con ♥ y escucha música para personalizar';
  if (topArtists.length === 1) return `Basado en ${topArtists[0]}`;
  if (topArtists.length >= 2) return `Basado en ${topArtists[0]} y ${topArtists[1]}`;
  return 'Basado en tus gustos';
}

/** Construye secciones de inicio únicas por usuario a partir de favoritos e historial. */
export function buildPersonalizedHome({ favorites = [], history = [], exploreTracks = [] }) {
  const favs = favorites.filter(isMusicTrack);
  const hist = history.filter(isMusicTrack);
  const topArtists = scoreArtists(favs, hist);
  const hasTaste = favs.length > 0 || hist.length > 0;

  const recent = dedupeTracks(hist).slice(0, 12);
  const favoriteItems = dedupeTracks(favs).slice(0, 12);
  const quick = dedupeTracks([...hist.slice(0, 4), ...favs.slice(0, 6)]).slice(0, 8);
  const forYou = buildForYou(favs, hist, topArtists);
  const artists = extractArtists(favs, hist, topArtists, 10);

  const albumMap = new Map();
  for (const track of favs) {
    const album = String(track.album || '').trim();
    if (!album) continue;
    const key = `${album}|${normArtist(track.artist)}`;
    if (!albumMap.has(key)) albumMap.set(key, track);
  }
  const albums = [...albumMap.values()].slice(0, 12);

  const usedIds = new Set(
    [...recent, ...quick, ...forYou, ...favoriteItems, ...albums].map((t) => t.id),
  );
  const explore = exploreTracks.filter((t) => !usedIds.has(t.id)).slice(0, 14);

  const sections = [];

  if (recent.length >= 2) {
    sections.push({ id: 'recent', title: 'Escuchado recientemente', type: 'tracks', items: recent });
  }
  if (quick.length >= 4) {
    sections.push({ id: 'quick', title: 'Acceso rápido', type: 'quick', items: quick });
  }
  if (forYou.length >= 2) {
    sections.push({
      id: 'for_you',
      title: 'Hecho para ti',
      type: 'tracks',
      items: forYou,
      hint: buildHint(topArtists, hasTaste),
    });
  }
  if (artists.length >= 2) {
    sections.push({
      id: 'artists',
      title: 'Tus artistas favoritos',
      type: 'artists',
      artists,
    });
  }
  if (albums.length >= 2) {
    sections.push({
      id: 'albums',
      title: 'Álbumes que te gustan',
      type: 'tracks',
      items: albums,
    });
  }
  if (favoriteItems.length >= 2) {
    sections.push({
      id: 'favorites',
      title: 'Tus favoritos',
      type: 'tracks',
      items: favoriteItems,
    });
  }
  if (explore.length > 0) {
    sections.push({
      id: 'explore',
      title: hasTaste ? 'Explorar novedades' : 'Populares',
      type: 'tracks',
      items: explore,
    });
  }

  return { sections, hasTaste, topArtists };
}

/** Descubre canciones nuevas según los artistas que más escucha el usuario. */
export async function discoverFromTopArtists(topArtists, existingIds, limit = 8) {
  const seen = new Set(existingIds);
  const found = [];

  for (const artist of topArtists.slice(0, 3)) {
    if (found.length >= limit) break;
    try {
      const results = await searchMusic(`${artist} audio`, 8);
      for (const track of results) {
        if (found.length >= limit) break;
        if (!track?.id || seen.has(track.id)) continue;
        seen.add(track.id);
        found.push({ ...track, source: track.source || 'youtube' });
      }
    } catch {
      /* siguiente artista */
    }
  }

  return found;
}
