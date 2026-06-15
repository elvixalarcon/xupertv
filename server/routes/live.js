const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { auth, adminOnly, requireAccess, JWT_SECRET } = require('../middleware/auth');
const { posterCoverUrl } = require('../services/posters');
const { ensureCategory, listCategories } = require('../services/categories');
const { parseM3U, importLiveChannelsOnly } = require('../services/playlistImport');
const {
  configFromChannel,
  primarySourceUrl,
  serializeConfig,
  mergeConfig,
  parseConfig,
  withUserPinned,
  finalizeConfigForSave,
  isManualStreamChannel
} = require('../services/channelConfig');
const { scanSources } = require('../services/sourceScan');
const { scanAndFixAllChannels, scanAndFixChannel } = require('../services/channelSourceSync');
const rtmpPush = require('../services/rtmpPush');
const streamCache = require('../services/streamCache');
const liveProxy = require('../services/liveStreamProxy');
const { preferSpanishLatinoDramiyosUrl } = require('../services/spanishLatino');
const streamProxyPool = require('../services/streamProxyPool');
const epgService = require('../services/epgService');
const { touchActivityFromClaims, ensureSessionAllowed, maxConnectionsForUser } = require('../services/activity');

const router = express.Router();

const { COUNTRY_GROUP_NAMES, countryChannels: COUNTRY_CHANNELS_ENABLED } = require('../services/platformFeatures');

const GROUP_RADIO_ECUADOR = 'Radio Ecuador';
const { getCountryCategoryOrder } = require('../services/countryChannelsSync');
const LIVE_COUNTRY_ORDER = getCountryCategoryOrder();
const COUNTRY_GROUP_SET = new Set(COUNTRY_GROUP_NAMES);

function sortLiveCategoryNames(names) {
  const list = [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))]
    .filter((n) => !COUNTRY_GROUP_SET.has(n));
  const countrySet = new Set(LIVE_COUNTRY_ORDER);
  const countries = LIVE_COUNTRY_ORDER.filter((n) => list.includes(n));
  const rest = list
    .filter((n) => n !== GROUP_RADIO_ECUADOR && !countrySet.has(n))
    .sort((a, b) => a.localeCompare(b, 'es'));
  if (list.includes(GROUP_RADIO_ECUADOR)) rest.push(GROUP_RADIO_ECUADOR);
  return [...rest, ...countries];
}

function isRadioLiveChannel(ch) {
  const config = configFromChannel(ch);
  return !!config.radio || String(ch?.group_title || '').trim() === GROUP_RADIO_ECUADOR;
}

function buildRadioEventPlaylist(ch, req) {
  const config = configFromChannel(ch);
  const upstream = primarySourceUrl(config, ch.stream_url);
  if (!upstream || !/^https?:\/\//i.test(upstream)) return null;
  const hdrs = liveProxy.channelHeaders(ch);
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  const base = `${proto}://${host}`.replace(/\/$/, '');
  const tok = encodeURIComponent(String(req.query.token || ''));
  const sid = encodeURIComponent(liveSessionKey(req));
  const ref = encodeURIComponent(hdrs.Referer || '');
  let streamUrl = `${base}/api/live/stream?url=${encodeURIComponent(upstream)}&token=${tok}&sid=${sid}`;
  if (ref) streamUrl += `&referer=${ref}`;
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:86400',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:EVENT',
    '#EXTINF:86400.0,',
    streamUrl,
    ''
  ].join('\n');
}

function fetchUrl(url, binary = false) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const opts = {
      timeout: 30000,
      headers: { 'User-Agent': 'VixTV/1.0', 'Accept': '*/*' }
    };
    if (url.startsWith('https')) opts.rejectUnauthorized = false;
    const req = client.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchUrl(next, binary).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      if (binary) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), headers: res.headers }));
      } else {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }
    });
    req.on('error', reject);
  });
}

function pipeStream(url, res, reqHeaders = {}) {
  liveProxy.pipeUpstream(url, res, reqHeaders);
}

function needsTranscode(url) {
  return /\.(avi|mkv|wmv|flv)(\?|$)/i.test((url || '').split('?')[0]);
}

function probeMediaDuration(url) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1'
    ];
    if (url.startsWith('https://')) {
      args.unshift(
        '-tls_verify', '0',
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        '-headers', 'Referer: https://tv.vixred.com/\r\n'
      );
    }
    args.push(url);

    const ff = spawn('ffprobe', args);
    let out = '';
    ff.stdout.on('data', (c) => { out += c; });
    ff.on('close', () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
    });
    ff.on('error', () => resolve(0));
  });
}

function setStreamCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, X-Video-Duration, Accept-Ranges');
}

async function pipeTranscode(url, res, req) {
  setStreamCorsHeaders(res);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');

  const duration = await probeMediaDuration(url);
  if (duration) res.setHeader('X-Video-Duration', String(duration));

  res.status(200);

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    '-headers', 'Referer: https://tv.vixred.com/\r\n',
    '-tls_verify', '0',
    '-i', url,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  ];

  const ffmpeg = spawn('ffmpeg', args);
  ffmpeg.stdout.pipe(res);
  ffmpeg.on('error', () => { if (!res.writableEnded) res.status(502).end(); });
  ffmpeg.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) res.end();
  });
  req.on('close', () => ffmpeg.kill('SIGTERM'));
}

