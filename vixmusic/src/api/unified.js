import { getCached, setCached } from '../lib/searchCache';
import { searchMusic, enrichDurations, fetchPopularMusic } from './youtube';
import { getCompatPlayback } from '../lib/playbackSettings';
import {
  searchSpotifyTracks,
  fetchSpotifyFeatured,
  isSpotifyConfigured,
  getSpotifyArtist,
  getSpotifyArtistTopTracks,
  getSpotifyRelatedArtists,
  searchSpotifyArtists,
  fetchFeaturedArtists,
} from './spotify';

function normKey(title, artist) {
  return `${(title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(artist || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function tagYoutube(track) {
  return { ...track, source: track.source || 'youtube' };
}

/** Búsqueda unificada: Spotify primero; YouTube solo si hace falta */
export async function unifiedSearch(query, limit = 40) {
  if (isSpotifyConfigured()) {
    try {
      return (await searchSpotifyTracks(query, Math.min(limit, 25))).slice(0, limit);
    } catch {
      /* fallback youtube */
    }
  }

  let youtube = await searchMusic(query, Math.min(limit, 25));
  youtube = youtube.map(tagYoutube);
  youtube = await enrichDurations(youtube).catch(() => youtube);

  const seen = new Set();
  const merged = [];
  for (const t of youtube) {
    const k = normKey(t.title, t.artist);
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(t);
    }
  }
  return merged.slice(0, limit);
}

function cleanSongTitle(title = '') {
  return String(title)
    .replace(/\(official\s*video\)/gi, '')
    .replace(/\(video\s*oficial\)/gi, '')
    .replace(/\(official\s*audio\)/gi, '')
    .replace(/official\s*video/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\|.*$/g, '')
    .replace(/\s+ft\.?\s+.*/gi, '')
    .replace(/\s+feat\.?\s+.*/gi, '')
    .replace(/\s+x\s+.*/gi, '')
    .trim();
}

/** Separa «Artista - Canción» y limpia metadatos de YouTube */
function parseTrackForSearch(track) {
  let rawTitle = String(track?.title || '').trim();
  let rawArtist = String(track?.artist || '').trim();

  const dashInTitle = rawTitle.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashInTitle) {
    const left = dashInTitle[1].trim();
    const right = cleanSongTitle(dashInTitle[2]);
    const leftLooksLikeArtists = /,|&| feat | ft | x /i.test(left) || left.length < 60;
    if (right.length >= 2 && leftLooksLikeArtists) {
      if (!rawArtist || rawArtist === 'YouTube' || /vevo|records|topic/i.test(rawArtist)) {
        rawArtist = left;
      }
      rawTitle = right;
    }
  }

  const title = cleanSongTitle(rawTitle);
  const allArtistsLabel = rawArtist;

  const artists = rawArtist
    .split(/\s*,\s*|\s*&\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+x\s+/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 1 && !/vevo|records|topic|youtube/i.test(a));

  const primaryArtist = artists[0] || rawArtist.split(',')[0]?.trim() || '';

  return { title, artist: primaryArtist, artists, allArtistsLabel };
}

function buildSearchQueries(track, compat) {
  const { title, artist, artists, allArtistsLabel } = parseTrackForSearch(track);
  if (!title) return [];

  const list = artists.length ? artists : [artist].filter(Boolean);
  const queries = new Set();

  for (const a of list) {
    queries.add(`${a} ${title} audio`);
    queries.add(`${a} ${title} topic`);
    queries.add(`${a} ${title}`);
  }

  if (allArtistsLabel && allArtistsLabel !== artist) {
    queries.add(`${allArtistsLabel} ${title} audio`);
    queries.add(`${allArtistsLabel} ${title}`);
  }

  if (list.length > 1) {
    queries.add(`${list.join(' ')} ${title} audio`);
  }

  queries.add(`${title} ${artist} audio`);
  queries.add(`${title} audio`);
  queries.add(`${title} lyric`);
  queries.add(title);

  if (compat) {
    queries.add(`${title} ${list.slice(0, 2).join(' ')}`);
    queries.add(`${artist} ${title} letra`);
  }

  return [...queries].filter((q) => q.trim().length > 2);
}

function isRiskyForEmbed(track) {
  const title = (track?.title || '').toLowerCase();
  const artist = (track?.artist || '').toLowerCase();
  return /official\s*video|video\s*oficial/i.test(title)
    || /\bvevo\b/i.test(artist)
    || /\bvevo\b/i.test(title)
    || /records\b/i.test(artist);
}

function scoreForPlayback(r, track) {
  const rt = (r.title || '').toLowerCase();
  const ra = (r.artist || '').toLowerCase();
  const { title, artist, artists } = parseTrackForSearch(track);
  const titleLc = title.toLowerCase();
  const artistLc = artist.toLowerCase();
  let score = 0;

  if (titleLc && (rt.includes(titleLc) || titleLc.split(' ').filter((w) => w.length > 2).every((w) => rt.includes(w)))) {
    score += 5;
  }
  for (const a of artists) {
    const al = a.toLowerCase();
    if (al && (rt.includes(al) || ra.includes(al))) score += 3;
  }
  if (artistLc && (rt.includes(artistLc) || ra.includes(artistLc))) score += 4;

  if (rt.includes('audio')) score += 8;
  if (rt.includes('lyric')) score += 7;
  if (rt.includes('topic')) score += 7;
  if (rt.includes('provided to youtube')) score += 6;
  if (rt.includes('visualizer')) score += 4;

  if (/official\s*video|video\s*oficial/i.test(rt)) score -= 12;
  if (/\bvevo\b/i.test(ra) || /\bvevo\b/i.test(rt)) score -= 10;
  if (/records\b/i.test(ra)) score -= 6;
  if (rt.includes('cover') || rt.includes('karaoke') || rt.includes('reaction')) score -= 8;
  if (rt.includes('live') && !titleLc.includes('live')) score -= 3;

  return score;
}

function pickBestYoutubeMatch(results, track) {
  if (!results?.length) return null;
  let best = results[0];
  let bestScore = -Infinity;
  for (const r of results) {
    const s = scoreForPlayback(r, track);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return best;
}

function isAudioOnlyResult(r) {
  const t = `${r?.title || ''} ${r?.artist || ''}`.toLowerCase();
  return /audio|lyric|topic|provided to youtube|visualizer/i.test(t)
    && !/official\s*video|video\s*oficial/i.test(t);
}

function filterAudioCandidates(results) {
  const audio = results.filter(isAudioOnlyResult);
  const safe = results.filter((r) => !isRiskyForEmbed(r));
  return audio.length ? audio : safe;
}

/** Para reproducir: busca audio en YouTube/Piped; modo compatible prueba más versiones */
export async function resolveForPlayback(track, excludeIds = [], options = {}) {
  const compat = options.compat ?? getCompatPlayback();
  const exclude = new Set(excludeIds);
  const meta = parseTrackForSearch(track);
  const cacheKey = `resolve:${normKey(meta.title, meta.allArtistsLabel)}`;
  const cached = getCached('playback', cacheKey);
  if (cached?.videoId && !exclude.has(cached.videoId)) {
    return { ...track, ...cached, title: track.title, artist: track.artist };
  }

  const canUseExisting = track?.videoId
    && !exclude.has(track.videoId)
    && (compat || (!isRiskyForEmbed(track) && isAudioOnlyResult(track)));

  if (canUseExisting) {
    return { ...tagYoutube(track), alternateVideoIds: [] };
  }

  const queries = buildSearchQueries(track, compat);
  const seen = new Set(exclude);
  const merged = [];
  const perQuery = compat ? 15 : 12;

  const batches = await Promise.allSettled(
    queries.map((q) => searchMusic(q, perQuery)),
  );

  for (const result of batches) {
    if (result.status !== 'fulfilled') continue;
    for (const r of result.value || []) {
      if (r.videoId && !seen.has(r.videoId)) {
        seen.add(r.videoId);
        merged.push(r);
      }
    }
  }

  if (!merged.length) {
    const label = meta.title || track.title;
    const who = meta.allArtistsLabel || meta.artist;
    throw new Error(who ? `No se encontró «${label}» de ${who}` : `No se encontró «${label}»`);
  }

  const ranked = merged
    .map((r) => ({ r, score: scoreForPlayback(r, track) }))
    .sort((a, b) => b.score - a.score);

  let pool;
  if (compat) {
    pool = ranked.map((x) => x.r);
  } else {
    const audio = filterAudioCandidates(merged);
    pool = audio.length ? audio : ranked.map((x) => x.r);
  }

  const picks = pool.filter((r) => r.videoId && !exclude.has(r.videoId));
  if (!picks.length) {
    const label = meta.title || track.title;
    throw new Error(`No se encontró «${label}» para reproducir`);
  }

  const pick = pickBestYoutubeMatch(picks, track) || picks[0];
  const alternateVideoIds = picks
    .filter((r) => r.videoId !== pick.videoId)
    .map((r) => r.videoId)
    .slice(0, compat ? 14 : 5);

  const resolved = {
    ...track,
    ...pick,
    title: track.title,
    artist: track.artist,
    album: track.album || pick.album,
    image: track.image || pick.image,
    source: track.source === 'spotify' ? 'spotify' : 'youtube',
    videoId: pick.videoId,
    id: track.id || pick.id,
    spotifyId: track.spotifyId,
    alternateVideoIds,
  };

  setCached('playback', cacheKey, {
    videoId: pick.videoId,
    alternateVideoIds,
    image: resolved.image,
    youtubeUrl: pick.youtubeUrl,
  });

  return resolved;
}

export async function fetchUnifiedHome(limit = 18) {
  if (isSpotifyConfigured()) {
    try {
      return (await fetchSpotifyFeatured(Math.min(limit, 18))).slice(0, limit);
    } catch {
      /* fallback youtube */
    }
  }

  const youtube = (await fetchPopularMusic(limit).catch(() => [])).map(tagYoutube);
  if (!youtube.length) throw new Error('No hay contenido disponible ahora');
  return youtube.slice(0, limit);
}

export { isSpotifyConfigured, cleanSongTitle, parseTrackForSearch };

export async function fetchHomeArtists(limit = 8) {
  if (isSpotifyConfigured()) {
    try {
      return await fetchFeaturedArtists(limit);
    } catch {
      /* fallback */
    }
  }
  const yt = await searchMusic('artistas música latina', limit);
  return yt.map((t) => ({
    id: `yt-${encodeURIComponent(t.artist)}`,
    name: t.artist,
    image: t.image,
    source: 'youtube',
  }));
}

/** Carga página de artista: metadata + canciones populares */
export async function loadArtistPage(artistKey) {
  if (artistKey.startsWith('yt-')) {
    const name = decodeURIComponent(artistKey.slice(3));
    let tracks = await searchMusic(`${name} audio`, 25);
    tracks = tracks.map(tagYoutube);
    return {
      artist: { id: artistKey, name, image: tracks[0]?.image || '', source: 'youtube' },
      tracks,
      related: [],
    };
  }

  if (!isSpotifyConfigured()) throw new Error('SPOTIFY_CONFIG');

  const [artist, tracks, related] = await Promise.all([
    getSpotifyArtist(artistKey),
    getSpotifyArtistTopTracks(artistKey, 25),
    getSpotifyRelatedArtists(artistKey).catch(() => []),
  ]);

  return { artist, tracks, related };
}

/** Más canciones para modo radio (mismo artista + similares) */
export async function fetchRadioMoreTracks(artistName, spotifyArtistId, excludeKeys = []) {
  const seen = new Set(excludeKeys);
  const out = [];

  if (spotifyArtistId && isSpotifyConfigured()) {
    try {
      const top = await getSpotifyArtistTopTracks(spotifyArtistId, 20);
      for (const t of top) {
        const k = normKey(t.title, t.artist);
        if (!seen.has(k)) { seen.add(k); out.push(t); }
      }
      const rel = await getSpotifyRelatedArtists(spotifyArtistId);
      for (const a of rel.slice(0, 3)) {
        const more = await getSpotifyArtistTopTracks(a.id, 5);
        for (const t of more) {
          const k = normKey(t.title, t.artist);
          if (!seen.has(k)) { seen.add(k); out.push(t); }
        }
      }
    } catch {
      /* fallback youtube */
    }
  }

  if (out.length < 5) {
    const yt = await searchMusic(`${artistName} música`, 15);
    const enriched = await enrichDurations(yt).catch(() => yt);
    for (const t of enriched.map(tagYoutube)) {
      const k = normKey(t.title, t.artist);
      if (!seen.has(k)) { seen.add(k); out.push(t); }
    }
  }

  return out;
}

export async function searchArtistsUnified(query, limit = 20) {
  if (isSpotifyConfigured()) {
    return searchSpotifyArtists(query, limit);
  }
  const yt = await searchMusic(query, limit);
  const seen = new Set();
  const artists = [];
  for (const t of yt) {
    if (!seen.has(t.artist)) {
      seen.add(t.artist);
      artists.push({
        id: `yt-${encodeURIComponent(t.artist)}`,
        name: t.artist,
        image: t.image,
        source: 'youtube',
      });
    }
  }
  return artists;
}

/** Hub de búsqueda estilo Spotify al buscar un artista */
export async function loadArtistSearchHub(query) {
  const q = query.trim();
  if (!q) throw new Error('QUERY');

  let artist = null;
  let songs = [];
  let videos = [];
  let artists = [];
  let playlists = [];

  if (isSpotifyConfigured()) {
    const [artistList, trackList] = await Promise.all([
      searchSpotifyArtists(q, 8).catch(() => []),
      searchSpotifyTracks(q, 25).catch(() => []),
    ]);

    artists = artistList;
    songs = trackList;

    if (artistList.length) {
      const exact = artistList.find((a) => a.name.toLowerCase() === q.toLowerCase());
      const match = exact || artistList[0];
      artist = match;

      try {
        const [top, related] = await Promise.all([
          getSpotifyArtistTopTracks(match.id, 20),
          getSpotifyRelatedArtists(match.id).catch(() => []),
        ]);
        if (top.length) songs = top;

        playlists = [
          {
            id: `this-is-${match.id}`,
            title: `This Is ${match.name}`,
            subtitle: 'Playlist • VixMusic',
            image: match.image,
            mode: 'play',
          },
          {
            id: `radio-${match.id}`,
            title: `Radio de ${match.name}`,
            subtitle: 'Playlist • VixMusic',
            image: match.image,
            mode: 'radio',
          },
          ...related.slice(0, 6).map((a) => ({
            id: a.id,
            title: a.name,
            subtitle: 'Artista',
            image: a.image,
            mode: 'artist',
            artistId: a.id,
          })),
        ];
      } catch {
        /* usa trackList */
      }
    }

    if (!artist && artistList.length) {
      artist = artistList[0];
    }
  }

  if (!isSpotifyConfigured() || (!songs.length && !artist)) {
    const [ytTracks, artistList] = await Promise.all([
      searchMusic(`${q} audio`, 20).catch(() => []),
      searchArtistsUnified(q, 8).catch(() => []),
    ]);

    if (!artists.length) artists = artistList;
    videos = ytTracks.map((t) => ({ ...tagYoutube(t), isVideo: true }));
    if (!songs.length) songs = ytTracks.map(tagYoutube);
  }

  if (!artist) {
    artist = {
      id: `yt-${encodeURIComponent(q)}`,
      name: q,
      image: songs[0]?.image || videos[0]?.image || '',
      source: isSpotifyConfigured() ? 'spotify' : 'youtube',
    };
  }

  if (!playlists.length) {
    playlists = [
      {
        id: 'radio-yt',
        title: `Radio de ${artist.name || q}`,
        subtitle: 'Playlist • VixMusic',
        image: artist.image,
        mode: 'radio',
      },
    ];
  }

  const seen = new Set();
  const mergedSongs = [];
  for (const t of songs) {
    const k = normKey(t.title, t.artist);
    if (!seen.has(k)) {
      seen.add(k);
      mergedSongs.push(t);
    }
  }
  songs = mergedSongs.slice(0, 25);

  if (!videos.length) {
    videos = songs
      .filter((t) => t.videoId)
      .map((t) => ({ ...t, isVideo: true }))
      .slice(0, 12);
  }

  return { artist, songs, videos, artists, playlists, query: q };
}
