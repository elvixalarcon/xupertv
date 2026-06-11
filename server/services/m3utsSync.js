const http = require('http');
const https = require('https');
const db = require('../db');
const { setSetting } = require('./settings');
const { configFromChannel, mergeConfig, serializeConfig, normalizeSource } = require('./channelConfig');

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    const reqOpts = {
      timeout: 30000,
      headers: { 'User-Agent': DEFAULT_UA, Accept: '*/*', ...(opts.headers || {}) }
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
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

const DEFAULT_BASE = 'http://tv.m3uts.xyz';
const DEFAULT_UA = 'Mozilla/5.0 (Linux; Android 13) IPTV/1.0';
const CACHE_TTL_MS = 5 * 60 * 1000;

let streamCache = { expires: 0, rows: [] };

function getConfig() {
  const { getXuiConfig } = require('./xuiSync');
  const cfg = getXuiConfig();
  return {
    baseUrl: (cfg.baseUrl || DEFAULT_BASE).replace(/\/$/, ''),
    username: cfg.username || '',
    password: cfg.password || ''
  };
}

function saveConfig({ baseUrl = DEFAULT_BASE, username = '', password = '' } = {}) {
  setSetting('xui_base_url', String(baseUrl || DEFAULT_BASE).replace(/\/$/, ''));
  if (username) setSetting('xui_username', String(username));
  if (password) setSetting('xui_password', String(password));
  streamCache = { expires: 0, rows: [] };
  return getConfig();
}

function isM3utsSource(source) {
  return source?.resolver === 'm3uts'
    || source?.resolver === 'xtream'
    || /m3uts\.xyz/i.test(source?.url || source?.resolver_url || '');
}

function buildStreamUrl(config, streamId, ext = 'm3u8') {
  const base = config.baseUrl.replace(/\/$/, '');
  return `${base}/live/${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}/${streamId}.${ext}`;
}

async function fetchLiveStreams(force = false) {
  if (!force && streamCache.expires > Date.now() && streamCache.rows.length) {
    return streamCache.rows;
  }

  const config = getConfig();
  if (!config.username || !config.password) {
    throw new Error('Faltan credenciales M3UTS (usuario/contraseña)');
  }

  const url = `${config.baseUrl}/player_api.php?username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}&action=get_live_streams`;
  const raw = await fetchUrl(url, { headers: { 'User-Agent': DEFAULT_UA, Accept: 'application/json' } });
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error(data?.message || data?.error || 'Respuesta inválida de M3UTS');
  }

  streamCache = { expires: Date.now() + CACHE_TTL_MS, rows: data };
  return data;
}

async function resolveStreamById(streamId, config = getConfig()) {
  const rows = await fetchLiveStreams();
  const id = parseInt(streamId, 10);
  const row = rows.find((s) => parseInt(s.stream_id, 10) === id);
  if (!row) throw new Error(`Canal M3UTS ${id} no encontrado`);

  const direct = String(row.url || row.direct_source || '').trim();
  if (direct && /^https?:\/\//i.test(direct)) {
    return {
      url: direct,
      referer: config.baseUrl + '/',
      user_agent: DEFAULT_UA,
      name: row.name || '',
      stream_id: id
    };
  }

  return {
    url: buildStreamUrl(config, id, 'm3u8'),
    referer: config.baseUrl + '/',
    user_agent: DEFAULT_UA,
    name: row.name || '',
    stream_id: id
  };
}

async function resolveSourceStream(source) {
  const config = getConfig();
  const streamId = source?.stream_id
    || source?.m3uts_stream_id
    || source?.resolver_url?.match(/stream[_=](\d+)/i)?.[1]
    || source?.url?.match(/\/(\d+)\.m3u8/i)?.[1];
  if (!streamId) return null;
  return resolveStreamById(streamId, config);
}

function buildEcdfSource(streamId = 1133, extra = {}) {
  const config = getConfig();
  return normalizeSource({
    url: buildStreamUrl(config, streamId, 'm3u8'),
    referer: config.baseUrl + '/',
    user_agent: DEFAULT_UA,
    scan_status: 'pending',
    scan_info: `M3UTS Xtream · stream ${streamId}`,
    resolver: 'm3uts',
    resolver_url: `${config.baseUrl}/player_api.php?username=${config.username}&action=get_live_streams`,
    m3uts_stream_id: streamId,
    stream_id: streamId,
    label: 'M3UTS',
    has_audio: true,
    ...extra
  });
}

async function findEcdfStream() {
  const rows = await fetchLiveStreams();
  const hits = rows.filter((s) => /ecdf|canal del fut/i.test(s.name || ''));
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const score = (s) => (/\(ecdf\)/i.test(s.name || '') ? 2 : 0) + (s.category_id === 4 ? 1 : 0);
    return score(b) - score(a);
  });
  return hits[0];
}

async function ensureEcdfM3utsSource() {
  const config = saveConfig({
    baseUrl: DEFAULT_BASE,
    username: 'm',
    password: 'm'
  });

  const row = db.prepare(`
    SELECT * FROM live_channels
    WHERE id = 437 OR lower(name) LIKE '%canal del f%'
    ORDER BY CASE WHEN id = 437 THEN 0 ELSE 1 END
    LIMIT 1
  `).get();
  if (!row) return { ok: false, error: 'Canal ECDF no encontrado' };

  let ecdf = null;
  let streamUrl = '';
  let scanStatus = 'pending';
  let scanInfo = 'M3UTS Xtream API';

  try {
    ecdf = await findEcdfStream();
    if (!ecdf) throw new Error('ECDF no está en la lista M3UTS');
    const resolved = await resolveStreamById(ecdf.stream_id, config);
    streamUrl = resolved.url;
    scanStatus = 'ok';
    scanInfo = `M3UTS · ${ecdf.name} · id ${ecdf.stream_id}`;
  } catch (err) {
    scanInfo = `M3UTS · ${err.message || err}`;
    ecdf = { stream_id: 1133, name: 'El Canal del Futbol (ECDF)' };
  }

  const m3utsSource = buildEcdfSource(ecdf.stream_id, {
    streamUrl,
    scan_status: scanStatus,
    scan_info: scanInfo
  });

  const prev = configFromChannel(row);
  const others = (prev.sources || []).filter((s) => !isM3utsSource(s));
  const merged = mergeConfig(prev, {
    sources: [m3utsSource, ...others],
    advanced: {
      ...prev.advanced,
      referer: config.baseUrl + '/',
      user_agent: DEFAULT_UA
    },
    m3uts: {
      baseUrl: config.baseUrl,
      username: config.username,
      stream_id: ecdf.stream_id,
      stream_name: ecdf.name,
      updated_at: new Date().toISOString()
    }
  });

  db.prepare(`
    UPDATE live_channels
    SET stream_url = ?, logo = COALESCE(?, logo), config = ?, enabled = 1
    WHERE id = ?
  `).run(
    streamUrl || row.stream_url,
    ecdf?.stream_icon || null,
    serializeConfig(merged),
    row.id
  );

  return {
    ok: true,
    channel_id: row.id,
    name: row.name,
    stream_id: ecdf.stream_id,
    stream_name: ecdf.name,
    streamUrl: streamUrl || null,
    source: 'm3uts'
  };
}

module.exports = {
  DEFAULT_BASE,
  DEFAULT_UA,
  getConfig,
  saveConfig,
  isM3utsSource,
  buildStreamUrl,
  fetchLiveStreams,
  resolveStreamById,
  resolveSourceStream,
  buildEcdfSource,
  findEcdfStream,
  ensureEcdfM3utsSource
};
