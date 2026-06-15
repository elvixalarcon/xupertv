const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { seedCategories } = require('./services/categories');
const { ensureEcdfVertvSource } = require('./services/vertvCable');
const { ensureEcdfM3utsSource } = require('./services/m3utsSync');
seedCategories();

setImmediate(() => {
  try {
    const changed = appUpdate.syncPublishedVersions();
    const iosChanged = ipaUpdate.syncPublishedVersions();
    const all = [...changed, ...iosChanged];
    if (all.length) console.log('[ota] versiones sincronizadas:', all.join(', '));
  } catch (err) {
    console.warn('[ota] sync:', err.message || err);
  }

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
const v1Routes = require('./routes/v1');
const streamMonitor = require('./services/streamMonitor');
const streamCache = require('./services/streamCache');
const epgService = require('./services/epgService');
const appUpdate = require('./services/appUpdate');
const ipaUpdate = require('./services/ipaUpdate');
const fastChannelsSync = require('./services/fastChannelsSync');
const countryChannelsSync = require('./services/countryChannelsSync');
const tvPorInternetSync = require('./services/tvPorInternetSync');
const tcTelevisionSync = require('./services/tcTelevisionSync');
const vixSync = require('./services/vixSync');
const gamavisionSync = require('./services/gamavisionSync');
const { mountObsHlsPassthrough } = require('./services/obsHlsPassthrough');
const app = express();
const PORT = process.env.PORT || 80;
const PORT2 = process.env.PORT2 || 8080;
const DATA = path.join(__dirname, '..', 'data');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

mountObsHlsPassthrough(app);

function isFakeMp4Container(fullPath) {
  try {
    const buf = Buffer.alloc(12);
    const fd = fs.openSync(fullPath, 'r');
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    return buf.slice(4, 8).toString() !== 'ftyp';
  } catch {
    return false;
  }
}

function redirectFakeMp4ToStream(subdir) {
  return (req, res, next) => {
    if (!/\.mp4$/i.test(req.path)) return next();
    const name = path.basename(req.path);
    const full = path.join(DATA, subdir, name);
    if (!fs.existsSync(full) || !isFakeMp4Container(full)) return next();
    return res.redirect(302, `/api/stream/${subdir}/${encodeURIComponent(name)}`);
  };
}

app.use('/uploads/movies', redirectFakeMp4ToStream('movies'));
app.use('/uploads/series', redirectFakeMp4ToStream('series'));
app.use('/uploads/winscp', redirectFakeMp4ToStream('winscp'));

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
app.use('/uploads/desktop', express.static(path.join(DATA, 'desktop'), {
  setHeaders(res, filePath) {
    if (/\.exe$/i.test(filePath)) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
}));
app.use('/uploads/rtmp-broadcast', express.static(path.join(DATA, 'rtmp-broadcast'), {
  setHeaders(res, filePath) {
    if (/\.(mp4|webm|mov|mkv|avi)$/i.test(filePath)) {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, max-age=3600');
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

const liveCacheStaticHandlers = new Map();

function liveCacheStaticFor(channelId) {
  if (!liveCacheStaticHandlers.has(channelId)) {
    const dir = streamCache.channelCacheDir(channelId);
    liveCacheStaticHandlers.set(channelId, express.static(dir, {
      setHeaders(r, filePath) {
        r.setHeader('Access-Control-Allow-Origin', '*');
        if (/\.m3u8$/i.test(filePath)) r.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        if (/\.ts$/i.test(filePath)) r.setHeader('Content-Type', 'video/mp2t');
      }
    }));
  }
  return liveCacheStaticHandlers.get(channelId);
}

app.use('/cache/live/:channelId', (req, res, next) => {
  const channelId = parseInt(req.params.channelId, 10);
  if (Number.isFinite(channelId) && channelId > 0 && /\.m3u8(\?|$)/i.test(req.url)) {
    try {
      const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
      if (ch && streamCache.relayActiveForChannel(ch)) {
        streamCache.ensureRelayRunning(ch).catch(() => {});
      }
    } catch { /* serve static anyway */ }
  }
  if (!Number.isFinite(channelId) || channelId <= 0) return next();
  return liveCacheStaticFor(channelId)(req, res, next);
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
app.use('/api/worldcup', require('./routes/worldcup'));
app.use('/api/v1', v1Routes);
app.use('/api/trailers', require('./routes/trailers'));

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

const ipaInstall = require('./services/ipaInstall');

function requestBaseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`;
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

function sendPublicDesktopSetup(res) {
  const desktopInstall = require('./services/desktopInstall');
  const found = desktopInstall.findDesktopDownload();
  if (!found) {
    return res.status(404).send('Instalador Windows no disponible todavía. Compila con GitHub Actions o contacta al administrador.');
  }
  const isZip = /\.zip$/i.test(found.file);
  res.setHeader('Content-Type', isZip ? 'application/zip' : 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${found.file}"`);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(found.full);
}

app.get('/apk/tv', (req, res) => sendPublicApk(res, 'VixTV-tv.apk'));
app.get('/apk/mobile', (req, res) => sendPublicApk(res, 'VixTV-mobile.apk'));
app.get('/desktop/setup', (req, res) => sendPublicDesktopSetup(res));
app.get('/ipa/ios', (req, res) => sendPublicIpa(res, ipaInstall.IPA_FILE));
app.get('/ipa/manifest.plist', (req, res) => {
  const info = ipaInstall.getIpaInfo();
  if (!info.available) {
    return res.status(404).send('IPA no disponible');
  }
  const base = requestBaseUrl(req).replace(/\/$/, '');
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.send(ipaInstall.buildManifestPlist(base));
});
app.get('/ipa/install', (req, res) => {
  const info = ipaInstall.getIpaInfo();
  if (!info.available) {
    return res.redirect(302, '/descargar#iphone');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'ipa-install.html'));
});
app.get('/d/tv', (req, res) => res.redirect(302, '/apk/tv'));
app.get('/d/m', (req, res) => res.redirect(302, '/apk/mobile'));
app.get('/d/win', (req, res) => res.redirect(302, '/desktop/setup'));
app.get('/d/windows', (req, res) => res.redirect(302, '/desktop/setup'));
app.get('/d/ipa', (req, res) => res.redirect(302, '/ipa/install'));
app.get('/d/ios', (req, res) => res.redirect(302, '/descargar#iphone'));
app.get('/iphone', (req, res) => res.redirect(302, '/descargar#iphone'));
app.get('/ios', (req, res) => res.redirect(302, '/descargar#iphone'));
app.get('/tv', (req, res) => res.redirect(302, '/apk/tv'));
app.get('/win', (req, res) => res.redirect(302, '/desktop/setup'));
app.get('/windows', (req, res) => res.redirect(302, '/descargar#windows'));
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

app.get('/api/stream/*', async (req, res) => {
  const { markUploadStreamActivity } = require('./services/streamActivity');
  markUploadStreamActivity(req);
  const filePath = req.params[0];
  const publicPath = `/uploads/${filePath}`;
  const { resolvePlayablePath, absFromPublic } = require('./services/playablePath');
  const resolved = resolvePlayablePath(publicPath);
  let fullPath = absFromPublic(resolved);
  if (!fullPath.startsWith(DATA) || !fs.existsSync(fullPath)) {
    return res.status(404).end();
  }
  const ext = path.extname(fullPath).toLowerCase();
  const { remuxLocalFile, transcodeLocalFile, probeContainerFormat } = require('./routes/live');
  if (ext === '.mkv') {
    return remuxLocalFile(fullPath, res, req);
  }
  if (/\.(avi|wmv|flv)$/.test(ext)) {
    return transcodeLocalFile(fullPath, res, req);
  }
  if (ext === '.mp4' || ext === '.mov') {
    const fmt = await probeContainerFormat(fullPath);
    if (fmt.includes('mpegts') || fmt === 'mpeg-ts' || fmt === 'ts') {
      return remuxLocalFile(fullPath, res, req);
    }
  }
  const stat = fs.statSync(fullPath);
  const types = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime' };
  const contentType = types[ext] || 'video/mp4';
  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
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

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    if (/\.(html|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Vix TV corriendo en http://0.0.0.0:${PORT}`);
  console.log('Admin: admin / admin123');
  try {
    const pf = require('./services/platformFeatures');
    if (!pf.externalCatalog) {
      console.log('[platform] catálogos externos desactivados (cuevana, allcalidad, cinecalidad)');
    }
    if (!pf.countryChannels) {
      console.log('[platform] canales por país desactivados (sync IPTV/Teleame)');
    }
  } catch { /* ignore */ }
  streamMonitor.startMonitor();
  require('./services/sportsStreamWatch').startSportsStreamWatch();
  try {
    const db = require('./db');
    const relayCount = db.prepare('SELECT COUNT(*) as c FROM live_channels WHERE cache_enabled = 1').get().c;
    console.log(`[relay] ${relayCount} canales con restream; arranque bajo demanda al reproducir`);
  } catch (e) {
    console.warn('[cache] auto-start:', e.message);
  }
  setTimeout(() => {
    require('./services/rtmpPush').startAllAutoPushes().catch((e) => {
      console.warn('[rtmp] auto-start:', e.message);
    });
  }, 15000);
  epgService.startEpgScheduler();
  fastChannelsSync.startFastChannelsScheduler();
  countryChannelsSync.startCountryChannelsScheduler();
  try {
    const xuiSync = require('./services/xuiSync');
    xuiSync.ensureVixredObsDirectChannels();
    const r = xuiSync.ensureVixredDeportesChannel();
    if (r.created) console.log(`[live] Copia VixredTv en Deportes (#${r.id})`);
  } catch (e) {
    console.warn('[live] VixredTv:', e.message);
  }
  tvPorInternetSync.startTvPorInternetScheduler();
  tcTelevisionSync.startTcTelevisionScheduler();
  vixSync.startVixScheduler();
  gamavisionSync.startGamavisionScheduler();
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
server.keepAliveTimeout = 5000;
server.headersTimeout = 10000;
if (typeof server.requestTimeout === 'number') server.requestTimeout = 30000;
server.on('connection', (socket) => {
  socket.setTimeout(120000);
  socket.on('timeout', () => socket.destroy());
});

if (PORT2 && PORT2 != PORT) {
  app.listen(PORT2, '0.0.0.0', () => {
    console.log(`Vix TV también en http://0.0.0.0:${PORT2}`);
  });
}
