const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { syncVixredVisibility } = require('../services/vixredSync');
const { syncAllPlatforms } = require('../services/platformSync');
const { getActiveSessions, statusLabel } = require('../services/activity');
const streamMonitor = require('../services/streamMonitor');
const streamCache = require('../services/streamCache');
const { configFromChannel } = require('../services/channelConfig');
const { importStreamsFromXuiAdmin, importM3uFromXui, importChannelsFromXui, syncLogosFromXui, saveXuiSettings, getXuiSettingsPublic } = require('../services/xuiSync');
const { importFreeEcuadorChannels } = require('../services/freeEcuadorChannels');
const { importChannels } = require('../services/tvPorInternet');
const { importEcuaplayDeportes } = require('../services/ecuaplaySync');
const { syncFastChannels } = require('../services/fastChannelsSync');
const tvPorInternetSync = require('../services/tvPorInternetSync');
const tcTelevisionSync = require('../services/tcTelevisionSync');
const gamavisionSync = require('../services/gamavisionSync');
const serverStats = require('../services/serverStats');
const xuiPanel = require('../services/xuiPanel');

const router = express.Router();

router.get('/dashboard', auth, adminOnly, async (req, res) => {
  const movies = db.prepare('SELECT COUNT(*) as c FROM movies').get().c;
  const series = db.prepare('SELECT COUNT(*) as c FROM series').get().c;
  const episodes = db.prepare('SELECT COUNT(*) as c FROM episodes').get().c;
  const channels = db.prepare('SELECT COUNT(*) as c FROM live_channels').get().c;
  const playlists = db.prepare('SELECT COUNT(*) as c FROM live_playlists').get().c;
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const categories = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  const { countAutoRecommendedMovies } = require('../services/catalogCategories');
  const { getUsageStats } = require('../services/analytics');
  const recommended = countAutoRecommendedMovies();
  const usage = getUsageStats(30);

  const recentMovies = db.prepare('SELECT id, title, created_at FROM movies ORDER BY created_at DESC LIMIT 5').all();
  const recentChannels = db.prepare('SELECT id, name, group_title FROM live_channels ORDER BY id DESC LIMIT 5').all();

  const activeUsers = getActiveSessions();
  const uplink = streamMonitor.getUplinkStats();
  const cache = streamCache.getCacheStats();
  const relay = streamCache.getRelayDashboard();
  const streamChannels = streamMonitor.getChannelsWithStatus().map((ch) => {
    const relayOn = streamCache.relayActiveForChannel(ch);
    const metrics = relayOn ? streamCache.getRelayMetrics(ch.id) : {};
    return {
      ...ch,
      cache_mb: ((ch.cache_bytes || 0) / (1024 * 1024)).toFixed(1),
      cache_formatted: streamCache.formatBytes(ch.cache_bytes || 0),
      relay_on: relayOn,
      import_mbps: metrics.import_mbps || 0,
      output_mbps: metrics.output_mbps || 0,
      relay_speed: metrics.speed || 0,
      relay_uptime: streamCache.formatUptime(ch.cache_started_at)
    };
  });

  const server = serverStats.snapshot({
    connections: activeUsers.length,
    live_streams: relay.active || 0,
    down_streams: relay.down || 0
  });

  res.json({
    stats: { movies, series, episodes, channels, playlists, users, categories, recommended },
    usage,
    recent: { movies: recentMovies, channels: recentChannels },
    active_users: activeUsers,
    active_count: activeUsers.length,
    uplink,
    cache,
    relay,
    stream_channels: streamChannels,
    server
  });
});

router.get('/activity', auth, adminOnly, (req, res) => {
  const active = getActiveSessions();
  res.json({
    count: active.length,
    users: active.map((u) => ({ ...u, status_label: statusLabel(u.status) }))
  });
});

