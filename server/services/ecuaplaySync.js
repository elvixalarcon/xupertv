const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { ensureCategory } = require('./categories');
const { mergeConfig, serializeConfig, DEFAULT_CONFIG } = require('./channelConfig');
const streamCache = require('./streamCache');

const BASE = 'https://www.ecuaplay.online';
const GROUP_TITLE = 'Deportes';
const PLAYLIST_NAME = 'ECUA•PLAY Deportes';
const DATA = path.join(__dirname, '..', '..', 'data');
const LOGO_DIR = path.join(DATA, 'logos');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const LA18_REFERER = 'https://la18hd.com/';
const ECUAPLAY_REFERER = `${BASE}/`;

const PLAYER_SLUG_OVERRIDES = {
  'playerwinsports.html': 'winsports',
  'playerwinsportsplus.html': 'winsportsplus',
  'playerespnprem.html': 'espnpremium',
  'playerespndeportes1.html': 'espndeportes',
  'playerfoxdeportes.html': 'foxdeportes',
  'playerbeinsportes.html': 'beinsport_xtra_espanol',
  'playerTyCsports.html': 'tycsports',
  'playermarca90.html': 'marca90',
  'playerclarosports.html': 'clarosports'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+hd$/i, '')
    .replace(/[^a-z0-9+]+/g, '')
    .trim();
}

function cleanLabel(label) {
  return String(label || '')
    .replace(/\s+HD$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchText(url, referer = ECUAPLAY_REFERER) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 25000,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*',
        Referer: referer
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchText(next, referer).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${url}`)); });
  });
}

function fetchBinary(url, referer = ECUAPLAY_REFERER) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 25000,
      headers: { 'User-Agent': UA, Accept: '*/*', Referer: referer }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchBinary(next, referer).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractM3u8(html) {
  const matches = String(html || '').match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/gi) || [];
  return matches.find((u) => !/aclib|ads\./i.test(u)) || '';
}

function extractVoxtvIframe(html) {
  const m = String(html || '').match(/src="(https?:\/\/playerv\.voxtvhd\.com\.br\/[^"]+)"/i);
  if (!m) return '';
  return m[1].replace(/&quot;?$/i, '').trim();
}

function extractStreamSlug(html, playerFile, label) {
  if (PLAYER_SLUG_OVERRIDES[playerFile]) return PLAYER_SLUG_OVERRIDES[playerFile];
  if (/\+/.test(label) && /win\s*sports/i.test(label)) return 'winsportsplus';
  const tvtv = html.match(/tvtvhd\.com\/vivo\/canales\.php\?stream=([^"&'\s]+)/i);
  if (tvtv) return decodeURIComponent(tvtv[1]);
  const la18 = html.match(/la18hd\.com\/vivo\/canales\.php\?stream=([^"&'\s]+)/i);
  if (la18) return decodeURIComponent(la18[1]);
  const voxIframe = extractVoxtvIframe(html);
  if (voxIframe) return { voxIframe };
  const vox = html.match(/stm_source\s*=\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
  if (vox) return { direct: vox[1] };
  const direct = extractM3u8(html);
  if (direct) return { direct };
  return '';
}

async function resolveLa18Stream(slug) {
  const pageUrl = `https://la18hd.com/vivo/canales.php?stream=${encodeURIComponent(slug)}`;
  const html = await fetchText(pageUrl, 'https://tvtvhd.com/');
  const url = extractM3u8(html);
  if (!url) throw new Error(`Sin m3u8 para ${slug}`);
  return { url, referer: LA18_REFERER, resolver: 'la18hd', slug, pageUrl };
}

async function resolveVoxtvStream(iframeUrl, playerUrl) {
  const html = await fetchText(iframeUrl, playerUrl);
  const src = html.match(/stm_source\s*=\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
  const url = src?.[1] || extractM3u8(html);
  if (!url) throw new Error('Sin m3u8 en VoxTV');
  return {
    url,
    referer: iframeUrl,
    resolver: 'voxtvhd',
    slug: 'sonorama',
    pageUrl: playerUrl
  };
}

async function resolvePlayerStream(playerFile, label) {
  const playerUrl = `${BASE}/${playerFile}`;
  const html = await fetchText(playerUrl);
  const slug = extractStreamSlug(html, playerFile, label);
  if (slug && typeof slug === 'object' && slug.direct) {
    return {
      url: slug.direct,
      referer: playerUrl,
      resolver: 'ecuaplay-direct',
      slug: '',
      pageUrl: playerUrl
    };
  }
  if (slug && typeof slug === 'object' && slug.voxIframe) {
    return resolveVoxtvStream(slug.voxIframe, playerUrl);
  }
  if (!slug) throw new Error('Sin slug de stream');
  const resolved = await resolveLa18Stream(slug);
  return { ...resolved, pageUrl: playerUrl };
}

async function fetchDeportesCatalog() {
  const html = await fetchText(`${BASE}/`);
  const start = html.indexOf('id="deportes"');
  const end = html.indexOf('id="varios"');
  if (start < 0 || end < 0) throw new Error('Sección Deportes no encontrada en ECUA•PLAY');
  const section = html.slice(start, end);
  const re = /<a href="(player[^"]+\.html)"[^>]*title="([^"]*)"[^>]*>[\s\S]*?<img src="([^"]+)"[\s\S]*?<div class="card-label">([^<]+)<\/div>/gi;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(section))) {
    const player = m[1];
    const title = (m[2] || '').trim();
    const logoRel = m[3];
    const label = cleanLabel(m[4]);
    const key = `${player}|${normalizeName(label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      player,
      title,
      label,
      logo: logoRel.startsWith('http') ? logoRel : `${BASE}/${logoRel.replace(/^\//, '')}`
    });
  }
  return out;
}

