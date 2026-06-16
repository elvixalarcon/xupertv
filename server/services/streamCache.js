const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { configFromChannel, primarySourceUrl, serializeConfig, isDirectSourceChannel, isManualStreamChannel } = require('./channelConfig');

const DATA = path.join(__dirname, '..', '..', 'data');
const CACHE_ROOT = path.join(DATA, 'stream-cache');

/** @type {Map<number, import('child_process').ChildProcess>} */
const processes = new Map();

/** @type {Map<number, { input_kbps: number, output_kbps: number, speed: number, fps: number, updated_at: number }>} */
const relayMetrics = new Map();

/** @type {Map<number, number>} */
const restartCooldown = new Map();

/** @type {Map<number, Promise<unknown>>} */
const startLocks = new Map();

/** @type {Map<number, NodeJS.Timeout>} */
const fuboRefreshTimers = new Map();

const FUBO_RELAY_REFRESH_MS = 15 * 60 * 1000;
const MAX_CONCURRENT_RELAYS = 5;
const RELAY_RESTART_COOLDOWN_MS = 90000;
const PLAYLIST_FRESH_MS = 45000;

function ensureCacheRoot() {
  if (!fs.existsSync(CACHE_ROOT)) fs.mkdirSync(CACHE_ROOT, { recursive: true });
}

function channelCacheDir(channelId) {
  return path.join(CACHE_ROOT, String(channelId));
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function formatMbps(kbps) {
  if (!kbps || kbps <= 0) return '0.00';
  return (kbps / 1024).toFixed(2);
}

function formatUptime(startedAt) {
  if (!startedAt) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function parseFfmpegStats(text) {
  let outputKbps = 0;
  let speed = 0;
  let fps = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const br = line.match(/bitrate=\s*([\d.]+)\s*kbits\/s/i);
    if (br) outputKbps = parseFloat(br[1]);
    const sp = line.match(/speed=\s*([\d.]+)x/i);
    if (sp) speed = parseFloat(sp[1]);
    const fp = line.match(/fps=\s*([\d.]+)/i);
    if (fp) fps = parseFloat(fp[1]);
  }
  return { outputKbps, speed, fps };
}

function getRelayMetrics(channelId) {
  const m = relayMetrics.get(channelId);
  const stale = !m || (Date.now() - (m.updated_at || 0)) > 15000;
  return {
    input_kbps: stale ? 0 : (m.input_kbps || 0),
    output_kbps: stale ? 0 : (m.output_kbps || 0),
    import_mbps: stale ? 0 : parseFloat(formatMbps(m.input_kbps || 0)),
    output_mbps: stale ? 0 : parseFloat(formatMbps(m.output_kbps || 0)),
    speed: stale ? 0 : (m.speed || 0),
    fps: stale ? 0 : (m.fps || 0),
    stale
  };
}

function relayStatusLabel(status) {
  if (status === 'active') return 'Activo';
  if (status === 'starting') return 'Iniciando';
  if (status === 'down') return 'Caído';
  if (status === 'off') return 'Apagado';
  return status || '—';
}

function getRelayDashboard(opts = {}) {
  if (!opts.lite) syncAllCacheMetrics();
  const channels = db.prepare(`
    SELECT id, name, group_title, cache_enabled, cache_status, cache_bytes, cache_started_at, config
    FROM live_channels
    WHERE cache_enabled = 1
    ORDER BY name COLLATE NOCASE
  `).all();

  const streams = [];
  let totalImportKbps = 0;
  let totalOutputKbps = 0;
  let active = 0;
  let down = 0;

  for (const ch of channels) {
    const config = configFromChannel(ch);
    const relay = relayActiveForChannel(ch);
    if (!relay) continue;

    const metrics = getRelayMetrics(ch.id);
    const importKbps = metrics.input_kbps || 0;
    const outputKbps = metrics.output_kbps || 0;
    const status = ch.cache_status || 'off';
    if (status === 'active') active++;
    else if (status === 'down') down++;
    totalImportKbps += importKbps;
    totalOutputKbps += outputKbps;

    streams.push({
      id: ch.id,
      name: ch.name,
      group_title: ch.group_title || '',
      status: ch.cache_status || 'off',
      status_label: relayStatusLabel(ch.cache_status),
      enabled: !!ch.cache_enabled,
      import_kbps: importKbps,
      output_kbps: outputKbps,
      import_mbps: formatMbps(importKbps),
      output_mbps: formatMbps(outputKbps),
      speed: metrics.speed || 0,
      fps: metrics.fps || 0,
      cache_formatted: formatBytes(ch.cache_bytes || 0),
      uptime: formatUptime(ch.cache_started_at),
      started_at: ch.cache_started_at
    });
  }

  return {
    count: streams.length,
    active,
    down,
    total_import_kbps: totalImportKbps,
    total_output_kbps: totalOutputKbps,
    total_import_mbps: formatMbps(totalImportKbps),
    total_output_mbps: formatMbps(totalOutputKbps),
    streams
  };
}

function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile()) total += st.size;
    } catch { /* ignore */ }
  }
  return total;
}

