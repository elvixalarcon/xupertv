#!/usr/bin/env node
/**
 * Importa una película desde Cuevana 3 (metadatos TMDB + descarga opcional).
 * Uso:
 *   node server/scripts/import-cuevana-movie.js backrooms-sin-salida --download
 *   node server/scripts/import-cuevana-movie.js https://cuevana3.cl/pelicula/iron-lung-oceano-de-sangre --download
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { parseMoviePage, resolveBestStream } = require('../services/cuevana');
const { syncMovieFromTmdb } = require('../services/tmdbMetadata');
const { registerDownloadJob } = require('../services/vodDownloadProgress');
const { findExistingMovie } = require('../services/movieDedup');
const {
  safeFilename,
  runCuevanaDownload,
  findFinishedFile,
  finalizeDownloadedMovie,
  logRelForMovie,
  MOVIES_DIR
} = require('../services/vodYtDlp');

const ROOT = path.join(__dirname, '..', '..');

function parseArgs(argv) {
  const out = { slug: '', url: '', download: false, recommended: false, embedOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--download') out.download = true;
    else if (a === '--embed-only') { out.embedOnly = true; out.download = false; }
    else if (a === '--recommended') out.recommended = true;
    else if (a.startsWith('http')) out.url = a;
    else if (!a.startsWith('--')) out.slug = a;
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.slug && !opts.url) {
    console.error('Uso: node import-cuevana-movie.js <slug|url> [--download] [--recommended]');
    process.exit(1);
  }

  const movie = await parseMoviePage(opts.url || opts.slug);
  console.log('[cuevana]', movie.title, movie.year, 'tmdb', movie.tmdb_id, 'servers', movie.servers.length);

  const existing = findExistingMovie({
    slug: movie.slug,
    title: movie.title,
    year: movie.year,
    tmdb_id: movie.tmdb_id
  });
  if (existing && !opts.download && !opts.embedOnly) {
    console.log(JSON.stringify({ skipped: true, id: existing.id, title: existing.title }, null, 2));
    process.exit(0);
  }

  let video_path = `/uploads/movies/${safeFilename(movie.title, movie.year)}`;
  let absVideo = null;
  let available = 0;

  if (opts.download || opts.embedOnly) {
    const stream = await resolveBestStream(movie);
    if (!stream?.m3u8) {
      throw new Error('No se pudo resolver stream HLS desde Cuevana');
    }
    console.log('[cuevana] stream', stream.host);
    if (opts.download) {
      const fname = safeFilename(movie.title, movie.year);
      const dest = path.join(MOVIES_DIR, fname);
      const logRel = logRelForMovie({ video_path, genre: 'Cuevana' }, movie.slug, 'cuevana');
      const logAbs = path.join(ROOT, 'data', logRel);
      await runCuevanaDownload(stream.m3u8, dest, logAbs);
      absVideo = findFinishedFile(path.basename(fname, '.mkv')) || (fs.existsSync(dest) ? dest : null);
      if (!absVideo) throw new Error('Archivo no encontrado tras descarga');
      video_path = `/uploads/movies/${path.basename(absVideo)}`;
      available = 1;
    } else {
      video_path = stream.m3u8;
      available = 1;
    }
  }

  let movieId;
  if (existing) {
    db.prepare(`
      UPDATE movies SET title=?, description=?, video_path=?, year=?, recommended=?, available=?, rating=COALESCE(?, rating)
      WHERE id=?
    `).run(
      movie.title,
      movie.description || existing.description,
      video_path,
      movie.year || existing.year,
      opts.recommended ? 1 : existing.recommended,
      available,
      movie.rating,
      existing.id
    );
    movieId = existing.id;
  } else {
    const r = db.prepare(`
      INSERT INTO movies (title, description, poster, video_path, genre, year, recommended, available, rating)
      VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)
    `).run(
      movie.title,
      movie.description || '',
      video_path,
      movie.genres.join(', ') || 'Cuevana',
      movie.year,
      opts.recommended ? 1 : 0,
      available,
      movie.rating || 0
    );
    movieId = r.lastInsertRowid;
  }

  await syncMovieFromTmdb(movieId, { title: movie.title, year: movie.year });

  if (opts.download && available === 1) {
    registerDownloadJob(movieId, {
      logFile: logRelForMovie({ video_path, genre: 'Cuevana' }, movie.slug, 'cuevana'),
      destBase: path.basename(safeFilename(movie.title, movie.year), '.mkv'),
      slug: movie.slug
    });
  }

  if (available === 0) {
    registerDownloadJob(movieId, {
      logFile: `winscp/import-cuevana-${movie.slug}.log`,
      destBase: path.basename(video_path, path.extname(video_path)),
      slug: movie.slug
    });
  }

  if (absVideo && fs.existsSync(absVideo)) {
    await finalizeDownloadedMovie(movieId, absVideo, video_path);
  }

  const row = db.prepare('SELECT id, title, poster, available, video_path, tmdb_id FROM movies WHERE id = ?').get(movieId);
  console.log(JSON.stringify({ ok: true, source: 'cuevana', slug: movie.slug, ...row }, null, 2));
}

main().catch((err) => {
  console.error('[cuevana]', err.message);
  process.exit(1);
});
