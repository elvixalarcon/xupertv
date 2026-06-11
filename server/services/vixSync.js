const https = require('https');
const http = require('http');
const db = require('../db');
const { getSetting, setSetting } = require('./settings');
const { configFromChannel, serializeConfig, normalizeSource } = require('./channelConfig');
const streamProxyPool = require('./streamProxyPool');

const SAMSUNG_CHANNELS_URL = 'https://i.mjh.nz/SamsungTVPlus/.channels.json';
const SAMSUNG_PLAYBACK_PREFIX = 'https://jmp2.uk/stvp-';
const VIX_REFERER = 'https://vix.com/';
const SAMSUNG_REFERER = 'https://www.samsung.com/';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const PLAYBACK_TTL_MS = 15 * 60 * 1000;
const SAMSUNG_MAP_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

const VIX_GROUP = 'VIX';

/** Canales curados ViX: linear_id del M3U legado + samsung_id cuando existe en STVP US. */
const CURATED_CHANNELS = [
  {
    name: 'Cine Club',
    linear_id: '192',
    samsung_id: '',
    logo: 'https://i.ibb.co/VNPbHtC/vix.png',
    aliases: ['cine club']
  },
  {
    name: 'De pelicula',
    linear_id: '354',
    samsung_id: '',
    logo: 'https://i.ibb.co/VNPbHtC/vix.png',
    aliases: ['de pelicula', 'de película']
  },
  {
    name: 'De pelicula Plus',
    linear_id: '404',
    samsung_id: '',
    logo: 'https://images.vix.com/prd/channel/62c716b46bc1f5715195a3c1/acd58d009f200833068f5a912b8e7e1d?tr=q-80&w=1920',
    aliases: ['de pelicula plus', 'de película plus']
  },
  {
    name: 'Cine Retro',
    linear_id: '307',
    samsung_id: 'USBD2500022U5',
    logo: 'https://images.vix.com/prd/channel/62274e72ed9b67bf206f1a5e/239fe6fbfe883777cfb427e23256f1fc?tr=q-80&w=1920',
    aliases: ['cine retro']
  },
  {
    name: 'Cine de Oro',
    linear_id: '308',
    samsung_id: 'USBD2700005KL',
    logo: 'https://images.vix.com/prd/channel/62274abded9b67e9806eef58/e589cadaabcf0bf7291bd08048006fd2?tr=q-80&w=1920',
    aliases: ['cine de oro']
  },
  {
    name: 'Novelas de Oro',
    linear_id: '196',
    samsung_id: '',
    logo: 'https://images.vix.com/prd/channel/62067bafe60b4f65c744443e/ddac3d628e29430d0af295b7f9d1621e?tr=q-80&w=750',
    aliases: ['novelas de oro']
  },
  {
    name: 'Novelas en Familia',
    linear_id: '195',
    samsung_id: '',
    logo: 'https://images.vix.com/prd/channel/62092cdfb0742315039cb363/1a02c8ded45dc86458a0eff7e355703f?tr=q-80&w=750',
    aliases: ['novelas en familia']
  },
  {
    name: 'Novelas de Romance',
    linear_id: '194',
    samsung_id: 'USBB44000099N',
    logo: 'https://i.ibb.co/VNPbHtC/vix.png',
    aliases: ['novelas de romance', 'vix novelas de romance']
  },
  {
    name: 'TlNovelas',
    linear_id: '421',
    samsung_id: '',
    logo: 'https://images.vix.com/prd/channel/62bb83aaaf7366446185bca3/2848c151144fefc77fff5db25f57a7ee?tr=q-80&w=1920',
    aliases: ['tlnovelas', 'tl novelas']
  },
  {
    name: 'Distrito Comedia',
    linear_id: '405',
    samsung_id: '',
    logo: 'https://i.ibb.co/VNPbHtC/vix.png',
    aliases: ['distrito comedia']
  }
];

let samsungMapCache = { value: null, expires: 0 };
let syncTimer = null;
let retryTimer = null;
let running = false;
const playbackCache = new Map();

function isEnabled() {
  return getSetting('vix_refresh_enabled', '1') !== '0';
}

function intervalMs() {
  const hours = parseFloat(getSetting('vix_refresh_hours', '6')) || 6;
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function normalizeNameKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

function samsungResolverUrl(samsungId) {
  return `${SAMSUNG_PLAYBACK_PREFIX}${String(samsungId || '').trim()}`;
}

function isSamsungResolverUrl(url = '') {
  return /jmp2\.uk\/stvp-/i.test(String(url || ''));
}

function isLikelyVixStream(url = '') {
  const value = String(url || '');
  return /cloudfront\.net\/v1\/master\/3722c60a815c199d9c0ef36c5b73da68a62b09d1/i.test(value)
    || /dai\.google\.com\/linear/i.test(value);
}

function isVixChannel(channel) {
  let config = channel?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config || '{}'); } catch { config = {}; }
  }
  return config?.fast?.source === 'vix' || String(channel?.group_title || '') === VIX_GROUP;
}