function updateCacheRow(channelId, fields) {
  const ch = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
  if (!ch) return;
  db.prepare(`
    UPDATE live_channels SET
      cache_enabled = ?,
      cache_status = ?,
      cache_bytes = ?,
      cache_path = ?,
      cache_started_at = ?,
      cache_checked_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    fields.cache_enabled !== undefined ? fields.cache_enabled : ch.cache_enabled,
    fields.cache_status !== undefined ? fields.cache_status : ch.cache_status,
    fields.cache_bytes !== undefined ? fields.cache_bytes : ch.cache_bytes,
    fields.cache_path !== undefined ? fields.cache_path : ch.cache_path,
    fields.cache_started_at !== undefined ? fields.cache_started_at : ch.cache_started_at,
    channelId
  );
}

function listRunningRelayChannelIds() {
  const ids = new Set();
  for (const [channelId, proc] of processes) {
    if (proc && !proc.killed) ids.add(channelId);
  }
  try {
    const out = execSync('pgrep -af "stream-cache/" 2>/dev/null || true', { encoding: 'utf8', timeout: 2000 });
    for (const line of out.split('\n')) {
      const m = line.match(/stream-cache\/(\d+)\//);
      if (m) ids.add(parseInt(m[1], 10));
    }
  } catch { /* ignore */ }
  return ids;
}

function isRelayProcessRunning(channelId, runningIds = null) {
  const proc = processes.get(channelId);
  if (proc && !proc.killed) return true;
  if (runningIds) return runningIds.has(channelId);
  try {
    execSync(`pgrep -f "stream-cache/${channelId}/"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function playlistIsFresh(channelId, maxAgeMs = PLAYLIST_FRESH_MS) {
  try {
    const playlist = path.join(channelCacheDir(channelId), 'index.m3u8');
    if (!fs.existsSync(playlist)) return false;
    const age = Date.now() - fs.statSync(playlist).mtimeMs;
    return age <= maxAgeMs;
  } catch {
    return false;
  }
}

function killOrphanRelayProcess(channelId) {
  try {
    execSync(`pkill -f "stream-cache/${channelId}/"`, { stdio: 'ignore' });
  } catch { /* ignore */ }
}

function clearFuboRefreshTimer(channelId) {
  const t = fuboRefreshTimers.get(channelId);
  if (t) {
    clearInterval(t);
    fuboRefreshTimers.delete(channelId);
  }
}

async function rollingRefreshFuboRelay(channelId) {
  const row = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
  if (!row?.cache_enabled || !processes.has(channelId)) return;
  if (isManualStreamChannel(row)) return;
  try {
    const ecuaplaySync = require('./ecuaplaySync');
    if (ecuaplaySync.isEcuaplayChannel(row) || /fubo18\.com/i.test(row.stream_url || '')) {
      console.log(`[relay] Renovación programada #${channelId} ${row.name}`);
      clearFuboRefreshTimer(channelId);
      stopCache(channelId);
      const dir = channelCacheDir(channelId);
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
        }
      }
      await startCache(channelId);
    }
  } catch (err) {
    console.warn(`[relay] Renovación #${channelId}:`, err.message || err);
    scheduleRelayRestart(channelId, { delayMs: 3000, force: true });
  }
}

function scheduleFuboRelayRefresh(channelId) {
  clearFuboRefreshTimer(channelId);
  const timer = setInterval(() => {
    rollingRefreshFuboRelay(channelId).catch(() => {});
  }, FUBO_RELAY_REFRESH_MS);
  if (timer.unref) timer.unref();
  fuboRefreshTimers.set(channelId, timer);
}

