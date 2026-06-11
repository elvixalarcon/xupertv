const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseMoviePage, parseMovieLinks, fetchHtml, BASE: CUEVANA_BASE } = require('./cuevana');
const cuevanaImport = require('./cuevanaImport');
const allcalidadImport = require('./allcalidadImport');
const cinecalidadImport = require('./cinecalidadImport');
const { searchByName: searchCinecalidadByName, parseMoviePage: parseCinecalidadPage, resolveBestStream: resolveCinecalidadStream } = require('./cinecalidad');
const { searchTmdbMovie, searchTmdbSeries } = require('./posters');
const { searchInternet, sourceLabelFromHost } = require('./vodWebSearch');
const { filterVodResults, titleIsRelevant, queryWords, normalizeText } = require('./vodResultFilter');
const { findExistingMovie } = require('./movieDedup');
const { importSeriesFromAllcalidad } = require('./allcalidadSeriesImport');

const ALLCALIDAD_API = 'https://allcalidad.re/api/rest';
const ALLCALIDAD_BASE = 'https://allcalidad.re';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const SEARCH_YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010, 2004, 1997, 1992, 1986, 1979];
const ALLCALIDAD_SITEMAPS = [
  'movies-sitemap9.xml', 'movies-sitemap8.xml', 'movies-sitemap7.xml',
  'movies-sitemap6.xml', 'movies-sitemap5.xml', 'movies-sitemap4.xml',
  'movies-sitemap3.xml', 'movies-sitemap2.xml', 'movies-sitemap1.xml'
];
const ALLCALIDAD_QUERY_HINTS = {
  alien: [
    'alien-covenant-2017', 'alien-romulus-2024', 'aliens-1986', 'alien-3-1992',
    'prometheus-2012', 'alien-covenant', 'alien-romulus-2024'
  ],
  predator: ['predator-2025', 'predators-2010', 'alien-vs-predator-2004'],
  terminator: ['terminator-dark-fate-2019', 'terminator-2-1991', 'terminator-1984']
};
const ROOT = path.join(__dirname, '..', '..');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchText(next).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function fetchJson(url) {
  return fetchText(url).then((t) => JSON.parse(t));
}

