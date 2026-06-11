const https = require('https');
const http = require('http');
const { getSetting, setSetting } = require('./settings');
const plutoTv = require('./plutoTv');

const PLUTO_TERROR_CHANNEL_ID = '5dcddf1ed95e740009fef7ab';

const FREETV_PAGE = 'https://www.freetv.com/?section=epgsectionespanol';
const FREETV_REFERER = 'https://www.freetv.com/';
const OTTERA_API = 'https://api-ott.freetv.com';
const OTTERA_STREAM = 'https://stream.ads.ottera.tv/playlist.m3u8';
const EPG_SECTION = 'epgsectionespanol';

const TOKEN_TTL_MS = 30 * 60 * 1000;
const CONFIG_TTL_MS = 15 * 60 * 1000;
const STREAM_TTL_MS = 20 * 60 * 1000;

let tokenCache = { value: '', expires: 0 };
let configCache = { value: null, expires: 0 };
const streamCache = new Map();

const MOVIE_KEYWORDS = /estelar|acci[oó]n|action|drama|sure[nñ]o|terror|horror|familia|cl[aá]sico|classic|cine|pel[ií]cula|movie|film/i;

/** Logos oficiales Ottera (cdn.m3u.cl devuelve la misma imagen genérica para todos). */
const OTTERA_LOGOS = {
  estelar: 'https://img.static-ottera.com/prod/oly/linear_channel/logo/estelar_2.jpg',
  accion: 'https://img.static-ottera.com/prod/oly/linear_channel/logo/8jSbSRxKZFMOrpdIZbDIawKNhG2gY2Y3lK83DeQgvQM.jpg',
  drama: 'https://img.static-ottera.com/prod/oly/linear_channel/logo/hxZvk_ihszX_3Ew54jIpRH17bZdVIenMQ8D4I3aRMac.jpg',
  sureno: 'https://img.static-ottera.com/prod/oly/linear_channel/logo/1kVeDXEknMFfo9HQH2IzDrY-vz2B-aUBVc3cWZPbGdk.jpg',
  terror: 'https://img.static-ottera.com/prod/oly/linear_channel/logo/_Rr0RAcV0sKcQJQZtJ9bcWm9hXTUvvOTK_100Y7svlk.jpg',
  familia: 'https://img.static-ottera.com/prod/oly/linear_channel/logo/GYWfSuIc1-pLxEaktFq6TGl_qXSLPfZlOTr6rD2-iXA.jpg'
};

/**
 * network_id = señal Ottera que reproduce.
 * linear_channel_id = guía EPG española en api-ott.freetv.com (puede diferir).
 */
const FALLBACK_CHANNELS = [
  {
    name: 'FreeTV Estelar',
    external_id: 'freetv-estelar',
    network_id: '16531',
    linear_channel_id: '16531',
    category: 'Películas',
    logo: OTTERA_LOGOS.estelar
  },
  {
    name: 'FreeTV Acción',
    external_id: 'freetv-accion',
    network_id: '16195',
    linear_channel_id: '19360',
    category: 'Acción',
    logo: OTTERA_LOGOS.accion
  },
  {
    name: 'FreeTV Drama',
    external_id: 'freetv-drama',
    network_id: '16200',
    linear_channel_id: '19351',
    category: 'Drama',
    logo: OTTERA_LOGOS.drama
  },
  {
    name: 'FreeTV Sureño',
    external_id: 'freetv-sureno',
    network_id: '16416',
    linear_channel_id: '16416',
    category: 'Cine',
    logo: OTTERA_LOGOS.sureno
  },
  {
    name: 'FreeTV Terror',
    external_id: 'freetv-terror',
    network_id: '16205',
    linear_channel_id: '19362',
    category: 'Terror',
    logo: OTTERA_LOGOS.terror,
    stream_source: 'pluto_terror_fallback'
  },
  {
    name: 'FreeTV Familia',
    external_id: 'freetv-familia',
    network_id: '16210',
    linear_channel_id: '19354',
    category: 'Familia',
    logo: OTTERA_LOGOS.familia
  }
];