function scheduleRelayRestart(channelId, { delayMs = 3000, force = false } = {}) {
  const enabled = db.prepare('SELECT cache_enabled FROM live_channels WHERE id = ?').get(channelId)?.cache_enabled;
  if (!enabled) return;
  const last = restartCooldown.get(channelId) || 0;
  if (!force && Date.now() - last < RELAY_RESTART_COOLDOWN_MS) return;
  restartCooldown.set(channelId, Date.now());
  setTimeout(() => {
    if (processes.size >= MAX_CONCURRENT_RELAYS) return;
    startCache(channelId).catch((err) => {
      console.warn(`[relay] reinicio canal ${channelId}:`, err.message || err);
    });
  }, delayMs);
}

function countActiveRelays() {
  return processes.size;
}

function relayCapacityAvailable() {
  return countActiveRelays() < MAX_CONCURRENT_RELAYS;
}

function trimExcessRelays() {
  const running = [...processes.keys()].filter((id) => isRelayProcessRunning(id));
  if (running.length <= MAX_CONCURRENT_RELAYS) return;
  const scored = running.map((id) => {
    const row = db.prepare('SELECT cache_started_at FROM live_channels WHERE id = ?').get(id);
    const started = row?.cache_started_at ? Date.parse(row.cache_started_at) : 0;
    return { id, started };
  });
  scored.sort((a, b) => a.started - b.started);
  while (countActiveRelays() > MAX_CONCURRENT_RELAYS && scored.length) {
    const victim = scored.shift();
    if (!victim) break;
    console.log(`[relay] liberando CPU — deteniendo #${victim.id}`);
    stopCache(victim.id);
  }
}

async function resolveRelayInput(channel) {
  const config = configFromChannel(channel);
  const tvPorInternet = require('./tvPorInternet');
  const tcTelevisionSync = require('./tcTelevisionSync');
  const vixSync = require('./vixSync');
  const fastChannelsSync = require('./fastChannelsSync');
  const ecuaplaySync = require('./ecuaplaySync');
  const { serializeConfig } = require('./channelConfig');

  let source = '';
  let ua = config.advanced?.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  let referer = config.advanced?.referer || 'https://tv.vixred.com/';

  const needsTvResolve = /stream\.php/i.test(channel.stream_url || '')
    || (config.sources || []).some((s) => tvPorInternet.isTvPorInternetSource(s) || s.resolver === 'pluto');
  const manual = isManualStreamChannel(config);

  try {
    if (!manual && ecuaplaySync.isEcuaplayChannel(channel)) {
      const refreshed = await ecuaplaySync.refreshEcuaplayChannel(channel);
      channel = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(refreshed.id) || channel;
      source = channel.stream_url || '';
      referer = configFromChannel(channel).advanced?.referer || referer;
    } else if (!manual && /fubo18\.com/i.test(channel.stream_url || '')) {
      const playerFile = ecuaplaySync.getPlayerFile(channel);
      const playback = await ecuaplaySync.resolvePlayerStream(playerFile, channel.name);
      const cfg = configFromChannel(channel);
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
        .run(playback.url, serializeConfig(cfg), channel.id);
      channel = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channel.id);
      source = playback.url;
      referer = playback.referer || referer;
    }
    if (tcTelevisionSync.isTcTelevisionChannel(channel)) {
      const playback = await tcTelevisionSync.getChannelPlayback(channel);
      if (playback?.url) {
        source = playback.url;
        referer = playback.referer || referer;
        ua = playback.user_agent || ua;
      }
    } else if (vixSync.isVixChannel(channel)) {
      const playback = await vixSync.getChannelPlayback(channel);
      if (playback?.url) {
        source = playback.url;
        referer = playback.referer || referer;
        ua = playback.user_agent || ua;
      }
    } else if (needsTvResolve) {
      const playback = await tvPorInternet.getChannelPlayback(channel);
      if (playback?.url) {
        source = playback.url;
        referer = playback.referer || referer;
        ua = playback.user_agent || ua;
      }
    } else {
      const dynamic = await fastChannelsSync.resolveChannelStreamUrl(channel);
      if (dynamic) source = dynamic;
    }
  } catch { /* fallback below */ }

  if (!source) source = primarySourceUrl(config, channel.stream_url);
  if (!source) return null;

  return {
    source,
    ua,
    referer,
    custom: config.advanced?.custom_headers || ''
  };
}

