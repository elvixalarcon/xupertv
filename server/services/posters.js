const https = require('https');
const http = require('http');
const { getTmdbApiKey } = require('./settings');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'VixTV/1.0', Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function posterCoverUrl(title, year = '') {
  const params = new URLSearchParams({ title: title || 'Película', year: String(year || '') });
  return `/api/posters/cover?${params}`;
}

function posterCoverJpegUrl(title, year = '') {
  const params = new URLSearchParams({ title: title || 'Película', year: String(year || '') });
  return `/api/posters/cover.jpg?${params}`;
}

function isPlaceholderPoster(poster) {
  const p = String(poster || '').trim();
  if (!p) return true;
  return p.includes('/api/posters/cover');
}

function absolutePosterUrl(poster, serverBase = '') {
  const p = String(poster || '').trim();
  if (!p || isPlaceholderPoster(p)) return '';
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  if (!serverBase) return '';
  return p.startsWith('/') ? `${serverBase}${p}` : `${serverBase}/${p}`;
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapCoverTitle(title, maxLen = 22) {
  const words = String(title || 'Película').split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxLen && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function buildCoverSvg(title, year = '') {
  const lines = wrapCoverTitle(title);
  const hash = String(title || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = hash % 360;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:hsl(${hue},45%,18%)"/>
      <stop offset="100%" style="stop-color:hsl(${(hue + 40) % 360},55%,28%)"/>
    </linearGradient>
    <linearGradient id="shine" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.12"/>
      <stop offset="100%" style="stop-color:#ffffff;stop-opacity:0"/>
    </linearGradient>
  </defs>
  <rect width="300" height="450" fill="url(#bg)"/>
  <rect width="300" height="450" fill="url(#shine)"/>
  <rect x="20" y="20" width="260" height="410" rx="8" fill="none" stroke="#f5c518" stroke-opacity="0.25" stroke-width="2"/>
  <text x="150" y="180" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" fill="#f5c518" opacity="0.9">🎬</text>
  ${lines.map((l, i) => `<text x="150" y="${240 + i * 32}" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="#ffffff">${escapeXml(l)}</text>`).join('\n  ')}
  ${year ? `<text x="150" y="400" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#f5c518" opacity="0.85">${escapeXml(year)}</text>` : ''}
  <text x="150" y="430" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#8888aa">Vix TV</text>
</svg>`;
}

function movieSearchQueries(title) {
  const t = String(title || '').trim();
  const queries = [t];
  const beforeColon = t.split(':')[0].trim();
  if (beforeColon && beforeColon !== t) queries.push(beforeColon);
  const beforeParen = t.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (beforeParen && !queries.includes(beforeParen)) queries.push(beforeParen);
  return [...new Set(queries)];
}

async function searchTmdbMovie(title, year) {
  const key = getTmdbApiKey();
  if (!key) return null;
  for (const query of movieSearchQueries(title)) {
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(query)}&language=es-MX`;
    if (year) url += `&primary_release_year=${year}`;
    const data = await fetchJson(url);
    const hit = data.results?.find(r => r.poster_path || r.backdrop_path) || data.results?.[0];
    if (hit?.poster_path || hit?.backdrop_path) return hit;
  }
  return null;
}

function pickYoutubeTrailer(videos) {
  const list = (videos?.results || []).filter(v => v.site === 'YouTube');
  const pick = list.find(v => v.type === 'Trailer' && v.official)
    || list.find(v => v.type === 'Trailer')
    || list.find(v => v.type === 'Teaser')
    || list[0];
  return pick?.key || '';
}

async function fetchTmdbMovieDetails(title, year) {
  const key = getTmdbApiKey();
  if (!key) return {};
  try {
    const hit = await searchTmdbMovie(title, year);
    if (!hit) return {};
    const detail = await fetchJson(
      `https://api.themoviedb.org/3/movie/${hit.id}?api_key=${key}&language=es-MX&append_to_response=credits,videos`
    );
    const releaseYear = detail.release_date ? parseInt(detail.release_date.slice(0, 4), 10) : null;
    return {
      tmdb_id: hit.id,
      title: detail.title || detail.original_title || '',
      vote_average: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
      runtime: detail.runtime || null,
      overview: detail.overview || '',
      genres: (detail.genres || []).map(g => g.name),
      cast: (detail.credits?.cast || []).slice(0, 10).map(c => c.name),
      backdrop: detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : '',
      poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '',
      trailer: pickYoutubeTrailer(detail.videos),
      year: releaseYear
    };
  } catch {
    return {};
  }
}

async function fetchTmdbMovieById(tmdbId) {
  const key = getTmdbApiKey();
  if (!key || !tmdbId) return {};
  try {
    const detail = await fetchJson(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&language=es-MX&append_to_response=credits,videos`
    );
    if (!detail?.id) return {};
    const releaseYear = detail.release_date ? parseInt(detail.release_date.slice(0, 4), 10) : null;
    return {
      tmdb_id: detail.id,
      title: detail.title || detail.original_title || '',
      vote_average: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
      runtime: detail.runtime || null,
      overview: detail.overview || '',
      genres: (detail.genres || []).map(g => g.name),
      cast: (detail.credits?.cast || []).slice(0, 10).map(c => c.name),
      backdrop: detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : '',
      poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '',
      trailer: pickYoutubeTrailer(detail.videos),
      year: releaseYear
    };
  } catch {
    return {};
  }
}

/** Solo videos + backdrop (ligero para el hero). */
async function fetchTmdbHeroExtras(tmdbId) {
  const key = getTmdbApiKey();
  if (!key || !tmdbId) return { trailer: '', backdrop: '' };
  try {
    const detail = await fetchJson(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&language=es-MX&append_to_response=videos`
    );
    if (!detail?.id) return { trailer: '', backdrop: '' };
    return {
      trailer: pickYoutubeTrailer(detail.videos),
      backdrop: detail.backdrop_path
        ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}`
        : ''
    };
  } catch {
    return { trailer: '', backdrop: '' };
  }
}

async function fetchTmdbHeroExtrasByTitle(title, year) {
  const hit = await searchTmdbMovie(title, year);
  if (!hit?.id) return { trailer: '', backdrop: '', tmdb_id: null };
  const extras = await fetchTmdbHeroExtras(hit.id);
  return { ...extras, tmdb_id: hit.id };
}

async function fetchTmdbSeriesTrailer(tmdbId) {
  const key = getTmdbApiKey();
  if (!key || !tmdbId) return '';
  try {
    const detail = await fetchJson(
      `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&language=es-MX&append_to_response=videos`
    );
    if (!detail?.id) return '';
    return pickYoutubeTrailer(detail.videos);
  } catch {
    return '';
  }
}

async function fetchTmdbSeriesTrailerByTitle(title) {
  const hit = await searchTmdbSeries(title);
  if (!hit?.id) return { trailer: '', tmdb_id: null };
  return { trailer: await fetchTmdbSeriesTrailer(hit.id), tmdb_id: hit.id };
}

async function fetchTmdbMoviePoster(title, year) {
  const key = getTmdbApiKey();
  if (!key) return '';
  const hit = await searchTmdbMovie(title, year);
  return hit?.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : '';
}

async function searchTmdbSeries(title) {
  const key = getTmdbApiKey();
  if (!key) return null;
  const url = `https://api.themoviedb.org/3/search/tv?api_key=${key}&query=${encodeURIComponent(title)}&language=es-MX`;
  const data = await fetchJson(url);
  return data.results?.find(r => r.poster_path || r.backdrop_path) || data.results?.[0] || null;
}

async function fetchTmdbSeriesDetails(title) {
  const key = getTmdbApiKey();
  if (!key) return {};
  try {
    const hit = await searchTmdbSeries(title);
    if (!hit) return {};
    const detail = await fetchJson(
      `https://api.themoviedb.org/3/tv/${hit.id}?api_key=${key}&language=es-MX&append_to_response=credits,videos`
    );
    const year = detail.first_air_date ? parseInt(detail.first_air_date.slice(0, 4), 10) : null;
    return {
      tmdb_id: hit.id,
      title: detail.name || detail.original_name || '',
      vote_average: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
      overview: detail.overview || '',
      genres: (detail.genres || []).map(g => g.name),
      cast: (detail.credits?.cast || []).slice(0, 10).map(c => c.name),
      backdrop: detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : '',
      poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '',
      trailer: pickYoutubeTrailer(detail.videos),
      seasons: detail.number_of_seasons || null,
      episodes_count: detail.number_of_episodes || null,
      status: detail.status || '',
      year
    };
  } catch {
    return {};
  }
}

async function fetchTmdbSeriesById(tmdbId) {
  const key = getTmdbApiKey();
  if (!key || !tmdbId) return {};
  try {
    const detail = await fetchJson(
      `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&language=es-MX&append_to_response=credits,videos`
    );
    if (!detail?.id) return {};
    const year = detail.first_air_date ? parseInt(detail.first_air_date.slice(0, 4), 10) : null;
    return {
      tmdb_id: detail.id,
      title: detail.name || detail.original_name || '',
      vote_average: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
      overview: detail.overview || '',
      genres: (detail.genres || []).map(g => g.name),
      cast: (detail.credits?.cast || []).slice(0, 10).map(c => c.name),
      backdrop: detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : '',
      poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : '',
      trailer: pickYoutubeTrailer(detail.videos),
      seasons: detail.number_of_seasons || null,
      episodes_count: detail.number_of_episodes || null,
      status: detail.status || '',
      year
    };
  } catch {
    return {};
  }
}

async function fetchTmdbSeasonEpisodes(tmdbId, season) {
  const key = getTmdbApiKey();
  if (!key || !tmdbId) return {};
  try {
    const data = await fetchJson(
      `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${key}&language=es-MX`
    );
    const map = {};
    for (const ep of data.episodes || []) {
      map[ep.episode_number] = {
        name: ep.name || '',
        overview: ep.overview || '',
        still: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : '',
        runtime: ep.runtime || null,
        air_date: ep.air_date || ''
      };
    }
    return map;
  } catch {
    return {};
  }
}

async function enrichEpisodesWithTmdb(tmdbId, episodes) {
  if (!episodes?.length) return [];
  if (!tmdbId) return episodes;

  const seasons = [...new Set(episodes.map(e => e.season))];
  const seasonMaps = {};
  await Promise.all(seasons.map(async (s) => {
    seasonMaps[s] = await fetchTmdbSeasonEpisodes(tmdbId, s);
  }));

  return episodes.map(ep => {
    const tmdbEp = seasonMaps[ep.season]?.[ep.episode] || {};
    return {
      ...ep,
      title: tmdbEp.name || `Episodio ${ep.episode}`,
      description: tmdbEp.overview || '',
      poster: tmdbEp.still || '',
      runtime: tmdbEp.runtime || null,
      air_date: tmdbEp.air_date || ''
    };
  });
}

async function fetchTmdbSeriesPoster(title) {
  const key = getTmdbApiKey();
  if (!key) return '';
  const hit = await searchTmdbSeries(title);
  return hit?.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : '';
}

async function resolveMoviePoster(title, year) {
  try {
    return await fetchTmdbMoviePoster(title, year) || '';
  } catch {
    return '';
  }
}

async function ensureMoviePoster(movie) {
  if (!movie) return '';
  if (movie.poster && !isPlaceholderPoster(movie.poster)) return movie.poster;
  const poster = await resolveMoviePoster(movie.title, movie.year);
  if (poster && movie.id) {
    const db = require('../db');
    db.prepare('UPDATE movies SET poster = ? WHERE id = ?').run(poster, movie.id);
    try {
      const { invalidateBannerCache } = require('./bannerArt');
      invalidateBannerCache('movie', movie.id);
    } catch { /* opcional */ }
  }
  return poster || posterCoverJpegUrl(movie.title, movie.year);
}

async function ensureSeriesPoster(series) {
  if (!series) return '';
  if (series.poster && !isPlaceholderPoster(series.poster)) return series.poster;
  const poster = await resolveSeriesPoster(series.title);
  if (poster && series.id) {
    const db = require('../db');
    db.prepare('UPDATE series SET poster = ? WHERE id = ?').run(poster, series.id);
    try {
      const { invalidateBannerCache } = require('./bannerArt');
      invalidateBannerCache('series', series.id);
    } catch { /* opcional */ }
  }
  return poster || posterCoverJpegUrl(series.title, series.year);
}

async function enrichCatalogItemPoster(item) {
  if (!item) return item;
  const type = item.content_type === 'series' ? 'series' : 'movie';
  const poster = type === 'series'
    ? await ensureSeriesPoster(item)
    : await ensureMoviePoster(item);
  const out = { ...item, poster };
  if (!out.backdrop || isPlaceholderPoster(out.backdrop)) {
    out.backdrop = poster;
  }
  return out;
}

async function enrichCatalogItemsPosters(items, concurrency = 6) {
  if (!Array.isArray(items) || !items.length) return items;
  const out = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const enriched = await Promise.all(batch.map((item) => enrichCatalogItemPoster(item)));
    out.push(...enriched);
  }
  return out;
}

async function resolveSeriesPoster(title) {
  try {
    return await fetchTmdbSeriesPoster(title) || '';
  } catch {
    return '';
  }
}

module.exports = {
  fetchJson,
  posterCoverUrl,
  posterCoverJpegUrl,
  isPlaceholderPoster,
  absolutePosterUrl,
  buildCoverSvg,
  pickYoutubeTrailer,
  searchTmdbMovie,
  searchTmdbSeries,
  fetchTmdbMoviePoster,
  fetchTmdbMovieDetails,
  fetchTmdbMovieById,
  fetchTmdbHeroExtras,
  fetchTmdbHeroExtrasByTitle,
  fetchTmdbSeriesTrailer,
  fetchTmdbSeriesTrailerByTitle,
  fetchTmdbSeriesDetails,
  fetchTmdbSeriesById,
  fetchTmdbSeasonEpisodes,
  enrichEpisodesWithTmdb,
  fetchTmdbSeriesPoster,
  resolveMoviePoster,
  resolveSeriesPoster,
  ensureMoviePoster,
  ensureSeriesPoster,
  enrichCatalogItemPoster,
  enrichCatalogItemsPosters
};
