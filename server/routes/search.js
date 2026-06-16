const express = require('express');
const { auth } = require('../middleware/auth');
const { searchCatalog } = require('../services/search');
const { searchExternalCatalog } = require('../services/externalCatalog');
const { getProfileForUser } = require('../services/profiles');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ query: q, movies: [], series: [], live: [], total: 0 });
  let profile = null;
  if (req.profileId) {
    profile = getProfileForUser(req.profileId, req.user.id);
  }
  const local = searchCatalog(q, profile, { limit: req.query.limit });
  const external = await searchExternalCatalog(q, req.query.limit);
  const extMovies = (external.movies || []).map((it) => ({
    ...it,
    id: `external:${it.source}:${it.slug}`,
    content_type: 'movie',
    external: true
  }));
  const extSeries = (external.series || []).map((it) => ({
    ...it,
    id: `external:${it.source}:${it.slug}`,
    content_type: 'series',
    external: true
  }));
  res.json({
    ...local,
    movies: [...extMovies, ...(local.movies || [])].slice(0, Math.min(40, parseInt(req.query.limit, 10) || 20)),
    series: [...extSeries, ...(local.series || [])].slice(0, Math.min(40, parseInt(req.query.limit, 10) || 20)),
    total: (local.total || 0) + extMovies.length + extSeries.length
  });
});

module.exports = router;