function buildRelayHeaders({ ua, referer, custom = '', source = '' }) {
  let ref = referer || 'https://tv.vixred.com/';
  if (/fubo18\.com/i.test(source)) {
    ref = referer || 'https://la18hd.com/';
  }
  const headers = [
    `User-Agent: ${ua || 'Mozilla/5.0'}`,
    `Referer: ${ref}`
  ];
  if (/fubo18\.com/i.test(source)) {
    headers.push('Origin: https://la14hd.com');
  }
  if (custom) {
    custom.split('\n').forEach((line) => {
      const t = line.trim();
      if (t && t.includes(':')) headers.push(t);
    });
  }
  return `${headers.join('\r\n')}\r\n`;
}

function needsRelayAudioRetime(source = '') {
  return /fubo18\.com/i.test(source);
}

function spawnRelayProcess(channelId, channel, input) {
  const dir = channelCacheDir(channelId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const playlist = path.join(dir, 'index.m3u8');
  const segmentPattern = path.join(dir, 'seg_%03d.ts');
  const headerBlock = buildRelayHeaders({ ...input, source: input.source });

  const retimeAudio = needsRelayAudioRetime(input.source);
  const args = [
    '-hide_banner', '-loglevel', 'warning',
    '-stats_period', '1',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-headers', headerBlock
  ];
  if (retimeAudio) {
    args.push('-fflags', '+genpts+discardcorrupt');
  }
  args.push('-i', input.source);
  if (retimeAudio) {
    // fubo18 mono.m3u8 desincroniza audio/video con -c copy; re-codificar audio evita voz robotizada.
    args.push(
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'copy',
      '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
      '-af', 'aresample=async=1:min_hard_comp=0.100:first_pts=0',
      '-avoid_negative_ts', 'make_zero',
      '-max_muxing_queue_size', '4096'
    );
  } else {
    args.push('-c', 'copy');
  }
  const hlsTime = retimeAudio ? '4' : '6';
  const hlsListSize = retimeAudio ? '10' : '12';
  args.push(
    '-f', 'hls',
    '-hls_time', hlsTime,
    '-hls_list_size', hlsListSize,
    '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
    '-hls_segment_filename', segmentPattern,
    playlist
  );

  const proc = spawn('ffmpeg', args, { detached: false });
  processes.set(channelId, proc);
  relayMetrics.set(channelId, { input_kbps: 0, output_kbps: 0, speed: 0, fps: 0, updated_at: Date.now() });

  updateCacheRow(channelId, {
    cache_enabled: 1,
    cache_status: 'starting',
    cache_bytes: dirSizeBytes(dir),
    cache_path: `/cache/live/${channelId}/index.m3u8`,
    cache_started_at: new Date().toISOString()
  });

  proc.on('exit', (code) => {
    clearFuboRefreshTimer(channelId);
    processes.delete(channelId);
    const row = db.prepare('SELECT cache_enabled FROM live_channels WHERE id = ?').get(channelId);
    if (!row?.cache_enabled) return;
    updateCacheRow(channelId, {
      cache_enabled: 1,
      cache_status: 'down',
      cache_bytes: dirSizeBytes(dir),
      cache_path: `/cache/live/${channelId}/index.m3u8`,
      cache_started_at: undefined
    });
    if (code !== 0 && code !== null) {
      scheduleRelayRestart(channelId, { delayMs: 5000 });
    }
  });

  proc.stderr?.on('data', (chunk) => {
    const parsed = parseFfmpegStats(chunk.toString());
    if (parsed.outputKbps > 0) {
      relayMetrics.set(channelId, {
        input_kbps: parsed.outputKbps,
        output_kbps: parsed.outputKbps,
        speed: parsed.speed,
        fps: parsed.fps,
        updated_at: Date.now()
      });
    }
  });

  setTimeout(() => syncCacheMetrics(channelId), 8000);
  if (retimeAudio) scheduleFuboRelayRefresh(channelId);
}

function syncCacheMetrics(channelId, runningIds = null) {
  const dir = channelCacheDir(channelId);
  const bytes = dirSizeBytes(dir);
  const hasPlaylist = fs.existsSync(path.join(dir, 'index.m3u8'));
  const fresh = hasPlaylist && playlistIsFresh(channelId);
  const running = isRelayProcessRunning(channelId, runningIds);
  const enabled = !!db.prepare('SELECT cache_enabled FROM live_channels WHERE id = ?').get(channelId)?.cache_enabled;

  let status = 'off';
  if (running) {
    status = hasPlaylist ? 'active' : 'starting';
  } else if (enabled) {
    status = fresh ? 'starting' : 'down';
    scheduleRelayRestart(channelId);
  }

  updateCacheRow(channelId, {
    cache_enabled: undefined,
    cache_status: status,
    cache_bytes: bytes,
    cache_path: enabled ? `/cache/live/${channelId}/index.m3u8` : undefined,
    cache_started_at: undefined
  });
  return { bytes, status, hasPlaylist, fresh, running };
}

function stopCache(channelId) {
  clearFuboRefreshTimer(channelId);
  const proc = processes.get(channelId);
  if (proc) {
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    processes.delete(channelId);
  }
  killOrphanRelayProcess(channelId);
  relayMetrics.delete(channelId);
  updateCacheRow(channelId, {
    cache_enabled: db.prepare('SELECT cache_enabled FROM live_channels WHERE id = ?').get(channelId)?.cache_enabled,
    cache_status: 'off',
    cache_bytes: dirSizeBytes(channelCacheDir(channelId)),
    cache_path: null,
    cache_started_at: null
  });
  return { stopped: true };
}

async function startCache(channelId) {
  const prior = startLocks.get(channelId);
  if (prior) return prior;

  const work = (async () => {
    const channel = db.prepare('SELECT * FROM live_channels WHERE id = ?').get(channelId);
    if (!channel) {
      const err = new Error('Canal no encontrado');
      err.status = 404;
      throw err;
    }

    const owned = processes.get(channelId);
    if (owned && !owned.killed && playlistIsFresh(channelId)) {
      syncCacheMetrics(channelId);
      return { started: true, channel_id: channelId, path: `/cache/live/${channelId}/index.m3u8`, reused: true };
    }

    stopCache(channelId);
    ensureCacheRoot();

    trimExcessRelays();
    if (!relayCapacityAvailable()) {
      const err = new Error('Servidor ocupado (límite de relays)');
      err.status = 503;
      throw err;
    }

    const input = await resolveRelayInput(channel);
    if (!input?.source) {
      const err = new Error('No hay fuente para cachear');
      err.status = 400;
      throw err;
    }

    spawnRelayProcess(channelId, channel, input);
    return { started: true, channel_id: channelId, path: `/cache/live/${channelId}/index.m3u8` };
  })();

  startLocks.set(channelId, work);
  try {
    return await work;
  } finally {
    if (startLocks.get(channelId) === work) startLocks.delete(channelId);
  }
}

async function setCacheEnabled(channelId, enabled) {
  if (!enabled) {
    stopCache(channelId);
    updateCacheRow(channelId, {
      cache_enabled: 0,
      cache_status: 'off',
      cache_bytes: dirSizeBytes(channelCacheDir(channelId)),
      cache_path: null,
      cache_started_at: null
    });
    return { cache_enabled: false };
  }
  updateCacheRow(channelId, { cache_enabled: 1, cache_status: 'off', cache_bytes: dirSizeBytes(channelCacheDir(channelId)), cache_path: null, cache_started_at: null });
  return startCache(channelId);
}

let metricsSyncCache = { at: 0, result: null };
const METRICS_SYNC_TTL_MS = 30000;

function syncAllCacheMetrics(opts = {}) {
  const force = !!opts.force;
  const now = Date.now();
  if (!force && metricsSyncCache.result && now - metricsSyncCache.at < METRICS_SYNC_TTL_MS) {
    return metricsSyncCache.result;
  }

  const runningIds = listRunningRelayChannelIds();
  const rows = db.prepare('SELECT id, cache_enabled FROM live_channels WHERE cache_enabled = 1').all();
  const seen = new Set(rows.map((r) => r.id));
  for (const id of runningIds) {
    if (!seen.has(id)) rows.push({ id, cache_enabled: 1 });
  }

  let totalBytes = 0;
  let active = 0;
  let down = 0;
  let enabled = 0;

  for (const row of rows) {
    const m = syncCacheMetrics(row.id, runningIds);
    totalBytes += m.bytes;
    if (row.cache_enabled) {
      enabled++;
      if (m.status === 'active') active++;
      else if (m.status === 'down' || m.status === 'starting') down++;
    }
  }

  const result = { totalBytes, active, down, enabled, totalMb: totalBytes / (1024 * 1024) };
  metricsSyncCache = { at: now, result };
  return result;
}

async function startAllEnabledCaches({ batchSize = 5, delayMs = 1500 } = {}) {
  const rows = db.prepare('SELECT id FROM live_channels WHERE cache_enabled = 1 ORDER BY id').all();
  const results = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (row) => {
      try {
        return { id: row.id, ...(await startCache(row.id)) };
      } catch (err) {
        return { id: row.id, error: err.message };
      }
    }));
    results.push(...batchResults);
    if (i + batchSize < rows.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { total: rows.length, results };
}

