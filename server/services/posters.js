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
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(query)}&language=es-ES`;
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
      `https://api.themoviedb.org/3/movie/${hit.id}?api_key=${key}&language=es-ES&append_to_response=credits,videos`
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
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&language=es-ES&append_to_response=credits,videos`
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
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&language=es-ES&append_to_response=videos`
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
      `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&language=es-ES&append_to_response=videos`
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
  const url = `https://api.themoviedb.org/3/search/tv?api_key=${key}&query=${encodeURIComponent(title)}&language=es-ES`;
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
      `https://api.themoviedb.org/3/tv/${hit.id}?api_key=${key}&language=es-ES&append_to_response=credits,videos`
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
      `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&language=es-ES&append_to_response=credits,videos`
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
      `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${key}&language=es-ES`
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
  if (movie.poster) return movie.poster;
  const poster = await resolveMoviePoster(movie.title, movie.year);
  if (poster && movie.id) {
    const db = require('../db');
    db.prepare('UPDATE movies SET poster = ? WHERE id = ?').run(poster, movie.id);
  }
  return poster || posterCoverUrl(movie.title, movie.year);
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
  ensureMoviePoster
};
