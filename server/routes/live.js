const express = require('express');
const https = require('https');
const http = require('http');
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
  withUserPinned
} = require('../services/channelConfig');
const { scanSources } = require('../services/sourceScan');
const { scanAndFixAllChannels, scanAndFixChannel } = require('../services/channelSourceSync');
const rtmpPush = require('../services/rtmpPush');
const streamCache = require('../services/streamCache');
const liveProxy = require('../services/liveStreamProxy');
const streamProxyPool = require('../services/streamProxyPool');
const epgService = require('../services/epgService');

const router = express.Router();

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

/** MKV → MP4 fragmentado; recurre a transcodificar si el códec no es compatible. */
async function remuxLocalFile(filePath, res, req) {
  const forceTranscode = req.query.transcode === '1' || req.query.force_transcode === '1';
  const startSec = Math.max(0, parseFloat(String(req.query.t || req.query.start || '0')) || 0);
  const codecs = await probeCodecs(filePath);
  const mode = pickLocalStreamMode(codecs, forceTranscode);

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
  if (mode === 'copy') {
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
router.needsTranscode = needsTranscode;

function resolveUrl(base, relative) {
  const { resolveUrl: ru } = require('../services/playlistImport');
  return ru(base, relative);
}

function verifyStreamToken(req) {
  const raw = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!raw) return false;
  try {
    jwt.verify(raw, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

function rewriteM3u8(content, baseUrl, token, hdrs = {}) {
  return liveProxy.rewriteM3u8(content, baseUrl, token, hdrs);
}

function streamFetchHeaders(req) {
  const ua = req.query.ua ? decodeURIComponent(String(req.query.ua)) : '';
  const referer = req.query.referer ? decodeURIComponent(String(req.query.referer)) : '';
  const cookie = req.query.cookie ? decodeURIComponent(String(req.query.cookie)) : '';
  const url = req.query.url ? decodeURIComponent(String(req.query.url)) : '';
  const px = req.query.px ? decodeURIComponent(String(req.query.px)) : '';
  const extra = {};
  if (referer) extra.Referer = referer;
  if (ua) extra['User-Agent'] = ua;
  if (cookie) extra.Cookie = cookie;
  if (/dmcdn\.net|dailymotion\.com/i.test(url)) extra.Origin = 'https://tctelevision.com';
  if (/esradioecuador\.com/i.test(url) && !referer) extra.Referer = 'https://www.gamavision.com.ec/';
  if (/esradioecuador\.com/i.test(url)) extra.Origin = 'https://www.gamavision.com.ec';
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

router.get('/ch/:id/catchup.m3u8', async (req, res) => {
  if (!verifyStreamToken(req)) return res.status(401).end();
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ? AND COALESCE(enabled, 1) = 1').get(req.params.id);
  if (!ch) return res.status(404).end();
  if (!streamCache.relayActiveForChannel(ch)) return res.status(404).end();
  const playlistPath = streamCache.getLocalPlaylistPath(ch.id);
  if (!playlistPath || !require('fs').existsSync(playlistPath)) return res.status(503).end();
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, max-age=2');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(require('fs').readFileSync(playlistPath, 'utf8'));
});

router.get('/ch/:id/play.m3u8', async (req, res) => {
  if (!verifyStreamToken(req)) return res.status(401).end();
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ? AND COALESCE(enabled, 1) = 1').get(req.params.id);
  if (!ch) return res.status(404).end();
  const preferLowest = req.query.profile === 'mobile';
  const tcTelevisionSync = require('../services/tcTelevisionSync');
  const vixSync = require('../services/vixSync');

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

router.get('/stream', (req, res) => {
  const url = req.query.url;
  if (!url || !verifyStreamToken(req)) {
    return res.status(401).end();
  }

  const decoded = decodeURIComponent(url);
  if (!/^https?:\/\//i.test(decoded)) {
    return res.status(400).end();
  }

  const hdrs = streamFetchHeaders(req);
  const isManifest = isHlsManifestUrl(decoded);

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
  sql += ' ORDER BY c.group_title, c.name';
  const rows = db.prepare(sql).all(...params);
  const includeUpstream = req.user.role === 'admin' && all === '1';
  if (includeUpstream) {
    return res.json(rows.map((ch) => streamCache.formatChannelForApi(ch, { includeUpstream: true })));
  }
  const { formatChannelLite } = require('../services/liveChannelsApi');
  const { filterLiveForProfile } = require('../services/parental');
  let lite = rows.map(formatChannelLite);
  if (req.profile?.is_kids) lite = filterLiveForProfile(lite, req.profile);
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.json(lite);
});

router.get('/categories', auth, requireAccess('live'), (req, res) => {
  db.prepare("SELECT DISTINCT group_title as name FROM live_channels WHERE group_title != ''").all()
    .forEach(r => ensureCategory(r.name, 'live'));
  const categories = listCategories('live', { enabledOnly: true })
    .map(c => ({
      id: c.id,
      name: c.name,
      count: c.count
    }))
    .filter((c) => c.count > 0);
  res.json(categories);
});

router.get('/epg', auth, requireAccess('live'), async (req, res) => {
  try {
    const data = await epgService.getLiveEpgMap({ force: req.query.refresh === '1' });
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
    ORDER BY group_title
  `).all();
  res.json(groups.map(g => g.name));
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
  const config = mergeConfig(prev, body.config || body);
  const name = body.name ?? ch.name;
  const logo = body.logo ?? ch.logo;
  const group_title = body.group_title ?? ch.group_title;
  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : (ch.enabled ?? 1);
  const stream_url = primarySourceUrl(config, body.stream_url ?? ch.stream_url);

  if (!name || !stream_url) {
    const err = new Error('Nombre y al menos una fuente URL son requeridos');
    err.status = 400;
    throw err;
  }

  if (body.enabled !== undefined) {
    config.advanced = { ...config.advanced, user_pinned: enabled === 1 };
  }

  db.prepare(`
    UPDATE live_channels
    SET name=?, stream_url=?, logo=?, group_title=?, config=?, enabled=?
    WHERE id=?
  `).run(name, stream_url, logo, group_title, serializeConfig(config), enabled, channelId);

  ensureCategory(group_title, 'live');

  const updated = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
  const finalConfig = configFromChannel(updated);
  try {
    streamCache.syncRelayFromConfig(channelId, finalConfig);
  } catch (err) {
    finalConfig._relay_error = err.message;
  }
  const refreshed = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
  return { channel: refreshed, config: configFromChannel(refreshed), relay_error: finalConfig._relay_error };
}

router.put('/channels/:id/config', auth, adminOnly, (req, res) => {
  try {
    const saved = saveChannelConfig(req.params.id, req.body);
    if (!saved) return res.status(404).json({ error: 'Canal no encontrado' });
    if (saved.config.rtmp?.auto_start && saved.config.rtmp?.enabled) {
      try {
        rtmpPush.startPush(saved.channel, saved.config);
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

router.post('/channels/:id/rtmp/start', auth, adminOnly, (req, res) => {
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Canal no encontrado' });
  try {
    const config = req.body.config ? mergeConfig(configFromChannel(ch), req.body.config) : configFromChannel(ch);
    const result = rtmpPush.startPush(ch, config);
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
  db.prepare(`
    UPDATE live_channels SET name=?, stream_url=?, logo=?, group_title=?, enabled=COALESCE(?, enabled) WHERE id=?
  `).run(
    name ?? ch.name,
    stream_url ?? ch.stream_url,
    logo ?? ch.logo,
    group_title ?? ch.group_title,
    enabled !== undefined ? (enabled ? 1 : 0) : ch.enabled,
    ch.id
  );
  ensureCategory(group_title ?? ch.group_title, 'live');
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
  const primary = stream_url || (sources[0]?.url) || '';
  if (!name || !primary) {
    return res.status(400).json({ error: 'Nombre y URL del stream requeridos' });
  }

  let playlist = db.prepare("SELECT id FROM live_playlists WHERE name = 'Canales manuales'").get();
  if (!playlist) {
    const r = db.prepare("INSERT INTO live_playlists (name, m3u_url) VALUES ('Canales manuales', '')").run();
    playlist = { id: r.lastInsertRowid };
  }

  const enabled = enabledBody !== undefined ? (enabledBody ? 1 : 0) : 1;
  const config = mergeConfig(parseConfig('{}'), configBody || {});
  if (!config.sources.length) {
    config.sources = [{ url: primary, user_agent: '', referer: '', scan_status: '', scan_info: '' }];
  }
  config.advanced = { ...config.advanced, user_pinned: enabled === 1 };

  const result = db.prepare(`
    INSERT INTO live_channels (playlist_id, name, logo, stream_url, group_title, config, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(playlist.id, name, logo, primary, group_title, serializeConfig(config), enabled);
  ensureCategory(group_title, 'live');
  const newId = result.lastInsertRowid;
  try {
    streamCache.syncRelayFromConfig(newId, config);
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