function relayActiveForChannel(ch) {
  const config = configFromChannel(ch);
  if (isDirectSourceChannel(config)) return false;
  return relayEnabled(config) || !!ch.cache_enabled;
}

function setRelayForAllChannels(enabled, { onlyEnabled = true } = {}) {
  const where = onlyEnabled ? 'WHERE COALESCE(enabled, 1) = 1' : '';
  const rows = db.prepare(`SELECT id, config FROM live_channels ${where}`).all();
  const update = db.prepare('UPDATE live_channels SET config = ?, cache_enabled = ? WHERE id = ?');

  for (const row of rows) {
    const config = configFromChannel(row);
    config.advanced.allow_recording = !!enabled;
    update.run(serializeConfig(config), enabled ? 1 : 0, row.id);
    if (!enabled) stopCache(row.id);
  }

  return { updated: rows.length, enabled: !!enabled };
}

async function enableRelayForAllChannels({ startProcesses = false, batchSize = 5, delayMs = 1500, onlyEnabled = true } = {}) {
  const flags = setRelayForAllChannels(true, { onlyEnabled });
  if (!startProcesses) {
    return { ...flags, started: 0, lazy: true };
  }
  const started = await startAllEnabledCaches({ batchSize, delayMs });
  return { ...flags, ...started, lazy: false };
}

