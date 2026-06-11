const bcrypt = require('bcryptjs');
const db = require('../db');
const { getSetting, setSetting } = require('./settings');

const PROFILE_COLORS = ['#e50914', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#f06292'];

function ensureDefaultProfile(userId, name = 'Principal') {
  let row = db.prepare('SELECT * FROM profiles WHERE user_id = ? ORDER BY id LIMIT 1').get(userId);
  if (row) return row;
  const color = PROFILE_COLORS[userId % PROFILE_COLORS.length];
  const r = db.prepare(`
    INSERT INTO profiles (user_id, name, avatar_color) VALUES (?, ?, ?)
  `).run(userId, name, color);
  row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(r.lastInsertRowid);
  return row;
}

function listProfiles(userId, { ensureDefault = false } = {}) {
  if (ensureDefault) ensureDefaultProfile(userId);
  return db.prepare(
    'SELECT id, user_id, name, avatar_color, is_kids, created_at FROM profiles WHERE user_id = ? ORDER BY id'
  ).all(userId);
}

function countProfiles(userId) {
  return db.prepare('SELECT COUNT(*) as c FROM profiles WHERE user_id = ?').get(userId).c;
}

function isProfileSetupComplete(userId) {
  const row = db.prepare('SELECT profile_setup_complete FROM users WHERE id = ?').get(userId);
  return Number(row?.profile_setup_complete) === 1;
}

function markProfileSetupComplete(userId) {
  db.prepare('UPDATE users SET profile_setup_complete = 1 WHERE id = ?').run(userId);
}

function needsProfileSetup(userId) {
  return !isProfileSetupComplete(userId);
}

function getProfileForUser(profileId, userId) {
  return db.prepare('SELECT * FROM profiles WHERE id = ? AND user_id = ?').get(profileId, userId);
}

function hashPin(pin) {
  const raw = String(pin || '').trim();
  if (!/^\d{4}$/.test(raw)) return '';
  return bcrypt.hashSync(raw, 8);
}

function verifyPin(profile, pin) {
  if (!profile?.pin_hash) return true;
  const raw = String(pin || '').trim();
  if (!/^\d{4}$/.test(raw)) return false;
  return bcrypt.compareSync(raw, profile.pin_hash);
}

function createProfile(userId, { name, is_kids = false, pin = '' } = {}) {
  const color = PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)];
  const pinHash = is_kids ? hashPin(pin) : '';
  const r = db.prepare(`
    INSERT INTO profiles (user_id, name, avatar_color, is_kids, pin_hash) VALUES (?, ?, ?, ?, ?)
  `).run(userId, String(name || 'Perfil').trim().slice(0, 24), color, is_kids ? 1 : 0, pinHash || '');
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(r.lastInsertRowid);
}

function updateProfile(profileId, userId, { name, is_kids, pin } = {}) {
  const row = getProfileForUser(profileId, userId);
  if (!row) throw new Error('Perfil no encontrado');

  const nextName = String(name ?? row.name).trim().slice(0, 24);
  if (!nextName) throw new Error('Nombre requerido');

  const kids = is_kids !== undefined ? !!is_kids : !!row.is_kids;
  let pinHash = row.pin_hash || '';

  if (kids) {
    const rawPin = String(pin || '').trim();
    if (rawPin) {
      pinHash = hashPin(rawPin);
      if (!pinHash) throw new Error('El PIN debe tener 4 dígitos');
    } else if (!pinHash) {
      throw new Error('El perfil infantil requiere un PIN de 4 dígitos');
    }
  } else {
    pinHash = '';
  }

  db.prepare('UPDATE profiles SET name = ?, is_kids = ?, pin_hash = ? WHERE id = ?')
    .run(nextName, kids ? 1 : 0, pinHash, profileId);

  return db.prepare('SELECT id, user_id, name, avatar_color, is_kids, created_at FROM profiles WHERE id = ?')
    .get(profileId);
}

function deleteProfile(profileId, userId) {
  const count = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE user_id = ?').get(userId).c;
  if (count <= 1) throw new Error('Debe existir al menos un perfil');
  const row = getProfileForUser(profileId, userId);
  if (!row) throw new Error('Perfil no encontrado');
  db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
  return true;
}

