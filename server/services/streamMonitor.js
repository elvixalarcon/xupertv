const { execSync } = require('child_process');
const db = require('../db');
const { configFromChannel, primarySourceUrl } = require('./channelConfig');
const { scanSourceUrl } = require('./sourceScan');

const CHECK_INTERVAL_MS = 90000;
const BATCH_SIZE = 6;
const BOOT_DELAY_MS = 120000;
const SKIP_RECHECK_MS = 5 * 60 * 1000;
const VIX_REFERER = 'https://vix.com/';
let monitorTimer = null;
let bootTimer = null;
let running = false;
let batchCursor = 0;

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

function backgroundLoadHigh() {
  try {
    const out = execSync(
      'sh -c \'pgrep -x ffmpeg 2>/dev/null | wc -l; pgrep -x ffprobe 2>/dev/null | wc -l\'',
      { encoding: 'utf8', timeout: 3000 }
    );
    const [ffmpegCount, ffprobeCount] = out.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
    return ffmpegCount + ffprobeCount >= 6;
  } catch {
    return false;
  }
}

function canSkipUplinkProbe(channel) {
  try {
    const streamCache = require('./streamCache');
    if (!streamCache.relayActiveForChannel(channel)) return false;
    const id = channel.id;
    if (!streamCache.isRelayProcessRunning(id)) return false;
    if (!streamCache.playlistIsFresh(id, 120000)) return false;
    if (channel.uplink_status === 'up' && channel.uplink_checked_at) {
      const age = Date.now() - new Date(channel.uplink_checked_at).getTime();
      if (age < SKIP_RECHECK_MS) return true;
    }
    return streamCache.playlistIsFresh(id);
  } catch {
    return false;
  }
}

async function checkChannel(channel) {
  if (canSkipUplinkProbe(channel)) {
    return finishChannelCheck(channel, 'up', 'Relay activo');
  }

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

  const ecuaplaySync = require('./ecuaplaySync');
  const { configFromChannel, primarySourceUrl, isManualStreamChannel } = require('./channelConfig');
  if (!isManualStreamChannel(channel) && (ecuaplaySync.isEcuaplayChannel(channel) || /fubo18\.com/i.test(channel.stream_url || ''))) {
    try {
      const config = configFromChannel(channel);
      const referer = config.advanced?.referer || 'https://la18hd.com/';
      let url = primarySourceUrl(config, channel.stream_url);
      let result = await scanSourceUrl(url, {
        referer,
        user_agent: config.advanced?.user_agent,
        timeout: config.advanced?.timeout || 20
      });
      if (!result.ok) {
        await ecuaplaySync.refreshEcuaplayChannel(channel);
        const fresh = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channel.id);
        const freshCfg = configFromChannel(fresh);
        url = primarySourceUrl(freshCfg, fresh.stream_url);
        result = await scanSourceUrl(url, {
          referer: freshCfg.advanced?.referer || referer,
          user_agent: freshCfg.advanced?.user_agent,
          timeout: freshCfg.advanced?.timeout || 20
        });
        if (result.ok) {
          const streamCache = require('./streamCache');
          if (streamCache.relayActiveForChannel(fresh)) {
            await streamCache.stopCache(channel.id);
            await streamCache.startCache(channel.id);
          }
          return finishChannelCheck(fresh, 'up', `Reparado · ${result.info}`);
        }
      }
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

function getEnabledChannels() {
  return db.prepare(`
    SELECT * FROM live_channels WHERE COALESCE(enabled, 1) = 1 ORDER BY id
  `).all();
}

async function checkChannelBatch() {
  if (running) return { skipped: true, reason: 'running' };
  if (backgroundLoadHigh()) return { skipped: true, reason: 'busy' };

  running = true;
  try {
    const channels = getEnabledChannels();
    if (!channels.length) return { checked: 0, results: [] };

    const start = batchCursor % channels.length;
    const batch = [];
    for (let i = 0; i < BATCH_SIZE && i < channels.length; i++) {
      batch.push(channels[(start + i) % channels.length]);
    }
    batchCursor = (start + batch.length) % channels.length;

    const results = [];
    for (const ch of batch) {
      try {
        results.push(await checkChannel(ch));
      } catch (err) {
        updateChannelUplink(ch.id, 'down', err.message);
        results.push({ id: ch.id, name: ch.name, status: 'down', info: err.message });
      }
    }

    if (batchCursor === 0 || batchCursor <= BATCH_SIZE) {
      try {
        require('./streamCache').syncAllCacheMetrics();
      } catch { /* ignore */ }
    }

    return { checked: results.length, batch_start: start, total: channels.length, results };
  } finally {
    running = false;
  }
}

async function checkAllChannels() {
  if (running) return { skipped: true };
  running = true;
  try {
    const channels = getEnabledChannels();
    const results = [];
    for (const ch of channels) {
      try {
        results.push(await checkChannel(ch));
      } catch (err) {
        updateChannelUplink(ch.id, 'down', err.message);
        results.push({ id: ch.id, name: ch.name, status: 'down', info: err.message });
      }
    }
    batchCursor = 0;
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
  const tick = () => checkChannelBatch().catch(() => {});
  bootTimer = setTimeout(() => {
    bootTimer = null;
    tick();
    monitorTimer = setInterval(tick, intervalMs);
  }, BOOT_DELAY_MS);
}

function stopMonitor() {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

module.exports = {
  checkChannel,
  checkChannelBatch,
  checkAllChannels,
  getUplinkStats,
  getChannelsWithStatus,
  startMonitor,
  stopMonitor
};
