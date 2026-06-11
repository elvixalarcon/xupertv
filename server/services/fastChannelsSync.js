const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { getSetting, setSetting } = require('./settings');
const { ensureCategory } = require('./categories');
const { parseM3U } = require('./playlistImport');
const { mergeConfig, serializeConfig, DEFAULT_CONFIG, isUserPinned } = require('./channelConfig');
const plutoTv = require('./plutoTv');
const freetvOttera = require('./freetvOttera');
const vixSync = require('./vixSync');
const epgService = require('./epgService');

const DATA = path.join(__dirname, '..', '..', 'data');
const LOGO_DIR = path.join(DATA, 'logos');
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const DEFAULT_VIX_M3U = 'https://raw.githubusercontent.com/emeaplay/jlm3uarg/main/vix.m3u';
const DEFAULT_FREETV_M3U = 'https://www.freetv.com/?section=epgsectionespanol';
const VIX_GROUP = 'VIX';
const FREETV_GROUP = 'Freetv';

/** ViX: películas, novelas y series (máx. 10). */
const VIX_CURATED = [
  'Cine Club',
  'De pelicula',
  'De pelicula Plus',
  'Cine Retro',
  'Cine de Oro',
  'Novelas de Oro',
  'Novelas en Familia',
  'Novelas de Romance',
  'TlNovelas',
  'Distrito Comedia'
];


function normalizeChannelKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.+-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchesCuratedName(channelName, curatedName) {
  return normalizeChannelKey(channelName) === normalizeChannelKey(curatedName);
}

function pickCuratedFromItems(items, curatedList, { itemFilter = () => true } = {}) {
  const out = [];
  const usedUrls = new Set();
  for (const curatedName of curatedList) {
    const match = items.find((item) => {
      if (!item.name || !item.stream_url) return false;
      if (usedUrls.has(item.stream_url)) return false;
      if (!matchesCuratedName(item.name, curatedName)) return false;
      return itemFilter(item);
    });
    if (match) {
      usedUrls.add(match.stream_url);
      out.push(match);
    }
  }
  return out;
}

const SOURCES = {
  pluto: {
    playlistName: 'Pluto TV',
    settingPrefix: 'fast_pluto'
  },
  vix: {
    playlistName: 'ViX',
    settingPrefix: 'fast_vix'
  },
  freetv: {
    playlistName: 'Free TV',
    settingPrefix: 'fast_freetv'
  }
};

let syncTimer = null;
let syncPromise = null;

function fetchUrl(url, binary = false) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 45000,
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

