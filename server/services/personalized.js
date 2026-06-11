const db = require('../db');
const { filterMoviesForProfile, filterSeriesForProfile } = require('./parental');

function getWatchedGenres(profileId, limit = 12) {
  const rows = db.prepare(`
    SELECT m.genre AS g, COUNT(*) AS c
    FROM watch_history wh
    JOIN movies m ON m.id = wh.content_id
    WHERE wh.profile_id = ? AND wh.content_type = 'movie' AND wh.progress >= 120 AND m.genre != ''
    GROUP BY m.genre
    UNION ALL
    SELECT s.genre AS g, COUNT(*) AS c
    FROM watch_history wh
    JOIN episodes e ON e.id = wh.content_id
    JOIN series s ON s.id = e.series_id
    WHERE wh.profile_id = ? AND wh.content_type = 'episode' AND wh.progress >= 120 AND s.genre != ''
    GROUP BY s.genre
    ORDER BY c DESC
    LIMIT ?
  `).all(profileId, profileId, limit);
  const genres = [];
  for (const row of rows) {
    const parts = String(row.g || '').split(/[,/|]/).map((x) => x.trim()).filter(Boolean);
    genres.push(...parts);
  }
  return [...new Set(genres)].slice(0, 5);
}

function getForYouItems(profileId, profile, limit = 20) {
  if (!profileId) return [];
  const cap = Math.min(40, Math.max(4, parseInt(limit, 10) || 20));
  const genres = getWatchedGenres(profileId);
  if (!genres.length) return [];

  const watchedMovieIds = new Set(
    db.prepare(`SELECT content_id FROM watch_history WHERE profile_id = ? AND content_type = 'movie'`)
      .all(profileId).map((r) => r.content_id)
  );
  const watchedSeriesIds = new Set(
    db.prepare(`SELECT DISTINCT series_id FROM watch_history WHERE profile_id = ? AND content_type = 'episode' AND series_id IS NOT NULL`)
      .all(profileId).map((r) => r.series_id)
  );

  const out = [];
  const seen = new Set();

  for (const genre of genres) {
    const like = `%${genre}%`;
    const movies = db.prepare(`
      SELECT id, title, poster, genre, year, rating, 'movie' AS content_type
      FROM movies WHERE COALESCE(available, 1) = 1 AND genre LIKE ?
      ORDER BY rating DESC LIMIT 8
    `).all(like);
    for (const m of filterMoviesForProfile(movies, profile)) {
      if (watchedMovieIds.has(m.id)) continue;
      const key = `movie-${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }

    const series = db.prepare(`
      SELECT DISTINCT s.id, s.title, s.poster, s.genre, s.year, s.rating, 'series' AS content_type
      FROM series s
      INNER JOIN episodes e ON e.series_id = s.id AND COALESCE(e.available, 1) = 1
      WHERE s.genre LIKE ?
      ORDER BY s.rating DESC, s.created_at DESC LIMIT 6
    `).all(like);
    for (const s of filterSeriesForProfile(series, profile)) {
      if (watchedSeriesIds.has(s.id)) continue;
      const key = `series-${s.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    if (out.length >= cap) break;
  }

  return out.slice(0, cap);
}

module.exports = { getForYouItems, getWatchedGenres };
