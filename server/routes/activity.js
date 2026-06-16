const express = require('express');
const { auth } = require('../middleware/auth');
const {
  setActivity,
  clearActivity,
  ensureSessionAllowed,
  maxConnectionsForUser,
  normalizeSessionKey
} = require('../services/activity');

const router = express.Router();

router.post('/heartbeat', auth, (req, res) => {
  const {
    status = 'browsing',
    page = '',
    title = '',
    content_type: contentType = '',
    content_id: contentId = null,
    progress = 0,
    duration = 0,
    session_key: sessionKey = 'main'
  } = req.body;

  const sid = normalizeSessionKey(req.user.id, String(sessionKey || 'main').slice(0, 64), {
    status,
    page,
    title,
    contentType,
    contentId
  });
  const maxConn = maxConnectionsForUser(req.user.id);
  if (!ensureSessionAllowed(req.user.id, sid)) {
    return res.status(429).json({
      error: `Límite de conexiones alcanzado (máx. ${maxConn})`,
      max_connections: maxConn
    });
  }

  setActivity(req.user.id, {
    username: req.user.username,
    role: req.user.role,
    profileId: req.user.profileId || null,
    status,
    page,
    title,
    contentType,
    contentId,
    progress: Number(progress) || 0,
    duration: Number(duration) || 0
  }, sid);

  res.json({ ok: true, max_connections: maxConn });
});

router.post('/offline', auth, (req, res) => {
  const sessionKey = req.body?.session_key ? String(req.body.session_key).slice(0, 64) : null;
  clearActivity(req.user.id, sessionKey);
  res.json({ ok: true });
});

module.exports = router;
