const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { auth, adminOnly, JWT_SECRET } = require('../middleware/auth');
const {
  isAccountExpired,
  sanitizeUserPublic,
  computeExpiresAt,
  expiryLabel,
  permissionsFromUser,
  getMaxConnections
} = require('../services/userAccess');
const {
  listProfiles,
  setLastProfile,
  needsProfileSetup,
  markProfileSetupComplete,
  ensureDefaultProfile
} = require('../services/profiles');
const { countConnectionsByUser } = require('../services/activity');

const router = express.Router();
const MIN_PASSWORD_LEN = 4;

function validateNewPassword(password) {
  const pw = String(password || '');
  if (pw.length < MIN_PASSWORD_LEN) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres`;
  }
  return null;
}

function issueToken(user, profileId = null) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, profileId: profileId || null },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function pickInitialProfile(user, profiles) {
  if (needsProfileSetup(user.id)) return null;
  if (!profiles.length) return null;
  if (user.last_profile_id) {
    const last = profiles.find((p) => p.id === user.last_profile_id);
    if (last) return last.id;
  }
  if (user.role === 'admin' || profiles.length === 1) {
    return profiles[0].id;
  }
  return null;
}

function profileFlags(user, profiles, profileId) {
  const setupRequired = needsProfileSetup(user.id);
  return {
    needsProfileSetup: setupRequired,
    needsProfilePick: !setupRequired && !profileId && profiles.length > 1
  };
}

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  if (isAccountExpired(user)) {
    return res.status(403).json({ error: 'Tu cuenta ha expirado. Contacta al administrador.' });
  }
  const profiles = listProfiles(user.id);
  if (!profiles.length) {
    ensureDefaultProfile(user.id, user.display_name || user.username || 'Principal');
  }
  const profilesAfter = listProfiles(user.id);
  if (profilesAfter.length && needsProfileSetup(user.id)) {
    markProfileSetupComplete(user.id);
  }
  const profileId = pickInitialProfile(user, profilesAfter);
  if (profileId) setLastProfile(user.id, profileId);
  const token = issueToken(user, profileId);
  const flags = profileFlags(user, profilesAfter, profileId);
  res.json({
    token,
    user: sanitizeUserPublic(user),
    profiles: profilesAfter,
    profile: profileId ? profilesAfter.find((p) => p.id === profileId) : null,
    ...flags
  });
});

router.post('/change-password', auth, (req, res) => {
  const { current_password, new_password } = req.body;
  const pwErr = validateNewPassword(new_password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (!current_password) {
    return res.status(400).json({ error: 'Indica tu contraseña actual' });
  }
  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(current_password, user.password)) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const profiles = listProfiles(req.user.id, { ensureDefault: true });
  let profile = null;
  if (req.profileId) {
    profile = profiles.find((p) => p.id === req.profileId) || null;
  }
  const flags = profileFlags(user, profiles, req.profileId || null);
  res.json({
    ...sanitizeUserPublic(user),
    profile,
    profiles,
    ...flags
  });
});

router.get('/users', auth, adminOnly, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.active, u.created_at, u.expires_at,
           u.can_live, u.can_movies, u.can_series, u.max_connections,
           COALESCE(NULLIF(TRIM(u.display_name), ''),
             (SELECT p.name FROM profiles p WHERE p.user_id = u.id ORDER BY p.id LIMIT 1),
             '') AS display_name
    FROM users u ORDER BY u.id
  `).all();
  const connCounts = countConnectionsByUser();
  res.json(users.map((u) => ({
    ...u,
    expiry_label: expiryLabel(u),
    can_live: Number(u.can_live) !== 0,
    can_movies: Number(u.can_movies) !== 0,
    can_series: Number(u.can_series) !== 0,
    max_connections: getMaxConnections(u),
    active_connections: connCounts.get(u.id) || 0
  })));
});

