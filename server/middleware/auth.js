const jwt = require('jsonwebtoken');
const db = require('../db');
const { getUserRow, isAccountExpired, permissionsFromUser } = require('../services/userAccess');
const { getProfileForUser } = require('../services/profiles');

const JWT_SECRET = process.env.JWT_SECRET || 'xupertv-secret-key-change-me';

function attachUser(req, res, next) {
  const user = getUserRow(req.user.id);
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Cuenta inactiva o no encontrada' });
  }
  if (isAccountExpired(user)) {
    return res.status(403).json({ error: 'Tu cuenta ha expirado. Contacta al administrador.' });
  }
  req.account = user;
  req.user = {
    ...req.user,
    role: user.role,
    ...permissionsFromUser(user)
  };
  if (req.user.profileId) {
    const prof = getProfileForUser(req.user.profileId, user.id);
    if (prof) {
      req.profile = prof;
      req.profileId = prof.id;
    } else {
      req.user.profileId = null;
    }
  }
  next();
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    attachUser(req, res, next);
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireProfile(req, res, next) {
  if (!req.profileId) {
    return res.status(400).json({ error: 'Selecciona un perfil para continuar' });
  }
  next();
}

function requireAccess(area) {
  return (req, res, next) => {
    if (req.user.role === 'admin') return next();
    const key = area === 'live' ? 'can_live' : area === 'movies' ? 'can_movies' : 'can_series';
    if (!req.user[key]) {
      return res.status(403).json({ error: 'No tienes acceso a esta sección' });
    }
    next();
  };
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

module.exports = { auth, requireProfile, requireAccess, adminOnly, JWT_SECRET };
