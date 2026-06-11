const express = require('express');
const db = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { ensureCategory, countUsage, renameReferences, listCategories } = require('../services/categories');

const router = express.Router();

router.get('/', auth, (req, res) => {
  const { type } = req.query;
  if (type && !['movie', 'series', 'live'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  res.json(listCategories(type || null));
});

router.post('/', auth, adminOnly, (req, res) => {
  const { name, type } = req.body;
  const trimmed = String(name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'Nombre requerido' });
  if (!['movie', 'series', 'live'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  const exists = db.prepare('SELECT id FROM categories WHERE name = ? AND type = ?').get(trimmed, type);
  if (exists) return res.status(409).json({ error: 'La categoría ya existe' });
  const result = db.prepare('INSERT INTO categories (name, type) VALUES (?, ?)').run(trimmed, type);
  res.json({ id: result.lastInsertRowid, name: trimmed, type });
});

router.put('/:id', auth, adminOnly, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
  const newName = String(req.body.name || '').trim();
  if (!newName) return res.status(400).json({ error: 'Nombre requerido' });
  if (newName !== cat.name) {
    const dup = db.prepare('SELECT id FROM categories WHERE name = ? AND type = ? AND id != ?')
      .get(newName, cat.type, cat.id);
    if (dup) return res.status(409).json({ error: 'Ya existe otra categoría con ese nombre' });
    renameReferences(cat.name, newName, cat.type);
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(newName, cat.id);
  }
  res.json({ ok: true, name: newName });
});

router.delete('/:id', auth, adminOnly, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Categoría no encontrada' });
  const count = countUsage(cat.name, cat.type);
  if (count > 0) {
    return res.status(400).json({
      error: `No se puede eliminar: ${count} elemento(s) usan esta categoría`
    });
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
  res.json({ ok: true });
});

router.ensureCategory = ensureCategory;

module.exports = router;
