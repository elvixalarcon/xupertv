const https = require('https');
const http = require('http');

const BASE = 'https://cuevana3.cl';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const PROXY_HOST = 'tungtungsahur.cuevana3.cl';
const DECRYPT_KEY = 'a45f04ce-2394-47c3-b718-0ecd97ce51d6';
const HOST_PREFIX = {
  1: 'https://minochinos.com/v/',
  2: 'https://filemoon.sx/e/',
  3: 'https://hanerix.com/e/',
  4: 'https://dood.li/e/'
};

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', Referer: BASE }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchHtml(next).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function decryptToken(token) {
  if (!token || token.length < 2) return null;
  const sid = token[0];
  const prefix = HOST_PREFIX[sid];
  if (!prefix) return null;
  const raw = Buffer.from(token.slice(1), 'base64').toString('binary');
  let path = '';
  for (let i = 0; i < raw.length; i++) {
    path += String.fromCharCode(raw.charCodeAt(i) ^ DECRYPT_KEY.charCodeAt(i % DECRYPT_KEY.length));
  }
  return prefix + path;
}

function decodeProxyUrl(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    if (!u.hostname.includes(PROXY_HOST)) return null;
    if (u.searchParams.has('v')) {
      return Buffer.from(u.searchParams.get('v'), 'base64').toString('utf8');
    }
    if (u.searchParams.has('token')) {
      return decryptToken(u.searchParams.get('token'));
    }
  } catch { /* ignore */ }
  return null;
}

function unpackPackerM3u8(html) {
  const m = html.match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split/);
  if (!m) return null;
  let packed = m[1];
  const radix = parseInt(m[2], 10);
  let count = parseInt(m[3], 10);
  const dict = m[4].split('|');
  while (count--) {
    if (dict[count]) {
      packed = packed.replace(new RegExp(`\\b${count.toString(radix)}\\b`, 'g'), dict[count]);
    }
  }
  return packed.match(/https?:[^"'\s]+\.m3u8[^"'\s]*/)?.[0] || null;
}

async function resolveM3u8FromHostPage(hostUrl) {
  const html = await fetchHtml(hostUrl);
  return unpackPackerM3u8(html);
}

function parseJsonLd(html) {
  const blocks = [...html.matchAll(/<script type=application\/ld\+json>\s*([\s\S]*?)\s*<\/script>/gi)];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b[1]);
      if (data['@type'] === 'Movie') return data;
    } catch { /* ignore */ }
  }
  return null;
}

function parseMovieLinks(html) {
  const links = new Set();
  const re = /href="(https:\/\/cuevana3\.cl\/pelicula\/[a-z0-9-]+)"/gi;
  let m;
  while ((m = re.exec(html))) links.add(m[1]);
  return [...links];
}

function parseGenres(html) {
  const genres = [];
  const re = /href="https:\/\/cuevana3\.cl\/peliculas\?genero=([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    genres.push(m[1].replace(/-/g, ' '));
  }
  return [...new Set(genres)].slice(0, 4);
}

