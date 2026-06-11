const express = require('express');
const db = require('../db');
const { auth, requireProfile } = require('../middleware/auth');

const router = express.Router();

const toggleItem = db.prepare(`
  INSERT INTO user_library (profile_id, content_type, content_id, list_type)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(profile_id, content_type, content_id, list_type) DO NOTHING
`);

const removeItem = db.prepare(`
  DELETE FROM user_library
  WHERE profile_id = ? AND content_type = ? AND content_id = ? AND list_type = ?
`);

const getStatus = db.prepare(`
  SELECT list_type FROM user_library
  WHERE profile_id = ? AND content_type = ? AND content_id = ?
`);

function enrichMovie(movie) {
  if (!movie || movie.available === 0) return null;
  return {
    id: movie.id,
    title: movie.title,
    poster: movie.poster,
    year: movie.year,
    genre: movie.genre,
    rating: movie.rating,
    video_path: movie.video_path,
    type: 'movie'
  };
}

function enrichSeries(series) {
  if (!series) return null;
  const epCount = db.prepare(`
    SELECT COUNT(*) as c FROM episodes
    WHERE series_id = ? AND COALESCE(available, 1) = 1
  `).get(series.id).c;
  if (!epCount) return null;
  return {
    id: series.id,
    title: series.title,
    poster: series.poster,
    genre: series.genre,
    rating: null,
    type: 'series'
  };
}

function getProfileKeys(profileId) {
  const rows = db.prepare(`
    SELECT content_type, content_id, list_type FROM user_library WHERE profile_id = ?
  `).all(profileId);

  const watchlist = [];
  const likes = [];
  rows.forEach((r) => {
    const key = `${r.content_type}-${r.content_id}`;
    if (r.list_type === 'watchlist') watchlist.push(key);
    if (r.list_type === 'like') likes.push(key);
  });
  return { watchlist, likes };
}

function getListItems(profileId, listType) {
  const rows = db.prepare(`
    SELECT content_type, content_id, created_at FROM user_library
    WHERE profile_id = ? AND list_type = ?
    ORDER BY created_at DESC
  `).all(profileId, listType);

  const items = [];
  for (const row of rows) {
    if (row.content_type === 'movie') {
      const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(row.content_id);
      const m = enrichMovie(movie);
      if (m) items.push(m);
    } else if (row.content_type === 'series') {
      const series = db.prepare('SELECT * FROM series WHERE id = ?').get(row.content_id);
      const s = enrichSeries(series);
      if (s) items.push(s);
    }
  }
  return items;
}

router.get('/', auth, requireProfile, (req, res) => {
  const keys = getProfileKeys(req.profileId);
  res.json({
    watchlist: keys.watchlist,
    likes: keys.likes,
    watchlist_count: keys.watchlist.length,
    likes_count: keys.likes.length
  });
});

router.get('/watchlist', auth, requireProfile, (req, res) => {
  res.json(getListItems(req.profileId, 'watchlist'));
});

router.get('/likes', auth, requireProfile, (req, res) => {
  res.json(getListItems(req.profileId, 'like'));
});

router.get('/status/:type/:id', auth, requireProfile, (req, res) => {
  const { type, id } = req.params;
  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  const rows = getStatus.all(req.profileId, type, parseInt(id, 10));
  res.json({
    in_watchlist: rows.some((r) => r.list_type === 'watchlist'),
    liked: rows.some((r) => r.list_type === 'like')
  });
});

router.post('/toggle', auth, requireProfile, (req, res) => {
  const { content_type, content_id, list_type } = req.body;
  if (!['movie', 'series'].includes(content_type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  if (!['watchlist', 'like'].includes(list_type)) {
    return res.status(400).json({ error: 'Lista inválida' });
  }

  const id = parseInt(content_id, 10);
  if (content_type === 'movie') {
    const movie = db.prepare('SELECT id FROM movies WHERE id = ? AND COALESCE(available, 1) = 1').get(id);
    if (!movie) return res.status(404).json({ error: 'Película no encontrada' });
  } else {
    const series = db.prepare('SELECT id FROM series WHERE id = ?').get(id);
    if (!series) return res.status(404).json({ error: 'Serie no encontrada' });
  }

  const existing = db.prepare(`
    SELECT id FROM user_library
    WHERE profile_id = ? AND content_type = ? AND content_id = ? AND list_type = ?
  `).get(req.profileId, content_type, id, list_type);

  if (existing) {
    removeItem.run(req.profileId, content_type, id, list_type);
    return res.json({ active: false, list_type, content_type, content_id: id });
  }

  toggleItem.run(req.profileId, content_type, id, list_type);
  res.json({ active: true, list_type, content_type, content_id: id });
});

module.exports = router;