const EPG_CACHE_TTL_MS = 5 * 60 * 1000;
const epgCache = new Map();

function normalizeNameKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

function normalizeOtteraLogo(url) {
  if (!url) return '';
  return String(url).replace(/\/logo\/\d+x\d+\//, '/logo/');
}

function parseEpgSectionItems(cfg) {
  const sections = Array.isArray(cfg?.sections) ? cfg.sections : [];
  const section = sections.find((s) => s?.section === EPG_SECTION);
  if (!section || !Array.isArray(section.items)) return [];

  return section.items
    .filter((item) => item?.epg && item?.parameters?.linear_channel_id && item.title !== 'Return')
    .map((item) => {
      const linearId = String(item.parameters.linear_channel_id || item.parameters.parent_id || '').trim();
      const title = String(item.title || '').trim();
      return {
        name: title,
        network_id: linearId,
        linear_channel_id: linearId,
        video_id: String(item.parameters.parent_id || '').trim(),
        logo: normalizeOtteraLogo(item.image?.url || ''),
        category: categoryFromName(title)
      };
    })
    .filter((ch) => ch.name && ch.linear_channel_id && MOVIE_KEYWORDS.test(ch.name));
}

function mergeWithFallback(discovered) {
  const merged = FALLBACK_CHANNELS.map((ch) => ({ ...ch }));
  const byKey = new Map(merged.map((ch) => [normalizeNameKey(ch.name), ch]));

  for (const item of discovered || []) {
    const key = normalizeNameKey(item.name);
    const existing = byKey.get(key)
      || merged.find((ch) => normalizeNameKey(ch.name).includes(key) || key.includes(normalizeNameKey(ch.name)));
    if (existing) {
      if (item.logo && /^https?:\/\//i.test(item.logo)) existing.logo = item.logo;
      if (item.video_id) existing.video_id = item.video_id;
      if (item.linear_channel_id) existing.linear_channel_id = item.linear_channel_id;
    }
  }

  return merged;
}

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        ...headers
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchText(next, headers).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function otteraHeaders(token) {
  return {
    'ottera-referrer': FREETV_REFERER,
    'ottera-cs-auth': token || ''
  };
}

async function getCsAuthToken(force = false) {
  if (!force && tokenCache.value && tokenCache.expires > Date.now()) {
    return tokenCache.value;
  }
  const html = await fetchText(FREETV_PAGE);
  const match = html.match(/drupal-settings-json">([^<]+)/);
  if (!match) throw new Error('No se encontró configuración de FreeTV');
  const settings = JSON.parse(match[1]);
  const token = settings?.codesbasePublic?.options?.cs_auth_token || '';
  if (!token) throw new Error('Token FreeTV no disponible');
  tokenCache = { value: token, expires: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function getConfiguration(force = false) {
  if (!force && configCache.value && configCache.expires > Date.now()) {
    return configCache.value;
  }
  const token = await getCsAuthToken(force);
  const ts = Math.floor(Date.now() / 1000);
  const url = `${OTTERA_API}/getconfiguration?version=14.0&device_type=desktop&platform=web&partner=internal&language=es&connection=wifi&timestamp=${ts}`;
  const body = await fetchText(url, otteraHeaders(token));
  const cfg = JSON.parse(body);
  if (cfg?.code && cfg.code !== 200 && !cfg.sections) {
    throw new Error(cfg.message || 'Config FreeTV inválida');
  }
  configCache = { value: cfg, expires: Date.now() + CONFIG_TTL_MS };
  return cfg;
}

function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function networkIdFromObject(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return String(
    obj.network_id
    || obj.ad_network_id
    || obj.linear_channel_id
    || obj.linear_channel
    || ''
  ).trim();
}

function nameFromObject(obj) {
  return String(obj?.name || obj?.title || obj?.inline_text?.details || '').trim();
}

function walkObjects(node, out, seen) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkObjects(item, out, seen);
    return;
  }
  if (typeof node !== 'object') return;

  const networkId = networkIdFromObject(node);
  const name = nameFromObject(node);
  const type = String(node.type || '').toLowerCase();

  if (networkId && name && !seen.has(networkId)) {
    const isLinear = /linear/.test(type)
      || node.linear_channel_id
      || node.parent_type === 'linear_channel'
      || MOVIE_KEYWORDS.test(name);
    if (isLinear) {
      seen.add(networkId);
      const logo = String(
        node.logo || node.thumbnail_url || node.image_url || node.poster_url || ''
      ).trim();
      const videoId = String(node.id || node.video_id || '').trim();
      out.push({ name, network_id: networkId, type, logo, video_id: videoId });
    }
  }

  for (const key of Object.keys(node)) {
    walkObjects(node[key], out, seen);
  }
}

function categoryFromName(name) {
  const n = String(name || '').toLowerCase();
  if (/acci[oó]n|action/.test(n)) return 'Acción';
  if (/drama/.test(n)) return 'Drama';
  if (/terror|horror/.test(n)) return 'Terror';
  if (/familia|family/.test(n)) return 'Familia';
  if (/cl[aá]sico|classic/.test(n)) return 'Películas';
  if (/sure[nñ]o/.test(n)) return 'Cine';
  if (/estelar|pel[ií]cula|cine|movie/.test(n)) return 'Películas';
  return 'Películas';
}

function normalizeDiscovered(list) {
  return list
    .filter((ch) => ch.network_id && ch.name)
    .filter((ch) => MOVIE_KEYWORDS.test(ch.name))
    .slice(0, 10)
    .map((ch) => ({
      name: ch.name.replace(/\s+-\s+FreeTV\.com$/i, '').trim(),
      external_id: `freetv-${slugify(ch.name)}`,
      network_id: String(ch.network_id),
      linear_channel_id: String(ch.network_id),
      video_id: String(ch.video_id || ''),
      category: categoryFromName(ch.name),
      logo: ch.logo || ''
    }));
}

async function discoverEpgChannels(force = false) {
  try {
    const cfg = await getConfiguration(force);
    const fromSection = parseEpgSectionItems(cfg);
    if (fromSection.length) return mergeWithFallback(fromSection);

    const sections = Array.isArray(cfg?.sections) ? cfg.sections : [];
    const section = sections.find((s) => s?.section === EPG_SECTION) || null;
    const found = [];
    const seen = new Set();

    if (section) walkObjects(section, found, seen);
    if (!found.length) walkObjects(sections, found, seen);

    const normalized = normalizeDiscovered(found);
    return mergeWithFallback(normalized);
  } catch {
    /* fallback below */
  }
  return mergeWithFallback([]);
}

async function resolveTerrorStreamUrl() {
  try {
    const url = await plutoTv.resolveStreamUrl(PLUTO_TERROR_CHANNEL_ID, 'MX');
    if (url) return url;
  } catch {
    /* fallback ottera below */
  }
  return resolveStreamUrl('16205');
}

async function resolveChannelStreamUrl(channel) {
  if (!isFreetvChannel(channel)) return null;
  let config = channel?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config || '{}'); } catch { return null; }
  }
  if (config?.fast?.stream_source === 'pluto_terror_fallback'
    || config?.fast?.external_id === 'freetv-terror') {
    return resolveTerrorStreamUrl();
  }
  let networkId = config?.fast?.network_id;
  if (!networkId || !/^\d+$/.test(String(networkId))) {
    const fallback = FALLBACK_CHANNELS.find((c) => c.external_id === config?.fast?.external_id);
    networkId = fallback?.network_id;
  }
  if (!networkId) return null;
  return resolveStreamUrl(networkId);
}

