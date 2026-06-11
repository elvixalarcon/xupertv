const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { auth, adminOnly, requireAccess } = require('../middleware/auth');
const {
  syncSeriesFromTmdb,
  syncEpisodeFromTmdb,
  getSeriesDetailMeta
} = require('../services/tmdbMetadata');
const { prepareUploadedVideo, scheduleVideoPrep, applyVideoPrepResult } = require('../services/videoPrep');
const { resolvePlayablePath, resolveSubtitlePath } = require('../services/playablePath');

const router = express.Router();
const seriesDir = path.join(__dirname, '..', '..', 'data', 'series');
const postersDir = path.join(__dirname, '..', '..', 'data', 'posters');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (file.fieldname === 'poster' || file.fieldname === 'series_poster') cb(null, postersDir);
    else cb(null, seriesDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } });

router.get('/', auth, requireAccess('series'), (req, res) => {
  const series = db.prepare(`
    SELECT DISTINCT s.* FROM series s
    INNER JOIN episodes e ON e.series_id = s.id AND COALESCE(e.available, 1) = 1
    ORDER BY s.created_at DESC
  `).all();
  res.json(series);
});

router.get('/hero', auth, requireAccess('series'), async (req, res) => {
  try {
    const { getSeriesHeroSlides } = require('../services/heroSlides');
    res.json(await getSeriesHeroSlides(req.user));
  } catch (err) {
    console.error('[series/hero]', err);
    res.status(500).json({ error: 'No se pudo cargar el carrusel' });
  }
});

router.get('/genre-rows', auth, requireAccess('series'), (req, res) => {
  const { getSeriesGenreRows } = require('../services/catalogCategories');
  const limit = Math.min(40, Math.max(4, parseInt(req.query.limit, 10) || 24));
  res.json(getSeriesGenreRows({ limitPerGenre: limit }));
});

router.get('/by-genre', auth, requireAccess('series'), (req, res) => {
  const { getSeriesByGenre } = require('../services/catalogCategories');
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const genre = String(req.query.genre || '').trim();
  if (!genre) return res.status(400).json({ error: 'Género requerido' });
  res.json(getSeriesByGenre(genre, limit));
});

router.get('/genre/:genreName', auth, requireAccess('series'), (req, res) => {
  const { getSeriesByGenre } = require('../services/catalogCategories');
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const genre = decodeURIComponent(req.params.genreName || '').trim();
  if (!genre) return res.status(400).json({ error: 'Género requerido' });
  res.json(getSeriesByGenre(genre, limit));
});

router.get('/admin/list', auth, adminOnly, (req, res) => {
  const series = db.prepare(`
    SELECT s.*,
      COUNT(e.id) AS episode_count,
      COUNT(DISTINCT e.season) AS season_count,
      SUM(CASE WHEN COALESCE(e.available, 1) = 0 THEN 1 ELSE 0 END) AS pending_episodes
    FROM series s
    LEFT JOIN episodes e ON e.series_id = s.id
    GROUP BY s.id
    ORDER BY s.title COLLATE NOCASE ASC
  `).all();
  res.json(series.map((s) => ({
    ...s,
    pending_episodes: s.pending_episodes || 0
  })));
});

router.get('/:id/admin', auth, adminOnly, (req, res) => {
  const { getEpisodeDownloadProgress } = require('../services/vodDownloadProgress');
  const s = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Serie no encontrada' });
  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE series_id = ? ORDER BY season, episode'
  ).all(req.params.id);
  res.json({
    ...s,
    episodes: episodes.map((ep) => ({
      ...ep,
      video_quality: ep.video_quality || null,
      download_progress: Number(ep.available) === 0 ? getEpisodeDownloadProgress(ep) : null
    }))
  });
});

