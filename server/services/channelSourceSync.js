const db = require('../db');
const { configFromChannel, serializeConfig, normalizeSource } = require('./channelConfig');
const { scanSources } = require('./sourceScan');
const tvPorInternet = require('./tvPorInternet');

function sourceScanOpts(config) {
  const adv = config.advanced || {};
  return {
    user_agent: adv.user_agent || '',
    referer: adv.referer || 'https://tv.vixred.com/',
    custom_headers: adv.custom_headers || '',
    timeout: adv.timeout || 20
  };
}

function bodyEnabled(opts) {
  if (opts.enabled === undefined || opts.enabled === null) return undefined;
  return opts.enabled ? 1 : 0;
}

async function scanAndFixChannel(channel, opts = {}) {
  const config = configFromChannel(channel);
  const sources = (config.sources || []).filter((s) => s.url);
  if (!sources.length && channel.stream_url) {
    sources.push(normalizeSource({ url: channel.stream_url }));
  }
  if (!sources.length) {
    return { id: channel.id, name: channel.name, ok: false, reason: 'sin fuentes' };
  }

  const scanOpts = sourceScanOpts(config);
  const scanList = [];
  for (const src of sources) {
    if (tvPorInternet.isTvPorInternetSource(src)) {
      try {
        const resolved = await tvPorInternet.resolveSourceStream(src, scanOpts.referer, { force: true });
        if (resolved?.url) {
          scanList.push(normalizeSource({
            ...src,
            url: resolved.url,
            streamUrl: resolved.url,
            playerUrl: resolved.referer || src.playerUrl,
            referer: resolved.referer || src.referer,
            user_agent: resolved.user_agent || src.user_agent
          }));
          continue;
        }
      } catch {
        /* fall through */
      }
    }
    scanList.push(src);
  }
  const results = await scanSources(scanList, scanOpts);
  const merged = sources.map((src, i) => ({
    ...normalizeSource(src),
    scan_status: results[i]?.scan_status || '',
    scan_info: results[i]?.scan_info || ''
  }));

  const working = merged.filter((s) => s.scan_status === 'ok');
  const ordered = working.length ? [...working, ...merged.filter((s) => s.scan_status !== 'ok')] : merged;
  config.sources = ordered;

  const primary = ordered[0]?.url || channel.stream_url;
  const ok = working.length > 0;
  let enabled = channel.enabled ?? 1;
  if (opts.forceEnabled) enabled = 1;
  else if (opts.disableBroken === true) enabled = ok ? 1 : 0;
  else if (bodyEnabled(opts) !== undefined) enabled = bodyEnabled(opts);

  let resolvedPrimary = primary;
  if (ok && primary) {
    try {
      const { resolveRedirect } = require('./liveStreamProxy');
      const hdrs = {
        'User-Agent': scanOpts.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        Referer: scanOpts.referer || 'https://tv.vixred.com/'
      };
      resolvedPrimary = await resolveRedirect(primary, hdrs);
    } catch {
      resolvedPrimary = primary;
    }
  }

  const preferDirect = (url) => /\/chunks\.m3u8|livestream\d+\/|\/mono\.m3u8|\/index\.m3u8/i.test(url);
  const direct = ordered.find((s) => preferDirect(s.url));
  if (direct) resolvedPrimary = direct.url;

  if (!opts.dryRun) {
    db.prepare(`
      UPDATE live_channels
      SET stream_url = ?, config = ?, enabled = ?
      WHERE id = ?
    `).run(resolvedPrimary, serializeConfig(config), enabled, channel.id);
  }

  return {
    id: channel.id,
    name: channel.name,
    ok,
    enabled: !!enabled,
    url: resolvedPrimary,
    working: working.length,
    total: merged.length
  };
}

async function scanAndFixAllChannels(opts = {}) {
  const channels = db.prepare('SELECT * FROM live_channels ORDER BY id').all();
  const results = [];
  for (const ch of channels) {
    results.push(await scanAndFixChannel(ch, opts));
  }
  return {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    disabled: results.filter((r) => !r.ok).length,
    channels: results
  };
}

module.exports = {
  scanAndFixChannel,
  scanAndFixAllChannels,
  sourceScanOpts
};
