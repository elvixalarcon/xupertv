#!/usr/bin/env node
const { syncFastChannels } = require('../services/fastChannelsSync');

syncFastChannels({ force: true, downloadLogos: true })
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
