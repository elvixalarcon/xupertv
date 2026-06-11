const db = require('../db');

function getUserRow(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function isAccountExpired(user) {
  if (!user?.expires_at) return false;
  return new Date(user.expires_at) < new Date();
}

function permissionsFromUser(user) {
  return {
    can_live: user.role === 'admin' || Number(user.can_live) !== 0,
    can_movies: user.role === 'admin' || Number(user.can_movies) !== 0,
    can_series: user.role === 'admin' || Number(user.can_series) !== 0
  };
}

function expiryLabel(user) {
  if (!user.expires_at) return 'Sin expiración';
  const d = new Date(user.expires_at);
  return d.toLocaleDateString('es-EC', { dateStyle: 'medium' });
}

function computeExpiresAt(expiryMode) {
  if (expiryMode === '30d' || expiryMode === '30') {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString();
  }
  return null;
}

function sanitizeUserPublic(user) {
  const perms = permissionsFromUser(user);
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: user.active,
    expires_at: user.expires_at || null,
    expiry_label: expiryLabel(user),
    ...perms
  };
}

module.exports = {
  getUserRow,
  isAccountExpired,
  permissionsFromUser,
  expiryLabel,
  computeExpiresAt,
  sanitizeUserPublic
};
