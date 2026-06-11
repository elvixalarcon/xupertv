const db = require('../db');
const { getTmdbApiKey } = require('./settings');
const { ensureCategory } = require('./categories');
const {
  fetchTmdbMovieDetails,
  fetchTmdbSeriesDetails,
  fetchTmdbMovieById,
  fetchTmdbSeriesById,
  enrichEpisodesWithTmdb
} = require('./posters');

function requireTmdbKey() {
  const key = getTmdbApiKey();
  if (!key) {
    const err = new Error('Configura la API Key de TMDB en Ajustes del admin');
    err.status = 400;
    throw err;
  }
  return key;
}

function genreString(genres) {
  if (Array.isArray(genres)) return genres.filter(Boolean).join(', ');
  return String(genres || '').trim();
}

async function resolveMovieMeta(title, year, tmdbId = null) {
  requireTmdbKey();
  if (tmdbId) {
    const byId = await fetchTmdbMovieById(tmdbId);
    if (byId?.tmdb_id) return byId;
  }
  const meta = await fetchTmdbMovieDetails(title, year);
  if (!meta?.tmdb_id) {
    const err = new Error(`No se encontró "${title}"${year ? ` (${year})` : ''} en TMDB`);
    err.status = 404;
    throw err;
  }
  return meta;
}

async function resolveSeriesMeta(title, tmdbId = null) {
  requireTmdbKey();
  if (tmdbId) {
    const byId = await fetchTmdbSeriesById(tmdbId);
    if (byId?.tmdb_id) return byId;
  }
  const meta = await fetchTmdbSeriesDetails(title);
  if (!meta?.tmdb_id) {
    const err = new Error(`No se encontró la serie "${title}" en TMDB`);
    err.status = 404;
    throw err;
  }
  return meta;
}

function applyMovieTmdbToDb(movieId, meta, opts = {}) {
  const title = meta.title || meta.original_title || opts.fallbackTitle || '';
  const description = meta.overview || '';
  const poster = meta.poster || '';
  const genre = genreString(meta.genres);
  const year = meta.year || opts.fallbackYear || 0;
  const rating = meta.vote_average || 0;

  if (genre) ensureCategory(genre.split(',')[0].trim(), 'movie');

  const trailer = meta.trailer || '';
  db.prepare(`
    UPDATE movies SET
      title = ?,
      description = ?,
      poster = COALESCE(NULLIF(?, ''), poster),
      genre = ?,
      year = ?,
      rating = ?,
      tmdb_id = ?,
      trailer = COALESCE(NULLIF(?, ''), trailer)
    WHERE id = ?
  `).run(title, description, poster, genre, year, rating, meta.tmdb_id, trailer, movieId);

  return { title, description, poster, genre, year, rating, tmdb_id: meta.tmdb_id };
}

function applySeriesTmdbToDb(seriesId, meta, opts = {}) {
  const title = meta.title || opts.fallbackTitle || '';
  const description = meta.overview || '';
  const poster = meta.poster || '';
  const genre = genreString(meta.genres);
  const year = meta.year || 0;

  if (genre) ensureCategory(genre.split(',')[0].trim(), 'series');

  const trailer = meta.trailer || '';
  const rating = meta.vote_average || 0;
  db.prepare(`
    UPDATE series SET
      title = ?,
      description = ?,
      poster = ?,
      genre = ?,
      year = ?,
      rating = ?,
      tmdb_id = ?,
      trailer = COALESCE(NULLIF(?, ''), trailer)
    WHERE id = ?
  `).run(title, description, poster, genre, year, rating, meta.tmdb_id, trailer, seriesId);

  return { title, description, poster, genre, year, rating, tmdb_id: meta.tmdb_id, trailer };
}

function isPlaceholderPoster(poster) {
  const p = String(poster || '').trim();
  if (!p) return true;
  return p.includes('/api/posters/cover');
}

