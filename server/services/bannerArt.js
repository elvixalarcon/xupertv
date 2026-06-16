const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const db = require('../db');
const { getTmdbApiKey } = require('./settings');
const { fetchJson, resolveMoviePoster, fetchTmdbMovieDetails, isPlaceholderPoster, absolutePosterUrl } = require('./posters');

const DATA = path.join(__dirname, '..', '..', 'data');
const BANNER_DIR = path.join(DATA, 'posters', 'banners');
const BANNER_W = 1280;
const BANNER_H = 720;
const REQUEST_DELAY_MS = 280;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapTitle(title, maxLen = 28) {
  const words = String(title || 'Película').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxLen && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'VixTV/1.0', Accept: 'image/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function fetchTmdbImages(tmdbId, contentType) {
  const key = getTmdbApiKey();
  if (!key || !tmdbId) return { logos: [], backdrops: [], posters: [] };
  const kind = contentType === 'series' ? 'tv' : 'movie';
  try {
    const data = await fetchJson(
      `https://api.themoviedb.org/3/${kind}/${tmdbId}/images?api_key=${key}`
    );
    return {
      logos: data.logos || [],
      backdrops: data.backdrops || [],
      posters: data.posters || []
    };
  } catch {
    return { logos: [], backdrops: [], posters: [] };
  }
}

function pickBestLogo(logos) {
  if (!logos?.length) return '';
  const score = (x) => {
    let s = 0;
    const lang = x.iso_639_1;
    if (lang === 'es') s += 120;
    else if (lang === 'en') s += 100;
    else if (!lang) s += 80;
    const ar = (x.width || 1) / Math.max(x.height || 1, 1);
    if (ar >= 1.1) s += 60;
    s += Math.min(x.width || 0, 2400) / 40;
    s += Math.min(x.vote_average || 0, 10) * 5;
    return s;
  };
  const best = [...logos].sort((a, b) => score(b) - score(a))[0];
  return best?.file_path ? `https://image.tmdb.org/t/p/w500${best.file_path}` : '';
}

function pickBestBackdrop(backdrops, fallback = '') {
  if (fallback) return fallback;
  if (!backdrops?.length) return '';
  const best = [...backdrops].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0];
  return best?.file_path ? `https://image.tmdb.org/t/p/w1280${best.file_path}` : '';
}

function bannerCachePath(contentType, id) {
  return path.join(BANNER_DIR, `${contentType}-${id}.jpg`);
}

function bannerPublicPath(contentType, id) {
  return `/api/posters/banners/${contentType}-${id}.jpg`;
}

function buildTitleOverlaySvg(title, year) {
  const lines = wrapTitle(title);
  const lineEls = lines.map((l, i) =>
    `<text x="56" y="${BANNER_H - 88 + i * 42}" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="700" fill="#ffffff">${escapeXml(l)}</text>`
  ).join('');
  const yearEl = year
    ? `<text x="56" y="${BANNER_H - 20}" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#f5c518">${escapeXml(String(year))}</text>`
    : '';
  return Buffer.from(`<svg width="${BANNER_W}" height="${BANNER_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.82"/>
    </linearGradient>
  </defs>
  <rect width="${BANNER_W}" height="${BANNER_H}" fill="url(#g)"/>
  ${lineEls}
  ${yearEl}
</svg>`);
}