router.post('/users', auth, adminOnly, (req, res) => {
  const {
    username,
    password,
    role = 'user',
    expiry = 'never',
    can_live = true,
    can_movies = true,
    can_series = true,
    max_connections = 5,
    display_name = ''
  } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }
  if (role === 'admin' && username !== 'admin') {
    return res.status(400).json({ error: 'Solo puede existir la cuenta admin principal' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const expires_at = computeExpiresAt(expiry);
    const maxConn = Math.min(20, Math.max(1, parseInt(max_connections, 10) || 5));
    const result = db.prepare(`
      INSERT INTO users (username, password, role, expires_at, can_live, can_movies, can_series, max_connections, display_name, profile_setup_complete)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      username,
      hash,
      role,
      expires_at,
      can_live ? 1 : 0,
      can_movies ? 1 : 0,
      can_series ? 1 : 0,
      maxConn,
      String(display_name || '').trim().slice(0, 80)
    );
    const userId = result.lastInsertRowid;
    ensureDefaultProfile(userId, String(display_name || username || 'Principal').trim().slice(0, 24) || 'Principal');
    res.json({
      id: userId,
      username,
      role,
      expires_at,
      expiry_label: expiryLabel({ expires_at }),
      can_live: !!can_live,
      can_movies: !!can_movies,
      can_series: !!can_series,
      max_connections: maxConn
    });
  } catch {
    res.status(400).json({ error: 'El usuario ya existe' });
  }
});

router.delete('/users/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.post('/users/:id/reset-password', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { password } = req.body;
  const pwErr = validateNewPassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, id);
  res.json({ ok: true, username: target.username });
});

router.patch('/users/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const {
    username,
    password,
    active,
    role,
    expiry,
    can_live,
    can_movies,
    can_series,
    max_connections
  } = req.body;
  const displayName = req.body.display_name;

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (username !== undefined) {
    const next = String(username || '').trim();
    if (!next) return res.status(400).json({ error: 'Usuario inválido' });
    if (target.username === 'admin' && next !== 'admin') {
      return res.status(400).json({ error: 'No se puede renombrar la cuenta admin' });
    }
    if (role === 'admin' && next !== 'admin') {
      return res.status(400).json({ error: 'Solo puede existir la cuenta admin principal' });
    }
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(next, id);
    if (taken) return res.status(400).json({ error: 'Ese usuario ya existe' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(next, id);
  }

  if (password) {
    const pwErr = validateNewPassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, id);
  }
  if (active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }
  if (role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (expiry !== undefined) {
    const expires_at = computeExpiresAt(expiry);
    db.prepare('UPDATE users SET expires_at = ? WHERE id = ?').run(expires_at, id);
  }
  if (can_live !== undefined) {
    db.prepare('UPDATE users SET can_live = ? WHERE id = ?').run(can_live ? 1 : 0, id);
  }
  if (can_movies !== undefined) {
    db.prepare('UPDATE users SET can_movies = ? WHERE id = ?').run(can_movies ? 1 : 0, id);
  }
  if (can_series !== undefined) {
    db.prepare('UPDATE users SET can_series = ? WHERE id = ?').run(can_series ? 1 : 0, id);
  }
  if (max_connections !== undefined) {
    const maxConn = Math.min(20, Math.max(1, parseInt(max_connections, 10) || 5));
    db.prepare('UPDATE users SET max_connections = ? WHERE id = ?').run(maxConn, id);
  }
  if (displayName !== undefined) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?')
      .run(String(displayName || '').trim().slice(0, 80), id);
  }

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({
    ok: true,
    user: {
      id: updated.id,
      username: updated.username,
      display_name: updated.display_name || '',
      role: updated.role,
      active: updated.active,
      expires_at: updated.expires_at,
      expiry_label: expiryLabel(updated),
      can_live: Number(updated.can_live) !== 0,
      can_movies: Number(updated.can_movies) !== 0,
      can_series: Number(updated.can_series) !== 0,
      max_connections: getMaxConnections(updated)
    }
  });
});

module.exports = router;
