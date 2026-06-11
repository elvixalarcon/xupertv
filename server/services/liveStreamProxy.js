const http = require('http');
const https = require('https');
const { configFromChannel, primarySourceUrl } = require('./channelConfig');
const streamProxyPool = require('./streamProxyPool');
const { resolveUrl } = require('./playlistImport');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30000, rejectUnauthorized: false });

const redirectCache = new Map();
const manifestCache = new Map();
const REDIRECT_TTL_MS = 5 * 60 * 1000;
const MANIFEST_TTL_MS = 1200;
const MANIFEST_TTL_MOBILE_MS = 400;

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit || hit.expires < Date.now()) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(map, key, value, ttl) {
  map.set(key, { value, expires: Date.now() + ttl });
}

function defaultHeaders(extra = {}) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
    Referer: 'https://tv.vixred.com/',
    ...extra
  };
}

function channelHeaders(channel) {
  const config = configFromChannel(channel);
  const adv = config.advanced || {};
  const hdrs = defaultHeaders();
  if (adv.user_agent) hdrs['User-Agent'] = adv.user_agent;
  if (adv.referer) hdrs.Referer = adv.referer;
  if (adv.http_proxy) hdrs._proxy = adv.http_proxy;
  const url = String(channel?.stream_url || config.sources?.[0]?.url || '');
  if (config?.fast?.source === 'freetv' || /stream\.ads\.ottera\.tv/i.test(url)) {
    hdrs.Referer = 'https://www.freetv.com/';
    hdrs.Origin = 'https://www.freetv.com';
  }
  if (/esradioecuador\.com/i.test(url)) {
    hdrs.Referer = adv.referer || config.gamavision?.referer || 'https://www.gamavision.com.ec/';
    hdrs.Origin = 'https://www.gamavision.com.ec';
  }
  if (config?.ecuaplay?.player || /fubo18\.com/i.test(url)) {
    hdrs.Referer = adv.referer || config.ecuaplay?.referer || 'https://la18hd.com/';
    hdrs.Origin = 'https://la18hd.com';
  }
  if (config?.clarosports?.direct || /en-vivo\.clarosports\.com/i.test(url)) {
    hdrs.Referer = adv.referer || 'https://en-vivo.clarosports.com/';
    hdrs.Origin = 'https://en-vivo.clarosports.com';
  }
  return hdrs;
}

async function requestOnce(url, headers, binary = false) {
  const proxy = headers._proxy || '';
  const cleanHeaders = { ...headers };
  delete cleanHeaders._proxy;

  if (proxy) {
    const res = await streamProxyPool.request(url, {
      headers: cleanHeaders,
      proxy,
      timeout: 12000
    });
    const location = res.headers.location || res.headers.Location;
    if (location && [301, 302, 303, 307, 308].includes(res.status)) {
      const next = location.startsWith('http') ? location : new URL(location, url).href;
      return { redirect: next };
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    if (binary) return { body: res.body, headers: res.headers };
    return { body: res.body.toString('utf8'), headers: res.headers };
  }

  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    const req = client.get(url, {
      agent: isHttps ? httpsAgent : httpAgent,
      timeout: 12000,
      headers
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return resolve({ redirect: next });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      if (binary) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ body: Buffer.concat(chunks), headers: res.headers }));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function resolveRedirect(url, headers, depth = 0) {
  const cached = cacheGet(redirectCache, url);
  if (cached) return cached;

  let current = url;
  for (let i = 0; i < 6; i++) {
    const res = await requestOnce(current, headers);
    if (res.redirect) {
      current = res.redirect;
      continue;
    }
    cacheSet(redirectCache, url, current, REDIRECT_TTL_MS);
    return current;
  }
  if (depth > 0) return url;
  throw new Error('Demasiados redirects');
}

async function fetchManifestText(url, headers) {
  const resolved = await resolveRedirect(url, headers);
  const cacheKey = `${resolved}\0${headers.Referer || ''}\0${headers['User-Agent'] || ''}\0${headers.Cookie || ''}\0${headers._proxy || ''}\0${headers._mobile ? 'm' : 'd'}`;
  const cached = cacheGet(manifestCache, cacheKey);
  if (cached) return cached;

  const res = await requestOnce(resolved, headers);
  const base = resolved.substring(0, resolved.lastIndexOf('/') + 1);
  const payload = { url: resolved, base, content: res.body };
  const ttl = headers._mobile ? MANIFEST_TTL_MOBILE_MS : MANIFEST_TTL_MS;
  cacheSet(manifestCache, cacheKey, payload, ttl);
  return payload;
}

function isMasterPlaylist(content) {
  return /#EXT-X-STREAM-INF/i.test(content);
}

function parseStreamVariant(line, nextLine, baseUrl) {
  if (!line.includes('#EXT-X-STREAM-INF')) return null;
  const next = (nextLine || '').trim();
  if (!next || next.startsWith('#')) return null;

  const bandwidth = parseInt((line.match(/BANDWIDTH=(\d+)/i) || [])[1] || '0', 10);
  const width = parseInt((line.match(/RESOLUTION=(\d+)x/i) || [])[1] || '0', 10);
  const height = parseInt((line.match(/RESOLUTION=\d+x(\d+)/i) || [])[1] || '0', 10);
  const score = (bandwidth || 0) + (width * height);

  return {
    bandwidth: bandwidth || score,
    score,
    url: resolveUrl(baseUrl, next)
  };
}

function pickHighestVariant(content, baseUrl) {
  const lines = content.split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const variant = parseStreamVariant(lines[i], lines[i + 1], baseUrl);
    if (!variant) continue;
    if (!best || variant.score > best.score) best = variant;
  }
  return best?.url || '';
}