function buildGradientFallbackSvg(title, year) {
  const hash = String(title || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = hash % 360;
  const lines = wrapTitle(title);
  const lineEls = lines.map((l, i) =>
    `<text x="640" y="${320 + i * 44}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="700" fill="#ffffff">${escapeXml(l)}</text>`
  ).join('');
  const yearEl = year
    ? `<text x="640" y="${460}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="24" fill="#f5c518">${escapeXml(String(year))}</text>`
    : '';
  return Buffer.from(`<svg width="${BANNER_W}" height="${BANNER_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:hsl(${hue},48%,16%)"/>
      <stop offset="100%" style="stop-color:hsl(${(hue + 42) % 360},58%,26%)"/>
    </linearGradient>
  </defs>
  <rect width="${BANNER_W}" height="${BANNER_H}" fill="url(#bg)"/>
  ${lineEls}
  ${yearEl}
</svg>`);
}

function invalidateBannerCache(contentType, id) {
  if (!id) return;
  const out = bannerCachePath(contentType, id);
  if (fs.existsSync(out)) {
    try { fs.unlinkSync(out); } catch { /* ignore */ }
  }
}

async function ensureBannerFile(row, contentType) {
  if (!row?.id) throw new Error('Sin id');
  fs.mkdirSync(BANNER_DIR, { recursive: true });
  const out = bannerCachePath(contentType, row.id);
  if (fs.existsSync(out) && fs.statSync(out).size > 2048) return out;

  if (!sharp) {
    throw new Error('sharp no instalado');
  }

  const tmdbId = row.tmdb_id;
  const title = row.title || '';
  const year = row.year || '';
  let backdrop = row.backdrop || '';
  let logoUrl = '';

  if (tmdbId && getTmdbApiKey()) {
    const images = await fetchTmdbImages(tmdbId, contentType);
    backdrop = pickBestBackdrop(images.backdrops, backdrop);
    logoUrl = pickBestLogo(images.logos);
    if (!backdrop && images.posters[0]?.file_path) {
      backdrop = `https://image.tmdb.org/t/p/w1280${images.posters[0].file_path}`;
    }
  }
  if (!backdrop && getTmdbApiKey() && contentType === 'movie') {
    try {
      const details = await fetchTmdbMovieDetails(title, year);
      backdrop = details.backdrop || details.poster || backdrop;
      if (!tmdbId && details.tmdb_id) {
        db.prepare('UPDATE movies SET tmdb_id = ? WHERE id = ?').run(details.tmdb_id, row.id);
      }
    } catch { /* opcional */ }
  }
  if (!backdrop) {
    const resolvedPoster = await resolveMoviePoster(title, year);
    if (resolvedPoster) backdrop = resolvedPoster;
  }
  if (!backdrop && row.poster && !isPlaceholderPoster(row.poster)) {
    backdrop = absolutePosterUrl(row.poster, process.env.PUBLIC_BASE_URL || '');
    if (!backdrop && row.poster.startsWith('http')) backdrop = row.poster;
  }

  const composites = [];
  let base;

  if (backdrop) {
    try {
      const buf = await fetchBuffer(backdrop);
      base = sharp(buf).resize(BANNER_W, BANNER_H, { fit: 'cover', position: 'centre' });
    } catch {
      base = null;
    }
  }

  if (!base) {
    const svg = buildGradientFallbackSvg(title, year);
    await sharp(svg).jpeg({ quality: 86 }).toFile(out);
    return out;
  }

  let hasLogo = false;
  if (logoUrl) {
    try {
      const logoBuf = await fetchBuffer(logoUrl);
      const logoPng = await sharp(logoBuf)
        .resize({
          width: Math.floor(BANNER_W * 0.48),
          height: Math.floor(BANNER_H * 0.38),
          fit: 'inside',
          withoutEnlargement: false
        })
        .png()
        .toBuffer();
      const meta = await sharp(logoPng).metadata();
      const logoH = meta.height || Math.floor(BANNER_H * 0.32);
      composites.push({
        input: buildTitleOverlaySvg(title, year),
        blend: 'over'
      });
      composites.push({
        input: logoPng,
        left: 48,
        top: BANNER_H - logoH - 40
      });
      hasLogo = true;
    } catch { /* logo opcional */ }
  }
  if (!hasLogo) {
    composites.push({ input: buildTitleOverlaySvg(title, year), blend: 'over' });
  }

  await base.composite(composites).jpeg({ quality: 86 }).toFile(out);
  return out;
}

function bannerUrlForItem(item) {
  if (!item?.id) return '';
  const type = item.content_type === 'series' ? 'series' : 'movie';
  return bannerPublicPath(type, item.id);
}

async function enrichHeroBanners(slides) {
  if (!Array.isArray(slides) || !slides.length) return slides;
  return Promise.all(slides.map(async (slide) => {
    const contentType = slide.content_type || 'movie';
    const table = contentType === 'series' ? 'series' : 'movies';
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(slide.id);
    if (!row) return { ...slide, banner: bannerUrlForItem({ id: slide.id, content_type: contentType }) };
    try {
      await ensureBannerFile(row, contentType);
    } catch (err) {
      console.warn('[banner]', contentType, slide.id, err.message || err);
    }
    return { ...slide, banner: bannerUrlForItem({ id: slide.id, content_type: contentType }) };
  }));
}

async function warmAllBanners(opts = {}) {
  if (!sharp || !getTmdbApiKey()) {
    return { ok: false, error: 'sharp o TMDB no disponible' };
  }
  const limit = Math.min(500, Math.max(1, parseInt(opts.limit, 10) || 500));
  const movies = db.prepare(`
    SELECT * FROM movies WHERE COALESCE(available, 1) = 1 AND tmdb_id IS NOT NULL
    ORDER BY rating DESC LIMIT ?
  `).all(limit);
  const series = db.prepare(`
    SELECT * FROM series WHERE tmdb_id IS NOT NULL ORDER BY rating DESC LIMIT ?
  `).all(Math.max(10, Math.floor(limit / 10)));
  let generated = 0;
  let failed = 0;
  for (const row of movies) {
    try {
      await ensureBannerFile(row, 'movie');
      generated++;
    } catch {
      failed++;
    }
    await sleep(REQUEST_DELAY_MS);
  }
  for (const row of series) {
    try {
      await ensureBannerFile(row, 'series');
      generated++;
    } catch {
      failed++;
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return { ok: true, generated, failed };
}

function startBannerWarmScheduler() {
  setTimeout(async () => {
    try {
      const total = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM movies WHERE COALESCE(available,1)=1 AND tmdb_id IS NOT NULL) +
          (SELECT COUNT(*) FROM series WHERE tmdb_id IS NOT NULL) AS c
      `).get().c;
      const cached = fs.existsSync(BANNER_DIR)
        ? fs.readdirSync(BANNER_DIR).filter((f) => f.endsWith('.jpg')).length
        : 0;
      if (cached < total && getTmdbApiKey()) {
        console.log(`[banner-warm] Generando portadas horizontales (${cached}/${total} en caché)…`);
        const result = await warmAllBanners({ limit: 120 });
        console.log('[banner-warm] Listo:', result);
      }
    } catch (err) {
      console.warn('[banner-warm]', err.message || err);
    }
  }, 20000);
}

module.exports = {
  ensureBannerFile,
  invalidateBannerCache,
  bannerUrlForItem,
  bannerCachePath,
  bannerPublicPath,
  enrichHeroBanners,
  warmAllBanners,
  startBannerWarmScheduler
};
