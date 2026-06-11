const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'xupertv.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    poster TEXT DEFAULT '',
    video_path TEXT NOT NULL,
    genre TEXT DEFAULT '',
    year INTEGER DEFAULT 0,
    recommended INTEGER DEFAULT 0,
    rating REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    poster TEXT DEFAULT '',
    genre TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER NOT NULL,
    season INTEGER DEFAULT 1,
    episode INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    poster TEXT DEFAULT '',
    video_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS live_playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    m3u_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS live_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    logo TEXT DEFAULT '',
    stream_url TEXT NOT NULL,
    group_title TEXT DEFAULT 'General',
    FOREIGN KEY (playlist_id) REFERENCES live_playlists(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, type)
  );

  CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    content_id INTEGER NOT NULL,
    series_id INTEGER,
    progress REAL NOT NULL DEFAULT 0,
    duration REAL NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_type, content_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    content_id INTEGER NOT NULL,
    list_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_type, content_id, list_type),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!admin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
}

const movieCols = db.prepare('PRAGMA table_info(movies)').all();
if (!movieCols.some(c => c.name === 'rating')) {
  db.exec('ALTER TABLE movies ADD COLUMN rating REAL DEFAULT 0');
}
if (!movieCols.some(c => c.name === 'available')) {
  db.exec('ALTER TABLE movies ADD COLUMN available INTEGER DEFAULT 1');
}
if (!movieCols.some(c => c.name === 'tmdb_id')) {
  db.exec('ALTER TABLE movies ADD COLUMN tmdb_id INTEGER DEFAULT NULL');
}
if (!movieCols.some(c => c.name === 'trailer')) {
  db.exec("ALTER TABLE movies ADD COLUMN trailer TEXT DEFAULT ''");
}
if (!movieCols.some(c => c.name === 'video_quality')) {
  db.exec("ALTER TABLE movies ADD COLUMN video_quality TEXT DEFAULT ''");
}

const seriesCols = db.prepare('PRAGMA table_info(series)').all();
if (!seriesCols.some(c => c.name === 'tmdb_id')) {
  db.exec('ALTER TABLE series ADD COLUMN tmdb_id INTEGER DEFAULT NULL');
}
if (!seriesCols.some(c => c.name === 'year')) {
  db.exec('ALTER TABLE series ADD COLUMN year INTEGER DEFAULT 0');
}
if (!seriesCols.some(c => c.name === 'allcalidad_slug')) {
  db.exec("ALTER TABLE series ADD COLUMN allcalidad_slug TEXT DEFAULT ''");
}
if (!seriesCols.some(c => c.name === 'trailer')) {
  db.exec("ALTER TABLE series ADD COLUMN trailer TEXT DEFAULT ''");
}
if (!seriesCols.some(c => c.name === 'rating')) {
  db.exec('ALTER TABLE series ADD COLUMN rating REAL DEFAULT 0');
}
if (!seriesCols.some(c => c.name === 'platform')) {
  db.exec("ALTER TABLE series ADD COLUMN platform TEXT DEFAULT ''");
}

const epCols = db.prepare('PRAGMA table_info(episodes)').all();
if (!epCols.some(c => c.name === 'available')) {
  db.exec('ALTER TABLE episodes ADD COLUMN available INTEGER DEFAULT 1');
}
if (!epCols.some(c => c.name === 'video_quality')) {
  db.exec("ALTER TABLE episodes ADD COLUMN video_quality TEXT DEFAULT ''");
}
if (!epCols.some(c => c.name === 'subtitle_path')) {
  db.exec("ALTER TABLE episodes ADD COLUMN subtitle_path TEXT DEFAULT ''");
}

if (!movieCols.some(c => c.name === 'subtitle_path')) {
  db.exec("ALTER TABLE movies ADD COLUMN subtitle_path TEXT DEFAULT ''");
}
if (!movieCols.some(c => c.name === 'platform')) {
  db.exec("ALTER TABLE movies ADD COLUMN platform TEXT DEFAULT ''");
}