function ensurePlaylist() {
  let row = db.prepare('SELECT id FROM live_playlists WHERE name = ?').get(PLAYLIST_NAME);
  if (row) return row.id;
  const r = db.prepare('INSERT INTO live_playlists (name, m3u_url) VALUES (?, ?)').run(PLAYLIST_NAME, `${BASE}/#deportes`);
  return r.lastInsertRowid;
}

function findExistingChannel(name) {
  const key = normalizeName(name);
  const rows = db.prepare(`SELECT * FROM live_channels WHERE group_title = ? OR group_title = 'Deportes'`).all(GROUP_TITLE);
  for (const row of rows) {
    if (normalizeName(row.name) === key) return row;
  }
  const all = db.prepare('SELECT * FROM live_channels').all();
  for (const row of all) {
    if (normalizeName(row.name) === key) return row;
  }
  return null;
}

function ensureLogoDir() {
  if (!fs.existsSync(LOGO_DIR)) fs.mkdirSync(LOGO_DIR, { recursive: true });
}

async function cacheLogo(iconUrl, channelId) {
  if (!iconUrl || !/^https?:\/\//i.test(iconUrl)) return iconUrl || '';
  try {
    ensureLogoDir();
    let ext = '.png';
    try {
      const e = path.extname(new URL(iconUrl).pathname).toLowerCase();
      if (/^\.(png|jpe?g|gif|webp)$/.test(e)) ext = e;
    } catch { /* ignore */ }
    const filename = `ch_${channelId}${ext}`;
    const buf = await fetchBinary(iconUrl);
    if (buf.length < 80) return iconUrl;
    fs.writeFileSync(path.join(LOGO_DIR, filename), buf);
    return `/uploads/logos/${filename}`;
  } catch {
    return iconUrl;
  }
}

function buildConfig(item, playback) {
  const config = mergeConfig({ ...DEFAULT_CONFIG }, {});
  config.enabled = true;
  config.sources = [{
    url: playback.url,
    streamUrl: playback.url,
    referer: playback.referer,
    user_agent: UA,
    resolver: 'ecuaplay',
    resolver_url: playback.pageUrl,
    pageUrl: playback.pageUrl,
    playerUrl: `${BASE}/${item.player}`,
    label: 'ECUA•PLAY',
    site: 'ecuaplay',
    canal: playback.slug || item.player
  }];
  config.advanced = {
    ...config.advanced,
    referer: playback.referer,
    user_agent: UA
  };
  config.ecuaplay = {
    player: `${BASE}/${item.player}`,
    stream: playback.slug || '',
    resolver: playback.resolver,
    updated_at: new Date().toISOString()
  };
  return config;
}

async function importEcuaplayDeportes({ downloadLogos = true } = {}) {
  const playlistId = ensurePlaylist();
  ensureCategory(GROUP_TITLE, 'live');
  const catalog = await fetchDeportesCatalog();
  if (!catalog.length) throw new Error('Catálogo Deportes vacío');

  const insert = db.prepare(`
    INSERT INTO live_channels (playlist_id, name, logo, stream_url, group_title, config, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const update = db.prepare(`
    UPDATE live_channels
    SET playlist_id = ?, name = ?, logo = ?, stream_url = ?, group_title = ?, config = ?, enabled = 1
    WHERE id = ?
  `);

  const summary = { total: catalog.length, added: 0, updated: 0, failed: 0, channels: [] };

  for (const item of catalog) {
    try {
      const playback = await resolvePlayerStream(item.player, item.label);
      const existing = findExistingChannel(item.label);
      const config = buildConfig(item, playback);
      let channelId;

      if (existing) {
        update.run(playlistId, item.label, existing.logo || item.logo, playback.url, GROUP_TITLE, serializeConfig(config), existing.id);
        channelId = existing.id;
        summary.updated++;
        summary.channels.push({ name: item.label, status: 'updated', id: channelId, stream: playback.url });
      } else {
        const r = insert.run(playlistId, item.label, item.logo, playback.url, GROUP_TITLE, serializeConfig(config));
        channelId = r.lastInsertRowid;
        summary.added++;
        summary.channels.push({ name: item.label, status: 'added', id: channelId, stream: playback.url });
      }

      if (downloadLogos && item.logo) {
        const localLogo = await cacheLogo(item.logo, channelId);
        if (localLogo && localLogo !== item.logo) {
          db.prepare('UPDATE live_channels SET logo = ? WHERE id = ?').run(localLogo, channelId);
        }
      }
    } catch (err) {
      summary.failed++;
      summary.channels.push({ name: item.label, status: 'failed', error: err.message || String(err) });
    }
    await sleep(500);
  }

  return summary;
}

async function refreshEcuaplayChannel(channel) {
  const config = JSON.parse(channel.config || '{}');
  const player = config.ecuaplay?.player || config.sources?.[0]?.playerUrl;
  if (!player) throw new Error('Canal sin fuente ECUA•PLAY');
  const playerFile = player.split('/').pop();
  const playback = await resolvePlayerStream(playerFile, channel.name);
  const item = { player: playerFile, label: channel.name };
  const nextConfig = buildConfig(item, playback);
  db.prepare(`
    UPDATE live_channels SET stream_url = ?, config = ?, enabled = 1 WHERE id = ?
  `).run(playback.url, serializeConfig(nextConfig), channel.id);
  return { id: channel.id, url: playback.url };
}

function isEcuaplayChannel(channel) {
  try {
    const config = typeof channel.config === 'string' ? JSON.parse(channel.config) : (channel.config || {});
    if (config.ecuaplay?.player) return true;
    return (config.sources || []).some((s) => s.resolver === 'ecuaplay' || s.site === 'ecuaplay');
  } catch {
    return false;
  }
}

function fuboSlugFromStreamUrl(url = '') {
  const m = String(url || '').match(/fubo18\.com(?::\d+)?\/([^/?]+)\//i);
  return m?.[1] || '';
}

function playerFileForSlug(slug = '') {
  if (!slug) return '';
  for (const [player, mapped] of Object.entries(PLAYER_SLUG_OVERRIDES)) {
    if (mapped === slug) return player;
  }
  return `player${slug}.html`;
}

function enrichFuboManualConfig(streamUrl, config = {}) {
  if (!/fubo18\.com/i.test(streamUrl || '')) return config;
  const slug = fuboSlugFromStreamUrl(streamUrl);
  const playerFile = playerFileForSlug(slug) || 'playerdsports.html';
  const out = mergeConfig({ ...DEFAULT_CONFIG }, config);
  out.advanced = {
    ...out.advanced,
    referer: LA18_REFERER,
    user_agent: UA,
    allow_recording: out.direct_source ? false : true
  };
  out.ecuaplay = {
    player: `${BASE}/${playerFile}`,
    stream: slug,
    resolver: 'la18hd',
    updated_at: new Date().toISOString()
  };
  out.sources = [{
    url: streamUrl,
    streamUrl: streamUrl,
    referer: LA18_REFERER,
    user_agent: UA,
    resolver: 'ecuaplay',
    resolver_url: `${BASE}/${playerFile}`,
    pageUrl: `${BASE}/${playerFile}`,
    playerUrl: `${BASE}/${playerFile}`,
    label: 'ECUA•PLAY',
    site: 'ecuaplay',
    canal: slug
  }];
  return out;
}

async function activateFuboChannel(channel) {
  const row = typeof channel === 'object' && channel?.id
    ? channel
    : db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channel);
  if (!row) throw new Error('Canal no encontrado');
  const playerFile = getPlayerFile(row);
  const playback = await resolvePlayerStream(playerFile, row.name);
  const cfg = buildConfig({ player: playerFile, label: row.name }, playback);
  cfg.advanced = { ...cfg.advanced, allow_recording: true };
  db.prepare('UPDATE live_channels SET stream_url = ?, config = ?, cache_enabled = 1 WHERE id = ?')
    .run(playback.url, serializeConfig(cfg), row.id);
  streamCache.syncRelayFromConfig(row.id, cfg);
  try {
    await streamCache.startCache(row.id);
  } catch (err) {
    console.warn(`[fubo] relay #${row.id}:`, err.message || err);
  }
  return db.prepare('SELECT * FROM live_channels WHERE id = ?').get(row.id);
}

function getPlayerFile(channel) {
  try {
    const config = typeof channel.config === 'string' ? JSON.parse(channel.config) : (channel.config || {});
    const player = config.ecuaplay?.player || config.sources?.[0]?.playerUrl || '';
    const file = String(player).split('/').pop();
    if (file) return file;
    const slug = fuboSlugFromStreamUrl(channel?.stream_url || '');
    return playerFileForSlug(slug) || 'playerwinsports.html';
  } catch {
    const slug = fuboSlugFromStreamUrl(channel?.stream_url || '');
    return playerFileForSlug(slug) || 'playerwinsports.html';
  }
}

function isFuboChannel(channel) {
  return /fubo18\.com/i.test(channel?.stream_url || '')
    || isEcuaplayChannel(channel);
}

/** Segundos hasta expiración del token fubo18 (si se puede leer de la URL). */
function fuboTokenTtlSec(url) {
  const m = String(url || '').match(/token=[^&]+-(\d+)-(\d+)/i);
  if (!m) return null;
  const exp = parseInt(m[1], 10);
  const start = parseInt(m[2], 10);
  if (!Number.isFinite(exp) || !Number.isFinite(start)) return null;
  const remain = exp - Math.floor(Date.now() / 1000);
  return remain > 0 ? remain : 0;
}

module.exports = {
  BASE,
  GROUP_TITLE,
  fetchDeportesCatalog,
  resolvePlayerStream,
  importEcuaplayDeportes,
  refreshEcuaplayChannel,
  isEcuaplayChannel,
  getPlayerFile,
  isFuboChannel,
  fuboTokenTtlSec,
  fuboSlugFromStreamUrl,
  playerFileForSlug,
  enrichFuboManualConfig,
  activateFuboChannel
};