function listVixChannels({ curatedOnly = false } = {}) {
  const rows = db.prepare(`
    SELECT * FROM live_channels
    WHERE group_title = ?
       OR config LIKE '%"source":"vix"%'
    ORDER BY name COLLATE NOCASE
  `).all(VIX_GROUP);
  if (!curatedOnly) return rows;
  const curated = new Set(CURATED_CHANNELS.map((row) => normalizeNameKey(row.name)));
  return rows.filter((row) => curated.has(normalizeNameKey(row.name)));
}

function curatedDefForChannel(channel) {
  return CURATED_CHANNELS.find((row) => normalizeNameKey(row.name) === normalizeNameKey(channel?.name)) || null;
}

function invalidateChannelPlayback(channelId) {
  playbackCache.delete(String(channelId));
}

function vixStreamCandidates(linearId, originalUrl = '') {
  const id = String(linearId || '').trim();
  const candidates = [];
  if (originalUrl) candidates.push(originalUrl);
  if (!id) return [...new Set(candidates.filter(Boolean))];

  const paths = [
    `dist/vix/${id}/hls/master/playlist.m3u8`,
    `mt/studio/${id}/hls/master/playlist.m3u8`,
    `dist/samsung/${id}/hls/master/playlist.m3u8`,
    `dist/localnow/${id}/hls/hd/playlist.m3u8`,
    `dist/localnow/${id}/hls/master/playlist.m3u8`,
    `dist/24i/${id}/hls/master/playlist.m3u8`,
    `${id}/hls/master/playlist.m3u8`,
    `dist/glewedtv/${id}/hls/master/playlist.m3u8`,
    `dist/stremium/${id}/hls/master/playlist.m3u8`
  ];
  for (const path of paths) {
    candidates.push(`https://linear-${id}.frequency.stream/${path}`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 45000,
      headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchJson(next).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (err) { reject(err); }
      });
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
      timeout: 15000,
      headers: {
        'User-Agent': DEFAULT_UA,
        Referer: VIX_REFERER,
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

async function resolveRedirectUrl(url, { referer = SAMSUNG_REFERER } = {}) {
  const res = await streamProxyPool.request(url, {
    method: 'GET',
    headers: {
      'User-Agent': DEFAULT_UA,
      Referer: referer,
      Accept: '*/*'
    },
    timeout: 25000,
    maxRedirects: 8
  });
  const finalUrl = res.url || url;
  const body = res.body ? res.body.toString('utf8') : '';
  const ok = (res.status >= 200 && res.status < 400)
    && (/\.m3u8/i.test(finalUrl) || body.startsWith('#EXTM3U'));
  if (!ok) return null;
  return finalUrl;
}

async function loadSamsungCatalog(force = false) {
  if (!force && samsungMapCache.value && samsungMapCache.expires > Date.now()) {
    return samsungMapCache.value;
  }
  const data = await fetchJson(SAMSUNG_CHANNELS_URL);
  const usChannels = data?.regions?.us?.channels || {};
  samsungMapCache = { value: usChannels, expires: Date.now() + SAMSUNG_MAP_TTL_MS };
  return usChannels;
}

function discoverSamsungId(def, usChannels) {
  if (def.samsung_id) return def.samsung_id;
  const keys = [def.name, ...(def.aliases || [])].map(normalizeNameKey).filter(Boolean);
  const entries = Object.entries(usChannels || {});

  for (const key of keys) {
    for (const [id, ch] of entries) {
      const nameKey = normalizeNameKey(ch?.name || '');
      if (!nameKey) continue;
      if (nameKey === key) return id;
    }
  }

  for (const key of keys) {
    if (key.length < 10) continue;
    for (const [id, ch] of entries) {
      if (String(ch?.group || '') !== 'Latino') continue;
      const nameKey = normalizeNameKey(ch?.name || '');
      if (!nameKey) continue;
      if (nameKey.includes(key) || key.includes(nameKey)) return id;
    }
  }

  return '';
}

async function resolveSamsungStream(samsungId) {
  const resolverUrl = samsungResolverUrl(samsungId);
  const finalUrl = await resolveRedirectUrl(resolverUrl, { referer: SAMSUNG_REFERER });
  if (!finalUrl) return null;
  if (!isLikelyVixStream(finalUrl)) return null;
  const ok = await probeStreamUrl(finalUrl);
  if (!ok) return null;
  return { resolverUrl, streamUrl: finalUrl, samsungId: String(samsungId) };
}

async function resolveFrequencyStream(linearId) {
  for (const url of vixStreamCandidates(linearId)) {
    if (await probeStreamUrl(url)) {
      return { resolverUrl: url, streamUrl: url, samsungId: '' };
    }
  }
  return null;
}

async function resolveCuratedChannel(def, usChannels) {
  const samsungId = discoverSamsungId(def, usChannels);
  if (samsungId) {
    const samsung = await resolveSamsungStream(samsungId);
    if (samsung) {
      return {
        ...samsung,
        stream_source: 'samsung_stvp',
        linear_id: def.linear_id
      };
    }
  }
  const frequency = await resolveFrequencyStream(def.linear_id);
  if (frequency) {
    return {
      ...frequency,
      stream_source: 'frequency',
      linear_id: def.linear_id,
      samsungId: samsungId || ''
    };
  }
  return null;
}

async function buildCuratedChannels() {
  const usChannels = await loadSamsungCatalog();
  const out = [];
  for (const def of CURATED_CHANNELS) {
    const resolved = await resolveCuratedChannel(def, usChannels);
    if (!resolved) continue;
    out.push({
      source: 'vix',
      external_id: def.linear_id || resolved.samsungId || normalizeNameKey(def.name),
      name: def.name,
      category: categorize(def.name),
      group_title: VIX_GROUP,
      logo: def.logo,
      stream_url: resolved.resolverUrl,
      stream_source: resolved.stream_source,
      samsung_id: resolved.samsungId || samsungIdFromDef(def),
      linear_id: def.linear_id,
      playback_url: resolved.streamUrl,
      m3u_url: getSetting('vix_m3u_url', '')
    });
  }
  return out;
}

function samsungIdFromDef(def) {
  return def.samsung_id || '';
}

function categorize(name) {
  const n = String(name || '').toLowerCase();
  if (/novela|romance|familia|telenovela/.test(n)) return 'Novelas';
  if (/cine|pelic|club|retro|oro/.test(n)) return 'Películas';
  if (/comedia/.test(n)) return 'Entretenimiento';
  return 'General';
}

async function getChannelPlayback(channel, opts = {}) {
  const cacheKey = String(channel.id);
  const cached = playbackCache.get(cacheKey);
  if (!opts.force && cached && cached.expires > Date.now()) {
    const alive = await probeStreamUrl(cached.value.url);
    if (alive) return cached.value;
    invalidateChannelPlayback(channel.id);
  }

  const config = configFromChannel(channel);
  const samsungId = config.fast?.samsung_id || config.vix?.samsung_id || '';
  const resolver = config.fast?.stream_source || config.vix?.stream_source || '';
  let streamUrl = '';
  let referer = VIX_REFERER;

  if (samsungId || resolver === 'samsung_stvp' || isSamsungResolverUrl(channel.stream_url)) {
    const base = isSamsungResolverUrl(channel.stream_url)
      ? channel.stream_url
      : samsungResolverUrl(samsungId);
    const resolved = await resolveRedirectUrl(base, { referer: SAMSUNG_REFERER });
    if (resolved) {
      streamUrl = resolved;
      referer = VIX_REFERER;
    }
  }

  if (!streamUrl) {
    streamUrl = channel.stream_url || '';
    if (isSamsungResolverUrl(streamUrl)) {
      const resolved = await resolveRedirectUrl(streamUrl, { referer: SAMSUNG_REFERER });
      streamUrl = resolved || streamUrl;
    }
  }

  if (!streamUrl) return null;

  const value = {
    url: streamUrl,
    referer,
    user_agent: DEFAULT_UA,
    cookies: ''
  };
  playbackCache.set(cacheKey, { value, expires: Date.now() + PLAYBACK_TTL_MS });
  return value;
}

async function refreshVixChannel(channel, opts = {}) {
  const config = configFromChannel(channel);
  const def = curatedDefForChannel(channel);
  if (!def) {
    throw new Error(`Canal ViX no curado: ${channel.name}`);
  }

  if (opts.force) {
    samsungMapCache = { value: null, expires: 0 };
  }

  const usChannels = await loadSamsungCatalog(opts.force);
  const resolved = await resolveCuratedChannel(def, usChannels);
  if (!resolved) {
    throw new Error(`No se pudo resolver señal ViX para ${channel.name}`);
  }

  const source = normalizeSource({
    url: resolved.resolverUrl,
    referer: VIX_REFERER,
    user_agent: DEFAULT_UA,
    resolver: 'vix',
    scan_status: 'ok',
    scan_info: resolved.stream_source === 'samsung_stvp'
      ? 'M3U8 renovado desde Samsung TV Plus (ViX)'
      : 'M3U8 renovado desde frequency.stream'
  });

  config.enabled = true;
  config.sources = [source];
  config.advanced = {
    ...(config.advanced || {}),
    referer: VIX_REFERER,
    user_agent: DEFAULT_UA
  };
  config.fast = {
    ...(config.fast || {}),
    source: 'vix',
    external_id: def.linear_id || config.fast?.external_id || '',
    linear_id: def.linear_id || '',
    samsung_id: resolved.samsungId || discoverSamsungId(def, usChannels) || '',
    stream_source: resolved.stream_source,
    category: categorize(def.name),
    region: 'US'
  };
  config.vix = {
    samsung_id: resolved.samsungId || discoverSamsungId(def, usChannels) || '',
    stream_source: resolved.stream_source,
    playback_url: resolved.streamUrl,
    stream_refreshed_at: new Date().toISOString()
  };

  invalidateChannelPlayback(channel.id);

  db.prepare('UPDATE live_channels SET stream_url = ?, enabled = 1, config = ? WHERE id = ?')
    .run(resolved.resolverUrl, serializeConfig(config), channel.id);

  return {
    id: channel.id,
    name: channel.name,
    ok: true,
    url: resolved.streamUrl,
    resolver_url: resolved.resolverUrl,
    samsung_id: resolved.samsungId || '',
    stream_source: resolved.stream_source
  };
}

async function refreshAllVixChannels(opts = {}) {
  if (running) return { skipped: true, reason: 'sync en curso' };
  running = true;
  const started = Date.now();
  const results = { ok: 0, fail: 0, channels: [] };

  try {
    const channels = listVixChannels({ curatedOnly: true });
    if (!channels.length) {
      const curated = await buildCuratedChannels();
      return {
        ok: 0,
        fail: 0,
        channels: [],
        total: 0,
        discovered: curated.length,
        note: 'Sin canales ViX en BD; ejecute syncFastChannels'
      };
    }

    for (const ch of channels) {
      try {
        const row = await refreshVixChannel(ch, opts);
        results.ok += 1;
        results.channels.push(row);
      } catch (err) {
        results.fail += 1;
        results.channels.push({
          id: ch.id,
          name: ch.name,
          ok: false,
          error: (err.message || String(err)).slice(0, 160)
        });
      }
    }

    results.total = channels.length;
    results.duration_ms = Date.now() - started;
    setSetting('vix_refresh_last', new Date().toISOString());
    setSetting('vix_refresh_ok', String(results.ok));
    setSetting('vix_refresh_fail', String(results.fail));
    setSetting('vix_refresh_error', '');
    scheduleRetry(results.fail > 0);
    return results;
  } catch (err) {
    const message = err.message || String(err);
    setSetting('vix_refresh_last', new Date().toISOString());
    setSetting('vix_refresh_fail', '1');
    setSetting('vix_refresh_error', message.slice(0, 220));
    scheduleRetry(true);
    throw err;
  } finally {
    running = false;
  }
}

function scheduleRetry(needed) {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (!needed || !isEnabled()) return;
  retryTimer = setTimeout(() => {
    refreshAllVixChannels({ force: true }).catch((err) => {
      console.warn('[vix-sync] reintento:', err.message || err);
    });
  }, RETRY_INTERVAL_MS);
  if (retryTimer.unref) retryTimer.unref();
}

function startVixScheduler() {
  if (syncTimer) return;
  if (!isEnabled()) return;

  refreshAllVixChannels().catch((err) => {
    console.warn('[vix-sync] inicial:', err.message || err);
  });

  syncTimer = setInterval(() => {
    refreshAllVixChannels().catch((err) => {
      console.warn('[vix-sync]', err.message || err);
    });
  }, intervalMs());

  if (syncTimer.unref) syncTimer.unref();
}

function stopVixScheduler() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

module.exports = {
  CURATED_CHANNELS,
  VIX_GROUP,
  SAMSUNG_PLAYBACK_PREFIX,
  buildCuratedChannels,
  curatedDefForChannel,
  resolveCuratedChannel,
  resolveSamsungStream,
  resolveFrequencyStream,
  getChannelPlayback,
  refreshVixChannel,
  refreshAllVixChannels,
  listVixChannels,
  isVixChannel,
  isSamsungResolverUrl,
  invalidateChannelPlayback,
  startVixScheduler,
  stopVixScheduler,
  isEnabled,
  intervalMs,
  vixStreamCandidates,
  probeStreamUrl
};
