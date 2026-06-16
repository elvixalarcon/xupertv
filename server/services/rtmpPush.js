const { spawn } = require('child_process');
const db = require('../db');
const { primarySourceUrl, configFromChannel, serializeConfig } = require('./channelConfig');

/** @type {Map<number, { process: import('child_process').ChildProcess, startedAt: number, target: string, source: string, lastError: string, lastActivity: number }>} */
const activePushes = new Map();

/** @type {Map<number, NodeJS.Timeout>} */
const restartTimers = new Map();

/** @type {Map<number, NodeJS.Timeout>} */
const refreshTimers = new Map();

/** @type {Map<number, NodeJS.Timeout>} */
const stallWatchers = new Map();

const RESTART_COOLDOWN_MS = 15000;
const PUSH_REFRESH_MS = 18 * 60 * 1000;
const PUSH_REFRESH_FUBO_MS = 7 * 60 * 1000;
const PUSH_STALL_MS = 60000;
const PUSH_STALL_CHECK_MS = 20000;
const FATAL_RESTART_AFTER = 2;

function buildRtmpDestination(pushUrl, streamKey) {
  const base = String(pushUrl || '').trim().replace(/\/+$/, '');
  const key = String(streamKey || '').trim().replace(/^\/+/, '');
  if (!base) return '';
  return key ? `${base}/${key}` : base;
}

