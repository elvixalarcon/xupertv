const db = require('../db');
const { ensureCategory } = require('./categories');
const { configFromChannel, mergeConfig, serializeConfig, normalizeSource } = require('./channelConfig');
const streamProxyPool = require('./streamProxyPool');
const { probeHlsManifest } = require('./streamAudio');

const SITES = {
  tvporinternet: {
    key: 'tvporinternet',
    label: 'TV por Internet',
    base: 'https://www.tvporinternet2.com'
  },
  tvenvivo: {
    key: 'tvenvivo',
    label: 'TV EN VIVO 2',
    base: 'https://www.tvenvivo2.com'
  }
};

const DEFAULT_SITE = 'tvporinternet';
const SITE = SITES.tvporinternet.base;
const STREAM_HOST = 'https://regionales.saohgdasregions.fun';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TARGETS = [
  { label: 'Opción 1', target: 1 },
  { label: 'Opción 2', target: 2 },
  { label: 'Opción 3', target: 3 },
  { label: 'Opción 4 FHD', target: 4 },
  { label: 'Opción 5 FHD', target: 5 },
  { label: 'Opción 6 FHD', target: 6 }
];

const CHANNEL_CATALOG = [
  { name: 'AMC', slug: 'amc', group_title: 'Películas', epg_id: 'AMCLatinAmerica.ec' },
  { name: 'Las Estrellas', slug: 'las-estrellas', canal: 'lasestrellas', group_title: 'Novelas', epg_id: '' },
  { name: 'Cartoon Network', slug: 'cartoon-network', canal: 'cartoonnetwork', group_title: 'Kids', epg_id: 'Canal Cartoon Network (Ecuador).ec' },
  { name: 'Nat Geo', slug: 'nat-geo', canal: 'natgeo', group_title: 'Series', epg_id: '' },
  { name: 'Cinemax', slug: 'cinemax', group_title: 'Películas', epg_id: '' },
  { name: 'Warner Channel', slug: 'warner-channel', canal: 'warnerchannel', group_title: 'Películas', epg_id: 'Canal Warner TV (Ecuador).ec' },
  { name: 'Space', slug: 'space', group_title: 'Películas', epg_id: 'Canal Space (Ecuador).ec' },
  { name: 'Universal', slug: 'universal-channel', canal: 'universalchannel', group_title: 'Películas', epg_id: '' },
  { name: 'FX', slug: 'fx', group_title: 'Películas', epg_id: '' },
  { name: 'Golden', slug: 'golden', group_title: 'Películas', epg_id: 'Canal Golden (Ecuador).ec' },
  { name: 'A&E', slug: 'discovery-aye', canal: 'discoveryaye', group_title: 'Series', epg_id: '' },
  { name: 'Disney Channel', slug: 'disney-channel', canal: 'disneychannel', group_title: 'Kids', epg_id: 'Canal Disney Channel (Ecuador).ec' },
  { name: 'History', slug: 'history', canal: 'history', group_title: 'Series', epg_id: 'Canal History (Ecuador).ec' },
  { name: 'History 2', slug: 'history-2', canal: 'history2', group_title: 'Series', epg_id: '' },
  { name: 'Star Channel', slug: 'star-channel', canal: 'starchannel', group_title: 'Películas', epg_id: 'Canal Star Channel (Ecuador).ec' },
  { name: 'AXN', slug: 'axn', group_title: 'Películas', epg_id: '' },
  { name: 'TNT', slug: 'tnt', group_title: 'Películas', epg_id: 'Canal TNT (Ecuador).ec' },
  { name: 'TNT Series', slug: 'tnt-series', canal: 'tntseries', group_title: 'Series', epg_id: '' },
  { name: 'TNT Novelas', slug: 'tnt-novelas', canal: 'tntnovelas', group_title: 'Novelas', epg_id: '' },
  { name: 'Discovery Channel', slug: 'discovery-channel', canal: 'discoverychannel', group_title: 'Series', epg_id: 'Canal Discovery Channel (Ecuador).ec' },
  { name: 'Discovery H&H', slug: 'discovery-hyh', canal: 'discoveryhyh', group_title: 'Series', epg_id: '' },
  { name: 'Animal Planet', slug: 'animal-planet', canal: 'animalplanet', group_title: 'Series', epg_id: '' },
  { name: 'Investigation Discovery', slug: 'id-investigation', canal: 'idinvestigation', group_title: 'Series', epg_id: '' },
  { name: 'Sony Channel', slug: 'canal-sony', canal: 'canalsony', group_title: 'Películas', epg_id: 'Canal Sony (Ecuador).ec' },
  { name: 'USA', slug: 'usa', group_title: 'Películas', epg_id: '' },
  { name: 'Studio Universal', slug: 'studio-universal', canal: 'studiouniversal', group_title: 'Películas', epg_id: '' },
  { name: 'Cinecanal', slug: 'cinecanal', group_title: 'Películas', epg_id: '' },
  { name: 'Universal Cinema', slug: 'universal-cinema', canal: 'universalcinema', group_title: 'Películas', epg_id: '' },
  { name: 'Universal Premiere', slug: 'universal-premiere', canal: 'universalpremiere', group_title: 'Películas', epg_id: '' },
  { name: 'Multipremier', slug: 'multipremier', group_title: 'Películas', epg_id: '' },
  { name: 'Golden Edge', slug: 'golden-edge', canal: 'goldenedge', group_title: 'Películas', epg_id: '' },
  { name: 'Tooncast', slug: 'tooncast', group_title: 'Kids', epg_id: '' },
  { name: 'Telemundo Internacional', slug: 'telemundo-internacional', canal: 'telemundointernacional', group_title: 'Novelas', epg_id: 'Canal Telemundo (Ecuador).ec' },
  { name: 'Telefe', slug: 'telefe', group_title: 'Novelas', epg_id: '' },
  { name: 'Univision', slug: 'univision', group_title: 'Novelas', epg_id: 'Canal Univision (Ecuador).ec' },
  { name: 'TL Novelas', slug: 'tlnovelas', group_title: 'Novelas', epg_id: '' },
  { name: 'ESPN', slug: 'espn', group_title: 'Deportes', epg_id: 'Canal ESPN (Ecuador).ec' },
  { name: 'ESPN 2', slug: 'espn-2', canal: 'espn2', group_title: 'Deportes', epg_id: '' },
  { name: 'ESPN 3', slug: 'espn-3', canal: 'espn3', group_title: 'Deportes', epg_id: '' },
  { name: 'Fox Sports', slug: 'fox-sports', canal: 'foxsports', group_title: 'Deportes', epg_id: 'Canal Fox Sports (Ecuador).ec' },
  { name: 'Fox Sports 2', slug: 'fox-sports-2', canal: 'foxsports2', group_title: 'Deportes', epg_id: '' },
  { name: 'DirecTV Sports', slug: 'directv-sports', canal: 'directvsports', group_title: 'Deportes', epg_id: 'DIRECTVSports.ec' },
  { name: 'TNT Sports', slug: 'tnt-sports', canal: 'tntsports', group_title: 'Deportes', epg_id: '' },
  { name: 'El Canal del Fútbol', slug: 'ecdf', canal: 'ecdf', group_title: 'Deportes', epg_id: '', sites: ['tvporinternet'], aliases: ['ECDF', 'Canal del Futbol'] },
  { name: 'Win Sports Plus', slug: 'win-sports-plus', canal: 'winsportsplus', group_title: 'Deportes', epg_id: '' },
  { name: 'Liga 1', slug: 'liga-1', canal: 'liga1', group_title: 'Deportes', epg_id: '' },
  { name: 'Liga 1 Max', slug: 'liga-1-max', canal: 'liga1max', group_title: 'Deportes', epg_id: '' },
  { name: 'TyC Sports', slug: 'tyc-sports', canal: 'tycsports', group_title: 'Deportes', epg_id: 'TyCSports.ec' },
  { name: 'TUDN', slug: 'tudn', canal: 'tudn', group_title: 'Deportes', epg_id: '' },
  { name: 'A3 Series', slug: 'a3series', canal: 'a3series', group_title: 'Series', epg_id: '', sites: ['tvenvivo'] },
  { name: 'Antena 3', slug: 'antena-3', canal: 'antena3', group_title: 'Series', epg_id: '' },
  { name: 'ESPN Premium Argentina', slug: 'espn-premium-argentina', canal: 'espnpremiumargentina', group_title: 'Deportes', epg_id: '', sites: ['tvenvivo'] },
  { name: 'ESPN Premium LAT', slug: 'espn-premium-latino-america', canal: 'espnpremiumlat', group_title: 'Deportes', epg_id: '', sites: ['tvenvivo'] },
  { name: 'Fox Deportes', slug: 'fox-deportes', canal: 'foxdeportes', group_title: 'Deportes', epg_id: '', sites: ['tvenvivo'] },
  { name: 'TNT Sports Argentina', slug: 'tnt-sports-argentina', canal: 'tntsportsargentina', group_title: 'Deportes', epg_id: '', sites: ['tvenvivo'] },
  { name: 'Warner Bros TV', slug: 'warner-bros-tv', canal: 'warnerbrostv', group_title: 'Películas', epg_id: '', sites: ['tvenvivo'], aliases: ['Warner Bros'] },
  { name: 'Sky Sports Bundesliga', slug: 'sky-sports-bundesliga', canal: 'skysportsbundesliga', group_title: 'Deportes', epg_id: '', sites: ['tvenvivo'] },
  { name: 'Sky Sports La Liga', slug: 'sky-sports-la-liga', canal: 'skysportslaliga', group_title: 'Deportes', epg_id: '' },
  { name: 'DAZN La Liga', slug: 'dazn-la-liga', canal: 'daznlaliga', group_title: 'Deportes', epg_id: '' },
  { name: 'DAZN F1', slug: 'dazn-f1', canal: 'daznf1', group_title: 'Deportes', epg_id: '' }
];