const profCols = db.prepare('PRAGMA table_info(profiles)').all();
if (profCols.length && !profCols.some(c => c.name === 'pin_hash')) {
  db.exec("ALTER TABLE profiles ADD COLUMN pin_hash TEXT DEFAULT ''");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    type TEXT DEFAULT 'info',
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const chCols = db.prepare('PRAGMA table_info(live_channels)').all();
if (!chCols.some(c => c.name === 'config')) {
  db.exec("ALTER TABLE live_channels ADD COLUMN config TEXT DEFAULT '{}'");
}
if (!chCols.some(c => c.name === 'enabled')) {
  db.exec('ALTER TABLE live_channels ADD COLUMN enabled INTEGER DEFAULT 1');
}
if (!chCols.some(c => c.name === 'uplink_status')) {
  db.exec("ALTER TABLE live_channels ADD COLUMN uplink_status TEXT DEFAULT 'unknown'");
}
if (!chCols.some(c => c.name === 'uplink_info')) {
  db.exec("ALTER TABLE live_channels ADD COLUMN uplink_info TEXT DEFAULT ''");
}
if (!chCols.some(c => c.name === 'uplink_checked_at')) {
  db.exec('ALTER TABLE live_channels ADD COLUMN uplink_checked_at DATETIME');
}
if (!chCols.some(c => c.name === 'cache_enabled')) {
  db.exec('ALTER TABLE live_channels ADD COLUMN cache_enabled INTEGER DEFAULT 0');
}
if (!chCols.some(c => c.name === 'cache_status')) {
  db.exec("ALTER TABLE live_channels ADD COLUMN cache_status TEXT DEFAULT 'off'");
}
if (!chCols.some(c => c.name === 'cache_bytes')) {
  db.exec('ALTER TABLE live_channels ADD COLUMN cache_bytes INTEGER DEFAULT 0');
}
if (!chCols.some(c => c.name === 'cache_path')) {
  db.exec('ALTER TABLE live_channels ADD COLUMN cache_path TEXT DEFAULT NULL');
}
if (!chCols.some(c => c.name === 'cache_started_at')) {
  db.exec('ALTER TABLE live_channels ADD COLUMN cache_started_at DATETIME');
}
if (!chCols.some(c => c.name === 'cache_checked_at')) {
  db.exec('ALTER TABLE live_channels ADD COLUMN cache_checked_at DATETIME');
}

function addUserColumn(name, ddl) {
  const cols = db.prepare('PRAGMA table_info(users)').all();
  if (!cols.some((c) => c.name === name)) db.exec(ddl);
}
addUserColumn('expires_at', 'ALTER TABLE users ADD COLUMN expires_at TEXT DEFAULT NULL');
addUserColumn('can_live', 'ALTER TABLE users ADD COLUMN can_live INTEGER DEFAULT 1');
addUserColumn('can_movies', 'ALTER TABLE users ADD COLUMN can_movies INTEGER DEFAULT 1');
addUserColumn('can_series', 'ALTER TABLE users ADD COLUMN can_series INTEGER DEFAULT 1');
addUserColumn('last_profile_id', 'ALTER TABLE users ADD COLUMN last_profile_id INTEGER DEFAULT NULL');
addUserColumn('profile_setup_complete', 'ALTER TABLE users ADD COLUMN profile_setup_complete INTEGER DEFAULT 0');
db.prepare(`
  UPDATE users SET profile_setup_complete = 1
  WHERE COALESCE(profile_setup_complete, 0) = 0
    AND id IN (SELECT DISTINCT user_id FROM profiles)
`).run();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
  CREATE INDEX IF NOT EXISTS idx_movies_genre ON movies(genre);
  CREATE INDEX IF NOT EXISTS idx_series_title ON series(title);
  CREATE INDEX IF NOT EXISTS idx_series_genre ON series(genre);
  CREATE INDEX IF NOT EXISTS idx_episodes_title ON episodes(title);
  CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
  CREATE INDEX IF NOT EXISTS idx_live_channels_name ON live_channels(name);
  CREATE INDEX IF NOT EXISTS idx_live_channels_group ON live_channels(group_title);
`);

module.exports = db;

const { migrateUserDataToProfiles, dedupeMigratedProfileData } = require('./services/profiles');
migrateUserDataToProfiles();
dedupeMigratedProfileData();
