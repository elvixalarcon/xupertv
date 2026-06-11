#!/usr/bin/env node
/**
 * Descarga películas y series VixRED a data/winscp/ (accesible por WinSCP)
 * y actualiza la base de datos para usar archivos locales.
 *
 * Uso: node scripts/download-vixred-local.js
 *      node scripts/download-vixred-local.js --link-only   (solo vincular archivos ya descargados)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const WINSCP = path.join(DATA, 'winscp');
const PELICULAS = path.join(WINSCP, 'peliculas');
const SERIES_DIR = path.join(WINSCP, 'series');
const LOG_FILE = path.join(WINSCP, 'download.log');
const MANIFEST = path.join(WINSCP, 'manifest.json');

const MIN_FREE_BYTES = 3 * 1024 * 1024 * 1024; // 3 GB reserva
const LINK_ONLY = process.argv.includes('--link-only');

const db = require(path.join(ROOT, 'server', 'db'));

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function sanitize(name) {
  return String(name || 'sin_titulo')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
}

function extFromUrl(url) {
  const m = url.split('?')[0].match(/\.([a-z0-9]+)$/i);
  return m ? `.${m[1].toLowerCase()}` : '.mp4';
}

function freeBytes() {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`df -B1 ${JSON.stringify(DATA)} 2>/dev/null | tail -1`, { encoding: 'utf8' });
    const parts = out.trim().split(/\s+/).filter(Boolean);
    // Formato: total used avail use% mount
    const avail = parts.length >= 4 ? parseInt(parts[2], 10) : 0;
    return Number.isFinite(avail) ? avail : 0;
  } catch {
    return 0;
  }
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return { done: {} };
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return { done: {} };
  }
}

function saveManifest(m) {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });

    let startAt = 0;
    if (fs.existsSync(dest)) {
      startAt = fs.statSync(dest).size;
    }

    const write = (finalUrl, redirectCount = 0) => {
      if (redirectCount > 8) return reject(new Error('Demasiadas redirecciones'));

      const client = finalUrl.startsWith('https') ? https : http;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        Referer: 'https://tv.vixred.com/'
      };
      if (startAt > 0) headers.Range = `bytes=${startAt}-`;

      const opts = { headers };
      if (finalUrl.startsWith('https')) opts.rejectUnauthorized = false;

      const req = client.get(finalUrl, opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, finalUrl).href;
          return write(next, redirectCount + 1);
        }

        if (res.statusCode === 416 && startAt > 0) {
          res.resume();
          return resolve(fs.statSync(dest).size);
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const append = res.statusCode === 206 && startAt > 0;
        const file = fs.createWriteStream(dest, { flags: append ? 'a' : 'w' });
        let received = 0;
        const total = +(res.headers['content-length'] || 0) + (append ? startAt : 0);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0 && received % (50 * 1024 * 1024) < chunk.length) {
            const done = (append ? startAt : 0) + received;
            const pct = Math.min(100, Math.round(done / total * 100));
            const gb = (done / 1e9).toFixed(2);
            process.stdout.write(`\r  → ${pct}% (${gb} GB)`);
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            process.stdout.write('\n');
            resolve(fs.statSync(dest).size);
          });
        });
        file.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(0);
    };

    write(url);
  });
}

function publicPath(absPath) {
  const rel = path.relative(DATA, absPath).replace(/\\/g, '/');
  return `/uploads/${rel}`;
}

function linkMovie(id, absPath) {
  const vp = publicPath(absPath);
  db.prepare('UPDATE movies SET video_path = ?, available = 1 WHERE id = ?').run(vp, id);
  return vp;
}

function linkEpisode(id, absPath) {
  const vp = publicPath(absPath);
  db.prepare('UPDATE episodes SET video_path = ?, available = 1 WHERE id = ?').run(vp, id);
  return vp;
}

async function processMovie(movie, manifest) {
  const key = `movie-${movie.id}`;
  const ext = extFromUrl(movie.video_path);
  const filename = `${sanitize(movie.title)}${movie.year ? `_${movie.year}` : ''}${ext}`;
  const dest = path.join(PELICULAS, filename);

  if (manifest.done[key] && fs.existsSync(dest) && fs.statSync(dest).size > 1e6) {
    const vp = linkMovie(movie.id, dest);
    log(`✓ Ya existe: ${movie.title} → ${vp}`);
    return true;
  }

  if (LINK_ONLY) {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1e6) {
      linkMovie(movie.id, dest);
      manifest.done[key] = { dest, at: new Date().toISOString() };
      return true;
    }
    log(`⊘ Falta archivo local: ${movie.title}`);
    return false;
  }

  const free = freeBytes();
  if (free < MIN_FREE_BYTES) {
    log(`✗ Sin espacio en disco (${(free / 1e9).toFixed(1)} GB libres). Detenido.`);
    return false;
  }

  log(`↓ Descargando película: ${movie.title}`);
  log(`  URL: ${movie.video_path}`);
  log(`  Destino: ${dest}`);

  try {
    const size = await downloadFile(movie.video_path, dest);
    if (size < 1e6) {
      log(`✗ Archivo muy pequeño o vacío: ${movie.title}`);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      return false;
    }
    const vp = linkMovie(movie.id, dest);
    manifest.done[key] = { dest, size, at: new Date().toISOString() };
    saveManifest(manifest);
    log(`✓ Listo: ${movie.title} (${(size / 1e9).toFixed(2)} GB) → ${vp}`);
    return true;
  } catch (err) {
    log(`✗ Error ${movie.title}: ${err.message}`);
    return false;
  }
}

async function processEpisode(ep, manifest) {
  const key = `episode-${ep.id}`;
  const seriesDir = path.join(SERIES_DIR, sanitize(ep.series));
  const ext = extFromUrl(ep.video_path);
  const filename = `S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}${ext}`;
  const dest = path.join(seriesDir, filename);

  if (manifest.done[key] && fs.existsSync(dest) && fs.statSync(dest).size > 1e6) {
    const vp = linkEpisode(ep.id, dest);
    log(`✓ Ya existe: ${ep.series} ${filename} → ${vp}`);
    return true;
  }

  if (LINK_ONLY) {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1e6) {
      linkEpisode(ep.id, dest);
      manifest.done[key] = { dest, at: new Date().toISOString() };
      return true;
    }
    log(`⊘ Falta archivo: ${ep.series} ${filename}`);
    return false;
  }

  const free = freeBytes();
  if (free < MIN_FREE_BYTES) {
    log(`✗ Sin espacio en disco (${(free / 1e9).toFixed(1)} GB libres). Detenido.`);
    return false;
  }

  log(`↓ Descargando: ${ep.series} ${filename}`);
  try {
    const size = await downloadFile(ep.video_path, dest);
    if (size < 1e6) {
      log(`✗ Archivo inválido: ${ep.series} ${filename}`);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      return false;
    }
    const vp = linkEpisode(ep.id, dest);
    manifest.done[key] = { dest, size, at: new Date().toISOString() };
    saveManifest(manifest);
    log(`✓ Listo: ${ep.series} ${filename} (${(size / 1e9).toFixed(2)} GB)`);
    return true;
  } catch (err) {
    log(`✗ Error ${ep.series} ${filename}: ${err.message}`);
    return false;
  }
}

async function main() {
  fs.mkdirSync(PELICULAS, { recursive: true });
  fs.mkdirSync(SERIES_DIR, { recursive: true });

  const movies = db.prepare("SELECT id, title, year, video_path FROM movies WHERE video_path LIKE 'http%' ORDER BY id").all();
  const episodes = db.prepare(`
    SELECT e.id, e.season, e.episode, e.video_path, s.title AS series
    FROM episodes e JOIN series s ON s.id = e.series_id
    WHERE e.video_path LIKE 'http%'
    ORDER BY e.id
  `).all();

  const manifest = loadManifest();
  const free = freeBytes();

  log('=== Vix TV — Descarga local VixRED ===');
  log(`Películas: ${movies.length} | Episodios: ${episodes.length}`);
  log(`Espacio libre: ${(free / 1e9).toFixed(2)} GB (se necesitan ~33 GB para todo)`);
  log(`Carpeta WinSCP: ${WINSCP}`);
  if (LINK_ONLY) log('Modo: solo vincular archivos existentes');

  let ok = 0;
  let fail = 0;

  for (const m of movies) {
    if (await processMovie(m, manifest)) ok++;
    else { fail++; if (!LINK_ONLY && freeBytes() < MIN_FREE_BYTES) break; }
  }

  for (const ep of episodes) {
    if (await processEpisode(ep, manifest)) ok++;
    else { fail++; if (!LINK_ONLY && freeBytes() < MIN_FREE_BYTES) break; }
  }

  log(`=== Fin: ${ok} OK, ${fail} pendientes/error ===`);

  try {
    const { syncVixredVisibility } = require(path.join(ROOT, 'server', 'services', 'vixredSync'));
    const sync = syncVixredVisibility();
    log(`Visibilidad: ${sync.moviesOn} películas visibles, ${sync.moviesOff} ocultas | ${sync.epsOn} eps visibles, ${sync.epsOff} ocultos`);
  } catch (err) {
    log(`Aviso sync visibilidad: ${err.message}`);
  }

  log('Reinicia Vix TV o recarga la web para usar archivos locales.');
}

main().catch((e) => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
