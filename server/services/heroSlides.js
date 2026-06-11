const db = require('../db');
const { getTmdbApiKey } = require('./settings');
const { fetchTmdbHeroExtras, fetchTmdbHeroExtrasByTitle } = require('./posters');
const { getAutoRecommendedMovies, AUTO_RECOMMENDED_MIN_RATING } = require('./catalogCategories');
const { bannerUrlForItem } = require('./bannerArt');
// fetchTmdbHeroExtras is movie-only; series hero uses poster when no TV backdrop helper exists.

function sortMoviesByRating(movies) {
  return [...movies].sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

function canMovies(user) {
  return user.role === 'admin' || user.can_movies;
}

async function buildMovieHeroSlide(movie, stmts) {
  let trailer = (movie.trailer || '').trim();
  let backdrop = '';

  if (getTmdbApiKey()) {
    try {
      let extras = { trailer: '', backdrop: '' };
      if (movie.tmdb_id) {
        extras = await fetchTmdbHeroExtras(movie.tmdb_id);
      } else if (movie.title) {
        const byTitle = await fetchTmdbHeroExtrasByTitle(movie.title, movie.year);
        extras = byTitle;
        if (byTitle.tmdb_id) stmts.updateTmdbIdMovie.run(byTitle.tmdb_id, movie.id);
      }
      if (extras.trailer && !trailer) {
        trailer = extras.trailer;
        stmts.updateTrailerMovie.run(trailer, movie.id);
      }
      if (extras.backdrop) backdrop = extras.backdrop;
    } catch { /* sin TMDB */ }
  }
  if (!backdrop) backdrop = movie.poster || '';

  return {
    id: movie.id,
    content_type: 'movie',
    title: movie.title,
    year: movie.year || null,
    genre: movie.genre || '',
    description: movie.description || '',
    rating: movie.rating || null,
    poster: movie.poster || '',
    backdrop,
    banner: bannerUrlForItem({ id: movie.id, content_type: 'movie' }),
    trailer
  };
}

/** Añade backdrop horizontal TMDB a filas de películas (tiles del hero TV). */
async function enrichMoviesHeroBackdrops(movies) {
  if (!movies?.length) return [];
  const stmts = {
    updateTrailerMovie: db.prepare("UPDATE movies SET trailer = ? WHERE id = ? AND (trailer IS NULL OR trailer = '')"),
    updateTmdbIdMovie: db.prepare('UPDATE movies SET tmdb_id = ? WHERE id = ? AND tmdb_id IS NULL')
  };
  return Promise.all(movies.map(async (m) => {
    const slide = await buildMovieHeroSlide(m, stmts);
    return { ...m, backdrop: slide.backdrop, poster: slide.poster || m.poster, trailer: slide.trailer || m.trailer };
  }));
}

/** Carrusel del inicio: películas con mejor nota TMDB. */
async function getHeroSlides(user) {
  if (!canMovies(user)) return [];

  let movies = getAutoRecommendedMovies(20, '*');
  if (movies.length < 6) {
    const extra = db.prepare(`
      SELECT * FROM movies WHERE COALESCE(available, 1) = 1
        AND COALESCE(rating, 0) > 0 AND COALESCE(rating, 0) < ?
      ORDER BY rating DESC, created_at DESC LIMIT 12
    `).all(AUTO_RECOMMENDED_MIN_RATING);
    const ids = new Set(movies.map((m) => m.id));
    for (const m of extra) {
      if (!ids.has(m.id)) {
        movies.push(m);
        ids.add(m.id);
      }
      if (movies.length >= 10) break;
    }
  }

  movies = sortMoviesByRating(movies).slice(0, 10);

  const stmts = {
    updateTrailerMovie: db.prepare("UPDATE movies SET trailer = ? WHERE id = ? AND (trailer IS NULL OR trailer = '')"),
    updateTmdbIdMovie: db.prepare('UPDATE movies SET tmdb_id = ? WHERE id = ? AND tmdb_id IS NULL')
  };

  const slides = await Promise.all(movies.map((m) => buildMovieHeroSlide(m, stmts)));
  return slides.filter((s) => s.backdrop || s.poster);
}

async function getSeriesHeroSlides(user) {
  const can = user.role === 'admin' || user.can_series;
  if (!can) return [];

  const series = db.prepare(`
    SELECT DISTINCT s.*
    FROM series s
    INNER JOIN episodes e ON e.series_id = s.id AND COALESCE(e.available, 1) = 1
    WHERE COALESCE(s.rating, 0) >= ?
    ORDER BY s.rating DESC, s.created_at DESC
    LIMIT 10
  `).all(AUTO_RECOMMENDED_MIN_RATING);

  const stmts = {
    updateTrailerMovie: db.prepare("UPDATE series SET trailer = ? WHERE id = ? AND (trailer IS NULL OR trailer = '')"),
    updateTmdbIdMovie: db.prepare('UPDATE series SET tmdb_id = ? WHERE id = ? AND tmdb_id IS NULL')
  };

  const slides = await Promise.all(series.map(async (s) => {
    let backdrop = s.poster || '';
    if (getTmdbApiKey() && s.tmdb_id) {
      try {
        const extras = await fetchTmdbHeroExtras(s.tmdb_id);
        if (extras.backdrop) backdrop = extras.backdrop;
      } catch { /* ignore */ }
    }
    return {
      id: s.id,
      content_type: 'series',
      title: s.title,
      year: s.year || null,
      genre: s.genre || '',
      description: s.description || '',
      rating: s.rating || null,
      poster: s.poster || '',
      backdrop,
      banner: bannerUrlForItem({ id: s.id, content_type: 'series' }),
      trailer: s.trailer || ''
    };
  }));
  return slides.filter((s) => s.backdrop || s.poster);
}

module.exports = { getHeroSlides, getSeriesHeroSlides, enrichMoviesHeroBackdrops, buildMovieHeroSlide };
