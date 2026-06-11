const KIDS_BLOCKED_GENRES = new Set([
  'terror', 'horror', 'suspense', 'crimen', 'crime', 'thriller', 'guerra', 'war'
]);

const KIDS_MAX_RATING = 6.5;

function genreBlockedForKids(genreField) {
  const g = String(genreField || '').toLowerCase();
  for (const blocked of KIDS_BLOCKED_GENRES) {
    if (g.includes(blocked)) return true;
  }
  return false;
}

function movieAllowedForKids(movie) {
  if (!movie) return false;
  if (genreBlockedForKids(movie.genre)) return false;
  const rating = Number(movie.rating) || 0;
  if (rating > KIDS_MAX_RATING && rating > 0) return false;
  return true;
}

function seriesAllowedForKids(series) {
  if (!series) return false;
  return !genreBlockedForKids(series.genre);
}

function liveChannelAllowedForKids(channel) {
  const group = String(channel?.group_title || '').toLowerCase();
  if (/adult|xxx|erotic/i.test(group)) return false;
  if (/terror|horror/i.test(group)) return false;
  return true;
}

function filterMoviesForProfile(movies, profile) {
  if (!profile?.is_kids) return movies;
  return movies.filter(movieAllowedForKids);
}

function filterSeriesForProfile(series, profile) {
  if (!profile?.is_kids) return series;
  return series.filter(seriesAllowedForKids);
}

function filterLiveForProfile(channels, profile) {
  if (!profile?.is_kids) return channels;
  return channels.filter(liveChannelAllowedForKids);
}

function sanitizeProfile(profile) {
  if (!profile) return null;
  const { pin_hash, ...safe } = profile;
  return { ...safe, has_pin: !!pin_hash };
}

module.exports = {
  KIDS_MAX_RATING,
  movieAllowedForKids,
  seriesAllowedForKids,
  liveChannelAllowedForKids,
  filterMoviesForProfile,
  filterSeriesForProfile,
  filterLiveForProfile,
  sanitizeProfile
};
