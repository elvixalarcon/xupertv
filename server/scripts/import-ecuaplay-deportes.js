#!/usr/bin/env node
const { importEcuaplayDeportes } = require('../services/ecuaplaySync');

importEcuaplayDeportes({ downloadLogos: true })
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(summary.failed > 0 ? 2 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
