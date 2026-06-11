const db = require('../db');

function normalizeTitle(title) {
  return String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugVariants(slug) {
  const s = String(slug || '').toLowerCase().replace(/-\d{4}$/, '');
  if (!s) return [];
  const parts = s.split('-').filter(Boolean);
  const out = new Set([s]);
  if (parts[0] && parts[0].length >= 4) out.add(parts[0]);
  return [...out];
}

function pathMatchesSlug(videoPath, slug) {
  if (!videoPath || !slug) return false;
  const p = videoPath.toLowerCase();
  for (const v of slugVariants(slug)) {
    if (p.includes(v)) return true;
    if (p.includes(v.replace(/-/g, '_'))) return true;
    if (p.includes(`pending_${v}`)) return true;
  }
  return false;
}

function extractSlugFromPath(videoPath) {
  const m = String(videoPath || '').match(/pending_([^.]+)\./i);
  return m ? m[1] : null;
}

/** Busca película existente (evita duplicados por slug distinto o título TMDB). */
function findExistingMovie({ slug, title, year, tmdb_id } = {}) {
  if (tmdb_id) {
    const byTmdb = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(tmdb_id);
    if (byTmdb) return byTmdb;
  }

  const norm = normalizeTitle(title);
  const y = parseInt(year, 10) || 0;

  if (norm) {
    const rows = y
      ? db.prepare('SELECT * FROM movies WHERE year = ?').all(y)
      : db.prepare('SELECT * FROM movies WHERE year IS NULL OR year = 0').all();
    for (const row of rows) {
      if (normalizeTitle(row.title) === norm) return row;
    }
  }

  if (slug) {
    for (const v of slugVariants(slug)) {
      const byPath = db.prepare(`
        SELECT * FROM movies WHERE
          video_path LIKE ? OR video_path LIKE ? OR video_path LIKE ?
        LIMIT 1
      `).get(`%${v}%`, `%pending_${v}%`, `%${v.replace(/-/g, '_')}%`);
      if (byPath) return byPath;
    }
  }

  return null;
}

function movieExists(slug, title, year, tmdb_id) {
  return !!findExistingMovie({ slug, title, year, tmdb_id });
}

/** Elimina filas duplicadas (mismo título normalizado + año o mismo tmdb_id). */
function deduplicateCatalog() {
  const all = db.prepare('SELECT * FROM movies ORDER BY id ASC').all();
  const groups = new Map();

  for (const row of all) {
    const key = row.tmdb_id
      ? `tmdb:${row.tmdb_id}`
      : `t:${normalizeTitle(row.title)}|y:${row.year || 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const removed = [];
  for (const [, rows] of groups) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => scoreKeep(b) - scoreKeep(a));
    const keep = rows[0];
    for (let i = 1; i < rows.length; i++) {
      const dup = rows[i];
      db.prepare('DELETE FROM movies WHERE id = ?').run(dup.id);
      removed.push({ removed: dup.id, kept: keep.id, title: dup.title });
    }
  }
  return removed;
}

function scoreKeep(row) {
  let s = 0;
  if (Number(row.available) === 1) s += 1000;
  const vp = row.video_path || '';
  if (!vp.includes('pending_')) s += 500;
  if (row.tmdb_id) s += 100;
  s += row.id;
  return s;
}

module.exports = {
  normalizeTitle,
  slugVariants,
  pathMatchesSlug,
  extractSlugFromPath,
  findExistingMovie,
  movieExists,
  deduplicateCatalog
};
