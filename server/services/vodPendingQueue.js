const { spawn } = require('child_process');
const path = require('path');
const db = require('../db');
const { extractSlugFromPath } = require('./movieDedup');
const { isYtDlpRunning } = require('./vodDownloadProgress');
const { hasPartialFiles, destBaseFromMovie } = require('./vodYtDlp');
const { getSetting } = require('./settings');

let timer = null;
let orchestratorRunning = false;
let seriesOrchestratorRunning = false;

function isQueueEnabled() {
  return getSetting('vod_queue_enabled', '1') !== '0'
    && getSetting('vod_downloads_paused', '0') !== '1';
}

function listPendingQueue() {
  return db
    .prepare('SELECT * FROM movies WHERE COALESCE(available, 1) = 0 ORDER BY id ASC')
    .all()
    .filter(
      (m) => extractSlugFromPath(m.video_path) || String(m.video_path || '').includes('pending_')
    );
}

function sortQueue(list) {
  return [...list].sort((a, b) => {
    const pa = hasPartialFiles(destBaseFromMovie(a)) ? 0 : 1;
    const pb = hasPartialFiles(destBaseFromMovie(b)) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.id - b.id;
  });
}

function spawnResume(movieId) {
  const script = path.join(__dirname, '..', 'scripts', 'resume-vod-download.js');
  const child = spawn('node', [script, String(movieId)], {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..', '..')
  });
  child.unref();
}

/**
 * Inicia descarga de una película.
 * manual=true → solo esa película (buscador admin). No arranca la cola masiva.
 */
function spawnMovieDownload(movieId, opts = {}) {
  const manual = !!opts.manual;
  spawnResume(movieId);
  if (!manual && isQueueEnabled()) {
    startQueueOrchestrator();
  } else if (manual) {
    console.log(`[vod-queue] Descarga manual iniciada #${movieId}`);
  }
}

function startQueueOrchestrator(opts = {}) {
  const manual = !!opts.manual;
  if (!manual && !isQueueEnabled()) {
    return { ok: false, skipped: true, reason: 'Cola automática pausada' };
  }
  if (orchestratorRunning) {
    return { ok: true, already: true };
  }
  const script = path.join(__dirname, '..', 'scripts', 'process-vod-queue.js');
  const child = spawn('node', [script], {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..', '..')
  });
  child.unref();
  orchestratorRunning = true;
  child.on('close', () => {
    orchestratorRunning = false;
  });
  setTimeout(() => {
    orchestratorRunning = false;
  }, 6 * 3600 * 1000);
  console.log('[vod-queue] Orquestador de descarga masiva iniciado');
  return { ok: true };
}

function listPendingEpisodesQueue() {
  const { listPendingEpisodes } = require('./allcalidadSeriesImport');
  return listPendingEpisodes();
}

function startSeriesQueueOrchestrator(seriesId = null, opts = {}) {
  const manual = !!opts.manual;
  if (!manual && !isQueueEnabled()) {
    return { ok: false, skipped: true, reason: 'Cola automática pausada' };
  }
  if (seriesOrchestratorRunning && !seriesId) {
    return { ok: true, already: true };
  }
  const script = path.join(__dirname, '..', 'scripts', 'process-series-queue.js');
  const args = [script];
  if (seriesId) args.push(String(seriesId));
  const child = spawn('node', args, {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..', '..')
  });
  child.unref();
  seriesOrchestratorRunning = true;
  child.on('close', () => {
    seriesOrchestratorRunning = false;
  });
  setTimeout(() => {
    seriesOrchestratorRunning = false;
  }, 6 * 3600 * 1000);
  console.log('[series-queue] Orquestador de capítulos pendientes iniciado');
  return { ok: true };
}

function tick() {
  if (!isQueueEnabled()) return;
  if (isYtDlpRunning()) return;

  const moviesPending = sortQueue(listPendingQueue());
  const episodesPending = listPendingEpisodesQueue();
  if (!moviesPending.length && !episodesPending.length) return;

  if (moviesPending.length) startQueueOrchestrator();
  if (episodesPending.length) startSeriesQueueOrchestrator();
}

function getQueueStatus() {
  const pending = listPendingQueue();
  const episodesPending = listPendingEpisodesQueue();
  return {
    enabled: isQueueEnabled(),
    pending_count: pending.length,
    orchestrator_running: orchestratorRunning,
    series_pending_count: episodesPending.length,
    series_orchestrator_running: seriesOrchestratorRunning,
    yt_dlp_active: isYtDlpRunning(),
    next: pending.slice(0, 5).map((m) => ({ id: m.id, title: m.title })),
    next_episodes: episodesPending.slice(0, 5).map((ep) => ({
      id: ep.id,
      title: `${ep.series_title} S${ep.season}E${ep.episode}`
    }))
  };
}

function startVodPendingQueue() {
  if (timer) return;
  timer = setInterval(tick, 60 * 1000);
  setTimeout(tick, 20000);
  if (timer.unref) timer.unref();
  console.log('[vod-queue] Cola automática VOD activa (películas + series)');
}

module.exports = {
  startVodPendingQueue,
  startQueueOrchestrator,
  startSeriesQueueOrchestrator,
  spawnMovieDownload,
  spawnResume,
  getQueueStatus,
  listPendingQueue,
  listPendingEpisodesQueue,
  tick
};