function buildStreamUrl(networkId, opts = {}) {
  const ts = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    content_livestream: '1',
    network_id: String(networkId),
    avod: '1',
    coppa: '0',
    is_lat: '0',
    dnt: '0',
    td: '6',
    us_privacy: '1NNN',
    delivery_type: 'fast',
    ifa_type: 'sessionid',
    app_domain: 'freetv.com',
    app_name: 'FreeTV',
    custom_targeting: 'web',
    delivery_partner: 'internal',
    custom_4: 'internal',
    player_height: '720',
    player_width: '1280',
    content_channel: 'FreeTV',
    content_network: 'FreeTV',
    content_language: 'es',
    content_cat: 'IAB1-5,IAB1-7',
    partner_domain: 'freetv.com',
    content_dist_name: 'internal',
    device_os: 'web',
    device_language: 'es',
    preferred_language: 'es',
    gdpr: '0',
    custom_12: '0',
    custom_15: 'es',
    custom_16: 'es',
    custom_17: 'es',
    country: opts.country || getSetting('freetv_country', 'ec'),
    livestream: '1',
    custom_param_1: 'desktop',
    custom_param_4: 'internal',
    custom_param_5: 'web',
    timestamp: String(ts),
    override_expiration: '1500',
    site_page: 'https://www.freetv.com/?section=epgsectionespanol'
  });
  return `${OTTERA_STREAM}?${params.toString()}`;
}