function pickLowestVariant(content, baseUrl) {
  const lines = content.split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const variant = parseStreamVariant(lines[i], lines[i + 1], baseUrl);
    if (!variant) continue;
    if (!best || variant.score < best.score) best = variant;
  }
  return best?.url || '';
}

async function resolveBestManifest(url, headers, depth = 0, preferLowest = false) {
  if (depth > 4) throw new Error('Demasiados niveles HLS');
  const manifest = await fetchManifestText(url, headers);
  if (!isMasterPlaylist(manifest.content)) return manifest;

  const hasAudioGroup = /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/i.test(manifest.content);
  if (hasAudioGroup) return manifest;

  const pick = preferLowest ? pickLowestVariant : pickHighestVariant;
  const variantUrl = pick(manifest.content, manifest.base);
  if (!variantUrl) return manifest;
  return resolveBestManifest(variantUrl, headers, depth + 1, preferLowest);
}

function rewriteM3u8(content, baseUrl, token, hdrs = {}, opts = {}) {
  const mobile = !!(opts.mobile || hdrs._mobile);
  const proxyUrl = hdrs._proxy || '';
  const proxy = (url) => {
    let q = `url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
    const ua = hdrs['User-Agent'];
    const referer = hdrs.Referer;
    const cookie = hdrs.Cookie;
    if (ua) q += `&ua=${encodeURIComponent(ua)}`;
    if (referer) q += `&referer=${encodeURIComponent(referer)}`;
    if (cookie) q += `&cookie=${encodeURIComponent(cookie)}`;
    if (proxyUrl) q += `&px=${encodeURIComponent(proxyUrl)}`;
    if (mobile) q += '&profile=mobile';
    return `/api/live/stream?${q}`;
  };

  let result = content.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      if (/URI="/i.test(trimmed)) {
        return trimmed.replace(/URI="([^"]+)"/gi, (_, u) => `URI="${proxy(resolveUrl(baseUrl, u))}"`);
      }
      return line;
    }
    return proxy(resolveUrl(baseUrl, trimmed));
  }).join('\n');

  const startOffset = opts.liveStartOffset;
  if (startOffset != null && /#EXTINF:/i.test(result) && !/#EXT-X-START:/i.test(result)) {
    result = result.replace(/#EXTM3U[^\n]*\n/i, (head) => `${head}#EXT-X-START:TIME-OFFSET=${startOffset}\n`);
  }

  return result;
}

