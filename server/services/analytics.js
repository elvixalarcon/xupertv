const db = require('../db');

function getUsageStats(days = 30) {
  const since = db.prepare(`SELECT datetime('now', ?) AS d`).get(`-${days} days`).d;

  const topMovies = db.prepare(`
    SELECT wh.content_id AS id, m.title, COUNT(DISTINCT wh.profile_id) AS viewers,
      SUM(wh.progress) AS watch_seconds
    FROM watch_history wh
    JOIN movies m ON m.id = wh.content_id
    WHERE wh.content_type = 'movie' AND wh.updated_at >= ? AND wh.progress >= 30
    GROUP BY wh.content_id
    ORDER BY viewers DESC, watch_seconds DESC LIMIT 15
  `).all(since);

  const topSeries = db.prepare(`
    SELECT wh.series_id AS id, s.title, COUNT(DISTINCT wh.profile_id) AS viewers,
      SUM(wh.progress) AS watch_seconds
    FROM watch_history wh
    JOIN series s ON s.id = wh.series_id
    WHERE wh.content_type = 'episode' AND wh.series_id IS NOT NULL AND wh.updated_at >= ? AND wh.progress >= 30
    GROUP BY wh.series_id
    ORDER BY viewers DESC, watch_seconds DESC LIMIT 15
  `).all(since);

  const topLive = db.prepare(`
    SELECT wh.content_id AS id, COUNT(DISTINCT wh.profile_id) AS viewers
    FROM watch_history wh
    WHERE wh.content_type = 'live' AND wh.updated_at >= ? AND wh.progress >= 30
    GROUP BY wh.content_id
    ORDER BY viewers DESC LIMIT 10
  `).all(since);

  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT profile_id) AS active_profiles,
      COUNT(*) AS sessions,
      SUM(progress) AS total_watch_seconds
    FROM watch_history
    WHERE updated_at >= ? AND progress >= 30
  `).get(since);

  const continueCount = db.prepare(`
    SELECT COUNT(*) AS c FROM watch_history
    WHERE progress >= 30 AND (duration <= 0 OR (progress / duration) < 0.92)
  `).get().c;

  return {
    days,
    since,
    totals: {
      active_profiles: totals?.active_profiles || 0,
      sessions: totals?.sessions || 0,
      watch_hours: Math.round((totals?.total_watch_seconds || 0) / 3600),
      continue_watching: continueCount
    },
    top_movies: topMovies,
    top_series: topSeries,
    top_live: topLive
  };
}

module.exports = { getUsageStats };