function disableRelayForAllChannels({ onlyEnabled = true } = {}) {
  const flags = setRelayForAllChannels(false, { onlyEnabled });
  stopAllCaches();
  db.prepare(`UPDATE live_channels SET cache_status = 'off', cache_path = NULL, cache_started_at = NULL WHERE cache_enabled = 0`).run();
  return { ...flags, stopped: true };
}

function stopAllCaches() {
  for (const id of [...processes.keys()]) stopCache(id);
  try {
    execSync('pkill -f "stream-cache/"', { stdio: 'ignore' });
  } catch { /* ignore */ }
  processes.clear();
  relayMetrics.clear();
  db.prepare(`UPDATE live_channels SET cache_status = 'off' WHERE cache_enabled = 0`).run();
  return { stopped: true };
}

function getCacheStats(opts = {}) {
  if (!opts.lite) syncAllCacheMetrics();
  let enabled = 0;
  let active = 0;
  let down = 0;
  let totalBytes = 0;

  db.prepare('SELECT cache_enabled, cache_status, cache_bytes FROM live_channels WHERE cache_enabled = 1').all().forEach((r) => {
    totalBytes += r.cache_bytes || 0;
    enabled++;
    if (r.cache_status === 'active') active++;
    else if (r.cache_status !== 'off') down++;
  });

  return { enabled, active, down, totalBytes, totalMb: totalBytes / (1024 * 1024), formatted: formatBytes(totalBytes) };
}

function getLocalPlaylistPath(channelId) {
  const p = path.join(channelCacheDir(channelId), 'index.m3u8');
  return fs.existsSync(p) ? p : null;
}

process.on('SIGTERM', stopAllCaches);
process.on('SIGINT', stopAllCaches);

function relayEnabled(config) {
  return config?.advanced?.allow_recording === true;
}

