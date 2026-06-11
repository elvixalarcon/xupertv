#!/usr/bin/env node
/** Ejecuta el job nocturno de VOD manualmente (o desde cron del host). */
const { runNightlyJob } = require('../services/vodNightlySync');

const force = process.argv.includes('--force');

runNightlyJob({ force })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    if (r.skipped) process.exit(0);
    const errs = (r.cuevana?.errors?.length || 0) + (r.allcalidad?.errors?.length || 0);
    if (errs) process.exitCode = 1;
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
