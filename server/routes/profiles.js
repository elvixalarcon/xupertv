const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { auth, JWT_SECRET } = require('../middleware/auth');
const { sanitizeUserPublic } = require('../services/userAccess');
const {
  listProfiles,
  countProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getProfileForUser,
  setLastProfile,
  markProfileSetupComplete,
  needsProfileSetup,
  verifyPin
} = require('../services/profiles');

const router = express.Router();
const MAX_PROFILES = 5;

router.get('/', auth, (req, res) => {
  res.json(listProfiles(req.user.id));
});

router.post('/setup', auth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 24);
  if (!name) {
    return res.status(400).json({ error: 'Escribe un nombre para tu perfil' });
  }

  let profile;
  const existing = listProfiles(req.user.id);

  if (existing.length === 0) {
    profile = createProfile(req.user.id, { name, is_kids: !!req.body.is_kids, pin: req.body.pin });
  } else if (existing.length === 1 && existing[0].name === 'Principal' && needsProfileSetup(req.user.id)) {
    db.prepare('UPDATE profiles SET name = ?, is_kids = ? WHERE id = ?').run(
      name,
      req.body.is_kids ? 1 : 0,
      existing[0].id
    );
    profile = getProfileForUser(existing[0].id, req.user.id);
  } else {
    profile = existing[0];
  }

  markProfileSetupComplete(req.user.id);
  setLastProfile(req.user.id, profile.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, profileId: profile.id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    profile: {
      id: profile.id,
      name: profile.name,
      avatar_color: profile.avatar_color,
      is_kids: profile.is_kids
    },
    user: sanitizeUserPublic(user),
    needsProfileSetup: false,
    needsProfilePick: false
  });
});

router.post('/', auth, (req, res) => {
  const count = countProfiles(req.user.id);
  if (count >= MAX_PROFILES) {
    return res.status(400).json({ error: `Máximo ${MAX_PROFILES} perfiles por cuenta` });
  }
  const name = String(req.body.name || 'Perfil').trim();
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const isKids = !!req.body.is_kids;
  if (isKids && !String(req.body.pin || '').trim()) {
    return res.status(400).json({ error: 'El perfil infantil requiere un PIN de 4 dígitos' });
  }
  try {
    const profile = createProfile(req.user.id, { name, is_kids: isKids, pin: req.body.pin });
    res.json({
      id: profile.id,
      name: profile.name,
      avatar_color: profile.avatar_color,
      is_kids: profile.is_kids,
      created_at: profile.created_at
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'No se pudo crear el perfil' });
  }
});

router.patch('/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const profile = updateProfile(id, req.user.id, {
      name: req.body.name,
      is_kids: req.body.is_kids,
      pin: req.body.pin
    });
    res.json(profile);
  } catch (e) {
    res.status(400).json({ error: e.message || 'No se pudo actualizar el perfil' });
  }
});

router.post('/select', auth, (req, res) => {
  const profileId = parseInt(req.body.profileId, 10);
  if (!profileId) return res.status(400).json({ error: 'Perfil requerido' });
  const profile = getProfileForUser(profileId, req.user.id);
  if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });

  const current = req.profileId ? getProfileForUser(req.profileId, req.user.id) : null;
  if (current?.is_kids && !profile.is_kids) {
    if (!verifyPin(current, req.body.pin)) {
      return res.status(403).json({ error: 'PIN incorrecto', needs_pin: true });
    }
  }
  setLastProfile(req.user.id, profileId);
  markProfileSetupComplete(req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, profileId: profile.id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    token,
    profile: { id: profile.id, name: profile.name, avatar_color: profile.avatar_color, is_kids: profile.is_kids },
    user: sanitizeUserPublic(user),
    needsProfileSetup: false,
    needsProfilePick: false
  });
});

router.delete('/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.user.profileId === id) {
    return res.status(400).json({ error: 'No puedes eliminar el perfil activo' });
  }
  try {
    deleteProfile(id, req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
