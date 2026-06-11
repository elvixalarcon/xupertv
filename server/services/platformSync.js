const db = require('../db');
const { getTmdbApiKey } = require('./settings');
const { fetchJson } = require('./posters');

/** IDs de proveedores TMDB → slug interno Vix TV */
const TMDB_PROVIDER_IDS = {
  8: 'netflix',
  1796: 'netflix',
  337: 'disney',
  390: 'disney',
  9: 'prime-video',
  119: 'prime-video',
  10: 'prime-video',
  582: 'prime-video',
  384: 'hbo',
  1899: 'hbo',
  350: 'apple-tv',
  15: 'hulu',
  531: 'paramount',
  4330: 'paramount'
};

const TMDB_NETWORK_IDS = {
  213: 'netflix',
  49: 'hbo',
  3186: 'hbo',
  2739: 'disney',
  44: 'disney',
  54: 'disney',
  2552: 'apple-tv',
  1024: 'prime-video',
  4330: 'paramount',
  16: 'paramount',
  34: 'hulu'
};

const NAME_KEYWORDS = [
  { id: 'netflix', words: ['netflix'] },
  { id: 'disney', words: ['disney', 'disney+', 'pixar', 'marvel studios', 'lucasfilm', 'star wars', 'national geographic', 'abc studios', '20th century', 'searchlight'] },
  { id: 'prime-video', words: ['prime video', 'amazon studios', 'amazon mgm', 'mgm+', 'metro-goldwyn', 'amazon prime'] },
  { id: 'hbo', words: ['hbo', 'hbo max', 'max original', 'warner bros', 'warnermedia', 'new line cinema', 'dc films'] },
  { id: 'apple-tv', words: ['apple tv', 'apple original', 'apple studios'] },
  { id: 'hulu', words: ['hulu', 'fx productions', 'fx networks'] },
  { id: 'paramount', words: ['paramount', 'paramount+', 'cbs', 'nickelodeon', 'mtv', 'comedy central', 'showtime'] }
];

const WATCH_REGIONS = ['EC', 'US', 'MX', 'ES', 'AR', 'CO'];
const REQUEST_DELAY_MS = 320;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function matchNameKeywords(text) {
  const lower = String(text || '').toLowerCase();
  const found = new Set();
  for (const row of NAME_KEYWORDS) {
    if (row.words.some((w) => lower.includes(w))) found.add(row.id);
  }
  return [...found];
}

function providersFromWatchPayload(data) {
  const ids = new Set();
  const results = data?.results || {};
  for (const region of WATCH_REGIONS) {
    const block = results[region];
    if (!block) continue;
    for (const bucket of ['flatrate', 'free', 'ads']) {
      for (const p of block[bucket] || []) {
        const mapped = TMDB_PROVIDER_IDS[p.provider_id];
        if (mapped) ids.add(mapped);
        const byName = matchNameKeywords(p.provider_name);
        byName.forEach((x) => ids.add(x));
      }
    }
  }
  return [...ids];
}

function platformsFromTvDetail(detail) {
  const ids = new Set();
  for (const n of detail?.networks || []) {
    const mapped = TMDB_NETWORK_IDS[n.id];
    if (mapped) ids.add(mapped);
    matchNameKeywords(n.name).forEach((x) => ids.add(x));
  }
  for (const c of detail?.production_companies || []) {
    matchNameKeywords(c.name).forEach((x) => ids.add(x));
  }
  return [...ids];
}

function platformsFromMovieDetail(detail) {
  const ids = new Set();
  for (const c of detail?.production_companies || []) {
    matchNameKeywords(c.name).forEach((x) => ids.add(x));
  }
  for (const c of detail?.belongs_to_collection ? [detail.belongs_to_collection] : []) {
    matchNameKeywords(c.name).forEach((x) => ids.add(x));
  }
  return [...ids];
}

