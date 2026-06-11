#!/usr/bin/env node
const { syncVixredVisibility } = require('../server/services/vixredSync');

const r = syncVixredVisibility();
console.log('Sincronización VixRED:');
console.log(`  Películas visibles: ${r.moviesOn} | ocultas (pendientes): ${r.moviesOff}`);
console.log(`  Episodios visibles: ${r.epsOn} | ocultos (pendientes): ${r.epsOff}`);
