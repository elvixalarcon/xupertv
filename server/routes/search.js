const express = require('express');
const { auth } = require('../middleware/auth');
const { searchCatalog } = require('../services/search');
const { getProfileForUser } = require('../services/profiles');

const router = express.Router();

router.get('/', auth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ query: q, movies: [], series: [], live: [], total: 0 });
  let profile = null;
  if (req.profileId) {
    profile = getProfileForUser(req.profileId, req.user.id);
  }
  res.json(searchCatalog(q, profile, { limit: req.query.limit }));
});

module.exports = router;
