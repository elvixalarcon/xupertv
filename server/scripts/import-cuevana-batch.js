#!/usr/bin/env node
/**
 * Importa varias películas desde Cuevana 3.
 * Uso:
 *   node server/scripts/import-cuevana-batch.js --years 2026,2025,2024 --download --limit 5
 *   node server/scripts/import-cuevana-batch.js --featured --catalog-only
 */
const { spawn } = require('child_process');
const path = require('path');
const db = require('../db');
const { collectMovieUrls, parseMoviePage } = require('../services/cuevana');
const { syncMovieFromTmdb } = require('../services/tmdbMetadata');
const { findExistingMovie } = require('../services/movieDedup');
const { registerDownloadJob } = require('../services/vodDownloadProgress');

const FEATURED_SLUGS = [
  'backrooms-sin-salida',
  'iron-lung-oceano-de-sangre',
  'hokum-la-maldicion-de-la-bruja',
  'obsession',
  'en-la-zona-gris',
  'michael',
  'mortal-kombat-ii',
  'super-mario-galaxy-la-pelicula',
  'zona-de-riesgo',
  'proyecto-fin-del-mundo',
  'ven-a-volar-conmigo',
  'slanted',
  'a-great-awakening',
  'casa-grande',
  'moss-freud',
  'is-god-is',
  'emergency-exit',
  'violent-ends',
  'the-president-s-cake',
  'powstaniec-1863'
];

function parseArgs(argv) {
  const out = {
    years: [2026, 2025, 2024],
    genres: ['terror', 'ciencia-ficcion', 'accion', 'drama', 'comedia', 'suspenso', 'aventura'],
    limit: 0,
    download: false,
    catalogOnly: false,
    featured: false,
    recommended: true,
    slugs: []
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--download') out.download = true;
    else if (a === '--catalog-only') { out.catalogOnly = true; out.download = false; }
    else if (a === '--featured') out.featured = true;
    else if (a === '--no-recommended') out.recommended = false;
    else if (a === '--years') out.years = (argv[++i] || '').split(',').map((y) => parseInt(y, 10)).filter(Boolean);
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 0;
    else if (a === '--slugs') out.slugs = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (!a.startsWith('--')) out.slugs.push(a);
  }
  return out;
}

function runImportScript(slug, download, recommended) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'import-cuevana-movie.js');
    const args = ['node', script, slug];
    if (download) args.push('--download');
    if (recommended) args.push('--recommended');
    const proc = spawn(args[0], args.slice(1), { stdio: 'inherit', cwd: path.join(__dirname, '..', '..') });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${slug} falló (${code})`));
      resolve();
    });
  });
}

async function registerCatalogOnly(movie) {
  const existing = findExistingMovie({
    slug: movie.slug,
    title: movie.title,
    year: movie.year,
    tmdb_id: movie.tmdb_id
  });
  if (existing) {
    console.log('[batch] omitida (ya existe):', movie.title, `#${existing.id}`);
    return existing.id;
  }
  const r = db.prepare(`
    INSERT INTO movies (title, description, poster, video_path, genre, year, recommended, available, rating)
    VALUES (?, ?, '', ?, ?, ?, 1, 0, ?)
  `).run(
    movie.title,
    movie.description || '',
    `/uploads/movies/pending_${movie.slug}.mkv`,
    movie.genres.join(', ') || 'Cuevana',
    movie.year,
    movie.rating || 0
  );
  const movieId = r.lastInsertRowid;
  await syncMovieFromTmdb(movieId, { title: movie.title, year: movie.year });
  registerDownloadJob(movieId, {
    logFile: `winscp/import-cuevana-${movie.slug}.log`,
    destBase: `pending_${movie.slug}`,
    slug: movie.slug
  });
  return movieId;
}

async function main() {
  const opts = parseArgs(process.argv);
  let movies = [];

  if (opts.slugs.length) {
    for (const slug of opts.slugs) {
      movies.push(await parseMoviePage(slug));
    }
  } else if (opts.featured) {
    for (const slug of FEATURED_SLUGS) {
      try {
        movies.push(await parseMoviePage(slug));
      } catch (e) {
        console.warn('[batch] featured', slug, e.message);
      }
    }
  } else {
    movies = await collectMovieUrls({
      years: opts.years,
      genres: opts.genres,
      yearFilter: opts.years,
      extraPages: 2
    });
  }

  movies = movies.filter((m) => opts.years.includes(m.year));
  if (opts.limit > 0) movies = movies.slice(0, opts.limit);

  console.log(`[batch] ${movies.length} películas (${opts.years.join(', ')})`);

  const results = { catalog: 0, downloaded: 0, errors: [] };

  for (const movie of movies) {
    try {
      if (opts.catalogOnly) {
        await registerCatalogOnly(movie);
        results.catalog++;
        console.log('[batch] catálogo:', movie.title);
        continue;
      }

      if (opts.download) {
        await runImportScript(movie.slug, true, opts.recommended);
        results.downloaded++;
        console.log('[batch] descargada:', movie.title);
      } else {
        await registerCatalogOnly(movie);
        results.catalog++;
      }
    } catch (err) {
      results.errors.push({ slug: movie.slug, title: movie.title, error: err.message });
      console.error('[batch] error', movie.title, err.message);
    }
  }

  console.log(JSON.stringify(results, null, 2));
  if (results.errors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[batch]', err.message);
  process.exit(1);
});
