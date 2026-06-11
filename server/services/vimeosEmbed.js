const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function fetchHtml(url, referer = 'https://vimeos.net/') {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': UA, Referer: referer, Accept: 'text/html' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchHtml(next, referer).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function unpackVimeosPlayerScript(html) {
  const m = html.match(/return p\}\('((?:\\'|[^'])*)',(\d+),(\d+),'([^']*)'\.split\('\|'\)\)/);
  if (!m) return null;
  let p = m[1].replace(/\\'/g, "'");
  const radix = parseInt(m[2], 10);
  let c = parseInt(m[3], 10);
  const k = m[4].split('|');
  while (c--) {
    if (k[c]) p = p.replace(new RegExp(`\\b${c.toString(radix)}\\b`, 'g'), k[c]);
  }
  const file = p.match(/file:\s*"([^"]+)"/);
  return file?.[1] || null;
}

async function resolveVimeosEmbedUrl(embedPageUrl, referer = 'https://vimeos.net/') {
  const html = await fetchHtml(embedPageUrl, referer);
  const m3u8 = unpackVimeosPlayerScript(html);
  if (!m3u8 || !/\.m3u8/i.test(m3u8)) {
    throw new Error('No se encontró stream m3u8 en vimeos');
  }
  return m3u8;
}

/** Altura máxima leyendo variantes del master.m3u8 (cuando yt-dlp no puede sondear). */
async function maxHeightFromM3u8(m3u8Url, referer) {
  try {
    const text = await fetchHtml(m3u8Url, referer);
    const heights = [...text.matchAll(/RESOLUTION=\d+x(\d+)/gi)].map((m) => parseInt(m[1], 10));
    return heights.length ? Math.max(...heights) : 0;
  } catch {
    return 0;
  }
}

module.exports = {
  fetchHtml,
  unpackVimeosPlayerScript,
  resolveVimeosEmbedUrl,
  maxHeightFromM3u8
};
