#!/usr/bin/env node
const db = require('../db');
const { ensureCategory } = require('../services/categories');
const { classifyLiveChannel, isEcuadorChannel, isPlutoChannel, isVixChannel } = require('../services/liveCategoryMap');

const channels = db.prepare('SELECT id, name, group_title FROM live_channels').all();
const changes = [];

for (const ch of channels) {
  if (isEcuadorChannel(ch) || isPlutoChannel(ch) || isVixChannel(ch)) continue;

  const next = classifyLiveChannel(ch);
  if (!next || next === ch.group_title) continue;

  db.prepare('UPDATE live_channels SET group_title = ? WHERE id = ?').run(next, ch.id);
  changes.push({ id: ch.id, name: ch.name, from: ch.group_title, to: next });
}

const seen = new Set();
for (const row of changes) seen.add(row.to);
for (const name of seen) ensureCategory(name, 'live');

console.log(JSON.stringify({
  updated: changes.length,
  changes
}, null, 2));
