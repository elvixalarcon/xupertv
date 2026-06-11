const db = require('../db');
const { getSetting, setSetting } = require('./settings');
const { configFromChannel, serializeConfig, normalizeSource } = require('./channelConfig');
const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const RESOLVE_SCRIPT = path.join(__dirname, '..', 'scripts', 'resolve-gamavision-stream.py');

const GAMA_PAGE = 'https://www.gamavision.com.ec/en-vivo/';
const GAMA_REFERER = 'https://www.gamavision.com.ec/';
const DEFAULT_STREAM = 'https://stream.esradioecuador.com/hls/stream.m3u8';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RETRY_INTERVAL_MS = 2 * 60 * 60 * 1000;

let syncTimer = null;
let retryTimer = null;
let running = false;

function isEnabled() {
  return getSetting('gama_refresh_enabled', '1') !== '0';
}

function intervalMs() {
  const hours = parseFloat(getSetting('gama_refresh_hours', '24')) || 24;
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function isGamavisionChannel(channel) {
  const config = configFromChannel(channel);
  if ((config.sources || []).some((s) => s.resolver === 'gamavision')) return true;
  const name = String(channel?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (name.includes('gamavision')) return true;
  const url = String(channel?.stream_url || '');
  return /esradioecuador\.com|gamavision/i.test(url);
}

function listGamavisionChannels() {
  return db.prepare(`
    SELECT * FROM live_channels
    WHERE lower(name) LIKE '%gamavision%'
       OR lower(name) LIKE '%gamavisi%'
       OR config LIKE '%"resolver":"gamavision"%'
       OR stream_url LIKE '%esradioecuador.com%'
    ORDER BY CASE WHEN lower(name) LIKE '%gamavision%' THEN 0 ELSE 1 END, id
  `).all();
}

async function resolveGamavisionStreamUrl() {
  const { stdout } = await execFileAsync('python3', [RESOLVE_SCRIPT], {
    timeout: 45000,
    maxBuffer: 1024 * 1024
  });
  const payload = JSON.parse(String(stdout || '').trim());
  if (!payload.ok || !payload.stream_url) {
    throw new Error(payload.error || 'No se pudo resolver Gamavisión');
  }
  return {
    streamUrl: payload.stream_url,
    referer: payload.referer || GAMA_REFERER,
    pageUrl: payload.page_url || GAMA_PAGE,
    title: payload.title || 'Gamavisión'
  };
}

async function refreshGamavisionChannel(channel, resolved) {
  const config = configFromChannel(channel);
  const source = normalizeSource({
    url: resolved.streamUrl,
    referer: resolved.referer,
    user_agent: DEFAULT_UA,
    resolver: 'gamavision',
    pageUrl: resolved.pageUrl,
    scan_status: 'ok',
    scan_info: 'M3U8 verificado desde gamavision.com.ec'
  });

  config.enabled = true;
  config.sources = [source];
  config.advanced = {
    ...(config.advanced || {}),
    referer: resolved.referer,
    user_agent: DEFAULT_UA,
    custom_headers: 'Origin: https://www.gamavision.com.ec'
  };
  config.gamavision = {
    page_url: resolved.pageUrl,
    referer: resolved.referer,
    stream_refreshed_at: new Date().toISOString()
  };

  db.prepare('UPDATE live_channels SET stream_url = ?, enabled = 1, config = ? WHERE id = ?')
    .run(resolved.streamUrl, serializeConfig(config), channel.id);

  return {
    id: channel.id,
    name: channel.name,
    ok: true,
    url: resolved.streamUrl,
    referer: resolved.referer
  };
}

async function refreshAllGamavisionChannels() {
  if (running) return { skipped: true, reason: 'sync en curso' };
  running = true;
  const started = Date.now();
  const results = { ok: 0, fail: 0, channels: [] };

  try {
    const channels = listGamavisionChannels();
    if (!channels.length) {
      return { ok: 0, fail: 0, channels: [], total: 0, error: 'Canal Gamavisión no encontrado' };
    }

    const resolved = await resolveGamavisionStreamUrl();
    for (const ch of channels) {
      try {
        const row = await refreshGamavisionChannel(ch, resolved);
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
    setSetting('gama_refresh_last', new Date().toISOString());
    setSetting('gama_refresh_ok', String(results.ok));
    setSetting('gama_refresh_fail', String(results.fail));
    setSetting('gama_refresh_url', resolved.streamUrl);
    setSetting('gama_refresh_error', '');
    scheduleRetry(results.fail > 0);
    return results;
  } catch (err) {
    const message = err.message || String(err);
    setSetting('gama_refresh_last', new Date().toISOString());
    setSetting('gama_refresh_fail', '1');
    setSetting('gama_refresh_error', message.slice(0, 220));
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
    refreshAllGamavisionChannels().catch((err) => {
      console.warn('[gama-sync] reintento:', err.message || err);
    });
  }, RETRY_INTERVAL_MS);
  if (retryTimer.unref) retryTimer.unref();
}

function startGamavisionScheduler() {
  if (syncTimer) return;
  if (!isEnabled()) return;

  refreshAllGamavisionChannels().catch((err) => {
    console.warn('[gama-sync] inicial:', err.message || err);
  });

  syncTimer = setInterval(() => {
    refreshAllGamavisionChannels().catch((err) => {
      console.warn('[gama-sync]', err.message || err);
    });
  }, intervalMs());

  if (syncTimer.unref) syncTimer.unref();
}

function stopGamavisionScheduler() {
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
  resolveGamavisionStreamUrl,
  refreshAllGamavisionChannels,
  listGamavisionChannels,
  isGamavisionChannel,
  startGamavisionScheduler,
  stopGamavisionScheduler,
  isEnabled,
  intervalMs,
  GAMA_PAGE,
  GAMA_REFERER,
  DEFAULT_STREAM
};