const resolvedCache = new Map();
const playbackCache = new Map();
const RESOLVE_TTL_MS = 25 * 60 * 1000;
const PLAYBACK_TTL_MS = 8 * 60 * 1000;

function isM3u8Url(url = '') {
  return /\.m3u8/i.test(String(url || ''));
}
const PLAYLIST_NAME = 'TV por Internet';
const PLAYLIST_URL = `${SITE}/`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensurePlaylist() {
  let row = db.prepare('SELECT id FROM live_playlists WHERE name = ?').get(PLAYLIST_NAME);
  if (row) {
    db.prepare('UPDATE live_playlists SET m3u_url = ? WHERE id = ?').run(PLAYLIST_URL, row.id);
    return row.id;
  }
  const r = db.prepare('INSERT INTO live_playlists (name, m3u_url) VALUES (?, ?)').run(PLAYLIST_NAME, PLAYLIST_URL);
  return r.lastInsertRowid;
}

function normalizeKey(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function pageUrlFor(meta, siteKey = meta.site || DEFAULT_SITE) {
  const site = SITES[siteKey] || SITES[DEFAULT_SITE];
  return `${site.base}/${meta.slug}-en-vivo-por-internet.php`;
}

function sitesForMeta(meta) {
  if (Array.isArray(meta.sites) && meta.sites.length) {
    return meta.sites.filter((key) => SITES[key]);
  }
  if (meta.site && SITES[meta.site]) return [meta.site];
  return [DEFAULT_SITE, 'tvenvivo'];
}

function siteLabel(siteKey) {
  return SITES[siteKey]?.label || SITES[DEFAULT_SITE].label;
}

function mergeExtracted(items) {
  const byTarget = new Map();
  for (const item of items) {
    const key = item.target || item.label || item.streamUrl;
    const prev = byTarget.get(key);
    if (!prev) {
      byTarget.set(key, item);
      continue;
    }
    const score = (x) => (x.streamUrl && x.has_audio !== false ? 2 : x.streamUrl ? 1 : 0);
    if (score(item) > score(prev)) byTarget.set(key, item);
  }
  return [...byTarget.values()];
}

function canalFor(meta) {
  return meta.canal || meta.slug.replace(/-/g, '');
}

function fetchText(url, headers = {}, opts = {}) {
  return streamProxyPool.fetchText(url, {
    headers: {
      'User-Agent': DEFAULT_UA,
      Accept: 'text/html,application/xhtml+xml,*/*',
      ...headers
    },
    proxy: opts.proxy !== undefined ? opts.proxy : ''
  });
}

async function resolveStreamOptionOnce({ canal, target, pageUrl, label, proxy = '', streamHost = STREAM_HOST }) {
  const cacheKey = `${streamHost}:${canal}:${target}:${proxy || 'direct'}`;
  const cached = resolvedCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const streamUrl = `${streamHost}/stream.php?canal=${encodeURIComponent(canal)}&target=${target}`;
  const page = await fetchText(streamUrl, { Referer: pageUrl || `${SITE}/` }, { proxy });
  if (/registrada en nuestra base de datos/i.test(page.body)) {
    throw new Error(`Opción ${target} bloqueada por el proveedor`);
  }
  const m3u8 = extractM3u8(page.body);
  if (!m3u8) throw new Error(`No se encontró m3u8 en opción ${target}`);

  const value = {
    label: label || TARGETS.find((o) => o.target === target)?.label || `Opción ${target}`,
    pageUrl: pageUrl || `${SITE}/`,
    playerUrl: page.url,
    streamUrl: m3u8,
    proxyUrl: page.proxyUrl || proxy || '',
    resolver: 'tvporinternet',
    resolver_url: streamUrl,
    target
  };
  resolvedCache.set(cacheKey, { value, expires: Date.now() + RESOLVE_TTL_MS });
  return value;
}

async function resolveStreamOption(opts) {
  const explicit = opts.proxy ? [opts.proxy] : [''];
  const useProxyPool = /ksdjugfsddeports/i.test(opts.streamHost || '');
  const fallbacks = useProxyPool
    ? streamProxyPool.listProxies().map((p) => p?.raw || p).filter(Boolean)
    : (explicit[0] && streamProxyPool.isEnabled()
      ? streamProxyPool.getProxiesToTry(2)
      : []);
  const proxies = [...new Set([...explicit, ...fallbacks.map((p) => p || '')])];
  let lastErr;
  for (const proxy of proxies) {
    try {
      return await resolveStreamOptionOnce({ ...opts, proxy: proxy || '' });
    } catch (err) {
      lastErr = err;
      if (proxy) streamProxyPool.markFailed(proxy, err.message);
      if (!useProxyPool && !streamProxyPool.isEnabled()) break;
    }
  }
  throw lastErr || new Error('No se pudo resolver la señal');
}

function parseChannelPage(html, pageUrl, meta = {}, siteKey = DEFAULT_SITE) {
  const site = SITES[siteKey] || SITES[DEFAULT_SITE];
  const iframe = html.match(/iframe[^>]+src="([^"]+)"/i)?.[1] || '';
  const fromIframe = iframe.match(/\/live\d*\/([^/?"]+\.php)/i)?.[1]?.replace(/\.php$/i, '') || '';
  const canal = meta.canal || fromIframe || canalFor(meta);
  const imgRe = new RegExp(`src="(https://www\\.${site.base.replace('https://www.', '')}/imge/[^"]+)"`, 'gi');
  const imgs = [...html.matchAll(imgRe)].map((m) => m[1]);
  const logo = imgs.find((u) => !/donate|favicon/i.test(u))
    || `${site.base}/imge/${canal}.png`;
  return { canal, logo, iframe, pageUrl, site: siteKey };
}

function extractM3u8(body) {
  const fromVar = body.match(/var\s+src\s*=\s*"([^"]+)"/i);
  if (fromVar) return fromVar[1].replace(/\\\//g, '/');
  for (const match of body.matchAll(/https:\\\\\/\\\\\/[^"'\\]+?\.m3u8[^"'\\]*/g)) {
    return match[0].replace(/\\\//g, '/');
  }
  for (const match of body.matchAll(/https:\/\/[^"'\\<> ]+?\.m3u8[^"'\\<> ]*/g)) {
    return match[0];
  }
  return '';
}

async function extractChannelSources(meta, pageUrl, siteKey = DEFAULT_SITE) {
  const canal = canalFor(meta);
  const out = [];
  for (const opt of TARGETS) {
    try {
      const resolved = await resolveStreamOption({
        canal,
        target: opt.target,
        pageUrl,
        label: opt.label
      });
      const audio = await probeHlsManifest(resolved.streamUrl, {
        Referer: resolved.playerUrl,
        'User-Agent': DEFAULT_UA
      });
      if (!audio.ok) {
        out.push({
          label: opt.label,
          target: opt.target,
          canal,
          site: siteKey,
          error: audio.error || 'sin pista de audio'
        });
      } else {
        out.push({
          ...resolved,
          canal,
          site: siteKey,
          has_audio: true,
          audio_codec: audio.codec || 'aac',
          browser_audio: audio.browser_ok !== false
        });
      }
      if (opt.target <= 3) await sleep(350);
    } catch (err) {
      out.push({
        label: opt.label,
        target: opt.target,
        canal,
        site: siteKey,
        error: err.message || String(err)
      });
      await sleep(250);
    }
  }
  return out;
}

function sortSourcesByAudio(sources) {
  return [...sources].sort((a, b) => {
    const rank = (s) => {
      if (s.has_audio === true) return 0;
      if (s.has_audio === false) return 2;
      return 1;
    };
    return rank(a) - rank(b);
  });
}

function isTvPorInternetSource(source) {
  const url = String(source?.url || source?.resolver_url || '');
  return /saohgdasregions\.fun\/stream\.php|ksdjugfsddeports\.com\/stream\.php/i.test(url)
    || source?.resolver === 'tvporinternet';
}

function streamHostFromSource(source) {
  const resolverUrl = source?.resolver_url || source?.url || '';
  try {
    const origin = new URL(resolverUrl).origin;
    if (/ksdjugfsddeports|saohgdasregions/i.test(origin)) return origin;
  } catch { /* ignore */ }
  return STREAM_HOST;
}

async function resolveSourceStream(source, fallbackReferer = `${SITE}/`, { force = false } = {}) {
  if (!force && source?.streamUrl && isM3u8Url(source.streamUrl)) {
    return {
      url: source.streamUrl,
      referer: source.playerUrl || source.referer || fallbackReferer,
      user_agent: source.user_agent || DEFAULT_UA,
      proxy: ''
    };
  }

  const resolverUrl = source?.resolver_url || source?.url || '';
  const canalMatch = resolverUrl.match(/[?&]canal=([^&]+)/i);
  const targetMatch = resolverUrl.match(/[?&]target=(\d+)/i);
  if (!canalMatch || !targetMatch) return null;

  const canal = decodeURIComponent(canalMatch[1]);
  const target = parseInt(targetMatch[1], 10);
  const pageUrl = source?.pageUrl || source?.referer || fallbackReferer;
  const streamHost = streamHostFromSource(source);
  const resolved = await resolveStreamOption({
    canal,
    target,
    pageUrl,
    label: source?.label,
    proxy: '',
    streamHost
  });
  return {
    url: resolved.streamUrl,
    referer: resolved.playerUrl,
    user_agent: DEFAULT_UA,
    proxy: ''
  };
}

function playbackCacheKey(channel) {
  const cfg = configFromChannel(channel);
  return `${channel.id}:${cfg.tvporinternet?.updated_at || ''}:${cfg.vertvcable?.updated_at || ''}:${cfg.m3uts?.updated_at || ''}:${channel.stream_url || ''}`;
}

function invalidateChannelPlayback(channelId) {
  for (const key of playbackCache.keys()) {
    if (key.startsWith(`${channelId}:`)) playbackCache.delete(key);
  }
}

async function resolvePlutoSourcePlayback(source) {
  const movieAlts = require('./movieChannelAlternatives');
  if (!movieAlts.isPlutoSource(source)) return null;
  const resolved = await movieAlts.resolvePlutoPlayback(source);
  if (!resolved?.url) return null;
  return {
    url: resolved.url,
    referer: resolved.referer || '',
    user_agent: resolved.user_agent || DEFAULT_UA,
    proxy: ''
  };
}

async function resolveChannelPlayback(channel, { force = false } = {}) {
  const cacheKey = playbackCacheKey(channel);
  if (!force) {
    const hit = playbackCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.value;
  }

  const config = configFromChannel(channel);
  const pageReferer = config.advanced?.referer || config.tvporinternet?.page || `${SITE}/`;

  const m3utsSync = require('./m3utsSync');
  const m3utsSources = (config.sources || []).filter((s) => m3utsSync.isM3utsSource(s));
  for (const src of m3utsSources) {
    try {
      const resolved = await m3utsSync.resolveSourceStream(src);
      if (!resolved?.url) continue;
      const hdrs = {
        Referer: resolved.referer || m3utsSync.getConfig().baseUrl + '/',
        'User-Agent': resolved.user_agent || DEFAULT_UA
      };
      const manifest = await probeHlsManifest(resolved.url, hdrs);
      if (!manifest.ok) continue;
      const playback = {
        url: resolved.url,
        referer: hdrs.Referer,
        user_agent: hdrs['User-Agent'],
        proxy: ''
      };
      playbackCache.set(cacheKey, { value: playback, expires: Date.now() + PLAYBACK_TTL_MS });
      return playback;
    } catch {
      /* try next source */
    }
  }

  const vertvCable = require('./vertvCable');
  const vertvSources = (config.sources || []).filter((s) => vertvCable.isVertvCableSource(s));
  for (const src of vertvSources) {
    try {
      const resolved = await vertvCable.resolveSourceStream(src);
      if (!resolved?.url) continue;

      const hdrs = {
        Referer: resolved.referer || vertvCable.LA14HD_BASE + '/',
        'User-Agent': resolved.user_agent || DEFAULT_UA
      };
      if (src.has_audio !== true) {
        const audio = await probeHlsManifest(resolved.url, hdrs);
        if (!audio.ok || audio.browser_ok === false) continue;
      }

      const playback = {
        url: resolved.url,
        referer: hdrs.Referer,
        user_agent: hdrs['User-Agent'],
        proxy: ''
      };
      playbackCache.set(cacheKey, { value: playback, expires: Date.now() + PLAYBACK_TTL_MS });
      return playback;
    } catch {
      /* try next source */
    }
  }

  const plutoSources = (config.sources || []).filter((s) => s.resolver === 'pluto');
  for (const src of plutoSources) {
    try {
      const resolved = await resolvePlutoSourcePlayback(src);
      if (!resolved?.url) continue;
      const playback = {
        url: resolved.url,
        referer: resolved.referer,
        user_agent: resolved.user_agent,
        proxy: ''
      };
      playbackCache.set(cacheKey, { value: playback, expires: Date.now() + PLAYBACK_TTL_MS });
      return playback;
    } catch {
      /* try next */
    }
  }

  const tvSources = sortSourcesByAudio((config.sources || []).filter(isTvPorInternetSource));
  for (const src of tvSources) {
    try {
      const resolved = await resolveSourceStream(src, pageReferer, { force });
      if (!resolved?.url) continue;
      if (src.has_audio === false) continue;

      const hdrs = {
        Referer: resolved.referer || pageReferer,
        'User-Agent': resolved.user_agent || DEFAULT_UA
      };
      if (src.has_audio !== true) {
        const audio = await probeHlsManifest(resolved.url, hdrs);
        if (!audio.ok || audio.browser_ok === false) continue;
      }

      const playback = {
        url: resolved.url,
        referer: hdrs.Referer,
        user_agent: hdrs['User-Agent'],
        proxy: ''
      };
      playbackCache.set(cacheKey, { value: playback, expires: Date.now() + PLAYBACK_TTL_MS });
      return playback;
    } catch {
      /* try next source */
    }
  }
  return null;
}

async function getChannelPlayback(channel, opts = {}) {
  return resolveChannelPlayback(channel, opts);
}

async function resolveChannelStreamUrl(channel) {
  const playback = await getChannelPlayback(channel);
  return playback?.url || '';
}

async function resolveChannelHeaders(channel, baseHeaders = {}) {
  const playback = await getChannelPlayback(channel);
  if (!playback?.url) return baseHeaders;

  const hdrs = {
    ...baseHeaders,
    Referer: playback.referer || baseHeaders.Referer,
    'User-Agent': playback.user_agent || baseHeaders['User-Agent'] || DEFAULT_UA,
    Accept: '*/*',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
  };
  if (/fubo18\.com/i.test(playback.url)) {
    hdrs.Referer = playback.referer || 'https://la14hd.com/';
    hdrs.Origin = 'https://la14hd.com';
  } else if (streamProxyPool.needsStreamProxy(playback.url)) {
    hdrs.Origin = streamProxyPool.streamOriginFor(playback.url) || 'https://regionales.saohgdasregions.fun';
    hdrs['Sec-Fetch-Dest'] = 'empty';
    hdrs['Sec-Fetch-Mode'] = 'cors';
    hdrs['Sec-Fetch-Site'] = 'same-site';
  }
  return hdrs;
}

function buildFallbackSources(meta, pageUrl, siteKey = DEFAULT_SITE) {
  const canal = canalFor(meta);
  const siteName = siteLabel(siteKey);
  return TARGETS.slice(0, 3).map((opt) => normalizeSource({
    url: `${STREAM_HOST}/stream.php?canal=${encodeURIComponent(canal)}&target=${opt.target}`,
    referer: pageUrl,
    user_agent: DEFAULT_UA,
    scan_status: 'pending',
    scan_info: `${opt.label} · ${siteName} · pendiente de señal`,
    resolver: 'tvporinternet',
    resolver_url: `${STREAM_HOST}/stream.php?canal=${encodeURIComponent(canal)}&target=${opt.target}`,
    pageUrl,
    label: opt.label,
    canal,
    site: siteKey
  }));
}

function buildSources(meta, extracted, pageUrl, siteKey = DEFAULT_SITE) {
  const canal = canalFor(meta);
  const working = extracted.filter((item) => item.streamUrl && item.has_audio !== false);
  const siteName = siteLabel(siteKey);
  return working.map((item) => normalizeSource({
    url: item.resolver_url || `${STREAM_HOST}/stream.php?canal=${encodeURIComponent(canal)}&target=${item.target || 1}`,
    referer: pageUrl,
    user_agent: DEFAULT_UA,
    scan_status: item.has_audio === false ? 'warning' : 'ok',
    scan_info: item.has_audio === false
      ? `${item.label} · sin audio en fuente`
      : `${item.label} · ${siteName} · ${item.audio_codec || 'audio'}`,
    resolver: 'tvporinternet',
    resolver_url: item.resolver_url || `${STREAM_HOST}/stream.php?canal=${encodeURIComponent(canal)}&target=${item.target || 1}`,
    pageUrl,
    playerUrl: item.playerUrl || '',
    streamUrl: item.streamUrl || '',
    proxyUrl: item.proxyUrl || '',
    has_audio: item.has_audio !== false,
    label: item.label || 'Opción 1',
    canal,
    site: siteKey
  }));
}

function findExistingChannel(meta) {
  const key = normalizeKey(meta.name);
  const rows = db.prepare(`
    SELECT * FROM live_channels
    WHERE lower(name) = lower(?)
       OR lower(replace(name, ' ', '')) = lower(?)
    ORDER BY enabled DESC, id ASC
  `).all(meta.name, meta.name.replace(/\s+/g, ''));

  if (rows.length) return rows[0];

  return db.prepare(`
    SELECT * FROM live_channels
    WHERE config LIKE ?
    ORDER BY enabled DESC, id ASC
    LIMIT 1
  `).get(`%"canal":"${canalFor(meta)}"%`);
}

async function importChannel(meta) {
  const siteKeys = sitesForMeta(meta);
  const pageMap = {};
  let parsed = null;
  let allExtracted = [];
  let allSkipped = [];

  for (const siteKey of siteKeys) {
    const pageUrl = pageUrlFor(meta, siteKey);
    const page = await fetchText(pageUrl);
    if (page.status !== 200 || page.body.length < 2500) continue;
    pageMap[siteKey] = pageUrl;
    const current = parseChannelPage(page.body, pageUrl, meta, siteKey);
    if (!parsed) parsed = current;
    const extracted = await extractChannelSources({ ...meta, canal: current.canal }, pageUrl, siteKey);
    allExtracted.push(...extracted);
    allSkipped.push(...extracted.filter((x) => x.error));
    await sleep(400);
  }

  if (!parsed || !Object.keys(pageMap).length) {
    throw new Error(`No se pudo cargar ${meta.name} en ${siteKeys.map((k) => siteLabel(k)).join(' / ')}`);
  }

  const canal = parsed.canal;
  const mergedExtracted = mergeExtracted(allExtracted);
  let sources = [];
  for (const siteKey of Object.keys(pageMap)) {
    const siteItems = mergedExtracted.filter((item) => item.site === siteKey || !item.site);
    sources.push(...buildSources({ ...meta, canal }, siteItems, pageMap[siteKey], siteKey));
  }
  sources = sources.filter((s, idx, arr) => arr.findIndex((x) => x.resolver_url === s.resolver_url) === idx);

  const skipped = allSkipped;
  if (!sources.length) {
    for (const siteKey of Object.keys(pageMap)) {
      sources.push(...buildFallbackSources({ ...meta, canal }, pageMap[siteKey], siteKey));
    }
    sources = sources.filter((s, idx, arr) => arr.findIndex((x) => x.resolver_url === s.resolver_url) === idx);
  }
  if (!sources.length) {
    const errors = skipped.map((x) => `${x.label}: ${x.error}`);
    throw new Error(errors.join(' · ') || `Sin fuentes con audio para ${meta.name}`);
  }

  ensureCategory(meta.group_title, 'live');
  const playlistId = ensurePlaylist();

  let channel = findExistingChannel(meta);
  const prev = channel ? configFromChannel(channel) : mergeConfig({}, {});
  const existingNonTv = (prev.sources || []).filter((s) => !isTvPorInternetSource(s));
  const mergedSources = [...sources, ...existingNonTv];

  const primaryPage = pageMap[siteKeys.find((k) => pageMap[k]) || DEFAULT_SITE] || pageUrlFor(meta);
  const config = mergeConfig(prev, {
    enabled: true,
    sources: mergedSources,
    advanced: {
      ...prev.advanced,
      referer: primaryPage,
      user_agent: DEFAULT_UA
    },
    epg: {
      ...prev.epg,
      channel_id: meta.epg_id || prev.epg?.channel_id || ''
    },
    tvporinternet: {
      page: primaryPage,
      pages: pageMap,
      canal,
      slug: meta.slug,
      sites: Object.keys(pageMap),
      updated_at: new Date().toISOString()
    }
  });

  const primary = sources.find((s) => s.streamUrl)?.streamUrl || sources[0].url;
  const logo = parsed.logo;

  if (channel) {
    db.prepare(`
      UPDATE live_channels
      SET playlist_id = ?, name = ?, stream_url = ?, logo = ?, group_title = ?, config = ?, enabled = 1
      WHERE id = ?
    `).run(playlistId, meta.name, primary, logo, meta.group_title, serializeConfig(config), channel.id);
  } else {
    const result = db.prepare(`
      INSERT INTO live_channels (playlist_id, name, stream_url, logo, group_title, config, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(playlistId, meta.name, primary, logo, meta.group_title, serializeConfig(config));
    channel = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(result.lastInsertRowid);
  }

  return {
    channel_id: channel.id,
    name: meta.name,
    group_title: meta.group_title,
    canal,
    sources_added: sources.length,
    sources,
    skipped,
    pending: !mergedExtracted.some((x) => x.streamUrl && x.has_audio !== false),
    page: primaryPage,
    pages: pageMap
  };
}

function catalogEntry(query) {
  const key = normalizeKey(query);
  return CHANNEL_CATALOG.find((item) =>
    normalizeKey(item.name) === key
    || normalizeKey(item.slug) === key
    || normalizeKey(item.canal || item.slug) === key
    || (item.aliases || []).some((alias) => normalizeKey(alias) === key)
  );
}

async function importChannels(names = []) {
  let list = CHANNEL_CATALOG;
  if (Array.isArray(names) && names.length) {
    list = names.map((name) => {
      const found = catalogEntry(name);
      if (!found) throw new Error(`Canal no soportado: ${name}`);
      return found;
    });
  }

  const results = [];
  for (const meta of list) {
    try {
      results.push({ ok: true, ...(await importChannel(meta)) });
    } catch (err) {
      results.push({ ok: false, name: meta.name, error: err.message || String(err) });
    }
    await sleep(1500);
  }

  return {
    total: list.length,
    imported: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    channels: results
  };
}

/** Compatibilidad con importación anterior de AMC */
async function importAmcFromPage(pageUrl = pageUrlFor(CHANNEL_CATALOG[0])) {
  const meta = { ...CHANNEL_CATALOG[0], slug: pageUrl.match(/\/([^/]+)-en-vivo/i)?.[1] || CHANNEL_CATALOG[0].slug };
  return importChannel(meta);
}

/** Asegura canales del catálogo en live_channels (p. ej. Deportes / ECDF). */
async function ensureLiveCatalogChannels(names = []) {
  const list = (Array.isArray(names) && names.length)
    ? names.map((name) => {
      const found = catalogEntry(name);
      if (!found) throw new Error(`Canal no soportado: ${name}`);
      return found;
    })
    : CHANNEL_CATALOG.filter((c) => c.group_title === 'Deportes');

  const results = [];
  for (const meta of list) {
    const existing = findExistingChannel(meta);
    if (existing && !existing.enabled) {
      results.push({ ok: true, skipped: true, name: meta.name, channel_id: existing.id, reason: 'disabled' });
      continue;
    }
    if (existing && existing.enabled) {
      results.push({ ok: true, skipped: true, name: meta.name, channel_id: existing.id });
      continue;
    }
    try {
      results.push({ ok: true, ...(await importChannel(meta)) });
    } catch (err) {
      if (existing) {
        if (existing.enabled) {
          db.prepare(`
            UPDATE live_channels SET group_title = ?, enabled = 1 WHERE id = ?
          `).run(meta.group_title, existing.id);
        }
        results.push({ ok: true, name: meta.name, channel_id: existing.id, warning: err.message });
      } else {
        results.push({ ok: false, name: meta.name, error: err.message || String(err) });
      }
    }
    await sleep(800);
  }
  return results;
}

module.exports = {
  SITES,
  CHANNEL_CATALOG,
  TARGETS,
  pageUrlFor,
  sitesForMeta,
  parseChannelPage,
  extractChannelSources,
  importChannel,
  importChannels,
  importAmcFromPage,
  ensureLiveCatalogChannels,
  catalogEntry,
  resolveStreamOption,
  resolveSourceStream,
  resolveChannelStreamUrl,
  resolveChannelHeaders,
  resolveChannelPlayback,
  getChannelPlayback,
  invalidateChannelPlayback,
  isTvPorInternetSource
};
