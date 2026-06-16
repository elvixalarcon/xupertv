const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const db = require('../db');
const { syncSeriesFromTmdb } = require('./tmdbMetadata');
const { runAllcalidadDownload, runHlsDownload } = require('./vodYtDlp');
const {
  isYtDlpRunning,
  registerEpisodeDownloadJob,
  clearEpisodeDownloadJob
} = require('./vodDownloadProgress');
const { syncVixredVisibility } = require('./vixredSync');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const SERIES_WINSCP = path.join(DATA, 'winscp', 'series');
const FAST_API = 'https://allcalidad.re/api/rest';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

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

function parseEpisodeSlug(slug) {
  const m = String(slug || '').match(/temporada-(\d+)-episodio-(\d+)/i);
  if (!m) return null;
  return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
}

function seriesFolderName(title, year) {
  return String(title || 'Serie')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60) + (year ? `_${year}` : '');
}

function episodeFileName(season, episode) {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}.mkv`;
}

function episodePublicPath(folder, season, episode) {
  return `/uploads/winscp/series/${folder}/${episodeFileName(season, episode)}`;
}

function episodeAbsPath(folder, season, episode) {
  return path.join(SERIES_WINSCP, folder, episodeFileName(season, episode));
}

function episodeReady(absPath) {
  try {
    return fs.existsSync(absPath) && fs.statSync(absPath).size >= 50 * 1024 * 1024;
  } catch {
    return false;
  }
}

const SERIES_SLUG_CACHE_MS = 30 * 60 * 1000;
const seriesSlugCache = new Map();

async function fetchSeriesBySlug(slug) {
  const key = String(slug || '').trim();
  const hit = seriesSlugCache.get(key);
  if (hit && Date.now() - hit.at < SERIES_SLUG_CACHE_MS) return hit.data;

  const single = await fetchJson(
    `${FAST_API}/single?post_name=${encodeURIComponent(key)}&post_type=tvshows`
  );
  if (single.error || !single.data) {
    throw new Error(single.message || `Serie no encontrada: ${key}`);
  }
  const episodes = await fetchJson(
    `${FAST_API}/episodes?post_id=${single.data._id}&post_type=tvshows`
  );
  const list = Array.isArray(episodes.data) ? episodes.data : [];
  const data = { meta: single.data, episodes: list };
  seriesSlugCache.set(key, { at: Date.now(), data });
  return data;
}

function findFinishedFileInDir(dir, destBase) {
  if (!fs.existsSync(dir)) return null;
  const prefix = destBase.slice(0, Math.min(12, destBase.length));
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix) || name.includes('.part') || name.includes('.ytdl')) continue;
    if (!/\.(mkv|mp4)$/i.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).size >= 50 * 1024 * 1024) return full;
    } catch { /* ignore */ }
  }
  return null;
}

function fetchHtml(url, referer = 'https://allcalidad.re/') {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': UA, Referer: referer, Accept: 'text/html' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchHtml(next, referer).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function unpackVimeosPlayerScript(html) {
  const m = html.match(/return p\}\('((?:\\'|[^'])*)',(\d+),(\d+),'([^']*)'\.split\('\|'\)\)/);
  if (!m) return null;
  let p = m[1].replace(/\\'/g, "'");
  const radix = parseInt(m[2], 10);
  let c = parseInt(m[3], 10);
  const k = m[4].split('|');
  while (c--) {
    if (k[c]) p = p.replace(new RegExp(`\\b${c.toString(radix)}\\b`, 'g'), k[c]);
  }
  const file = p.match(/file:\s*"([^"]+)"/);
  return file?.[1] || null;
}

async function resolveVimeosEmbedUrl(embedPageUrl) {
  const html = await fetchHtml(embedPageUrl, 'https://allcalidad.re/');
  const m3u8 = unpackVimeosPlayerScript(html);
  if (!m3u8 || !/\.m3u8/i.test(m3u8)) {
    throw new Error('No se encontró stream m3u8 en vimeos');
  }
  return m3u8;
}

async function fetchEpisodeEmbedCandidatesFast(episodePostId) {
  const player = await fetchJson(`${FAST_API}/player?post_id=${episodePostId}&_any=1`);
  const embeds = player.data?.embeds || [];
  const out = [];
  const seen = new Set();
  const push = (url, type, extra = {}) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, type, ...extra });
  };

  const gs = embeds.find((e) => /goodstream/i.test(e.url || ''));
  if (gs?.url) {
    push(gs.url, 'goodstream');
    return out;
  }

  const hls = embeds.find((e) => /hlswish|wishfast/i.test(e.url || ''));
  if (hls?.url) {
    push(hls.url, 'hls');
    return out;
  }

  const vimeos = embeds.find((e) => /vimeos\.net\/embed-/i.test(e.url || ''));
  if (vimeos?.url) {
    try {
      const m3u8 = await resolveVimeosEmbedUrl(vimeos.url);
      push(m3u8, 'vimeos-hls', { referer: vimeos.url });
      return out;
    } catch (err) {
      console.warn('[allcalidad-series] fast vimeos:', err.message);
    }
  }

  return fetchEpisodeEmbedCandidates(episodePostId);
}

async function fetchEpisodeEmbedCandidates(episodePostId) {
  const player = await fetchJson(`${FAST_API}/player?post_id=${episodePostId}&_any=1`);
  const embeds = player.data?.embeds || [];
  const out = [];
  const seen = new Set();
  const push = (url, type, extra = {}) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, type, ...extra });
  };
  const add = (re, type) => {
    const hit = embeds.find((e) => re.test(e.url || '') && !seen.has(e.url));
    if (!hit?.url) return;
    push(hit.url, type);
  };
  add(/goodstream/i, 'goodstream');
  add(/hlswish/i, 'hls');
  for (const e of embeds) {
    if (!/vimeos\.net\/embed-/i.test(e.url || '')) continue;
    try {
      const m3u8 = await resolveVimeosEmbedUrl(e.url);
      push(m3u8, 'vimeos-hls', { referer: e.url });
      console.log(`[allcalidad-series] vimeos → m3u8 resuelto (${episodePostId})`);
    } catch (err) {
      console.warn(`[allcalidad-series] vimeos sin m3u8:`, err.message);
      push(e.url, 'vimeos');
    }
  }
  add(/voe\.sx/i, 'voe');
  add(/streamwish|wishfast/i, 'hls-alt');
  if (!out.length) throw new Error('Sin reproductor descargable');
  return out;
}

async function downloadEpisodeCandidate(cand, outTemplate, logAbs, quality = 'max') {
  if (cand.type === 'vimeos-hls' || /\.m3u8/i.test(cand.url)) {
    await runHlsDownload(cand.url, outTemplate, logAbs, {
      referer: cand.referer || 'https://vimeos.net/',
      tag: 'vimeos-hls',
      quality
    });
    return;
  }
  await runAllcalidadDownload(cand.url, outTemplate, logAbs, quality);
}

async function fetchEpisodeEmbedUrl(episodePostId) {
  const candidates = await fetchEpisodeEmbedCandidates(episodePostId);
  return candidates[0];
}

async function downloadEpisodeFile({ folder, season, episode, embedUrl, embedCandidates, logSlug, episodeId, quality = 'max' }) {
  const outDir = path.join(SERIES_WINSCP, folder);
  fs.mkdirSync(outDir, { recursive: true });
  const destFile = episodeAbsPath(folder, season, episode);
  const destBase = path.basename(destFile, '.mkv');
  const outTemplate = path.join(outDir, `${destBase}.%(ext)s`);
  const logDir = path.join(DATA, 'winscp');
  fs.mkdirSync(logDir, { recursive: true });
  const logAbs = path.join(logDir, `import-series-${logSlug}.log`);
  const logRel = path.relative(DATA, logAbs);
  const candidates = embedCandidates?.length
    ? embedCandidates
    : (embedUrl ? [{ url: embedUrl, type: 'embed' }] : []);

  if (episodeId) {
    registerEpisodeDownloadJob(episodeId, {
      logFile: logRel,
      destBase,
      folder,
      season,
      episode,
      slug: logSlug.replace(/-s\d+e\d+$/i, '')
    });
  }

  while (isYtDlpRunning()) {
    await new Promise((r) => setTimeout(r, 15000));
  }

  let lastErr = null;
  for (const cand of candidates) {
    try {
      await downloadEpisodeCandidate(cand, outTemplate, logAbs, quality);
      if (fs.existsSync(destFile) && fs.statSync(destFile).size >= 50 * 1024 * 1024) {
        return destFile;
      }
      const found = findFinishedFileInDir(outDir, destBase);
      if (found && fs.existsSync(found)) {
        if (found !== destFile) fs.renameSync(found, destFile);
        return destFile;
      }
      lastErr = new Error('Archivo de episodio no generado tras descarga');
    } catch (err) {
      lastErr = err;
      console.warn(`[allcalidad-series] ${cand.type || 'embed'} S${season}E${episode}:`, err.message);
    }
  }
  throw lastErr || new Error('Archivo de episodio no generado tras descarga');
}

function findSeriesByTitle(title) {
  return db.prepare('SELECT * FROM series WHERE lower(title) = lower(?) OR lower(title) LIKE lower(?)')
    .get(title, `%${title.split(':')[0].trim()}%`);
}

function upsertSeriesRow(meta, folder) {
  const title = (meta.title || meta.original_title || '').replace(/\s*\(\d{4}\)\s*$/, '').trim();
  const yearMatch = String(meta.title || '').match(/\((\d{4})\)/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : (meta.years ? parseInt(meta.years, 10) : 0);
  const genre = Array.isArray(meta.genres)
    ? meta.genres.map((g) => g.name || g).filter(Boolean).join(', ')
    : String(meta.genres || '');

  let row = findSeriesByTitle(title);
  if (!row) {
    const r = db.prepare(`
      INSERT INTO series (title, description, poster, genre, year)
      VALUES (?, ?, '', ?, ?)
    `).run(title, meta.overview || '', genre, year);
    row = db.prepare('SELECT * FROM series WHERE id = ?').get(r.lastInsertRowid);
  } else {
    db.prepare(`
      UPDATE series SET description = COALESCE(NULLIF(description,''), ?), genre = COALESCE(NULLIF(?,''), genre), year = COALESCE(?, year)
      WHERE id = ?
    `).run(meta.overview || '', genre, year || null, row.id);
    row = db.prepare('SELECT * FROM series WHERE id = ?').get(row.id);
  }

  return { row, title, year, folder: folder || seriesFolderName(title, year) };
}

function upsertEpisodeRow(seriesId, { season, episode, title, video_path, available = 1 }) {
  const existing = db.prepare(
    'SELECT * FROM episodes WHERE series_id = ? AND season = ? AND episode = ?'
  ).get(seriesId, season, episode);

  if (existing) {
    db.prepare(`
      UPDATE episodes SET title = ?, video_path = ?, available = ? WHERE id = ?
    `).run(title, video_path, available ? 1 : 0, existing.id);
    return existing.id;
  }

  const r = db.prepare(`
    INSERT INTO episodes (series_id, season, episode, title, description, poster, video_path, available)
    VALUES (?, ?, ?, ?, '', '', ?, ?)
  `).run(seriesId, season, episode, title, video_path, available ? 1 : 0);
  return r.lastInsertRowid;
}

/**
 * Importa serie desde AllCalidad (catálogo + descarga opcional).
 */
async function importSeriesFromAllcalidad(slugInput, options = {}) {
  const { download = false, onlyMissing = false, seriesId = null, limit = 0, quality = 'max' } = options;
  let slug = String(slugInput || '').trim();

  if (seriesId && !slug) {
    const existingSeries = db.prepare('SELECT allcalidad_slug FROM series WHERE id = ?').get(seriesId);
    if (existingSeries?.allcalidad_slug) slug = String(existingSeries.allcalidad_slug).trim();
  }
  if (!slug) throw new Error('Slug de AllCalidad requerido (ej: from-2022)');

  const { meta, episodes: rawEps } = await fetchSeriesBySlug(slug);

  const parsed = rawEps
    .map((ep) => {
      const se = parseEpisodeSlug(ep.slug);
      if (!se) return null;
      return { ...ep, season: se.season, episode: se.episode };
    })
    .filter(Boolean)
    .sort((a, b) => a.season - b.season || a.episode - b.episode);

  let seriesRow;
  let folder;
  if (seriesId) {
    seriesRow = db.prepare('SELECT * FROM series WHERE id = ?').get(seriesId);
    if (!seriesRow) throw new Error('Serie no encontrada en BD');
    const sample = db.prepare(`
      SELECT video_path FROM episodes
      WHERE series_id = ? AND video_path LIKE '/uploads/winscp/series/%' AND COALESCE(available, 0) = 1
      ORDER BY season, episode
      LIMIT 1
    `).get(seriesId);
    const fm = sample?.video_path?.match(/\/series\/([^/]+)\//);
    folder = fm ? fm[1] : seriesFolderName(seriesRow.title, seriesRow.year);
  } else {
    const up = upsertSeriesRow(meta);
    seriesRow = up.row;
    folder = up.folder;
  }

  if (slug && seriesRow.allcalidad_slug !== slug) {
    db.prepare('UPDATE series SET allcalidad_slug = ? WHERE id = ?').run(slug, seriesRow.id);
    seriesRow.allcalidad_slug = slug;
  }

  try {
    await syncSeriesFromTmdb(seriesRow.id, { title: seriesRow.title });
  } catch (err) {
    console.warn('[allcalidad-series] TMDB:', err.message);
  }

  const result = {
    series_id: seriesRow.id,
    title: seriesRow.title,
    folder,
    total: parsed.length,
    cataloged: 0,
    downloaded: 0,
    skipped: 0,
    errors: []
  };

  let processed = 0;
  for (const ep of parsed) {
    if (limit > 0 && processed >= limit) break;
    processed++;

    const epTitle = ep.title || `T${ep.season} E${ep.episode}`;
    const publicPath = episodePublicPath(folder, ep.season, ep.episode);
    const absPath = episodeAbsPath(folder, ep.season, ep.episode);
    const existing = db.prepare(
      'SELECT * FROM episodes WHERE series_id = ? AND season = ? AND episode = ?'
    ).get(seriesRow.id, ep.season, ep.episode);

    const hasFile = episodeReady(absPath);
    const isLocal = existing?.video_path?.startsWith('/uploads/') && episodeReady(
      path.join(DATA, (existing.video_path || '').replace(/^\/uploads\//, ''))
    );

    if (onlyMissing && (hasFile || isLocal)) {
      if (hasFile && (!existing || Number(existing.available) === 0)) {
        upsertEpisodeRow(seriesRow.id, {
          season: ep.season,
          episode: ep.episode,
          title: epTitle,
          video_path: publicPath,
          available: 1
        });
      }
      result.skipped++;
      continue;
    }

    if (!download) {
      upsertEpisodeRow(seriesRow.id, {
        season: ep.season,
        episode: ep.episode,
        title: epTitle,
        video_path: publicPath,
        available: hasFile ? 1 : 0
      });
      result.cataloged++;
      continue;
    }

    if (hasFile || isLocal) {
      upsertEpisodeRow(seriesRow.id, {
        season: ep.season,
        episode: ep.episode,
        title: epTitle,
        video_path: isLocal ? existing.video_path : publicPath,
        available: 1
      });
      result.skipped++;
      continue;
    }

    const pendingId = upsertEpisodeRow(seriesRow.id, {
      season: ep.season,
      episode: ep.episode,
      title: epTitle,
      video_path: publicPath,
      available: 0
    });

    try {
      console.log(`[allcalidad-series] Descargando ${seriesRow.title} S${ep.season}E${ep.episode}…`);
      const embedCandidates = await fetchEpisodeEmbedCandidates(ep._id);
      await downloadEpisodeFile({
        folder,
        season: ep.season,
        episode: ep.episode,
        embedCandidates,
        logSlug: `${slug}-s${ep.season}e${ep.episode}`,
        episodeId: pendingId,
        quality
      });
      upsertEpisodeRow(seriesRow.id, {
        season: ep.season,
        episode: ep.episode,
        title: epTitle,
        video_path: publicPath,
        available: 1
      });
      clearEpisodeDownloadJob(pendingId);
      try {
        const { scheduleVideoPrep } = require('./videoPrep');
        scheduleVideoPrep(absPath, pendingId, 'episode');
      } catch { /* ignore */ }
      result.downloaded++;
    } catch (err) {
      console.error(`[allcalidad-series] S${ep.season}E${ep.episode}`, err.message);
      upsertEpisodeRow(seriesRow.id, {
        season: ep.season,
        episode: ep.episode,
        title: epTitle,
        video_path: publicPath,
        available: 0
      });
      result.errors.push({ season: ep.season, episode: ep.episode, error: err.message });
    }
  }

  syncVixredVisibility();
  return result;
}

function parseEpisodePathFromVideoPath(videoPath) {
  const m = String(videoPath || '').match(/\/series\/([^/]+)\/S(\d+)E(\d+)\.mkv/i);
  if (!m) return null;
  return {
    folder: m[1],
    season: parseInt(m[2], 10),
    episode: parseInt(m[3], 10),
    destBase: `S${m[2]}E${m[3]}`
  };
}

function episodeFolderForRow(epRow) {
  const parsed = parseEpisodePathFromVideoPath(epRow.video_path);
  if (parsed?.folder) return parsed.folder;
  return seriesFolderName(epRow.series_title || epRow.title, epRow.year);
}

function listPendingEpisodes() {
  return db
    .prepare(`
      SELECT e.*, s.title AS series_title, s.allcalidad_slug, s.year
      FROM episodes e
      JOIN series s ON s.id = e.series_id
      WHERE COALESCE(e.available, 1) = 0
        AND COALESCE(s.allcalidad_slug, '') != ''
      ORDER BY e.series_id ASC, e.season ASC, e.episode ASC
    `)
    .all();
}

async function finalizeEpisodeIfReady(epRow) {
  const folder = episodeFolderForRow(epRow);
  const season = epRow.season;
  const episode = epRow.episode;
  const absPath = episodeAbsPath(folder, season, episode);
  const finished = episodeReady(absPath)
    ? absPath
    : findFinishedFileInDir(path.dirname(absPath), episodeFileName(season, episode).replace('.mkv', ''));
  if (!finished) return false;

  const publicPath = episodePublicPath(folder, season, episode);
  if (finished !== absPath && fs.existsSync(finished)) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    if (!fs.existsSync(absPath)) fs.renameSync(finished, absPath);
  }
  let videoQuality = '';
  try {
    const { probeVideoQuality } = require('./videoQuality');
    videoQuality = probeVideoQuality(absPath);
  } catch { /* ignore */ }
  db.prepare('UPDATE episodes SET available = 1, video_path = ?, video_quality = ? WHERE id = ?')
    .run(publicPath, videoQuality || null, epRow.id);
  clearEpisodeDownloadJob(epRow.id);
  try {
    const { scheduleVideoPrep } = require('./videoPrep');
    scheduleVideoPrep(absPath, epRow.id, 'episode');
  } catch { /* ignore */ }
  try {
    const { autoSyncEpisodeTmdbIfNeeded, autoSyncSeriesTmdbIfNeeded } = require('./tmdbMetadata');
    await autoSyncSeriesTmdbIfNeeded(epRow.series_id, { title: epRow.series_title });
    await autoSyncEpisodeTmdbIfNeeded(epRow.id);
  } catch (e) {
    console.warn(`[tmdb-auto] ep #${epRow.id}:`, e.message);
  }
  return true;
}