function probeContainerFormat(filePath) {
  return new Promise((resolve) => {
    const ff = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=format_name',
      '-of', 'csv=p=0',
      filePath
    ]);
    let out = '';
    ff.stdout.on('data', (c) => { out += c; });
    ff.on('close', () => resolve(String(out).trim().toLowerCase()));
    ff.on('error', () => resolve(''));
  });
}

function probeCodecs(filePath) {
  return new Promise((resolve) => {
    const ff = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name',
      '-of', 'json',
      filePath
    ]);
    let out = '';
    ff.stdout.on('data', (c) => { out += c; });
    ff.on('close', () => {
      try {
        const streams = JSON.parse(out).streams || [];
        const video = streams.find((s) => s.codec_type === 'video')?.codec_name || '';
        const audio = streams.find((s) => s.codec_type === 'audio')?.codec_name || '';
        resolve({ video: String(video).toLowerCase(), audio: String(audio).toLowerCase() });
      } catch {
        resolve({ video: '', audio: '' });
      }
    });
    ff.on('error', () => resolve({ video: '', audio: '' }));
  });
}

function pickLocalStreamMode(codecs, forceTranscode) {
  if (forceTranscode) return 'transcode';
  const v = codecs.video || '';
  const a = codecs.audio || '';
  const h264 = v === 'h264' || v.startsWith('avc');
  if (!h264) return 'transcode';
  if (!a || a === 'aac' || a === 'mp3') return 'copy';
  return 'audio';
}

function spawnFfmpegMp4(args, res, req) {
  const ffmpeg = spawn('ffmpeg', args);
  ffmpeg.stdout.pipe(res);
  ffmpeg.on('error', () => {
    if (!res.writableEnded) res.status(502).end();
  });
  ffmpeg.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) res.end();
  });
  req.on('close', () => ffmpeg.kill('SIGTERM'));
  return ffmpeg;
}

async function transcodeLocalFile(filePath, res, req) {
  setStreamCorsHeaders(res);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');

  const duration = await probeMediaDuration(filePath);
  if (duration) res.setHeader('X-Video-Duration', String(duration));

  const startSec = Math.max(0, parseFloat(String(req.query.t || req.query.start || '0')) || 0);

  res.status(200);

  const args = ['-hide_banner', '-loglevel', 'error'];
  if (startSec > 0) args.push('-ss', String(startSec));
  args.push(
    '-i', filePath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  );

  spawnFfmpegMp4(args, res, req);
}

/** MKV / MPEG-TS → MP4 fragmentado; recurre a transcodificar si el códec no es compatible. */
async function remuxLocalFile(filePath, res, req) {
  const forceTranscode = req.query.transcode === '1' || req.query.force_transcode === '1';
  const startSec = Math.max(0, parseFloat(String(req.query.t || req.query.start || '0')) || 0);
  const container = await probeContainerFormat(filePath);
  const isMpegTs = container.includes('mpegts') || container === 'mpeg-ts' || container === 'ts';
  const codecs = await probeCodecs(filePath);
  const mode = forceTranscode ? 'transcode' : (isMpegTs ? 'mpegts' : pickLocalStreamMode(codecs, false));

  if (mode === 'transcode') {
    return transcodeLocalFile(filePath, res, req);
  }

  setStreamCorsHeaders(res);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');

  const duration = await probeMediaDuration(filePath);
  if (duration) res.setHeader('X-Video-Duration', String(duration));
  res.status(200);

  const args = ['-hide_banner', '-loglevel', 'error'];
  if (startSec > 0) args.push('-ss', String(startSec));
  args.push('-i', filePath);
  if (mode === 'mpegts') {
    args.push('-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc');
  } else if (mode === 'copy') {
    args.push('-c', 'copy');
  } else {
    args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  }
  args.push(
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  );

  const ffmpeg = spawn('ffmpeg', args);
  let bytesOut = 0;
  let failedEarly = false;
  ffmpeg.stdout.on('data', (chunk) => {
    bytesOut += chunk.length;
    if (!res.writableEnded) res.write(chunk);
  });
  ffmpeg.stdout.on('end', () => {
    if (!res.writableEnded) res.end();
  });
  ffmpeg.on('error', () => {
    failedEarly = true;
    if (!res.writableEnded && !res.headersSent) {
      return transcodeLocalFile(filePath, res, req);
    }
    if (!res.writableEnded) res.end();
  });
  ffmpeg.on('close', (code) => {
    if ((code !== 0 || bytesOut < 4096) && !failedEarly) {
      if (!res.headersSent) return transcodeLocalFile(filePath, res, req);
    }
    if (!res.writableEnded) res.end();
  });
  req.on('close', () => ffmpeg.kill('SIGTERM'));
}

router.transcodeLocalFile = transcodeLocalFile;
router.remuxLocalFile = remuxLocalFile;
router.probeMediaDuration = probeMediaDuration;
router.probeContainerFormat = probeContainerFormat;
router.needsTranscode = needsTranscode;

function resolveUrl(base, relative) {
  const { resolveUrl: ru } = require('../services/playlistImport');
  return ru(base, relative);
}

function decodeStreamToken(req) {
  const raw = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!raw) return null;
  try {
    return jwt.verify(raw, JWT_SECRET);
  } catch {
    return null;
  }
}

function verifyStreamToken(req) {
  return !!decodeStreamToken(req);
}

function liveSessionKey(req) {
  return req.query.sid ? String(req.query.sid).slice(0, 64) : 'live';
}

