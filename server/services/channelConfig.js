/** OBS publica RTMP; reproducción HLS local (misma máquina, sin Cloudflare ni /api/live/stream). */
const VIXRED_OBS_RTMP_INGEST = 'rtmp://181.78.245.90/live/chillanestv';
const VIXRED_OBS_HLS_PLAYBACK = '/hls/chillanestv.m3u8';
const VIXRED_OBS_HLS_DIRECT = 'http://181.78.245.90/hls/chillanestv.m3u8';

const DEFAULT_CONFIG = {
  enabled: true,
  direct_source: false,
  notes: '',
  order: 0,
  sources: [],
  advanced: {
    generate_pts: true,
    native_frames: false,
    stream_all_codecs: false,
    allow_recording: false,
    direct_stream: false,
    restart_on_fps_drop: false,
    fps_threshold: 90,
    custom_channel_sid: '',
    on_demand_probesize: 256000,
    minute_delay: 0,
    user_agent: 'Mozilla/5.0',
    referer: '',
    http_proxy: '',
    custom_headers: '',
    ffmpeg_options: '',
    timeout: 30
  },
  map: {
    output_format: 'auto',
    container: 'mpegts',
    custom_map: ''
  },
  epg: {
    epg_id: '',
    channel_id: '',
    lang: 'es',
    xmltv_url: ''
  },
  rtmp: {
    enabled: false,
    push_url: '',
    stream_key: '',
    auto_start: false
  },
  servers: {
    server_id: 'local',
    on_demand: true,
    transcode_profile: 'copy'
  }
};

function parseConfig(raw) {
  if (!raw) return { ...DEFAULT_CONFIG, sources: [] };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG, sources: [] };
  }
}

function mergeConfig(base, patch) {
  const out = { ...base, ...patch };
  out.advanced = { ...base.advanced, ...(patch.advanced || {}) };
  out.map = { ...base.map, ...(patch.map || {}) };
  out.epg = { ...base.epg, ...(patch.epg || {}) };
  out.rtmp = { ...base.rtmp, ...(patch.rtmp || {}) };
  out.servers = { ...base.servers, ...(patch.servers || {}) };
  if (Array.isArray(patch.sources)) out.sources = patch.sources.map(normalizeSource);
  return out;
}

function normalizeSource(s) {
  const out = {
    url: String(s?.url || '').trim(),
    user_agent: String(s?.user_agent || '').trim(),
    referer: String(s?.referer || '').trim(),
    scan_status: String(s?.scan_status || ''),
    scan_info: String(s?.scan_info || '')
  };
  if (s?.resolver) out.resolver = String(s.resolver);
  if (s?.resolver_url) out.resolver_url = String(s.resolver_url);
  if (s?.pageUrl) out.pageUrl = String(s.pageUrl);
  if (s?.playerUrl) out.playerUrl = String(s.playerUrl);
  if (s?.streamUrl) out.streamUrl = String(s.streamUrl);
  if (s?.proxyUrl) out.proxyUrl = String(s.proxyUrl);
  if (s?.has_audio === false) out.has_audio = false;
  else if (s?.has_audio === true) out.has_audio = true;
  if (s?.label) out.label = String(s.label);
  if (s?.fast && typeof s.fast === 'object') out.fast = s.fast;
  if (s?.site) out.site = String(s.site);
  if (s?.canal) out.canal = String(s.canal);
  return out;
}

function configFromChannel(ch) {
  const config = parseConfig(ch.config);
  if (!config.sources.length && ch.stream_url) {
    config.sources = [normalizeSource({ url: ch.stream_url })];
  }
  return config;
}

function primarySourceUrl(config, fallback = '') {
  for (const s of config.sources || []) {
    if (s.streamUrl && /\.m3u8/i.test(s.streamUrl)) return s.streamUrl;
  }
  if (fallback && /\.m3u8/i.test(fallback)) return fallback;
  const src = (config.sources || []).find((s) => s.url);
  return src?.url || fallback;
}

function serializeConfig(config) {
  const c = mergeConfig(DEFAULT_CONFIG, config);
  c.sources = (c.sources || []).map(normalizeSource).filter((s) => s.url);
  return JSON.stringify(c);
}

