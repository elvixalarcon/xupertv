const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { auth, adminOnly, requireAccess } = require('../middleware/auth');
const { syncMovieFromTmdb, getMovieDetailMeta } = require('../services/tmdbMetadata');
const { prepareUploadedVideo, scheduleVideoPrep, applyVideoPrepResult } = require('../services/videoPrep');
const { resolvePlayablePath, resolveSubtitlePath } = require('../services/playablePath');

const router = express.Router();
const moviesDir = path.join(__dirname, '..', '..', 'data', 'movies');
const postersDir = path.join(__dirname, '..', '..', 'data', 'posters');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (file.fieldname === 'poster') cb(null, postersDir);
    else cb(null, moviesDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }
});

const updateMovieRating = db.prepare('UPDATE movies SET rating = ? WHERE id = ?');

async function resolveMovieRating(movie) {
  if (movie.rating > 0) return movie.rating;
  try {
    await syncMovieFromTmdb(movie.id);
    const refreshed = db.prepare('SELECT rating FROM movies WHERE id = ?').get(movie.id);
    return refreshed?.rating || 0;
  } catch {
    return movie.rating || 0;
  }
}

async function enrichMoviesWithRatings(movies) {
  const { ensureMoviePoster } = require('../services/posters');
  return Promise.all(movies.map(async (m) => ({
    ...m,
    poster: await ensureMoviePoster(m),
    rating: await resolveMovieRating(m)
  })));
}

function sortMoviesByRating(movies) {
  return [...movies].sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

function visibleMoviesSql(extra = '') {
  return `SELECT * FROM movies WHERE COALESCE(available, 1) = 1${extra}`;
}

router.get('/', auth, requireAccess('movies'), async (req, res) => {
  const all = req.query.all === '1' && req.user.role === 'admin';
  const sql = all
    ? 'SELECT * FROM movies ORDER BY created_at DESC'
    : `${visibleMoviesSql()} ORDER BY created_at DESC`;
  const rows = db.prepare(sql).all();
  if (all) {
    // El progreso detallado va en GET /admin/movies/download-progress (solo jobs activos).
    // Calcularlo aquí para miles de pendientes bloqueaba el admin varios minutos.
    return res.json(rows.map((m) => ({
      ...m,
      video_quality: m.video_quality || null,
      download_progress: Number(m.available) === 0
        ? { active: false, status: 'pending', percent: 0, message: 'Pendiente' }
        : null
    })));
  }
  const { ensureMoviePoster } = require('../services/posters');
  const enriched = await Promise.all(rows.map(async (m) => ({
    ...m,
    poster: await ensureMoviePoster(m),
    video_path: resolvePlayablePath(m.video_path)
  })));
  res.json(enriched);
});

router.get('/recommended', auth, requireAccess('movies'), async (req, res) => {
  const { getAutoRecommendedMovies } = require('../services/catalogCategories');
  const movies = getAutoRecommendedMovies(40, '*');
  const enriched = await enrichMoviesWithRatings(movies);
  res.json(sortMoviesByRating(enriched).slice(0, 20));
});

router.get('/recent', auth, requireAccess('movies'), async (req, res) => {
  try {
    const movies = db.prepare(`${visibleMoviesSql()} ORDER BY created_at DESC LIMIT 8`).all();
    const { enrichMoviesHeroBackdrops } = require('../services/heroSlides');
    res.json(await enrichMoviesHeroBackdrops(movies));
  } catch (err) {
    console.error('[movies/recent]', err);
    res.status(500).json({ error: 'No se pudieron cargar recientes' });
  }
});

router.get('/genre-rows', auth, requireAccess('movies'), (req, res) => {
  const { getMovieGenreRows } = require('../services/catalogCategories');
  const limit = Math.min(40, Math.max(4, parseInt(req.query.limit, 10) || 24));
  res.json(getMovieGenreRows({ limitPerGenre: limit }));
});

/** Lista completa por género (query evita problemas con acentos en la URL). */
router.get('/by-genre', auth, requireAccess('movies'), (req, res) => {
  const { getMoviesByGenre } = require('../services/catalogCategories');
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const genre = String(req.query.genre || '').trim();
  if (!genre) return res.status(400).json({ error: 'Género requerido' });
  res.json(getMoviesByGenre(genre, limit));
});

router.get('/genre/:genreName', auth, requireAccess('movies'), (req, res) => {
  const { getMoviesByGenre } = require('../services/catalogCategories');
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const genre = decodeURIComponent(req.params.genreName || '').trim();
  if (!genre) return res.status(400).json({ error: 'Género requerido' });
  res.json(getMoviesByGenre(genre, limit));
});

router.get('/hero', auth, requireAccess('movies'), async (req, res) => {
  const { getHeroSlides } = require('../services/heroSlides');
  try {
    const slides = await getHeroSlides(req.user);
    res.json(slides);
  } catch (err) {
    console.error('[movies/hero]', err);
    res.status(500).json({ error: 'No se pudo cargar el carrusel' });
  }
});

router.get('/:id/detail', auth, requireAccess('movies'), async (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ? AND COALESCE(available, 1) = 1').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Película no encontrada' });

  const meta = await getMovieDetailMeta(movie);

  let similar = [];
  if (movie.genre) {
    similar = db.prepare(`
      SELECT * FROM movies WHERE id != ? AND genre = ? AND COALESCE(available, 1) = 1
      ORDER BY rating DESC, recommended DESC, created_at DESC LIMIT 12
    `).all(movie.id, movie.genre);
  }
  if (similar.length < 8) {
    const extra = db.prepare(`
      SELECT * FROM movies WHERE id != ? AND COALESCE(available, 1) = 1
      ORDER BY rating DESC, recommended DESC, created_at DESC LIMIT 16
    `).all(movie.id);
    const ids = new Set(similar.map(m => m.id));
    for (const m of extra) {
      if (!ids.has(m.id)) {
        similar.push(m);
        ids.add(m.id);
      }
      if (similar.length >= 12) break;
    }
  }

  const rating = meta.rating ?? movie.rating ?? null;
  if (rating > 0) updateMovieRating.run(rating, movie.id);

  const video_path = resolvePlayablePath(movie.video_path);
  const subtitle_path = resolveSubtitlePath(movie.video_path, movie.subtitle_path);

  res.json({
    ...movie,
    video_path,
    subtitle_path,
    title: meta.title || movie.title,
    poster: meta.poster || '',
    rating,
    runtime: meta.runtime ?? null,
    cast: meta.cast || [],
    genres: meta.genres || [],
    synopsis: meta.synopsis || '',
    backdrop: meta.backdrop || meta.poster || '',
    trailer: meta.trailer || movie.trailer || '',
    similar
  });
});

