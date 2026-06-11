#!/usr/bin/env node
const db = require('../db');
const { configFromChannel, serializeConfig, normalizeSource } = require('../services/channelConfig');
const tvPorInternet = require('../services/tvPorInternet');
const { probeHlsManifest } = require('../services/streamAudio');
const streamProxyPool = require('../services/streamProxyPool');

async function auditSource(src, referer) {
  if (tvPorInternet.isTvPorInternetSource(src)) {
    try {
      const resolved = await tvPorInternet.resolveSourceStream(src, referer);
      if (!resolved?.url) {
        return { ...normalizeSource(src), scan_status: 'error', scan_info: 'sin señal', has_audio: false };
      }
      const audio = await probeHlsManifest(resolved.url, {
        Referer: resolved.referer || referer,
        'User-Agent': resolved.user_agent || src.user_agent,
        _proxy: resolved.proxy && streamProxyPool.needsStreamProxy(resolved.url)
        ? resolved.proxy
        : streamProxyPool.needsStreamProxy(src.proxyUrl || '')
          ? streamProxyPool.resolveProxy(src.proxyUrl || '')
          : ''
      });
      return normalizeSource({
        ...src,
        streamUrl: resolved.url,
        playerUrl: resolved.referer || src.playerUrl,
        has_audio: !!audio.ok && audio.browser_ok !== false,
        scan_status: audio.ok ? 'ok' : 'warning',
        scan_info: audio.ok
          ? `${src.label || 'Fuente'} · ${audio.codec || 'audio'}`
          : `${src.label || 'Fuente'} · ${audio.error || 'sin audio'}`
      });
    } catch (err) {
      return normalizeSource({
        ...src,
        has_audio: false,
        scan_status: 'error',
        scan_info: `${src.label || 'Fuente'} · ${err.message.slice(0, 80)}`
      });
    }
  }

  if (src.url) {
    const audio = await probeHlsManifest(src.url, {
      Referer: src.referer || referer,
      'User-Agent': src.user_agent,
      _proxy: streamProxyPool.needsStreamProxy(src.url)
        ? streamProxyPool.resolveProxy(src.proxyUrl || '')
        : ''
    });
    return normalizeSource({
      ...src,
      has_audio: !!audio.ok,
      scan_status: audio.ok ? 'ok' : 'warning',
      scan_info: audio.ok ? (src.scan_info || 'con audio') : (audio.error || 'sin audio')
    });
  }

  return normalizeSource(src);
}

async function fixChannel(channel) {
  const config = configFromChannel(channel);
  const referer = config.advanced?.referer || config.tvporinternet?.page || 'https://www.tvporinternet2.com/';
  const sources = config.sources || [];
  if (!sources.length) return { id: channel.id, name: channel.name, skipped: true };

  const audited = [];
  for (const src of sources) {
    audited.push(await auditSource(src, referer));
  }

  const rank = (s) => {
    if (s.scan_status === 'ok' && s.has_audio !== false) return 0;
    if (s.scan_status === 'warning') return 1;
    return 2;
  };
  audited.sort((a, b) => rank(a) - rank(b));

  config.sources = audited.filter((s) => s.has_audio !== false && s.scan_status === 'ok');
  const withAudio = config.sources.length;
  const primary = config.sources[0]?.streamUrl || config.sources[0]?.url || '';

  db.prepare('UPDATE live_channels SET stream_url = ?, config = ?, enabled = ? WHERE id = ?')
    .run(primary, serializeConfig(config), withAudio ? 1 : 0, channel.id);

  return {
    id: channel.id,
    name: channel.name,
    enabled: withAudio ? 1 : 0,
    with_audio: withAudio,
    total: audited.length
  };
}

(async () => {
  const channels = db.prepare(`
    SELECT * FROM live_channels
    WHERE config LIKE '%tvporinternet%' OR config LIKE '%saohgdasregions%'
    ORDER BY name COLLATE NOCASE
  `).all();

  const results = [];
  for (const ch of channels) {
    results.push(await fixChannel(ch));
  }

  console.log(JSON.stringify({
    total: results.length,
    with_audio: results.filter((r) => r.with_audio > 0).length,
    without_audio: results.filter((r) => !r.skipped && r.with_audio === 0).length,
    channels: results
  }, null, 2));
})();