router.post('/streams/monitor/refresh', auth, adminOnly, async (req, res) => {
  try {
    const result = await streamMonitor.checkAllChannels();
    streamCache.syncAllCacheMetrics();
    res.json({ ok: true, ...result, uplink: streamMonitor.getUplinkStats(), cache: streamCache.getCacheStats() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/streams/status', auth, adminOnly, (req, res) => {
  streamCache.syncAllCacheMetrics();
  res.json({
    uplink: streamMonitor.getUplinkStats(),
    cache: streamCache.getCacheStats(),
    relay: streamCache.getRelayDashboard(),
    channels: streamMonitor.getChannelsWithStatus()
  });
});

router.post('/streams/cache/:id/toggle', auth, adminOnly, async (req, res) => {
  const enabled = !!req.body.enabled;
  try {
    const result = await streamCache.setCacheEnabled(parseInt(req.params.id, 10), enabled);
    streamCache.syncCacheMetrics(parseInt(req.params.id, 10));
    res.json({ ok: true, ...result, cache: streamCache.getCacheStats() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/streams/cache/:id/start', auth, adminOnly, async (req, res) => {
  try {
    db.prepare('UPDATE live_channels SET cache_enabled = 1 WHERE id = ?').run(req.params.id);
    const result = await streamCache.startCache(parseInt(req.params.id, 10));
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/streams/cache/:id/stop', auth, adminOnly, (req, res) => {
  streamCache.stopCache(parseInt(req.params.id, 10));
  res.json({ ok: true, cache: streamCache.getCacheStats() });
});

router.post('/streams/cache/enable-all', auth, adminOnly, async (req, res) => {
  try {
    const startProcesses = !!req.body.startProcesses;
    const batchSize = Math.min(20, Math.max(1, parseInt(req.body.batchSize, 10) || 5));
    const delayMs = Math.min(10000, Math.max(0, parseInt(req.body.delayMs, 10) || 1500));
    const result = await streamCache.enableRelayForAllChannels({ startProcesses, batchSize, delayMs });
    res.json({ ok: true, ...result, cache: streamCache.getCacheStats(), relay: streamCache.getRelayDashboard() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/streams/cache/start-all', auth, adminOnly, async (req, res) => {
  try {
    const batchSize = Math.min(20, Math.max(1, parseInt(req.body.batchSize, 10) || 5));
    const delayMs = Math.min(10000, Math.max(0, parseInt(req.body.delayMs, 10) || 1500));
    const result = await streamCache.startAllEnabledCaches({ batchSize, delayMs });
    res.json({ ok: true, ...result, cache: streamCache.getCacheStats(), relay: streamCache.getRelayDashboard() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/streams/cache/stop-all', auth, adminOnly, (req, res) => {
  const result = streamCache.disableRelayForAllChannels();
  res.json({ ok: true, ...result, cache: streamCache.getCacheStats(), relay: streamCache.getRelayDashboard() });
});

router.delete('/streams/cache/:id/data', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  streamCache.stopCache(id);
  const dir = streamCache.channelCacheDir(id);
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach((f) => {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    });
  }
  streamCache.syncCacheMetrics(id);
  res.json({ ok: true });
});

router.post('/sync-vixred', auth, adminOnly, (req, res) => {
  const result = syncVixredVisibility();
  res.json({ ok: true, ...result });
});

router.post('/sync-platforms', auth, adminOnly, async (req, res) => {
  try {
    const result = await syncAllPlatforms({
      onlyMissing: req.body.onlyMissing !== false,
      limit: req.body.limit
    });
    res.json(result);
  } catch (err) {
    console.error('[admin/sync-platforms]', err);
    res.status(500).json({ error: err.message || 'Error al sincronizar plataformas' });
  }
});

router.get('/xui/settings', auth, adminOnly, (req, res) => {
  res.json({ ...getXuiSettingsPublic(), ...xuiPanel.getAdminSettingsPublic() });
});

router.put('/xui/settings', auth, adminOnly, (req, res) => {
  saveXuiSettings(req.body);
  xuiPanel.saveAdminConfig(req.body);
  res.json({ ok: true, ...getXuiSettingsPublic(), ...xuiPanel.getAdminSettingsPublic() });
});

router.post('/xui/test-admin', auth, adminOnly, async (req, res) => {
  if (req.body.xui_admin_pass && !String(req.body.xui_admin_pass).startsWith('•')) {
    xuiPanel.saveAdminConfig(req.body);
  } else if (req.body.xui_admin_url || req.body.xui_admin_user) {
    xuiPanel.saveAdminConfig({ ...req.body, xui_admin_pass: undefined });
  }
  const r = await xuiPanel.login(true);
  if (!r.ok) return res.status(400).json({ error: r.error || 'Login fallido' });
  const stats = await xuiPanel.fetchDashboardStats();
  if (!stats.ok) return res.status(400).json({ error: stats.error });
  res.json({ ok: true, message: 'Conectado a XUI ONE', stats });
});

router.post('/xui/import-m3u', auth, adminOnly, async (req, res) => {
  try {
    const result = await importM3uFromXui({
      download: req.body.download !== false,
      syncMetadata: req.body.syncMetadata !== false
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/xui/import-channels', auth, adminOnly, async (req, res) => {
  try {
    const result = await importStreamsFromXuiAdmin({
      download: req.body.download !== false
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/xui/sync-logos', auth, adminOnly, async (req, res) => {
  try {
    const result = await syncLogosFromXui({ download: req.body.download !== false });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/import-ecuador-free', auth, adminOnly, async (req, res) => {
  try {
    const result = await importFreeEcuadorChannels({ downloadLogos: req.body.download_logos !== false });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/import-ecuaplay-deportes', auth, adminOnly, async (req, res) => {
  try {
    const result = await importEcuaplayDeportes({ downloadLogos: req.body.download_logos !== false });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/import-tvporinternet', auth, adminOnly, async (req, res) => {
  try {
    const channels = Array.isArray(req.body.channels) ? req.body.channels : [];
    const result = await importChannels(channels.length ? channels : undefined);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/sync-fast', auth, adminOnly, async (req, res) => {
  try {
    const result = await syncFastChannels({
      force: req.body.force === true,
      downloadLogos: req.body.download_logos !== false
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/refresh-tvporinternet', auth, adminOnly, async (req, res) => {
  try {
    const result = await tvPorInternetSync.refreshAllTvPorInternetChannels();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/import-movie-channels', auth, adminOnly, async (req, res) => {
  try {
    const result = await tvPorInternetSync.importAllMovieChannels();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/apply-movie-alternatives', auth, adminOnly, async (req, res) => {
  try {
    const movieChannelAlternatives = require('../services/movieChannelAlternatives');
    const names = Array.isArray(req.body.channels) ? req.body.channels : [];
    const result = await movieChannelAlternatives.applyMovieChannelAlternatives({ names });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/refresh-tc', auth, adminOnly, async (req, res) => {
  try {
    const result = await tcTelevisionSync.refreshAllTcChannels();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/refresh-gamavision', auth, adminOnly, async (req, res) => {
  try {
    const result = await gamavisionSync.refreshAllGamavisionChannels();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/movies/download-progress', auth, adminOnly, (req, res) => {
  const { getPendingMoviesProgress } = require('../services/vodDownloadProgress');
  res.json(getPendingMoviesProgress());
});

router.post('/movies/:id/resume-download', auth, adminOnly, (req, res) => {
  const movieId = parseInt(req.params.id, 10);
  if (!movieId) return res.status(400).json({ error: 'ID inválido' });
  const { spawn } = require('child_process');
  const path = require('path');
  const script = path.join(__dirname, '..', 'scripts', 'resume-vod-download.js');
  const child = spawn('node', [script, String(movieId)], {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..', '..')
  });
  child.unref();
  res.json({ ok: true, message: 'Reanudación iniciada en segundo plano', movie_id: movieId });
});

router.post('/vod/stop-all', auth, adminOnly, (req, res) => {
  const { execSync } = require('child_process');
  const { setSetting } = require('../services/settings');
  try {
    setSetting('vod_downloads_paused', '1');
    setSetting('vod_queue_enabled', '0');
    for (const pattern of [
      'yt-dlp',
      'process-vod-queue.js',
      'process-series-queue.js',
      'resume-vod-download.js'
    ]) {
      try {
        execSync(`pkill -9 -f "${pattern}" 2>/dev/null || true`, { stdio: 'ignore' });
      } catch { /* ignore */ }
    }
    res.json({ ok: true, message: 'Descargas detenidas. Cola automática pausada.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/movies/resume-stuck', auth, adminOnly, (req, res) => {
  const vodPendingQueue = require('../services/vodPendingQueue');
  const result = vodPendingQueue.startQueueOrchestrator();
  const status = vodPendingQueue.getQueueStatus();
  res.json({
    ok: true,
    message: `Cola iniciada: ${status.pending_count} película(s) pendiente(s)`,
    ...status,
    ...result
  });
});

router.get('/movies/download-queue', auth, adminOnly, (req, res) => {
  const vodPendingQueue = require('../services/vodPendingQueue');
  res.json(vodPendingQueue.getQueueStatus());
});

router.get('/episodes/download-progress', auth, adminOnly, (req, res) => {
  const { getPendingEpisodesProgress } = require('../services/vodDownloadProgress');
  const seriesId = parseInt(req.query.series_id, 10) || null;
  res.json(getPendingEpisodesProgress(seriesId || null));
});

router.post('/series/import-allcalidad', auth, adminOnly, async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const pathMod = require('path');
    const db = require('../db');
    let { slug, download = true, only_missing: onlyMissing, series_id: seriesId } = req.body;
    seriesId = parseInt(seriesId, 10) || null;
    if (!slug && seriesId) {
      const row = db.prepare('SELECT allcalidad_slug FROM series WHERE id = ?').get(seriesId);
      slug = row?.allcalidad_slug || '';
    }
    if (!slug) return res.status(400).json({ error: 'slug requerido (ej: from-2022)' });
    if (seriesId) {
      db.prepare('UPDATE series SET allcalidad_slug = ? WHERE id = ?').run(slug, seriesId);
    }
    const script = pathMod.join(__dirname, '..', 'scripts', 'import-allcalidad-series.js');
    const args = [script, '--slug', slug];
    if (download) args.push('--download');
    if (onlyMissing) args.push('--only-missing');
    if (seriesId) args.push('--series-id', String(seriesId));
    const child = spawn('node', args, {
      detached: true,
      stdio: 'ignore',
      cwd: pathMod.join(__dirname, '..', '..')
    });
    child.unref();
    res.json({
      ok: true,
      message: download
        ? `Descarga de capítulos iniciada: ${slug}`
        : `Catálogo de serie importado: ${slug}`,
      slug,
      series_id: seriesId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/series/:id/download-pending', auth, adminOnly, async (req, res) => {
  try {
    const seriesId = parseInt(req.params.id, 10);
    const db = require('../db');
    const row = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
    if (!row) return res.status(404).json({ error: 'Serie no encontrada' });
    let slug = (req.body.slug || row.allcalidad_slug || '').trim();
    if (!slug && /^from$/i.test(row.title)) slug = 'from-2022';
    if (!slug) return res.status(400).json({ error: 'Configura el slug AllCalidad en la serie (ej: from-2022)' });
    db.prepare('UPDATE series SET allcalidad_slug = ? WHERE id = ?').run(slug, seriesId);
    const vodPendingQueue = require('../services/vodPendingQueue');
    const result = vodPendingQueue.startSeriesQueueOrchestrator(seriesId, { manual: true });
    const pending = db.prepare(
      'SELECT COUNT(*) AS c FROM episodes WHERE series_id = ? AND COALESCE(available, 1) = 0'
    ).get(seriesId).c;
    const status = vodPendingQueue.getQueueStatus();
    res.json({
      ok: true,
      message: pending > 0
        ? `Cola de descarga iniciada: ${pending} capítulo(s) pendiente(s)`
        : 'No hay capítulos pendientes en esta serie',
      pending_count: pending,
      ...status,
      ...result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/series/download-all-pending', auth, adminOnly, (req, res) => {
  const vodPendingQueue = require('../services/vodPendingQueue');
  const result = vodPendingQueue.startSeriesQueueOrchestrator();
  const status = vodPendingQueue.getQueueStatus();
  res.json({
    ok: true,
    message: `Descargando ${status.series_pending_count} capítulo(s) en cola`,
    ...status,
    ...result
  });
});

router.post('/movies/download-all', auth, adminOnly, (req, res) => {
  const vodPendingQueue = require('../services/vodPendingQueue');
  const movieResult = vodPendingQueue.startQueueOrchestrator();
  const seriesResult = vodPendingQueue.startSeriesQueueOrchestrator();
  const status = vodPendingQueue.getQueueStatus();
  res.json({
    ok: true,
    message: `Cola: ${status.pending_count} película(s) · ${status.series_pending_count} capítulo(s)`,
    ...status,
    ...movieResult,
    series: seriesResult
  });
});

router.post('/movies/deduplicate', auth, adminOnly, (req, res) => {
  const { deduplicateCatalog } = require('../services/movieDedup');
  const { registerDownloadJob } = require('../services/vodDownloadProgress');
  const { extractSlugFromPath } = require('../services/movieDedup');
  const db = require('../db');
  const removed = deduplicateCatalog();
  const pending = db.prepare('SELECT * FROM movies WHERE COALESCE(available, 1) = 0').all();
  for (const m of pending) {
    const slug = extractSlugFromPath(m.video_path);
    if (slug) {
      registerDownloadJob(m.id, {
        logFile: `winscp/import-cuevana-${slug}.log`,
        destBase: `pending_${slug}`,
        slug
      });
    }
  }
  res.json({ ok: true, removed: removed.length, details: removed });
});

router.get('/vod-nightly', auth, adminOnly, (req, res) => {
  const vodNightlySync = require('../services/vodNightlySync');
  res.json(vodNightlySync.getPublicSettings());
});

router.put('/vod-nightly', auth, adminOnly, (req, res) => {
  const vodNightlySync = require('../services/vodNightlySync');
  vodNightlySync.applySettings(req.body);
  vodNightlySync.restartVodNightlyScheduler();
  res.json({ ok: true, ...vodNightlySync.getPublicSettings() });
});

router.post('/vod-nightly/run', auth, adminOnly, async (req, res) => {
  try {
    const vodNightlySync = require('../services/vodNightlySync');
    const result = await vodNightlySync.runNightlyJob({
      force: true,
      limit: req.body?.limit
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/vod-search', auth, adminOnly, async (req, res) => {
  try {
    const vodSearchImport = require('../services/vodSearchImport');
    const q = String(req.query.q || '').trim();
    const source = String(req.query.source || 'all').toLowerCase();
    if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });
    const probeQualities = req.query.probe_qualities !== '0';
    const data = await vodSearchImport.searchVod({ q, source, probe_qualities: probeQualities });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/vod-import', auth, adminOnly, async (req, res) => {
  try {
    const vodSearchImport = require('../services/vodSearchImport');
    const result = await vodSearchImport.importVod({ ...(req.body || {}), manual_download: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