function normalizeKey(item) {
  if (item.url) return `url:${item.url}`;
  const t = String(item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const y = item.year || 0;
  const type = item.type || 'movie';
  return `${type}:${t}:${y}:${item.source}:${item.slug}`;
}

function dedupeResults(list) {
  const seen = new Set();
  return list.filter((item) => {
    const k = normalizeKey(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function isDownloadableResult(item) {
  if (item.catalog_only) return false;
  if (item.source === 'tmdb' && !item.slug) return false;
  return !!(item.slug || (item.url && item.source !== 'tmdb'));
}

function sortVodResults(list) {
  const score = (item) => {
    if (isDownloadableResult(item)) {
      const src = { allcalidad: 40, cinecalidad: 38, cuevana: 35, web: 30 }[item.source] || 25;
      return src + (item.poster ? 5 : 0);
    }
    return item.source === 'tmdb' ? 1 : 5;
  };
  return [...list].sort((a, b) => score(b) - score(a));
}

function partitionVodResults(list, query = '') {
  const filtered = query ? filterVodResults(list, query) : list;
  const sorted = sortVodResults(dedupeResults(filtered));
  const downloadable = sorted.filter(isDownloadableResult);
  const reference = sorted.filter((r) => !isDownloadableResult(r));
  return {
    downloadable,
    reference: reference.slice(0, 4),
    all: [...downloadable, ...reference.slice(0, 4)]
  };
}

function slugifyWords(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('-');
}

function slugCandidates(query) {
  const yearMatch = String(query).match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  const withoutYear = String(query).replace(/\b(19|20)\d{2}\b/g, '').trim();
  const words = slugifyWords(withoutYear);
  const bases = [];
  if (words) bases.push(words);
  const parts = withoutYear.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length > 2) bases.push(parts.slice(0, 3).join('-'));
  if (parts.length > 1) bases.push(parts[0]);

  const years = year ? [year] : SEARCH_YEARS.slice(0, 14);
  const hints = ALLCALIDAD_QUERY_HINTS[words] || ALLCALIDAD_QUERY_HINTS[parts[0]] || [];
  const slugs = new Set(hints);
  for (const base of bases) {
    if (!base) continue;
    slugs.add(base);
    for (const y of years) slugs.add(`${base}-${y}`);
  }
  return [...slugs].slice(0, 40);
}

function slugMatchesQuery(slug, query) {
  const words = queryWords(query);
  if (!words.length) return false;
  const blob = String(slug || '').toLowerCase().replace(/-/g, ' ');
  return words.every((w) => new RegExp(`\\b${w}\\b`, 'i').test(blob));
}

function resultMatchesQuery(hit, query) {
  if (!hit) return false;
  return titleMatchesQuery(hit.title, query) || slugMatchesQuery(hit.slug, query);
}

function parseUrlInput(raw) {
  const q = String(raw || '').trim();
  if (!q.startsWith('http')) return null;

  let u;
  try { u = new URL(q); } catch { return null; }

  const host = u.hostname.replace(/^www\./, '');
  if (host.includes('cuevana')) {
    const slug = u.pathname.match(/\/pelicula\/([^/?#]+)/i)?.[1];
    if (slug) {
      return {
        type: 'movie',
        source: 'cuevana',
        slug,
        url: u.href,
        title: slug.replace(/-/g, ' '),
        year: parseInt(slug.match(/-(\d{4})$/)?.[1] || '0', 10) || null
      };
    }
  }

  if (host.includes('cinecalidad')) {
    const slug = u.pathname.match(/\/ver-pelicula\/([^/?#]+)/i)?.[1];
    if (slug) {
      return {
        type: 'movie',
        source: 'cinecalidad',
        slug: slug.replace(/\/$/, ''),
        url: u.href,
        title: slug.replace(/-/g, ' '),
        year: parseInt(slug.match(/-(\d{4})$/)?.[1] || '0', 10) || null
      };
    }
  }

  if (host.includes('allcalidad')) {
    const movieSlug = u.pathname.match(/\/peliculas\/([^/?#]+)/i)?.[1];
    if (movieSlug) {
      return {
        type: 'movie',
        source: 'allcalidad',
        slug: movieSlug.replace(/\/$/, ''),
        url: u.href,
        title: movieSlug.replace(/-/g, ' '),
        year: parseInt(movieSlug.match(/-(\d{4})$/)?.[1] || '0', 10) || null
      };
    }
    const seriesSlug = u.pathname.match(/\/(?:tvshows|series)\/([^/?#]+)/i)?.[1];
    if (seriesSlug) {
      return {
        type: 'series',
        source: 'allcalidad',
        slug: seriesSlug.replace(/\/$/, ''),
        url: u.href,
        title: seriesSlug.replace(/-/g, ' '),
        year: parseInt(seriesSlug.match(/-(\d{4})$/)?.[1] || '0', 10) || null
      };
    }
  }

  const blob = `${u.href}`.toLowerCase();
  const type = /tvshows?|\/serie|\/series|temporada|capitulo|episode|\/show\//i.test(blob)
    ? 'series'
    : 'movie';

  return {
    type,
    source: 'web',
    source_site: sourceLabelFromHost(host),
    slug: '',
    url: u.href,
    title: u.pathname.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || q,
    year: parseInt(q.match(/\b(19|20)\d{2}\b/)?.[0] || '0', 10) || null
  };
}

function allcalidadPosterUrl(meta) {
  const img = meta.images || {};
  const raw = img.poster || img.backdrop || meta.poster || meta.image || meta.thumbnail || '';
  if (!raw) return '';
  if (raw.startsWith('http')) return raw;
  return `${ALLCALIDAD_BASE}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function resultFromAllcalidad(meta, type, slug) {
  const title = (meta.title || meta.original_title || slug).replace(/\s*\(\d{4}\)\s*$/, '').trim();
  const yearMatch = String(meta.title || slug).match(/\((\d{4})\)|-(\d{4})$/);
  const year = yearMatch
    ? parseInt(yearMatch[1] || yearMatch[2], 10)
    : parseInt(slug.match(/-(\d{4})$/)?.[1] || '0', 10) || null;
  const poster = allcalidadPosterUrl(meta);
  return {
    type,
    source: 'allcalidad',
    slug,
    title,
    year,
    poster,
    url: type === 'series'
      ? `${ALLCALIDAD_BASE}/tvshows/${slug}/`
      : `${ALLCALIDAD_BASE}/peliculas/${slug}/`,
    tmdb_id: meta.tmdb_id || meta.tmdb || null,
    overview: meta.description || meta.overview || ''
  };
}

async function probeAllcalidadSlug(slug, postType) {
  try {
    const single = await fetchJson(
      `${ALLCALIDAD_API}/single?post_name=${encodeURIComponent(slug)}&post_type=${postType}`
    );
    if (single.error || !single.data) return null;
    const type = postType === 'tvshows' ? 'series' : 'movie';
    return resultFromAllcalidad(single.data, type, slug);
  } catch {
    return null;
  }
}

async function enrichResultPosters(results) {
  const { fetchTmdbMoviePoster, fetchTmdbSeriesPoster, posterCoverUrl } = require('./posters');
  const { getTmdbApiKey } = require('./settings');
  const hasTmdb = !!getTmdbApiKey();

  await Promise.all(results.map(async (item) => {
    if (item.poster && item.poster.startsWith('http')) return;
    try {
      if (hasTmdb) {
        if (item.type === 'series') {
          item.poster = await fetchTmdbSeriesPoster(item.title) || '';
        } else {
          item.poster = await fetchTmdbMoviePoster(item.title, item.year) || '';
        }
      }
    } catch { /* ignore */ }
    if (!item.poster || !item.poster.startsWith('http')) {
      item.poster = posterCoverUrl(item.title, item.year || '');
    }
  }));
  return results;
}

async function searchAllcalidadApi(query, limit = 12) {
  const results = [];
  try {
    for (const postType of ['movies', 'tvshows']) {
      const data = await fetchJson(
        `${ALLCALIDAD_API}/search?query=${encodeURIComponent(query)}&post_type=${postType}`
      );
      if (data.error || !data.data?.posts) continue;
      for (const post of data.data.posts) {
        if (results.length >= limit) break;
        const slug = post.slug || post.post_name;
        if (!slug) continue;
        const type = postType === 'tvshows' ? 'series' : 'movie';
        const hit = resultFromAllcalidad(post, type, slug);
        if (resultMatchesQuery(hit, query)) results.push(hit);
      }
    }
  } catch (err) {
    console.warn('[vodSearch] allcalidad api', err.message);
  }
  return results;
}

async function searchAllcalidadSitemap(query, limit = 20) {
  const words = queryWords(query);
  if (!words.length) return [];
  const slugs = new Set();
  const xmls = await Promise.all(
    ALLCALIDAD_SITEMAPS.map((sm) => fetchText(`${ALLCALIDAD_BASE}/${sm}`).catch(() => ''))
  );
  const re = /<loc>https:\/\/allcalidad\.re\/peliculas\/([a-z0-9-]+)-(\d{4})\//gi;
  for (const xml of xmls) {
    let m;
    while ((m = re.exec(xml))) {
      const slug = `${m[1]}-${m[2]}`;
      if (slugMatchesQuery(slug, query)) slugs.add(slug);
      if (slugs.size >= limit) break;
    }
    if (slugs.size >= limit) break;
  }
  return [...slugs];
}

async function searchAllcalidadByTmdb(query, limit = 10) {
  const slugs = new Set();
  try {
    const [movies, series] = await Promise.all([
      searchTmdbMovie(query, limit).catch(() => []),
      searchTmdbSeries(query, 4).catch(() => [])
    ]);
    for (const m of movies) {
      const y = parseInt(String(m.release_date || '').slice(0, 4), 10);
      const base = slugifyWords(m.title);
      if (base && y) slugs.add(`${base}-${y}`);
      if (base) slugs.add(base);
    }
    for (const s of series) {
      const y = parseInt(String(s.first_air_date || '').slice(0, 4), 10);
      const base = slugifyWords(s.name || s.title);
      if (base && y) slugs.add(`${base}-${y}`);
    }
  } catch { /* ignore */ }
  return [...slugs].slice(0, limit);
}

async function probeAllcalidadSlugs(slugList, query, limit) {
  const results = [];
  const batchSize = 8;
  const slugs = [...new Set(slugList)];
  for (let i = 0; i < slugs.length && results.length < limit; i += batchSize) {
    const chunk = slugs.slice(i, i + batchSize);
    const probes = [];
    for (const slug of chunk) {
      probes.push(probeAllcalidadSlug(slug, 'movies'));
      probes.push(probeAllcalidadSlug(slug, 'tvshows'));
    }
    const settled = await Promise.all(probes);
    for (const hit of settled) {
      if (hit && resultMatchesQuery(hit, query) && results.length < limit) {
        results.push(hit);
      }
    }
  }
  return results;
}

async function searchAllcalidadByName(query, limit = 12) {
  const [apiHits, sitemapSlugs, tmdbSlugs] = await Promise.all([
    searchAllcalidadApi(query, limit),
    searchAllcalidadSitemap(query, 24),
    searchAllcalidadByTmdb(query, 10)
  ]);

  const slugPool = [
    ...ALLCALIDAD_QUERY_HINTS[slugifyWords(query)] || [],
    ...sitemapSlugs,
    ...tmdbSlugs,
    ...slugCandidates(query),
    ...apiHits.map((h) => h.slug)
  ];

  const probed = await probeAllcalidadSlugs(slugPool, query, limit);
  const merged = dedupeResults([...probed, ...apiHits]);
  return merged
    .filter((h) => resultMatchesQuery(h, query))
    .sort((a, b) => {
      const score = (x) => {
        const t = normalizeText(x.title || '');
        const w = queryWords(query)[0] || '';
        if (w && (t.startsWith(w) || t.startsWith(`${w}:`))) return 0;
        if (slugMatchesQuery(x.slug, query)) return 1;
        return 2;
      };
      return score(a) - score(b);
    })
    .slice(0, limit);
}

function queryMatchWords(query) {
  return String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function titleMatchesQuery(title, query) {
  return titleIsRelevant(title, query);
}

function cuevanaSearchPageRelevant(html, query) {
  const words = queryWords(query);
  if (!words.length) return false;
  const blob = String(html || '').toLowerCase();
  return words.every((w) => new RegExp(`\\b${w}\\b`, 'i').test(blob));
}

const CUEVANA_SLUG_HINTS = {
  alien: ['alien-romulus-2024', 'alien-3', 'aliens', 'alien-el-octavo-pasajero', 'prometheus', 'alien-covenant'],
  predator: ['predator-2025', 'predators', 'alien-vs-predator'],
  terminator: ['terminator-2', 'terminator-dark-fate']
};

function cuevanaSlugCandidates(query) {
  const yearMatch = String(query).match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  const base = slugifyWords(query.replace(/\b(19|20)\d{2}\b/g, '').trim());
  if (!base) return [];
  const slugs = new Set([base]);
  if (year) slugs.add(`${base}-${year}`);
  for (const hint of CUEVANA_SLUG_HINTS[base] || []) slugs.add(hint);
  return [...slugs].slice(0, 10);
}

function isValidCuevanaMovie(meta) {
  if (!meta?.slug) return false;
  const hasStream = (meta.servers?.length || 0) > 0;
  const hasTmdb = !!meta.tmdb_id;
  const title = String(meta.title || '').trim();
  const slug = String(meta.slug || '').trim();
  if (!title || title.toLowerCase() === slug.toLowerCase()) {
    if (!hasStream && !hasTmdb) return false;
  }
  if (/^[\da-z]+(-[\da-z]+)*$/i.test(title) && title.toLowerCase() === slug.toLowerCase()) {
    return hasStream || hasTmdb;
  }
  return hasStream || hasTmdb || title.length > slug.length + 2;
}

async function probeCuevanaSlug(slug) {
  try {
    const meta = await parseMoviePage(slug);
    if (!isValidCuevanaMovie(meta)) return null;
    return {
      type: 'movie',
      source: 'cuevana',
      slug: meta.slug,
      title: meta.title,
      year: meta.year || null,
      poster: '',
      url: meta.url || `${CUEVANA_BASE}/pelicula/${meta.slug}`,
      tmdb_id: meta.tmdb_id || null,
      overview: meta.description || ''
    };
  } catch {
    return null;
  }
}

async function searchCuevanaBySlug(query, limit = 8) {
  const allSlugs = cuevanaSlugCandidates(query);
  const results = [];
  for (const slug of allSlugs) {
    if (results.length >= limit) break;
    const hit = await probeCuevanaSlug(slug);
    if (hit && titleMatchesQuery(hit.title, query)) results.push(hit);
  }
  return dedupeResults(results);
}

/** Enriquece metadatos pero mantiene source=web para la UI. */
async function enrichWebSearchResult(item) {
  if (!item?.url) return item;
  try {
    const parsed = parseUrlInput(item.url);
    if (!parsed || parsed.source === 'web') return item;
    const enriched = await enrichUrlResult(parsed);
    return {
      ...item,
      type: enriched.type || item.type,
      title: enriched.title || item.title,
      slug: enriched.slug || item.slug,
      year: enriched.year || item.year,
      tmdb_id: enriched.tmdb_id || item.tmdb_id,
      overview: enriched.overview || item.overview,
      source: 'web',
      import_hint: enriched.source
    };
  } catch {
    return item;
  }
}

async function searchCuevanaByName(query, limit = 10) {
  const bySlug = await searchCuevanaBySlug(query, limit);
  if (bySlug.length >= Math.min(3, limit)) return bySlug.slice(0, limit);

  const url = `${CUEVANA_BASE}/?s=${encodeURIComponent(query)}`;
  let html;
  try {
    html = await fetchHtml(url);
  } catch {
    return bySlug;
  }

  if (!cuevanaSearchPageRelevant(html, query)) {
    return bySlug;
  }

  const links = parseMovieLinks(html).slice(0, limit * 2);
  const results = [...bySlug];
  await Promise.all(links.map(async (link) => {
    if (results.length >= limit) return;
    try {
      const meta = await parseMoviePage(link);
      if (!titleMatchesQuery(meta.title, query)) return;
      const words = queryWords(query);
      if (words.length === 1) {
        const w = words[0];
        const slug = (meta.slug || '').toLowerCase();
        if (!slug.includes(w) && !new RegExp(`\\b${w}\\b`, 'i').test(meta.title)) return;
      }
      results.push({
        type: 'movie',
        source: 'cuevana',
        slug: meta.slug,
        title: meta.title,
        year: meta.year || null,
        poster: '',
        url: meta.url || `${CUEVANA_BASE}/pelicula/${meta.slug}`,
        tmdb_id: meta.tmdb_id || null,
        overview: meta.description || ''
      });
    } catch { /* skip */ }
  }));
  return dedupeResults(results).slice(0, limit);
}

/** Marca películas ya en catálogo (siguen visibles en búsqueda). */
function markCatalogStatus(list) {
  return (list || []).map((item) => {
    if (item.type === 'series' || item.source === 'tmdb') return item;
    const existing = findExistingMovie({
      slug: item.slug,
      title: item.title,
      year: item.year,
      tmdb_id: item.tmdb_id
    });
    if (existing && Number(existing.available) === 1) {
      return {
        ...item,
        in_catalog: true,
        catalog_id: existing.id,
        note: 'Ya en tu catálogo — puedes volver a descargar para actualizar calidad'
      };
    }
    return item;
  });
}

async function searchTmdbCombined(query, limit = 10) {
  const results = [];
  const yearMatch = String(query).match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  const title = String(query).replace(/\b(19|20)\d{2}\b/g, '').trim();

  try {
    const movie = await searchTmdbMovie(title, year);
    if (movie) {
      results.push({
        type: 'movie',
        source: 'tmdb',
        slug: '',
        title: movie.title || movie.original_title || title,
        year: movie.release_date ? parseInt(movie.release_date.slice(0, 4), 10) : year,
        poster: movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : '',
        url: `https://www.themoviedb.org/movie/${movie.id}`,
        tmdb_id: movie.id,
        overview: movie.overview || '',
        catalog_only: true,
        note: 'Metadatos TMDB — elige un enlace web para descargar'
      });
    }
  } catch { /* ignore */ }

  try {
    const series = await searchTmdbSeries(title);
    if (series) {
      results.push({
        type: 'series',
        source: 'tmdb',
        slug: '',
        title: series.name || series.original_name || title,
        year: series.first_air_date ? parseInt(series.first_air_date.slice(0, 4), 10) : year,
        poster: series.poster_path ? `https://image.tmdb.org/t/p/w342${series.poster_path}` : '',
        url: `https://www.themoviedb.org/tv/${series.id}`,
        tmdb_id: series.id,
        overview: series.overview || '',
        catalog_only: true,
        note: 'Metadatos TMDB — busca la serie en AllCalidad o pega su URL'
      });
    }
  } catch { /* ignore */ }

  try {
    const key = require('./settings').getTmdbApiKey();
    if (key) {
      const [movies, tv] = await Promise.all([
        fetchJson(
          `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(title)}&language=es-ES${year ? `&primary_release_year=${year}` : ''}`
        ),
        fetchJson(
          `https://api.themoviedb.org/3/search/tv?api_key=${key}&query=${encodeURIComponent(title)}&language=es-ES`
        )
      ]);
      for (const m of (movies.results || []).slice(0, 4)) {
        results.push({
          type: 'movie',
          source: 'tmdb',
          slug: '',
          title: m.title || m.original_title,
          year: m.release_date ? parseInt(m.release_date.slice(0, 4), 10) : null,
          poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : '',
          url: `https://www.themoviedb.org/movie/${m.id}`,
          tmdb_id: m.id,
          overview: m.overview || '',
          catalog_only: true
        });
      }
      for (const s of (tv.results || []).slice(0, 4)) {
        results.push({
          type: 'series',
          source: 'tmdb',
          slug: '',
          title: s.name || s.original_name,
          year: s.first_air_date ? parseInt(s.first_air_date.slice(0, 4), 10) : null,
          poster: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : '',
          url: `https://www.themoviedb.org/tv/${s.id}`,
          tmdb_id: s.id,
          overview: s.overview || '',
          catalog_only: true
        });
      }
    }
  } catch { /* ignore */ }

  return dedupeResults(results).slice(0, limit);
}

async function matchWebResultToKnown(item) {
  if (!item.url) return item;
  const parsed = parseUrlInput(item.url);
  if (!parsed) return item;
  if (parsed.source === 'cuevana' || parsed.source === 'allcalidad' || parsed.source === 'cinecalidad') {
    try {
      return await enrichUrlResult(parsed);
    } catch {
      return { ...item, ...parsed };
    }
  }
  return { ...item, source_site: parsed.source_site || item.source_site };
}

async function enrichUrlResult(item) {
  if (item.source === 'cuevana' && item.type === 'movie') {
    try {
      const meta = await parseMoviePage(item.url || item.slug);
      return {
        type: 'movie',
        source: 'cuevana',
        slug: meta.slug,
        title: meta.title,
        year: meta.year,
        poster: '',
        url: meta.url,
        tmdb_id: meta.tmdb_id,
        overview: meta.description || ''
      };
    } catch { /* keep */ }
  }
  if (item.source === 'cinecalidad' && item.type === 'movie') {
    try {
      const page = await parseCinecalidadPage(item.slug || item.url);
      return {
        type: 'movie',
        source: 'cinecalidad',
        slug: page.slug,
        title: page.title,
        year: page.year,
        poster: page.poster,
        url: page.url,
        overview: page.overview || ''
      };
    } catch { /* keep */ }
  }
  if (item.source === 'allcalidad') {
    const postType = item.type === 'series' ? 'tvshows' : 'movies';
    const hit = await probeAllcalidadSlug(item.slug, postType);
    if (hit) return hit;
  }
  if (item.source === 'web' && item.url) {
    const matched = await matchWebResultToKnown(item);
    if (matched.source !== 'web') return matched;
  }
  return item;
}

function qualityLabelFromHeight(height) {
  const h = parseInt(height, 10) || 0;
  if (h >= 2160) return '4K';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  if (h > 0) return `${h}p`;
  return '';
}

function recommendedQualityFromHeight(height) {
  const h = parseInt(height, 10) || 0;
  if (h >= 1080) return '1080';
  if (h >= 720) return '720';
  if (h >= 480) return '480';
  return 'max';
}

function availableQualitiesForHeight(maxH) {
  const h = parseInt(maxH, 10) || 0;
  const opts = [];
  if (h >= 2160) opts.push({ value: 'max', label: 'Máxima — 4K / mejor disponible' });
  if (h >= 1080) opts.push({ value: '1080', label: 'Full HD — 1080p' });
  if (h >= 720) opts.push({ value: '720', label: 'HD — 720p' });
  if (h >= 480) opts.push({ value: '480', label: 'SD — 480p' });
  if (!opts.length) {
    opts.push(
      { value: 'max', label: 'Máxima — mejor disponible' },
      { value: '1080', label: '1080p' },
      { value: '720', label: '720p' },
      { value: '480', label: '480p' }
    );
  }
  return opts;
}

function isCatalogPageUrl(url, source) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    if (source === 'cinecalidad' || u.hostname.includes('cinecalidad')) {
      return /\/ver-pelicula\//i.test(u.pathname);
    }
    if (source === 'allcalidad' || u.hostname.includes('allcalidad')) {
      return /\/peliculas\/|\/series\/|\/tvshows\//i.test(u.pathname);
    }
    if (source === 'cuevana' || u.hostname.includes('cuevana')) {
      return /\/pelicula\/|\/serie\//i.test(u.pathname);
    }
  } catch { /* ignore */ }
  return false;
}

async function resolveProbeUrlForItem(item) {
  if (item.source === 'cinecalidad' && item.slug) {
    try {
      const page = await parseCinecalidadPage(item.slug);
      const stream = await resolveCinecalidadStream(page, 'max');
      if (stream.m3u8) return { url: stream.m3u8, referer: stream.referer || 'https://www.cinecalidad.am/' };
      if (stream.embedUrl) return { url: stream.embedUrl, referer: 'https://www.cinecalidad.am/' };
    } catch { /* fall through */ }
  }
  if (item.source === 'allcalidad' && item.slug) {
    const { resolveAllcalidadUrl } = require('./vodYtDlp');
    const r = await resolveAllcalidadUrl(item.slug, item.year || 2024);
    if (r?.url) return { url: r.url, referer: 'https://allcalidad.re/' };
  }
  if (item.source === 'cuevana' && item.slug) {
    const { parseMoviePage, resolveBestStream } = require('./cuevana');
    const movie = await parseMoviePage(item.slug);
    const stream = await resolveBestStream(movie, 'max');
    if (stream?.m3u8) return { url: stream.m3u8, referer: 'https://cuevana3.cl/' };
  }
  if (item.url && /^https?:\/\//i.test(item.url) && !isCatalogPageUrl(item.url, item.source)) {
    const host = (() => {
      try { return new URL(item.url).hostname; } catch { return ''; }
    })();
    const referer = host.includes('cuevana') ? 'https://cuevana3.cl/'
      : host.includes('allcalidad') ? 'https://allcalidad.re/'
      : host.includes('cinecalidad') ? 'https://www.cinecalidad.am/'
      : 'https://www.cinecalidad.am/';
    return { url: item.url, referer };
  }
  return null;
}

/** Detecta altura máxima del stream por enlace (para mostrar calidades al buscar). */
async function enrichStreamQualities(results, opts = {}) {
  const enabled = opts.probe_qualities !== false;
  const limit = opts.limit || 10;
  if (!enabled) return results;

  const { probeStreamMaxHeight } = require('./vodYtDlp');
  const targets = results.filter((r) => isDownloadableResult(r) && (r.slug || r.url)).slice(0, limit);
  const batchSize = 3;

  async function probeOne(item) {
    try {
      const resolved = await resolveProbeUrlForItem(item);
      if (!resolved?.url) return;
      let probe = probeStreamMaxHeight(resolved.url, resolved.referer);
      let maxH = probe.maxHeight || 0;
      if (!maxH && /\.m3u8/i.test(resolved.url)) {
        const { maxHeightFromM3u8 } = require('./vimeosEmbed');
        maxH = await maxHeightFromM3u8(resolved.url, resolved.referer);
        probe = { ...probe, maxHeight: maxH, height: maxH };
      }
      if (!maxH) return;
      item.stream_max_height = maxH;
      item.stream_max_width = probe.width || 0;
      item.stream_quality_label = qualityLabelFromHeight(maxH);
      item.recommended_quality = recommendedQualityFromHeight(maxH);
      item.available_qualities = availableQualitiesForHeight(maxH);
    } catch (err) {
      console.warn('[vodSearch] calidad', item.title || item.slug, err.message);
    }
  }

  for (let i = 0; i < targets.length; i += batchSize) {
    await Promise.all(targets.slice(i, i + batchSize).map(probeOne));
  }
  return results;
}

/**
 * @param {{ q: string, source?: 'cuevana'|'allcalidad'|'cinecalidad'|'all', probe_qualities?: boolean }} opts
 */
async function searchVod(opts = {}) {
  const q = String(opts.q || '').trim();
  const source = ['cuevana', 'allcalidad', 'cinecalidad', 'all'].includes(opts.source) ? opts.source : 'all';
  const probeQualities = opts.probe_qualities !== false;
  if (!q) return { query: q, source, results: [] };

  const fromUrl = parseUrlInput(q);
  if (fromUrl) {
    let enriched = await enrichUrlResult(fromUrl);
    if (probeQualities) {
      [enriched] = await enrichStreamQualities([enriched], { probe_qualities: true, limit: 1 });
    }
    return { query: q, source, from_url: true, probe_qualities: probeQualities, results: [enriched] };
  }

  let results = [];

  if (source === 'all') {
    const [web, cv, ac, cc, tmdb] = await Promise.all([
      searchInternet(q, 22).catch((err) => {
        console.warn('[vodSearch] internet', err.message);
        return [];
      }),
      searchCuevanaByName(q, 8).catch(() => []),
      searchAllcalidadByName(q, 8).catch(() => []),
      searchCinecalidadByName(q, 6).catch(() => []),
      searchTmdbCombined(q, 4).catch(() => [])
    ]);
    const webEnriched = await Promise.all(web.map((w) => enrichWebSearchResult(w)));
    const merged = markCatalogStatus(
      filterVodResults([...webEnriched, ...cv, ...ac, ...cc, ...tmdb], q)
    );
    const parts = partitionVodResults(merged, q);
    let all = await enrichResultPosters(parts.all.slice(0, 24));
    all = await enrichStreamQualities(all, { probe_qualities: probeQualities, limit: 12 });
    const repart = partitionVodResults(all, q);
    return {
      query: q,
      source,
      search_mode: 'internet',
      probe_qualities: probeQualities,
      downloadable_count: repart.downloadable.length,
      reference_count: repart.reference.length,
      results: repart.all
    };
  }

  if (source === 'cuevana') {
    results = results.concat(await searchCuevanaByName(q, 12));
  }
  if (source === 'allcalidad') {
    results = results.concat(await searchAllcalidadByName(q, 12));
  }
  if (source === 'cinecalidad') {
    results = results.concat(await searchCinecalidadByName(q, 12));
  }

  const filtered = markCatalogStatus(filterVodResults(results, q));
  const parts = partitionVodResults(filtered, q);
  let all = await enrichResultPosters(parts.all.slice(0, 20));
  all = await enrichStreamQualities(all, { probe_qualities: probeQualities, limit: 12 });
  const repart = partitionVodResults(all, q);
  return {
    query: q,
    source,
    probe_qualities: probeQualities,
    filtered_count: filtered.length,
    downloadable_count: repart.downloadable.length,
    reference_count: repart.reference.length,
    results: repart.all
  };
}

function spawnSeriesImport(slug, download, quality = 'max') {
  const script = path.join(__dirname, '..', 'scripts', 'import-allcalidad-series.js');
  const args = [script, '--slug', slug];
  if (download) args.push('--download');
  if (quality && quality !== 'max') args.push('--quality', quality);
  const child = spawn('node', args, {
    detached: true,
    stdio: 'ignore',
    cwd: ROOT
  });
  child.unref();
}

async function importMovieFromWebUrl(pageUrl, { download = false, title, year, recommended = true, quality = 'max', manualDownload = false } = {}) {
  const db = require('../db');
  const { findExistingMovie } = require('./movieDedup');
  const { autoSyncMovieTmdbIfNeeded } = require('./tmdbMetadata');
  const {
    safeFilename,
    runGenericWebDownload,
    findFinishedFile,
    finalizeDownloadedMovie,
    logRelForMovie,
    MOVIES_DIR
  } = require('./vodYtDlp');
  const { registerDownloadJob } = require('./vodDownloadProgress');

  const url = String(pageUrl || '').trim();
  if (!url.startsWith('http')) throw new Error('URL inválida');

  const parsed = parseUrlInput(url);
  if (parsed?.source === 'cuevana') {
    return cuevanaImport.importMovie(url, { download, recommended, quality });
  }
  if (parsed?.source === 'cinecalidad' && parsed.type === 'movie') {
    return cinecalidadImport.importMovie(parsed.slug || url, { download, recommended, quality });
  }
  if (parsed?.source === 'allcalidad' && parsed.type === 'movie') {
    return allcalidadImport.importMovie(parsed.slug || url, { download, recommended, quality });
  }

  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
  const slug = `web-${hash}`;
  const cleanTitle = (title || parsed?.title || 'Película web').replace(/\s+/g, ' ').trim();
  const movieYear = year || parsed?.year || null;

  const existing = findExistingMovie({ slug, title: cleanTitle, year: movieYear, tmdb_id: null });
  if (existing && !download) {
    return { skipped: true, id: existing.id, slug, title: cleanTitle, reason: 'ya en catálogo' };
  }

  let video_path = `/uploads/movies/pending_${slug}.mkv`;
  const fname = safeFilename(cleanTitle, movieYear);
  const logRel = `winscp/import-web-${hash}.log`;

  let movieId;
  if (existing) {
    db.prepare(`
      UPDATE movies SET title=?, video_path=?, year=?, recommended=?, available=? WHERE id=?
    `).run(cleanTitle, video_path, movieYear, recommended ? 1 : 0, 0, existing.id);
    movieId = existing.id;
  } else {
    const r = db.prepare(`
      INSERT INTO movies (title, description, poster, video_path, genre, year, recommended, available, rating)
      VALUES (?, '', '', ?, 'Web', ?, ?, 0, 0)
    `).run(cleanTitle, video_path, movieYear, recommended ? 1 : 0);
    movieId = r.lastInsertRowid;
  }

  if (!download) {
    registerDownloadJob(movieId, { logFile: logRel, destBase: `pending_${slug}`, slug });
    await autoSyncMovieTmdbIfNeeded(movieId, { title: cleanTitle, year: movieYear });
    return { ok: true, id: movieId, slug, title: cleanTitle, year: movieYear, available: 0, source: 'web', url };
  }

  const destBase = path.basename(fname, '.mkv');
  const { clearMovieFilesForRedownload } = require('./vodYtDlp');
  if (existing) clearMovieFilesForRedownload(destBase, slug);
  registerDownloadJob(movieId, {
    logFile: logRel,
    destBase,
    slug,
    quality,
    source: 'web',
    media_url: url,
    updating: !!existing
  });
  const { spawnMovieDownload } = require('./vodPendingQueue');
  spawnMovieDownload(movieId, { manual: manualDownload });

  return {
    ok: true,
    async: true,
    id: movieId,
    slug,
    title: cleanTitle,
    year: movieYear,
    available: 0,
    source: 'web',
    url,
    message: existing
      ? `Actualizando (${quality}) — ver progreso en Películas VOD`
      : `Descarga iniciada (${quality}) — sigue el progreso en Películas VOD`
  };
}

/**
 * Importa película o serie.
 */
async function importVod(body = {}) {
  let { source, type, slug, url, download = false, title, year, quality = 'max', manual_download } = body;
  const q = ['max', '1080', '720', '480'].includes(quality) ? quality : 'max';
  const manualDownload = manual_download !== false;
  source = String(source || '').toLowerCase();
  type = type === 'series' ? 'series' : 'movie';
  download = !!download;

  if (!slug && url) {
    const parsed = parseUrlInput(url);
    if (parsed) {
      slug = parsed.slug || slug;
      source = parsed.source || source;
      type = parsed.type || type;
      title = title || parsed.title;
      year = year || parsed.year;
    }
  }

  slug = String(slug || '').trim().replace(/\/$/, '');

  if (type === 'series') {
    if (source === 'web' && url) {
      const parsed = parseUrlInput(url);
      if (parsed?.source === 'allcalidad' && parsed.slug) {
        slug = parsed.slug;
        source = 'allcalidad';
      }
    }
    if (source === 'web' || (source === 'tmdb' && !slug)) {
      const ac = await searchAllcalidadByName(title || slug || url || '', 1);
      const hit = ac.find((r) => r.type === 'series');
      if (!hit) {
        throw new Error('Series: no encontrada en AllCalidad. Pega la URL de allcalidad.re o busca en fuente AllCalidad.');
      }
      slug = hit.slug;
      source = 'allcalidad';
    }
    if (source !== 'allcalidad' && source !== 'tmdb') {
      throw new Error('Las series se importan desde AllCalidad (o URL de allcalidad.re)');
    }
    if (!slug) throw new Error('slug de serie requerido');

    if (download) {
      spawnSeriesImport(slug, true, q);
      return {
        ok: true,
        async: true,
        type: 'series',
        source: 'allcalidad',
        slug,
        message: `Importación y descarga iniciadas: ${slug}`
      };
    }

    const result = await importSeriesFromAllcalidad(slug, { download: false, quality: q });
    return { ok: true, type: 'series', source: 'allcalidad', slug, ...result };
  }

  if (!slug && !url) throw new Error('slug o url requerido');

  if (source === 'web' || (url && !['cuevana', 'allcalidad', 'tmdb'].includes(source))) {
    const result = await importMovieFromWebUrl(url, {
      download, title, year, recommended: true, quality: q, manualDownload
    });
    return { ok: true, type: 'movie', ...result };
  }

  if (source === 'cuevana') {
    const result = await cuevanaImport.importMovie(url || slug, {
      download, recommended: true, quality: q, manualDownload
    });
    return { ok: true, type: 'movie', source: 'cuevana', ...result };
  }

  if (source === 'cinecalidad') {
    const result = await cinecalidadImport.importMovie(url || slug, {
      download, recommended: true, quality: q, manualDownload
    });
    return { ok: true, type: 'movie', source: 'cinecalidad', ...result };
  }

  if (source === 'allcalidad' || source === 'tmdb') {
    if (!slug || source === 'tmdb') {
      const ac = await searchAllcalidadByName(title || slug || '', 1);
      const hit = ac.find((r) => r.type === 'movie');
      if (!hit) throw new Error('No se encontró la película en AllCalidad');
      slug = hit.slug;
    }
    const result = await allcalidadImport.importMovie(slug, {
      download, recommended: true, quality: q, manualDownload
    });
    return { ok: true, type: 'movie', source: 'allcalidad', ...result };
  }

  throw new Error(`Fuente no soportada: ${source}`);
}

module.exports = {
  searchVod,
  importVod,
  importMovieFromWebUrl,
  parseUrlInput,
  slugCandidates
};
