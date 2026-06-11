const { execFile } = require('child_process');
const { promisify } = require('util');
const https = require('https');
const http = require('http');

const execFileAsync = promisify(execFile);

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const DEFAULT_REFERER = 'https://tv.vixred.com/';

function extractError(err) {
  const stderr = (err.stderr || '').toString().trim();
  const stdout = (err.stdout || '').toString().trim();
  const text = stderr || stdout || err.message || 'Error al escanear';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => /error|404|403|401|failed|invalid|denied|timeout/i.test(l))
    || lines.find((l) => !l.startsWith('{') && !l.startsWith('}'))
    || lines[lines.length - 1]
    || 'Error al escanear';
  return line.replace(/^https?:\/\/\S+:\s*/, '').slice(0, 220);
}

function probeHttp(url, opts = {}) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const reqOpts = {
      method: 'GET',
      timeout: (opts.timeout || 15) * 1000,
      headers: {
        'User-Agent': opts.user_agent || DEFAULT_UA,
        Accept: '*/*',
        ...(opts.referer ? { Referer: opts.referer } : { Referer: DEFAULT_REFERER })
      }
    };
    if (url.startsWith('https')) reqOpts.rejectUnauthorized = false;

    const req = client.get(url, reqOpts, (res) => {
      let body = '';
      res.on('data', (c) => {
        if (body.length < 2048) body += c;
      });
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        const isM3u8Body = body.includes('#EXTM3U') || /mpegurl/i.test(ct);
        if (res.statusCode >= 200 && res.statusCode < 300 && isM3u8Body) {
          const segs = (body.match(/#EXTINF/g) || []).length;
          const parts = [`HTTP ${res.statusCode}`];
          if (ct) parts.push(ct.split(';')[0]);
          parts.push(segs ? `HLS · ${segs} entradas` : 'HLS playlist');
          resolve({ ok: true, status: 'ok', info: parts.join(' · ') });
        } else {
          resolve({
            ok: false,
            status: 'error',
            info: `HTTP ${res.statusCode}${res.statusMessage ? ` ${res.statusMessage}` : ''}`
          });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, status: 'error', info: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 'error', info: 'Timeout de conexión' });
    });
  });
}

async function scanSourceUrl(url, opts = {}) {
  if (!url) return { ok: false, status: 'error', info: 'URL vacía' };

  const userAgent = opts.user_agent || DEFAULT_UA;
  const referer = opts.referer || DEFAULT_REFERER;

  const args = [
    '-hide_banner',
    '-v', 'error',
    '-probesize', '8000000',
    '-analyzeduration', '8000000',
    '-rw_timeout', '15000000'
  ];

  if (/^https:\/\//i.test(url)) {
    args.unshift('-tls_verify', '0');
  }

  const headers = [`User-Agent: ${userAgent}`, `Referer: ${referer}`];
  if (opts.custom_headers) {
    opts.custom_headers.split('\n').forEach((line) => {
      const t = line.trim();
      if (t && t.includes(':')) headers.push(t);
    });
  }
  args.push('-headers', `${headers.join('\r\n')}\r\n`);

  args.push(
    '-show_entries', 'format=duration,format_name:stream=codec_name,codec_type,width,height,bit_rate',
    '-of', 'json',
    url
  );

  try {
    const { stdout } = await execFileAsync('ffprobe', args, {
      timeout: (opts.timeout || 30) * 1000,
      maxBuffer: 2 * 1024 * 1024
    });
    const data = JSON.parse(stdout || '{}');
    const streams = data.streams || [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    const fmt = data.format || {};
    const parts = [];
    if (video) parts.push(`${video.codec_name || 'video'} ${video.width || '?'}x${video.height || '?'}`);
    if (audio) parts.push(audio.codec_name || 'audio');
    else parts.push('sin audio');
    if (fmt.format_name) parts.push(fmt.format_name);
    if (fmt.duration && parseFloat(fmt.duration) > 0) parts.push(`${Math.round(parseFloat(fmt.duration))}s`);
    const hasAudio = !!audio;
    return {
      ok: hasAudio,
      status: hasAudio ? 'ok' : 'warning',
      info: parts.length ? parts.join(' · ') : (hasAudio ? 'Stream detectado' : 'Sin pista de audio')
    };
  } catch (err) {
    const httpResult = await probeHttp(url, { user_agent: userAgent, referer, timeout: opts.timeout });
    if (httpResult.ok) return httpResult;
    return {
      ok: false,
      status: 'error',
      info: extractError(err) || httpResult.info || 'No se pudo analizar la fuente'
    };
  }
}

async function scanSources(sources, globalOpts = {}) {
  const results = [];
  for (const src of sources) {
    const r = await scanSourceUrl(src.url, {
      referer: src.referer || globalOpts.referer,
      user_agent: src.user_agent || globalOpts.user_agent,
      custom_headers: globalOpts.custom_headers,
      timeout: globalOpts.timeout
    });
    results.push({
      url: src.url,
      scan_status: r.status,
      scan_info: r.info
    });
  }
  return results;
}

module.exports = { scanSourceUrl, scanSources };
