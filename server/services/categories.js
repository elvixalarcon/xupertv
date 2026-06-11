const db = require('../db');

const TYPE_FIELDS = {
  movie: { table: 'movies', column: 'genre' },
  series: { table: 'series', column: 'genre' },
  live: { table: 'live_channels', column: 'group_title' }
};

function ensureCategory(name, type) {
  const trimmed = String(name || '').trim();
  if (!trimmed || !TYPE_FIELDS[type]) return;
  db.prepare('INSERT OR IGNORE INTO categories (name, type) VALUES (?, ?)').run(trimmed, type);
}

function countUsage(name, type, opts = {}) {
  const cfg = TYPE_FIELDS[type];
  if (!cfg) return 0;
  if (type === 'live' && opts.enabledOnly) {
    return db.prepare(
      `SELECT COUNT(*) as c FROM ${cfg.table} WHERE ${cfg.column} = ? AND COALESCE(enabled, 1) = 1`
    ).get(name).c;
  }
  return db.prepare(`SELECT COUNT(*) as c FROM ${cfg.table} WHERE ${cfg.column} = ?`).get(name).c;
}

function renameReferences(oldName, newName, type) {
  const cfg = TYPE_FIELDS[type];
  if (!cfg) return;
  db.prepare(`UPDATE ${cfg.table} SET ${cfg.column} = ? WHERE ${cfg.column} = ?`).run(newName, oldName);
}

function listCategories(type, opts = {}) {
  let sql = `
    SELECT c.id, c.name, c.type, c.created_at
    FROM categories c
  `;
  const params = [];
  if (type) {
    sql += ' WHERE c.type = ?';
    params.push(type);
  }
  sql += ' ORDER BY c.type, c.name';
  const rows = db.prepare(sql).all(...params);
  return rows.map(row => ({
    ...row,
    count: countUsage(row.name, row.type, opts)
  }));
}

function seedCategories() {
  db.prepare("SELECT DISTINCT genre as name FROM movies WHERE genre != ''").all()
    .forEach(r => ensureCategory(r.name, 'movie'));
  db.prepare("SELECT DISTINCT genre as name FROM series WHERE genre != ''").all()
    .forEach(r => ensureCategory(r.name, 'series'));
  db.prepare("SELECT DISTINCT group_title as name FROM live_channels WHERE group_title != ''").all()
    .forEach(r => ensureCategory(r.name, 'live'));

  const defaults = {
    movie: ['Acción', 'Ciencia Ficción', 'Comedia', 'Drama', 'Terror', 'Animación'],
    series: ['Drama', 'Comedia', 'Acción', 'Documental', 'Ciencia Ficción'],
    live: ['Ecuador', 'Películas', 'Series', 'Novelas', 'Kids', 'Música', 'Noticias', 'Deportes']
  };

  for (const [type, names] of Object.entries(defaults)) {
    const count = db.prepare('SELECT COUNT(*) as c FROM categories WHERE type = ?').get(type).c;
    if (count === 0) names.forEach(name => ensureCategory(name, type));
  }
}

module.exports = {
  TYPE_FIELDS,
  ensureCategory,
  countUsage,
  renameReferences,
  listCategories,
  seedCategories
};