async function fetchPlatformsForMovie(tmdbId) {
  const key = getTmdbApiKey();
  if (!key || !tmdbId) return [];
  const ids = new Set();
  try {
    const watch = await fetchJson(
      `https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${key}`
    );
    providersFromWatchPayload(watch).forEach((x) => ids.add(x));
    await sleep(REQUEST_DELAY_MS);
    const detail = await fetchJson(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&language=es-ES`
    );
    platformsFromMovieDetail(detail).forEach((x) => ids.add(x));
  } catch (err) {
    console.warn('[platform-sync] movie', tmdbId, err.message || err);
  }
  return [...ids];
}

async function fetchPlatformsForSeries(tmdbId) {
  const key = getTmdbApiKey();
  if (!key || !tmdbId) return [];
  const ids = new Set();
  try {
    const watch = await fetchJson(
      `https://api.themoviedb.org/3/tv/${tmdbId}/watch/providers?api_key=${key}`
    );
    providersFromWatchPayload(watch).forEach((x) => ids.add(x));
    await sleep(REQUEST_DELAY_MS);
    const detail = await fetchJson(
      `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&language=es-ES`
    );
    platformsFromTvDetail(detail).forEach((x) => ids.add(x));
  } catch (err) {
    console.warn('[platform-sync] series', tmdbId, err.message || err);
  }
  return [...ids];
}

function storePlatform(table, id, platforms) {
  const value = platforms.length ? platforms.join(',') : '';
  db.prepare(`UPDATE ${table} SET platform = ? WHERE id = ?`).run(value, id);
}

async function syncAllPlatforms(opts = {}) {
  const key = getTmdbApiKey();
  if (!key) {
    return { ok: false, error: 'Sin API Key TMDB' };
  }

  const onlyMissing = opts.onlyMissing !== false;
  const limit = Math.min(500, Math.max(1, parseInt(opts.limit, 10) || 500));
  let movies = db.prepare(`
    SELECT id, title, tmdb_id, platform FROM movies
    WHERE COALESCE(available, 1) = 1 AND tmdb_id IS NOT NULL
    ORDER BY id
  `).all();
  let series = db.prepare(`
    SELECT id, title, tmdb_id, platform FROM series
    WHERE tmdb_id IS NOT NULL
    ORDER BY id
  `).all();

  if (onlyMissing) {
    movies = movies.filter((m) => !String(m.platform || '').trim());
    series = series.filter((s) => !String(s.platform || '').trim());
  }
  movies = movies.slice(0, limit);
  series = series.slice(0, Math.max(0, limit - movies.length));

  const stats = { movies: 0, series: 0, withPlatform: 0, errors: 0 };

  for (const m of movies) {
    const platforms = await fetchPlatformsForMovie(m.tmdb_id);
    storePlatform('movies', m.id, platforms);
    stats.movies++;
    if (platforms.length) stats.withPlatform++;
    await sleep(REQUEST_DELAY_MS);
  }

  for (const s of series) {
    const platforms = await fetchPlatformsForSeries(s.tmdb_id);
    storePlatform('series', s.id, platforms);
    stats.series++;
    if (platforms.length) stats.withPlatform++;
    await sleep(REQUEST_DELAY_MS);
  }

  return { ok: true, ...stats };
}

function startPlatformSyncScheduler() {
  setTimeout(async () => {
    try {
      const missing = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM movies WHERE COALESCE(available,1)=1 AND tmdb_id IS NOT NULL AND COALESCE(platform,'')='') +
          (SELECT COUNT(*) FROM series WHERE tmdb_id IS NOT NULL AND COALESCE(platform,'')='') AS c
      `).get().c;
      if (missing > 0 && getTmdbApiKey()) {
        console.log(`[platform-sync] Sincronizando plataformas TMDB (${missing} títulos sin plataforma)…`);
        const result = await syncAllPlatforms({ onlyMissing: true });
        console.log('[platform-sync] Listo:', result);
      }
    } catch (err) {
      console.warn('[platform-sync]', err.message || err);
    }
  }, 15000);
}

module.exports = { syncAllPlatforms, fetchPlatformsForMovie, fetchPlatformsForSeries, startPlatformSyncScheduler };
