const db = require('../db');
const { filterMoviesForProfile, filterSeriesForProfile, filterLiveForProfile } = require('./parental');
const { formatChannelLite } = require('./liveChannelsApi');

const CANDIDATE_LIMIT = 120;

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTokens(query) {
  const norm = normalizeSearchText(query);
  return norm.split(/\s+/).filter((w) => w.length >= 2);
}

function buildLikeFilter(tokens, fields) {
  if (!tokens.length) return null;
  const clauses = [];
  const params = [];
  for (const token of tokens) {
    const like = `%${token}%`;
    const fieldClause = fields.map((f) => `LOWER(COALESCE(${f}, '')) LIKE ?`).join(' OR ');
    clauses.push(`(${fieldClause})`);
    for (let i = 0; i < fields.length; i++) params.push(like);
  }
  return { sql: clauses.join(' AND '), params };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function fuzzyTextScore(queryNorm, normalized) {
  if (!queryNorm || !normalized) return 0;
  if (normalized === queryNorm) return 100;
  if (normalized.startsWith(queryNorm)) return 85;
  if (normalized.includes(queryNorm)) return 70;

  const maxDist = queryNorm.length <= 4 ? 1 : queryNorm.length <= 7 ? 2 : 3;
  const titleWords = normalized.split(/\s+/).filter(Boolean);
  for (const word of titleWords) {
    const dist = levenshtein(queryNorm, word);
    if (dist <= maxDist) return Math.max(42, 68 - dist * 10);
  }
  return 0;
}

function scoreMatch(queryNorm, ...fields) {
  if (!queryNorm) return 0;
  const words = queryNorm.split(/\s+/).filter((w) => w.length >= 2);
  let best = 0;

  for (const field of fields) {
    const normalized = normalizeSearchText(field);
    if (!normalized) continue;

    best = Math.max(best, fuzzyTextScore(queryNorm, normalized));

    if (words.length) {
      const matched = words.filter((w) => normalized.includes(w) || fuzzyTextScore(w, normalized) >= 38);
      if (matched.length === words.length) {
        best = Math.max(best, 55 + matched.length * 4);
      } else if (matched.length) {
        best = Math.max(best, 28 + matched.length * 3);
      }
    }
  }

  return best;
}

function rankItems(items, query, fieldNames, minScore = 18) {
  const queryNorm = normalizeSearchText(query);
  if (queryNorm.length < 2) return [];

  return items
    .map((item) => ({
      item,
      score: scoreMatch(queryNorm, ...fieldNames.map((name) => item[name]))
    }))
    .filter((row) => row.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.item.rating || 0) - (a.item.rating || 0);
    })
    .map((row) => row.item);
}

function fetchMovieCandidates(tokens) {
  const filter = buildLikeFilter(tokens, ['title', 'genre', 'description']);
  if (!filter) return [];
  return db.prepare(`
    SELECT id, title, poster, genre, year, rating, description, 'movie' AS content_type
    FROM movies
    WHERE COALESCE(available, 1) = 1 AND (${filter.sql})
    ORDER BY rating DESC, year DESC
    LIMIT ${CANDIDATE_LIMIT}
  `).all(...filter.params);
}

function fetchSeriesCandidates(tokens) {
  const seriesFilter = buildLikeFilter(tokens, ['s.title', 's.genre', 's.description']);
  const episodeFilter = buildLikeFilter(tokens, ['e.title', 'e.description']);
  if (!seriesFilter && !episodeFilter) return [];

  const parts = [];
  const params = [];
  if (seriesFilter) {
    parts.push(`(${seriesFilter.sql})`);
    params.push(...seriesFilter.params);
  }
  if (episodeFilter) {
    parts.push(`EXISTS (
      SELECT 1 FROM episodes e2
      WHERE e2.series_id = s.id
        AND COALESCE(e2.available, 1) = 1
        AND (${episodeFilter.sql.replace(/\be\./g, 'e2.')})
    )`);
    params.push(...episodeFilter.params);
  }

  return db.prepare(`
    SELECT DISTINCT s.id, s.title, s.poster, s.genre, s.year, s.rating, s.description, 'series' AS content_type
    FROM series s
    INNER JOIN episodes e ON e.series_id = s.id AND COALESCE(e.available, 1) = 1
    WHERE (${parts.join(' OR ')})
    ORDER BY s.rating DESC, s.year DESC
    LIMIT ${CANDIDATE_LIMIT}
  `).all(...params);
}

function fetchLiveCandidates(tokens) {
  const filter = buildLikeFilter(tokens, ['name', 'group_title']);
  if (!filter) return [];
  return db.prepare(`
    SELECT c.id, c.name, c.logo, c.group_title, c.stream_url, c.enabled, c.config, c.cache_enabled, c.cache_status
    FROM live_channels c
    WHERE COALESCE(c.enabled, 1) = 1 AND (${filter.sql})
    ORDER BY c.name ASC
    LIMIT ${CANDIDATE_LIMIT}
  `).all(...filter.params);
}

function searchCatalog(query, profile, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return { movies: [], series: [], live: [] };
  const cap = Math.min(40, Math.max(5, parseInt(opts.limit, 10) || 20));
  const tokens = queryTokens(q);
  if (!tokens.length) return { movies: [], series: [], live: [], total: 0, query: q };

  let movies = rankItems(
    filterMoviesForProfile(fetchMovieCandidates(tokens), profile),
    q,
    ['title', 'genre', 'description']
  ).slice(0, cap);

  let series = rankItems(
    filterSeriesForProfile(fetchSeriesCandidates(tokens), profile),
    q,
    ['title', 'genre', 'description']
  ).slice(0, cap);

  const live = rankItems(
    filterLiveForProfile(fetchLiveCandidates(tokens).map(formatChannelLite), profile),
    q,
    ['name', 'group_title']
  ).slice(0, cap);

  return { query: q, movies, series, live, total: movies.length + series.length + live.length };
}

module.exports = { searchCatalog, normalizeSearchText };
