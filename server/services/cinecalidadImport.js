const path = require('path');
const db = require('../db');
const { parseMoviePage, resolveBestStream } = require('./cinecalidad');
const { autoSyncMovieTmdbIfNeeded } = require('./tmdbMetadata');
const { registerDownloadJob } = require('./vodDownloadProgress');
const { findExistingMovie, movieExists } = require('./movieDedup');
const { safeFilename, logRelForMovie } = require('./vodYtDlp');

async function importMovie(slugOrUrl, { download = false, recommended = true, quality = 'max', manualDownload = false } = {}) {
  const movie = await parseMoviePage(slugOrUrl);
  const existing = findExistingMovie({
    slug: movie.slug,
    title: movie.title,
    year: movie.year,
    tmdb_id: null
  });

  if (existing && !download) {
    return { skipped: true, id: existing.id, slug: movie.slug, title: movie.title, reason: 'ya en catálogo' };
  }

  const video_path = `/uploads/movies/pending_cinecalidad_${movie.slug}.mkv`;
  const fname = safeFilename(movie.title, movie.year);
  const logRel = logRelForMovie({ video_path, genre: 'Cinecalidad' }, movie.slug, 'cinecalidad');
  const destBase = path.basename(fname, '.mkv');

  let movieId;
  if (existing) {
    db.prepare(`
      UPDATE movies SET title=?, video_path=?, year=?, genre=?, recommended=?, available=? WHERE id=?
    `).run(movie.title, video_path, movie.year, 'Cinecalidad', recommended ? 1 : 0, 0, existing.id);
    movieId = existing.id;
  } else {
    const r = db.prepare(`
      INSERT INTO movies (title, description, poster, video_path, genre, year, recommended, available, rating)
      VALUES (?, '', ?, ?, 'Cinecalidad', ?, ?, 0, 0)
    `).run(
      movie.title,
      movie.poster || '',
      video_path,
      movie.year,
      recommended ? 1 : 0
    );
    movieId = r.lastInsertRowid;
  }

  if (download) {
    const { clearMovieFilesForRedownload } = require('./vodYtDlp');
    if (existing) clearMovieFilesForRedownload(destBase, movie.slug);
    registerDownloadJob(movieId, {
      logFile: logRel,
      destBase,
      slug: movie.slug,
      quality,
      source: 'cinecalidad',
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
      source: 'cinecalidad',
      message: existing
        ? `Actualizando desde Cinecalidad (${quality}) — ver Películas VOD`
        : `Descarga Cinecalidad iniciada (${quality})`
    };
  }

  await autoSyncMovieTmdbIfNeeded(movieId, { title: movie.title, year: movie.year });
  registerDownloadJob(movieId, {
    logFile: logRel,
    destBase: `pending_cinecalidad_${movie.slug}`,
    slug: movie.slug,
    source: 'cinecalidad'
  });

  return { ok: true, id: movieId, slug: movie.slug, title: movie.title, year: movie.year, available: 0, source: 'cinecalidad' };
}

module.exports = {
  importMovie,
  movieExists,
  parseMoviePage,
  resolveBestStream
};