function probeStream(url, method = 'GET') {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, {
      method,
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        Referer: 'https://vix.com/',
        Accept: '*/*'
      }
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function probeStreamUrl(url) {
  if (await probeStream(url, 'GET')) return true;
  return probeStream(url, 'HEAD');
}

function vixStreamCandidates(linearId, originalUrl = '') {
  const id = String(linearId || '').trim();
  const candidates = [];
  if (originalUrl) candidates.push(originalUrl);
  if (!id) return [...new Set(candidates.filter(Boolean))];

  const paths = [
    `dist/localnow/${id}/hls/hd/playlist.m3u8`,
    `dist/vix/${id}/hls/master/playlist.m3u8`,
    `mt/studio/${id}/hls/master/playlist.m3u8`,
    `dist/24i/${id}/hls/master/playlist.m3u8`,
    `${id}/hls/master/playlist.m3u8`,
    `dist/localnow/${id}/hls/master/playlist.m3u8`,
    `dist/glewedtv/${id}/hls/master/playlist.m3u8`,
    `dist/stremium/${id}/hls/master/playlist.m3u8`
  ];
  for (const path of paths) {
    candidates.push(`https://linear-${id}.frequency.stream/${path}`);
  }
  return [...new Set(candidates.filter(Boolean))];
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

function vixCategory(name) {
  const n = String(name || '').toLowerCase();
  if (/novela|romance|familia|telenovela/.test(n)) return 'Novelas';
  if (/noticia|univision|euronews|tn23|atv|news/.test(n)) return 'Noticias';
  if (/deport|liga|futbol|bein|sports|gol/.test(n)) return 'Deportes';
  if (/cine|pelic|club|accion|terror|comedia/.test(n)) return 'Películas';
  if (/musica|vevo|latin|hits/.test(n)) return 'Música';
  if (/chistos|comedia|entreten|retrix|videos/.test(n)) return 'Entretenimiento';
  if (/nino|kids|infant|cartoon/.test(n)) return 'Kids';
  if (/televisa|monterrey|guadalajara/.test(n)) return 'Televisa';
  return 'General';
}

function vixGroupTitle() {
  return VIX_GROUP;
}

function linearIdFromUrl(url) {
  const m = String(url || '').match(/linear-(\d+)/i);
  return m ? m[1] : '';
}

function buildConfig(fastMeta, streamUrl) {
  const config = mergeConfig({ ...DEFAULT_CONFIG }, {});
  const referer = fastMeta.source === 'vix'
    ? 'https://vix.com/'
    : (fastMeta.source === 'freetv' ? freetvOttera.FREETV_REFERER : '');
  config.sources = [{
    url: streamUrl,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
    referer,
    scan_status: '',
    scan_info: ''
  }];
  config.fast = fastMeta;
  config.epg = {
    ...config.epg,
    epg_id: fastMeta.source === 'pluto' ? `pluto.${fastMeta.external_id}` : (fastMeta.epg_id || ''),
    channel_id: fastMeta.source === 'pluto' ? fastMeta.external_id : '',
    lang: 'es'
  };
  return config;
}

function ensurePlaylist(name, m3uUrl = '') {
  let row = db.prepare('SELECT id FROM live_playlists WHERE name = ?').get(name);
  if (row) {
    if (m3uUrl) db.prepare('UPDATE live_playlists SET m3u_url = ? WHERE id = ?').run(m3uUrl, row.id);
    return row.id;
  }
  const r = db.prepare('INSERT INTO live_playlists (name, m3u_url) VALUES (?, ?)').run(name, m3uUrl);
  return r.lastInsertRowid;
}

function findFastChannel(source, externalId) {
  const rows = db.prepare(`
    SELECT * FROM live_channels
    WHERE playlist_id IN (SELECT id FROM live_playlists WHERE name IN ('Pluto TV', 'ViX', 'Free TV'))
  `).all();
  for (const row of rows) {
    try {
      const config = JSON.parse(row.config || '{}');
      if (config.fast?.source === source && config.fast?.external_id === externalId) return row;
    } catch { /* ignore */ }
  }
  return null;
}

function listHash(channels) {
  const payload = channels
    .map((c) => `${c.source}:${c.external_id}:${c.stream_url}:${c.name}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

async function fetchVixChannels() {
  const m3uUrl = getSetting('vix_m3u_url', DEFAULT_VIX_M3U).trim() || DEFAULT_VIX_M3U;
  const out = [];
  const seen = new Set();

  let curated = [];
  try {
    curated = await vixSync.buildCuratedChannels();
  } catch (err) {
    console.warn('[vix-sync] buildCuratedChannels:', err.message || err);
  }

  if (!curated.length) {
    const m3u = await fetchUrl(m3uUrl);
    const items = parseM3U(m3u, m3uUrl);
    const curatedItems = pickCuratedFromItems(items, VIX_CURATED);
    for (const item of curatedItems) {
      const linearId = linearIdFromUrl(item.stream_url) || linearIdFromUrl(item.epg_id);
      let streamUrl = '';
      for (const url of vixStreamCandidates(linearId, item.stream_url)) {
        if (await probeStreamUrl(url)) {
          streamUrl = url;
          break;
        }
      }
      if (!streamUrl) continue;
      curated.push({
        source: 'vix',
        external_id: linearId || crypto.createHash('md5').update(streamUrl).digest('hex').slice(0, 12),
        name: item.name.trim(),
        category: vixCategory(item.name),
        group_title: vixGroupTitle(),
        logo: item.logo || 'https://i.ibb.co/VNPbHtC/vix.png',
        stream_url: streamUrl,
        stream_source: 'frequency',
        samsung_id: '',
        linear_id: linearId,
        m3u_url: m3uUrl
      });
    }
  }

  for (const ch of curated) {
    const externalId = String(ch.external_id || ch.linear_id || '');
    const dedupeKey = `vix:${externalId}`;
    if (!externalId || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      source: 'vix',
      external_id: externalId,
      name: ch.name,
      category: ch.category || vixCategory(ch.name),
      group_title: ch.group_title || vixGroupTitle(),
      logo: ch.logo || 'https://i.ibb.co/VNPbHtC/vix.png',
      stream_url: ch.stream_url,
      epg_id: ch.epg_id || '',
      m3u_url: ch.m3u_url || m3uUrl,
      samsung_id: ch.samsung_id || '',
      linear_channel_id: ch.linear_id || externalId,
      stream_source: ch.stream_source || 'samsung_stvp'
    });
  }

  return { channels: out, m3uUrl };
}

async function upsertChannels(playlistId, channels, { downloadLogos = true, source = '' } = {}) {
  const insert = db.prepare(`
    INSERT INTO live_channels (playlist_id, name, logo, stream_url, group_title, config, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const update = db.prepare(`
    UPDATE live_channels
    SET playlist_id = ?, name = ?, logo = ?, stream_url = ?, group_title = ?, config = ?, enabled = 1
    WHERE id = ?
  `);
  const disable = db.prepare('UPDATE live_channels SET enabled = 0 WHERE id = ?');

  const seenIds = new Set();
  const summary = { added: 0, updated: 0, disabled: 0, channels: [] };

  for (const ch of channels) {
    seenIds.add(`${ch.source}:${ch.external_id}`);
    ensureCategory(ch.group_title, 'live');

    const fastMeta = {
      source: ch.source,
      external_id: ch.external_id,
      category: ch.category,
      region: ch.region || '',
      slug: ch.slug || '',
      m3u_url: ch.m3u_url || '',
      network_id: ch.network_id || '',
      linear_channel_id: ch.linear_channel_id || ch.linear_id || ch.network_id || '',
      video_id: ch.video_id || '',
      stream_source: ch.stream_source || 'ottera',
      samsung_id: ch.samsung_id || ''
    };
    const config = buildConfig(fastMeta, ch.stream_url);
    const existing = findFastChannel(ch.source, ch.external_id);

    if (existing) {
      let logo = existing.logo;
      if (downloadLogos && ch.logo && /^https?:\/\//i.test(ch.logo)) {
        logo = await cacheLogoLocally(ch.logo, existing.id);
      } else if (ch.logo && !logo) logo = ch.logo;
      update.run(playlistId, ch.name, logo, ch.stream_url, ch.group_title, serializeConfig(config), existing.id);
      summary.updated++;
      summary.channels.push({ id: existing.id, name: ch.name, status: 'updated', group: ch.group_title });
      continue;
    }

    const logoRemote = ch.logo || '';
    const r = insert.run(playlistId, ch.name, logoRemote, ch.stream_url, ch.group_title, serializeConfig(config));
    const newId = r.lastInsertRowid;
    let logo = logoRemote;
    if (downloadLogos && logoRemote) {
      logo = await cacheLogoLocally(logoRemote, newId);
      db.prepare('UPDATE live_channels SET logo = ? WHERE id = ?').run(logo, newId);
    }
    summary.added++;
    summary.channels.push({ id: newId, name: ch.name, status: 'added', group: ch.group_title });
  }

  const managed = db.prepare(`
    SELECT c.id, c.config FROM live_channels c WHERE c.playlist_id = ?
  `).all(playlistId);

  for (const row of managed) {
    try {
      const config = JSON.parse(row.config || '{}');
      if (config.fast?.source !== source) continue;
      const key = `${config.fast?.source}:${config.fast?.external_id}`;
      if (!seenIds.has(key)) {
        if (isUserPinned(row)) continue;
        disable.run(row.id);
        summary.disabled++;
      }
    } catch { /* ignore */ }
  }

  return summary;
}

async function syncPluto({ force = false, downloadLogos = true } = {}) {
  const region = getSetting('pluto_region', 'MX').trim() || 'MX';
  const locale = getSetting('pluto_locale', 'es').trim() || 'es';
  const channels = await plutoTv.fetchChannels(region, locale);
  const hash = listHash(channels);
  const prev = getSetting('fast_pluto_hash', '');
  if (!force && prev === hash) {
    return { skipped: true, hash, total: channels.length, reason: 'Sin cambios' };
  }

  const playlistId = ensurePlaylist('Pluto TV', `pluto://${region}/${locale}`);
  const result = await upsertChannels(playlistId, channels, { downloadLogos, source: 'pluto' });
  setSetting('fast_pluto_hash', hash);
  setSetting('fast_pluto_last_sync', new Date().toISOString());
  setSetting('fast_pluto_count', String(channels.length));
  return { ...result, hash, total: channels.length, categories: [...new Set(channels.map((c) => c.group_title))].length };
}

function migrateVixGroupTitles() {
  const r = db.prepare(`
    UPDATE live_channels SET group_title = ?
    WHERE group_title LIKE 'ViX ·%'
  `).run(VIX_GROUP);
  return r.changes || 0;
}

async function fetchFreeTvChannels({ force = false } = {}) {
  const m3uUrl = DEFAULT_FREETV_M3U;
  const discovered = await freetvOttera.discoverEpgChannels(force);
  const out = [];

  for (const ch of discovered) {
    let streamUrl = '';
    if (ch.stream_source === 'pluto_terror_fallback') {
      streamUrl = await freetvOttera.resolveTerrorStreamUrl();
    } else {
      streamUrl = freetvOttera.buildStreamUrl(ch.network_id);
    }

    out.push({
      source: 'freetv',
      external_id: ch.external_id,
      name: ch.name,
      category: ch.category,
      group_title: FREETV_GROUP,
      logo: ch.logo || '',
      stream_url: streamUrl,
      epg_id: ch.external_id,
      m3u_url: m3uUrl,
      region: 'LATAM',
      network_id: ch.network_id,
      linear_channel_id: ch.linear_channel_id || ch.network_id,
      video_id: ch.video_id || '',
      stream_source: ch.stream_source || 'ottera'
    });
  }

  return { channels: out, m3uUrl };
}

async function syncFreeTv({ force = false, downloadLogos = true } = {}) {
  if (force) freetvOttera.clearStreamCache();
  const { channels, m3uUrl } = await fetchFreeTvChannels({ force });
  const hash = listHash(channels);
  const prev = getSetting('fast_freetv_hash', '');
  if (!force && prev === hash) {
    return { skipped: true, hash, total: channels.length, reason: 'Sin cambios' };
  }

  const playlistId = ensurePlaylist('Free TV', m3uUrl);
  const result = channels.length
    ? await upsertChannels(playlistId, channels, { downloadLogos, source: 'freetv' })
    : { added: 0, updated: 0, disabled: 0, channels: [] };

  setSetting('fast_freetv_hash', hash);
  setSetting('fast_freetv_last_sync', new Date().toISOString());
  setSetting('fast_freetv_count', String(channels.length));
  setSetting('freetv_m3u_url', m3uUrl);

  const disableStale = db.prepare('UPDATE live_channels SET enabled = 0 WHERE id = ?');
  const stale = db.prepare(`
    SELECT id FROM live_channels
    WHERE group_title = ? AND enabled = 1
      AND name IN ('FreeTV', 'FreeTV Terror')
      AND (config NOT LIKE '%"external_id":"freetv-%' OR config IS NULL)
  `).all(FREETV_GROUP);
  let staleDisabled = 0;
  for (const row of stale) {
    const full = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(row.id);
    if (full && isUserPinned(full)) continue;
    disableStale.run(row.id);
    staleDisabled++;
  }

  return { ...result, hash, total: channels.length, m3uUrl, staleDisabled };
}

async function syncVix({ force = false, downloadLogos = true } = {}) {
  migrateVixGroupTitles();
  const { channels, m3uUrl } = await fetchVixChannels();
  const hash = listHash(channels);
  const prev = getSetting('fast_vix_hash', '');
  if (!force && prev === hash) {
    return { skipped: true, hash, total: channels.length, reason: 'Sin cambios' };
  }

  const playlistId = ensurePlaylist('ViX', m3uUrl);
  const result = channels.length
    ? await upsertChannels(playlistId, channels, { downloadLogos, source: 'vix' })
    : { added: 0, updated: 0, disabled: 0, channels: [] };

  setSetting('fast_vix_hash', hash);
  setSetting('fast_vix_last_sync', new Date().toISOString());
  setSetting('fast_vix_count', String(channels.length));
  setSetting('vix_m3u_url', m3uUrl);

  if (channels.length) {
    try {
      const refresh = await vixSync.refreshAllVixChannels({ force });
      result.vix_refresh = refresh;
    } catch (err) {
      result.vix_refresh = { error: err.message || String(err) };
    }
  }

  return { ...result, hash, total: channels.length, m3uUrl };
}

async function syncFastChannels({ force = false, downloadLogos = true } = {}) {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    const out = { pluto: null, vix: null, freetv: null, error: '' };
    try {
      out.pluto = await syncPluto({ force, downloadLogos });
    } catch (err) {
      out.pluto = { error: err.message || String(err) };
      out.error = out.pluto.error;
    }
    try {
      out.vix = await syncVix({ force, downloadLogos });
    } catch (err) {
      out.vix = { error: err.message || String(err) };
      out.error = out.error || out.vix.error;
    }
    try {
      out.freetv = await syncFreeTv({ force, downloadLogos });
    } catch (err) {
      out.freetv = { error: err.message || String(err) };
      out.error = out.error || out.freetv.error;
    }
    try {
      await epgService.refreshEpg({ force: true });
    } catch { /* ignore */ }
    setSetting('fast_last_sync', new Date().toISOString());
    return out;
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
  }
}

function resolveDynamicStreamUrl(channel) {
  let config;
  try {
    config = typeof channel.config === 'string' ? JSON.parse(channel.config || '{}') : (channel.config || {});
  } catch {
    return null;
  }
  const fast = config.fast;
  if (!fast?.source) return null;

  if (fast.source === 'pluto' && fast.external_id) {
    const url = plutoTv.buildStreamUrl(fast.external_id, fast.region || 'MX');
    return url || null;
  }
  if (fast.source === 'freetv' && fast.network_id) {
    return freetvOttera.resolveStreamUrl(fast.network_id);
  }
  return null;
}

async function resolveChannelStreamUrl(channel) {
  const dynamic = resolveDynamicStreamUrl(channel);
  if (dynamic) return dynamic;
  let config = channel?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = {}; }
  }
  if (config?.fast?.source === 'pluto') {
    return plutoTv.resolveStreamUrl(config.fast.external_id, config.fast.region || 'MX');
  }
  if (config?.fast?.source === 'freetv') {
    return freetvOttera.resolveChannelStreamUrl({ ...channel, config });
  }
  if (config?.fast?.source === 'vix') {
    const playback = await vixSync.getChannelPlayback(channel);
    return playback?.url || null;
  }
  return null;
}

function startFastChannelsScheduler() {
  if (syncTimer) return;
  const enabled = getSetting('fast_sync_enabled', '1') !== '0';
  if (!enabled) return;

  syncFastChannels().catch(() => {});
  syncTimer = setInterval(() => {
    syncFastChannels().catch(() => {});
  }, SYNC_INTERVAL_MS);
  if (syncTimer.unref) syncTimer.unref();
}

module.exports = {
  syncFastChannels,
  syncPluto,
  syncVix,
  syncFreeTv,
  migrateVixGroupTitles,
  resolveDynamicStreamUrl,
  resolveChannelStreamUrl,
  startFastChannelsScheduler,
  SOURCES,
  DEFAULT_VIX_M3U,
  DEFAULT_FREETV_M3U,
  VIX_GROUP,
  FREETV_GROUP,
  VIX_CURATED,
  FREETV_FALLBACK: freetvOttera.FALLBACK_CHANNELS
};
