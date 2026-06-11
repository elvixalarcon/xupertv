const express = require('express');
const db = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, body, type, read, created_at
    FROM notifications
    WHERE user_id IS NULL OR user_id = ?
    ORDER BY created_at DESC LIMIT 30
  `).all(req.user.id);
  res.json(rows);
});

router.post('/:id/read', auth, (req, res) => {
  db.prepare(`
    UPDATE notifications SET read = 1
    WHERE id = ? AND (user_id IS NULL OR user_id = ?)
  `).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

router.post('/broadcast', auth, adminOnly, (req, res) => {
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const type = String(req.body.type || 'info').trim();
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  const r = db.prepare(`
    INSERT INTO notifications (user_id, title, body, type) VALUES (NULL, ?, ?, ?)
  `).run(title, body, type);
  res.json({ id: r.lastInsertRowid, ok: true });
});

module.exports = router;
