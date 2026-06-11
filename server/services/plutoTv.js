const https = require('https');
const http = require('http');
const { randomUUID } = require('crypto');

const BOOT_URL = 'https://boot.pluto.tv/v4/start';
const CHANNELS_URL = 'https://api.pluto.tv/v2/channels';

const bootCache = new Map();
const BOOT_TTL_MS = 20 * 60 * 60 * 1000;

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 45000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
        ...(opts.headers || {})
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchJson(next, opts).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (payload.exp) return payload.exp * 1000;
  } catch { /* ignore */ }
  return Date.now() + BOOT_TTL_MS;
}

async function bootSession(region = 'MX') {
  const key = String(region || 'MX').toUpperCase();
  const cached = bootCache.get(key);
  if (cached && Date.now() < cached.expiresAt - 60000) return cached.data;

  const clientID = randomUUID();
  const params = new URLSearchParams({
    appName: 'web',
    appVersion: '8.0.0',
    deviceVersion: '122.0.0',
    deviceModel: 'web',
    deviceMake: 'chrome',
    deviceType: 'web',
    clientID,
    clientModelNumber: '1.0.0',
    serverSideAds: 'false',
    drmCapabilities: 'widevine:L3'
  });

  const data = await fetchJson(`${BOOT_URL}?${params}`);
  if (!data?.sessionToken) throw new Error('Pluto TV: sin sessionToken');

  bootCache.set(key, {
    data,
    expiresAt: tokenExpiry(data.sessionToken)
  });
  return data;
}

function buildStreamUrl(channelId, region = 'MX') {
  const cached = bootCache.get(String(region || 'MX').toUpperCase());
  if (!cached?.data?.sessionToken) return '';
  const boot = cached.data;
  const stitcher = boot.servers?.stitcher || 'https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv';
  const params = new URLSearchParams({
    jwt: boot.sessionToken,
    masterJWTPassthrough: 'true',
    includeExtendedEvents: 'true'
  });
  const extra = String(boot.stitcherParams || '');
  for (const part of extra.split('&')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    if (k) params.set(k, v || '');
  }
  return `${stitcher}/v2/stitch/hls/channel/${channelId}/master.m3u8?${params}`;
}

async function ensureBoot(region = 'MX') {
  await bootSession(region);
  return bootCache.get(String(region || 'MX').toUpperCase())?.data;
}

async function resolveStreamUrl(channelId, region = 'MX') {
  await ensureBoot(region);
  return buildStreamUrl(channelId, region);
}

function normalizeCategory(category) {
  const c = String(category || '').trim();
  if (!c || c === 'undefined') return 'General';
  if (c === 'Musica') return 'Música';
  if (c === 'Notícias') return 'Noticias';
  return c;
}

function groupTitle(category) {
  return `Pluto TV · ${normalizeCategory(category)}`;
}

/** Canales Pluto TV curados (cine: acción, terror, suspenso, sci-fi, romance, familia, drama, crimen). */
const PLUTO_CURATED_IDS = new Set([
  '5dcb62e63d4d8f0009f36881', // Pluto TV Cine Acción
  '5dcddf1ed95e740009fef7ab', // Pluto TV Cine Terror
  '5ddc4e8bcbb9010009b4e84f', // Pluto TV Cine Suspenso
  '5f2817d3d7573a00080f9175', // Pluto TV Sci-Fi
  '5dd7ea2aeab5230009986735', // Pluto TV Cine Romance
  '5dd6ddb30a1d8a000908ed4c', // Pluto TV Cine Familia
  '5dcddfcb229eff00091b6bdf', // Pluto TV Cine Drama
  '624af40c004f8000079b784d'  // Pluto TV Cine Crimen
]);

const PLUTO_CURATED_SLUGS = new Set([
  'pluto-tv-cine-accion',
  'pluto-tv-cine-terror',
  'pluto-tv-cine-suspenso',
  'pluto-tv-sci-fi-ptv1',
  'pluto-tv-cine-romance',
  'pluto-tv-cine-familia',
  'pluto-tv-cine-drama-1-ptv1',
  'pluto-tv-cine-crimen'
]);

function isCuratedPlutoChannel(ch) {
  const id = String(ch.external_id || ch._id || '').trim();
  const slug = String(ch.slug || '').trim().toLowerCase();
  return PLUTO_CURATED_IDS.has(id) || PLUTO_CURATED_SLUGS.has(slug);
}

function filterCuratedChannels(channels) {
  return channels.filter(isCuratedPlutoChannel);
}