function movieNeedsTmdbSync(movie) {
  if (!movie) return false;
  if (isPlaceholderPoster(movie.poster)) return true;
  if (!String(movie.description || '').trim() || String(movie.description).trim().length < 20) return true;
  if (!movie.tmdb_id) return true;
  const genre = String(movie.genre || '').trim();
  if (!genre || ['Cuevana', 'Web', 'AllCalidad'].includes(genre)) return true;
  return false;
}

function seriesNeedsTmdbSync(series) {
  if (!series) return false;
  if (isPlaceholderPoster(series.poster)) return true;
  if (!String(series.description || '').trim() || String(series.description).trim().length < 20) return true;
  if (!series.tmdb_id) return true;
  return false;
}

function episodeNeedsTmdbSync(ep) {
  if (!ep) return false;
  if (isPlaceholderPoster(ep.poster)) return true;
  if (!String(ep.description || '').trim()) return true;
  const title = String(ep.title || '').trim();
  if (/^S\d+\s*E\d+/i.test(title) || /^Capítulo\s*\d+/i.test(title)) return true;
  return false;
}

/**
 * Sincroniza TMDB si faltan carátula, sinopsis o metadatos (no lanza error).
 */
async function autoSyncMovieTmdbIfNeeded(movieId, opts = {}) {
  if (!getTmdbApiKey()) return { skipped: true, reason: 'no_api_key' };
  const row = db.prepare('SELECT * FROM movies WHERE id = ?').get(movieId);
  if (!row) return { skipped: true, reason: 'not_found' };
  if (!opts.force && !movieNeedsTmdbSync(row)) return { skipped: true, reason: 'complete' };
  try {
    const searchTitle = opts.title ?? row.title;
    const searchYear = opts.year ?? row.year;
    const meta = await resolveMovieMeta(searchTitle, searchYear, row.tmdb_id);
    applyMovieTmdbToDb(movieId, meta, { fallbackTitle: searchTitle, fallbackYear: searchYear });
    console.log(`[tmdb-auto] Película #${movieId} «${searchTitle}» sincronizada`);
    return { ok: true, movieId };
  } catch (e) {
    console.warn(`[tmdb-auto] Película #${movieId}:`, e.message);
    return { ok: false, error: e.message };
  }
}

async function autoSyncSeriesTmdbIfNeeded(seriesId, opts = {}) {
  if (!getTmdbApiKey()) return { skipped: true, reason: 'no_api_key' };
  const row = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
  if (!row) return { skipped: true, reason: 'not_found' };
  if (!opts.force && !seriesNeedsTmdbSync(row)) return { skipped: true, reason: 'complete' };
  try {
    const searchTitle = opts.title ?? row.title;
    const meta = await resolveSeriesMeta(searchTitle, row.tmdb_id);
    await applySeriesTmdbToDb(seriesId, meta, { fallbackTitle: searchTitle });
    await syncSeriesEpisodesFromTmdb(seriesId);
    console.log(`[tmdb-auto] Serie #${seriesId} «${searchTitle}» sincronizada`);
    return { ok: true, seriesId };
  } catch (e) {
    console.warn(`[tmdb-auto] Serie #${seriesId}:`, e.message);
    return { ok: false, error: e.message };
  }
}

async function autoSyncEpisodeTmdbIfNeeded(episodeId) {
  if (!getTmdbApiKey()) return { skipped: true, reason: 'no_api_key' };
  const ep = db.prepare(`
    SELECT e.*, s.title AS series_title, s.tmdb_id AS series_tmdb_id
    FROM episodes e JOIN series s ON s.id = e.series_id WHERE e.id = ?
  `).get(episodeId);
  if (!ep) return { skipped: true, reason: 'not_found' };
  if (!episodeNeedsTmdbSync(ep) && ep.series_tmdb_id) return { skipped: true, reason: 'complete' };
  try {
    if (!ep.series_tmdb_id) {
      await autoSyncSeriesTmdbIfNeeded(ep.series_id, { title: ep.series_title });
    }
    const refreshed = db.prepare('SELECT e.*, s.tmdb_id AS series_tmdb_id FROM episodes e JOIN series s ON s.id = e.series_id WHERE e.id = ?')
      .get(episodeId);
    if (!refreshed?.series_tmdb_id) return { ok: false, error: 'serie sin TMDB' };
    await syncEpisodeFromTmdb(episodeId);
    console.log(`[tmdb-auto] Episodio #${episodeId} S${ep.season}E${ep.episode} sincronizado`);
    return { ok: true, episodeId };
  } catch (e) {
    console.warn(`[tmdb-auto] Episodio #${episodeId}:`, e.message);
    return { ok: false, error: e.message };
  }
}

