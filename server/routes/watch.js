const express = require('express');
const db = require('../db');
const { auth, requireProfile } = require('../middleware/auth');
const { resolvePlayablePath } = require('../services/playablePath');
const {
  saveExternalProgress,
  getExternalSeriesProgress,
  getExternalEpisodeProgress,
  getExternalProgressMap,
  getExternalContinueItems,
  dedupeContinueWatchingItems
} = require('../services/externalWatch');

const router = express.Router();

const MIN_PROGRESS = 30;
const COMPLETED_RATIO = 0.92;
const MAX_ITEMS = 24;

const upsertProgress = db.prepare(`
  INSERT INTO watch_history (profile_id, content_type, content_id, series_id, progress, duration, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(profile_id, content_type, content_id) DO UPDATE SET
    series_id = excluded.series_id,
    progress = excluded.progress,
    duration = excluded.duration,
    updated_at = CURRENT_TIMESTAMP
`);

const deleteProgress = db.prepare(`
  DELETE FROM watch_history WHERE profile_id = ? AND content_type = ? AND content_id = ?
`);

function enrichContinueItem(row) {
  if (row.content_type === 'movie') {
    const movie = db.prepare('SELECT * FROM movies WHERE id = ? AND COALESCE(available, 1) = 1').get(row.content_id);
    if (!movie?.video_path) return null;
    return {
      content_type: 'movie',
      content_id: row.content_id,
      progress: row.progress,
      duration: row.duration,
      updated_at: row.updated_at,
      title: movie.title,
      poster: movie.poster,
      year: movie.year,
      video_path: resolvePlayablePath(movie.video_path)
    };
  }

  if (row.content_type === 'episode') {
    const ep = db.prepare('SELECT * FROM episodes WHERE id = ? AND COALESCE(available, 1) = 1').get(row.content_id);
    if (!ep?.video_path) return null;
    const series = db.prepare('SELECT * FROM series WHERE id = ?').get(ep.series_id);
    if (!series) return null;
    return {
      content_type: 'episode',
      content_id: row.content_id,
      series_id: ep.series_id,
      progress: row.progress,
      duration: row.duration,
      updated_at: row.updated_at,
      season: ep.season,
      episode: ep.episode,
      title: ep.title,
      series_title: series.title,
      poster: ep.poster || series.poster,
      video_path: resolvePlayablePath(ep.video_path)
    };
  }

  return null;
}

function progressPercent(progress, duration) {
  const p = Number(progress) || 0;
  const d = Number(duration) || 0;
  if (d > 0) return Math.min(100, Math.round((p / d) * 100));
  if (p >= 30) return Math.min(15, Math.max(4, Math.round(p / 60)));
  return 0;
}

router.get('/history', auth, requireProfile, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM watch_history
    WHERE profile_id = ? AND progress >= ?
    ORDER BY updated_at DESC
    LIMIT 50
  `).all(req.profileId, MIN_PROGRESS);

  const items = rows.map((row) => {
    const base = enrichContinueItem(row);
    if (!base) return null;
    const pct = progressPercent(row.progress, row.duration);
    let progressLabel = pct > 0 ? `Visto ${pct}%` : 'En progreso';
    if (row.duration > 0 && row.progress / row.duration >= COMPLETED_RATIO) {
      progressLabel = 'Completado';
    } else if (row.progress > 0) {
      const mins = Math.floor(row.progress / 60);
      const secs = Math.floor(row.progress % 60);
      progressLabel = `Ya miró hasta ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return { ...base, progress_label: progressLabel, percent: pct };
  }).filter(Boolean);
  res.json(items);
});

router.get('/continue', auth, requireProfile, async (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM watch_history
    WHERE profile_id = ?
      AND progress >= ?
      AND (duration <= 0 OR (progress / duration) < ?)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(req.profileId, MIN_PROGRESS, COMPLETED_RATIO, MAX_ITEMS);

  const local = rows.map(enrichContinueItem).filter(Boolean);
  const external = getExternalContinueItems(req.profileId, MAX_ITEMS);
  let enrichedExternal = external;
  try {
    const { enrichExternalContinueItems } = require('../services/externalCatalog');
    enrichedExternal = await enrichExternalContinueItems(external);
  } catch (err) {
    console.warn('[watch/continue] external posters:', err.message);
  }
  const merged = dedupeContinueWatchingItems([...local, ...enrichedExternal])
    .slice(0, MAX_ITEMS);
  res.json(merged);
});