router.get('/:id', auth, requireAccess('movies'), (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Película no encontrada' });
  res.json(movie);
});

router.post('/', auth, adminOnly, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  const { title, year, recommended, video_url } = req.body;
  if (!title) return res.status(400).json({ error: 'Título requerido' });

  let video_path = video_url || '';
  let absVideoPath = null;
  let processing = false;
  if (req.files?.video) {
    absVideoPath = path.join(moviesDir, req.files.video[0].filename);
    video_path = `/uploads/movies/${req.files.video[0].filename}`;
  }
  if (!video_path) return res.status(400).json({ error: 'Video o URL requeridos' });

  const result = db.prepare(`
    INSERT INTO movies (title, description, poster, video_path, genre, year, recommended)
    VALUES (?, '', '', ?, '', ?, ?)
  `).run(title, video_path, parseInt(year) || 0, recommended === '1' || recommended === true ? 1 : 0);

  try {
    await syncMovieFromTmdb(result.lastInsertRowid, { title, year: parseInt(year) || 0 });
  } catch (err) {
    db.prepare('DELETE FROM movies WHERE id = ?').run(result.lastInsertRowid);
    return res.status(err.status || 400).json({ error: err.message });
  }

  if (absVideoPath) {
    try {
      const prep = await prepareUploadedVideo(absVideoPath);
      const applied = applyVideoPrepResult(prep, result.lastInsertRowid, 'movie', video_path);
      video_path = applied.publicPath;
      processing = applied.processing;
    } catch (err) {
      console.error('[movies] videoPrep:', err.message);
      scheduleVideoPrep(absVideoPath, result.lastInsertRowid, 'movie');
      processing = true;
    }
  }

  res.json({ id: result.lastInsertRowid, video_path, processing });
});

router.put('/:id', auth, adminOnly, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Película no encontrada' });

  const { title, year, recommended, video_url } = req.body;
  let video_path = video_url || movie.video_path;
  let absVideoPath = null;
  let processing = false;
  if (req.files?.video) {
    if (movie.video_path && movie.video_path.startsWith('/uploads/')) {
      const old = path.join(__dirname, '..', '..', 'data', movie.video_path.replace('/uploads/', ''));
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    absVideoPath = path.join(moviesDir, req.files.video[0].filename);
    video_path = `/uploads/movies/${req.files.video[0].filename}`;
  }

  const searchTitle = title ?? movie.title;
  const searchYear = parseInt(year) || movie.year || 0;

  db.prepare(`
    UPDATE movies SET title=?, video_path=?, year=?, recommended=? WHERE id=?
  `).run(
    searchTitle,
    video_path,
    searchYear,
    recommended === '1' || recommended === true || recommended === 'true' ? 1 : (recommended === '0' || recommended === false ? 0 : movie.recommended),
    req.params.id
  );

  try {
    await syncMovieFromTmdb(req.params.id, { title: searchTitle, year: searchYear });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  if (absVideoPath) {
    try {
      const prep = await prepareUploadedVideo(absVideoPath);
      const applied = applyVideoPrepResult(prep, req.params.id, 'movie', video_path);
      video_path = applied.publicPath;
      processing = applied.processing;
    } catch (err) {
      console.error('[movies] videoPrep:', err.message);
      scheduleVideoPrep(absVideoPath, req.params.id, 'movie');
      processing = true;
    }
  }

  res.json({ ok: true, video_path, processing });
});

router.patch('/:id', auth, adminOnly, async (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).json({ error: 'Película no encontrada' });
  const { title, year, recommended } = req.body;
  const searchTitle = title ?? movie.title;
  const searchYear = parseInt(year) || movie.year || 0;
  db.prepare(`
    UPDATE movies SET title=?, year=?, recommended=? WHERE id=?
  `).run(
    searchTitle,
    searchYear,
    recommended !== undefined ? (recommended ? 1 : 0) : movie.recommended,
    req.params.id
  );
  try {
    await syncMovieFromTmdb(req.params.id, { title: searchTitle, year: searchYear });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  res.json({ ok: true });
});

router.delete('/:id', auth, adminOnly, (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (movie) {
    if (movie.poster) {
      const p = path.join(__dirname, '..', '..', 'data', movie.poster.replace('/uploads/', ''));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (movie.video_path) {
      const v = path.join(__dirname, '..', '..', 'data', movie.video_path.replace('/uploads/', ''));
      if (fs.existsSync(v)) fs.unlinkSync(v);
    }
  }
  db.prepare('DELETE FROM movies WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
