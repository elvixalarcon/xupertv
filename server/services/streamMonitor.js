const db = require('../db');
const { configFromChannel, primarySourceUrl } = require('./channelConfig');
const { scanSourceUrl } = require('./sourceScan');

const CHECK_INTERVAL_MS = 60000;
const VIX_REFERER = 'https://vix.com/';
let monitorTimer = null;
let running = false;

function updateChannelUplink(channelId, status, info) {
  db.prepare(`
    UPDATE live_channels
    SET uplink_status = ?, uplink_info = ?, uplink_checked_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, info || '', channelId);
}

function maybeHealRelay(channel, status) {
  if (status !== 'up') return;
  try {
    const streamCache = require('./streamCache');
    const cfg = configFromChannel(channel);
    if (streamCache.relayActiveForChannel(channel)) {
      streamCache.ensureRelayRunning(channel).catch(() => {});
    }
  } catch { /* ignore */ }
}

function finishChannelCheck(channel, status, info) {
  updateChannelUplink(channel.id, status, info);
  maybeHealRelay(channel, status);
  return { id: channel.id, name: channel.name, status, info };
}

async function checkChannel(channel) {
  const config = configFromChannel(channel);
  const tvPorInternet = require('./tvPorInternet');
  const freetvOttera = require('./freetvOttera');
  const vixSync = require('./vixSync');
  const fastChannelsSync = require('./fastChannelsSync');
  const isFreetv = freetvOttera.isFreetvChannel(channel);
  const isVix = vixSync.isVixChannel(channel);

  if (isVix) {
    try {
      let playback = await vixSync.getChannelPlayback(channel);
      if (!playback?.url) {
        await vixSync.refreshVixChannel(channel, { force: true });
        playback = await vixSync.getChannelPlayback(channel, { force: true });
      }
      if (!playback?.url) {
        updateChannelUplink(channel.id, 'down', 'Sin señal (ViX)');
        return { id: channel.id, name: channel.name, status: 'down', info: 'Sin señal (ViX)' };
      }
      const result = await scanSourceUrl(playback.url, {
        referer: playback.referer || VIX_REFERER,
        user_agent: playback.user_agent || config.advanced?.user_agent,
        timeout: config.advanced?.timeout || 20
      });
      const status = result.ok ? 'up' : 'down';
      if (!result.ok) {
        try {
          await vixSync.refreshVixChannel(channel, { force: true });
          const retry = await vixSync.getChannelPlayback(channel, { force: true });
          if (retry?.url) {
            const retryResult = await scanSourceUrl(retry.url, {
              referer: retry.referer || VIX_REFERER,
              user_agent: retry.user_agent || config.advanced?.user_agent,
              timeout: config.advanced?.timeout || 20
            });
            if (retryResult.ok) {
              return finishChannelCheck(channel, 'up', retryResult.info);
            }
          }
        } catch { /* ignore */ }
      }
      return finishChannelCheck(channel, status, result.info);
    } catch (err) {
      updateChannelUplink(channel.id, 'down', err.message);
      return { id: channel.id, name: channel.name, status: 'down', info: err.message };
    }
  }

  if (isFreetv) {
    try {
      let streamUrl = await fastChannelsSync.resolveChannelStreamUrl(channel);
      if (!streamUrl) {
        const refreshed = await freetvOttera.refreshChannelStream(channel, { force: true });
        streamUrl = refreshed?.url || null;
      }
      if (!streamUrl) {
        updateChannelUplink(channel.id, 'down', 'Sin señal (FreeTV/Ottera)');
        return { id: channel.id, name: channel.name, status: 'down', info: 'Sin señal (FreeTV/Ottera)' };
      }
      const result = await scanSourceUrl(streamUrl, {
        referer: freetvOttera.FREETV_REFERER,
        user_agent: config.advanced?.user_agent,
        timeout: config.advanced?.timeout || 20
      });
      const status = result.ok ? 'up' : 'down';
      return finishChannelCheck(channel, status, result.info);
    } catch (err) {
      updateChannelUplink(channel.id, 'down', err.message);
      return { id: channel.id, name: channel.name, status: 'down', info: err.message };
    }
  }

  const needsTvResolve = /saohgdasregions\.fun\/stream\.php/i.test(channel.stream_url || '')
    || (config.sources || []).some((s) => tvPorInternet.isTvPorInternetSource(s))
    || (config.sources || []).some((s) => s.resolver === 'pluto');

  if (needsTvResolve) {
    try {
      const playback = await tvPorInternet.getChannelPlayback(channel);
      if (!playback?.url) {
        updateChannelUplink(channel.id, 'down', 'Sin señal (TV por Internet)');
        return { id: channel.id, name: channel.name, status: 'down', info: 'Sin señal (TV por Internet)' };
      }
      const result = await scanSourceUrl(playback.url, {
        referer: playback.referer || config.advanced?.referer,
        user_agent: playback.user_agent || config.advanced?.user_agent,
        custom_headers: config.advanced?.custom_headers,
        timeout: config.advanced?.timeout || 20
      });
      const status = result.ok ? 'up' : 'down';
      return finishChannelCheck(channel, status, result.info);
    } catch (err) {
      updateChannelUplink(channel.id, 'down', err.message);
      return { id: channel.id, name: channel.name, status: 'down', info: err.message };
    }
  }

  const url = primarySourceUrl(config, channel.stream_url);
  if (!url) {
    updateChannelUplink(channel.id, 'down', 'Sin URL de fuente');
    return { id: channel.id, status: 'down', info: 'Sin URL de fuente' };
  }

  const result = await scanSourceUrl(url, {
    referer: config.advanced?.referer,
    user_agent: config.advanced?.user_agent,
    custom_headers: config.advanced?.custom_headers,
    timeout: config.advanced?.timeout || 20
  });

  const status = result.ok ? 'up' : 'down';
  return finishChannelCheck(channel, status, result.info);
}

async function checkAllChannels() {
  if (running) return { skipped: true };
  running = true;
  try {
    const channels = db.prepare(`
      SELECT * FROM live_channels WHERE COALESCE(enabled, 1) = 1 ORDER BY id
    `).all();

    const results = [];
    for (const ch of channels) {
      try {
        results.push(await checkChannel(ch));
      } catch (err) {
        updateChannelUplink(ch.id, 'down', err.message);
        results.push({ id: ch.id, name: ch.name, status: 'down', info: err.message });
      }
    }
    return { checked: results.length, results };
  } finally {
    running = false;
    try {
      require('./streamCache').syncAllCacheMetrics();
    } catch { /* ignore */ }
  }
}

function getUplinkStats() {
  const rows = db.prepare(`
    SELECT uplink_status, COUNT(*) as c FROM live_channels
    WHERE COALESCE(enabled, 1) = 1
    GROUP BY uplink_status
  `).all();
  const stats = { up: 0, down: 0, unknown: 0, total: 0 };
  rows.forEach((r) => {
    const key = r.uplink_status || 'unknown';
    if (stats[key] !== undefined) stats[key] = r.c;
    else stats.unknown += r.c;
    stats.total += r.c;
  });
  return stats;
}

function getChannelsWithStatus() {
  return db.prepare(`
    SELECT id, name, logo, group_title, stream_url, enabled,
      uplink_status, uplink_info, uplink_checked_at,
      cache_enabled, cache_status, cache_bytes, cache_path, cache_started_at, cache_checked_at
    FROM live_channels
    ORDER BY name COLLATE NOCASE
  `).all();
}

function startMonitor(intervalMs = CHECK_INTERVAL_MS) {
  stopMonitor();
  checkAllChannels().catch(() => {});
  monitorTimer = setInterval(() => {
    checkAllChannels().catch(() => {});
  }, intervalMs);
}

function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

module.exports = {
  checkChannel,
  checkAllChannels,
  getUplinkStats,
  getChannelsWithStatus,
  startMonitor,
  stopMonitor
};
