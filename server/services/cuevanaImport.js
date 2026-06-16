const path = require('path');
const db = require('../db');
const { collectMovieUrls, parseMoviePage } = require('./cuevana');
const { autoSyncMovieTmdbIfNeeded } = require('./tmdbMetadata');
const { registerDownloadJob } = require('./vodDownloadProgress');
const { findExistingMovie, movieExists, catalogFieldsForDownload } = require('./movieDedup');
const { safeFilename, logRelForMovie } = require('./vodYtDlp');

async function discoverNewMovies(years = [2026, 2025, 2024], limit = 80) {
  const all = await collectMovieUrls({
    years,
    genres: ['terror', 'ciencia-ficcion', 'accion', 'drama', 'comedia', 'suspenso', 'aventura'],
    yearFilter: years,
    extraPages: 2
  });
  const fresh = all.filter((m) => !movieExists(m.slug, m.title, m.year, m.tmdb_id));
  fresh.sort((a, b) => b.year - a.year);
  return fresh.slice(0, limit);
}

async function importMovie(slugOrUrl, { download = false, recommended = true, quality = 'max', manualDownload = false } = {}) {
  const movie = await parseMoviePage(slugOrUrl);
  const existing = findExistingMovie({
    slug: movie.slug,
    title: movie.title,
    year: movie.year,
    tmdb_id: movie.tmdb_id
  });

  if (existing && !download) {
    return { skipped: true, id: existing.id, slug: movie.slug, title: movie.title, reason: 'ya en catálogo' };
  }

  const video_path = `/uploads/movies/pending_${movie.slug}.mkv`;
  let available = 0;
  const fname = safeFilename(movie.title, movie.year);
  const logRel = logRelForMovie({ video_path, genre: 'Cuevana' }, movie.slug, 'cuevana');
  const destBase = path.basename(fname, '.mkv');

  let movieId;
  if (existing) {
    const catalog = catalogFieldsForDownload(existing, video_path);
    db.prepare(`
      UPDATE movies SET title=?, video_path=?, year=?, recommended=?, available=? WHERE id=?
    `).run(movie.title, catalog.video_path, movie.year, recommended ? 1 : 0, catalog.available, existing.id);
    movieId = existing.id;
  } else {
    const r = db.prepare(`
      INSERT INTO movies (title, description, poster, video_path, genre, year, recommended, available, rating)
      VALUES (?, '', '', ?, ?, ?, ?, 0, 0)
    `).run(
      movie.title,
      video_path,
      movie.genres?.join(', ') || 'Cuevana',
      movie.year,
      recommended ? 1 : 0
    );
    movieId = r.lastInsertRowid;
  }

  if (download) {
    const { clearMovieFilesForRedownload } = require('./vodYtDlp');
    if (existing && catalogFieldsForDownload(existing, video_path).available === 0) {
      clearMovieFilesForRedownload(destBase, movie.slug);
    }
    registerDownloadJob(movieId, {
      logFile: logRel,
      destBase,
      slug: movie.slug,
      quality,
      source: 'cuevana',
      updating: !!existing
    });
    const { spawnMovieDownload } = require('./vodPendingQueue');
    spawnMovieDownload(movieId, { manual: manualDownload });
    return {
      ok: true,
      async: true,
      id: movieId,
      slug: movie.slug,
      title: movie.title,
      year: movie.year,
      available: 0,
      source: 'cuevana',
      message: existing
        ? `Actualizando (${quality}) — ver progreso en Películas VOD`
        : `Descarga iniciada (${quality}) — sigue el progreso en Películas VOD`
    };
  }

  await autoSyncMovieTmdbIfNeeded(movieId, { title: movie.title, year: movie.year });
  registerDownloadJob(movieId, {
    logFile: `winscp/import-cuevana-${movie.slug}.log`,
    destBase: `pending_${movie.slug}`,
    slug: movie.slug
  });

  return { ok: true, id: movieId, slug: movie.slug, title: movie.title, year: movie.year, available, source: 'cuevana' };
}

module.exports = {
  discoverNewMovies,
  importMovie,
  movieExists
};
