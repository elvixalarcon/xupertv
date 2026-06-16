const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const jwt = require('jsonwebtoken');
const { auth, adminOnly, JWT_SECRET } = require('../middleware/auth');
const { syncVixredVisibility } = require('../services/vixredSync');
const {
  syncWispxUsers,
  saveWispxConfig,
  getWispxSettingsPublic,
  getWispxStatus,
  parseCedulasInput,
  saveCedulasToFile,
  loadCedulasFromFile,
  fetchCustomerByCedula,
  CEDULAS_FILE
} = require('../services/wispxImport');
const { syncAllPlatforms } = require('../services/platformSync');
const { getActiveSessions, statusLabel } = require('../services/activity');
const { getUserRow } = require('../services/userAccess');
const streamMonitor = require('../services/streamMonitor');
const streamCache = require('../services/streamCache');
const { configFromChannel } = require('../services/channelConfig');
const { importStreamsFromXuiAdmin, importM3uFromXui, importChannelsFromXui, syncLogosFromXui, saveXuiSettings, getXuiSettingsPublic } = require('../services/xuiSync');
const { importFreeEcuadorChannels } = require('../services/freeEcuadorChannels');
const { importRadioEcuadorChannels, refreshRadioEcuadorChannels } = require('../services/radioEcuadorSync');
const { importChannels } = require('../services/tvPorInternet');
const { importEcuaplayDeportes } = require('../services/ecuaplaySync');
const { syncFastChannels } = require('../services/fastChannelsSync');
const { syncAllCountries } = require('../services/countryChannelsSync');
const tvPorInternetSync = require('../services/tvPorInternetSync');
const tcTelevisionSync = require('../services/tcTelevisionSync');
const gamavisionSync = require('../services/gamavisionSync');
const serverStats = require('../services/serverStats');
const xuiPanel = require('../services/xuiPanel');

const router = express.Router();

