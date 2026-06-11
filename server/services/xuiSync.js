const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { getSetting, setSetting } = require('./settings');
const { ensureCategory } = require('./categories');
const { parseM3U, importLiveChannelsOnly, filterLiveM3uItems } = require('./playlistImport');
const { serializeConfig } = require('./channelConfig');
const xuiPanel = require('./xuiPanel');

const DATA = path.join(__dirname, '..', '..', 'data');
const LOGO_DIR = path.join(DATA, 'logos');

function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function parsePlaylistCreds(m3uUrl) {
  if (!m3uUrl) return null;
  try {
    const u = new URL(m3uUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    const playlistIdx = parts.findIndex((p) => p === 'playlist');
    if (playlistIdx >= 0 && parts.length >= playlistIdx + 3) {
      return {
        baseUrl: `${u.protocol}//${u.host}`,
        username: parts[playlistIdx + 1],
        password: parts[playlistIdx + 2]
      };
    }
  } catch { /* ignore */ }
  return null;
}

function getXuiConfig() {
  const baseUrl = getSetting('xui_base_url', '').replace(/\/$/, '');
  const username = getSetting('xui_username', '');
  const password = getSetting('xui_password', '');
  const accessCode = getSetting('xui_access_code', '');
  const apiKey = getSetting('xui_api_key', '');

  if (baseUrl && username && password) {
    return { baseUrl, username, password, accessCode, apiKey, source: 'settings' };
  }

  const playlist = db.prepare(`
    SELECT m3u_url FROM live_playlists
    WHERE m3u_url IS NOT NULL AND m3u_url != ''
    ORDER BY id DESC LIMIT 1
  `).get();

  const parsed = parsePlaylistCreds(playlist?.m3u_url);
  if (parsed) {
    return {
      baseUrl: parsed.baseUrl,
      username: parsed.username,
      password: parsed.password,
      accessCode: accessCode || 'elvixplay',
      apiKey,
      source: 'playlist'
    };
  }

  return {
    baseUrl: baseUrl || 'http://5.5.5.5',
    username,
    password,
    accessCode: accessCode || 'elvixplay',
    apiKey,
    source: 'default'
  };
}

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    const reqOpts = {
      timeout: 30000,
      headers: { 'User-Agent': 'VixTV/1.0', Accept: '*/*', ...(opts.headers || {}) }
    };
    if (isHttps) reqOpts.rejectUnauthorized = false;

    const req = client.get(url, reqOpts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchUrl(next, opts).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      if (opts.binary) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      } else {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve(data));
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function fetchJson(url) {
  const raw = await fetchUrl(url);
  return JSON.parse(raw);
}

async function playerApiRequest(config, action) {
  const { baseUrl, username, password } = config;
  if (!baseUrl || !username || !password) {
    throw new Error('Configura URL XUI y credenciales de línea (usuario/contraseña)');
  }
  const url = `${baseUrl.replace(/\/$/, '')}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=${encodeURIComponent(action)}`;
  const data = await fetchJson(url);
  if (!Array.isArray(data)) {
    throw new Error(typeof data === 'object' && data.error ? data.error : `Respuesta inválida del player API (${action})`);
  }
  return data;
}

async function fetchLiveStreamsPlayerApi(config) {
  return playerApiRequest(config, 'get_live_streams');
}

async function fetchLiveCategoriesPlayerApi(config) {
  return playerApiRequest(config, 'get_live_categories');
}

function buildStreamUrl(config, streamId) {
  const base = config.baseUrl.replace(/\/$/, '');
  const { username, password } = config;
  return `${base}/${username}/${password}/${streamId}.m3u8`;
}

function buildM3uUrl(config) {
  const base = config.baseUrl.replace(/\/$/, '');
  return `${base}/playlist/${config.username}/${config.password}/m3u?output=hls`;
}

function ensureXuiPlaylist(config) {
  const m3uUrl = buildM3uUrl(config);
  const existing = db.prepare(`
    SELECT id FROM live_playlists
    WHERE m3u_url = ? OR name IN ('VixRED TV', 'XUI ONE')
    ORDER BY CASE WHEN m3u_url = ? THEN 0 WHEN name = 'VixRED TV' THEN 1 ELSE 2 END
    LIMIT 1
  `).get(m3uUrl, m3uUrl);
  if (existing) return existing.id;
  const r = db.prepare('INSERT INTO live_playlists (name, m3u_url) VALUES (?, ?)').run('XUI ONE', m3uUrl);
  return r.lastInsertRowid;
}

function buildChannelIndex(channels) {
  const byStreamId = new Map();
  const byName = new Map();
  for (const ch of channels) {
    const sid = streamIdFromUrl(ch.stream_url);
    if (sid && !byStreamId.has(sid)) byStreamId.set(sid, ch);
    const key = normalizeName(ch.name);
    if (key && !byName.has(key)) byName.set(key, ch);
  }
  return { byStreamId, byName };
}

function categoryMapFromXui(categories) {
  const map = new Map();
  for (const c of categories) {
    const id = String(c.category_id ?? c.id ?? '');
    const name = c.category_name || c.name || '';
    if (id && name) map.set(id, name);
  }
  return map;
}

async function fetchStreamsAdminApi(config) {
  const { baseUrl, accessCode, apiKey } = config;
  if (!baseUrl || !accessCode || !apiKey) {
    throw new Error('Falta access code o API key de XUI');
  }
  const root = baseUrl.replace(/\/administracion\/?$/, '');
  const url = `${root}/${accessCode}/?api_key=${encodeURIComponent(apiKey)}&action=get_streams`;
  const data = await fetchJson(url);
  if (data.status !== 'STATUS_SUCCESS') {
    throw new Error(data.error || 'Error API admin XUI');
  }
  const rows = Array.isArray(data.data) ? data.data : Object.values(data.data || {});
  return rows.map((s) => ({
    stream_id: parseInt(s.id, 10),
    name: s.stream_display_name || s.name || '',
    stream_icon: s.stream_icon || ''
  }));
}

function streamIdFromUrl(streamUrl) {
  const m = String(streamUrl || '').match(/\/(\d+)\.m3u8(?:\?|$)/i)
    || String(streamUrl || '').match(/\/live\/[^/]+\/(\d+)(?:\/|\.|$)/i);
  return m ? parseInt(m[1], 10) : null;
}

function ensureLogoDir() {
  if (!fs.existsSync(LOGO_DIR)) fs.mkdirSync(LOGO_DIR, { recursive: true });
}

function logoExtFromUrl(iconUrl) {
  try {
    const p = new URL(iconUrl).pathname;
    const ext = path.extname(p).toLowerCase();
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
    const buf = await fetchUrl(iconUrl, { binary: true });
    if (buf.length < 80) return iconUrl;
    fs.writeFileSync(abs, buf);
    return `/uploads/logos/${filename}`;
  } catch {
    return iconUrl;
  }
}

function buildStreamMaps(streams) {
  const byId = new Map();
  const byName = new Map();
  for (const s of streams) {
    const id = parseInt(s.stream_id, 10);
    const name = s.name || '';
    const icon = s.stream_icon || '';
    if (id) byId.set(id, { name, icon });
    const key = normalizeName(name);
    if (key && icon) byName.set(key, { name, icon, id });
  }
  return { byId, byName };
}

async function syncLiveMetadataFromXui(options = {}) {
  const config = getXuiConfig();
  const download = options.download !== false;

  let streams;
  try {
    streams = await fetchLiveStreamsPlayerApi(config);
  } catch {
    return { categories_updated: 0, logos_updated: 0 };
  }

  let categories = [];
  try {
    categories = await fetchLiveCategoriesPlayerApi(config);
  } catch { /* optional */ }
  const catMap = categoryMapFromXui(categories);
  const streamById = new Map(streams.map((s) => [parseInt(s.stream_id, 10), s]));
  const playlistId = ensureXuiPlaylist(config);

  const channels = db.prepare(`
    SELECT id, name, stream_url, logo, group_title FROM live_channels WHERE playlist_id = ?
  `).all(playlistId);
  const update = db.prepare('UPDATE live_channels SET logo = ?, group_title = ? WHERE id = ?');

  let categories_updated = 0;
  let logos_updated = 0;

  for (const ch of channels) {
    const sid = streamIdFromUrl(ch.stream_url);
    const stream = sid ? streamById.get(sid) : null;
    if (!stream) continue;

    const groupTitle = catMap.get(String(stream.category_id ?? '')) || ch.group_title;
    let logo = ch.logo;
    const icon = stream.stream_icon || '';
    if (icon) {
      logo = download ? await cacheLogoLocally(icon, ch.id) : icon;
      if (logo !== ch.logo) logos_updated++;
    }
    if (groupTitle !== ch.group_title) categories_updated++;
    update.run(logo || ch.logo || '', groupTitle, ch.id);
    ensureCategory(groupTitle, 'live');
  }

  return { categories_updated, logos_updated, streams_matched: streams.length };
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseAdminStreamRow(row) {
  const idCell = row[0] || '';
  const iconCell = row[1] || '';
  const nameCell = row[2] || '';
  const idMatch = String(idCell).match(/stream_view\?id=(\d+)/i) || String(idCell).match(/>(\d+)</);
  const streamId = idMatch ? parseInt(idMatch[1], 10) : null;
  const nameMatch = String(nameCell).match(/<strong>([^<]+)<\/strong>/i);
  const catMatch = String(nameCell).match(/font-size:11px;'>([^<]+)</i)
    || String(nameCell).match(/font-size:11px;">([^<]+)</i);
  return {
    stream_id: streamId,
    name: nameMatch ? stripHtml(nameMatch[1]) : stripHtml(nameCell),
    category: catMatch ? stripHtml(catMatch[1]) : 'General',
    icon_cell: iconCell
  };
}

function logoUrlFromAdminCell(iconCell, imageBase) {
  const m = String(iconCell || '').match(/url=([^'"]+)/i);
  if (!m) return '';
  try {
    const decoded = decodeURIComponent(m[1]);
    const imgPath = decoded.replace(/^s:\d+:/, '');
    if (/^https?:\/\//i.test(imgPath)) return imgPath;
    const base = String(imageBase || '').replace(/\/$/, '');
    return `${base}${imgPath.startsWith('/') ? imgPath : `/${imgPath}`}`;
  } catch {
    return '';
  }
}

function sourcesFromStreamViewHtml(html) {
  const urls = [...String(html || '').matchAll(/https?:\/\/[^\s"'<>]+?\.m3u8(?:\?[^\s"'<>]*)?/gi)]
    .map((m) => m[0].replace(/:+$/, ''))
    .filter((u) => !/Connection/i.test(u));
  return [...new Set(urls)];
}

function ensureXuiAdminPlaylist() {
  const existing = db.prepare(`
    SELECT id FROM live_playlists WHERE name IN ('XUI Streams', 'XUI ONE', 'VixRED TV')
    ORDER BY CASE WHEN name = 'XUI Streams' THEN 0 WHEN name = 'XUI ONE' THEN 1 ELSE 2 END
    LIMIT 1
  `).get();
  if (existing) {
    db.prepare("UPDATE live_playlists SET name = 'XUI Streams', m3u_url = '' WHERE id = ?").run(existing.id);
    return existing.id;
  }
  return db.prepare("INSERT INTO live_playlists (name, m3u_url) VALUES ('XUI Streams', '')").run().lastInsertRowid;
}

function imageBaseUrl() {
  const cfg = getXuiConfig();
  if (cfg.baseUrl) return cfg.baseUrl.replace(/\/$/, '');
  return 'https://tv.vixred.com';
}

async function importStreamsFromXuiAdmin(options = {}) {
  const download = options.download !== false;
  const table = await xuiPanel.fetchAdminStreamsTable();
  const rows = Array.isArray(table.data) ? table.data : [];
  if (!rows.length) {
    throw new Error('No se encontraron streams en el panel XUI');
  }

  const parsed = rows.map(parseAdminStreamRow).filter((s) => s.stream_id && s.name);
  const playlistId = ensureXuiAdminPlaylist();
  db.prepare('DELETE FROM live_channels WHERE playlist_id = ?').run(playlistId);

  const insert = db.prepare(`
    INSERT INTO live_channels (playlist_id, name, logo, stream_url, group_title, config, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  const imgBase = imageBaseUrl();
  let imported = 0;
  let skipped = 0;
  const details = [];

  for (const stream of parsed) {
    let html = '';
    try {
      html = await xuiPanel.fetchStreamViewHtml(stream.stream_id);
    } catch {
      skipped++;
      continue;
    }

    const sources = sourcesFromStreamViewHtml(html);
    if (!sources.length) {
      skipped++;
      details.push({ stream_id: stream.stream_id, name: stream.name, action: 'skipped', reason: 'sin fuente m3u8' });
      continue;
    }

    let logo = logoUrlFromAdminCell(stream.icon_cell, imgBase);
    const config = {
      sources: sources.map((url) => ({ url, user_agent: '', referer: 'https://tv.vixred.com/', scan_status: '', scan_info: '' })),
      advanced: {
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        referer: 'https://tv.vixred.com/',
        timeout: 30
      },
      order: stream.stream_id
    };

    const ins = insert.run(
      playlistId,
      stream.name,
      '',
      sources[0],
      stream.category,
      serializeConfig(config)
    );
    const newId = ins.lastInsertRowid;

    if (download && logo) {
      logo = await cacheLogoLocally(logo, newId);
    }
    if (logo) {
      db.prepare('UPDATE live_channels SET logo = ? WHERE id = ?').run(logo, newId);
    }

    ensureCategory(stream.category, 'live');
    imported++;
    details.push({
      action: 'created',
      id: newId,
      stream_id: stream.stream_id,
      name: stream.name,
      sources: sources.length,
      url: sources[0]
    });
  }

  const { scanAndFixAllChannels } = require('./channelSourceSync');
  const sourceScan = await scanAndFixAllChannels({ disableBroken: true });

  return {
    ok: true,
    source: 'xui_admin',
    api: 'admin_table',
    xui_admin: xuiPanel.getAdminConfig().baseUrl,
    playlist_id: playlistId,
    streams_found: parsed.length,
    imported,
    skipped,
    source_scan: { ok: sourceScan.ok, disabled: sourceScan.disabled, total: sourceScan.total },
    channels_total: db.prepare('SELECT COUNT(*) as c FROM live_channels').get().c,
    details: details.slice(0, 30)
  };
}

async function importM3uFromXui(options = {}) {
  const config = getXuiConfig();
  if (!config.baseUrl || !config.username || !config.password) {
    throw new Error('Configura URL XUI y credenciales de línea (usuario/contraseña)');
  }

  const m3uUrl = buildM3uUrl(config);
  const playlistId = ensureXuiPlaylist(config);
  db.prepare('UPDATE live_playlists SET name = ?, m3u_url = ? WHERE id = ?').run('VixRED TV', m3uUrl, playlistId);

  const content = await fetchUrl(m3uUrl);
  const allItems = parseM3U(content, m3uUrl, 'VixRED TV');
  if (!allItems.length) {
    throw new Error('La lista M3U de XUI está vacía o no se pudo leer');
  }

  const liveItems = filterLiveM3uItems(allItems);
  if (!liveItems.length) {
    throw new Error('No se encontraron canales live en la lista M3U de XUI');
  }

  const stats = importLiveChannelsOnly(playlistId, 'VixRED TV', allItems);
  const meta = options.syncMetadata !== false
    ? await syncLiveMetadataFromXui({ download: options.download !== false })
    : { categories_updated: 0, logos_updated: 0 };

  return {
    ok: true,
    source: 'm3u',
    config_source: config.source,
    xui_base: config.baseUrl,
    m3u_url: m3uUrl,
    playlist_id: playlistId,
    m3u_entries: allItems.length,
    live_entries: liveItems.length,
    skipped_vod: stats.skipped,
    live: stats.live,
    movies: stats.movies,
    series: stats.series,
    episodes: stats.episodes,
    channels_total: db.prepare('SELECT COUNT(*) as c FROM live_channels').get().c,
    movies_total: db.prepare('SELECT COUNT(*) as c FROM movies').get().c,
    series_total: db.prepare('SELECT COUNT(*) as c FROM series').get().c,
    ...meta
  };
}

async function importChannelsFromXui(options = {}) {
  return importStreamsFromXuiAdmin(options);
}

async function syncLogosFromXui(options = {}) {
  const config = getXuiConfig();
  const download = options.download !== false;

  let streams;
  let apiUsed = 'player_api';
  try {
    streams = await fetchLiveStreamsPlayerApi(config);
  } catch (playerErr) {
    if (config.apiKey) {
      streams = await fetchStreamsAdminApi(config);
      apiUsed = 'admin_api';
    } else {
      throw playerErr;
    }
  }

  const { byId, byName } = buildStreamMaps(streams);
  const channels = db.prepare('SELECT id, name, stream_url, logo FROM live_channels').all();
  const update = db.prepare('UPDATE live_channels SET logo = ? WHERE id = ?');

  let updated = 0;
  let skipped = 0;
  const details = [];

  for (const ch of channels) {
    const sid = streamIdFromUrl(ch.stream_url);
    let icon = sid ? byId.get(sid)?.icon : '';
    if (!icon) {
      icon = byName.get(normalizeName(ch.name))?.icon || '';
    }
    if (!icon) {
      skipped++;
      continue;
    }
    if (ch.logo === icon) {
      skipped++;
      continue;
    }

    let logoValue = icon;
    if (download) {
      logoValue = await cacheLogoLocally(icon, ch.id);
    }

    update.run(logoValue, ch.id);
    updated++;
    details.push({ id: ch.id, name: ch.name, logo: logoValue, stream_id: sid });
  }

  return {
    ok: true,
    api: apiUsed,
    config_source: config.source,
    xui_base: config.baseUrl,
    streams_found: streams.length,
    channels_total: channels.length,
    updated,
    skipped,
    details: details.slice(0, 20)
  };
}

function saveXuiSettings(body) {
  const fields = ['xui_base_url', 'xui_username', 'xui_password', 'xui_access_code', 'xui_api_key'];
  for (const key of fields) {
    if (body[key] === undefined) continue;
    const val = String(body[key] || '').trim();
    if (key === 'xui_password' && val.startsWith('•')) continue;
    if (key === 'xui_api_key' && val.startsWith('•')) continue;
    setSetting(key, val);
  }
  return getXuiConfig();
}

function getXuiSettingsPublic() {
  const c = getXuiConfig();
  return {
    xui_base_url: getSetting('xui_base_url', c.baseUrl || ''),
    xui_username: getSetting('xui_username', c.username || ''),
    xui_password: getSetting('xui_password') ? '••••••••' : '',
    xui_access_code: getSetting('xui_access_code', 'elvixplay'),
    xui_api_key: getSetting('xui_api_key') ? '••••••••' : '',
    xui_configured: !!(c.baseUrl && c.username && c.password),
    xui_config_source: c.source
  };
}

module.exports = {
  getXuiConfig,
  importStreamsFromXuiAdmin,
  importM3uFromXui,
  importChannelsFromXui,
  syncLiveMetadataFromXui,
  syncLogosFromXui,
  saveXuiSettings,
  getXuiSettingsPublic,
  fetchLiveStreamsPlayerApi
};
