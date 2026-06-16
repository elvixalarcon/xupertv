const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const db = require('../db');
const { autoSyncMovieTmdbIfNeeded } = require('./tmdbMetadata');
const { registerDownloadJob } = require('./vodDownloadProgress');
const { findExistingMovie, movieExists, catalogFieldsForDownload } = require('./movieDedup');
const {
  safeFilename,
  runAllcalidadDownload,
  findFinishedFile,
  finalizeDownloadedMovie,
  logRelForMovie,
  MOVIES_DIR
} = require('./vodYtDlp');

const ROOT = path.join(__dirname, '..', '..');
const FAST_API = 'https://allcalidad.re/api/rest';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const SITEMAPS = [
  'movies-sitemap9.xml',
  'movies-sitemap8.xml',
  'movies-sitemap7.xml',
  'movies-sitemap6.xml'
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchText(next).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function fetchJson(url) {
  return fetchText(url).then((t) => JSON.parse(t));
}

function parseSitemapSlugs(xml, years) {
  const out = [];
  const re = /<loc>https:\/\/allcalidad\.re\/peliculas\/([a-z0-9-]+)-(\d{4})\//gi;
  let m;
  while ((m = re.exec(xml))) {
    const year = parseInt(m[2], 10);
    if (!years.includes(year)) continue;
    out.push({ slug: `${m[1]}-${year}`, baseSlug: m[1], year });
  }
  return out;
}

async function discoverNewMovies(years = [2026, 2025, 2024]) {
  const seen = new Set();
  const list = [];
  for (const sm of SITEMAPS) {
    try {
      const xml = await fetchText(`https://allcalidad.re/${sm}`);
      for (const item of parseSitemapSlugs(xml, years)) {
        if (seen.has(item.slug)) continue;
        seen.add(item.slug);
        if (!movieExists(item.slug, item.baseSlug.replace(/-/g, ' '), item.year, null)) {
          list.push(item);
        }
      }
    } catch (err) {
      console.warn('[allcalidad] sitemap', sm, err.message);
    }
  }
  return list.sort((a, b) => b.year - a.year);
}

async function importMovie(slug, { download = false, recommended = true, quality = 'max', manualDownload = false } = {}) {
  const single = await fetchJson(
    `${FAST_API}/single?post_name=${encodeURIComponent(slug)}&post_type=movies`
  );
  if (single.error || !single.data) {
    throw new Error(single.message || `No encontrada en AllCalidad: ${slug}`);
  }

  const meta = single.data;
  const player = await fetchJson(`${FAST_API}/player?post_id=${meta._id}&_any=1`);
  const embeds = player.data?.embeds || [];
  const downloadable = embeds.some((e) =>
    /goodstream|vimeos|hlswish|wishfast|filemoon/i.test(e.url || '')
  );

  const title = (meta.title || meta.original_title || slug).replace(/\s*\(\d{4}\)\s*$/, '').trim();
  const yearMatch = String(meta.title || '').match(/\((\d{4})\)/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : parseInt(slug.match(/-(\d{4})$/)?.[1] || '0', 10);
  const tmdbSearchTitle = meta.original_title || title;

  const tmdbId = meta.tmdb_id || meta.tmdb || null;
  const existing = findExistingMovie({ slug, title, year, tmdb_id: tmdbId });

  if (existing && !download) {
    return { skipped: true, id: existing.id, slug, title, reason: 'ya en catálogo' };
  }

  let video_path = `/uploads/movies/pending_${slug}.mkv`;
  let absVideo = null;
  let available = 0;
  const fname = safeFilename(title, year);
  const logRel = logRelForMovie({ video_path, genre: 'AllCalidad' }, slug, 'allcalidad');

  if (download && !downloadable) {
    throw new Error('Sin reproductor descargable en AllCalidad');
  }

  let movieId;
  if (existing) {
    const catalog = catalogFieldsForDownload(existing, video_path);
    db.prepare(`
      UPDATE movies SET title=?, video_path=?, year=?, recommended=?, available=? WHERE id=?
    `).run(title, catalog.video_path, year, recommended ? 1 : 0, catalog.available, existing.id);
    movieId = existing.id;
  } else {
    const r = db.prepare(`
      INSERT INTO movies (title, description, poster, video_path, genre, year, recommended, available, rating)
      VALUES (?, '', '', ?, 'AllCalidad', ?, ?, 0, 0)
    `).run(title, video_path, year, recommended ? 1 : 0);
    movieId = r.lastInsertRowid;
  }

  if (download && downloadable) {
    const destBase = path.basename(fname, '.mkv');
    const { clearMovieFilesForRedownload } = require('./vodYtDlp');
    if (existing && catalogFieldsForDownload(existing, video_path).available === 0) {
      clearMovieFilesForRedownload(destBase, slug);
    }
    registerDownloadJob(movieId, {
      logFile: logRel,
      destBase,
      slug,
      quality,
      source: 'allcalidad',
      updating: !!existing
    });
    const { spawnMovieDownload } = require('./vodPendingQueue');
    spawnMovieDownload(movieId, { manual: manualDownload });
    return {
      ok: true,
      async: true,
      id: movieId,
      slug,
      title,
      year,
      available: 0,
      source: 'allcalidad',
      message: existing
        ? `Actualizando (${quality}) — ver progreso en Películas VOD`
        : `Descarga iniciada (${quality}) — sigue el progreso en Películas VOD`
    };
  }

  await autoSyncMovieTmdbIfNeeded(movieId, { title: tmdbSearchTitle, year });
  registerDownloadJob(movieId, {
    logFile: logRel,
    destBase: `pending_${slug}`,
    slug
  });

  return { ok: true, id: movieId, slug, title, year, available, source: 'allcalidad' };
}

module.exports = {
  discoverNewMovies,
  importMovie,
  movieExists
};