/** Películas ya descargadas sin metadatos TMDB completos. */
function listMoviesNeedingTmdbSync(limit = 6) {
  return db.prepare(`
    SELECT * FROM movies
    WHERE COALESCE(available, 1) = 1
      AND (
        poster IS NULL OR poster = '' OR poster LIKE '%/api/posters/cover%'
        OR description IS NULL OR LENGTH(TRIM(COALESCE(description, ''))) < 20
        OR tmdb_id IS NULL
        OR TRIM(COALESCE(genre, '')) IN ('', 'Cuevana', 'Web', 'AllCalidad')
      )
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

async function syncMoviesNeedingTmdbBatch(limit = 4) {
  if (!getTmdbApiKey()) return { synced: 0, skipped: true };
  const rows = listMoviesNeedingTmdbSync(limit);
  let synced = 0;
  for (const m of rows) {
    const r = await autoSyncMovieTmdbIfNeeded(m.id, { force: true });
    if (r.ok) synced++;
    await new Promise((resolve) => setTimeout(resolve, 320));
  }
  return { synced, total: rows.length };
}

async function syncMovieFromTmdb(movieId, { title, year } = {}) {
  const row = db.prepare('SELECT * FROM movies WHERE id = ?').get(movieId);
  if (!row) {
    const err = new Error('Película no encontrada');
    err.status = 404;
    throw err;
  }
  const searchTitle = title ?? row.title;
  const searchYear = year ?? row.year;
  const meta = await resolveMovieMeta(searchTitle, searchYear, row.tmdb_id);
  return applyMovieTmdbToDb(movieId, meta, { fallbackTitle: searchTitle, fallbackYear: searchYear });
}

async function syncSeriesFromTmdb(seriesId, { title } = {}) {
  const row = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
  if (!row) {
    const err = new Error('Serie no encontrada');
    err.status = 404;
    throw err;
  }
  const searchTitle = title ?? row.title;
  const meta = await resolveSeriesMeta(searchTitle, row.tmdb_id);
  await applySeriesTmdbToDb(seriesId, meta, { fallbackTitle: searchTitle });
  await syncSeriesEpisodesFromTmdb(seriesId);
  return meta;
}

async function syncSeriesEpisodesFromTmdb(seriesId) {
  const series = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
  if (!series?.tmdb_id) return { updated: 0 };

  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE series_id = ? ORDER BY season, episode'
  ).all(seriesId);
  if (!episodes.length) return { updated: 0 };

  const enriched = await enrichEpisodesWithTmdb(series.tmdb_id, episodes);
  const update = db.prepare(`
    UPDATE episodes SET title = ?, description = ?, poster = ? WHERE id = ?
  `);

  let updated = 0;
  for (const ep of enriched) {
    update.run(ep.title, ep.description || '', ep.poster || '', ep.id);
    updated++;
  }
  return { updated };
}

async function syncEpisodeFromTmdb(episodeId) {
  const ep = db.prepare('SELECT e.*, s.tmdb_id AS series_tmdb_id FROM episodes e JOIN series s ON s.id = e.series_id WHERE e.id = ?')
    .get(episodeId);
  if (!ep) {
    const err = new Error('Episodio no encontrado');
    err.status = 404;
    throw err;
  }
  if (!ep.series_tmdb_id) {
    const err = new Error('La serie no tiene TMDB ID; sincroniza la serie primero');
    err.status = 400;
    throw err;
  }

  const seasonMap = await require('./posters').fetchTmdbSeasonEpisodes(ep.series_tmdb_id, ep.season);
  const tmdbEp = seasonMap[ep.episode];
  if (!tmdbEp) {
    const err = new Error(`Episodio S${ep.season}E${ep.episode} no encontrado en TMDB`);
    err.status = 404;
    throw err;
  }

  const title = tmdbEp.name || ep.title;
  const description = tmdbEp.overview || '';
  const poster = tmdbEp.still || '';

  db.prepare('UPDATE episodes SET title = ?, description = ?, poster = ? WHERE id = ?')
    .run(title, description, poster, episodeId);

  return { title, description, poster };
}

async function refreshAllTrailersFromTmdb() {
  requireTmdbKey();
  const {
    fetchTmdbHeroExtras,
    fetchTmdbHeroExtrasByTitle,
    fetchTmdbSeriesTrailer,
    fetchTmdbSeriesTrailerByTitle
  } = require('./posters');

  let updated = 0;
  const errors = [];
  const delay = () => new Promise((r) => setTimeout(r, 280));

  const updateMovieTrailer = db.prepare(`
    UPDATE movies SET trailer = ?, tmdb_id = COALESCE(tmdb_id, ?) WHERE id = ?
  `);
  const updateSeriesTrailer = db.prepare(`
    UPDATE series SET trailer = ?, tmdb_id = COALESCE(tmdb_id, ?) WHERE id = ?
  `);

  for (const m of db.prepare(`
    SELECT id, title, year, tmdb_id FROM movies
    WHERE trailer IS NULL OR trailer = ''
  `).all()) {
    try {
      let key = '';
      let tmdbId = m.tmdb_id;
      if (m.tmdb_id) {
        key = (await fetchTmdbHeroExtras(m.tmdb_id)).trailer;
      } else {
        const byTitle = await fetchTmdbHeroExtrasByTitle(m.title, m.year);
        key = byTitle.trailer;
        if (byTitle.tmdb_id) tmdbId = byTitle.tmdb_id;
      }
      if (key) {
        updateMovieTrailer.run(key, tmdbId, m.id);
        updated++;
      }
      await delay();
    } catch (e) {
      errors.push({ type: 'movie', id: m.id, error: e.message });
    }
  }

  for (const s of db.prepare(`
    SELECT id, title, tmdb_id FROM series
    WHERE trailer IS NULL OR trailer = ''
  `).all()) {
    try {
      let key = '';
      let tmdbId = s.tmdb_id;
      if (s.tmdb_id) {
        key = await fetchTmdbSeriesTrailer(s.tmdb_id);
      } else {
        const byTitle = await fetchTmdbSeriesTrailerByTitle(s.title);
        key = byTitle.trailer;
        if (byTitle.tmdb_id) tmdbId = byTitle.tmdb_id;
      }
      if (key) {
        updateSeriesTrailer.run(key, tmdbId, s.id);
        updated++;
      }
      await delay();
    } catch (e) {
      errors.push({ type: 'series', id: s.id, error: e.message });
    }
  }

  return { updated, errors };
}

async function refreshAllVodFromTmdb() {
  requireTmdbKey();
  let updated = 0;
  const errors = [];

  for (const m of db.prepare('SELECT id FROM movies').all()) {
    try {
      await syncMovieFromTmdb(m.id);
      updated++;
    } catch (e) {
      errors.push({ type: 'movie', id: m.id, error: e.message });
    }
  }

  for (const s of db.prepare('SELECT id FROM series').all()) {
    try {
      await syncSeriesFromTmdb(s.id);
      updated++;
    } catch (e) {
      errors.push({ type: 'series', id: s.id, error: e.message });
    }
  }

  return { updated, errors };
}

function parseGenreList(genre) {
  if (!genre) return [];
  return String(genre).split(/[,/|]/).map((g) => g.trim()).filter(Boolean);
}

/** Respuesta rápida desde SQLite (sin llamadas TMDB). */
function movieMetaFromDb(movie) {
  const genres = parseGenreList(movie.genre);
  return {
    title: movie.title,
    description: movie.description || '',
    poster: movie.poster || '',
    genre: movie.genre || '',
    year: movie.year ?? null,
    rating: movie.rating ?? null,
    runtime: null,
    cast: [],
    genres,
    synopsis: movie.description || '',
    backdrop: movie.poster || '',
    trailer: movie.trailer || '',
    tmdb_id: movie.tmdb_id || null
  };
}

function seriesMetaFromDb(series, episodes) {
  const genres = parseGenreList(series.genre);
  return {
    title: series.title,
    poster: series.poster || '',
    rating: series.rating ?? null,
    seasons: null,
    episodes_count: episodes.length,
    status: '',
    year: series.year ?? null,
    cast: [],
    genres,
    synopsis: series.description || '',
    backdrop: series.poster || '',
    trailer: series.trailer || '',
    episodes,
    tmdb_id: series.tmdb_id || null
  };
}

function hasCachedMovieDetail(movie) {
  return !!(movie.poster || (movie.description && movie.description.length > 12));
}

function hasCachedSeriesDetail(series) {
  return !!(series.poster || (series.description && series.description.length > 12));
}

/** Metadatos de detalle (DB si ya está sincronizado; si no, TMDB). */
async function ensureMovieTrailer(movie) {
  const existing = (movie.trailer || '').trim();
  if (existing) return existing;
  const { getTmdbApiKey } = require('./settings');
  if (!getTmdbApiKey()) return '';

  const { fetchTmdbHeroExtras, fetchTmdbHeroExtrasByTitle } = require('./posters');
  let key = '';
  let tmdbId = movie.tmdb_id;
  if (movie.tmdb_id) {
    key = (await fetchTmdbHeroExtras(movie.tmdb_id)).trailer;
  } else {
    const byTitle = await fetchTmdbHeroExtrasByTitle(movie.title, movie.year);
    key = byTitle.trailer;
    if (byTitle.tmdb_id) tmdbId = byTitle.tmdb_id;
  }
  if (key) {
    db.prepare('UPDATE movies SET trailer = ?, tmdb_id = COALESCE(tmdb_id, ?) WHERE id = ?')
      .run(key, tmdbId, movie.id);
  }
  return key;
}

async function ensureSeriesTrailer(series) {
  const existing = (series.trailer || '').trim();
  if (existing) return existing;
  const { getTmdbApiKey } = require('./settings');
  if (!getTmdbApiKey()) return '';

  const { fetchTmdbSeriesTrailer, fetchTmdbSeriesTrailerByTitle } = require('./posters');
  let key = '';
  let tmdbId = series.tmdb_id;
  if (series.tmdb_id) {
    key = await fetchTmdbSeriesTrailer(series.tmdb_id);
  } else {
    const byTitle = await fetchTmdbSeriesTrailerByTitle(series.title);
    key = byTitle.trailer;
    if (byTitle.tmdb_id) tmdbId = byTitle.tmdb_id;
  }
  if (key) {
    db.prepare('UPDATE series SET trailer = ?, tmdb_id = COALESCE(tmdb_id, ?) WHERE id = ?')
      .run(key, tmdbId, series.id);
  }
  return key;
}

async function getMovieDetailMeta(movie) {
  if (hasCachedMovieDetail(movie)) {
    const base = movieMetaFromDb(movie);
    if (!base.trailer) base.trailer = await ensureMovieTrailer(movie);
    return base;
  }

  const meta = movie.tmdb_id
    ? await fetchTmdbMovieById(movie.tmdb_id)
    : await fetchTmdbMovieDetails(movie.title, movie.year);

  if (meta.tmdb_id && !movie.tmdb_id) {
    db.prepare('UPDATE movies SET tmdb_id = ? WHERE id = ?').run(meta.tmdb_id, movie.id);
  }
  if (meta.trailer) {
    db.prepare("UPDATE movies SET trailer = ? WHERE id = ? AND (trailer IS NULL OR trailer = '')")
      .run(meta.trailer, movie.id);
  }

  const genre = genreString(meta.genres) || movie.genre || '';

  return {
    title: meta.title || movie.title,
    description: meta.overview || '',
    poster: meta.poster || '',
    genre,
    year: meta.year ?? movie.year,
    rating: meta.vote_average ?? movie.rating,
    runtime: meta.runtime ?? null,
    cast: meta.cast || [],
    genres: meta.genres?.length ? meta.genres : (movie.genre ? movie.genre.split(/[,/|]/).map((g) => g.trim()).filter(Boolean) : []),
    synopsis: meta.overview || '',
    backdrop: meta.backdrop || meta.poster || '',
    trailer: meta.trailer || '',
    tmdb_id: meta.tmdb_id
  };
}

async function getSeriesDetailMeta(series, episodes) {
  if (hasCachedSeriesDetail(series)) {
    const base = seriesMetaFromDb(series, episodes);
    if (!base.trailer) {
      try {
        base.trailer = await Promise.race([
          ensureSeriesTrailer(series),
          new Promise((resolve) => setTimeout(() => resolve(''), 4000))
        ]);
      } catch { /* ignore */ }
    }
    return base;
  }

  const meta = series.tmdb_id
    ? await fetchTmdbSeriesById(series.tmdb_id)
    : await fetchTmdbSeriesDetails(series.title);

  if (meta.tmdb_id && !series.tmdb_id) {
    db.prepare('UPDATE series SET tmdb_id = ? WHERE id = ?').run(meta.tmdb_id, series.id);
  }
  if (meta.trailer) {
    db.prepare("UPDATE series SET trailer = ? WHERE id = ? AND (trailer IS NULL OR trailer = '')")
      .run(meta.trailer, series.id);
  }
  if (meta.vote_average) {
    db.prepare('UPDATE series SET rating = ? WHERE id = ?').run(meta.vote_average, series.id);
  }

  const enrichedEpisodes = await enrichEpisodesWithTmdb(meta.tmdb_id, episodes);

  return {
    title: meta.title || series.title,
    poster: meta.poster || '',
    rating: meta.vote_average ?? null,
    seasons: meta.seasons ?? null,
    episodes_count: meta.episodes_count ?? episodes.length,
    status: meta.status || '',
    year: meta.year ?? series.year ?? null,
    cast: meta.cast || [],
    genres: meta.genres?.length ? meta.genres : (series.genre ? series.genre.split(/[,/|]/).map((g) => g.trim()).filter(Boolean) : []),
    synopsis: meta.overview || '',
    backdrop: meta.backdrop || meta.poster || '',
    trailer: meta.trailer || series.trailer || '',
    episodes: enrichedEpisodes,
    tmdb_id: meta.tmdb_id
  };
}

module.exports = {
  syncMovieFromTmdb,
  syncSeriesFromTmdb,
  syncSeriesEpisodesFromTmdb,
  syncEpisodeFromTmdb,
  autoSyncMovieTmdbIfNeeded,
  autoSyncSeriesTmdbIfNeeded,
  autoSyncEpisodeTmdbIfNeeded,
  movieNeedsTmdbSync,
  listMoviesNeedingTmdbSync,
  syncMoviesNeedingTmdbBatch,
  refreshAllVodFromTmdb,
  refreshAllTrailersFromTmdb,
  getMovieDetailMeta,
  getSeriesDetailMeta,
  ensureMovieTrailer,
  ensureSeriesTrailer,
  resolveMovieMeta,
  resolveSeriesMeta,
  applyMovieTmdbToDb,
  applySeriesTmdbToDb
};