function markLiveStreamActivity(req, channel) {
  const claims = decodeStreamToken(req);
  if (!claims || !channel) return false;
  const sessionKey = liveSessionKey(req);
  const ok = touchActivityFromClaims(claims, {
    status: 'watching_live',
    page: 'live',
    title: channel.name || 'Canal en vivo',
    contentType: 'live',
    contentId: channel.id
  }, sessionKey);
  if (ok && streamCache.relayActiveForChannel(channel)) {
    streamCache.ensureRelayRunning(channel).catch(() => {});
  }
  return ok;
}

function rejectConnectionLimit(res, userId) {
  const max = maxConnectionsForUser(userId);
  return res.status(429).json({
    error: `Límite de conexiones alcanzado (máx. ${max})`,
    max_connections: max
  });
}

function rewriteM3u8(content, baseUrl, token, hdrs = {}) {
  return liveProxy.rewriteM3u8(content, baseUrl, token, hdrs);
}

function streamFetchHeaders(req) {
  const ua = req.query.ua ? decodeURIComponent(String(req.query.ua)) : '';
  const referer = req.query.referer ? decodeURIComponent(String(req.query.referer)) : '';
  const origin = req.query.origin ? decodeURIComponent(String(req.query.origin)) : '';
  const cookie = req.query.cookie ? decodeURIComponent(String(req.query.cookie)) : '';
  const url = req.query.url ? decodeURIComponent(String(req.query.url)) : '';
  const px = req.query.px ? decodeURIComponent(String(req.query.px)) : '';
  const extra = {};
  if (referer) extra.Referer = referer;
  if (ua) extra['User-Agent'] = ua;
  if (cookie) extra.Cookie = cookie;
  if (/googlevideo\.com|youtube\.com|youtu\.be/i.test(url)) {
    if (!extra.Referer) extra.Referer = 'https://www.youtube.com/';
    extra.Origin = origin || 'https://www.youtube.com';
  } else if (origin) {
    extra.Origin = origin;
  }
  if (/dmcdn\.net|dailymotion\.com/i.test(url)) extra.Origin = 'https://tctelevision.com';
  if (/esradioecuador\.com/i.test(url) && !referer) extra.Referer = 'https://www.gamavision.com.ec/';
  if (/esradioecuador\.com/i.test(url)) extra.Origin = 'https://www.gamavision.com.ec';
  if (/ksdjugfsddeports\.com/i.test(url)) {
    if (!extra.Referer) extra.Referer = 'https://deportes.ksdjugfsddeports.com/tvporinternet.php?stream=11_';
    if (!extra.Origin) extra.Origin = 'https://deportes.ksdjugfsddeports.com';
  } else if (/saohgdasregions\.fun/i.test(url) && !extra.Origin) {
    extra.Origin = streamProxyPool.streamOriginFor(url) || 'https://regionales.saohgdasregions.fun';
  }
  if (px && streamProxyPool.needsStreamProxy(url)) extra._proxy = px;
  return liveProxy.defaultHeaders(extra);
}

function isHlsManifestUrl(url) {
  return liveProxy.isHlsManifestUrl(url);
}

router.post('/tc/publish-stream', auth, requireAccess('live'), async (req, res) => {
  try {
    const tcTelevisionSync = require('../services/tcTelevisionSync');
    const channelId = parseInt(req.body.channel_id, 10);
    const streamUrl = String(req.body.stream_url || '').trim();
    if (!channelId || !streamUrl) {
      return res.status(400).json({ error: 'channel_id y stream_url requeridos' });
    }
    const channel = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
    if (!channel || !tcTelevisionSync.isTcTelevisionChannel(channel)) {
      return res.status(400).json({ error: 'Canal TC inválido' });
    }
    const result = await tcTelevisionSync.publishClientResolvedStream(channelId, streamUrl, {
      video_id: req.body.video_id
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/vix/refresh', auth, requireAccess('live'), async (req, res) => {
  try {
    const vixSync = require('../services/vixSync');
    const channelId = parseInt(req.body.channel_id, 10);
    const channel = channelId
      ? db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId)
      : vixSync.listVixChannels()[0];
    if (!channel || !vixSync.isVixChannel(channel)) {
      return res.status(404).json({ error: 'Canal ViX no encontrado' });
    }

    const result = await vixSync.refreshVixChannel(channel, { force: true });
    const fresh = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channel.id);

    res.json({
      ok: true,
      channel_id: fresh.id,
      name: fresh.name,
      stream_url: fresh.stream_url,
      playback_url: result.url,
      samsung_id: result.samsung_id,
      stream_source: result.stream_source
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'No se pudo renovar señal ViX' });
  }
});

router.post('/tc/refresh', auth, requireAccess('live'), async (req, res) => {
  try {
    const tcTelevisionSync = require('../services/tcTelevisionSync');
    const channelId = parseInt(req.body.channel_id, 10);
    const channel = channelId
      ? db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId)
      : tcTelevisionSync.listTcChannels()[0];
    if (!channel || !tcTelevisionSync.isTcTelevisionChannel(channel)) {
      return res.status(404).json({ error: 'Canal TC no encontrado' });
    }

    const resolved = await tcTelevisionSync.resolveTcStreamUrl({
      videoId: configFromChannel(channel).tctelevision?.video_id
    });
    await tcTelevisionSync.refreshTcChannel(channel, resolved);
    const fresh = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channel.id);

    res.json({
      ok: true,
      channel_id: fresh.id,
      name: fresh.name,
      stream_url: fresh.stream_url,
      variant: tcTelevisionSync.isVariantStreamUrl(fresh.stream_url),
      video_id: resolved.videoId,
      live_status: resolved.liveStatus
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'No se pudo renovar señal TC' });
  }
});