async function resumeEpisodeDownload(episodeId, options = {}) {
  const ep = db.prepare(`
    SELECT e.*, s.title AS series_title, s.allcalidad_slug, s.year
    FROM episodes e
    JOIN series s ON s.id = e.series_id
    WHERE e.id = ?
  `).get(episodeId);
  if (!ep) throw new Error('Episodio no encontrado');
  if (Number(ep.available) === 1) return { ok: true, skipped: true, reason: 'ya disponible' };

  if (await finalizeEpisodeIfReady(ep)) {
    return { ok: true, finalized: true };
  }

  const slug = String(options.slug || ep.allcalidad_slug || '').trim();
  if (!slug) return { ok: false, error: 'Serie sin slug AllCalidad' };

  const folder = episodeFolderForRow(ep);
  const publicPath = episodePublicPath(folder, ep.season, ep.episode);
  db.prepare('UPDATE episodes SET video_path = ?, available = 0 WHERE id = ?').run(publicPath, ep.id);

  const { episodes: rawEps } = await fetchSeriesBySlug(slug);
  const apiEp = rawEps
    .map((item) => {
      const se = parseEpisodeSlug(item.slug);
      if (!se) return null;
      return { ...item, season: se.season, episode: se.episode };
    })
    .filter(Boolean)
    .find((item) => item.season === ep.season && item.episode === ep.episode);

  if (!apiEp) return { ok: false, error: 'Episodio no encontrado en AllCalidad' };

  try {
    console.log(`[allcalidad-series] Reanudando ${ep.series_title} S${ep.season}E${ep.episode}…`);
    const embedCandidates = await fetchEpisodeEmbedCandidates(apiEp._id);
    await downloadEpisodeFile({
      folder,
      season: ep.season,
      episode: ep.episode,
      embedCandidates,
      logSlug: `${slug}-s${ep.season}e${ep.episode}`,
      episodeId: ep.id,
      quality: options.quality || 'max'
    });
    db.prepare('UPDATE episodes SET available = 1, video_path = ? WHERE id = ?').run(publicPath, ep.id);
    clearEpisodeDownloadJob(ep.id);
    try {
      const { scheduleVideoPrep } = require('./videoPrep');
      scheduleVideoPrep(episodeAbsPath(folder, ep.season, ep.episode), ep.id, 'episode');
    } catch { /* ignore */ }
    try {
      const { autoSyncEpisodeTmdbIfNeeded, autoSyncSeriesTmdbIfNeeded } = require('./tmdbMetadata');
      await autoSyncSeriesTmdbIfNeeded(ep.series_id, { title: ep.series_title });
      await autoSyncEpisodeTmdbIfNeeded(ep.id);
    } catch (e) {
      console.warn(`[tmdb-auto] ep #${ep.id}:`, e.message);
    }
    return { ok: true };
  } catch (err) {
    console.error(`[allcalidad-series] S${ep.season}E${ep.episode}`, err.message);
    return { ok: false, error: err.message };
  }
}

async function resolveEpisodeStreamForPlay(episodePostId, quality = '1080') {
  const candidates = await fetchEpisodeEmbedCandidatesFast(episodePostId);
  const { pickAllcalidadCandidate } = require('./vodYtDlp');
  const mapped = candidates.map((c) => ({
    type: c.type,
    url: c.url,
    referer: c.referer || 'https://allcalidad.re/',
    maxHeight: /\.m3u8/i.test(c.url) ? 1080 : (c.type === 'goodstream' ? 1080 : 720),
    host: c.type
  }));
  const picked = pickAllcalidadCandidate(mapped, quality) || mapped[0];
  if (!picked?.url) throw new Error('Sin stream en episodio');
  return {
    url: picked.url,
    referer: picked.referer || 'https://allcalidad.re/',
    maxHeight: picked.maxHeight || 0,
    type: picked.type
  };
}

module.exports = {
  fetchSeriesBySlug,
  importSeriesFromAllcalidad,
  parseEpisodeSlug,
  seriesFolderName,
  episodePublicPath,
  listPendingEpisodes,
  finalizeEpisodeIfReady,
  resumeEpisodeDownload,
  resolveEpisodeStreamForPlay
};