router.put('/progress', auth, requireProfile, (req, res) => {
  const { content_type, content_id, series_id, progress, duration } = req.body;
  if (!content_type || !content_id) {
    return res.status(400).json({ error: 'Contenido requerido' });
  }
  if (!['movie', 'episode'].includes(content_type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }

  const prog = Math.max(0, Number(progress) || 0);
  const dur = Math.max(0, Number(duration) || 0);

  if (prog < MIN_PROGRESS) {
    deleteProgress.run(req.profileId, content_type, parseInt(content_id, 10));
    return res.json({ ok: true, removed: true });
  }

  if (dur > 0 && prog / dur >= COMPLETED_RATIO) {
    deleteProgress.run(req.profileId, content_type, parseInt(content_id, 10));
    return res.json({ ok: true, completed: true });
  }

  upsertProgress.run(
    req.profileId,
    content_type,
    parseInt(content_id, 10),
    series_id ? parseInt(series_id, 10) : null,
    prog,
    dur
  );

  res.json({ ok: true });
});

router.get('/series/:seriesId/progress', auth, requireProfile, (req, res) => {
  const seriesId = parseInt(req.params.seriesId, 10);
  if (!seriesId) return res.status(400).json({ error: 'Serie inválida' });
  const rows = db.prepare(`
    SELECT content_id, progress, duration, updated_at
    FROM watch_history
    WHERE profile_id = ? AND content_type = 'episode' AND series_id = ?
      AND progress >= ?
  `).all(req.profileId, seriesId, MIN_PROGRESS);

  const episodes = {};
  for (const row of rows) {
    episodes[row.content_id] = {
      progress: row.progress,
      duration: row.duration,
      percent: progressPercent(row.progress, row.duration),
      updated_at: row.updated_at
    };
  }
  res.json({ episodes });
});

router.get('/progress-map', auth, requireProfile, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM watch_history
    WHERE profile_id = ? AND progress >= ?
  `).all(req.profileId, MIN_PROGRESS);

  const map = { movies: {}, episodes: {}, series: {} };
  for (const row of rows) {
    const pct = progressPercent(row.progress, row.duration);
    if (row.content_type === 'movie') {
      map.movies[row.content_id] = { progress: row.progress, duration: row.duration, percent: pct };
      continue;
    }
    if (row.content_type === 'episode') {
      map.episodes[row.content_id] = {
        progress: row.progress,
        duration: row.duration,
        percent: pct,
        series_id: row.series_id
      };
      if (row.series_id) {
        const prev = map.series[row.series_id];
        if (!prev || String(row.updated_at) > String(prev.updated_at)) {
          map.series[row.series_id] = {
            episode_id: row.content_id,
            progress: row.progress,
            duration: row.duration,
            percent: pct,
            updated_at: row.updated_at
          };
        }
      }
    }
  }
  const external = getExternalProgressMap(req.profileId);
  res.json({ ...map, ...external });
});

router.get('/progress/:type/:id', auth, requireProfile, (req, res) => {
  const { type, id } = req.params;
  if (!['movie', 'episode'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  const row = db.prepare(`
    SELECT progress, duration FROM watch_history
    WHERE profile_id = ? AND content_type = ? AND content_id = ?
  `).get(req.profileId, type, parseInt(id, 10));
  res.json(row || { progress: 0, duration: 0 });
});

router.delete('/progress/:type/:id', auth, requireProfile, (req, res) => {
  const { type, id } = req.params;
  if (!['movie', 'episode'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  deleteProgress.run(req.profileId, type, parseInt(id, 10));
  res.json({ ok: true });
});

router.put('/external/progress', auth, requireProfile, async (req, res) => {
  try {
    const result = await saveExternalProgress(req.profileId, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Progreso inválido' });
  }
});

router.get('/external/series/:source/:slug/progress', auth, requireProfile, (req, res) => {
  const { source, slug } = req.params;
  res.json(getExternalSeriesProgress(req.profileId, source, slug));
});

router.get('/external/episode/:source/:slug/:season/:episode/progress', auth, requireProfile, (req, res) => {
  const { source, slug } = req.params;
  const season = parseInt(req.params.season, 10) || 0;
  const episode = parseInt(req.params.episode, 10) || 0;
  res.json(getExternalEpisodeProgress(req.profileId, source, slug, season, episode));
});

module.exports = router;