function isSportsLiveGroup(groupTitle) {
  const g = String(groupTitle || '').toLowerCase();
  return g.includes('deporte') || g.includes('sport');
}

router.post('/ch/:id/relay-heal', auth, requireAccess('live'), async (req, res) => {
  try {
    const ch = db.prepare('SELECT * FROM live_channels WHERE id = ? AND COALESCE(enabled, 1) = 1').get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });
    if (!streamCache.relayActiveForChannel(ch) && !isSportsLiveGroup(ch.group_title)) {
      return res.json({ ok: false, reason: 'no_relay' });
    }
    const sportsStreamWatch = require('../services/sportsStreamWatch');
    const result = await sportsStreamWatch.healSportsChannel(ch, 'cliente solicitó recuperación');
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al reparar relay' });
  }
});

router.get('/ch/:id/catchup.m3u8', async (req, res) => {
  const claims = decodeStreamToken(req);
  if (!claims) return res.status(401).end();
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ? AND COALESCE(enabled, 1) = 1').get(req.params.id);
  if (!ch) return res.status(404).end();
  if (!markLiveStreamActivity(req, ch)) return rejectConnectionLimit(res, claims.id);
  if (!streamCache.relayActiveForChannel(ch)) return res.status(404).end();
  try {
    await streamCache.ensureRelayRunning(ch);
  } catch { /* serve if playlist exists */ }
  const playlistPath = streamCache.getLocalPlaylistPath(ch.id);
  if (!playlistPath || !require('fs').existsSync(playlistPath)) return res.status(503).end();
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, max-age=2');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(require('fs').readFileSync(playlistPath, 'utf8'));
});

router.get('/ch/:id/play.m3u8', async (req, res) => {
  const claims = decodeStreamToken(req);
  if (!claims) return res.status(401).end();
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ? AND COALESCE(enabled, 1) = 1').get(req.params.id);
  if (!ch) return res.status(404).end();
  if (!markLiveStreamActivity(req, ch)) return rejectConnectionLimit(res, claims.id);

  const { isVixredObsHls, obsHlsPlaybackPath } = require('../services/channelConfig');
  if (isVixredObsHls(ch.stream_url)) {
    const hlsPath = obsHlsPlaybackPath(ch.stream_url);
    const tok = encodeURIComponent(String(req.query.token || ''));
    const sid = encodeURIComponent(liveSessionKey(req));
    const qs = `token=${tok}&sid=${sid}&ch=${ch.id}`;
    res.setHeader('Cache-Control', 'no-cache, max-age=1');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.redirect(302, `${hlsPath}?${qs}`);
  }

  if (streamCache.preferRelayPlayback(ch)) {
    try {
      await streamCache.ensureRelayRunning(ch);
    } catch { /* intentar servir playlist local */ }
    const playlistPath = streamCache.getLocalPlaylistPath(ch.id);
    if (playlistPath && fs.existsSync(playlistPath)) {
      res.setHeader('Cache-Control', 'no-cache, max-age=1');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.redirect(302, `/cache/live/${ch.id}/index.m3u8`);
    }
  }

  const preferLowest = req.query.profile === 'mobile';
  const tcTelevisionSync = require('../services/tcTelevisionSync');
  const vixSync = require('../services/vixSync');
  const ecuaplaySync = require('../services/ecuaplaySync');

  if (isRadioLiveChannel(ch)) {
    const config = configFromChannel(ch);
    const upstream = primarySourceUrl(config, ch.stream_url);
    if (upstream && !/\.m3u8(\?|$)/i.test(upstream)) {
      const playlist = buildRadioEventPlaylist(ch, req);
      if (playlist) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache, max-age=1');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.send(playlist);
      }
    }
  }

  async function sendPlaylist(channel) {
    const playlist = await liveProxy.buildChannelPlaylist(channel, req.query.token, { preferLowest });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, max-age=1');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(playlist);
  }

  try {
    await sendPlaylist(ch);
  } catch {
    if (vixSync.isVixChannel(ch)) {
      try {
        await vixSync.refreshVixChannel(ch, { force: true });
        const fresh = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(ch.id);
        await sendPlaylist(fresh);
        return;
      } catch {
        return res.status(502).end();
      }
    }
    if (!isManualStreamChannel(ch) && (ecuaplaySync.isEcuaplayChannel(ch) || /fubo18\.com/i.test(ch.stream_url || ''))) {
      try {
        if (ecuaplaySync.isEcuaplayChannel(ch)) {
          await ecuaplaySync.refreshEcuaplayChannel(ch);
        } else {
          const playerFile = ecuaplaySync.getPlayerFile(ch);
          const playback = await ecuaplaySync.resolvePlayerStream(playerFile, ch.name);
          const cfg = configFromChannel(ch);
          cfg.ecuaplay = {
            player: `${ecuaplaySync.BASE}/${playerFile}`,
            stream: playback.slug || '',
            resolver: playback.resolver,
            updated_at: new Date().toISOString()
          };
          cfg.sources = [{
            url: playback.url,
            streamUrl: playback.url,
            referer: playback.referer,
            resolver: 'ecuaplay',
            playerUrl: cfg.ecuaplay.player,
            site: 'ecuaplay',
            canal: playback.slug || ''
          }];
          cfg.advanced = { ...cfg.advanced, referer: playback.referer };
          db.prepare('UPDATE live_channels SET stream_url = ?, config = ? WHERE id = ?')
            .run(playback.url, serializeConfig(cfg), ch.id);
        }
        const fresh = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(ch.id);
        await sendPlaylist(fresh);
        return;
      } catch {
        return res.status(502).end();
      }
    }
    if (!tcTelevisionSync.isTcTelevisionChannel(ch)) {
      return res.status(502).end();
    }
    try {
      const resolved = await tcTelevisionSync.resolveTcStreamUrl({
        videoId: configFromChannel(ch).tctelevision?.video_id
      });
      await tcTelevisionSync.refreshTcChannel(ch, resolved);
      const fresh = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(ch.id);
      await sendPlaylist(fresh);
    } catch {
      res.status(502).end();
    }
  }
});

