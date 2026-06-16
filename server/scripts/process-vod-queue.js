#!/usr/bin/env node
/**
 * Descarga todas las películas pendientes una tras otra.
 */
const path = require('path');
const db = require('../db');
const { extractSlugFromPath } = require('../services/movieDedup');
const { isYtDlpRunning } = require('../services/vodDownloadProgress');
const {
  resumeMovieDownload,
  hasPartialFiles,
  destBaseFromMovie,
  findFinishedFileForMovie,
  finalizeDownloadedMovie
} = require('../services/vodYtDlp');
const { getDownloadJob } = require('../services/vodDownloadProgress');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function listPending() {
  const rows = db.prepare('SELECT * FROM movies WHERE COALESCE(available, 1) = 0 ORDER BY id').all();
  return rows
    .sort((a, b) => {
      const pa = hasPartialFiles(destBaseFromMovie(a)) ? 0 : 1;
      const pb = hasPartialFiles(destBaseFromMovie(b)) ? 0 : 1;
      return pa - pb || a.id - b.id;
    });
}

async function main() {
  console.log('[vod-queue] Orquestador iniciado');
  const failed = new Set();
  let idleRounds = 0;

  while (idleRounds < 3) {
    const pending = listPending().filter((m) => !failed.has(m.id));
    if (!pending.length) {
      idleRounds++;
      await sleep(30000);
      continue;
    }
    idleRounds = 0;

    while (isYtDlpRunning()) {
      await sleep(20000);
    }

    const m = pending[0];
    try {
      const job = getDownloadJob(m.id) || {};
      const slug = job.slug || extractSlugFromPath(m.video_path);
      const finished = findFinishedFileForMovie(m, job);
      if (finished) {
        const vp = `/uploads/movies/${path.basename(finished)}`;
        await finalizeDownloadedMovie(m.id, finished, vp);
        console.log(`[vod-queue] #${m.id} publicada desde archivo existente`);
        continue;
      }

      console.log(`[vod-queue] #${m.id} ${m.title} (${pending.length} en cola)`);
      const r = await resumeMovieDownload(m.id, { slug });
      if (r.skipped) {
        console.log(`[vod-queue] #${m.id} omitida:`, r.reason);
      } else if (!r.ok) {
        console.warn(`[vod-queue] #${m.id} falló:`, r.error || r.reason);
        failed.add(m.id);
      } else {
        console.log(`[vod-queue] #${m.id} completada`);
      }
    } catch (e) {
      console.error(`[vod-queue] #${m.id} error:`, e.message);
      failed.add(m.id);
    }
    await sleep(4000);
  }

  const left = listPending().length;
  console.log(`[vod-queue] Orquestador terminado · ${left} pendientes · ${failed.size} fallidas`);
}

main().catch((e) => {
  console.error('[vod-queue]', e.message);
  process.exit(1);
});