function isHlsManifestUrl(url) {
  const path = String(url || '').split('?')[0].toLowerCase();
  if (/\.(m3u8?|ism)$/i.test(path)) return true;
  if (/\.isml\/[^/]+\.m3u8$/i.test(path)) return true;
  return false;
}

async function buildChannelPlaylist(channel, token, opts = {}) {
  const preferLowest = !!opts.preferLowest;
  const fastChannelsSync = require('./fastChannelsSync');
  const tvPorInternet = require('./tvPorInternet');
  const tcTelevisionSync = require('./tcTelevisionSync');
  const vixSync = require('./vixSync');
  const config = configFromChannel(channel);
  let upstream = primarySourceUrl(config, channel.stream_url);
  const vertvCable = require('./vertvCable');
  const m3utsSync = require('./m3utsSync');
  const needsTvResolve = /stream\.php/i.test(upstream || '')
    || /la14hd\.com/i.test(upstream || '')
    || /m3uts\.xyz/i.test(upstream || '')
    || (config.sources || []).some((s) => tvPorInternet.isTvPorInternetSource(s) || vertvCable.isVertvCableSource(s) || m3utsSync.isM3utsSource(s));
  const needsTcResolve = tcTelevisionSync.isTcTelevisionChannel(channel);
  const needsVixResolve = vixSync.isVixChannel(channel);
  const tcReferer = config.advanced?.referer || config.tctelevision?.page_url || 'https://tctelevision.com/envivo/';

  const dynamic = await fastChannelsSync.resolveChannelStreamUrl({ ...channel, config });
  if (dynamic) upstream = dynamic;

  let playback = null;
  if (needsTcResolve) {
    if (tcTelevisionSync.isVariantStreamUrl(upstream)) {
      playback = {
        url: upstream,
        referer: tcReferer,
        user_agent: config.advanced?.user_agent || '',
        cookies: ''
      };
    } else {
      playback = await tcTelevisionSync.getChannelPlayback(channel);
      if (playback?.url) upstream = playback.url;
    }
  } else if (needsVixResolve) {
    playback = await vixSync.getChannelPlayback(channel);
    if (playback?.url) upstream = playback.url;
  } else if (needsTvResolve) {
    playback = await tvPorInternet.getChannelPlayback(channel);
    if (playback?.url) upstream = playback.url;
  } else if (!/\.m3u8/i.test(upstream || '')) {
    playback = await tvPorInternet.getChannelPlayback(channel);
    if (playback?.url) upstream = playback.url;
  }

  if (!upstream) throw new Error('Canal sin URL');

  let hdrs = channelHeaders(channel);
  if (playback?.url) {
    hdrs = {
      ...hdrs,
      Referer: playback.referer || hdrs.Referer,
      'User-Agent': playback.user_agent || hdrs['User-Agent']
    };
    if (playback.cookies) hdrs.Cookie = playback.cookies;
    if (needsTcResolve) hdrs.Origin = 'https://tctelevision.com';
    if (streamProxyPool.needsStreamProxy(playback.url)) {
      hdrs.Origin = 'https://regionales.saohgdasregions.fun';
    }
  } else if (needsTvResolve) {
    hdrs = await tvPorInternet.resolveChannelHeaders(channel, hdrs);
  } else if (needsVixResolve) {
    hdrs.Referer = playback?.referer || 'https://vix.com/';
  } else if (needsTcResolve) {
    hdrs.Referer = 'https://tctelevision.com/envivo/';
    hdrs.Origin = 'https://tctelevision.com';
  }
  delete hdrs._proxy;
  if (preferLowest) hdrs._mobile = true;

  const rewriteOpts = { mobile: preferLowest };

  try {
    const manifest = await resolveBestManifest(upstream, hdrs, 0, preferLowest);
    return rewriteM3u8(manifest.content, manifest.base, token, hdrs, rewriteOpts);
  } catch (err) {
    if (needsTcResolve) {
      tcTelevisionSync.invalidateChannelPlayback(channel.id);
      playback = await tcTelevisionSync.getChannelPlayback(channel, { force: true });
      if (playback?.url) {
        upstream = playback.url;
        hdrs.Referer = playback.referer || hdrs.Referer;
        hdrs['User-Agent'] = playback.user_agent || hdrs['User-Agent'];
        if (playback.cookies) hdrs.Cookie = playback.cookies;
        hdrs.Origin = 'https://tctelevision.com';
        const manifest = await resolveBestManifest(upstream, hdrs, 0, preferLowest);
        return rewriteM3u8(manifest.content, manifest.base, token, hdrs, rewriteOpts);
      }
    }
    if (needsVixResolve) {
      vixSync.invalidateChannelPlayback(channel.id);
      try {
        await vixSync.refreshVixChannel(channel, { force: true });
      } catch { /* ignore */ }
      playback = await vixSync.getChannelPlayback(channel, { force: true });
      if (playback?.url) {
        upstream = playback.url;
        hdrs.Referer = playback.referer || hdrs.Referer;
        hdrs['User-Agent'] = playback.user_agent || hdrs['User-Agent'];
        const manifest = await resolveBestManifest(upstream, hdrs, 0, preferLowest);
        return rewriteM3u8(manifest.content, manifest.base, token, hdrs, rewriteOpts);
      }
    }
    if (needsTvResolve) {
      tvPorInternet.invalidateChannelPlayback(channel.id);
      playback = await tvPorInternet.getChannelPlayback(channel, { force: true });
      if (playback?.url) {
        upstream = playback.url;
        hdrs.Referer = playback.referer || hdrs.Referer;
        const manifest = await resolveBestManifest(upstream, hdrs, 0, preferLowest);
        return rewriteM3u8(manifest.content, manifest.base, token, hdrs, rewriteOpts);
      }
    }
    throw err;
  }
}