function findPushPidForDest(dest) {
  if (!dest) return null;
  const { execSync } = require('child_process');
  try {
    const out = execSync('pgrep -af ffmpeg', { encoding: 'utf8', timeout: 3000 });
    for (const line of out.split('\n')) {
      if (line.includes(dest) && !line.includes('pgrep')) {
        const pid = parseInt(line.trim().split(/\s+/)[0], 10);
        if (pid > 1) return pid;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function getPushStatus(channelId) {
  const entry = activePushes.get(channelId);
  if (entry && !entry.process.killed) {
    return {
      running: true,
      started_at: entry.startedAt,
      target: entry.target,
      source: entry.source,
      pid: entry.process.pid,
      last_error: entry.lastError || ''
    };
  }

  const ch = db.prepare('SELECT config FROM live_channels WHERE id = ?').get(channelId);
  const config = ch ? configFromChannel(ch) : null;
  const dest = config ? buildRtmpDestination(config.rtmp?.push_url, config.rtmp?.stream_key) : '';
  const orphanPid = findPushPidForDest(dest);
  if (orphanPid) {
    return {
      running: true,
      started_at: entry?.startedAt || null,
      target: dest,
      source: entry?.source || '',
      pid: orphanPid,
      last_error: entry?.lastError || ''
    };
  }

  return {
    running: false,
    started_at: null,
    target: dest || '',
    source: '',
    pid: null,
    last_error: entry?.lastError || ''
  };
}

function clearRestartTimer(channelId) {
  const t = restartTimers.get(channelId);
  if (t) {
    clearTimeout(t);
    restartTimers.delete(channelId);
  }
}

function clearRefreshTimer(channelId) {
  const t = refreshTimers.get(channelId);
  if (t) {
    clearInterval(t);
    refreshTimers.delete(channelId);
  }
}

function clearStallWatcher(channelId) {
  const t = stallWatchers.get(channelId);
  if (t) {
    clearInterval(t);
    stallWatchers.delete(channelId);
  }
}

async function refreshDynamicChannel(channel) {
  const ecuaplaySync = require('./ecuaplaySync');
  const vixSync = require('./vixSync');
  const tvPorInternet = require('./tvPorInternet');
  const channelId = channel.id;

  try {
    if (ecuaplaySync.isEcuaplayChannel(channel)) {
      await ecuaplaySync.refreshEcuaplayChannel(channel);
      return db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
    }
    if (/fubo18\.com/i.test(channel.stream_url || '')) {
      const playback = await ecuaplaySync.resolvePlayerStream('playerwinsports.html', channel.name);
      const cfg = configFromChannel(channel);
      cfg.ecuaplay = {
        player: `${ecuaplaySync.BASE}/playerwinsports.html`,
        stream: playback.slug || 'winsports',
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
        canal: playback.slug || 'winsports'
      }];
      cfg.advanced = { ...cfg.advanced, referer: playback.referer };
      db.prepare('UPDATE live_channels SET stream_url = ?, config = ? WHERE id = ?')
        .run(playback.url, serializeConfig(cfg), channelId);
      return db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
    }
    if (vixSync.isVixChannel(channel)) {
      await vixSync.refreshVixChannel(channel, { force: true });
      return db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
    }
    const config = configFromChannel(channel);
    const needsTvResolve = /stream\.php/i.test(channel.stream_url || '')
      || (config.sources || []).some((s) => tvPorInternet.isTvPorInternetSource(s) || s.resolver === 'pluto');
    if (needsTvResolve) {
      const playback = await tvPorInternet.getChannelPlayback(channel, { force: true });
      if (playback?.url) {
        return db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
      }
    }
  } catch (err) {
    console.warn(`[rtmp] refresh canal ${channelId} (${channel.name}):`, err.message);
  }
  return channel;
}

function stopPush(channelId) {
  clearRestartTimer(channelId);
  clearRefreshTimer(channelId);
  clearStallWatcher(channelId);
  const entry = activePushes.get(channelId);
  if (!entry) return { stopped: false };
  entry.stopping = true;
  try {
    entry.process.kill('SIGTERM');
  } catch { /* ignore */ }
  activePushes.delete(channelId);
  return { stopped: true };
}

function isExpiringStreamUrl(url) {
  return /fubo18\.com/i.test(url || '');
}

function needsDirectPush(channel, config) {
  const url = channel.stream_url || '';
  if (isExpiringStreamUrl(url)) return true;
  if (/ecuaplay/i.test(JSON.stringify(config?.sources || []))) return true;
  if (config?.ecuaplay?.player) return true;
  return false;
}

function pushRefreshMs(channel) {
  if (isExpiringStreamUrl(channel.stream_url || '')) return PUSH_REFRESH_FUBO_MS;
  return PUSH_REFRESH_MS;
}

async function waitForRelayPlaylist(channelId, timeoutMs = 15000) {
  const fs = require('fs');
  const streamCache = require('./streamCache');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = streamCache.getLocalPlaylistPath(channelId);
    if (p && fs.existsSync(p) && streamCache.playlistIsFresh(channelId, 12000)) return p;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

async function resolvePushInput(channel, config) {
  const streamCache = require('./streamCache');
  channel = await refreshDynamicChannel(channel);
  config = configFromChannel(channel);

  const resolved = await streamCache.resolveRelayInput(channel);
  const fallbackReferer = config.advanced?.referer || config.sources?.[0]?.referer || 'https://tv.vixred.com/';
  const fallbackUa = config.advanced?.user_agent || config.sources?.[0]?.user_agent
    || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  if (needsDirectPush(channel, config) && resolved?.source) {
    return {
      source: resolved.source,
      referer: resolved.referer || fallbackReferer,
      ua: resolved.ua || fallbackUa,
      custom: resolved.custom || config.advanced?.custom_headers || '',
      directHls: true,
      expiring: isExpiringStreamUrl(resolved.source)
    };
  }

  if (resolved?.source && /\.m3u8/i.test(resolved.source)) {
    return {
      source: resolved.source,
      referer: resolved.referer || fallbackReferer,
      ua: resolved.ua || fallbackUa,
      custom: resolved.custom || config.advanced?.custom_headers || '',
      directHls: true,
      expiring: isExpiringStreamUrl(resolved.source)
    };
  }

  try {
    const playlistPath = await waitForRelayPlaylist(channel.id);
    if (!playlistPath) {
      await streamCache.startCache(channel.id);
    }
    const freshPath = await waitForRelayPlaylist(channel.id, 12000);
    if (freshPath) {
      return {
        source: freshPath,
        referer: '',
        ua: '',
        custom: '',
        viaRelay: true
      };
    }
  } catch (err) {
    console.warn(`[rtmp] relay canal ${channel.id} (${channel.name}):`, err.message);
  }

  const source = resolved?.source || primarySourceUrl(config, channel.stream_url);
  return {
    source,
    referer: resolved?.referer || fallbackReferer,
    ua: resolved?.ua || fallbackUa,
    custom: resolved?.custom || config.advanced?.custom_headers || '',
    directHls: /\.m3u8/i.test(source),
    expiring: isExpiringStreamUrl(source)
  };
}

function killOrphanPushTo(dest) {
  if (!dest) return;
  const { execSync } = require('child_process');
  try {
    const out = execSync('pgrep -af ffmpeg', { encoding: 'utf8', timeout: 3000 });
    for (const line of out.split('\n')) {
      if (line.includes(dest) && !line.includes('pgrep')) {
        const pid = parseInt(line.trim().split(/\s+/)[0], 10);
        if (pid > 1) {
          try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }
}

function buildPushArgs(input, config, dest) {
  const args = ['-hide_banner', '-loglevel', 'warning', '-stats_period', '1'];
  const headers = [];
  const isLocalFile = input.source.startsWith('/');
  const isFubo = /fubo18\.com/i.test(input.source);

  if (!isLocalFile) {
    const referer = isFubo ? (input.referer || 'https://la18hd.com/') : input.referer;
    if (referer) headers.push(`Referer: ${referer}`);
    if (input.ua) headers.push(`User-Agent: ${input.ua}`);
    if (isFubo) headers.push('Origin: https://la14hd.com');
    if (input.custom) {
      input.custom.split('\n').forEach((line) => {
        const t = line.trim();
        if (t && t.includes(':')) headers.push(t);
      });
    }
    if (headers.length) args.push('-headers', `${headers.join('\r\n')}\r\n`);
  }

  const isHls = /\.m3u8/i.test(input.source) || input.viaRelay || input.directHls;
  if (isHls) {
    args.push(
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_delay_max', '15',
      '-rw_timeout', '15000000',
      '-analyzeduration', '8000000',
      '-probesize', '8000000',
      '-live_start_index', '-3',
      '-fflags', '+genpts+igndts+discardcorrupt',
      '-use_wallclock_as_timestamps', '1'
    );
  } else if (!isLocalFile) {
    args.push('-re');
  }
  args.push('-i', input.source);

  const forceTranscode = isHls && (input.expiring || input.directHls || isFubo);
  if (config.servers?.transcode_profile === 'transcode' || forceTranscode) {
    args.push(
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-maxrate', '2500k', '-bufsize', '5000k', '-g', '50',
      '-vsync', 'cfr', '-r', '25',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100'
    );
  } else {
    args.push('-c', 'copy');
  }

  if (config.advanced?.ffmpeg_options) {
    const extra = config.advanced.ffmpeg_options.trim().split(/\s+/).filter(Boolean);
    args.push(...extra);
  }

  args.push('-flvflags', 'no_duration_filesize', '-f', 'flv', dest);
  return args;
}

function scheduleRestart(channelId, { autoRestart = true, delayMs = RESTART_COOLDOWN_MS } = {}) {
  if (!autoRestart) return;
  clearRestartTimer(channelId);
  restartTimers.set(channelId, setTimeout(() => {
    restartTimers.delete(channelId);
    const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
    if (!ch) return;
    const config = configFromChannel(ch);
    if (!config.rtmp?.enabled && !config.rtmp?.push_url) return;
    startPush(ch, config, { autoRestart: true }).catch((err) => {
      console.warn(`[rtmp] reinicio canal ${channelId}:`, err.message);
    });
  }, delayMs));
}

function schedulePushRefresh(channelId, channel) {
  clearRefreshTimer(channelId);
  const intervalMs = pushRefreshMs(channel || { stream_url: '' });
  refreshTimers.set(channelId, setInterval(() => {
    const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
    if (!ch || !activePushes.has(channelId)) return;
    const config = configFromChannel(ch);
    if (!config.rtmp?.enabled && !config.rtmp?.push_url) return;
    console.log(`[rtmp] renovación programada canal ${channelId} (${ch.name})`);
    startPush(ch, config, { autoRestart: true }).catch((err) => {
      console.warn(`[rtmp] renovación canal ${channelId}:`, err.message);
    });
  }, intervalMs));
}

function maybeFatalRestart(channelId, channel, entry, line) {
  if (entry.stopping || entry.restarting) return;
  const fatal = /Invalid timestamps|416 Range|Error when loading first segment|HTTP error 40[13]|HTTP error 502|End of file/i.test(line);
  if (!fatal) return;
  entry.fatalCount = (entry.fatalCount || 0) + 1;
  if (entry.fatalCount >= FATAL_RESTART_AFTER) {
    entry.restarting = true;
    console.warn(`[rtmp] canal ${channelId} (${channel.name}) — reinicio por error de señal`);
    try { entry.process.kill('SIGTERM'); } catch { /* ignore */ }
    scheduleRestart(channelId, { autoRestart: true, delayMs: 3000 });
  }
}

function startStallWatcher(channelId) {
  clearStallWatcher(channelId);
  stallWatchers.set(channelId, setInterval(() => {
    const entry = activePushes.get(channelId);
    if (!entry || entry.process.killed) return;
    const idle = Date.now() - (entry.lastActivity || entry.startedAt);
    if (idle < PUSH_STALL_MS) return;
    console.warn(`[rtmp] canal ${channelId} sin actividad ${Math.round(idle / 1000)}s — reiniciando push`);
    scheduleRestart(channelId, { autoRestart: true, delayMs: 2000 });
  }, PUSH_STALL_CHECK_MS));
}

async function startPush(channel, configOverride, { autoRestart = true } = {}) {
  const channelId = channel.id;
  stopPush(channelId);

  const config = configOverride || configFromChannel(channel);
  if (!config.rtmp?.enabled && !config.rtmp?.push_url) {
    const err = new Error('RTMP Push no configurado');
    err.status = 400;
    throw err;
  }

  const input = await resolvePushInput(channel, config);
  const dest = buildRtmpDestination(config.rtmp.push_url, config.rtmp.stream_key);
  if (!input?.source) {
    const err = new Error('No hay fuente de entrada');
    err.status = 400;
    throw err;
  }
  if (!dest) {
    const err = new Error('URL RTMP de destino requerida');
    err.status = 400;
    throw err;
  }

  killOrphanPushTo(dest);
  const args = buildPushArgs(input, config, dest);
  const proc = spawn('ffmpeg', args, { detached: false });
  const entry = {
    process: proc,
    startedAt: Date.now(),
    target: dest,
    source: input.source,
    lastError: '',
    lastActivity: Date.now()
  };
  activePushes.set(channelId, entry);
  schedulePushRefresh(channelId, channel);
  startStallWatcher(channelId);

  console.log(`[rtmp] push canal ${channelId} (${channel.name}) ← ${input.source.slice(0, 100)}`);

  proc.stderr?.on('data', (chunk) => {
    entry.lastActivity = Date.now();
    const line = chunk.toString().trim();
    if (/error|failed|forbidden|invalid|denied|timeout|timed out|416 Range/i.test(line)) {
      entry.lastError = line.slice(0, 240);
      console.warn(`[rtmp] canal ${channelId} (${channel.name}):`, line.slice(0, 200));
      maybeFatalRestart(channelId, channel, entry, line);
    }
    if (/speed=\s*0x|speed=\s*0\.0+\s/i.test(line)) {
      entry.lastError = 'Señal detenida (speed 0)';
    }
  });

  proc.on('exit', (code) => {
    const stopping = entry.stopping;
    activePushes.delete(channelId);
    clearRefreshTimer(channelId);
    clearStallWatcher(channelId);
    if (stopping) return;
    if (code !== 0 && code !== null) {
      console.warn(`[rtmp] canal ${channelId} (${channel.name}) salió con código ${code}`);
      scheduleRestart(channelId, { autoRestart });
    }
  });

  return {
    started: true,
    pid: proc.pid,
    target: dest,
    source: input.source
  };
}

async function startAllAutoPushes() {
  const rows = db.prepare(`
    SELECT * FROM live_channels
    WHERE COALESCE(enabled, 1) = 1 AND config LIKE '%"auto_start":true%'
  `).all();
  const started = [];
  for (const ch of rows) {
    const config = configFromChannel(ch);
    if (!config.rtmp?.enabled || !config.rtmp?.auto_start || !config.rtmp?.push_url) continue;
    try {
      const r = await startPush(ch, config, { autoRestart: true });
      started.push({ id: ch.id, name: ch.name, ...r });
    } catch (err) {
      console.warn(`[rtmp] auto-start ${ch.name} (#${ch.id}):`, err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (started.length) {
    console.log(`[rtmp] ${started.length} push(es) auto-iniciado(s): ${started.map((s) => s.name).join(', ')}`);
  }
  return started;
}

function stopAll() {
  for (const id of [...activePushes.keys()]) stopPush(id);
}

process.on('SIGTERM', stopAll);
process.on('SIGINT', stopAll);

module.exports = {
  startPush,
  stopPush,
  getPushStatus,
  buildRtmpDestination,
  killOrphanPushTo,
  startAllAutoPushes,
  activePushes
};
