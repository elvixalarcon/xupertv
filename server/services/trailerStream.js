const http = require('http');
const https = require('https');
const { URL } = require('url');
const { ytdlpJson } = require('./vodYtDlp');

const cache = new Map();
const CACHE_TTL_MS = 45 * 60 * 1000;

function normalizeVideoId(raw) {
  const s = String(raw || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?(?:[^&]*&)*v=))([A-Za-z0-9_-]{11})/i);
  return m ? m[1] : '';
}

function pickTrailerFormat(formats) {
  const list = (formats || [])
    .filter((f) => f.url && f.vcodec && f.vcodec !== 'none')
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  const mp4 = list.find((f) => f.ext === 'mp4' && (f.acodec && f.acodec !== 'none'));
  if (mp4) return mp4;
  const hls = list.find((f) => f.protocol === 'm3u8_native' || f.ext === 'm3u8' || /\.m3u8/i.test(f.url || ''));
  if (hls) return hls;
  return list.find((f) => f.acodec && f.acodec !== 'none') || list[0] || null;
}

async function resolveYoutubeTrailer(videoId) {
  const id = normalizeVideoId(videoId);
  if (!id) throw new Error('ID de YouTube inválido');

  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return hit;

  const pageUrl = `https://www.youtube.com/watch?v=${id}`;
  const data = ytdlpJson(pageUrl);
  const format = pickTrailerFormat(data.formats);
  if (!format?.url) throw new Error('No se pudo obtener el tráiler');

  const entry = {
    videoId: id,
    title: data.title || 'Tráiler',
    upstreamUrl: format.url,
    mime: format.ext === 'm3u8' || format.protocol === 'm3u8_native'
      ? 'application/vnd.apple.mpegurl'
      : (format.ext === 'webm' ? 'video/webm' : 'video/mp4'),
    height: format.height || 0,
    expires: Date.now() + CACHE_TTL_MS
  };
  cache.set(id, entry);
  return entry;
}

function proxyUpstream(upstreamUrl, req, res) {
  const target = new URL(upstreamUrl);
  const client = target.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    Accept: '*/*',
    Referer: 'https://www.youtube.com/',
    Origin: 'https://www.youtube.com'
  };
  if (req.headers.range) headers.Range = req.headers.range;

  const proxyReq = client.request(target, { method: req.method, headers }, (proxyRes) => {
    const out = { ...proxyRes.headers };
    delete out['content-security-policy'];
    delete out['x-frame-options'];
    res.writeHead(proxyRes.statusCode || 200, out);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.status(502).json({ error: err.message });
    else res.end();
  });
  proxyReq.end();
}

module.exports = {
  normalizeVideoId,
  resolveYoutubeTrailer,
  proxyUpstream
};