function normalizeChannelName(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function pickFuboPrimaryUrl(config, fallback = '', channelName = '') {
  const ecuaplaySync = require('./ecuaplaySync');
  const slug = config.ecuaplay?.stream
    || (/\bwin\s*sports\b/i.test(channelName) && !/\+|plus/i.test(channelName) ? 'winsports' : '')
    || (/\bwin\s*sports\s*\+|\bwin\s*sports\s*plus/i.test(channelName) ? 'winsportsplus' : '')
    || ecuaplaySync.fuboSlugFromStreamUrl(fallback);
  const candidates = (config.sources || []).flatMap((s) => [s.streamUrl, s.url].filter(Boolean));
  if (slug) {
    const match = candidates.find((u) => ecuaplaySync.fuboSlugFromStreamUrl(u) === slug);
    if (match) return match;
  }
  return candidates.find((u) => /fubo18\.com/i.test(u)) || fallback;
}

function syncSourceUrlFields(config, primary = '', { preferUserUrl = false } = {}) {
  const preferUser = preferUserUrl || isManualStreamChannel(config);
  const out = { ...config, sources: (config.sources || []).map((s) => {
    const src = normalizeSource(s);
    const best = preferUser
      ? (src.url || src.streamUrl || primary)
      : (src.streamUrl || src.url || primary);
    if (best) {
      src.url = best;
      if (/\.m3u8/i.test(best)) src.streamUrl = best;
      else if (preferUser) delete src.streamUrl;
    }
    return src;
  }) };
  return out;
}

function primarySourceUrlFromUser(config, fallback = '') {
  const sources = config.sources || [];
  for (const s of sources) {
    if (s.url) return s.url;
  }
  return primarySourceUrl(config, fallback);
}

function isManualStreamChannel(chOrConfig) {
  const config = chOrConfig?.advanced
    ? chOrConfig
    : configFromChannel(chOrConfig || {});
  return config.advanced?.manual_url === true;
}

function applyPlaybackModeExclusivity(config) {
  const out = mergeConfig(DEFAULT_CONFIG, config);
  if (out.direct_source) {
    out.advanced.allow_recording = false;
  } else if (out.advanced.allow_recording) {
    out.direct_source = false;
  }
  return out;
}

function isDirectSourceChannel(chOrConfig) {
  const config = chOrConfig?.advanced
    ? chOrConfig
    : configFromChannel(chOrConfig || {});
  return !!config.direct_source;
}

/** HLS publicado desde OBS (dominio vixred o IP local nginx-rtmp). */
function isVixredObsHls(url = '') {
  const u = String(url || '');
  return /vixred\.com\/hls\/[^/?#]+\.m3u8/i.test(u)
    || /181\.78\.245\.90\/hls\/[^/?#]+\.m3u8/i.test(u)
    || /5\.5\.5\.4\/hls\/[^/?#]+\.m3u8/i.test(u)
    || /^\/hls\/[^/?#]+\.m3u8/i.test(u);
}

/** Ruta local de reproducción (/hls/key.m3u8) desde cualquier URL OBS (como en XUI direct source). */
function obsHlsPlaybackPath(url = '') {
  const u = String(url || '').trim();
  const m = u.match(/\/hls\/([^/?#]+\.m3u8)/i);
  return m ? `/hls/${m[1]}` : u;
}

function isDirectPlaybackChannel(config, streamUrl = '') {
  if (isDirectSourceChannel(config)) return true;
  const upstream = streamUrl || primarySourceUrl(config, streamUrl);
  return isVixredObsHls(upstream);
}

function finalizeConfigForSave(config, { stream_url = '', name = '', manual = false } = {}) {
  const ecuaplaySync = require('./ecuaplaySync');
  let out = applyPlaybackModeExclusivity(config);
  const useManual = manual || isManualStreamChannel(out);
  let primary = useManual
    ? primarySourceUrlFromUser(out, stream_url)
    : primarySourceUrl(out, stream_url);

  if (out.direct_source || isVixredObsHls(primary)) {
    if (isVixredObsHls(primary)) {
      out.direct_source = true;
      primary = obsHlsPlaybackPath(primary);
    }
    out = syncSourceUrlFields(out, primary, { preferUserUrl: useManual || isVixredObsHls(primary) });
    primary = useManual || isVixredObsHls(primary)
      ? primarySourceUrlFromUser(out, primary)
      : primarySourceUrl(out, primary);
    if (isVixredObsHls(primary)) primary = obsHlsPlaybackPath(primary);
    out.advanced = { ...out.advanced, allow_recording: false };
    return { config: out, stream_url: primary, cache_enabled: 0 };
  }

  const hasFubo = /fubo18\.com/i.test(primary)
    || (out.sources || []).some((s) => /fubo18\.com/i.test(s.url || s.streamUrl || ''))
    || !!out.ecuaplay?.player;

  if (!useManual && hasFubo && out.advanced.allow_recording) {
    primary = pickFuboPrimaryUrl(out, primary, name);
    out = ecuaplaySync.enrichFuboManualConfig(primary, out);
    return { config: out, stream_url: primary, cache_enabled: 1 };
  }

  if (out.advanced.allow_recording) {
    out = syncSourceUrlFields(out, primary, { preferUserUrl: useManual });
    primary = useManual ? primarySourceUrlFromUser(out, primary) : primarySourceUrl(out, primary);
    return { config: out, stream_url: primary, cache_enabled: 1 };
  }

  out = syncSourceUrlFields(out, primary, { preferUserUrl: useManual });
  primary = useManual ? primarySourceUrlFromUser(out, primary) : primarySourceUrl(out, primary);
  return { config: out, stream_url: primary, cache_enabled: 0 };
}

function isUserPinned(ch) {
  const config = configFromChannel(ch);
  return config.advanced?.user_pinned === true;
}

function withUserPinned(ch, pinned) {
  const config = configFromChannel(ch);
  config.advanced = { ...config.advanced, user_pinned: !!pinned };
  return serializeConfig(config);
}

module.exports = {
  DEFAULT_CONFIG,
  parseConfig,
  mergeConfig,
  configFromChannel,
  primarySourceUrl,
  primarySourceUrlFromUser,
  serializeConfig,
  normalizeSource,
  normalizeChannelName,
  pickFuboPrimaryUrl,
  syncSourceUrlFields,
  applyPlaybackModeExclusivity,
  isDirectSourceChannel,
  isVixredObsHls,
  obsHlsPlaybackPath,
  isDirectPlaybackChannel,
  isManualStreamChannel,
  VIXRED_OBS_RTMP_INGEST,
  VIXRED_OBS_HLS_PLAYBACK,
  VIXRED_OBS_HLS_DIRECT,
  finalizeConfigForSave,
  isUserPinned,
  withUserPinned
};