/** Allow Recording (XUI) = restream en servidor Vix TV hacia clientes */
function syncRelayFromConfig(channelId, config) {
  if (isDirectSourceChannel(config)) {
    stopCache(channelId);
    return setCacheEnabled(channelId, false);
  }
  return setCacheEnabled(channelId, relayEnabled(config));
}

async function ensureRelayRunning(channel) {
  const config = configFromChannel(channel);
  if (!relayActiveForChannel(channel)) return false;
  if (!relayCapacityAvailable() && !isRelayProcessRunning(channel.id)) return false;
  syncCacheMetrics(channel.id);
  const row = db.prepare('SELECT cache_status, cache_enabled FROM live_channels WHERE id = ?').get(channel.id);
  if (!row?.cache_enabled) {
    try {
      await setCacheEnabled(channel.id, true);
      return true;
    } catch {
      return false;
    }
  }
  if (!isRelayProcessRunning(channel.id) && row.cache_status !== 'starting') {
    try {
      await startCache(channel.id);
    } catch { /* ignore */ }
  }
  return true;
}

function relayPlaybackReady(ch) {
  if (!ch?.id || !relayActiveForChannel(ch)) return false;
  return isRelayProcessRunning(ch.id) && playlistIsFresh(ch.id);
}

/** Deportes/fubo: seguir intentando relay aunque esté arrancando; Ecuador: URL directa si el relay no sirve. */
function preferRelayPlayback(ch) {
  if (!relayActiveForChannel(ch)) return false;
  if (relayPlaybackReady(ch)) return true;
  const group = String(ch.group_title || '').toLowerCase();
  if (group.includes('deporte') || group.includes('sport')) return true;
  if (/fubo18\.com/i.test(ch.stream_url || '')) return true;
  try {
    const ecuaplaySync = require('./ecuaplaySync');
    if (ecuaplaySync.isEcuaplayChannel(ch)) return true;
  } catch { /* ignore */ }
  return false;
}

function publicPlaybackUrl(ch, opts = {}) {
  if (!relayActiveForChannel(ch)) {
    const config = configFromChannel(ch);
    return primarySourceUrl(config, ch.stream_url);
  }
  if (opts.autostart !== false) {
    ensureRelayRunning(ch).catch(() => {});
  }
  return `/cache/live/${ch.id}/index.m3u8`;
}

function formatChannelForApi(ch, opts = {}) {
  const config = configFromChannel(ch);
  const upstream = primarySourceUrl(config, ch.stream_url);
  const directSource = isDirectSourceChannel(config);
  const relay = !directSource && relayActiveForChannel(ch);
  const out = { ...ch, stream_url: directSource ? upstream : (relay ? publicPlaybackUrl(ch) : upstream) };
  if (opts.includeUpstream) {
    out.upstream_url = upstream;
    out.relay_enabled = relay;
    out.relay_status = ch.cache_status || 'off';
    if (relay) {
      const metrics = getRelayMetrics(ch.id);
      out.relay_import_mbps = metrics.import_mbps;
      out.relay_output_mbps = metrics.output_mbps;
      out.relay_speed = metrics.speed;
      out.relay_uptime = formatUptime(ch.cache_started_at);
      out.relay_started_at = ch.cache_started_at || null;
    }
  }
  return out;
}

const relayTrimTimer = setInterval(() => {
  try { trimExcessRelays(); } catch { /* ignore */ }
}, 90000);
if (relayTrimTimer.unref) relayTrimTimer.unref();

module.exports = {
  CACHE_ROOT,
  channelCacheDir,
  formatBytes,
  formatMbps,
  formatUptime,
  getRelayMetrics,
  getRelayDashboard,
  dirSizeBytes,
  startCache,
  stopCache,
  setCacheEnabled,
  syncCacheMetrics,
  syncAllCacheMetrics,
  startAllEnabledCaches,
  stopAllCaches,
  getCacheStats,
  getLocalPlaylistPath,
  relayEnabled,
  relayActiveForChannel,
  relayPlaybackReady,
  preferRelayPlayback,
  setRelayForAllChannels,
  enableRelayForAllChannels,
  disableRelayForAllChannels,
  syncRelayFromConfig,
  ensureRelayRunning,
  publicPlaybackUrl,
  formatChannelForApi,
  isRelayProcessRunning,
  playlistIsFresh,
  resolveRelayInput,
  processes
};