const rtmpBroadcast = require('../services/rtmpBroadcast');
const rtmpBrowser = require('../services/rtmpBrowser');
rtmpBroadcast.ensureUploadDir();
const rtmpUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, rtmpBroadcast.UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
      cb(null, `${Date.now()}_${safe}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(mp4|mkv|mov|avi|webm|m4v|ts|png|jpe?g|gif|webp)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Formato no permitido (video o imagen)'));
  }
});

router.get('/dashboard', auth, adminOnly, async (req, res) => {
  const lite = req.query.lite === '1';
  const activeUsers = getActiveSessions();
  const cache = streamCache.getCacheStats({ lite });
  const relay = streamCache.getRelayDashboard({ lite });
  const server = serverStats.snapshot({
    connections: activeUsers.length,
    live_streams: relay.active || 0,
    down_streams: relay.down || 0
  });

  if (lite) {
    return res.json({
      stats: {
        channels: db.prepare('SELECT COUNT(*) as c FROM live_channels').get().c,
        users: db.prepare('SELECT COUNT(*) as c FROM users').get().c
      },
      active_count: activeUsers.length,
      cache,
      relay,
      server
    });
  }

  const { countAutoRecommendedMovies } = require('../services/catalogCategories');
  const { getUsageStats } = require('../services/analytics');

  res.json({
    stats: {
      movies: db.prepare('SELECT COUNT(*) as c FROM movies').get().c,
      series: db.prepare('SELECT COUNT(*) as c FROM series').get().c,
      episodes: db.prepare('SELECT COUNT(*) as c FROM episodes').get().c,
      channels: db.prepare('SELECT COUNT(*) as c FROM live_channels').get().c,
      playlists: db.prepare('SELECT COUNT(*) as c FROM live_playlists').get().c,
      users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
      categories: db.prepare('SELECT COUNT(*) as c FROM categories').get().c,
      recommended: countAutoRecommendedMovies()
    },
    usage: getUsageStats(30),
    recent: {
      movies: db.prepare('SELECT id, title, created_at FROM movies ORDER BY created_at DESC LIMIT 5').all(),
      channels: db.prepare('SELECT id, name, group_title FROM live_channels ORDER BY id DESC LIMIT 5').all()
    },
    active_users: activeUsers,
    active_count: activeUsers.length,
    uplink: streamMonitor.getUplinkStats(),
    cache,
    relay,
    server
  });
});

router.get('/activity', auth, adminOnly, (req, res) => {
  const active = getActiveSessions();
  res.json({
    count: active.length,
    users: active.map((u) => {
      const row = getUserRow(u.user_id);
      const display_name = String(row?.display_name || '').trim();
      return { ...u, display_name, status_label: statusLabel(u.status) };
    })
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

router.get('/streams/sports-watch', auth, adminOnly, (req, res) => {
  const sportsStreamWatch = require('../services/sportsStreamWatch');
  res.json(sportsStreamWatch.getSportsWatchStatus());
});

router.post('/streams/sports-watch/check', auth, adminOnly, async (req, res) => {
  try {
    const sportsStreamWatch = require('../services/sportsStreamWatch');
    const result = await sportsStreamWatch.runSportsCheck();
    streamCache.syncAllCacheMetrics();
    res.json({ ok: true, ...result, uplink: streamMonitor.getUplinkStats() });
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

router.get('/wispx/settings', auth, adminOnly, (req, res) => {
  res.json(getWispxSettingsPublic());
});

router.get('/wispx/status', auth, adminOnly, (req, res) => {
  res.json(getWispxStatus());
});

router.get('/wispx/cedulas', auth, adminOnly, (req, res) => {
  const cedulas = loadCedulasFromFile();
  res.json({
    ok: true,
    count: cedulas.length,
    cedulas,
    text: fs.existsSync(CEDULAS_FILE) ? fs.readFileSync(CEDULAS_FILE, 'utf8') : ''
  });
});

router.put('/wispx/cedulas', auth, adminOnly, (req, res) => {
  const cedulas = Array.isArray(req.body?.cedulas)
    ? req.body.cedulas
    : parseCedulasInput(req.body?.text || '');
  const saved = saveCedulasToFile(cedulas);
  res.json({ ok: true, count: saved.length, cedulas: saved });
});

router.put('/wispx/settings', auth, adminOnly, (req, res) => {
  saveWispxConfig(req.body || {});
  res.json(getWispxSettingsPublic());
});

router.get('/wispx/customer', auth, adminOnly, async (req, res) => {
  const cedula = String(req.query.cedula || '').trim();
  if (!cedula) return res.status(400).json({ error: 'cedula requerida' });
  try {
    const customers = await fetchCustomerByCedula(cedula);
    res.json({ ok: true, cedula, count: customers.length, customers });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Error Wispx' });
  }
});

router.post('/wispx/import-users', auth, adminOnly, async (req, res) => {
  try {
    if (req.body?.wispx_api_key) saveWispxConfig({ wispx_api_key: req.body.wispx_api_key });
    const result = await syncWispxUsers({
      cedulas: Array.isArray(req.body?.cedulas) ? req.body.cedulas : undefined,
      password: req.body?.password,
      resetPassword: req.body?.reset_password !== false,
      includeDbCedulas: req.body?.include_db_cedulas !== false,
      concurrency: Math.min(16, Math.max(2, parseInt(req.body?.concurrency, 10) || 8))
    });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('[admin/wispx/import-users]', err);
    res.status(500).json({ error: err.message || 'No se pudo importar desde Wispx' });
  }
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

router.post('/channels/import-radio-ecuador', auth, adminOnly, async (req, res) => {
  try {
    const result = await importRadioEcuadorChannels({
      maxPages: req.body.max_pages,
      concurrency: req.body.concurrency,
      downloadLogos: req.body.download_logos === true,
      validateStreams: req.body.validate_streams !== false,
      slugs: Array.isArray(req.body.slugs) ? req.body.slugs : undefined
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/channels/refresh-radio-ecuador', auth, adminOnly, async (req, res) => {
  try {
    const result = await refreshRadioEcuadorChannels({
      concurrency: req.body.concurrency,
      validateStreams: req.body.validate_streams !== false
    });
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

router.post('/channels/sync-countries', auth, adminOnly, async (req, res) => {
  try {
    const result = await syncAllCountries({
      force: req.body.force === true,
      validateIptv: req.body.validate_streams !== false
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

router.get('/vod-probe-quality', auth, adminOnly, async (req, res) => {
  try {
    const vodSearchImport = require('../services/vodSearchImport');
    const data = await vodSearchImport.probeVodItemQualities({
      source: req.query.source,
      slug: req.query.slug,
      url: req.query.url,
      year: req.query.year
    });
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/movies/:id/probe-quality', auth, adminOnly, async (req, res) => {
  try {
    const movieId = parseInt(req.params.id, 10);
    if (!movieId) return res.status(400).json({ error: 'ID inválido' });
    const db = require('../db');
    const { detectSource } = require('../services/vodYtDlp');
    const { getDownloadJob } = require('../services/vodDownloadProgress');
    const { extractSlugFromPath } = require('../services/movieDedup');
    const vodSearchImport = require('../services/vodSearchImport');

    const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(movieId);
    if (!movie) return res.status(404).json({ error: 'Película no encontrada' });

    const job = getDownloadJob(movieId) || {};
    const source = job.source || detectSource(movie, job.slug);
    const slug = job.slug || extractSlugFromPath(movie.video_path) || '';
    const data = await vodSearchImport.probeVodItemQualities({
      source,
      slug,
      year: movie.year,
      title: movie.title
    });
    res.json({ ...data, movie_id: movieId, title: movie.title, source, slug });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/movies/:id/resume-download', auth, adminOnly, async (req, res) => {
  const movieId = parseInt(req.params.id, 10);
  if (!movieId) return res.status(400).json({ error: 'ID inválido' });

  const db = require('../db');
  const { resumeMovieDownload, findFinishedFileForMovie, detectSource } = require('../services/vodYtDlp');
  const { getDownloadJob, registerDownloadJob } = require('../services/vodDownloadProgress');
  const quality = ['max', '1080', '720', '480'].includes(req.body?.quality)
    ? req.body.quality
    : null;

  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(movieId);
  if (!movie) return res.status(404).json({ error: 'Película no encontrada' });
  if (Number(movie.available) === 1) {
    return res.json({ ok: true, skipped: true, message: 'Ya está disponible en catálogo' });
  }

  const job = getDownloadJob(movieId) || {};
  if (findFinishedFileForMovie(movie, job)) {
    try {
      const result = await resumeMovieDownload(movieId);
      return res.json({
        ...result,
        message: result.finalized ? 'Película publicada en catálogo' : 'Completado'
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const source = job.source || detectSource(movie, job.slug);
  if (source === 'web' && !job.media_url) {
    return res.status(400).json({ error: 'URL web perdida — vuelve a importar desde el buscador' });
  }

  if (quality) {
    const jobNow = getDownloadJob(movieId) || {};
    registerDownloadJob(movieId, { ...jobNow, quality });
  }

  const resumePromise = resumeMovieDownload(movieId, quality ? { quality } : {});
  const quick = await Promise.race([
    resumePromise
      .then((result) => ({ ...result, done: true }))
      .catch((err) => ({ ok: false, error: err.message, done: true })),
    new Promise((resolve) => {
      setTimeout(() => resolve({ ok: true, background: true }), 15000);
    })
  ]);

  if (quick.background) {
    resumePromise.catch((err) => {
      console.error(`[vod-resume] #${movieId} en segundo plano:`, err.message);
    });
    return res.json({
      ok: true,
      background: true,
      message: 'Descarga en curso en segundo plano',
      movie_id: movieId
    });
  }

  if (quick.ok === false) {
    return res.status(400).json({ error: quick.error || 'No se pudo reanudar la descarga' });
  }

  return res.json({
    ...quick,
    message: quick.finalized
      ? 'Película publicada en catálogo'
      : (quick.resumed ? 'Descarga completada' : 'Reanudación completada')
  });
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
  const { setSetting } = require('../services/settings');
  setSetting('vod_downloads_paused', '0');
  setSetting('vod_queue_enabled', '1');
  const vodPendingQueue = require('../services/vodPendingQueue');
  const result = vodPendingQueue.startQueueOrchestrator({ force: true });
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
    let { slug, download = true, only_missing: onlyMissing, series_id: seriesId, quality } = req.body;
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
    if (quality) args.push('--quality', String(quality));
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
  const { setSetting } = require('../services/settings');
  setSetting('vod_downloads_paused', '0');
  setSetting('vod_queue_enabled', '1');
  const vodPendingQueue = require('../services/vodPendingQueue');
  const movieResult = vodPendingQueue.startQueueOrchestrator({ force: true });
  const seriesResult = vodPendingQueue.startSeriesQueueOrchestrator({ force: true });
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

