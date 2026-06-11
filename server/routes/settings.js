const express = require('express');
const { auth, adminOnly } = require('../middleware/auth');
const { getSetting, setSetting, getTmdbApiKey, maskKey } = require('../services/settings');
const { fetchTmdbMoviePoster } = require('../services/posters');
const streamProxyPool = require('../services/streamProxyPool');
const vodNightlySync = require('../services/vodNightlySync');
const appUpdate = require('../services/appUpdate');
const db = require('../db');

const router = express.Router();

router.get('/', auth, adminOnly, (req, res) => {
  const key = getTmdbApiKey();
  const proxy = streamProxyPool.settingsSnapshot();
  res.json({
    tmdb_api_key: key,
    tmdb_api_key_masked: maskKey(key),
    tmdb_configured: !!key,
    ...proxy,
    ...vodNightlySync.getPublicSettings(),
    ...appUpdate.getPublicSettings()
  });
});

router.put('/', auth, adminOnly, (req, res) => {
  const { tmdb_api_key, stream_proxy_enabled, stream_proxy_list } = req.body;
  if (tmdb_api_key !== undefined) {
    setSetting('tmdb_api_key', String(tmdb_api_key).trim());
  }
  if (stream_proxy_enabled !== undefined) {
    setSetting('stream_proxy_enabled', stream_proxy_enabled ? '1' : '0');
  }
  if (stream_proxy_list !== undefined) {
    setSetting('stream_proxy_list', String(stream_proxy_list || '').trim());
  }
  vodNightlySync.applySettings(req.body);
  appUpdate.applySettings(req.body);
  vodNightlySync.restartVodNightlyScheduler();
  const key = getTmdbApiKey();
  const proxy = streamProxyPool.settingsSnapshot();
  res.json({
    ok: true,
    tmdb_configured: !!key,
    tmdb_api_key_masked: maskKey(key),
    ...proxy,
    ...vodNightlySync.getPublicSettings(),
    ...appUpdate.getPublicSettings()
  });
});

router.post('/test-stream-proxy', auth, adminOnly, async (req, res) => {
  const raw = String(req.body?.proxy || '').trim();
  const list = raw ? [raw] : streamProxyPool.listProxies().map((p) => p.raw);
  if (!list.length) {
    return res.status(400).json({ error: 'No hay proxies configurados' });
  }
  const results = [];
  for (const proxy of list.slice(0, 3)) {
    try {
      results.push(await streamProxyPool.testProxy(proxy));
    } catch (err) {
      results.push({ ok: false, proxy, error: err.message || String(err) });
    }
  }
  const ok = results.find((r) => r.ok);
  if (!ok) return res.status(400).json({ error: 'Ningún proxy respondió', results });
  res.json({ ok: true, ip: ok.ip, proxy: ok.proxy, results });
});

router.post('/test-tmdb', auth, adminOnly, async (req, res) => {
  const key = getTmdbApiKey();
  if (!key) return res.status(400).json({ error: 'No hay API Key de TMDB configurada' });
  try {
    const poster = await fetchTmdbMoviePoster('Superman', 2025);
    if (poster) return res.json({ ok: true, message: 'Conexión TMDB correcta', sample_poster: poster });
    res.json({ ok: true, message: 'Key válida pero sin resultado de prueba' });
  } catch (err) {
    res.status(400).json({ error: 'Key inválida o error TMDB: ' + err.message });
  }
});

router.post('/refresh-all-posters', auth, adminOnly, async (req, res) => {
  try {
    const { refreshAllVodFromTmdb } = require('../services/tmdbMetadata');
    const movies = db.prepare('SELECT id FROM movies').all();
    const series = db.prepare('SELECT id FROM series').all();
    const result = await refreshAllVodFromTmdb();
    res.json({
      updated: result.updated,
      movies: movies.length,
      series: series.length,
      errors: result.errors
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/refresh-trailers', auth, adminOnly, async (req, res) => {
  try {
    const { refreshAllTrailersFromTmdb } = require('../services/tmdbMetadata');
    const movies = db.prepare("SELECT COUNT(*) c FROM movies WHERE trailer IS NULL OR trailer = ''").get().c;
    const series = db.prepare("SELECT COUNT(*) c FROM series WHERE trailer IS NULL OR trailer = ''").get().c;
    const result = await refreshAllTrailersFromTmdb();
    res.json({
      updated: result.updated,
      pending_movies: movies,
      pending_series: series,
      errors: result.errors
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
