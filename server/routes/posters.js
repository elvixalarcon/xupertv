const express = require('express');
const fs = require('fs');
const path = require('path');
const { auth, adminOnly } = require('../middleware/auth');
const db = require('../db');
const { resolveMoviePoster, resolveSeriesPoster, posterCoverUrl } = require('../services/posters');
const { ensureBannerFile, bannerCachePath } = require('../services/bannerArt');

const router = express.Router();

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapTitle(title, maxLen = 22) {
  const words = String(title || 'Película').split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxLen && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
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
  const lines = wrapTitle(title);
  const hash = title.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = hash % 360;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:hsl(${hue},45%,18%)"/>
      <stop offset="100%" style="stop-color:hsl(${(hue + 40) % 360},55%,28%)"/>
    </linearGradient>
    <linearGradient id="shine" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.12"/>
      <stop offset="100%" style="stop-color:#ffffff;stop-opacity:0"/>
    </linearGradient>
  </defs>
  <rect width="300" height="450" fill="url(#bg)"/>
  <rect width="300" height="450" fill="url(#shine)"/>
  <rect x="20" y="20" width="260" height="410" rx="8" fill="none" stroke="#f5c518" stroke-opacity="0.25" stroke-width="2"/>
  <text x="150" y="180" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" fill="#f5c518" opacity="0.9">🎬</text>
  ${lines.map((l, i) => `<text x="150" y="${240 + i * 32}" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="#ffffff">${escapeXml(l)}</text>`).join('\n  ')}
  ${year ? `<text x="150" y="400" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#f5c518" opacity="0.85">${escapeXml(year)}</text>` : ''}
  <text x="150" y="430" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#8888aa">Vix TV</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

router.post('/refresh-movies', auth, adminOnly, async (req, res) => {
  const movies = db.prepare('SELECT id, title, year FROM movies').all();
  let updated = 0;
  for (const m of movies) {
    const poster = await resolveMoviePoster(m.title, m.year);
    db.prepare('UPDATE movies SET poster = ? WHERE id = ?').run(poster, m.id);
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
    updated++;
  }
  res.json({ updated });
});

module.exports = router;