router.get('/rtmp-broadcast', auth, adminOnly, (req, res) => {
  res.json(rtmpBroadcast.getStatus());
});

router.get('/rtmp-broadcast/vod/movies', auth, adminOnly, (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
  res.json({ movies: rtmpBroadcast.listVodMovies(q, limit) });
});

router.get('/rtmp-broadcast/vod/series', auth, adminOnly, (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(80, parseInt(req.query.limit, 10) || 40);
  res.json({ series: rtmpBroadcast.listVodSeries(q, limit) });
});

router.get('/rtmp-broadcast/vod/series/:id/episodes', auth, adminOnly, (req, res) => {
  const data = rtmpBroadcast.listVodEpisodes(parseInt(req.params.id, 10));
  if (!data) return res.status(404).json({ error: 'Serie no encontrada' });
  res.json(data);
});

router.get('/rtmp-broadcast/resolve-url', auth, adminOnly, async (req, res) => {
  try {
    const raw = String(req.query.url || '').trim();
    if (!raw) return res.status(400).json({ error: 'URL requerida' });
    const url = await rtmpBroadcast.resolveVideoUrl(raw);
    res.json({ url, direct: rtmpBroadcast.isDirectStreamUrl(raw) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/rtmp-broadcast/browser/status', auth, adminOnly, (req, res) => {
  res.json(rtmpBrowser.getStatus());
});

router.get('/rtmp-broadcast/browser/frame', auth, adminOnly, (req, res) => {
  const frame = rtmpBrowser.getLatestFrame();
  if (!frame) return res.status(204).end();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  res.send(frame);
});

function adminAuthQuery(req, res, next) {
  const raw = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!raw) return res.status(401).end();
  try {
    req.user = jwt.verify(raw, JWT_SECRET);
    if (req.user.role !== 'admin') return res.status(403).end();
    next();
  } catch {
    res.status(401).end();
  }
}

router.get('/rtmp-broadcast/browser/mjpeg', adminAuthQuery, (req, res) => {
  rtmpBrowser.startMjpegStream(res);
});

router.post('/rtmp-broadcast/browser/start', auth, adminOnly, async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim() || 'about:blank';
    await rtmpBrowser.ensureSession(url);
    res.json({ ok: true, ...rtmpBrowser.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rtmp-broadcast/browser/navigate', auth, adminOnly, async (req, res) => {
  try {
    const result = await rtmpBrowser.navigate(req.body?.url);
    res.json({ ok: true, ...result, ...rtmpBrowser.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rtmp-broadcast/browser/click', auth, adminOnly, async (req, res) => {
  try {
    const { x, y, double } = req.body || {};
    const result = double
      ? await rtmpBrowser.doubleClick(Number(x), Number(y))
      : await rtmpBrowser.click(Number(x), Number(y));
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rtmp-broadcast/browser/scroll', auth, adminOnly, async (req, res) => {
  try {
    await rtmpBrowser.scroll(Number(req.body?.deltaY) || 120);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rtmp-broadcast/browser/type', auth, adminOnly, async (req, res) => {
  try {
    await rtmpBrowser.typeText(req.body?.text);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rtmp-broadcast/browser/key', auth, adminOnly, async (req, res) => {
  try {
    await rtmpBrowser.pressKey(req.body?.key || 'Enter');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rtmp-broadcast/browser/back', auth, adminOnly, async (req, res) => {
  try {
    const result = await rtmpBrowser.goBack();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rtmp-broadcast/browser/stop', auth, adminOnly, async (req, res) => {
  try {
    await rtmpBrowser.stopSession();
    res.json({ ok: true, stopped: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/rtmp-broadcast/settings', auth, adminOnly, (req, res) => {
  const settings = rtmpBroadcast.saveSettings(req.body || {});
  res.json({ ok: true, settings, status: rtmpBroadcast.getStatus() });
});

router.put('/rtmp-broadcast/studio', auth, adminOnly, (req, res) => {
  const settings = rtmpBroadcast.saveStudio(req.body || {});
  res.json({ ok: true, settings, status: rtmpBroadcast.getStatus() });
});

router.post('/rtmp-broadcast/upload', auth, adminOnly, (req, res) => {
  rtmpUpload.single('video')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const kind = /\.(png|jpe?g|gif|webp)$/i.test(req.file.filename) ? 'image' : 'video';
    const file = {
      name: req.file.filename,
      path: `/uploads/rtmp-broadcast/${req.file.filename}`,
      kind,
      size: req.file.size,
      size_mb: +(req.file.size / (1024 * 1024)).toFixed(2)
    };
    res.json({ ok: true, file, status: rtmpBroadcast.getStatus() });
  });
});

router.post('/rtmp-broadcast/start', auth, adminOnly, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.scenes) rtmpBroadcast.saveStudio(body);
    const result = await rtmpBroadcast.startBroadcast({
      scene_id: body.scene_id || body.active_scene_id,
      push_url: body.push_url,
      stream_key: body.stream_key,
      loop: body.loop,
      scenes: body.scenes
    });
    res.json({ ok: true, ...result, status: rtmpBroadcast.getStatus() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/rtmp-broadcast/stop', auth, adminOnly, (req, res) => {
  const result = rtmpBroadcast.stopBroadcast();
  res.json({ ok: true, ...result, status: rtmpBroadcast.getStatus() });
});

router.delete('/rtmp-broadcast/files/:name', auth, adminOnly, (req, res) => {
  const name = path.basename(String(req.params.name || ''));
  const full = path.join(rtmpBroadcast.UPLOAD_DIR, name);
  if (!full.startsWith(rtmpBroadcast.UPLOAD_DIR) || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }
  fs.unlinkSync(full);
  res.json({ ok: true, status: rtmpBroadcast.getStatus() });
});

module.exports = router;
