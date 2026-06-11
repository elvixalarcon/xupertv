#!/usr/bin/env node
/**
 * Descarga capítulos pendientes uno tras otro (cola automática de series).
 */
const { isYtDlpRunning } = require('../services/vodDownloadProgress');
const {
  listPendingEpisodes,
  resumeEpisodeDownload,
  finalizeEpisodeIfReady
} = require('../services/allcalidadSeriesImport');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sortPendingEpisodes(list) {
  return [...list].sort((a, b) => {
    const sa = String(a.series_title || '');
    const sb = String(b.series_title || '');
    if (sa !== sb) return sa.localeCompare(sb);
    return a.season - b.season || a.episode - b.episode;
  });
}

async function main() {
  const seriesFilter = parseInt(process.argv[2], 10) || null;
  console.log('[series-queue] Orquestador iniciado', seriesFilter ? `(serie #${seriesFilter})` : '');
  const failed = new Map();
  let idleRounds = 0;

  while (idleRounds < 3) {
    let list = listPendingEpisodes();
    if (seriesFilter) list = list.filter((ep) => ep.series_id === seriesFilter);
    const pending = sortPendingEpisodes(list).filter((ep) => {
      const fails = failed.get(ep.id) || 0;
      return fails < 2;
    });
    if (!pending.length) {
      idleRounds++;
      await sleep(30000);
      continue;
    }
    idleRounds = 0;

    while (isYtDlpRunning()) {
      await sleep(20000);
    }

    const ep = pending[0];
    try {
      if (await finalizeEpisodeIfReady(ep)) {
        console.log(
          `[series-queue] #${ep.id} ${ep.series_title} S${ep.season}E${ep.episode} publicado desde archivo existente`
        );
        continue;
      }

      console.log(
        `[series-queue] #${ep.id} ${ep.series_title} S${ep.season}E${ep.episode} (${pending.length} en cola)`
      );
      const r = await resumeEpisodeDownload(ep.id);
      if (r.skipped) {
        console.log(`[series-queue] #${ep.id} omitido:`, r.reason);
      } else if (r.finalized) {
        console.log(`[series-queue] #${ep.id} finalizado`);
      } else if (!r.ok) {
        console.warn(`[series-queue] #${ep.id} falló:`, r.error || r.reason);
        failed.set(ep.id, (failed.get(ep.id) || 0) + 1);
      } else {
        console.log(`[series-queue] #${ep.id} completado`);
        failed.delete(ep.id);
      }
    } catch (e) {
      console.error(`[series-queue] #${ep.id} error:`, e.message);
      failed.set(ep.id, (failed.get(ep.id) || 0) + 1);
    }
    await sleep(8000);
  }

  const left = listPendingEpisodes().length;
  console.log(`[series-queue] Orquestador terminado · ${left} pendientes · ${failed.size} fallidos`);
}

main().catch((e) => {
  console.error('[series-queue]', e.message);
  process.exit(1);
});
