const db = require('../db');
const { getSetting, setSetting } = require('./settings');
const { configFromChannel, serializeConfig, normalizeSource } = require('./channelConfig');
const streamProxyPool = require('./streamProxyPool');
const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const RESOLVE_SCRIPT = path.join(__dirname, '..', 'scripts', 'resolve-tc-stream.py');

const TC_PAGE = 'https://tctelevision.com/envivo/';
const TC_EMBEDDER = 'https://tctelevision.com';
const DEFAULT_VIDEO_ID = 'x7wijay';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_REFERER = TC_PAGE;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 2 * 60 * 60 * 1000;
const PLAYBACK_TTL_MS = 20 * 60 * 1000;

let syncTimer = null;
let retryTimer = null;
let running = false;
const playbackCache = new Map();

function isEnabled() {
  return getSetting('tc_refresh_enabled', '1') !== '0';
}

function intervalMs() {
  const hours = parseFloat(getSetting('tc_refresh_hours', '24')) || 24;
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function parseCookies(headers = {}) {
  const raw = headers['set-cookie'];
  if (!raw) return '';
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => String(c).split(';')[0]).filter(Boolean).join('; ');
}

function mergeCookies(...parts) {
  const jar = new Map();
  for (const part of parts) {
    for (const chunk of String(part || '').split(';')) {
      const piece = chunk.trim();
      if (!piece || !piece.includes('=')) continue;
      const [name, ...rest] = piece.split('=');
      jar.set(name.trim(), rest.join('=').trim());
    }
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function isTcTelevisionChannel(channel) {
  const config = configFromChannel(channel);
  if ((config.sources || []).some((s) => s.resolver === 'tctelevision')) return true;
  const url = String(channel?.stream_url || '');
  return /x7wijay|tctelevision|cdndirector\.dailymotion\.com\/cdn\/live\/video|dmcdn\.net\/sec2/i.test(url);
}

function invalidateChannelPlayback(channelId) {
  playbackCache.delete(String(channelId));
}

async function httpGet(url, { cookies = '', referer = DEFAULT_REFERER, origin = '' } = {}) {
  const headers = {
    'User-Agent': DEFAULT_UA,
    Accept: '*/*',
    'Accept-Language': 'es-EC,es;q=0.9,en;q=0.8',
    Referer: referer
  };
  if (cookies) headers.Cookie = cookies;
  if (origin) headers.Origin = origin;

  const res = await streamProxyPool.request(url, { headers, timeout: 25000 });
  const body = res.body?.toString('utf8') || '';
  return {
    status: res.status || 0,
    headers: res.headers || {},
    body,
    url: res.url || url,
    cookies: mergeCookies(cookies, parseCookies(res.headers || {}))
  };
}

function extractVideoIdFromPage(html = '') {
  const iframe = String(html).match(/dailymotion\.com\/player\.html\?video=([a-z0-9]+)/i)?.[1];
  if (iframe) return iframe;
  const generic = String(html).match(/dailymotion\.com\/(?:video|embed\/video)\/([a-z0-9]+)/i)?.[1];
  return generic || DEFAULT_VIDEO_ID;
}

function metadataUrl(videoId) {
  return `https://www.dailymotion.com/player/metadata/video/${videoId}?embedder=${encodeURIComponent(TC_EMBEDDER)}`;
}

function pickBestVariant(masterBody = '') {
  const lines = String(masterBody).split(/\r?\n/);
  let best1080 = '';
  let best720 = '';
  let bestAny = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const next = (lines[i + 1] || '').split('#')[0].trim();
    if (!next.startsWith('http')) continue;
    if (/NAME="1080"|RESOLUTION=1920x1080|live-1080/i.test(line)) best1080 = next;
    else if (/NAME="720"|RESOLUTION=1280x720|,720,|live-720/i.test(line)) best720 = next;
    if (!bestAny) bestAny = next;
  }
  return best1080 || best720 || bestAny || '';
}

function isVariantStreamUrl(url = '') {
  return /dmcdn\.net\/sec2\(/i.test(String(url || '')) && /\.m3u8/i.test(String(url || ''));
}

function isDirectorStreamUrl(url = '') {
  return /cdndirector\.dailymotion\.com\/cdn\/live\/video/i.test(String(url || ''));
}

function embedPlayerUrl(videoId = DEFAULT_VIDEO_ID) {
  return `https://geo.dailymotion.com/player.html?video=${videoId}`;
}

function listTcChannels() {
  return db.prepare(`
    SELECT * FROM live_channels
    WHERE lower(name) IN ('tc', 'tc television', 'tc televisión', 'tc television ecuador')
       OR config LIKE '%"resolver":"tctelevision"%'
       OR stream_url LIKE '%x7wijay%'
       OR stream_url LIKE '%cdndirector.dailymotion.com/cdn/live/video%'
    ORDER BY CASE WHEN lower(name) = 'tc' THEN 0 ELSE 1 END, id
  `).all();
}

function parsePythonPayload(stdout = '') {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    const payload = JSON.parse(text);
    if (!payload?.ok || !payload?.stream_url) return null;
    return payload;
  } catch {
    return null;
  }
}

async function runTcPythonResolver(videoId = DEFAULT_VIDEO_ID) {
  const attempts = 4;
  let lastErr = 'No se pudo resolver TC';

  for (let i = 0; i < attempts; i++) {
    try {
      const { stdout } = await execFileAsync('python3', [RESOLVE_SCRIPT, videoId], {
        timeout: 60000,
        maxBuffer: 1024 * 1024
      });
      const payload = parsePythonPayload(stdout);
      if (payload) return payload;
      lastErr = 'Respuesta vacía del resolver TC';
    } catch (err) {
      const payload = parsePythonPayload(err.stdout);
      if (payload) return payload;
      lastErr = err.stderr?.toString()?.trim() || err.message || String(err);
    }
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }

  throw new Error(String(lastErr).slice(0, 220));
}

async function resolveTcStreamViaPython(videoId = DEFAULT_VIDEO_ID) {
  const payload = await runTcPythonResolver(videoId);
  return {
    streamUrl: payload.stream_url,
    videoId: payload.video_id || videoId,
    title: payload.title || 'TC Televisión',
    liveStatus: payload.live_status || '',
    directorUrl: payload.director_url || '',
    cookies: '',
    referer: DEFAULT_REFERER,
    user_agent: DEFAULT_UA
  };
}

async function probePlaybackUrl(url, { cookies = '', referer = DEFAULT_REFERER } = {}) {
  if (!url) return false;
  try {
    const res = await httpGet(url, { cookies, referer, origin: TC_EMBEDDER });
    return res.status < 400 && res.body.includes('#EXTM3U');
  } catch {
    return false;
  }
}

async function resolveTcStreamUrl(opts = {}) {
  const videoId = opts.videoId || DEFAULT_VIDEO_ID;
  try {
    return await resolveTcStreamViaPython(videoId);
  } catch (pyErr) {
    console.warn('[tc-sync] python:', pyErr.message || pyErr);
  }

  const page = await httpGet(TC_PAGE);
  if (page.status >= 400 || !page.body) {
    throw new Error(`No se pudo leer ${TC_PAGE} (HTTP ${page.status || 'error'})`);
  }

  const resolvedVideoId = extractVideoIdFromPage(page.body) || videoId;
  const meta = await httpGet(metadataUrl(resolvedVideoId), { cookies: page.cookies });
  if (meta.status >= 400) {
    throw new Error(`Metadata Dailymotion HTTP ${meta.status}`);
  }

  let payload;
  try {
    payload = JSON.parse(meta.body);
  } catch {
    throw new Error('Respuesta inválida de Dailymotion');
  }

  if (payload?.error?.code) {
    throw new Error(`Dailymotion: ${payload.error.message || payload.error.code}`);
  }

  const directorUrl = payload?.qualities?.auto?.[0]?.url || '';
  if (!directorUrl) throw new Error('Sin URL M3U8 en metadata de TC');

  const cookies = mergeCookies(page.cookies, meta.cookies);
  let streamUrl = directorUrl;

  try {
    const master = await httpGet(directorUrl, {
      cookies,
      referer: DEFAULT_REFERER,
      origin: TC_EMBEDDER
    });
    if (master.status < 400 && master.body.includes('#EXTM3U')) {
      const variant = pickBestVariant(master.body);
      if (variant) streamUrl = variant;
    }
  } catch {
    /* Mantener URL director; se resuelve al reproducir */
  }

  return {
    streamUrl,
    videoId: resolvedVideoId,
    title: payload.title || 'TC Televisión',
    liveStatus: payload.live_public_status || '',
    directorUrl,
    cookies,
    referer: DEFAULT_REFERER,
    user_agent: DEFAULT_UA
  };
}

async function getChannelPlayback(channel, opts = {}) {
  const cacheKey = String(channel.id);
  const cached = playbackCache.get(cacheKey);
  if (!opts.force && cached && cached.expires > Date.now()) {
    const alive = await probePlaybackUrl(cached.value.url, {
      cookies: cached.value.cookies,
      referer: cached.value.referer
    });
    if (alive) return cached.value;
    invalidateChannelPlayback(channel.id);
  }

  const config = configFromChannel(channel);
  const videoId = config.tctelevision?.video_id || DEFAULT_VIDEO_ID;
  const resolved = await resolveTcStreamUrl({ videoId });
  const value = {
    url: resolved.streamUrl,
    directorUrl: resolved.directorUrl,
    referer: resolved.referer,
    user_agent: resolved.user_agent,
    cookies: resolved.cookies || ''
  };
  playbackCache.set(cacheKey, { value, expires: Date.now() + PLAYBACK_TTL_MS });
  return value;
}

async function refreshTcChannel(channel, resolved) {
  const config = configFromChannel(channel);
  let playbackUrl = resolved.streamUrl;

  if (isVariantStreamUrl(resolved.streamUrl)) {
    playbackUrl = resolved.streamUrl;
  } else if (isVariantStreamUrl(channel.stream_url)) {
    const alive = await probePlaybackUrl(channel.stream_url);
    playbackUrl = alive ? channel.stream_url : resolved.streamUrl;
  }

  const source = normalizeSource({
    url: playbackUrl,
    referer: DEFAULT_REFERER,
    user_agent: DEFAULT_UA,
    resolver: 'tctelevision',
    pageUrl: TC_PAGE,
    scan_status: isVariantStreamUrl(playbackUrl) ? 'ok' : 'pending',
    scan_info: isVariantStreamUrl(playbackUrl)
      ? 'M3U8 renovado automáticamente desde tctelevision.com'
      : 'Pendiente de resolver en cliente (Dailymotion bloquea servidor)'
  });

  config.enabled = true;
  config.sources = [source];
  config.advanced = {
    ...(config.advanced || {}),
    referer: DEFAULT_REFERER,
    user_agent: DEFAULT_UA
  };
  config.tctelevision = {
    page_url: TC_PAGE,
    video_id: resolved.videoId,
    director_url: resolved.directorUrl,
    embed_url: embedPlayerUrl(resolved.videoId),
    live_status: resolved.liveStatus,
    playback_mode: isVariantStreamUrl(playbackUrl) ? 'hls' : 'client_resolve',
    stream_refreshed_at: new Date().toISOString()
  };

  invalidateChannelPlayback(channel.id);

  db.prepare('UPDATE live_channels SET stream_url = ?, enabled = 1, config = ? WHERE id = ?')
    .run(playbackUrl, serializeConfig(config), channel.id);

  return {
    id: channel.id,
    name: channel.name,
    ok: true,
    url: playbackUrl,
    video_id: resolved.videoId,
    live_status: resolved.liveStatus,
    variant: isVariantStreamUrl(playbackUrl)
  };
}

async function publishClientResolvedStream(channelId, streamUrl, meta = {}) {
  const channel = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
  if (!channel) throw new Error('Canal TC no encontrado');
  if (!isVariantStreamUrl(streamUrl) && !isDirectorStreamUrl(streamUrl)) {
    throw new Error('URL HLS inválida para TC');
  }

  const config = configFromChannel(channel);
  const videoId = meta.video_id || config.tctelevision?.video_id || DEFAULT_VIDEO_ID;
  const playbackUrl = isVariantStreamUrl(streamUrl) ? streamUrl : (config.stream_url || streamUrl);

  config.sources = [normalizeSource({
    url: playbackUrl,
    referer: DEFAULT_REFERER,
    user_agent: DEFAULT_UA,
    resolver: 'tctelevision',
    pageUrl: TC_PAGE,
    scan_status: 'ok',
    scan_info: 'M3U8 publicado desde cliente'
  })];
  config.advanced = {
    ...(config.advanced || {}),
    referer: DEFAULT_REFERER,
    user_agent: DEFAULT_UA
  };
  config.tctelevision = {
    ...(config.tctelevision || {}),
    page_url: TC_PAGE,
    video_id: videoId,
    embed_url: embedPlayerUrl(videoId),
    playback_mode: 'hls',
    client_published_at: new Date().toISOString(),
    stream_refreshed_at: new Date().toISOString()
  };

  invalidateChannelPlayback(channelId);
  db.prepare('UPDATE live_channels SET stream_url = ?, enabled = 1, config = ? WHERE id = ?')
    .run(playbackUrl, serializeConfig(config), channelId);

  setSetting('tc_refresh_last', new Date().toISOString());
  setSetting('tc_refresh_url', playbackUrl);
  setSetting('tc_refresh_error', '');

  return {
    id: channelId,
    name: channel.name,
    ok: true,
    url: playbackUrl,
    variant: isVariantStreamUrl(playbackUrl)
  };
}

async function refreshAllTcChannels(opts = {}) {
  if (running) return { skipped: true, reason: 'sync en curso' };
  running = true;
  const started = Date.now();
  const results = { ok: 0, fail: 0, channels: [] };

  try {
    const channels = listTcChannels();
    if (!channels.length) {
      return { ok: 0, fail: 0, channels: [], total: 0, error: 'Canal TC no encontrado' };
    }

    const resolved = await resolveTcStreamUrl(opts);
    for (const ch of channels) {
      try {
        const row = await refreshTcChannel(ch, resolved);
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
    results.stream_url = resolved.streamUrl;
    setSetting('tc_refresh_last', new Date().toISOString());
    setSetting('tc_refresh_ok', String(results.ok));
    setSetting('tc_refresh_fail', String(results.fail));
    setSetting('tc_refresh_url', resolved.streamUrl);
    setSetting('tc_refresh_error', '');
    scheduleRetry(results.fail > 0);
    return results;
  } catch (err) {
    const message = err.message || String(err);
    setSetting('tc_refresh_last', new Date().toISOString());
    setSetting('tc_refresh_fail', '1');
    setSetting('tc_refresh_error', message.slice(0, 220));
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
    refreshAllTcChannels().catch((err) => {
      console.warn('[tc-sync] reintento:', err.message || err);
    });
  }, RETRY_INTERVAL_MS);
  if (retryTimer.unref) retryTimer.unref();
}

function startTcTelevisionScheduler() {
  if (syncTimer) return;
  if (!isEnabled()) return;

  refreshAllTcChannels().catch((err) => {
    console.warn('[tc-sync] inicial:', err.message || err);
  });

  syncTimer = setInterval(() => {
    refreshAllTcChannels().catch((err) => {
      console.warn('[tc-sync]', err.message || err);
    });
  }, intervalMs());

  if (syncTimer.unref) syncTimer.unref();
}

function stopTcTelevisionScheduler() {
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
  resolveTcStreamUrl,
  refreshAllTcChannels,
  refreshTcChannel,
  listTcChannels,
  getChannelPlayback,
  publishClientResolvedStream,
  invalidateChannelPlayback,
  isTcTelevisionChannel,
  isVariantStreamUrl,
  isDirectorStreamUrl,
  embedPlayerUrl,
  startTcTelevisionScheduler,
  stopTcTelevisionScheduler,
  isEnabled,
  intervalMs,
  TC_PAGE,
  DEFAULT_VIDEO_ID,
  DEFAULT_REFERER,
  TC_EMBEDDER
};
