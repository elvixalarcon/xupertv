#!/usr/bin/env node
/** Sincroniza todo el catálogo VOD (películas y series) con TMDB. */
const { refreshAllVodFromTmdb } = require('../services/tmdbMetadata');

(async () => {
  const result = await refreshAllVodFromTmdb();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors?.length) process.exitCode = 1;
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
