#!/usr/bin/env node
const db = require('../db');
const { deduplicateCatalog, extractSlugFromPath } = require('../services/movieDedup');
const { registerDownloadJob } = require('../services/vodDownloadProgress');
const { logRelForMovie } = require('../services/vodYtDlp');
const { extractSlugFromPath } = require('../services/movieDedup');

const removed = deduplicateCatalog();
console.log('[dedupe] eliminadas:', removed.length, removed);

const pending = db.prepare('SELECT * FROM movies WHERE COALESCE(available, 1) = 0').all();
for (const m of pending) {
    const slug = extractSlugFromPath(m.video_path);
    if (slug) {
      registerDownloadJob(m.id, {
        logFile: logRelForMovie(m, slug),
        destBase: `pending_${slug}`,
        slug
      });
    }
}
console.log('[dedupe] jobs actualizados para', pending.length, 'pendientes');
