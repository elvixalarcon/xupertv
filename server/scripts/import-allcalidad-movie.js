#!/usr/bin/env node
/**
 * Importa una película desde AllCalidad (metadatos + descarga opcional).
 * Uso:
 *   node server/scripts/import-allcalidad-movie.js "https://allcalidad.re/peliculas/slug-2026"
 *   node server/scripts/import-allcalidad-movie.js --slug proyecto-fin-del-mundo-2026 --download
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const db = require('../db');
const { syncMovieFromTmdb } = require('../services/tmdbMetadata');
const {
  safeFilename,
  runAllcalidadDownload,
  findFinishedFile,
  finalizeDownloadedMovie,
  logRelForMovie,
  MOVIES_DIR
} = require('../services/vodYtDlp');
const { registerDownloadJob } = require('../services/vodDownloadProgress');

const ROOT = path.join(__dirname, '..', '..');
const POSTERS_DIR = path.join(ROOT, 'data', 'posters');
const FAST_API = 'https://allcalidad.re/api/rest';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function parseArgs(argv) {
  const out = { url: '', slug: '', download: false, embedOnly: false, recommended: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--download') out.download = true;
    else if (a === '--embed-only') { out.embedOnly = true; out.download = false; }
    else if (a === '--no-recommended') out.recommended = false;
    else if (a === '--slug') out.slug = argv[++i] || '';
    else if (a.startsWith('http')) out.url = a;
  }
  if (!out.slug && out.url) {
    const m = out.url.match(/\/peliculas\/([^/?#]+)/i);
    if (m) out.slug = m[1];
  }
  return out;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchJson(next).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    client.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return downloadFile(next, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} al descargar ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', reject);
  });
}

function absUrl(rel) {
  if (!rel) return '';
  if (/^https?:\/\//i.test(rel)) return rel;
  return `https://allcalidad.re${rel.startsWith('/') ? '' : '/'}${rel}`;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.slug) {
    console.error('Uso: node import-allcalidad-movie.js <url> [--download]');
    process.exit(1);
  }

  const single = await fetchJson(
    `${FAST_API}/single?post_name=${encodeURIComponent(opts.slug)}&post_type=movies`
  );
  if (single.error || !single.data) throw new Error(single.message || 'Película no encontrada en AllCalidad');

  const meta = single.data;
  const player = await fetchJson(`${FAST_API}/player?post_id=${meta._id}&_any=1`);
  const embeds = player.data?.embeds || [];
  const goodstream = embeds.find((e) => /goodstream/i.test(e.url || ''));
  const hls = embeds.find((e) => /hlswish|m3u8/i.test(e.url || ''));
  const embedUrl = goodstream?.url || embeds[0]?.url || '';

  if (!embedUrl && !opts.embedOnly) {
    throw new Error('Sin reproductor embebido disponible');
  }

  const title = (meta.title || meta.original_title || opts.slug).replace(/\s*\(\d{4}\)\s*$/, '').trim();
  const yearMatch = String(meta.title || '').match(/\((\d{4})\)/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : (meta.release_date ? parseInt(meta.release_date.slice(0, 4), 10) : 0);
  const tmdbSearchTitle = meta.original_title || title;

  const existing = db.prepare(`
    SELECT * FROM movies WHERE lower(title) = lower(?) OR lower(title) LIKE lower(?)
  `).get(title, `%${title}%`);

  let video_path = '';
  let absVideo = null;

  if (opts.download && goodstream?.url) {
    const fname = safeFilename(title, year);
    const destBase = path.basename(fname, '.mkv');
    const outTemplate = path.join(MOVIES_DIR, `${destBase}.%(ext)s`);
    const logRel = logRelForMovie({ video_path: '', genre: 'AllCalidad' }, opts.slug, 'allcalidad');
    const logAbs = path.join(ROOT, 'data', logRel);
    if (existing?.id) {
      registerDownloadJob(existing.id, { logFile: logRel, destBase, slug: opts.slug });
    }
    await runAllcalidadDownload(goodstream.url, outTemplate, logAbs);
    absVideo = findFinishedFile(destBase);
    if (!absVideo) throw new Error('Archivo de video no encontrado tras descarga');
    video_path = `/uploads/movies/${path.basename(absVideo)}`;
  } else if (opts.embedOnly || hls?.url || goodstream?.url) {
    video_path = hls?.url || goodstream?.url;
  } else {
    throw new Error('Pasa --download para guardar en el servidor o --embed-only para URL externa');
  }

  let movieId;
  if (existing) {
    db.prepare(`
      UPDATE movies SET title=?, video_path=?, year=?, recommended=?, available=1 WHERE id=?
    `).run(title, video_path, year, opts.recommended ? 1 : 0, existing.id);
    movieId = existing.id;
    console.log('[import] Actualizada película id', movieId);
  } else {
    const r = db.prepare(`
      INSERT INTO movies (title, description, poster, video_path, genre, year, recommended, available, rating)
      VALUES (?, '', '', ?, '', ?, ?, 1, 0)
    `).run(title, video_path, year, opts.recommended ? 1 : 0);
    movieId = r.lastInsertRowid;
    console.log('[import] Creada película id', movieId);
  }

  await syncMovieFromTmdb(movieId, { title: tmdbSearchTitle, year });
  const synced = db.prepare('SELECT title, poster, tmdb_id, rating FROM movies WHERE id = ?').get(movieId);
  console.log('[import] TMDB:', synced?.tmdb_id, synced?.title);

  if (absVideo && fs.existsSync(absVideo)) {
    video_path = await finalizeDownloadedMovie(movieId, absVideo, video_path) || video_path;
    console.log('[import] video listo');
  }

  console.log(JSON.stringify({
    ok: true,
    id: movieId,
    title,
    year,
    video_path,
    poster: synced?.poster,
    source: 'allcalidad',
    slug: opts.slug
  }, null, 2));
}

main().catch((err) => {
  console.error('[import]', err.message);
  process.exit(1);
});
