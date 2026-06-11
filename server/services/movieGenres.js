const db = require('../db');

const EXCLUDED_PATTERNS = [
  /^soap$/i,
  /^telenovela$/i,
  /^war$/i,
  /^guerra$/i,
  /^b[eé]lica$/i,
  /^politics$/i,
  /^pol[ií]tica$/i,
  /^war\s*&\s*politics$/i,
  /war\s*&\s*politics/i
];

const GENRE_ORDER = [
  'Acción',
  'Aventura',
  'Animación',
  'Comedia',
  'Crimen',
  'Documental',
  'Drama',
  'Familia',
  'Fantasía',
  'Historia',
  'Terror',
  'Música',
  'Misterio',
  'Romance',
  'Ciencia ficción',
  'Suspense',
  'Western',
  'Kids',
  'Reality',
  'Película de TV',
  'Sci-Fi & Fantasy',
  'Action & Adventure',
  'Ciencia ficción y fantasía',
  'Acción y aventura',
  'Infantil'
];

function isGenreExcluded(genre) {
  const g = String(genre || '').trim();
  if (!g) return true;
  return EXCLUDED_PATTERNS.some((re) => re.test(g));
}

function splitGenres(genreField) {
  return String(genreField || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !isGenreExcluded(s));
}

function genreSortKey(genre) {
  const idx = GENRE_ORDER.findIndex(
    (g) => g.toLowerCase() === genre.toLowerCase()
  );
  return idx >= 0 ? idx : 999;
}

/**
 * Filas de películas por género (solo géneros con al menos una película disponible).
 */
function getGenreRows({ limitPerGenre = 24, minMovies = 1 } = {}) {
  const movies = db
    .prepare(
      `SELECT id, title, poster, genre, year, rating, video_path, recommended
       FROM movies WHERE COALESCE(available, 1) = 1
       ORDER BY rating DESC, recommended DESC, created_at DESC`
    )
    .all();

  const byGenre = new Map();

  for (const movie of movies) {
    const genres = splitGenres(movie.genre);
    for (const genre of genres) {
      if (!byGenre.has(genre)) byGenre.set(genre, []);
      const list = byGenre.get(genre);
      if (!list.some((m) => m.id === movie.id)) list.push(movie);
    }
  }

  return [...byGenre.entries()]
    .filter(([, list]) => list.length >= minMovies)
    .sort((a, b) => {
      const order = genreSortKey(a[0]) - genreSortKey(b[0]);
      if (order !== 0) return order;
      return b[1].length - a[1].length;
    })
    .map(([genre, list]) => ({
      genre,
      count: list.length,
      movies: list.slice(0, limitPerGenre)
    }));
}

module.exports = {
  isGenreExcluded,
  splitGenres,
  getGenreRows,
  genreSortKey,
  GENRE_ORDER
};
