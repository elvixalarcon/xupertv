const db = require('../db');
const {
  splitGenres,
  normalizeGenre,
  getMovieGenreRows,
  getSeriesGenreRows,
  getAutoRecommendedMovies,
  getTrendingItems,
  AUTO_RECOMMENDED_MIN_RATING
} = require('./catalogCategories');

const ROW_PREVIEW_MAX = 10;
const { filterMoviesForProfile, filterSeriesForProfile } = require('./parental');
const { bannerUrlForItem } = require('./bannerArt');

const KIDS_GENRES = new Set(['Infantil', 'Familia', 'Animación']);
const ADULT_GENRES = new Set(['Terror', 'Suspense', 'Crimen']);

const ANIME_PATTERNS = [
  /\banime\b/i,
  /\bmanga\b/i,
  /\bghibli\b/i,
  /\bnaruto\b/i,
  /\bdragon\s*ball\b/i,
  /\bone\s*piece\b/i,
  /\bdemon\s*slayer\b/i,
  /\battack\s*on\s*titan\b/i,
  /\bsh[oō]nen\b/i,
  /\bstudio\s*ghibli\b/i,
  /\bjujutsu\b/i,
  /\bmy\s*hero\s*academia\b/i,
  /\bbleach\b/i,
  /\bfairy\s*tail\b/i,
  /\bpok[eé]mon\b/i,
  /\bdigimon\b/i,
  /\bsailor\s*moon\b/i,
  /\bcowboy\s*bebop\b/i,
  /\bdeath\s*note\b/i
];

const PLATFORMS = [
  { id: 'netflix', title: 'Netflix', color: '#E50914', keywords: ['netflix', 'netflix original'] },
  { id: 'disney', title: 'Disney+', color: '#113CCF', keywords: ['disney', 'disney+', 'pixar', 'marvel', 'star wars', 'national geographic'] },
  { id: 'prime-video', title: 'Prime Video', color: '#00A8E1', keywords: ['prime video', 'amazon prime', 'amazon studios', 'amazon original'] },
  { id: 'hbo', title: 'HBO', color: '#5822B4', keywords: ['hbo', 'hbo max', 'max original', 'warner bros'] },
  { id: 'apple-tv', title: 'Apple TV+', color: '#555555', keywords: ['apple tv', 'apple tv+', 'apple original'] },
  { id: 'hulu', title: 'Hulu', color: '#1CE783', keywords: ['hulu', 'hulu original'] },
  { id: 'paramount', title: 'Paramount+', color: '#0064FF', keywords: ['paramount', 'paramount+', 'paramount plus', 'cbs', 'nickelodeon'] }
];

function allMovies() {
  return db.prepare(`
    SELECT id, title, poster, genre, year, rating, description, video_path, recommended, created_at,
           COALESCE(platform, '') AS platform, 'movie' AS content_type
    FROM movies WHERE COALESCE(available, 1) = 1
    ORDER BY rating DESC, created_at DESC
  `).all();
}

function allSeries() {
  return db.prepare(`
    SELECT DISTINCT s.id, s.title, s.poster, s.genre, s.year, s.rating, s.description, s.created_at,
           COALESCE(s.platform, '') AS platform, 'series' AS content_type
    FROM series s
    INNER JOIN episodes e ON e.series_id = s.id AND COALESCE(e.available, 1) = 1
    ORDER BY s.rating DESC, s.created_at DESC
  `).all();
}

function itemText(item) {
  return `${item.title || ''} ${item.description || ''} ${item.genre || ''}`.toLowerCase();
}

function matchesAnime(item) {
  const text = itemText(item);
  if (ANIME_PATTERNS.some((re) => re.test(text))) return true;
  const genres = splitGenres(item.genre);
  return genres.includes('Animación') && /(japan|jap[oó]n|tokyo|anime)/i.test(text);
}

function matchesKids(item, profile) {
  const genres = splitGenres(item.genre);
  if (genres.some((g) => ADULT_GENRES.has(g))) return false;
  if (genres.some((g) => KIDS_GENRES.has(g))) return true;
  const text = itemText(item);
  if (/(infantil|niñ[oa]s?|kids|familia|disney|pixar|cartoon|peppa|bluey|spongebob)/i.test(text)) return true;
  if (profile && profile.is_kids) {
    return !/(terror|suspense|crimen|guerra|adult)/i.test(text);
  }
  return false;
}