function setLastProfile(userId, profileId) {
  db.prepare('UPDATE users SET last_profile_id = ? WHERE id = ?').run(profileId, userId);
}

function migrateUserDataToProfiles() {
  const whCols = db.prepare('PRAGMA table_info(watch_history)').all();
  if (whCols.some((c) => c.name === 'profile_id')) {
    dedupeMigratedProfileData();
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT 'Principal',
      avatar_color TEXT DEFAULT '#e50914',
      is_kids INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const users = db.prepare('SELECT id FROM users').all();
  for (const u of users) {
    ensureDefaultProfile(u.id);
  }

  db.exec(`
    CREATE TABLE watch_history_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      content_id INTEGER NOT NULL,
      series_id INTEGER,
      progress REAL NOT NULL DEFAULT 0,
      duration REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, content_type, content_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
    INSERT INTO watch_history_new (profile_id, content_type, content_id, series_id, progress, duration, updated_at)
    SELECT p.id, w.content_type, w.content_id, w.series_id, w.progress, w.duration, w.updated_at
    FROM watch_history w
    JOIN profiles p ON p.user_id = w.user_id
    ORDER BY p.user_id, p.id, w.id;
    DROP TABLE watch_history;
    ALTER TABLE watch_history_new RENAME TO watch_history;
  `);

  const libCols = db.prepare('PRAGMA table_info(user_library)').all();
  if (!libCols.some((c) => c.name === 'profile_id')) {
    db.exec(`
      CREATE TABLE user_library_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        content_type TEXT NOT NULL,
        content_id INTEGER NOT NULL,
        list_type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(profile_id, content_type, content_id, list_type),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );
      INSERT INTO user_library_new (profile_id, content_type, content_id, list_type, created_at)
      SELECT p.id, l.content_type, l.content_id, l.list_type, l.created_at
      FROM user_library l
      JOIN profiles p ON p.user_id = l.user_id;
      DROP TABLE user_library;
      ALTER TABLE user_library_new RENAME TO user_library;
    `);
  }

  dedupeMigratedProfileData();
}

/** Quita historial/favoritos duplicados por la migración user_id → todos los perfiles. */
function dedupeMigratedProfileData() {
  if (getSetting('profile_data_deduped_v1')) return;

  const multiUsers = db.prepare(`
    SELECT user_id FROM profiles GROUP BY user_id HAVING COUNT(*) > 1
  `).all();

  const delWatchDup = db.prepare(`
    DELETE FROM watch_history
    WHERE profile_id = ?
      AND EXISTS (
        SELECT 1 FROM watch_history k
        WHERE k.profile_id = ?
          AND k.content_type = watch_history.content_type
          AND k.content_id = watch_history.content_id
          AND k.progress = watch_history.progress
          AND k.duration = watch_history.duration
      )
  `);

  const delLibDup = db.prepare(`
    DELETE FROM user_library
    WHERE profile_id = ?
      AND EXISTS (
        SELECT 1 FROM user_library k
        WHERE k.profile_id = ?
          AND k.content_type = user_library.content_type
          AND k.content_id = user_library.content_id
          AND k.list_type = user_library.list_type
      )
  `);

  for (const { user_id } of multiUsers) {
    const profs = db.prepare('SELECT id FROM profiles WHERE user_id = ? ORDER BY id').all(user_id);
    const keepId = profs[0]?.id;
    if (!keepId) continue;
    for (let i = 1; i < profs.length; i++) {
      delWatchDup.run(profs[i].id, keepId);
      delLibDup.run(profs[i].id, keepId);
    }
  }

  setSetting('profile_data_deduped_v1', '1');
}

module.exports = {
  PROFILE_COLORS,
  hashPin,
  verifyPin,
  ensureDefaultProfile,
  listProfiles,
  countProfiles,
  isProfileSetupComplete,
  markProfileSetupComplete,
  needsProfileSetup,
  getProfileForUser,
  createProfile,
  updateProfile,
  deleteProfile,
  setLastProfile,
  migrateUserDataToProfiles,
  dedupeMigratedProfileData
};
