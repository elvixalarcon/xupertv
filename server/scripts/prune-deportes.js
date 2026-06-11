#!/usr/bin/env node
const db = require('../db');
const streamMonitor = require('../services/streamMonitor');
const ecuaplaySync = require('../services/ecuaplaySync');

const ECDF_RE = /canal del f[uú]tbol|ecdf/i;

function isEcdf(ch) {
  return ECDF_RE.test(ch.name || '');
}

async function probeChannel(ch) {
  if (ecuaplaySync.isEcuaplayChannel(ch)) {
    try {
      await ecuaplaySync.refreshEcuaplayChannel(ch);
      ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(ch.id);
    } catch (err) {
      return { ok: false, info: `refresh: ${err.message}` };
    }
  }
  const r = await streamMonitor.checkChannel(ch);
  return { ok: r.status === 'up', info: r.info || r.status };
}

(async () => {
  const rows = db.prepare("SELECT * FROM live_channels WHERE group_title = 'Deportes' ORDER BY name").all();
  const keep = [];
  const drop = [];

  for (const ch of rows) {
    process.stdout.write(`Testing ${ch.name}... `);
    const result = await probeChannel(ch);
    const forceKeep = isEcdf(ch);

    if (result.ok || forceKeep) {
      db.prepare("UPDATE live_channels SET enabled = 1, group_title = 'Deportes' WHERE id = ?").run(ch.id);
      keep.push({ id: ch.id, name: ch.name, ok: result.ok, forced: forceKeep && !result.ok, info: result.info });
      console.log(forceKeep && !result.ok ? 'KEEP (ECDF)' : 'OK');
    } else {
      db.prepare('UPDATE live_channels SET enabled = 0 WHERE id = ?').run(ch.id);
      drop.push({ id: ch.id, name: ch.name, info: result.info });
      console.log('OFF');
    }
  }

  const enabled = db.prepare("SELECT COUNT(*) c FROM live_channels WHERE group_title='Deportes' AND COALESCE(enabled,1)=1").get().c;
  console.log('\n=== RESUMEN ===');
  console.log('Activos:', enabled);
  console.log('Mantener:', keep.map((x) => x.name).join(', '));
  if (drop.length) {
    console.log('Desactivados:');
    drop.forEach((x) => console.log(`  - ${x.name}: ${x.info}`));
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
