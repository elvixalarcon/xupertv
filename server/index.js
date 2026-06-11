const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { seedCategories } = require('./services/categories');
const { ensureLiveCatalogChannels } = require('./services/tvPorInternet');
const { ensureEcdfVertvSource } = require('./services/vertvCable');
const { ensureEcdfM3utsSource } = require('./services/m3utsSync');
seedCategories();

setImmediate(() => {
  ensureEcdfM3utsSource()
    .then((row) => {
      if (row.ok) {
        console.log('[live-catalog] ECDF M3UTS:', row.stream_name || row.channel_id, row.streamUrl ? 'url ok' : 'pendiente reproducción');
      }
    })
    .catch((err) => console.warn('[live-catalog] ECDF M3UTS:', err.message || err));

  ensureEcdfVertvSource()
    .then((row) => {
      if (row.ok && !row.skipped) {
        console.log('[live-catalog] ECDF VerTvCable:', row.name || row.channel_id, row.streamUrl ? 'ok' : 'pendiente');
      }
    })
    .catch((err) => console.warn('[live-catalog] ECDF VerTvCable:', err.message || err));

  ensureLiveCatalogChannels(['El Canal del Fútbol', 'ECDF'])
    .then((rows) => {
      const ok = rows.filter((r) => r.ok);
      if (ok.length) console.log('[live-catalog] Deportes/ECDF:', ok.map((r) => r.name).join(', '));
    })
    .catch((err) => console.warn('[live-catalog] ECDF:', err.message || err));
});

const authRoutes = require('./routes/auth');
const movieRoutes = require('./routes/movies');
const seriesRoutes = require('./routes/series');
const liveRoutes = require('./routes/live');
const adminRoutes = require('./routes/admin');
const posterRoutes = require('./routes/posters');
const settingsRoutes = require('./routes/settings');
const categoryRoutes = require('./routes/categories');
const watchRoutes = require('./routes/watch');
const activityRoutes = require('./routes/activity');
const libraryRoutes = require('./routes/library');
const profileRoutes = require('./routes/profiles');
const catalogRoutes = require('./routes/catalog');
const searchRoutes = require('./routes/search');
const notificationRoutes = require('./routes/notifications');
const appRoutes = require('./routes/app');
const streamMonitor = require('./services/streamMonitor');
const streamCache = require('./services/streamCache');
const epgService = require('./services/epgService');
const fastChannelsSync = require('./services/fastChannelsSync');
const tvPorInternetSync = require('./services/tvPorInternetSync');
const tcTelevisionSync = require('./services/tcTelevisionSync');
const vixSync = require('./services/vixSync');
const gamavisionSync = require('./services/gamavisionSync');
const vodNightlySync = require('./services/vodNightlySync');

