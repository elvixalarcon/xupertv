#!/usr/bin/env node
/**
 * Importa serie desde AllCalidad (temporadas y capítulos).
 * Uso:
 *   node server/scripts/import-allcalidad-series.js --slug from-2022 --download
 *   node server/scripts/import-allcalidad-series.js --slug it-bienvenidos-a-derry-2025 --download --only-missing --series-id 2
 */
const { importSeriesFromAllcalidad } = require('../services/allcalidadSeriesImport');

function parseArgs(argv) {
  const out = {
    slug: '',
    download: false,
    onlyMissing: false,
    seriesId: 0,
    limit: 0,
    quality: 'max'
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--download') out.download = true;
    else if (a === '--only-missing') out.onlyMissing = true;
    else if (a === '--quality') out.quality = argv[++i] || 'max';
    else if (a === '--slug') out.slug = argv[++i] || '';
    else if (a === '--series-id') out.seriesId = parseInt(argv[++i], 10) || 0;
    else if (a === '--limit') out.limit = parseInt(argv[++i], 10) || 0;
    else if (a.startsWith('http')) {
      const m = a.match(/\/series\/([^/?#]+)/i) || a.match(/\/tvshows\/([^/?#]+)/i);
      if (m) out.slug = m[1];
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.slug) {
    console.error('Uso: import-allcalidad-series.js --slug <slug> [--download] [--only-missing] [--series-id N]');
    process.exit(1);
  }

  console.log('[import-series] Iniciando', opts.slug, opts.download ? '(con descarga)' : '(solo catálogo)');
  const result = await importSeriesFromAllcalidad(opts.slug, {
    download: opts.download,
    onlyMissing: opts.onlyMissing,
    seriesId: opts.seriesId || null,
    quality: opts.quality
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[import-series]', err.message);
  process.exit(1);
});
