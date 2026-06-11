#!/usr/bin/env node
/**
 * Convierte una película MKV a MP4 reproducible (remux rápido si es H.264/AAC).
 * Uso: node server/scripts/remux-movie-mp4.js <movieId>
 */
const { ensureMovieMp4 } = require('../services/videoPrep');

async function main() {
  const id = parseInt(process.argv[2], 10);
  if (!id) {
    console.error('Uso: remux-movie-mp4.js <movieId>');
    process.exit(1);
  }
  const r = await ensureMovieMp4(id);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok || r.skipped ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
