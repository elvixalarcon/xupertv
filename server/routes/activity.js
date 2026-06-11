const express = require('express');
const { auth } = require('../middleware/auth');
const { setActivity, clearActivity } = require('../services/activity');

const router = express.Router();

router.post('/heartbeat', auth, (req, res) => {
  const {
    status = 'browsing',
    page = '',
    title = '',
    content_type: contentType = '',
    content_id: contentId = null,
    progress = 0,
    duration = 0
  } = req.body;

  setActivity(req.user.id, {
    username: req.user.username,
    role: req.user.role,
    status,
    page,
    title,
    contentType,
    contentId,
    progress: Number(progress) || 0,
    duration: Number(duration) || 0
  });

  res.json({ ok: true });
});

router.post('/offline', auth, (req, res) => {
  clearActivity(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