function markVodStreamActivity(req, claims) {
  if (!claims?.id) return false;
  const sessionKey = req.query.sid ? String(req.query.sid).slice(0, 64) : 'stream';
  if (!ensureSessionAllowed(claims.id, sessionKey)) return false;
  const contentType = req.query.watch_type
    ? decodeURIComponent(String(req.query.watch_type))
    : 'movie';
  const status = req.query.watch_status
    ? decodeURIComponent(String(req.query.watch_status))
    : (contentType === 'episode' ? 'watching_episode' : 'watching_movie');
  const title = req.query.watch_title
    ? decodeURIComponent(String(req.query.watch_title))
    : 'Reproduciendo';
  const contentId = req.query.watch_id != null
    ? decodeURIComponent(String(req.query.watch_id))
    : null;
  return touchActivityFromClaims(claims, {
    status,
    page: 'player',
    title,
    contentType,
    contentId
  }, sessionKey);
}

router.get('/stream', (req, res) => {
  const url = req.query.url;
  const claims = decodeStreamToken(req);
  if (!url || !claims) {
    return res.status(401).end();
  }
  if (/\/live\/ch\/\d+\/play\.m3u8/i.test(url) || /\/cache\/live\/\d+\//i.test(url)) {
    const chId = url.match(/\/(?:live\/ch|cache\/live)\/(\d+)/i)?.[1];
    if (chId) {
      const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(chId);
      if (ch && !markLiveStreamActivity(req, ch)) {
        return rejectConnectionLimit(res, claims.id);
      }
    } else if (!touchActivityFromClaims(claims, {
      status: 'watching_live',
      page: 'live',
      title: 'Canal en vivo',
      contentType: 'live'
    }, liveSessionKey(req))) {
      return rejectConnectionLimit(res, claims.id);
    }
  }

  const decoded = preferSpanishLatinoDramiyosUrl(decodeURIComponent(url));
  if (!/^https?:\/\//i.test(decoded)) {
    return res.status(400).end();
  }

  const hdrs = streamFetchHeaders(req);
  const isManifest = isHlsManifestUrl(decoded);
  const isLiveChannel = /\/live\/ch\/\d+\/play\.m3u8/i.test(url) || /\/cache\/live\/\d+\//i.test(url);
  const { isVixredObsHls } = require('../services/channelConfig');
  const isObsHls = isVixredObsHls(decoded);

  if (isManifest && !isLiveChannel && !isObsHls) {
    if (!markVodStreamActivity(req, claims)) {
      return rejectConnectionLimit(res, claims.id);
    }
  }

  if (isManifest && isObsHls && !touchActivityFromClaims(claims, {
    status: 'watching_live',
    page: 'live',
    title: 'OBS en vivo',
    contentType: 'live'
  }, liveSessionKey(req))) {
    return rejectConnectionLimit(res, claims.id);
  }

  if (isManifest) {
    const preferLowest = req.query.profile === 'mobile';
    liveProxy.fetchManifestForProxy(decoded, hdrs).then((manifest) => {
      const rewritten = rewriteM3u8(manifest.content, manifest.base, req.query.token, hdrs, {
        mobile: preferLowest
      });
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, max-age=1');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(rewritten);
    }).catch(() => res.status(502).end());
  } else if (needsTranscode(decoded)) {
    pipeTranscode(decoded, res, req).catch(() => { if (!res.writableEnded) res.status(502).end(); });
  } else {
    const fwdHeaders = { ...hdrs };
    if (req.headers.range) fwdHeaders.Range = req.headers.range;
    pipeStream(decoded, res, fwdHeaders);
  }
});

router.get('/duration', auth, requireAccess('live'), async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'URL requerida' });
  const decoded = decodeURIComponent(url);
  if (!/^https?:\/\//i.test(decoded)) return res.status(400).json({ error: 'URL inválida' });
  const duration = await probeMediaDuration(decoded);
  res.json({ duration });
});

router.get('/playlists', auth, requireAccess('live'), (req, res) => {
  const playlists = db.prepare(`
    SELECT p.id, p.name, p.m3u_url, p.created_at,
      (SELECT COUNT(*) FROM live_channels c WHERE c.playlist_id = p.id) as channel_count
    FROM live_playlists p ORDER BY p.id DESC
  `).all();
  res.json(playlists);
});

