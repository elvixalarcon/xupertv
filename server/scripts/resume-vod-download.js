#!/usr/bin/env node
/**
 * Reanuda descarga (--continue) de una o todas las películas pendientes.
 * Uso:
 *   node server/scripts/resume-vod-download.js 36
 *   node server/scripts/resume-vod-download.js --all
 *   node server/scripts/resume-vod-download.js --slug backrooms-sin-salida
 */
const { spawn } = require('child_process');
const path = require('path');
const db = require('../db');
const { extractSlugFromPath, normalizeSlugForSource } = require('../services/movieDedup');
const { resumeMovieDownload, listResumableMovies } = require('../services/vodYtDlp');
const { isYtDlpRunning, getDownloadJob } = require('../services/vodDownloadProgress');

function parseArgs(argv) {
  const out = { movieId: 0, slug: '', all: false, background: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--all') out.all = true;
    else if (argv[i] === '--slug') out.slug = argv[++i] || '';
    else if (argv[i] === '--bg') out.background = true;
    else if (/^\d+$/.test(argv[i])) out.movieId = parseInt(argv[i], 10);
  }
  return out;
}

async function resumeOne(movieId, slug) {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(movieId);
  const job = getDownloadJob(movieId) || {};
  const source = job.source;
  const s = normalizeSlugForSource(
    slug || job.slug || extractSlugFromPath(movie?.video_path),
    source
  );
  return resumeMovieDownload(movieId, { slug: s, source });
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.all) {
    const list = listResumableMovies();
    console.log(`[resume] ${list.length} películas reanudables`);
    for (const m of list) {
      if (isYtDlpRunning()) {
        console.log('[resume] Esperando yt-dlp…');
        await new Promise((r) => setTimeout(r, 15000));
      }
      try {
        const slug = extractSlugFromPath(m.video_path);
        const r = await resumeOne(m.id, slug);
        console.log('[resume]', m.id, m.title, r.ok ? 'OK' : r.error || r.reason);
      } catch (e) {
        console.error('[resume]', m.id, m.title, e.message);
      }
    }
    return;
  }

  if (!opts.movieId && !opts.slug) {
    console.error('Uso: resume-vod-download.js <id> | --all | --slug nombre');
    process.exit(1);
  }

  let movieId = opts.movieId;
  if (!movieId && opts.slug) {
    const row = db.prepare('SELECT id FROM movies WHERE video_path LIKE ?').get(`%${opts.slug}%`);
    movieId = row?.id;
  }
  if (!movieId) throw new Error('Película no encontrada');

  if (opts.background) {
    const script = path.join(__dirname, 'resume-vod-download.js');
    const child = spawn('node', [script, String(movieId)], {
      detached: true,
      stdio: 'ignore',
      cwd: path.join(__dirname, '..', '..')
    });
    child.unref();
    console.log(JSON.stringify({ ok: true, background: true, movieId }));
    return;
  }

  const result = await resumeOne(movieId, opts.slug);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[resume]', err.message);
  process.exit(1);
});