function pipeUpstream(url, res, reqHeaders = {}) {
  let proxy = reqHeaders._proxy || '';
  if (proxy && !streamProxyPool.needsStreamProxy(url)) proxy = '';
  const headers = { ...reqHeaders };
  delete headers._proxy;

  if (proxy && url.startsWith('https://')) {
    return streamProxyPool.pipeViaProxy(proxy, url, res, headers);
  }

  const isHttps = url.startsWith('https');
  const client = isHttps ? https : http;
  const opts = {
    agent: isHttps ? httpsAgent : httpAgent,
    headers: defaultHeaders(headers)
  };

  client.get(url, opts, (upstream) => {
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      upstream.resume();
      const next = upstream.headers.location.startsWith('http')
        ? upstream.headers.location
        : new URL(upstream.headers.location, url).href;
      return pipeUpstream(next, res, reqHeaders);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (upstream.headers['content-type']) res.setHeader('Content-Type', upstream.headers['content-type']);
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
    if (upstream.statusCode >= 400) {
      upstream.resume();
      res.status(upstream.statusCode >= 500 ? 502 : upstream.statusCode).end();
      return;
    }
    res.status(upstream.statusCode);
    upstream.pipe(res);
  }).on('error', () => res.status(502).end());
}

async function fetchManifestForProxy(url, hdrs) {
  const resolved = await resolveRedirect(url, hdrs);
  const cacheKey = `proxy:${resolved}\0${hdrs.Referer || ''}\0${hdrs._proxy || ''}\0best`;
  const cached = cacheGet(manifestCache, cacheKey);
  if (cached) return cached;

  const manifest = await resolveBestManifest(resolved, hdrs);
  cacheSet(manifestCache, cacheKey, manifest, MANIFEST_TTL_MS);
  return manifest;
}

module.exports = {
  httpAgent,
  httpsAgent,
  channelHeaders,
  defaultHeaders,
  resolveRedirect,
  fetchManifestText,
  fetchManifestForProxy,
  buildChannelPlaylist,
  rewriteM3u8,
  isHlsManifestUrl,
  isMasterPlaylist,
  pickHighestVariant,
  pickLowestVariant,
  resolveBestManifest,
  pipeUpstream
};