function inferPlatformIds(item) {
  const stored = String(item.platform || '')
    .split(/[,|]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (stored.length) return stored;
  const text = itemText(item);
  const found = [];
  for (const p of PLATFORMS) {
    if (p.keywords.some((k) => text.includes(k.toLowerCase()))) found.push(p.id);
  }
  return found;
}

function matchesPlatform(item, platformId) {
  return inferPlatformIds(item).includes(platformId);
}

function toMixedItems(movies, series) {
  return [...movies, ...series].sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

function filterPool(slug, profile) {
  let movies = filterMoviesForProfile(allMovies(), profile);
  let series = filterSeriesForProfile(allSeries(), profile);

  if (slug === 'destacados') {
    movies = movies.filter((m) => (m.rating || 0) >= AUTO_RECOMMENDED_MIN_RATING || m.recommended);
    series = series.filter((s) => (s.rating || 0) >= AUTO_RECOMMENDED_MIN_RATING);
    return toMixedItems(movies, series);
  }
  if (slug === 'kids') {
    movies = movies.filter((m) => matchesKids(m, profile));
    series = series.filter((s) => matchesKids(s, profile));
    return toMixedItems(movies, series);
  }
  if (slug === 'anime') {
    movies = movies.filter(matchesAnime);
    series = series.filter(matchesAnime);
    return toMixedItems(movies, series);
  }
  if (slug === 'movies') return movies;
  if (slug === 'series') return series;

  const platform = PLATFORMS.find((p) => p.id === slug);
  if (platform) {
    movies = movies.filter((m) => matchesPlatform(m, slug));
    series = series.filter((s) => matchesPlatform(s, slug));
    return toMixedItems(movies, series);
  }
  return [];
}

function buildHeroSlides(pool, limit = 10) {
  return pool.slice(0, limit).map((item) => ({
    id: item.id,
    content_type: item.content_type,
    title: item.title,
    year: item.year || null,
    genre: item.genre || '',
    description: item.description || '',
    rating: item.rating || null,
    poster: item.poster || '',
    backdrop: item.poster || '',
    banner: bannerUrlForItem(item),
    trailer: ''
  }));
}

function buildGenreSections(slug, profile, limitPerGenre = 10, poolOverride = null) {
  const sections = [];
  if (slug === 'movies' || slug === 'destacados') {
    const rows = getMovieGenreRows({ limitPerGenre: 24, minMovies: 1 });
    for (const row of rows) {
      const items = filterMoviesForProfile(row.movies, profile).slice(0, ROW_PREVIEW_MAX);
      if (!items.length) continue;
      sections.push({
        id: `movies-${row.genre.toLowerCase().replace(/\s+/g, '-')}`,
        title: row.genre,
        subtitle: 'Películas',
        type: 'movie',
        genre: row.genre,
        items,
        total: row.count
      });
    }
  }
  if (slug === 'series' || slug === 'destacados') {
    const rows = getSeriesGenreRows({ limitPerGenre: 24, minSeries: 1 });
    for (const row of rows) {
      const items = (row.series || []).slice(0, ROW_PREVIEW_MAX);
      if (!items.length) continue;
      sections.push({
        id: `series-${row.genre.toLowerCase().replace(/\s+/g, '-')}`,
        title: row.genre,
        subtitle: 'Series',
        type: 'series',
        genre: row.genre,
        items,
        total: row.count
      });
    }
  }
  if (slug === 'kids') {
    const pool = filterPool('kids', profile);
    const movieItems = pool.filter((i) => i.content_type === 'movie').slice(0, ROW_PREVIEW_MAX);
    const seriesItems = pool.filter((i) => i.content_type === 'series').slice(0, ROW_PREVIEW_MAX);
    if (movieItems.length) {
      sections.push({
        id: 'kids-movies',
        title: 'Películas infantiles',
        subtitle: 'Kids',
        type: 'movie',
        items: movieItems,
        total: movieItems.length
      });
    }
    if (seriesItems.length) {
      sections.push({
        id: 'kids-series',
        title: 'Series infantiles',
        subtitle: 'Kids',
        type: 'series',
        items: seriesItems,
        total: seriesItems.length
      });
    }
    const byGenre = buildGenreRowsFromPool(pool.filter((i) => i.content_type === 'movie'), 'movie');
    for (const row of byGenre) {
      sections.push({
        id: `kids-${row.genre.toLowerCase().replace(/\s+/g, '-')}`,
        title: row.genre,
        subtitle: 'Kids',
        type: 'movie',
        genre: row.genre,
        items: row.items.slice(0, ROW_PREVIEW_MAX),
        total: row.items.length
      });
    }
  }
  if (slug === 'anime') {
    const pool = poolOverride || filterPool('anime', profile);
    const movieItems = pool.filter((i) => i.content_type === 'movie').slice(0, ROW_PREVIEW_MAX);
    const seriesItems = pool.filter((i) => i.content_type === 'series').slice(0, ROW_PREVIEW_MAX);
    if (movieItems.length) {
      sections.push({ id: 'anime-movies', title: 'Películas anime', type: 'movie', items: movieItems, total: movieItems.length });
    }
    if (seriesItems.length) {
      sections.push({ id: 'anime-series', title: 'Series anime', type: 'series', items: seriesItems, total: seriesItems.length });
    }
    const byGenre = buildGenreRowsFromPool(pool.filter((i) => i.content_type === 'movie'), 'movie');
    for (const row of byGenre) {
      sections.push({
        id: `anime-${row.genre.toLowerCase().replace(/\s+/g, '-')}`,
        title: row.genre,
        subtitle: 'Anime',
        type: 'movie',
        genre: row.genre,
        items: row.items.slice(0, ROW_PREVIEW_MAX),
        total: row.items.length
      });
    }
  }
  return sections.slice(0, limitPerGenre > 0 ? 20 : sections.length);
}

function buildGenreRowsFromPool(pool, type) {
  const byGenre = new Map();
  for (const item of pool) {
    const genre = splitGenres(item.genre)[0] || 'Otros';
    if (!byGenre.has(genre)) byGenre.set(genre, []);
    byGenre.get(genre).push(item);
  }
  return [...byGenre.entries()].map(([genre, items]) => ({ genre, items }));
}

function getExplorePlatforms(profile) {
  return PLATFORMS.map((p) => {
    const pool = filterPool(p.id, profile);
    const items = pool.slice(0, ROW_PREVIEW_MAX);
    const preview = items[0] || null;
    return {
      id: p.id,
      title: p.title,
      color: p.color,
      poster: (preview && preview.poster) || '',
      total: pool.length,
      items
    };
  }).filter((p) => p.total > 0);
}

function getStorefront(slug, opts = {}) {
  const profile = opts.profile || null;
  const id = String(slug || '').trim().toLowerCase();

  if (id === 'explorar') {
    const platforms = getExplorePlatforms(profile);
    const pool = toMixedItems(
      filterMoviesForProfile(allMovies(), profile),
      filterSeriesForProfile(allSeries(), profile)
    ).slice(0, 10);
    return {
      slug: id,
      title: 'Explorar',
      mode: 'explore',
      hero: buildHeroSlides(pool),
      recent: pool.slice(0, 4),
      platforms,
      sections: platforms
        .filter((p) => p.items.length)
        .map((p) => ({
          id: `platform-${p.id}`,
          title: p.title,
          subtitle: 'Plataforma',
          type: 'mixed',
          platform: p.id,
          items: p.items,
          total: p.total
        }))
    };
  }

  const titles = {
    destacados: 'Destacados',
    kids: 'Kids',
    anime: 'Anime',
    movies: 'Películas',
    series: 'Series'
  };
  const platform = PLATFORMS.find((p) => p.id === id);
  const title = (platform && platform.title) || titles[id] || id;

  let pool = filterPool(id, profile);
  if (!pool.length && id === 'destacados') {
    pool = toMixedItems(
      getAutoRecommendedMovies(30),
      filterSeriesForProfile(
        allSeries().filter((s) => (s.rating || 0) >= AUTO_RECOMMENDED_MIN_RATING),
        profile
      )
    );
    if (!pool.length) {
      pool = getTrendingItems(20);
    }
  }
  if (!pool.length && id === 'anime') {
    const movies = filterMoviesForProfile(allMovies(), profile);
    const series = filterSeriesForProfile(allSeries(), profile);
    pool = toMixedItems(
      movies.filter((m) => splitGenres(m.genre).includes('Animación')),
      series.filter((s) => splitGenres(s.genre).includes('Animación'))
    );
    if (!pool.length) {
      pool = toMixedItems(movies, series).filter((i) => /anime|manga|ghibli|naruto|dragon|pok[eé]mon/i.test(itemText(i)));
    }
  }
  if (!pool.length && (id === 'movies' || id === 'series')) {
    pool = id === 'movies'
      ? filterMoviesForProfile(allMovies(), profile)
      : filterSeriesForProfile(allSeries(), profile);
  }
  if (!pool.length && platform) {
    pool = getTrendingItems(20).filter((i) => i.content_type === 'movie' || i.content_type === 'series');
  }

  const hero = buildHeroSlides(pool);
  const recent = pool.slice(0, 4);
  let sections = [];

  if (platform) {
    const movies = pool.filter((i) => i.content_type === 'movie');
    const series = pool.filter((i) => i.content_type === 'series');
    if (movies.length) {
      sections.push({
        id: `platform-${id}-movies`,
        title: 'Películas',
        type: 'movie',
        items: movies.slice(0, ROW_PREVIEW_MAX),
        total: movies.length
      });
    }
    if (series.length) {
      sections.push({
        id: `platform-${id}-series`,
        title: 'Series',
        type: 'series',
        items: series.slice(0, ROW_PREVIEW_MAX),
        total: series.length
      });
    }
  } else {
    sections = buildGenreSections(id, profile, 10, pool);
  }

  return {
    slug: id,
    title,
    mode: 'catalog',
    hero,
    recent,
    sections
  };
}

function getStorefrontSectionItems(sectionId, limit = 500, opts = {}) {
  const cap = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const id = String(sectionId || '').trim();
  const profile = opts.profile || null;

  if (id.startsWith('platform-')) {
    const platformId = id.replace(/^platform-/, '').replace(/-movies$/, '').replace(/-series$/, '');
    let pool = filterPool(platformId, profile);
    if (id.endsWith('-movies')) pool = pool.filter((i) => i.content_type === 'movie');
    if (id.endsWith('-series')) pool = pool.filter((i) => i.content_type === 'series');
    return pool.slice(0, cap);
  }
  if (id === 'kids-movies') return filterPool('kids', profile).filter((i) => i.content_type === 'movie').slice(0, cap);
  if (id === 'kids-series') return filterPool('kids', profile).filter((i) => i.content_type === 'series').slice(0, cap);
  if (id === 'anime-movies') return filterPool('anime', profile).filter((i) => i.content_type === 'movie').slice(0, cap);
  if (id === 'anime-series') return filterPool('anime', profile).filter((i) => i.content_type === 'series').slice(0, cap);
  if (id.startsWith('kids-')) {
    const genre = id.replace(/^kids-/, '').replace(/-/g, ' ');
    return filterPool('kids', profile)
      .filter((i) => i.content_type === 'movie')
      .filter((m) => splitGenres(m.genre).some((g) => g.toLowerCase().includes(genre.toLowerCase())))
      .slice(0, cap);
  }

  const { getHomeSectionItems, getMoviesByGenre, getSeriesByGenre } = require('./catalogCategories');
  if (['for-you', 'top-picks', 'trending', 'new-releases'].includes(id)) {
    return getHomeSectionItems(id, cap, opts);
  }
  if (id.startsWith('movies-')) {
    const genre = id.replace(/^movies-/, '').replace(/-/g, ' ');
    return getMoviesByGenre(genre, cap).map((m) => ({ ...m, content_type: 'movie' }));
  }
  if (id.startsWith('series-')) {
    const genre = id.replace(/^series-/, '').replace(/-/g, ' ');
    return getSeriesByGenre(genre, cap).map((s) => ({ ...s, content_type: 'series' }));
  }
  return [];
}

module.exports = {
  PLATFORMS,
  getStorefront,
  getExplorePlatforms,
  getStorefrontSectionItems,
  matchesKids,
  matchesAnime,
  inferPlatformIds
};
