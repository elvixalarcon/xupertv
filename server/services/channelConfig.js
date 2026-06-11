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
  serializeConfig,
  normalizeSource,
  isUserPinned,
  withUserPinned
};
