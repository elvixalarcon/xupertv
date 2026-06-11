const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { ensureCategory } = require('./categories');
const { parseM3U } = require('./playlistImport');
const { mergeConfig, parseConfig, serializeConfig, DEFAULT_CONFIG } = require('./channelConfig');

const DATA = path.join(__dirname, '..', '..', 'data');
const LOGO_DIR = path.join(DATA, 'logos');
const PLAYLIST_NAME = 'Canales libres Ecuador';
const GROUP_TITLE = 'Ecuador';
const IPTV_ORG_EC_M3U = 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/ec.m3u';

const LOGOS = {
  'Ecuavisa.ec': 'https://i.imgur.com/Hl5wowk.png',
  'Teleamazonas.ec': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Teleamazonas_Logo.png/320px-Teleamazonas_Logo.png',
  'EcuadorTV.ec': 'https://i.imgur.com/hj6EYwe.png',
  'RTS.ec': 'https://i.imgur.com/PML8cJA.png',
  'TVC.ec': 'https://i.imgur.com/k6h5Cz2.png',
  'Gamavision.ec': 'https://upload.wikimedia.org/wikipedia/commons/9/94/Gamavisi%C3%B3n2018new.png',
  'Manavision.ec': 'https://i.imgur.com/mZkW342.png',
  'Asomavision.ec': 'https://i.imgur.com/VqwyCV1.png',
  'OromarTV.ec': 'https://i.imgur.com/j5Vvxd5.png',
  'Telerama.ec': 'https://i.imgur.com/J6Mc42H.png',
  'TVLegislativa.ec': 'https://i.imgur.com/3Y6Lp5l.png',
  'PuruwaTV.ec': 'https://i.imgur.com/CYldC2R.png',
  'AmericaEstereoQuito.ec': 'https://i.imgur.com/s32mAf9.png',
  'CanalSur.ec': 'https://i.imgur.com/w42BhFB.png',
  'EducaTV.ec': 'https://i.imgur.com/b2pPtHV.png'
};

/** Canales libres principales de Ecuador (iptv-org + EPG público cuando existe) */
const CURATED = [
  { name: 'Ecuavisa Quito', tvgKey: 'Ecuavisa.ec', epgId: 'Ecuavisa.ec', match: ['ecuavisaquito', 'ecuavisa'] },
  { name: 'Ecuavisa Guayaquil', tvgKey: 'Ecuavisa.ec', epgId: 'Ecuavisa.ec', match: ['ecuavisaguayaquil'] },
  { name: 'Teleamazonas', tvgKey: 'Teleamazonas.ec', epgId: 'Teleamazonas.ec', match: ['teleamazonas'] },
  { name: 'Ecuador TV', tvgKey: 'EcuadorTV.ec', epgId: 'EcuadorTV.ec', match: ['ecuadortv', 'ecuadortv'] },
  { name: 'RTS', tvgKey: 'RTS.ec', epgId: 'RTS.ec', match: ['rts'] },
  { name: 'TVC', tvgKey: 'TVC.ec', epgId: '', match: ['tvc'] },
  { name: 'Gamavisión', tvgKey: 'Gamavision.ec', epgId: '', match: ['gamavision'] },
  { name: 'Manavisión', tvgKey: 'Manavision.ec', epgId: '', match: ['manavision'] },
  { name: 'Asomavisión', tvgKey: 'Asomavision.ec', epgId: '', match: ['asomavision'] },
  { name: 'Oromar TV', tvgKey: 'OromarTV.ec', epgId: '', match: ['oromartv', 'oromar'] },
  { name: 'Telerama', tvgKey: 'Telerama.ec', epgId: '', match: ['telerama'] },
  { name: 'TV Legislativa', tvgKey: 'TVLegislativa.ec', epgId: '', match: ['tvlegislativa'] },
  { name: 'Puruwa TV', tvgKey: 'PuruwaTV.ec', epgId: '', match: ['puruwatv', 'puruwa'] },
  { name: 'América Estéreo Quito', tvgKey: 'AmericaEstereoQuito.ec', epgId: '', match: ['americaestereoquito'] },
  { name: 'Canal Sur', tvgKey: 'CanalSur.ec', epgId: '', match: ['canalsur'] },
  { name: 'Educa TV', tvgKey: 'EducaTV.ec', epgId: '', match: ['educatv'] }
];

function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function tvgBase(id) {
  return String(id || '').split('@')[0].trim();
}

