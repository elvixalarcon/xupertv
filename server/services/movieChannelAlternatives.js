const db = require('../db');
const { getSetting, setSetting } = require('./settings');
const { configFromChannel, mergeConfig, serializeConfig, normalizeSource } = require('./channelConfig');
const plutoTv = require('./plutoTv');
const { probeHlsManifest } = require('./streamAudio');

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Canales de cable caídos en saohgdasregions → equivalente temático en Pluto TV. */
const PLUTO_FALLBACKS = {
  AMC: 'Pluto TV Cine Acción',
  AXN: 'Pluto TV Cine Suspenso',
  Cinemax: 'Pluto TV Cine Drama',
  FX: 'Pluto TV Cine Crimen',
  'Sony Channel': 'Pluto TV Cine Terror',
  'Star Channel': 'Pluto TV Cine Familia',
  'Studio Universal': 'Pluto TV Cine Romance',
  Universal: 'Pluto TV Sci-Fi'
};

function findPlutoChannel(name) {
  return db.prepare(`
    SELECT * FROM live_channels
    WHERE name = ?
      AND group_title LIKE 'Pluto TV ·%'
      AND COALESCE(enabled, 1) = 1
    ORDER BY uplink_status = 'up' DESC, id ASC
    LIMIT 1
  `).get(name);
}

function parseFastMeta(channel) {
  try {
    const config = typeof channel.config === 'string' ? JSON.parse(channel.config || '{}') : (channel.config || {});
    return config.fast || null;
  } catch {
    return null;
  }
}

async function resolvePlutoSource(source) {
  const fast = source.fast;
  if (!fast?.external_id) return null;
  const url = await plutoTv.resolveStreamUrl(fast.external_id, fast.region || 'MX');
  if (!url) return null;
  const audio = await probeHlsManifest(url, { 'User-Agent': DEFAULT_UA });
  if (!audio.ok) return null;
  return {
    url,
    referer: '',
    user_agent: DEFAULT_UA,
    proxy: ''
  };
}

function buildPlutoAlternativeSource(plutoChannel, cableName) {
  const fast = parseFastMeta(plutoChannel);
  if (!fast?.external_id) return null;
  return normalizeSource({
    url: plutoChannel.stream_url || '',
    streamUrl: plutoChannel.stream_url || '',
    referer: '',
    user_agent: DEFAULT_UA,
    resolver: 'pluto',
    label: `Alternativa · ${plutoChannel.name}`,
    scan_status: 'ok',
    scan_info: `Respaldo Pluto TV mientras ${cableName} no está en TV por Internet`,
    has_audio: true,
    fast: {
      source: fast.source || 'pluto',
      external_id: fast.external_id,
      region: fast.region || 'MX'
    }
  });
}

function listFailedMovieChannels() {
  const rows = db.prepare(`
    SELECT * FROM live_channels
    WHERE group_title = 'Películas'
      AND COALESCE(enabled, 1) = 1
    ORDER BY name COLLATE NOCASE
  `).all();

  return rows.filter((ch) => {
    const cfg = configFromChannel(ch);
    const hasTvpi = (cfg.sources || []).some((s) =>
      s.resolver === 'tvporinternet' || /saohgdasregions/i.test(s.url || s.resolver_url || '')
    );
    const hasLiveStream = (cfg.sources || []).some((s) => s.streamUrl && /\.m3u8/i.test(s.streamUrl));
    return hasTvpi && !hasLiveStream;
  });
}

async function applyAlternativeToChannel(channel) {
  const fallbackName = PLUTO_FALLBACKS[channel.name];
  if (!fallbackName) {
    return { id: channel.id, name: channel.name, ok: false, error: 'sin mapeo alternativo' };
  }

  const pluto = findPlutoChannel(fallbackName);
  if (!pluto) {
    return { id: channel.id, name: channel.name, ok: false, error: `no se encontró ${fallbackName}` };
  }

  const altSource = buildPlutoAlternativeSource(pluto, channel.name);
  if (!altSource) {
    return { id: channel.id, name: channel.name, ok: false, error: 'Pluto sin metadata fast' };
  }

  const playback = await resolvePlutoSource(altSource);
  if (!playback?.url) {
    return { id: channel.id, name: channel.name, ok: false, error: 'Pluto sin señal' };
  }

  altSource.streamUrl = playback.url;

  const config = configFromChannel(channel);
  const others = (config.sources || []).filter((s) => s.resolver !== 'pluto');
  config.sources = [altSource, ...others];
  config.alternative = {
    provider: 'pluto',
    fallback_name: fallbackName,
    cable_name: channel.name,
    applied_at: new Date().toISOString()
  };

  db.prepare('UPDATE live_channels SET stream_url = ?, config = ? WHERE id = ?')
    .run(playback.url, serializeConfig(config), channel.id);

  return {
    id: channel.id,
    name: channel.name,
    ok: true,
    fallback: fallbackName,
    provider: 'pluto'
  };
}

async function applyMovieChannelAlternatives({ names = [] } = {}) {
  const failed = listFailedMovieChannels();
  const targets = names.length
    ? failed.filter((ch) => names.includes(ch.name))
    : failed;

  const results = { ok: 0, fail: 0, channels: [] };
  for (const ch of targets) {
    try {
      const row = await applyAlternativeToChannel(ch);
      if (row.ok) results.ok += 1;
      else results.fail += 1;
      results.channels.push(row);
    } catch (err) {
      results.fail += 1;
      results.channels.push({
        id: ch.id,
        name: ch.name,
        ok: false,
        error: (err.message || String(err)).slice(0, 120)
      });
    }
  }

  results.total = targets.length;
  setSetting('movie_alt_last', new Date().toISOString());
  setSetting('movie_alt_ok', String(results.ok));
  setSetting('movie_alt_fail', String(results.fail));
  return results;
}

function isPlutoSource(source) {
  return source?.resolver === 'pluto' && source?.fast?.external_id;
}

async function resolvePlutoPlayback(source) {
  return resolvePlutoSource(source);
}

module.exports = {
  PLUTO_FALLBACKS,
  listFailedMovieChannels,
  applyAlternativeToChannel,
  applyMovieChannelAlternatives,
  isPlutoSource,
  resolvePlutoPlayback,
  resolvePlutoSource
};
