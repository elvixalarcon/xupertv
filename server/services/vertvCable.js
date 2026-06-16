const db = require('../db');
const streamProxyPool = require('./streamProxyPool');
const { probeHlsManifest } = require('./streamAudio');
const { configFromChannel, mergeConfig, serializeConfig, normalizeSource } = require('./channelConfig');

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const VERTV_BASE = 'https://www.vertvcable.com';
const LA14HD_BASE = 'https://la14hd.com';
const PLAYBACK_TTL_MS = 4 * 60 * 1000;

const CHANNELS = {
  ecdf: {
    name: 'El Canal del Fútbol',
    page: `${VERTV_BASE}/el-canal-del-futbol-ecdf-en-vivo/`,
    channelId: 'ch_682a742fb9ebb',
    streamSlug: 'ecdf_ligapro',
    la14hdUrl: `${LA14HD_BASE}/vivo/canales.php?stream=ecdf_ligapro`
  }
};

function fetchText(url, headers = {}) {
  return streamProxyPool.fetchText(url, {
    headers: {
      'User-Agent': DEFAULT_UA,
      Accept: 'text/html,application/xhtml+xml,*/*',
      ...headers
    },
    proxy: ''
  });
}

function isVertvCableSource(source) {
  return source?.resolver === 'vertvcable'
    || /vertvcable\.com/i.test(source?.url || source?.resolver_url || '')
    || /la14hd\.com/i.test(source?.url || source?.resolver_url || '')
    || /fubo18\.com/i.test(source?.streamUrl || '');
}

function parseChannelConfig(html) {
  const m = html.match(/CHANNEL_CONFIG\s*=\s*(\{[^}]+\})/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function parsePlaybackUrl(html) {
  const m = html.match(/playbackURL\s*=\s*["']([^"']+)["']/i)
    || html.match(/(https:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
  if (!m) return '';
  return m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
}

async function resolveLa14hdStream(la14hdUrl, referer = `${VERTV_BASE}/`) {
  const page = await fetchText(la14hdUrl, { Referer: referer });
  if (page.status !== 200) throw new Error(`la14hd HTTP ${page.status}`);
  const streamUrl = parsePlaybackUrl(page.body);
  if (!streamUrl || !/\.m3u8/i.test(streamUrl)) throw new Error('M3U8 no encontrado en la14hd');
  return {
    streamUrl,
    playerUrl: la14hdUrl,
    referer: `${LA14HD_BASE}/`
  };
}

async function resolveFromChannelPhp(channelId, token = 'VerTvCable.com') {
  const apiUrl = `${VERTV_BASE}/channel.php?id=${encodeURIComponent(channelId)}&token=${encodeURIComponent(token)}`;
  const page = await fetchText(apiUrl, { Referer: `${VERTV_BASE}/` });
  if (page.status !== 200) throw new Error(`channel.php HTTP ${page.status}`);
  const cfg = parseChannelConfig(page.body);
  if (!cfg?.url) throw new Error('Embed la14hd no encontrado');
  return resolveLa14hdStream(cfg.url, `${VERTV_BASE}/`);
}

async function resolveEcdf() {
  return resolveFromChannelPhp(CHANNELS.ecdf.channelId);
}

async function resolveSourceStream(source) {
  const la14hdUrl = source?.la14hdUrl
    || (source?.streamSlug === 'ecdf_ligapro' ? CHANNELS.ecdf.la14hdUrl : '')
    || (/la14hd\.com/i.test(source?.url || '') ? source.url : '');
  const pageReferer = source?.pageUrl || source?.referer || CHANNELS.ecdf.page;

  if (la14hdUrl) {
    const resolved = await resolveLa14hdStream(la14hdUrl, pageReferer);
    return {
      url: resolved.streamUrl,
      referer: resolved.referer,
      user_agent: DEFAULT_UA
    };
  }

  const channelId = source?.channelId || source?.resolver_url?.match(/[?&]id=([^&]+)/i)?.[1];
  if (channelId) {
    const resolved = await resolveFromChannelPhp(channelId);
    return {
      url: resolved.streamUrl,
      referer: resolved.referer,
      user_agent: DEFAULT_UA
    };
  }

  return null;
}

function buildEcdfSource(extra = {}) {
  const meta = CHANNELS.ecdf;
  return normalizeSource({
    url: meta.la14hdUrl,
    referer: meta.page,
    user_agent: DEFAULT_UA,
    scan_status: 'ok',
    scan_info: 'VerTvCable / la14hd · ECDF LigaPro',
    resolver: 'vertvcable',
    resolver_url: `${VERTV_BASE}/channel.php?id=${meta.channelId}&token=VerTvCable.com`,
    pageUrl: meta.page,
    la14hdUrl: meta.la14hdUrl,
    channelId: meta.channelId,
    streamSlug: meta.streamSlug,
    label: 'VerTvCable',
    has_audio: true,
    ...extra
  });
}

async function ensureEcdfVertvSource() {
  const meta = CHANNELS.ecdf;
  const row = db.prepare(`
    SELECT * FROM live_channels
    WHERE id = 437 OR lower(name) = lower(?)
    ORDER BY CASE WHEN id = 437 THEN 0 ELSE 1 END
    LIMIT 1
  `).get(meta.name);
  if (!row) return { ok: false, error: 'Canal ECDF no encontrado' };
  if (!row.enabled) return { ok: true, skipped: true, channel_id: row.id, name: row.name, reason: 'disabled' };

  const config = configFromChannel(row);
  const first = config.sources?.[0];
  if (first?.resolver === 'vertvcable' && config.vertvcable?.channelId === meta.channelId) {
    return { ok: true, skipped: true, channel_id: row.id, name: row.name };
  }

  const vertvSource = buildEcdfSource();
  const others = (config.sources || []).filter((s) => !isVertvCableSource(s));
  let streamUrl = '';

  try {
    const resolved = await resolveEcdf();
    streamUrl = resolved.streamUrl;
    vertvSource.streamUrl = streamUrl;
    vertvSource.scan_status = 'ok';
    vertvSource.scan_info = 'VerTvCable / la14hd · audio AAC';
  } catch (err) {
    vertvSource.scan_status = 'warning';
    vertvSource.scan_info = `VerTvCable · ${err.message || err}`;
  }

  const merged = mergeConfig(config, {
    sources: [vertvSource, ...others],
    advanced: {
      ...config.advanced,
      referer: `${LA14HD_BASE}/`,
      user_agent: DEFAULT_UA
    },
    vertvcable: {
      page: meta.page,
      channelId: meta.channelId,
      streamSlug: meta.streamSlug,
      updated_at: new Date().toISOString()
    }
  });

  db.prepare(`
    UPDATE live_channels
    SET stream_url = ?, config = ?, enabled = 1
    WHERE id = ?
  `).run(streamUrl || row.stream_url, serializeConfig(merged), row.id);

  return {
    ok: true,
    channel_id: row.id,
    name: row.name,
    streamUrl: streamUrl || null,
    source: 'vertvcable'
  };
}

module.exports = {
  CHANNELS,
  PLAYBACK_TTL_MS,
  DEFAULT_UA,
  LA14HD_BASE,
  isVertvCableSource,
  resolveEcdf,
  resolveSourceStream,
  resolveLa14hdStream,
  buildEcdfSource,
  ensureEcdfVertvSource
};
