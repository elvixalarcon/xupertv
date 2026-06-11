const { spawn } = require('child_process');
const { primarySourceUrl, configFromChannel } = require('./channelConfig');

/** @type {Map<number, { process: import('child_process').ChildProcess, startedAt: number, target: string, source: string }>} */
const activePushes = new Map();

function buildRtmpDestination(pushUrl, streamKey) {
  const base = String(pushUrl || '').trim().replace(/\/+$/, '');
  const key = String(streamKey || '').trim().replace(/^\/+/, '');
  if (!base) return '';
  return key ? `${base}/${key}` : base;
}

function getPushStatus(channelId) {
  const entry = activePushes.get(channelId);
  if (!entry) {
    return { running: false, started_at: null, target: '', source: '', pid: null };
  }
  return {
    running: !entry.process.killed,
    started_at: entry.startedAt,
    target: entry.target,
    source: entry.source,
    pid: entry.process.pid
  };
}

function stopPush(channelId) {
  const entry = activePushes.get(channelId);
  if (!entry) return { stopped: false };
  try {
    entry.process.kill('SIGTERM');
  } catch { /* ignore */ }
  activePushes.delete(channelId);
  return { stopped: true };
}

function startPush(channel, configOverride) {
  const channelId = channel.id;
  stopPush(channelId);

  const config = configOverride || configFromChannel(channel);
  if (!config.rtmp?.enabled && !config.rtmp?.push_url) {
    const err = new Error('RTMP Push no configurado');
    err.status = 400;
    throw err;
  }

  const source = primarySourceUrl(config, channel.stream_url);
  const dest = buildRtmpDestination(config.rtmp.push_url, config.rtmp.stream_key);
  if (!source) {
    const err = new Error('No hay fuente de entrada');
    err.status = 400;
    throw err;
  }
  if (!dest) {
    const err = new Error('URL RTMP de destino requerida');
    err.status = 400;
    throw err;
  }

  const args = ['-hide_banner', '-loglevel', 'warning'];

  const headers = [];
  const referer = config.advanced?.referer || config.sources?.[0]?.referer;
  const ua = config.advanced?.user_agent || config.sources?.[0]?.user_agent || 'Mozilla/5.0';
  if (referer) headers.push(`Referer: ${referer}`);
  headers.push(`User-Agent: ${ua}`);
  if (config.advanced?.custom_headers) {
    config.advanced.custom_headers.split('\n').forEach((line) => {
      const t = line.trim();
      if (t && t.includes(':')) headers.push(t);
    });
  }
  if (headers.length) args.push('-headers', `${headers.join('\r\n')}\r\n`);

  const isHls = /\.m3u8/i.test(source);
  args.push('-re', '-i', source);

  if (config.servers?.transcode_profile === 'transcode' || isHls) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-maxrate', '2500k', '-bufsize', '5000k', '-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-c', 'copy');
  }

  args.push('-f', 'flv', dest);

  if (config.advanced?.ffmpeg_options) {
    const extra = config.advanced.ffmpeg_options.trim().split(/\s+/).filter(Boolean);
    args.splice(args.length - 3, 0, ...extra);
  }

  const proc = spawn('ffmpeg', args, { detached: false });
  activePushes.set(channelId, {
    process: proc,
    startedAt: Date.now(),
    target: dest,
    source
  });

  proc.on('exit', () => activePushes.delete(channelId));
  proc.stderr?.on('data', () => { /* consume */ });

  return {
    started: true,
    pid: proc.pid,
    target: dest,
    source
  };
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
  activePushes
};