router.get('/channels', auth, requireAccess('live'), (req, res) => {
  const { group, search, all } = req.query;
  let sql = `
    SELECT c.*, p.name as playlist_name FROM live_channels c
    JOIN live_playlists p ON c.playlist_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (req.user.role !== 'admin' || all !== '1') {
    sql += ' AND COALESCE(c.enabled, 1) = 1';
  }
  if (group && group !== 'all') { sql += ' AND c.group_title = ?'; params.push(group); }
  if (search) { sql += ' AND c.name LIKE ?'; params.push(`%${search}%`); }
  sql += ` ORDER BY
    CASE WHEN c.group_title = '${GROUP_RADIO_ECUADOR}' THEN 1 ELSE 0 END,
    c.group_title,
    CASE WHEN COALESCE(CAST(json_extract(c.config, '$.order') AS INTEGER), 0) < 1 THEN 999
         ELSE CAST(json_extract(c.config, '$.order') AS INTEGER) END,
    c.name`;
  const rows = db.prepare(sql).all(...params);
  const visibleRows = COUNTRY_CHANNELS_ENABLED
    ? rows
    : rows.filter((ch) => !COUNTRY_GROUP_SET.has(ch.group_title));
  const includeUpstream = req.user.role === 'admin' && all === '1';
  if (includeUpstream) {
    return res.json(visibleRows.map((ch) => streamCache.formatChannelForApi(ch, { includeUpstream: true })));
  }
  const { formatChannelLite } = require('../services/liveChannelsApi');
  const { filterLiveForProfile } = require('../services/parental');
  let lite = visibleRows.map(formatChannelLite);
  if (req.profile?.is_kids) lite = filterLiveForProfile(lite, req.profile);
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.json(lite);
});

router.get('/categories', auth, requireAccess('live'), (req, res) => {
  db.prepare("SELECT DISTINCT group_title as name FROM live_channels WHERE group_title != ''").all()
    .forEach(r => ensureCategory(r.name, 'live'));
  const rows = listCategories('live', { enabledOnly: true }).filter((c) => c.count > 0);
  const categories = sortLiveCategoryNames(rows.map((c) => c.name)).map((name) => {
    const row = rows.find((c) => c.name === name);
    return { id: row.id, name: row.name, count: row.count };
  });
  res.json(categories);
});

router.get('/epg', auth, requireAccess('live'), async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    const data = await epgService.getLiveEpgMap({ force });
    if (!force) res.setHeader('Cache-Control', 'private, max-age=120');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al cargar EPG' });
  }
});

router.post('/epg/refresh', auth, adminOnly, async (req, res) => {
  try {
    const data = await epgService.getLiveEpgMap({ force: true });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al actualizar EPG' });
  }
});

router.get('/groups', auth, requireAccess('live'), (req, res) => {
  const groups = db.prepare(`
    SELECT group_title as name, COUNT(*) as count
    FROM live_channels
    GROUP BY group_title
  `).all();
  res.json(sortLiveCategoryNames(groups.map((g) => g.name)));
});

router.put('/channels/reorder', auth, adminOnly, (req, res) => {
  const groupTitle = String(req.body?.group_title || '').trim();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => parseInt(id, 10)).filter((id) => id > 0) : [];
  if (!groupTitle || !ids.length) {
    return res.status(400).json({ error: 'group_title e ids son requeridos' });
  }

  const updateConfig = db.prepare('UPDATE live_channels SET config = ? WHERE id = ? AND group_title = ?');
  let updated = 0;
  const tx = db.transaction((channelIds) => {
    channelIds.forEach((id, index) => {
      const ch = db.prepare('SELECT config FROM live_channels WHERE id = ? AND group_title = ?').get(id, groupTitle);
      if (!ch) return;
      const config = configFromChannel(ch);
      config.order = index + 1;
      updateConfig.run(serializeConfig(config), id, groupTitle);
      updated += 1;
    });
  });
  tx(ids);
  res.json({ ok: true, group_title: groupTitle, updated });
});

router.get('/channels/:id', auth, adminOnly, (req, res) => {
  const ch = db.prepare(`
    SELECT c.*, p.name as playlist_name FROM live_channels c
    JOIN live_playlists p ON c.playlist_id = p.id WHERE c.id = ?
  `).get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });
  const config = configFromChannel(ch);
  const formatted = streamCache.formatChannelForApi(ch, { includeUpstream: true });
  res.json({
    ...formatted,
    config,
    primary_url: formatted.upstream_url || primarySourceUrl(config, ch.stream_url),
    rtmp_status: rtmpPush.getPushStatus(ch.id)
  });
});

router.get('/channels/:id/config', auth, adminOnly, (req, res) => {
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });
  res.json({
    channel: { id: ch.id, name: ch.name, logo: ch.logo, group_title: ch.group_title, enabled: ch.enabled ?? 1 },
    config: configFromChannel(ch),
    rtmp_status: rtmpPush.getPushStatus(ch.id)
  });
});

function saveChannelConfig(channelId, body) {
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
  if (!ch) return null;

  const prev = configFromChannel(ch);
  let config = mergeConfig(prev, body.config || body);
  const name = body.name ?? ch.name;
  const logo = body.logo ?? ch.logo;
  const group_title = body.group_title ?? ch.group_title;
  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : (ch.enabled ?? 1);

  if (body.enabled !== undefined) {
    config.advanced = { ...config.advanced, user_pinned: enabled === 1 };
  }
  config.advanced = { ...config.advanced, manual_url: true };

  const finalized = finalizeConfigForSave(config, {
    stream_url: body.stream_url ?? ch.stream_url,
    name,
    manual: true
  });
  config = finalized.config;
  const stream_url = finalized.stream_url;

  if (!name || !stream_url) {
    const err = new Error('Nombre y al menos una fuente URL son requeridos');
    err.status = 400;
    throw err;
  }

  db.prepare(`
    UPDATE live_channels
    SET name=?, stream_url=?, logo=?, group_title=?, config=?, enabled=?,
        cache_enabled = CASE WHEN ? IS NOT NULL THEN ? ELSE cache_enabled END
    WHERE id=?
  `).run(
    name,
    stream_url,
    logo,
    group_title,
    serializeConfig(config),
    enabled,
    finalized.cache_enabled,
    finalized.cache_enabled ?? ch.cache_enabled,
    channelId
  );

  ensureCategory(group_title, 'live');

  const updated = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
  const finalConfig = configFromChannel(updated);
  try {
    streamCache.syncRelayFromConfig(channelId, finalConfig);
  } catch (err) {
    finalConfig._relay_error = err.message;
  }
  if (finalized.cache_enabled) {
    streamCache.startCache(channelId).catch((err) => {
      console.warn(`[relay] inicio canal ${channelId}:`, err.message || err);
    });
  } else if (finalized.cache_enabled === 0) {
    streamCache.stopCache(channelId);
  }
  const refreshed = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
  return { channel: refreshed, config: configFromChannel(refreshed), relay_error: finalConfig._relay_error };
}

router.put('/channels/:id/config', auth, adminOnly, async (req, res) => {
  try {
    const saved = saveChannelConfig(req.params.id, req.body);
    if (!saved) return res.status(404).json({ error: 'Canal no encontrado' });
    if (saved.config.rtmp?.auto_start && saved.config.rtmp?.enabled) {
      try {
        await rtmpPush.startPush(saved.channel, saved.config);
      } catch (e) {
        saved.rtmp_error = e.message;
      }
    }
    res.json({
      ok: true,
      ...saved,
      rtmp_status: rtmpPush.getPushStatus(saved.channel.id)
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/sources/scan', auth, adminOnly, async (req, res) => {
  const sources = req.body.sources || [];
  const globalOpts = req.body.advanced || {};
  try {
    const results = await scanSources(sources, globalOpts);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels/:id/ecuaplay/refresh', auth, adminOnly, async (req, res) => {
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });
  try {
    const ecuaplaySync = require('../services/ecuaplaySync');
    const updated = await ecuaplaySync.activateFuboChannel(ch);
    let config = configFromChannel(updated);
    config.advanced = { ...config.advanced, manual_url: false };
    db.prepare('UPDATE live_channels SET config = ? WHERE id = ?').run(serializeConfig(config), ch.id);
    const fresh = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(ch.id);
    res.json({
      ok: true,
      channel_id: fresh.id,
      name: fresh.name,
      stream_url: fresh.stream_url
    });
  } catch (err) {
    res.status(502).json({ error: err.message || 'No se pudo renovar con ECUA•PLAY' });
  }
});

router.post('/channels/:id/sources/scan', auth, adminOnly, async (req, res) => {
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });
  try {
    const result = await scanAndFixChannel(ch, {
      disableBroken: req.body?.disableBroken === true,
      enabled: req.body?.enabled
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels/scan-all', auth, adminOnly, async (req, res) => {
  try {
    const result = await scanAndFixAllChannels({
      disableBroken: req.body?.disableBroken === true
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/channels/:id/rtmp/status', auth, adminOnly, (req, res) => {
  res.json(rtmpPush.getPushStatus(parseInt(req.params.id, 10)));
});

router.post('/channels/:id/rtmp/start', auth, adminOnly, async (req, res) => {
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });
  try {
    const config = req.body.config ? mergeConfig(configFromChannel(ch), req.body.config) : configFromChannel(ch);
    const result = await rtmpPush.startPush(ch, config);
    res.json({ ok: true, ...result, status: rtmpPush.getPushStatus(ch.id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/channels/:id/rtmp/stop', auth, adminOnly, (req, res) => {
  const r = rtmpPush.stopPush(parseInt(req.params.id, 10));
  res.json({ ok: true, ...r, status: rtmpPush.getPushStatus(parseInt(req.params.id, 10)) });
});

router.put('/channels/:id', auth, adminOnly, (req, res) => {
  if (req.body.config || req.body.sources) {
    try {
      const saved = saveChannelConfig(req.params.id, req.body);
      if (!saved) return res.status(404).json({ error: 'Canal no encontrado' });
      return res.json({ ok: true, ...saved });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message });
    }
  }
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });
  const { name, stream_url, logo, group_title, enabled } = req.body;
  let config = configFromChannel(ch);
  const finalized = finalizeConfigForSave(config, {
    stream_url: stream_url ?? ch.stream_url,
    name: name ?? ch.name
  });
  config = finalized.config;
  const nextUrl = finalized.stream_url;
  db.prepare(`
    UPDATE live_channels SET name=?, stream_url=?, logo=?, group_title=?, enabled=COALESCE(?, enabled), config=?, cache_enabled=? WHERE id=?
  `).run(
    name ?? ch.name,
    nextUrl,
    logo ?? ch.logo,
    group_title ?? ch.group_title,
    enabled !== undefined ? (enabled ? 1 : 0) : ch.enabled,
    serializeConfig(config),
    finalized.cache_enabled ? 1 : 0,
    ch.id
  );
  ensureCategory(group_title ?? ch.group_title, 'live');
  streamCache.syncRelayFromConfig(ch.id, config);
  if (finalized.cache_enabled) {
    streamCache.startCache(ch.id).catch((err) => {
      console.warn(`[relay] inicio canal ${ch.id}:`, err.message || err);
    });
  } else if (finalized.cache_enabled === 0) {
    streamCache.stopCache(ch.id);
  }
  res.json({ ok: true });
});

router.patch('/channels/:id', auth, adminOnly, (req, res) => {
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });
  if (req.body.enabled !== undefined) {
    const enabled = req.body.enabled ? 1 : 0;
    db.prepare('UPDATE live_channels SET enabled = ?, config = ? WHERE id = ?').run(
      enabled,
      withUserPinned(ch, enabled === 1),
      ch.id
    );
    return res.json({ ok: true, enabled });
  }
  const { name, stream_url, logo, group_title } = req.body;
  db.prepare(`
    UPDATE live_channels SET name=?, stream_url=?, logo=?, group_title=? WHERE id=?
  `).run(
    name ?? ch.name,
    stream_url ?? ch.stream_url,
    logo ?? ch.logo,
    group_title ?? ch.group_title,
    ch.id
  );
  ensureCategory(group_title ?? ch.group_title, 'live');
  res.json({ ok: true });
});

router.put('/categories/rename', auth, adminOnly, (req, res) => {
  const { old_name, new_name } = req.body;
  if (!old_name || !new_name) return res.status(400).json({ error: 'Nombres requeridos' });
  db.prepare('UPDATE live_channels SET group_title = ? WHERE group_title = ?').run(new_name, old_name);
  res.json({ ok: true });
});

router.delete('/categories/:name', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM live_channels WHERE group_title = ?').run(req.params.name);
  res.json({ ok: true });
});

router.post('/channels', auth, adminOnly, (req, res) => {
  const { name, stream_url, logo = '', group_title = 'En Vivo', config: configBody, enabled: enabledBody } = req.body;
  const sources = configBody?.sources || [];
  let primary = stream_url || (sources[0]?.url) || '';
  if (!name || !primary) {
    return res.status(400).json({ error: 'Nombre y URL del stream requeridos' });
  }

  let playlist = db.prepare("SELECT id FROM live_playlists WHERE name = 'Canales manuales'").get();
  if (!playlist) {
    const r = db.prepare("INSERT INTO live_playlists (name, m3u_url) VALUES ('Canales manuales', '')").run();
    playlist = { id: r.lastInsertRowid };
  }

  const enabled = enabledBody !== undefined ? (enabledBody ? 1 : 0) : 1;
  let config = mergeConfig(parseConfig('{}'), configBody || {});
  if (!config.sources.length) {
    config.sources = [{ url: primary, user_agent: '', referer: '', scan_status: '', scan_info: '' }];
  }
  config.advanced = { ...config.advanced, user_pinned: enabled === 1, manual_url: true };

  const finalized = finalizeConfigForSave(config, { stream_url: primary, name, manual: true });
  config = finalized.config;
  primary = finalized.stream_url;

  const result = db.prepare(`
    INSERT INTO live_channels (playlist_id, name, logo, stream_url, group_title, config, enabled, cache_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    playlist.id,
    name,
    logo,
    primary,
    group_title,
    serializeConfig(config),
    enabled,
    finalized.cache_enabled ? 1 : 0
  );
  ensureCategory(group_title, 'live');
  const newId = result.lastInsertRowid;
  try {
    streamCache.syncRelayFromConfig(newId, config);
    if (finalized.cache_enabled) {
      streamCache.startCache(newId).catch((err) => {
        console.warn(`[relay] inicio canal ${newId}:`, err.message || err);
      });
    }
  } catch { /* ignore */ }

  res.json({ id: newId });
});

