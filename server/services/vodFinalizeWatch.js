const db = require('../db');
const { findFinishedFile, finalizeDownloadedMovie, destBaseFromMovie } = require('./vodYtDlp');
const { clearDownloadJob, isYtDlpRunning } = require('./vodDownloadProgress');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');

let timer = null;

async function finalizeOne(movie) {
  const destBase = destBaseFromMovie(movie);
  const finished = findFinishedFile(destBase);
  if (!finished) return false;

  const minSize = finished.endsWith('.mkv') ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
  if (fs.statSync(finished).size < minSize) return false;

  const vp = `/uploads/movies/${path.basename(finished)}`;
  await finalizeDownloadedMovie(movie.id, finished, vp);
  console.log(`[vod-finalize] #${movie.id} ${movie.title} → ${path.basename(finished)}`);
  return true;
}

async function tick() {
  const { listResumableMovies, hasPartialFiles, destBaseFromMovie } = require('./vodYtDlp');
  const candidates = listResumableMovies()
    .filter((m) => hasPartialFiles(destBaseFromMovie(m)) || findFinishedFile(destBaseFromMovie(m)))
    .slice(0, 20);
  for (const m of candidates) {
    try {
      await finalizeOne(m);
    } catch (e) {
      console.warn(`[vod-finalize] #${m.id}`, e.message);
    }
  }

  const { listPendingEpisodes, finalizeEpisodeIfReady } = require('./allcalidadSeriesImport');
  for (const ep of listPendingEpisodes()) {
    try {
      if (await finalizeEpisodeIfReady(ep)) {
        console.log(
          `[vod-finalize] ep #${ep.id} ${ep.series_title} S${ep.season}E${ep.episode} → disponible`
        );
      }
    } catch (e) {
      console.warn(`[vod-finalize] ep #${ep.id}`, e.message);
    }
  }

  try {
    const { syncMoviesNeedingTmdbBatch } = require('./tmdbMetadata');
    const r = await syncMoviesNeedingTmdbBatch(3);
    if (r.synced > 0) {
      console.log(`[tmdb-auto] ${r.synced} película(s) con metadatos TMDB actualizados`);
    }
  } catch (e) {
    console.warn('[tmdb-auto]', e.message);
  }

  try {
    const { listMoviesNeedingMp4, ensureMovieMp4 } = require('./videoPrep');
    const { isValidMediaFile, absFromPublic } = require('./playablePath');
    for (const m of listMoviesNeedingMp4(1)) {
      const mp4 = m.video_path.replace(/\.mkv$/i, '.mp4');
      if (isValidMediaFile(absFromPublic(mp4))) {
        db.prepare('UPDATE movies SET video_path = ? WHERE id = ?').run(mp4, m.id);
        continue;
      }
      console.log(`[vod-mp4] Remux ${m.id} ${m.title}…`);
      const r = await ensureMovieMp4(m.id);
      if (r.ok) console.log(`[vod-mp4] #${m.id} → ${r.publicPath}`);
      else if (!r.skipped) console.warn(`[vod-mp4] #${m.id}`, r.error);
    }
  } catch (e) {
    console.warn('[vod-mp4]', e.message);
  }
}

function startVodFinalizeWatch() {
  if (timer) return;
  timer = setInterval(() => tick().catch((e) => console.warn('[vod-finalize]', e.message)), 45 * 1000);
  setTimeout(() => tick().catch(() => {}), 5000);
  if (timer.unref) timer.unref();
  console.log('[vod-finalize] Auto-finalización de descargas completas activa');
}

module.exports = { startVodFinalizeWatch, finalizeOne };
