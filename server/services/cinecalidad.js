const https = require('https');
const http = require('http');
const { resolveVimeosEmbedUrl, maxHeightFromM3u8 } = require('./vimeosEmbed');

const BASE = 'https://www.cinecalidad.am';
const REFERER = `${BASE}/`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', Referer: REFERER }
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

function slugFromInput(slugOrUrl) {
  const raw = String(slugOrUrl || '').trim();
  if (raw.startsWith('http')) {
    const m = raw.match(/\/ver-pelicula\/([^/?#]+)/i);
    return m?.[1]?.replace(/\/$/, '') || '';
  }
  return raw.replace(/^\/+|\/+$/g, '');
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

function extractEmbeds(html) {
  const embeds = [];
  const seen = new Set();
  const add = (url, type) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    embeds.push({ type, url });
  };
  for (const m of html.matchAll(/https?:\/\/vimeos\.net\/embed-[a-z0-9]+\.html/gi)) {
    add(m[0], 'vimeos');
  }
  for (const m of html.matchAll(/https?:\/\/[^"'\s]*goodstream[^"'\s]*/gi)) {
    add(m[0], 'goodstream');
  }
  for (const m of html.matchAll(/https?:\/\/(?:hlswish|wishfast)\.com\/e\/[a-z0-9]+/gi)) {
    add(m[0], 'hlswish');
  }
  return embeds;
}

function extractDownloads(html) {
  const out = [];
  const re = /href=["']([^"']*\?download=[^"']+)["'][^>]*>([^<]*(?:1080|720|480|HD|Full|SD)[^<]*)</gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1].startsWith('http') ? m[1] : new URL(m[1], BASE).href;
    out.push({ label: m[2].trim(), url });
  }
  return out;
}

async function parseMoviePage(slugOrUrl) {
  const slug = slugFromInput(slugOrUrl);
  if (!slug) throw new Error('Slug Cinecalidad inválido');
  const url = `${BASE}/ver-pelicula/${slug}/`;
  const html = await fetchHtml(url);
  if (/404|no encontrada/i.test(html) && html.length < 80000) {
    throw new Error(`Cinecalidad: página no encontrada (${slug})`);
  }
  const ld = parseJsonLd(html);
  const title = (ld?.name || slug.replace(/-/g, ' ')).replace(/\s*\(\d{4}\)\s*$/, '').trim();
  const year = parseInt(ld?.datePublished?.slice(0, 4) || slug.match(/-(\d{4})$/)?.[1] || '0', 10) || null;
  const poster = ld?.image || ld?.thumbnailUrl || '';
  const ogPoster = html.match(/property=["']og:image["']\s+content=["']([^"']+)/i)?.[1] || '';
  return {
    slug,
    title,
    year,
    url,
    poster: poster || ogPoster,
    embeds: extractEmbeds(html),
    downloads: extractDownloads(html),
    overview: ld?.description || ''
  };
}

async function resolveBestStream(page, quality = 'max') {
  const embeds = page.embeds || [];
  const minH = { max: 720, '1080': 1080, '720': 720, '480': 360 }[quality] || 720;

  for (const emb of embeds.filter((e) => e.type === 'vimeos')) {
    try {
      const m3u8 = await resolveVimeosEmbedUrl(emb.url, emb.url);
      let maxHeight = await maxHeightFromM3u8(m3u8, emb.url);
      if (!maxHeight) {
        try {
          const { probeStreamMaxHeight } = require('./vodYtDlp');
          const probe = probeStreamMaxHeight(m3u8, emb.url);
          maxHeight = probe.maxHeight || 0;
        } catch { /* ignore */ }
      }
      if (!maxHeight) maxHeight = 720;
      if (quality !== 'max' && maxHeight < minH) continue;
      console.log(`[cinecalidad] ${page.title}: hasta ${maxHeight}p (vimeos)`);
      return {
        m3u8,
        referer: emb.url,
        embedUrl: emb.url,
        type: 'vimeos-hls',
        maxHeight,
        width: 0,
        height: maxHeight
      };
    } catch (err) {
      console.warn(`[cinecalidad] vimeos ${page.slug}:`, err.message);
    }
  }

  const gs = embeds.find((e) => e.type === 'goodstream');
  if (gs?.url) {
    return { m3u8: null, referer: REFERER, embedUrl: gs.url, type: 'goodstream', maxHeight: 1080 };
  }

  const hls = embeds.find((e) => e.type === 'hlswish');
  if (hls?.url) {
    return { m3u8: null, referer: REFERER, embedUrl: hls.url, type: 'hlswish', maxHeight: 720 };
  }

  throw new Error('Sin reproductor descargable en Cinecalidad (prueba Cuevana o AllCalidad)');
}

function parseSearchLinks(html, query = '') {
  const links = new Set();
  const re = /href=["'](https:\/\/www\.cinecalidad\.am\/ver-pelicula\/[a-z0-9-]+)\/?["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1].split('/ver-pelicula/')[1]?.replace(/\/$/, '');
    if (!slug || /online-gratis-en-cinecalidad$/i.test(slug)) continue;
    links.add(slug);
  }
  return [...links];
}

async function searchByName(query, limit = 12) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `${BASE}/?s=${encodeURIComponent(q)}`;
  const html = await fetchHtml(url);
  const slugs = parseSearchLinks(html, q);
  const results = [];
  for (const slug of slugs.slice(0, limit + 4)) {
    if (results.length >= limit) break;
    try {
      const page = await parseMoviePage(slug);
      results.push({
        type: 'movie',
        source: 'cinecalidad',
        slug: page.slug,
        title: page.title,
        year: page.year,
        poster: page.poster,
        url: page.url,
        overview: page.overview || ''
      });
    } catch { /* ignore */ }
  }
  return results;
}

module.exports = {
  BASE,
  REFERER,
  fetchHtml,
  parseMoviePage,
  resolveBestStream,
  searchByName,
  slugFromInput
};
