#!/usr/bin/env node
/** Repara video_path apuntando a MP4 corruptos → MKV válido */
const path = require('path');
const db = require('../db');
const { isValidVideoFile, toPublicPath } = require('../services/videoPrep');
const { findFinishedFile, destBaseFromMovie } = require('../services/vodYtDlp');
const { clearPrepJob } = require('../services/vodDownloadProgress');

const DATA = path.join(__dirname, '..', '..', 'data');

const movies = db.prepare('SELECT * FROM movies').all();
let fixed = 0;

for (const m of movies) {
  const vp = m.video_path || '';
  const abs = vp.startsWith('/uploads/')
    ? path.join(DATA, vp.replace(/^\/uploads\//, ''))
    : null;

  if (abs && isValidVideoFile(abs)) continue;

  const destBase = destBaseFromMovie(m);
  const good = findFinishedFile(destBase);
  if (!good) {
    if (abs && !isValidVideoFile(abs)) {
      console.warn(`[repair] #${m.id} ${m.title}: sin archivo válido (${vp})`);
    }
    continue;
  }

  const newPath = toPublicPath(good);
  db.prepare('UPDATE movies SET video_path=?, available=1 WHERE id=?').run(newPath, m.id);
  clearPrepJob(m.id);
  console.log(`[repair] #${m.id} ${m.title} → ${newPath}`);
  fixed++;
}

console.log(`[repair] ${fixed} películas corregidas`);