async function probeStreamUrl(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        Referer: FREETV_REFERER,
        Accept: '*/*'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return probeStreamUrl(next).then(resolve);
      }
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function resolveStreamUrl(networkId) {
  const key = String(networkId || '');
  if (!key) return null;
  const cached = streamCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.url;
  const url = buildStreamUrl(key);
  streamCache.set(key, { url, expires: Date.now() + STREAM_TTL_MS });
  return url;
}

function clearStreamCache(networkId) {
  if (networkId) streamCache.delete(String(networkId));
  else streamCache.clear();
}

function isFreetvOtteraUrl(url) {
  return /stream\.ads\.ottera\.tv/i.test(String(url || ''));
}

function isFreetvChannel(channel) {
  let config = channel?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config || '{}'); } catch { config = {}; }
  }
  return config?.fast?.source === 'freetv' || String(channel?.group_title || '') === 'Freetv';
}

function formatEpgRange(startSec, endSec) {
  const opts = { hour: 'numeric', minute: '2-digit', timeZone: 'America/Guayaquil' };
  const start = new Date(startSec * 1000);
  const end = new Date(endSec * 1000);
  return `${start.toLocaleTimeString('es-EC', opts)} – ${end.toLocaleTimeString('es-EC', opts)}`;
}

async function otteraApi(action, params = {}) {
  const token = await getCsAuthToken();
  const ts = Math.floor(Date.now() / 1000);
  const qs = new URLSearchParams({
    version: '14.0',
    device_type: 'desktop',
    platform: 'web',
    partner: 'internal',
    language: 'es',
    connection: 'wifi',
    timestamp: String(ts)
  });
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const url = `${OTTERA_API}/${action}?${qs.toString()}`;
  const body = await fetchText(url, otteraHeaders(token));
  return JSON.parse(body);
}

async function getVideoSegments(linearChannelId, videoId = '') {
  const id = String(linearChannelId || '').trim();
  if (!id) return [];
  const attempts = [
    { parent_type: 'linear_channel', parent_id: id, linear_channel_id: id, max: '36' },
    { parent_type: 'linear_channel', linear_channel_id: id, max: '36' },
    { parent_type: 'video', parent_id: String(videoId || id), linear_channel_id: id, max: '36' }
  ];
  for (const params of attempts) {
    for (const action of ['getvideosegments', 'getrawvideosegments']) {
      try {
        const data = await otteraApi(action, params);
        if (Array.isArray(data?.objects) && data.objects.length) return data.objects;
      } catch {
        /* try next */
      }
    }
  }
  return [];
}

