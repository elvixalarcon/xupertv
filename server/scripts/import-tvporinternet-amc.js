#!/usr/bin/env node
const { importChannels, CHANNEL_CATALOG } = require('../services/tvPorInternet');

const args = process.argv.slice(2).filter(Boolean);
const names = args.length ? args : CHANNEL_CATALOG.map((c) => c.name);

importChannels(names)
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(summary.failed ? 1 : 0);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
