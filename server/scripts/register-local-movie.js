#!/usr/bin/env node
/** Registra en la DB una película ya descargada en data/movies (metadatos solo TMDB). */
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { syncMovieFromTmdb } = require('../services/tmdbMetadata');
const { clearDownloadJob } = require('../services/vodDownloadProgress');
const { prepareUploadedVideo, applyVideoPrepResult } = require('../services/videoPrep');

const file = process.argv[2];
const title = process.argv[3] || 'Proyecto Fin del Mundo';
const year = parseInt(process.argv[4] || '2026', 10);

if (!file || !fs.existsSync(file)) {
  console.error('Uso: node register-local-movie.js /app/data/movies/archivo.mkv "Título" 2026');
  process.exit(1);
}

const basename = path.basename(file);
const video_path = `/uploads/movies/${basename}`;

(async () => {
  const existing = db.prepare('SELECT id FROM movies WHERE lower(title) LIKE ?').get('%proyecto fin%');
  let id;
  if (existing) {
    db.prepare('UPDATE movies SET video_path=?, available=1, title=?, year=? WHERE id=?')
      .run(video_path, title, year, existing.id);
    id = existing.id;
  } else {
    const r = db.prepare(`
      INSERT INTO movies (title, description, poster, video_path, genre, year, recommended, available, rating)
      VALUES (?, '', '', ?, '', ?, 1, 1, 0)
    `).run(title, video_path, year);
    id = r.lastInsertRowid;
  }

  await syncMovieFromTmdb(id, { title, year });
  clearDownloadJob(id);

  try {
    const prep = await prepareUploadedVideo(file);
    const applied = applyVideoPrepResult(prep, id, 'movie', video_path);
    if (applied.publicPath) {
      db.prepare('UPDATE movies SET video_path = ? WHERE id = ?').run(applied.publicPath, id);
    }
  } catch (e) {
    console.warn('videoPrep:', e.message);
  }

  const row = db.prepare('SELECT id, title, poster, tmdb_id, video_path FROM movies WHERE id = ?').get(id);
  console.log(JSON.stringify({ ok: true, ...row }, null, 2));
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
