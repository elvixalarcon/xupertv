const db = require('../db');
const { getSetting, setSetting } = require('./settings');
const { configFromChannel, serializeConfig, normalizeSource } = require('./channelConfig');
const tvPorInternet = require('./tvPorInternet');
const { importChannels, CHANNEL_CATALOG } = tvPorInternet;
const movieChannelAlternatives = require('./movieChannelAlternatives');

const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_MOVIE_IMPORT_MS = 24 * 60 * 60 * 1000;
const CHANNEL_DELAY_MS = 450;

let syncTimer = null;
let movieImportTimer = null;
let running = false;
let movieImportRunning = false;

function isEnabled() {
  return getSetting('tvpi_refresh_enabled', '1') !== '0';
}

function intervalMs() {
  const hours = parseFloat(getSetting('tvpi_refresh_hours', '4')) || 4;
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function listTvPorInternetChannels() {
  return db.prepare(`
    SELECT * FROM live_channels
    WHERE COALESCE(enabled, 1) = 1
      AND (
        config LIKE '%"resolver":"tvporinternet"%'
        OR config LIKE '%saohgdasregions%'
        OR stream_url LIKE '%saohgdasregions%'
      )
    ORDER BY name COLLATE NOCASE
  `).all();
}

async function refreshTvChannel(channel) {
  tvPorInternet.invalidateChannelPlayback(channel.id);
  const playback = await tvPorInternet.getChannelPlayback(channel, { force: true });
  if (!playback?.url) {
    return { id: channel.id, name: channel.name, ok: false, error: 'sin señal' };
  }

  const config = configFromChannel(channel);
  let primaryUpdated = false;
  config.sources = (config.sources || []).map((src) => {
    if (!tvPorInternet.isTvPorInternetSource(src)) return normalizeSource(src);
    if (!primaryUpdated) {
      primaryUpdated = true;
      return normalizeSource({
        ...src,
        streamUrl: playback.url,
        playerUrl: playback.referer || src.playerUrl,
        referer: playback.referer || src.referer,
        scan_status: 'ok',
        scan_info: 'token renovado automáticamente'
      });
    }
    return normalizeSource(src);
  });

  config.tvporinternet = {
    ...(config.tvporinternet || {}),
    stream_refreshed_at: new Date().toISOString()
  };

  db.prepare('UPDATE live_channels SET stream_url = ?, config = ? WHERE id = ?')
    .run(playback.url, serializeConfig(config), channel.id);

  return { id: channel.id, name: channel.name, ok: true, url: playback.url };
}

async function refreshAllTvPorInternetChannels() {
  if (running) return { skipped: true, reason: 'sync en curso' };
  running = true;
  const started = Date.now();
  const results = { ok: 0, fail: 0, channels: [] };

  try {
    const channels = listTvPorInternetChannels();
    for (const ch of channels) {
      try {
        const row = await refreshTvChannel(ch);
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
      await sleep(CHANNEL_DELAY_MS);
    }

    results.total = channels.length;
    results.duration_ms = Date.now() - started;
    setSetting('tvpi_refresh_last', new Date().toISOString());
    setSetting('tvpi_refresh_ok', String(results.ok));
    setSetting('tvpi_refresh_fail', String(results.fail));
    return results;
  } finally {
    running = false;
  }
}

function startTvPorInternetScheduler() {
  if (syncTimer) return;
  if (!isEnabled()) return;

  refreshAllTvPorInternetChannels().catch((err) => {
    console.warn('[tvpi-sync] inicial:', err.message || err);
  });

  syncTimer = setInterval(() => {
    refreshAllTvPorInternetChannels().catch((err) => {
      console.warn('[tvpi-sync]', err.message || err);
    });
  }, intervalMs());

  if (syncTimer.unref) syncTimer.unref();
  startMovieChannelsScheduler();
}

function stopTvPorInternetScheduler() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (movieImportTimer) {
    clearInterval(movieImportTimer);
    movieImportTimer = null;
  }
}

function isMovieImportEnabled() {
  return getSetting('tvpi_movie_import_enabled', '1') !== '0';
}

function movieImportIntervalMs() {
  const hours = parseFloat(getSetting('tvpi_movie_import_hours', '24')) || 24;
  return Math.max(6, hours) * 60 * 60 * 1000;
}

function listMovieCatalogNames() {
  return CHANNEL_CATALOG
    .filter((c) => c.group_title === 'Películas')
    .map((c) => c.name);
}

async function importAllMovieChannels() {
  if (movieImportRunning) return { skipped: true, reason: 'importación en curso' };
  movieImportRunning = true;
  const started = Date.now();
  try {
    const names = listMovieCatalogNames();
    const result = await importChannels(names);
    const alternatives = await movieChannelAlternatives.applyMovieChannelAlternatives();
    const out = {
      ...result,
      alternatives,
      duration_ms: Date.now() - started,
      group: 'Películas'
    };
    setSetting('tvpi_movie_import_last', new Date().toISOString());
    setSetting('tvpi_movie_import_ok', String(result.imported));
    setSetting('tvpi_movie_import_fail', String(result.failed));
    console.log(`[tvpi-sync] Películas: ${result.imported}/${result.total} importados, ${result.failed} fallos, ${alternatives.ok} alternativas`);
    return out;
  } finally {
    movieImportRunning = false;
  }
}

function startMovieChannelsScheduler() {
  if (movieImportTimer) return;
  if (!isMovieImportEnabled()) return;

  importAllMovieChannels().catch((err) => {
    console.warn('[tvpi-sync] import Películas inicial:', err.message || err);
  });

  movieImportTimer = setInterval(() => {
    importAllMovieChannels().catch((err) => {
      console.warn('[tvpi-sync] import Películas:', err.message || err);
    });
  }, movieImportIntervalMs());

  if (movieImportTimer.unref) movieImportTimer.unref();
}

module.exports = {
  refreshTvChannel,
  refreshAllTvPorInternetChannels,
  importAllMovieChannels,
  listTvPorInternetChannels,
  listMovieCatalogNames,
  startTvPorInternetScheduler,
  stopTvPorInternetScheduler,
  startMovieChannelsScheduler,
  isEnabled,
  isMovieImportEnabled,
  intervalMs,
  movieImportIntervalMs
};