async function getChannelEpg(channelRow, now = new Date()) {
  let config = channelRow?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config || '{}'); } catch { config = {}; }
  }
  const fallback = FALLBACK_CHANNELS.find((c) => c.external_id === config?.fast?.external_id);
  const linearId = config?.fast?.linear_channel_id
    || config?.fast?.network_id
    || fallback?.linear_channel_id;
  const videoId = config?.fast?.video_id || fallback?.video_id || '';
  if (!linearId) return null;

  const cacheKey = `${linearId}:${videoId}`;
  const cached = epgCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return buildEpgFromSegments(channelRow, cached.segments, now);
  }

  try {
    const segments = await getVideoSegments(linearId, videoId);
    epgCache.set(cacheKey, { segments, expires: Date.now() + EPG_CACHE_TTL_MS });
    return buildEpgFromSegments(channelRow, segments, now);
  } catch {
    return null;
  }
}

function buildEpgFromSegments(channelRow, segments, now = new Date()) {
  const ts = Math.floor(now.getTime() / 1000);
  const upcoming = (segments || [])
    .map((seg) => ({
      title: String(seg.name || seg.inline_text?.details || channelRow.name || '').trim(),
      subtitle: String(seg.inline_text?.heading || channelRow.group_title || 'FreeTV').trim(),
      start: parseInt(seg.segment_start_time, 10),
      end: parseInt(seg.segment_end_time, 10)
    }))
    .filter((seg) => Number.isFinite(seg.end) && seg.end > ts)
    .sort((a, b) => a.start - b.start);

  if (!upcoming.length) return null;

  const current = upcoming.find((seg) => seg.start <= ts && seg.end > ts) || upcoming[0];
  const next = upcoming.find((seg) => seg.start >= current.end) || upcoming[1] || null;
  const elapsed = Math.max(0, ts - current.start);
  const total = Math.max(1, current.end - current.start);

  return {
    now: {
      title: current.title || channelRow.name,
      subtitle: current.subtitle || channelRow.group_title || 'FreeTV',
      range: formatEpgRange(current.start, current.end),
      progress: Math.min(100, (elapsed / total) * 100)
    },
    next: next ? {
      title: next.title || 'Programación en vivo',
      subtitle: next.subtitle || channelRow.group_title || 'FreeTV',
      range: formatEpgRange(next.start, next.end)
    } : {
      title: 'Programación en vivo',
      subtitle: channelRow.group_title || 'FreeTV',
      range: formatEpgRange(current.end, current.end + 1800)
    },
    source: 'freetv'
  };
}

async function refreshChannelStream(channel, { force = false } = {}) {
  let config = channel?.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config || '{}'); } catch { config = {}; }
  }
  if (config?.fast?.stream_source === 'pluto_terror_fallback'
    || config?.fast?.external_id === 'freetv-terror') {
    const url = await resolveTerrorStreamUrl();
    const ok = url && await probeStreamUrl(url);
    return ok ? { url, network_id: config?.fast?.linear_channel_id || '19362' } : null;
  }
  const networkId = config?.fast?.network_id;
  if (!networkId) return null;
  if (force) clearStreamCache(networkId);
  const url = resolveStreamUrl(networkId);
  const ok = await probeStreamUrl(url);
  if (!ok && force) {
    clearStreamCache(networkId);
    const rediscovered = await discoverEpgChannels(true);
    const match = rediscovered.find((c) => c.external_id === config?.fast?.external_id);
    if (match?.network_id && match.network_id !== networkId) {
      const altUrl = resolveStreamUrl(match.network_id);
      if (await probeStreamUrl(altUrl)) return { url: altUrl, network_id: match.network_id };
    }
  }
  return ok ? { url, network_id: networkId } : null;
}

module.exports = {
  FREETV_PAGE,
  FREETV_REFERER,
  FALLBACK_CHANNELS,
  OTTERA_LOGOS,
  discoverEpgChannels,
  resolveTerrorStreamUrl,
  buildStreamUrl,
  probeStreamUrl,
  resolveStreamUrl,
  resolveChannelStreamUrl,
  getChannelEpg,
  getVideoSegments,
  refreshChannelStream,
  clearStreamCache,
  isFreetvOtteraUrl,
  isFreetvChannel
};
