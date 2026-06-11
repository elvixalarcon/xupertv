/**
 * Filtra resultados de búsqueda VOD: solo películas/series completas,
 * sin tráilers, noticias, actores ni enlaces irrelevantes.
 */

const JUNK_URL_PATTERNS = [
  /youtube\.com/i, /youtu\.be/i, /datastudio\.google/i, /reporting\//i,
  /\/noticias?\//i, /\/news\//i, /\/blog\//i, /\/tag\//i, /\/category\//i,
  /\/categories\//i, /\/actor\//i, /\/actriz\//i, /\/cast\//i,
  /\/forum\//i, /wikipedia\.org/i, /imdb\.com\/name\//i,
  /filmelier\.com\/[^/]+\/noticias/i, /\/trailers?\//i, /\/teasers?\//i,
  /\/avances?\//i, /\/clips?\//i, /\/videos?\//i,
  /pelis-espanol\/ver-online\/[a-z]{2,18}$/i,
  /peliculasonlinecastellano\.com\/pelis-espanol\/ver-online\/[a-z]/i,
  /google\.com\/reporting/i, /\/wp-content\/uploads\/.*trailer/i
];

const JUNK_TITLE_PATTERNS = [
  /\b(trailer|tráiler|teaser|avance|estreno|clip oficial|featurette)\b/i,
  /\b(noticia|noticias|review|reseña|entrevista|documental|cortometraje)\b/i,
  /\b(dónde ver online|donde ver online|¿dónde ver|where to watch)\b/i,
  /MIRA-VER!\*/i, /\|\s*Pel[ií]culas Online Castellano/i,
  /\b(ver online gratis en HD)\s*•\s*Maxcine/i // ok actually movie - keep
];

const KNOWN_STREAMING_HOST = /cuevana|allcalidad|cinecalidad|repelis|gnula|hackstore|pelisplus|pelisflix|peliculaspro|maxcine|bajalogratis|peelink|ultrapelishd|genteclic|divxtotal|doramasflix/i;

const MOVIE_URL_PATTERNS = [
  /\/pelicula[s]?\//i, /\/pel[ií]cula\//i, /\/movie\//i, /\/film\//i,
  /\/tvshows?\//i, /\/serie[s]?\//i,
  /ver-[a-z0-9]+-(online|espanol|latino|gratis|hd)/i,
  /\/descargar-[a-z0-9-]+/i,
  /\/pelicula\/[a-z0-9-]+/i,
  /allcalidad\.re\/(peliculas|tvshows)/i,
  /-[12][09]\d{2}(?:\/|$|-)/i
];

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function queryWords(query) {
  return normalizeText(query)
    .replace(/\b(19|20)\d{2}\b/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function queryYear(query) {
  const m = String(query || '').match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function titleYear(title) {
  const m = String(title || '').match(/\((\d{4})\)|\b(19|20)\d{2}\b/);
  return m ? parseInt(m[1] || m[2], 10) : null;
}

function slugFromUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.split('/').filter(Boolean).pop() || '';
  } catch {
    return '';
  }
}

function urlContainsQuery(url, words) {
  const u = normalizeText(url).replace(/[^a-z0-9]+/g, '-');
  let hits = 0;
  for (const w of words) {
    const wn = w.replace(/\s+/g, '-');
    if (u.includes(wn) || u.includes(w)) hits++;
  }
  return hits;
}

/**
 * El título debe corresponder a la película/serie buscada, no a un actor homónimo.
 */
function titleIsRelevant(title, query) {
  const words = queryWords(query);
  if (!words.length) return true;

  const t = normalizeText(title);
  const core = t.replace(/\s*\(\d{4}\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

  if (JUNK_TITLE_PATTERNS.some((re) => re.test(title))) return false;

  if (!words.every((w) => t.includes(w))) return false;

  if (words.length === 1) {
    const w = words[0];
    const tokens = core.split(/\s+|:/).filter(Boolean);
    const tokenHit = tokens.some((tok) => tok === w || tok.startsWith(`${w}-`) || tok === `${w}s`);
    const startsWith = core === w || core.startsWith(`${w} `) || core.startsWith(`${w}:`) || core.startsWith(`ver ${w}`);
    if (!tokenHit && !startsWith) return false;
    if (core === w) return true;
    if (startsWith) return true;
    if (new RegExp(`\\b${w}\\s*\\(\\d{4}\\)`, 'i').test(title)) return true;
    const surnameOnly = new RegExp(`^[a-záéíóúñ]{2,}\\s+${w}\\b`, 'i');
    if (surnameOnly.test(core) && !core.startsWith(w)) return false;
    return true;
  }

  const qy = queryYear(query);
  const ty = titleYear(title);
  if (qy && ty && Math.abs(qy - ty) > 1) return false;

  const slugHint = normalizeText(words.join('-'));
  if (core.includes(slugHint)) return true;

  const first = words[0];
  const idx = t.indexOf(first);
  if (idx > 25) return false;

  return true;
}

function urlLooksLikeMoviePage(url, query, type) {
  const u = String(url || '').toLowerCase();
  if (!u.startsWith('http')) return false;
  if (JUNK_URL_PATTERNS.some((re) => re.test(u))) return false;
  if (/\b(trailer|teaser|avance)\b/i.test(u)) return false;

  if (KNOWN_STREAMING_HOST.test(u)) {
    if (type === 'series') {
      return /\/(tvshows?|serie|series|temporada)\//i.test(u) || /serie/i.test(u);
    }
    if (/\/(noticias?|news|actor|actriz)\//i.test(u)) return false;
    return true;
  }

  const words = queryWords(query);
  if (words.length >= 2 && urlContainsQuery(u, words) < Math.min(2, words.length)) {
    return false;
  }
  if (words.length === 1 && !urlContainsQuery(u, words)) {
    const slug = slugFromUrl(u);
    if (!slug.includes(words[0]) && !slug.includes(words[0].replace(/\s+/g, ''))) {
      return false;
    }
  }

  return MOVIE_URL_PATTERNS.some((re) => re.test(u));
}

/**
 * @param {object} item Resultado de búsqueda VOD
 * @param {string} query Texto buscado
 */
function isRelevantVodResult(item, query) {
  if (!item) return false;
  if (item.source === 'tmdb') return true;

  const title = item.title || '';
  const url = item.url || '';

  if (JUNK_URL_PATTERNS.some((re) => re.test(url))) return false;
  if (!titleIsRelevant(title, query)) return false;

  if (item.source === 'cuevana') {
    return /\/pelicula\//i.test(url) || !!item.slug;
  }
  if (item.source === 'allcalidad') {
    return /\/(peliculas|tvshows)\//i.test(url) || !!item.slug;
  }

  if (item.source === 'web') {
    if (!urlLooksLikeMoviePage(url, query, item.type)) return false;
    const blob = `${title} ${url}`.toLowerCase();
    if (/navidad en la granja|di que sí|king of fighters|belleza americana|forma del agua/i.test(blob)) {
      if (!queryWords(query).every((w) => blob.includes(w))) return false;
    }
    if ((item.score || 0) < 3 && !/pel[ií]cula|ver\s+.+\s+online|completa/i.test(title)) {
      return false;
    }
  }

  return true;
}

function filterVodResults(list, query) {
  const q = String(query || '').trim();
  if (!q) return list || [];
  return (list || []).filter((item) => isRelevantVodResult(item, q));
}

module.exports = {
  isRelevantVodResult,
  filterVodResults,
  titleIsRelevant,
  urlLooksLikeMoviePage,
  queryWords,
  normalizeText
};
