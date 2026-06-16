const https = require('https');
const http = require('http');
const { ACCEPT_LANGUAGE_ES_LATAM } = require('./spanishLatino');
const { resolveVimeosEmbedUrl, maxHeightFromM3u8 } = require('./vimeosEmbed');

const BASE = 'https://www.cinecalidad.am';
const REFERER = `${BASE}/`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', Referer: REFERER, 'Accept-Language': ACCEPT_LANGUAGE_ES_LATAM }
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

const JSON_LD_TYPES = new Set(['Movie', 'TVSeries', 'Series', 'VideoObject']);

function parseJsonLd(html) {
  const blocks = [...html.matchAll(/<script type=application\/ld\+json>\s*([\s\S]*?)\s*<\/script>/gi)];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b[1]);
      if (JSON_LD_TYPES.has(data['@type'])) return data;
      if (Array.isArray(data['@graph'])) {
        const hit = data['@graph'].find((node) => JSON_LD_TYPES.has(node['@type']));
        if (hit) return hit;
      }
    } catch { /* ignore */ }
  }
  return null;
}

function cleanSeriesSlugTitle(slug) {
  return String(slug || '')
    .replace(/-online-gratis-en-cinecalidad$/i, '')
    .replace(/-\d{4}$/, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSeriesTitleFromHtml(html, slug) {
  const ogTitle = html.match(/property=["']og:title["']\s+content=["']([^"']+)/i)?.[1]
    || html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i)?.[1];
  if (ogTitle) {
    const cleaned = ogTitle
      .replace(/^Ver Serie\s+/i, '')
      .replace(/\s+Online Gratis.*$/i, '')
      .replace(/\s*-\s*Cinecalidad.*$/i, '')
      .trim();
    if (cleaned) return cleaned;
  }
  const h1 = html.match(/<h1(?![^>]*h1titlecc)[^>]*>([^<]+)/i)?.[1]?.trim();
  if (h1) {
    return h1.replace(/\s+online.*$/i, '').trim();
  }
  return cleanSeriesSlugTitle(slug);
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

async function resolveFastStream(page) {
  const embeds = page.embeds || [];

  for (const emb of embeds.filter((e) => e.type === 'vimeos')) {
    try {
      const m3u8 = await resolveVimeosEmbedUrl(emb.url, emb.url);
      if (!m3u8) continue;
      let maxHeight = await maxHeightFromM3u8(m3u8, emb.url);
      if (!maxHeight) maxHeight = 1080;
      console.log(`[cinecalidad] fast ${page.title}: vimeos ${maxHeight}p`);
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
      console.warn(`[cinecalidad] fast vimeos ${page.slug}:`, err.message);
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

  return null;
}

async function resolveBestStream(page, quality = 'max') {
  const fast = await resolveFastStream(page);
  if (fast) {
    const minH = { max: 720, '1080': 1080, '720': 720, '480': 360 }[quality] || 720;
    if (quality === 'max' || (fast.maxHeight || 0) >= minH) return fast;
  }

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

function seriesSlugFromInput(slugOrUrl) {
  const raw = String(slugOrUrl || '').trim();
  if (raw.startsWith('http')) {
    const m = raw.match(/\/ver-serie\/([^/?#]+)/i);
    return m?.[1]?.replace(/\/$/, '') || '';
  }
  return raw.replace(/^\/+|\/+$/g, '');
}

async function parseSeriesPage(slugOrUrl) {
  const slug = seriesSlugFromInput(slugOrUrl);
  if (!slug) throw new Error('Slug serie Cinecalidad inválido');
  const url = `${BASE}/ver-serie/${slug}/`;
  const html = await fetchHtml(url);
  const ld = parseJsonLd(html);
  const title = (ld?.name || parseSeriesTitleFromHtml(html, slug)).replace(/\s*\(\d{4}\)\s*$/, '').trim();
  const year = parseInt(
    ld?.datePublished?.slice(0, 4)
      || ld?.startDate?.slice(0, 4)
      || slug.match(/-(\d{4})$/)?.[1]
      || '0',
    10
  ) || null;
  const ogPoster = html.match(/property=["']og:image["']\s+content=["']([^"']+)/i)?.[1]
    || html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i)?.[1]
    || '';
  const ldPoster = typeof ld?.image === 'string' ? ld.image : (ld?.image?.url || ld?.thumbnailUrl || '');
  const poster = ldPoster || ogPoster || '';
  const episodes = [];
  const epRe = /href=["']([^"']*\/ver-el-episodio\/([^"']+))\/?["'][^>]*>([^<]+)</gi;
  let m;
  while ((m = epRe.exec(html))) {
    const epSlug = m[2].replace(/\/$/, '');
    const parts = epSlug.match(/-(\d+)x(\d+)$/i);
    if (!parts) continue;
    const linkTitle = String(m[3] || '').replace(/\s+/g, ' ').trim();
    episodes.push({
      slug: epSlug,
      season_number: parseInt(parts[1], 10),
      episode_number: parseInt(parts[2], 10),
      title: linkTitle || `Episodio ${parts[2]}`
    });
  }
  return { slug, title, year, url, poster, overview: ld?.description || '', episodes };
}

async function parseEpisodePage(slugOrUrl) {
  let slug = String(slugOrUrl || '').trim();
  if (slug.startsWith('http')) {
    slug = slug.match(/\/ver-el-episodio\/([^/?#]+)/i)?.[1]?.replace(/\/$/, '') || '';
  }
  const url = `${BASE}/ver-el-episodio/${slug}/`;
  const html = await fetchHtml(url);
  const ld = parseJsonLd(html);
  return {
    slug,
    url,
    title: (ld?.name || slug.replace(/-/g, ' ')).trim(),
    overview: ld?.description || '',
    embeds: extractEmbeds(html)
  };
}

async function resolveCinecalidadEpisodeUrl(seriesSlug, season, episode, quality = '1080') {
  const base = seriesSlugFromInput(seriesSlug).replace(/-online-gratis-en-cinecalidad$/i, '');
  const epSlug = `${base}-${season}x${episode}`;
  const page = await parseEpisodePage(epSlug);
  const stream = await resolveBestStream(page, quality);
  return {
    url: stream.m3u8 || stream.embedUrl,
    referer: stream.referer || REFERER,
    maxHeight: stream.maxHeight || 0,
    type: stream.type
  };
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
  parseSeriesPage,
  cleanSeriesSlugTitle,
  parseSeriesTitleFromHtml,
  parseEpisodePage,
  resolveBestStream,
  resolveFastStream,
  resolveCinecalidadEpisodeUrl,
  searchByName,
  slugFromInput,
  seriesSlugFromInput
};