async function fetchChannels(region = 'MX', locale = 'es') {
  await ensureBoot(region);
  const url = `${CHANNELS_URL}?locale=${encodeURIComponent(locale)}&region=${encodeURIComponent(region)}`;
  const rows = await fetchJson(url);
  if (!Array.isArray(rows)) throw new Error('Pluto TV: respuesta inválida');

  const channels = rows
    .filter((ch) => ch._id && ch.name && !ch.onDemand)
    .map((ch) => ({
      source: 'pluto',
      external_id: String(ch._id),
      name: String(ch.name).trim(),
      category: normalizeCategory(ch.category),
      group_title: groupTitle(ch.category),
      logo: ch.logo?.path || ch.colorLogoPNG?.path || ch.thumbnail?.path || '',
      summary: ch.summary || '',
      slug: ch.slug || '',
      region: String(region).toUpperCase(),
      stream_url: buildStreamUrl(ch._id, region)
    }))
    .filter((ch) => ch.stream_url);

  return filterCuratedChannels(channels);
}

const TIMELINES_URL = 'https://service-channels.clusters.pluto.tv/v2/guide/timelines';
const timelineCache = new Map();
const TIMELINE_TTL_MS = 8 * 60 * 1000;

function formatPlutoRange(startIso, stopIso) {
  const start = new Date(startIso);
  const stop = new Date(stopIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime())) return '';
  const opts = { hour: 'numeric', minute: '2-digit', timeZone: 'America/Guayaquil' };
  return `${start.toLocaleTimeString('es-EC', opts)} – ${stop.toLocaleTimeString('es-EC', opts)}`;
}

async function fetchTimelines(channelIds, region = 'MX') {
  const ids = [...new Set((channelIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();

  await ensureBoot(region);
  const boot = bootCache.get(String(region || 'MX').toUpperCase())?.data;
  if (!boot?.sessionToken) return new Map();

  const out = new Map();
  const start = new Date().toISOString();
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json',
    Origin: 'https://pluto.tv',
    Authorization: `Bearer ${boot.sessionToken}`
  };

  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40);
    const params = new URLSearchParams({
      channelIds: batch.join(','),
      start,
      duration: '360'
    });
    try {
      const data = await fetchJson(`${TIMELINES_URL}?${params}`, { headers });
      for (const row of data?.data || []) {
        const id = String(row.channelId || '').trim();
        if (!id) continue;
        out.set(id, Array.isArray(row.timelines) ? row.timelines : []);
      }
    } catch { /* ignore batch */ }
  }
  return out;
}

function pickPlutoNowNext(timelines, now = new Date()) {
  const list = (timelines || [])
    .map((tl) => ({
      title: String(tl.title || '').trim() || 'Sin título',
      subtitle: String(tl.episode?.name || tl.episode?.series?.name || '').trim(),
      start: new Date(tl.start),
      stop: new Date(tl.stop)
    }))
    .filter((tl) => !Number.isNaN(tl.start.getTime()) && !Number.isNaN(tl.stop.getTime()))
    .sort((a, b) => a.start - b.start);

  const t = now.getTime();
  let current = null;
  let next = null;
  for (const tl of list) {
    if (tl.start.getTime() <= t && tl.stop.getTime() > t) current = tl;
    if (!next && tl.start.getTime() > t) next = tl;
  }
  if (!current && list.length) current = list[0];
  if (!next && current) {
    const idx = list.indexOf(current);
    next = list[idx + 1] || null;
  }
  return { current, next };
}

async function getChannelEpg(externalId, region = 'MX', now = new Date()) {
  const id = String(externalId || '').trim();
  if (!id) return null;

  const cacheKey = `${String(region || 'MX').toUpperCase()}:${id}`;
  const cached = timelineCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return cached.entry;
  }

  const map = await fetchTimelines([id], region);
  const timelines = map.get(id) || [];
  const { current, next } = pickPlutoNowNext(timelines, now);
  if (!current && !next) return null;

  const entry = {
    now: current ? {
      title: current.title,
      subtitle: current.subtitle || 'Pluto TV',
      range: formatPlutoRange(current.start.toISOString(), current.stop.toISOString()),
      progress: Math.min(100, Math.max(0, ((now - current.start) / Math.max(1, current.stop - current.start)) * 100))
    } : null,
    next: next ? {
      title: next.title,
      subtitle: next.subtitle || 'Pluto TV',
      range: formatPlutoRange(next.start.toISOString(), next.stop.toISOString())
    } : null,
    source: 'pluto'
  };
  if (!entry.now) return null;

  timelineCache.set(cacheKey, { entry, expires: Date.now() + TIMELINE_TTL_MS });
  return entry;
}

module.exports = {
  bootSession,
  ensureBoot,
  buildStreamUrl,
  resolveStreamUrl,
  fetchChannels,
  fetchTimelines,
  getChannelEpg,
  filterCuratedChannels,
  isCuratedPlutoChannel,
  PLUTO_CURATED_IDS,
  normalizeCategory,
  groupTitle
};