async function parseMoviePage(urlOrSlug) {
  const url = urlOrSlug.startsWith('http')
    ? urlOrSlug
    : `${BASE}/pelicula/${urlOrSlug.replace(/^\/+|\/+$/g, '')}`;
  const slug = url.match(/\/pelicula\/([^/?#]+)/i)?.[1] || '';
  const html = await fetchHtml(url);
  const ld = parseJsonLd(html);
  const title = ld?.name || (html.match(/<title>Película ([^<]+) Gratis/i)?.[1] || slug).trim();
  const yearMatch = html.match(/Película[^<]*\((\d{4})\)/i) || title.match(/\((\d{4})\)/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : 0;
  const rating = ld?.aggregateRating?.ratingValue
    ? parseFloat(ld.aggregateRating.ratingValue)
    : null;

  const servers = [];
  const reServer = /data-server="(https:\/\/tungtungsahur[^"]+)"/gi;
  let sm;
  while ((sm = reServer.exec(html))) {
    const resolved = decodeProxyUrl(sm[1].replace(/&amp;/g, '&'));
    if (resolved) servers.push({ proxy: sm[1], host: resolved });
  }

  let tmdbId = null;
  for (const s of servers) {
    const m = s.host.match(/tmdb[=\/](\d+)/i) || s.proxy.match(/movie\/(\d+)/i);
    if (m) { tmdbId = parseInt(m[1], 10); break; }
  }
  if (!tmdbId) {
    const b64 = [...html.matchAll(/tungtungsahur[^"']+\?v=([A-Za-z0-9+/=]+)/g)];
    for (const b of b64) {
      try {
        const decoded = Buffer.from(b[1], 'base64').toString('utf8');
        const tm = decoded.match(/tmdb[=\/](\d+)/i) || decoded.match(/\/movie\/(\d+)/i);
        if (tm) { tmdbId = parseInt(tm[1], 10); break; }
      } catch { /* ignore */ }
    }
  }

  return {
    slug,
    url,
    title: title.replace(/\s*\(\d{4}\)\s*$/, '').trim(),
    year,
    description: ld?.description || '',
    rating,
    genres: parseGenres(html),
    tmdb_id: tmdbId,
    servers
  };
}

async function resolveBestStream(movie, quality = '1080') {
  const { probeStreamMaxHeight } = require('./vodYtDlp');
  const referer = 'https://cuevana3.cl/';
  const hosts = movie.servers?.map((s) => s.host).filter(Boolean) || [];
  let best = null;

  for (const host of hosts) {
    try {
      const m3u8 = await resolveM3u8FromHostPage(host);
      if (!m3u8) continue;
      const probe = probeStreamMaxHeight(m3u8, referer);
      if (!best || probe.maxHeight > best.maxHeight) {
        best = { m3u8, host, ...probe };
      }
    } catch (err) {
      console.warn('[cuevana] stream', host, err.message);
    }
  }

  if (best) {
    console.log(
      `[cuevana] ${movie.title || movie.slug}: ${best.maxHeight || '?'}p max (${best.host?.split('/')[2] || 'host'})`
    );
    if ((best.maxHeight || 0) < 720) {
      console.warn(`[cuevana] ${movie.title}: fuente solo ${best.maxHeight}p — AllCalidad suele tener mejor calidad`);
    }
    return best;
  }
  return null;
}

async function collectMovieUrls(options = {}) {
  const years = options.years || [2026, 2025, 2024];
  const genres = options.genres || ['terror', 'ciencia-ficcion', 'accion', 'drama', 'comedia', 'suspenso'];
  const extraPages = options.extraPages || 2;
  const urls = new Set(options.slugs?.map((s) => `${BASE}/pelicula/${s}`) || []);

  urls.add(`${BASE}/`);
  for (const y of years) {
    for (let p = 1; p <= extraPages; p++) {
      urls.add(`${BASE}/peliculas?ano=${y}${p > 1 ? `&page=${p}` : ''}`);
    }
  }
  for (const g of genres) {
    urls.add(`${BASE}/peliculas?genero=${g}`);
  }

  const movieLinks = new Set();
  for (const pageUrl of urls) {
    try {
      const html = await fetchHtml(pageUrl);
      for (const link of parseMovieLinks(html)) movieLinks.add(link);
    } catch (err) {
      console.warn('[cuevana] list', pageUrl, err.message);
    }
  }

  const out = [];
  for (const link of movieLinks) {
    try {
      const meta = await parseMoviePage(link);
      if (!options.yearFilter || options.yearFilter.includes(meta.year)) {
        out.push(meta);
      }
    } catch (err) {
      console.warn('[cuevana] meta', link, err.message);
    }
  }

  const seen = new Set();
  return out.filter((m) => {
    if (seen.has(m.slug)) return false;
    seen.add(m.slug);
    return true;
  });
}

module.exports = {
  BASE,
  fetchHtml,
  parseMovieLinks,
  parseMoviePage,
  decryptToken,
  decodeProxyUrl,
  resolveM3u8FromHostPage,
  resolveBestStream,
  collectMovieUrls
};
