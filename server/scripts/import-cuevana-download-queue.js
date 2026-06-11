#!/usr/bin/env node
/**
 * Descarga películas pendientes importadas desde Cuevana (una por una).
 * Uso: node server/scripts/import-cuevana-download-queue.js --limit 3
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const db = require('../db');

function parseArgs(argv) {
  const out = { limit: 5, skipRunning: true };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--limit') out.limit = parseInt(argv[++i], 10) || 5;
    else if (argv[i] === '--force') out.skipRunning = false;
  }
  return out;
}

function ytDlpRunning() {
  try {
    const out = execSync('pgrep -af "yt_dlp|yt-dlp" 2>/dev/null || true', { encoding: 'utf8' });
    return out.split('\n').filter((l) => l.includes('yt_dlp') || l.includes('yt-dlp')).length > 0;
  } catch {
    return false;
  }
}

function runMovie(slug) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'import-cuevana-movie.js');
    const proc = spawn('node', [script, slug, '--download', '--recommended'], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..', '..')
    });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.skipRunning && ytDlpRunning()) {
    console.log('[queue] Hay otra descarga yt-dlp activa. Espera o usa --force.');
    process.exit(0);
  }

  const pending = db.prepare(`
    SELECT id, title, video_path FROM movies
    WHERE COALESCE(available, 0) = 0
      AND (genre LIKE '%Cuevana%' OR video_path LIKE '%pending_%' OR video_path LIKE '%/uploads/movies/%')
    ORDER BY recommended DESC, year DESC, id ASC
    LIMIT ?
  `).all(opts.limit * 3);

  const slugs = [];
  for (const row of pending) {
    const m = row.video_path.match(/pending_([a-z0-9-]+)\.mkv/i);
    if (m) slugs.push(m[1]);
    else {
      const guess = row.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (guess) slugs.push(guess);
    }
  }

  const unique = [...new Set(slugs)].slice(0, opts.limit);
  console.log('[queue] Descargando', unique.length, 'películas:', unique.join(', '));

  const errors = [];
  for (const slug of unique) {
    if (opts.skipRunning && ytDlpRunning()) {
      console.log('[queue] Otra descarga iniciada; deteniendo cola.');
      break;
    }
    try {
      await runMovie(slug);
    } catch (e) {
      errors.push({ slug, error: e.message });
    }
  }

  console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
}

main().catch((e) => {
  console.error('[queue]', e.message);
  process.exit(1);
});