const app = express();
const PORT = process.env.PORT || 80;
const PORT2 = process.env.PORT2 || 8080;
const DATA = path.join(__dirname, '..', 'data');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/uploads/movies', express.static(path.join(DATA, 'movies'), {
  setHeaders(res, filePath) {
    if (/\.(mp4|webm|mov|mkv)$/i.test(filePath)) {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (/\.mkv$/i.test(filePath)) res.setHeader('Content-Type', 'video/x-matroska');
    }
  }
}));
app.use('/uploads/posters', express.static(path.join(DATA, 'posters')));
app.use('/uploads/logos', express.static(path.join(DATA, 'logos')));
app.use('/uploads/series', express.static(path.join(DATA, 'series'), {
  setHeaders(res, filePath) {
    if (/\.(mp4|webm|mov)$/i.test(filePath)) {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));
app.use('/uploads/apk', express.static(path.join(DATA, 'apk'), {
  setHeaders(res, filePath) {
    if (/\.apk$/i.test(filePath)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
}));
app.use('/uploads/winscp', express.static(path.join(DATA, 'winscp'), {
  setHeaders(res, filePath) {
    if (/\.(mp4|webm|mov|mkv|avi)$/i.test(filePath)) {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

app.use('/cache/live/:channelId', (req, res, next) => {
  const channelId = req.params.channelId;
  const dir = streamCache.channelCacheDir(channelId);
  express.static(dir, {
    setHeaders(r, filePath) {
      r.setHeader('Access-Control-Allow-Origin', '*');
      if (/\.m3u8$/i.test(filePath)) r.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      if (/\.ts$/i.test(filePath)) r.setHeader('Content-Type', 'video/mp2t');
    }
  })(req, res, next);
});

app.use('/api/auth', authRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/series', seriesRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/posters', posterRoutes);
app.use('/api/admin/settings', settingsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/watch', watchRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/app', appRoutes);

function sendPublicApk(res, filename) {
  const full = path.join(DATA, 'apk', filename);
  if (!fs.existsSync(full)) {
    return res.status(404).send('APK no disponible. Contacta al administrador.');
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(full);
}

function sendPublicIpa(res, filename) {
  const full = path.join(DATA, 'ipa', filename);
  if (!fs.existsSync(full)) {
    return res.status(404).send('IPA no disponible todavía. Usa la PWA en /descargar#iphone o compila con GitHub Actions.');
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(full);
}

app.get('/apk/tv', (req, res) => sendPublicApk(res, 'VixTV-tv.apk'));
app.get('/apk/mobile', (req, res) => sendPublicApk(res, 'VixTV-mobile.apk'));
app.get('/ipa/ios', (req, res) => sendPublicIpa(res, 'VixTV.ipa'));
app.get('/d/tv', (req, res) => res.redirect(302, '/apk/tv'));
app.get('/d/m', (req, res) => res.redirect(302, '/apk/mobile'));
app.get('/d/ipa', (req, res) => res.redirect(302, '/ipa/ios'));
app.get('/d/ios', (req, res) => res.redirect(302, '/descargar#iphone'));
app.get('/iphone', (req, res) => res.redirect(302, '/descargar#iphone'));
app.get('/ios', (req, res) => res.redirect(302, '/descargar#iphone'));
app.get('/tv', (req, res) => res.redirect(302, '/apk/tv'));
app.get('/descargar', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'descargar.html'));
});

app.get('/api/stats', (req, res) => {
  res.json({
    movies: db.prepare('SELECT COUNT(*) as c FROM movies').get().c,
    series: db.prepare('SELECT COUNT(*) as c FROM series').get().c,
    channels: db.prepare('SELECT COUNT(*) as c FROM live_channels').get().c,
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c
  });
});

app.get('/api/stream/duration', async (req, res) => {
  const rel = String(req.query.path || '').replace(/^(\.\.\/|\/)+/, '');
  const fullPath = path.join(DATA, rel);
  if (!fullPath.startsWith(DATA) || !fs.existsSync(fullPath)) {
    return res.json({ duration: 0 });
  }
  const { probeMediaDuration } = require('./routes/live');
  const duration = await probeMediaDuration(fullPath);
  res.json({ duration: duration || 0 });
});

app.get('/api/stream/*', (req, res) => {
  const filePath = req.params[0];
  const publicPath = `/uploads/${filePath}`;
  const { resolvePlayablePath, absFromPublic } = require('./services/playablePath');
  const resolved = resolvePlayablePath(publicPath);
  let fullPath = absFromPublic(resolved);
  if (!fullPath.startsWith(DATA) || !fs.existsSync(fullPath)) {
    return res.status(404).end();
  }
  let ext = path.extname(fullPath).toLowerCase();
  if (ext === '.mkv') {
    const { remuxLocalFile } = require('./routes/live');
    return remuxLocalFile(fullPath, res, req);
  }
  if (/\.(avi|wmv|flv)$/.test(ext)) {
    const { transcodeLocalFile } = require('./routes/live');
    return transcodeLocalFile(fullPath, res, req);
  }
  const stat = fs.statSync(fullPath);
  const types = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime' };
  const contentType = types[ext] || 'video/mp4';
  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (start >= stat.size) return res.status(416).end();
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
      'Content-Type': contentType
    });
    fs.createReadStream(fullPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType
    });
    fs.createReadStream(fullPath).pipe(res);
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Vix TV corriendo en http://0.0.0.0:${PORT}`);
  console.log('Admin: admin / admin123');
  streamMonitor.startMonitor();
  try {
    const db = require('./db');
    const relayCount = db.prepare('SELECT COUNT(*) as c FROM live_channels WHERE cache_enabled = 1').get().c;
    const BOOT_RELAY_LIMIT = 25;
    if (relayCount > 0 && relayCount <= BOOT_RELAY_LIMIT) {
      streamCache.startAllEnabledCaches({ batchSize: 3, delayMs: 2000 })
        .catch((e) => console.warn('[relay] auto-start:', e.message));
    } else if (relayCount > BOOT_RELAY_LIMIT) {
      console.log(`[relay] ${relayCount} canales con restream; arranque bajo demanda (límite arranque ${BOOT_RELAY_LIMIT})`);
    }
  } catch (e) {
    console.warn('[cache] auto-start:', e.message);
  }
  epgService.startEpgScheduler();
  fastChannelsSync.startFastChannelsScheduler();
  tvPorInternetSync.startTvPorInternetScheduler();
  tcTelevisionSync.startTcTelevisionScheduler();
  vixSync.startVixScheduler();
  gamavisionSync.startGamavisionScheduler();
  vodNightlySync.startVodNightlyScheduler();
  require('./services/platformSync').startPlatformSyncScheduler();
  require('./services/bannerArt').startBannerWarmScheduler();
  try {
    const { execSync } = require('child_process');
    const ver = execSync('yt-dlp --version 2>/dev/null', { encoding: 'utf8' }).trim();
    console.log(`[vod] yt-dlp ${ver} listo para descargas`);
  } catch {
    console.warn('[vod] yt-dlp no encontrado — instala con: apk add yt-dlp (o reconstruye la imagen Docker)');
  }
  require('./services/vodStuckWatch').startVodStuckWatch();
  require('./services/vodFinalizeWatch').startVodFinalizeWatch();
  require('./services/vodPendingQueue').startVodPendingQueue();
  try {
    const db = require('./db');
    const { clearPrepJob } = require('./services/vodDownloadProgress');
    for (const m of db.prepare('SELECT id FROM movies WHERE COALESCE(available, 1) = 1').all()) {
      clearPrepJob(m.id);
    }
  } catch { /* ignore */ }
});

if (PORT2 && PORT2 != PORT) {
  app.listen(PORT2, '0.0.0.0', () => {
    console.log(`Vix TV también en http://0.0.0.0:${PORT2}`);
  });
}