router.get('/:id/detail', auth, requireAccess('series'), async (req, res) => {
  const s = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Serie no encontrada' });

  const episodes = db.prepare(
    'SELECT * FROM episodes WHERE series_id = ? AND COALESCE(available, 1) = 1 ORDER BY season, episode'
  ).all(req.params.id);
  if (!episodes.length) return res.status(404).json({ error: 'Serie no disponible aún' });

  const meta = await getSeriesDetailMeta(s, episodes);

  let similar = [];
  if (s.genre) {
    similar = db.prepare(`
      SELECT * FROM series WHERE id != ? AND genre = ?
      ORDER BY created_at DESC LIMIT 12
    `).all(s.id, s.genre);
  }
  if (similar.length < 8) {
    const extra = db.prepare(`
      SELECT * FROM series WHERE id != ?
      ORDER BY created_at DESC LIMIT 16
    `).all(s.id);
    const ids = new Set(similar.map(x => x.id));
    for (const item of extra) {
      if (!ids.has(item.id)) {
        similar.push(item);
        ids.add(item.id);
      }
      if (similar.length >= 12) break;
    }
  }

  res.json({
    ...s,
    title: meta.title || s.title,
    poster: meta.poster || '',
    rating: meta.rating ?? null,
    seasons: meta.seasons ?? null,
    episodes_count: meta.episodes_count ?? episodes.length,
    status: meta.status || '',
    year: meta.year ?? null,
    cast: meta.cast || [],
    genres: meta.genres || [],
    synopsis: meta.synopsis || '',
    backdrop: meta.backdrop || meta.poster || '',
    trailer: meta.trailer || s.trailer || '',
    episodes: (meta.episodes || episodes).map((ep) => ({
      ...ep,
      video_path: resolvePlayablePath(ep.video_path),
      subtitle_path: resolveSubtitlePath(ep.video_path, ep.subtitle_path)
    })),
    similar
  });
});

router.get('/:id', auth, requireAccess('series'), (req, res) => {
  const s = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Serie no encontrada' });
  const episodes = db.prepare('SELECT * FROM episodes WHERE series_id = ? ORDER BY season, episode').all(req.params.id);
  res.json({ ...s, episodes });
});

router.post('/', auth, adminOnly, upload.single('series_poster'), async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  const result = db.prepare('INSERT INTO series (title, description, poster, genre) VALUES (?, ?, ?, ?)')
    .run(title, '', '', '');
  try {
    await syncSeriesFromTmdb(result.lastInsertRowid, { title });
  } catch (err) {
    db.prepare('DELETE FROM series WHERE id = ?').run(result.lastInsertRowid);
    return res.status(err.status || 400).json({ error: err.message });
  }
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', auth, adminOnly, upload.single('series_poster'), async (req, res) => {
  const s = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Serie no encontrada' });
  const title = req.body.title ?? s.title;
  const genre = req.body.genre ?? s.genre;
  const description = req.body.description ?? s.description;
  const allcalidad_slug = (req.body.allcalidad_slug ?? s.allcalidad_slug ?? '').trim();
  let poster = req.body.poster_url ?? s.poster;
  if (req.file) poster = `/uploads/posters/${req.file.filename}`;
  db.prepare(`
    UPDATE series SET title = ?, genre = ?, description = ?, poster = ?, allcalidad_slug = ?
    WHERE id = ?
  `).run(title, genre, description, poster, allcalidad_slug, req.params.id);
  try {
    await syncSeriesFromTmdb(req.params.id, { title });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  res.json({ ok: true });
});

