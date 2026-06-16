const express = require('express');
const fs = require('fs');
const path = require('path');
const { auth, adminOnly } = require('../middleware/auth');
const db = require('../db');
const {
  resolveMoviePoster,
  resolveSeriesPoster,
  posterCoverUrl,
  buildCoverSvg
} = require('../services/posters');
const { ensureBannerFile, bannerCachePath, invalidateBannerCache } = require('../services/bannerArt');

const router = express.Router();

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

router.get('/banner', async (req, res) => {
  const type = req.query.type === 'series' ? 'series' : 'movie';
  const id = parseInt(req.query.id, 10);
  if (!id) return res.status(400).json({ error: 'id requerido' });
  const table = type === 'series' ? 'series' : 'movies';
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  try {
    const filePath = await ensureBannerFile(row, type);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[posters/banner]', type, id, err.message || err);
    res.status(503).json({ error: 'Banner no disponible' });
  }
});

router.get('/banners/:filename', (req, res) => {
  const safe = path.basename(req.params.filename || '');
  const match = safe.match(/^(movie|series)-(\d+)\.jpg$/);
  if (!match) {
    return res.status(400).end();
  }
  const full = bannerCachePath(match[1], parseInt(match[2], 10));
  if (!fs.existsSync(full)) {
    return res.status(404).end();
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=604800');
  fs.createReadStream(full).pipe(res);
});

router.get('/cover', (req, res) => {
  const title = req.query.title || 'Película';
  const year = req.query.year || '';
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buildCoverSvg(title, year));
});

router.get('/cover.jpg', async (req, res) => {
  const title = req.query.title || 'Película';
  const year = req.query.year || '';
  if (!sharp) {
    return res.redirect(302, posterCoverUrl(title, year));
  }
  try {
    const buf = await sharp(Buffer.from(buildCoverSvg(title, year))).jpeg({ quality: 88 }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (err) {
    console.error('[posters/cover.jpg]', err.message || err);
    res.status(500).end();
  }
});

router.post('/refresh-movies', auth, adminOnly, async (req, res) => {
  const movies = db.prepare('SELECT id, title, year FROM movies').all();
  let updated = 0;
  for (const m of movies) {
    const poster = await resolveMoviePoster(m.title, m.year);
    db.prepare('UPDATE movies SET poster = ? WHERE id = ?').run(poster, m.id);
    invalidateBannerCache('movie', m.id);
    updated++;
  }
  res.json({ updated });
});

router.post('/refresh-series', auth, adminOnly, async (req, res) => {
  const series = db.prepare('SELECT id, title FROM series').all();
  let updated = 0;
  for (const s of series) {
    const poster = await resolveSeriesPoster(s.title);
    db.prepare('UPDATE series SET poster = ? WHERE id = ?').run(poster, s.id);
    invalidateBannerCache('series', s.id);
    updated++;
  }
  res.json({ updated });
});

module.exports = router;