function fetchUrl(url, binary = false) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'VixTV/1.0', Accept: '*/*' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchUrl(next, binary).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      if (binary) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      } else {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function ensureLogoDir() {
  if (!fs.existsSync(LOGO_DIR)) fs.mkdirSync(LOGO_DIR, { recursive: true });
}

function logoExtFromUrl(iconUrl) {
  try {
    const ext = path.extname(new URL(iconUrl).pathname).toLowerCase();
    if (/^\.(png|jpe?g|gif|webp|svg)$/.test(ext)) return ext;
  } catch { /* ignore */ }
  return '.png';
}

async function cacheLogoLocally(iconUrl, channelId) {
  if (!iconUrl || !/^https?:\/\//i.test(iconUrl)) return iconUrl || '';
  try {
    ensureLogoDir();
    const ext = logoExtFromUrl(iconUrl);
    const filename = `ch_${channelId}${ext}`;
    const abs = path.join(LOGO_DIR, filename);
    const buf = await fetchUrl(iconUrl, true);
    if (buf.length < 80) return iconUrl;
    fs.writeFileSync(abs, buf);
    return `/uploads/logos/${filename}`;
  } catch {
    return iconUrl;
  }
}

function ensurePlaylist() {
  let row = db.prepare('SELECT id FROM live_playlists WHERE name = ?').get(PLAYLIST_NAME);
  if (row) {
    db.prepare('UPDATE live_playlists SET m3u_url = ? WHERE id = ?').run(IPTV_ORG_EC_M3U, row.id);
    return row.id;
  }
  const r = db.prepare('INSERT INTO live_playlists (name, m3u_url) VALUES (?, ?)').run(PLAYLIST_NAME, IPTV_ORG_EC_M3U);
  return r.lastInsertRowid;
}

function resolveStream(curated, items) {
  const nameNorm = normalizeName(curated.name);

  for (const item of items) {
    if (normalizeName(item.name) === nameNorm) return item;
  }

  if (/quito/i.test(curated.name)) {
    const hit = items.find((item) => /quito/i.test(`${item.name} ${item.epg_id}`) && tvgBase(item.epg_id) === curated.tvgKey);
    if (hit) return hit;
  }
  if (/guayaquil/i.test(curated.name)) {
    const hit = items.find((item) => /guayaquil/i.test(`${item.name} ${item.epg_id}`) && tvgBase(item.epg_id) === curated.tvgKey);
    if (hit) return hit;
  }

  for (const item of items) {
    if (tvgBase(item.epg_id) === curated.tvgKey) return item;
  }

  for (const alias of curated.match || []) {
    const hit = items.find((item) => normalizeName(item.name).includes(alias));
    if (hit) return hit;
  }

  return null;
}

function buildConfig(epgId, epgChannelId, streamUrl) {
  const config = mergeConfig({ ...DEFAULT_CONFIG }, {});
  config.sources = [{ url: streamUrl, user_agent: 'Mozilla/5.0', referer: '', scan_status: '', scan_info: '' }];
  config.epg = {
    ...config.epg,
    epg_id: epgId || '',
    channel_id: epgChannelId || epgId || '',
    lang: 'es'
  };
  return config;
}

function findExistingChannel(curated) {
  const aliases = new Set([normalizeName(curated.name), ...(curated.match || [])]);
  const rows = db.prepare('SELECT * FROM live_channels').all();
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (aliases.has(key)) return row;
    for (const alias of curated.match || []) {
      if (key.includes(alias) || alias.includes(key)) return row;
    }
  }
  return null;
}

async function importFreeEcuadorChannels({ downloadLogos = true } = {}) {
  const playlistId = ensurePlaylist();
  ensureCategory(GROUP_TITLE, 'live');

  const m3u = await fetchUrl(IPTV_ORG_EC_M3U);
  const items = parseM3U(m3u, IPTV_ORG_EC_M3U).map((item) => ({
    ...item,
    epg_id: item.epg_id || ''
  }));

  const insert = db.prepare(`
    INSERT INTO live_channels (playlist_id, name, logo, stream_url, group_title, config, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const update = db.prepare(`
    UPDATE live_channels
    SET playlist_id = ?, name = ?, logo = ?, stream_url = ?, group_title = ?, config = ?, enabled = 1
    WHERE id = ?
  `);

  const summary = { added: 0, updated: 0, skipped: 0, channels: [] };

  for (const curated of CURATED) {
    const streamItem = resolveStream(curated, items);
    if (!streamItem?.stream_url) {
      summary.skipped++;
      summary.channels.push({ name: curated.name, status: 'skipped', reason: 'Sin stream en iptv-org' });
      continue;
    }

    const logoRemote = LOGOS[curated.tvgKey] || streamItem.logo || '';
    const epgId = tvgBase(streamItem.epg_id) || curated.tvgKey;
    const epgChannelId = curated.epgId || '';
    const config = buildConfig(epgId, epgChannelId, streamItem.stream_url);
    const existing = findExistingChannel(curated);

    if (existing) {
      let logo = existing.logo;
      if (downloadLogos && logoRemote) {
        logo = await cacheLogoLocally(logoRemote, existing.id);
      } else if (logoRemote && !logo) {
        logo = logoRemote;
      }
      update.run(
        playlistId,
        curated.name,
        logo,
        streamItem.stream_url,
        GROUP_TITLE,
        serializeConfig(config),
        existing.id
      );
      summary.updated++;
      summary.channels.push({ id: existing.id, name: curated.name, status: 'updated', epg: epgChannelId || epgId });
      continue;
    }

    const r = insert.run(
      playlistId,
      curated.name,
      logoRemote,
      streamItem.stream_url,
      GROUP_TITLE,
      serializeConfig(config)
    );
    const newId = r.lastInsertRowid;
    let logo = logoRemote;
    if (downloadLogos && logoRemote) {
      logo = await cacheLogoLocally(logoRemote, newId);
      db.prepare('UPDATE live_channels SET logo = ? WHERE id = ?').run(logo, newId);
    }
    summary.added++;
    summary.channels.push({ id: newId, name: curated.name, status: 'added', epg: epgChannelId || epgId });
  }

  return summary;
}

module.exports = {
  importFreeEcuadorChannels,
  CURATED,
  PLAYLIST_NAME,
  IPTV_ORG_EC_M3U
};