router.patch('/:id', auth, adminOnly, async (req, res) => {
  const s = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Serie no encontrada' });
  const searchTitle = req.body.title ?? s.title;
  db.prepare('UPDATE series SET title=? WHERE id=?').run(searchTitle, req.params.id);
  try {
    await syncSeriesFromTmdb(req.params.id, { title: searchTitle });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  res.json({ ok: true });
});

router.put('/:id/episodes/:epId', auth, adminOnly, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  const ep = db.prepare('SELECT * FROM episodes WHERE id = ? AND series_id = ?').get(req.params.epId, req.params.id);
  if (!ep) return res.status(404).json({ error: 'Episodio no encontrado' });
  const { season, episode, video_url } = req.body;
  let video_path = video_url || ep.video_path;
  let absVideoPath = null;
  let processing = false;
  if (req.files?.video) {
    if (ep.video_path && ep.video_path.startsWith('/uploads/')) {
      const old = path.join(__dirname, '..', '..', 'data', ep.video_path.replace('/uploads/', ''));
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    absVideoPath = path.join(seriesDir, req.files.video[0].filename);
    video_path = `/uploads/series/${req.files.video[0].filename}`;
  }
  db.prepare(`
    UPDATE episodes SET season=?, episode=?, video_path=? WHERE id=?
  `).run(
    parseInt(season) || ep.season,
    parseInt(episode) || ep.episode,
    video_path,
    ep.id
  );

  try {
    await syncEpisodeFromTmdb(ep.id);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  if (absVideoPath) {
    try {
      const prep = await prepareUploadedVideo(absVideoPath);
      const applied = applyVideoPrepResult(prep, ep.id, 'episode', video_path);
      video_path = applied.publicPath;
      processing = applied.processing;
    } catch (err) {
      console.error('[series] videoPrep:', err.message);
      scheduleVideoPrep(absVideoPath, ep.id, 'episode');
      processing = true;
    }
  }

  res.json({ ok: true, video_path, processing });
});

router.delete('/:id/episodes/:epId', auth, adminOnly, (req, res) => {
  const ep = db.prepare('SELECT * FROM episodes WHERE id = ? AND series_id = ?').get(req.params.epId, req.params.id);
  if (!ep) return res.status(404).json({ error: 'Episodio no encontrado' });
  [ep.poster, ep.video_path].forEach(f => {
    if (f && f.startsWith('/uploads/')) {
      const p = path.join(__dirname, '..', '..', 'data', f.replace('/uploads/', ''));
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });
  db.prepare('DELETE FROM episodes WHERE id = ?').run(ep.id);
  res.json({ ok: true });
});

router.post('/:id/episodes', auth, adminOnly, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  const { season, episode, video_url } = req.body;
  let video_path = video_url || '';
  let absVideoPath = null;
  let processing = false;
  if (req.files?.video) {
    absVideoPath = path.join(seriesDir, req.files.video[0].filename);
    video_path = `/uploads/series/${req.files.video[0].filename}`;
  }
  if (!video_path) return res.status(400).json({ error: 'Video o URL requeridos' });
  const result = db.prepare(`
    INSERT INTO episodes (series_id, season, episode, title, description, poster, video_path)
    VALUES (?, ?, ?, '', '', '', ?)
  `).run(req.params.id, parseInt(season) || 1, parseInt(episode) || 1, video_path);

  try {
    await syncEpisodeFromTmdb(result.lastInsertRowid);
  } catch (err) {
    db.prepare('DELETE FROM episodes WHERE id = ?').run(result.lastInsertRowid);
    return res.status(err.status || 400).json({ error: err.message });
  }

  if (absVideoPath) {
    try {
      const prep = await prepareUploadedVideo(absVideoPath);
      const applied = applyVideoPrepResult(prep, result.lastInsertRowid, 'episode', video_path);
      video_path = applied.publicPath;
      processing = applied.processing;
    } catch (err) {
      console.error('[series] videoPrep:', err.message);
      scheduleVideoPrep(absVideoPath, result.lastInsertRowid, 'episode');
      processing = true;
    }
  }

  res.json({ id: result.lastInsertRowid, video_path, processing });
});

router.delete('/:id', auth, adminOnly, (req, res) => {
  const episodes = db.prepare('SELECT * FROM episodes WHERE series_id = ?').all(req.params.id);
  episodes.forEach(ep => {
    [ep.poster, ep.video_path].forEach(f => {
      if (f) {
        const p = path.join(__dirname, '..', '..', 'data', f.replace('/uploads/', ''));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    });
  });
  const s = db.prepare('SELECT poster FROM series WHERE id = ?').get(req.params.id);
  if (s?.poster) {
    const p = path.join(__dirname, '..', '..', 'data', s.poster.replace('/uploads/', ''));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.prepare('DELETE FROM series WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