router.delete('/channels/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id, 10);
  rtmpPush.stopPush(id);
  streamCache.stopCache(id);
  db.prepare('DELETE FROM live_channels WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.post('/playlists', auth, adminOnly, async (req, res) => {
  const { name, m3u_url, logo = '', group_title = '' } = req.body;
  if (!name || !m3u_url) return res.status(400).json({ error: 'Nombre y URL requeridos' });

  try {
    const content = await fetchUrl(m3u_url);
    const channels = parseM3U(content, m3u_url, name);

    if (channels.length === 0) {
      return res.status(400).json({ error: 'No se encontraron canales válidos' });
    }

    if (channels.length === 1) {
      if (logo) channels[0].logo = logo;
      if (group_title) channels[0].group_title = group_title;
    }

    const result = db.prepare('INSERT INTO live_playlists (name, m3u_url) VALUES (?, ?)').run(name, m3u_url);
    const stats = importLiveChannelsOnly(result.lastInsertRowid, name, channels);

    res.json({
      id: result.lastInsertRowid,
      channels: stats.live,
      skipped: stats.skipped,
      movies: 0,
      series: 0,
      episodes: 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al cargar: ' + err.message });
  }
});

router.post('/playlists/:id/refresh', auth, adminOnly, async (req, res) => {
  const playlist = db.prepare('SELECT * FROM live_playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Lista no encontrada' });
  if (!playlist.m3u_url) return res.status(400).json({ error: 'Lista manual, no se puede actualizar' });

  try {
    const content = await fetchUrl(playlist.m3u_url);
    const channels = parseM3U(content, playlist.m3u_url, playlist.name);
    const stats = importLiveChannelsOnly(playlist.id, playlist.name, channels);
    res.json({ ...stats, movies: 0, series: 0, episodes: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/playlists/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM live_playlists WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
