const db = require('../db');

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function getTmdbApiKey() {
  return getSetting('tmdb_api_key') || process.env.TMDB_API_KEY || '';
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return '••••••••' + key.slice(-4);
}

module.exports = { getSetting, setSetting, getTmdbApiKey, maskKey };
