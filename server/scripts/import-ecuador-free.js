#!/usr/bin/env node
const { importFreeEcuadorChannels } = require('../services/freeEcuadorChannels');
const epgService = require('../services/epgService');

importFreeEcuadorChannels({ downloadLogos: true })
  .then(async (summary) => {
    console.log(JSON.stringify(summary, null, 2));
    await epgService.refreshEpg({ force: true });
    console.log('EPG refreshed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
