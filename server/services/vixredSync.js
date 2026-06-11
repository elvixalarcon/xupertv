const fs = require('fs');
const path = require('path');
const db = require('../db');

const DATA = path.join(__dirname, '..', '..', 'data');
const MIN_FILE_BYTES = 50 * 1024 * 1024;

function absFromPublic(videoPath) {
  if (!videoPath || !videoPath.startsWith('/uploads/')) return null;
  return path.join(DATA, videoPath.replace(/^\/uploads\//, ''));
}

function fileReady(videoPath) {
  const abs = absFromPublic(videoPath);
  if (!abs || !fs.existsSync(abs)) return false;
  try {
    return fs.statSync(abs).size >= MIN_FILE_BYTES;
  } catch {
    return false;
  }
}

function publicPath(absPath) {
  const rel = path.relative(DATA, absPath).replace(/\\/g, '/');
  return `/uploads/${rel}`;
}

function scanWinscpFiles() {
  const found = { movies: [], episodes: [] };
  const peliculas = path.join(DATA, 'winscp', 'peliculas');
  const seriesRoot = path.join(DATA, 'winscp', 'series');

  if (fs.existsSync(peliculas)) {
    for (const f of fs.readdirSync(peliculas)) {
      const abs = path.join(peliculas, f);
      if (!fs.statSync(abs).isFile()) continue;
      if (!/\.(mp4|mkv|avi|mov|webm)$/i.test(f)) continue;
      if (fs.statSync(abs).size < MIN_FILE_BYTES) continue;
      found.movies.push({ abs, public: publicPath(abs), name: f });
    }
  }

  if (fs.existsSync(seriesRoot)) {
    for (const seriesDir of fs.readdirSync(seriesRoot)) {
      const dir = path.join(seriesRoot, seriesDir);
      if (!fs.statSync(dir).isDirectory()) continue;
      const m = seriesDir.match(/^(.+)$/);
      if (!m) continue;
      for (const f of fs.readdirSync(dir)) {
        const abs = path.join(dir, f);
        if (!fs.statSync(abs).isFile()) continue;
        if (!/\.(mp4|mkv|avi|mov|webm)$/i.test(f)) continue;
        if (fs.statSync(abs).size < MIN_FILE_BYTES) continue;
        const ep = f.match(/S(\d+)E(\d+)/i);
        found.episodes.push({
          abs,
          public: publicPath(abs),
          seriesKey: seriesDir,
          season: ep ? parseInt(ep[1], 10) : 1,
          episode: ep ? parseInt(ep[2], 10) : 1
        });
      }
    }
  }

  return found;
}

function normalizeTitle(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function syncVixredVisibility() {
  const setMovieAvail = db.prepare('UPDATE movies SET available = ?, video_path = ? WHERE id = ?');
  const setMovieAvailOnly = db.prepare('UPDATE movies SET available = ? WHERE id = ?');
  const setEpAvail = db.prepare('UPDATE episodes SET available = ?, video_path = ? WHERE id = ?');
  const setEpAvailOnly = db.prepare('UPDATE episodes SET available = ? WHERE id = ?');

  const files = scanWinscpFiles();
  const movies = db.prepare('SELECT id, title, year, video_path FROM movies').all();
  const episodes = db.prepare(`
    SELECT e.id, e.season, e.episode, e.video_path, s.title AS series_title
    FROM episodes e JOIN series s ON s.id = e.series_id
  `).all();

  let moviesOn = 0;
  let moviesOff = 0;
  let epsOn = 0;
  let epsOff = 0;

  for (const movie of movies) {
    const key = normalizeTitle(movie.title);
    const match = files.movies.find((f) => {
      const base = normalizeTitle(path.basename(f.abs, path.extname(f.abs)));
      return base.includes(key.slice(0, 12)) || key.includes(base.slice(0, 12));
    });

    if (match) {
      setMovieAvail.run(1, match.public, movie.id);
      moviesOn++;
    } else if (fileReady(movie.video_path)) {
      setMovieAvailOnly.run(1, movie.id);
      moviesOn++;
    } else {
      setMovieAvailOnly.run(0, movie.id);
      moviesOff++;
    }
  }

  for (const ep of episodes) {
    const seriesKey = normalizeTitle(ep.series_title);
    const match = files.episodes.find((f) => {
      if (normalizeTitle(f.seriesKey) !== seriesKey && !normalizeTitle(f.seriesKey).includes(seriesKey.slice(0, 10))) {
        return false;
      }
      return f.season === ep.season && f.episode === ep.episode;
    });

    if (match) {
      setEpAvail.run(1, match.public, ep.id);
      epsOn++;
    } else if (fileReady(ep.video_path)) {
      setEpAvailOnly.run(1, ep.id);
      epsOn++;
    } else {
      setEpAvailOnly.run(0, ep.id);
      epsOff++;
    }
  }

  return { moviesOn, moviesOff, epsOn, epsOff };
}

module.exports = {
  syncVixredVisibility,
  fileReady,
  absFromPublic
};
