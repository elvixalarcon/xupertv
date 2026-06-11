const db = require('../db');
const {
  isGenreExcluded,
  splitGenres: splitGenresRaw,
  genreSortKey
} = require('./movieGenres');

/** Nombres unificados en español (estilo Netflix LATAM). */
const GENRE_ALIASES = {
  'sci-fi & fantasy': 'Ciencia ficción y fantasía',
  'science fiction': 'Ciencia ficción',
  'sci-fi': 'Ciencia ficción',
  'action & adventure': 'Acción y aventura',
  mystery: 'Misterio',
  drama: 'Drama',
  comedy: 'Comedia',
  horror: 'Terror',
  thriller: 'Suspense',
  romance: 'Romance',
  animation: 'Animación',
  family: 'Familia',
  documentary: 'Documental',
  crime: 'Crimen',
  fantasy: 'Fantasía',
  adventure: 'Aventura',
  action: 'Acción',
  history: 'Historia',
  music: 'Música',
  western: 'Western',
  kids: 'Infantil',
  reality: 'Reality',
  'war & politics': 'Guerra y política'
};

function normalizeGenre(genre) {
  const raw = String(genre || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (GENRE_ALIASES[key]) return GENRE_ALIASES[key];
  if (/^ciencia ficción/i.test(raw)) return 'Ciencia ficción';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function splitGenres(genreField) {
  return splitGenresRaw(genreField).map(normalizeGenre).filter(Boolean);
}

/** Una película/serie solo en su género principal (evita repetir en muchas filas). */
function buildGenreRows(items, { limitPerGenre = 24, minItems = 1, getGenres, primaryOnly = true }) {
  const byGenre = new Map();
  const placed = new Set();

  for (const item of items) {
    const genres = getGenres(item);
    const targets = primaryOnly ? genres.slice(0, 1) : genres;
    for (const genre of targets) {
      if (primaryOnly && placed.has(item.id)) break;
      if (!byGenre.has(genre)) byGenre.set(genre, []);
      const list = byGenre.get(genre);
      if (!list.some((x) => x.id === item.id)) {
        list.push(item);
        if (primaryOnly) placed.add(item.id);
      }
    }
  }

  return [...byGenre.entries()]
    .filter(([, list]) => list.length >= minItems)
    .sort((a, b) => {
      const order = genreSortKey(a[0]) - genreSortKey(b[0]);
      if (order !== 0) return order;
      return b[1].length - a[1].length;
    })
    .map(([genre, list]) => ({
      genre,
      count: list.length,
      items: list.slice(0, limitPerGenre)
    }));
}

function getMovieGenreRows(opts = {}) {
  const limit = opts.limitPerGenre || 24;
  const movies = db.prepare(`
    SELECT id, title, poster, genre, year, rating, video_path, recommended, created_at
    FROM movies WHERE COALESCE(available, 1) = 1
    ORDER BY rating DESC, recommended DESC, created_at DESC
  `).all();

  return buildGenreRows(movies, {
    limitPerGenre: limit,
    minItems: opts.minMovies ?? 1,
    getGenres: (m) => splitGenres(m.genre)
  }).map((row) => ({
    genre: row.genre,
    count: row.count,
    movies: row.items,
    type: 'movie'
  }));
}

function getSeriesGenreRows(opts = {}) {
  const limit = opts.limitPerGenre || 24;
  const series = db.prepare(`
    SELECT DISTINCT s.id, s.title, s.poster, s.genre, s.year, s.rating, s.description, s.created_at
    FROM series s
    INNER JOIN episodes e ON e.series_id = s.id AND COALESCE(e.available, 1) = 1
    ORDER BY s.created_at DESC
  `).all();

  return buildGenreRows(series, {
    limitPerGenre: limit,
    minItems: opts.minSeries ?? 1,
    getGenres: (s) => splitGenres(s.genre)
  }).map((row) => ({
    genre: row.genre,
    count: row.count,
    series: row.items,
    type: 'series'
  }));
}

function resolveWatchedTrendingItem(row) {
  if (row.content_type === 'movie') {
    return db.prepare(`
      SELECT id, title, poster, genre, year, rating, 'movie' AS content_type
      FROM movies WHERE id = ? AND COALESCE(available, 1) = 1
    `).get(row.content_id) || null;
  }
  if (row.content_type === 'episode') {
    const ep = db.prepare('SELECT series_id FROM episodes WHERE id = ?').get(row.content_id);
    if (!ep?.series_id) return null;
    return db.prepare(`
      SELECT DISTINCT s.id, s.title, s.poster, s.genre, s.year, s.rating, 'series' AS content_type
      FROM series s
      INNER JOIN episodes e ON e.series_id = s.id AND COALESCE(e.available, 1) = 1
      WHERE s.id = ?
    `).get(ep.series_id) || null;
  }
  return null;
}

function shouldSkipTrendingItem(item, seen, excludeMovieIds) {
  const key = `${item.content_type}-${item.id}`;
  if (seen.has(key)) return true;
  if (item.content_type === 'movie' && excludeMovieIds?.has(item.id)) return true;
  return false;
}

function pushTrendingItem(out, seen, item) {
  const key = `${item.content_type}-${item.id}`;
  seen.add(key);
  out.push(item);
}

function getTrendingItems(limit = 20, opts = {}) {
  const cap = Math.min(500, Math.max(1, parseInt(limit, 10) || 20));
  const excludeMovieIds = opts.excludeMovieIds || null;
  const seen = new Set();
  const out = [];

  const watched = db.prepare(`
    SELECT content_type, content_id,
      COUNT(DISTINCT profile_id) AS viewers,
      MAX(updated_at) AS last_watched
    FROM watch_history
    WHERE progress >= 30
    GROUP BY content_type, content_id
    ORDER BY viewers DESC, last_watched DESC
    LIMIT ?
  `).all(cap * 2);

  for (const row of watched) {
    const item = resolveWatchedTrendingItem(row);
    if (!item || shouldSkipTrendingItem(item, seen, excludeMovieIds)) continue;
    pushTrendingItem(out, seen, item);
    if (out.length >= cap) return out;
  }

  const recentMovies = db.prepare(`
    SELECT id, title, poster, genre, year, rating, 'movie' AS content_type, created_at
    FROM movies
    WHERE COALESCE(available, 1) = 1 AND COALESCE(rating, 0) < ?
    ORDER BY created_at DESC LIMIT ?
  `).all(AUTO_RECOMMENDED_MIN_RATING, cap * 2);

  const recentSeries = db.prepare(`
    SELECT DISTINCT s.id, s.title, s.poster, s.genre, s.year, s.rating, 'series' AS content_type, s.created_at
    FROM series s
    INNER JOIN episodes e ON e.series_id = s.id AND COALESCE(e.available, 1) = 1
    ORDER BY s.created_at DESC LIMIT ?
  `).all(cap * 2);

  const recentPool = [...recentMovies, ...recentSeries]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  for (const item of recentPool) {
    if (shouldSkipTrendingItem(item, seen, excludeMovieIds)) continue;
    pushTrendingItem(out, seen, item);
    if (out.length >= cap) break;
  }

  return out;
}

/** Máximo de portadas visibles por fila en TV (el resto en Ver más). */
const ROW_PREVIEW_MAX = 10;

/** Nota mínima TMDB (vote_average) para entrar en Recomendadas. */
const AUTO_RECOMMENDED_MIN_RATING = 7;

function getAutoRecommendedMovies(limit = 80, columns = 'id, title, poster, genre, year, rating') {
  const cap = Math.min(500, Math.max(1, parseInt(limit, 10) || 80));
  return db.prepare(`
    SELECT ${columns}
    FROM movies
    WHERE COALESCE(available, 1) = 1 AND COALESCE(rating, 0) >= ?
    ORDER BY rating DESC, created_at DESC
    LIMIT ?
  `).all(AUTO_RECOMMENDED_MIN_RATING, cap);
}

function countAutoRecommendedMovies() {
  return db.prepare(`
    SELECT COUNT(*) AS c FROM movies
    WHERE COALESCE(available, 1) = 1 AND COALESCE(rating, 0) >= ?
  `).get(AUTO_RECOMMENDED_MIN_RATING).c;
}

/** Solo filas del inicio (sin categorías por género). */
function getHomeSections(opts = {}) {
  const profile = opts.profile || null;
  const profileId = opts.profileId || null;
  const recent = db.prepare(`
    SELECT id, title, poster, genre, year, rating
    FROM movies WHERE COALESCE(available, 1) = 1
    ORDER BY created_at DESC LIMIT 80
  `).all();

  const { filterMoviesForProfile } = require('./parental');
  let recommended = getAutoRecommendedMovies(80);
  if (profile?.is_kids) recommended = filterMoviesForProfile(recommended, profile);

  const sections = [];

  if (profileId) {
    const { getForYouItems } = require('./personalized');
    const forYou = getForYouItems(profileId, profile, 20);
    if (forYou.length) {
      sections.push({
        id: 'for-you',
        title: 'Para ti',
        subtitle: 'Basado en lo que has visto',
        type: 'mixed',
        items: forYou.slice(0, ROW_PREVIEW_MAX),
        total: forYou.length
      });
    }
  }

  if (recommended.length) {
    sections.push({
      id: 'top-picks',
      title: 'Recomendadas',
      subtitle: 'Mejor puntuadas en TMDB',
      type: 'movie',
      items: recommended.slice(0, ROW_PREVIEW_MAX),
      total: recommended.length
    });
  }

  const allRecommendedIds = new Set(recommended.map((m) => m.id));
  const trendingAll = getTrendingItems(80, { excludeMovieIds: allRecommendedIds });
  if (trendingAll.length) {
    sections.push({
      id: 'trending',
      title: 'Tendencias',
      subtitle: 'Lo más visto en la plataforma',
      type: 'mixed',
      items: trendingAll.slice(0, ROW_PREVIEW_MAX),
      total: trendingAll.length
    });
  }

  if (recent.length) {
    sections.push({
      id: 'new-releases',
      title: 'Recién añadido',
      subtitle: 'Estrenos en la plataforma',
      type: 'movie',
      items: recent.slice(0, ROW_PREVIEW_MAX),
      total: recent.length
    });
  }

  return { sections };
}

function getCategoriesCatalog(opts = {}) {
  const limit = opts.limitPerGenre || 24;
  const movieGenres = getMovieGenreRows({ limitPerGenre: limit, minMovies: 1 });
  const seriesGenres = getSeriesGenreRows({ limitPerGenre: limit, minSeries: 1 });
  const sections = [];

  if (movieGenres.length) {
    sections.push({
      id: 'cat-movies-label',
      title: 'Películas por categoría',
      subtitle: 'Explora por género',
      type: 'label',
      items: []
    });
    for (const row of movieGenres) {
      sections.push({
        id: `movies-${row.genre.toLowerCase().replace(/\s+/g, '-')}`,
        title: row.genre,
        subtitle: 'Películas',
        type: 'movie',
        genre: row.genre,
        items: row.movies,
        total: row.count
      });
    }
  }

  if (seriesGenres.length) {
    sections.push({
      id: 'cat-series-label',
      title: 'Series por categoría',
      subtitle: 'Explora por género',
      type: 'label',
      items: []
    });
    for (const row of seriesGenres) {
      sections.push({
        id: `series-${row.genre.toLowerCase().replace(/\s+/g, '-')}`,
        title: row.genre,
        subtitle: 'Series',
        type: 'series',
        genre: row.genre,
        items: row.series,
        total: row.count
      });
    }
  }

  return { sections, movieGenres, seriesGenres };
}

function getHomeCatalog(opts = {}) {
  return getHomeSections(opts);
}

function movieMatchesGenre(movie, targetGenre) {
  const target = normalizeGenre(targetGenre);
  if (!target) return false;
  return splitGenres(movie.genre).some((g) => g === target);
}

function getMoviesByGenre(genreName, limit = 500) {
  const cap = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const movies = db.prepare(`
    SELECT id, title, poster, genre, year, rating, video_path, recommended, created_at
    FROM movies WHERE COALESCE(available, 1) = 1
    ORDER BY rating DESC, recommended DESC, created_at DESC
  `).all();
  return movies.filter((m) => movieMatchesGenre(m, genreName)).slice(0, cap);
}

function getSeriesByGenre(genreName, limit = 500) {
  const cap = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const target = normalizeGenre(genreName);
  const series = db.prepare(`
    SELECT DISTINCT s.id, s.title, s.poster, s.genre, s.year, s.description, s.created_at
    FROM series s
    INNER JOIN episodes e ON e.series_id = s.id AND COALESCE(e.available, 1) = 1
    ORDER BY s.created_at DESC
  `).all();
  return series.filter((s) => splitGenres(s.genre).some((g) => g === target)).slice(0, cap);
}

function getHomeSectionItems(sectionId, limit = 500, opts = {}) {
  const cap = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const id = String(sectionId || '').trim();
  if (id === 'for-you') {
    const { getForYouItems } = require('./personalized');
    if (!opts.profileId) return [];
    return getForYouItems(opts.profileId, opts.profile, cap);
  }
  if (id === 'top-picks') {
    return getAutoRecommendedMovies(cap, 'id, title, poster, genre, year, rating').map((m) => ({
      ...m,
      content_type: 'movie'
    }));
  }
  if (id === 'trending') {
    return getTrendingItems(cap);
  }
  if (id === 'new-releases') {
    return db.prepare(`
      SELECT id, title, poster, genre, year, rating, 'movie' AS content_type
      FROM movies WHERE COALESCE(available, 1) = 1
      ORDER BY created_at DESC LIMIT ?
    `).all(cap);
  }
  return [];
}

module.exports = {
  normalizeGenre,
  splitGenres,
  getMovieGenreRows,
  getSeriesGenreRows,
  getTrendingItems,
  getAutoRecommendedMovies,
  countAutoRecommendedMovies,
  AUTO_RECOMMENDED_MIN_RATING,
  getHomeSections,
  getCategoriesCatalog,
  getHomeCatalog,
  getMoviesByGenre,
  getSeriesByGenre,
  getHomeSectionItems,
  GENRE_ALIASES
};
