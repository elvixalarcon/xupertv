const express = require('express');
const { auth } = require('../middleware/auth');
const {
  getHomeSections,
  getCategoriesCatalog,
  getMovieGenreRows,
  getSeriesGenreRows,
  getHomeSectionItems
} = require('../services/catalogCategories');
const db = require('../db');
const { getStorefront, getStorefrontSectionItems } = require('../services/storefrontCategories');
const {
  ensureCatalog,
  getCatalogItems,
  getExternalItemMeta,
  enrichExternalItems,
  countEnrichmentNeeds,
  resolveExternalPlay,
  EXTERNAL_SOURCES,
  warmExternalCatalogs
} = require('../services/externalCatalog');
const { getHeroSlides, getSeriesHeroSlides, enrichMoviesHeroBackdrops } = require('../services/heroSlides');
const { enrichHeroBanners, bannerUrlForItem } = require('../services/bannerArt');
const { enrichCatalogItemsPosters } = require('../services/posters');

const router = express.Router();

function canMovies(user) {
  return user.role === 'admin' || user.can_movies;
}

function canSeries(user) {
  return user.role === 'admin' || user.can_series;
}

function filterSections(sections, user) {
  const moviesOk = canMovies(user);
  const seriesOk = canSeries(user);
  return sections.filter((sec) => {
    if (sec.type === 'label') return seriesOk;
    if (sec.type === 'movie') return moviesOk;
    if (sec.type === 'series') return seriesOk;
    if (sec.type === 'mixed') {
      if (!moviesOk && !seriesOk) return false;
      if (!moviesOk) sec.items = (sec.items || []).filter((i) => i.content_type === 'series');
      if (!seriesOk) sec.items = (sec.items || []).filter((i) => i.content_type === 'movie');
      return sec.items?.length > 0;
    }
    return true;
  });
}

router.get('/home', auth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  const catalog = getHomeSections({ profile: req.profile, profileId: req.profileId });
  catalog.sections = filterSections(catalog.sections, req.user);
  res.json(catalog);
});

router.get('/hero', auth, async (req, res) => {
  try {
    const slides = await getHeroSlides(req.user);
    res.json(slides);
  } catch (err) {
    console.error('[catalog/hero]', err);
    res.status(500).json({ error: 'No se pudo cargar el carrusel' });
  }
});

async function enrichStorefrontHero(page, user) {
  if (!page?.hero?.length) return page;
  const movieIds = page.hero.filter((i) => (i.content_type || 'movie') === 'movie').map((i) => i.id);
  const seriesIds = page.hero.filter((i) => i.content_type === 'series').map((i) => i.id);
  const backdropById = new Map();

  if (movieIds.length && canMovies(user)) {
    const placeholders = movieIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM movies WHERE id IN (${placeholders})`).all(...movieIds);
    const enriched = await enrichMoviesHeroBackdrops(rows);
    for (const row of enriched) backdropById.set(`movie:${row.id}`, row);
  }
  if (seriesIds.length && canSeries(user)) {
    const slides = await getSeriesHeroSlides(user);
    for (const slide of slides) backdropById.set(`series:${slide.id}`, slide);
  }

  const mapHeroItem = (item) => {
    const key = `${item.content_type || 'movie'}:${item.id}`;
    const extra = backdropById.get(key);
    const banner = item.banner || bannerUrlForItem(item);
    if (!extra) return { ...item, banner };
    return {
      ...item,
      poster: extra.poster || item.poster,
      backdrop: extra.backdrop || extra.poster || item.backdrop || item.poster,
      banner: extra.banner || banner
    };
  };
  page.hero = page.hero.map(mapHeroItem);
  if (page.recent?.length) {
    page.recent = page.recent.map(mapHeroItem);
  }
  try {
    page.hero = await enrichHeroBanners(page.hero);
    if (page.recent?.length) {
      page.recent = await enrichHeroBanners(page.recent);
    }
  } catch (err) {
    console.warn('[catalog/storefront] banners', err.message || err);
  }
  return page;
}

async function enrichStorefrontPosters(page) {
  if (!page) return page;
  if (page.hero?.length) {
    page.hero = await enrichCatalogItemsPosters(page.hero);
  }
  if (page.recent?.length) {
    page.recent = await enrichCatalogItemsPosters(page.recent);
  }
  if (page.sections?.length) {
    for (const sec of page.sections) {
      if (sec.items?.length) {
        sec.items = await enrichCatalogItemsPosters(sec.items);
      }
    }
  }
  return page;
}

router.get('/storefront/:slug', auth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let page;
  try {
    page = getStorefront(req.params.slug, { profile: req.profile, profileId: req.profileId });
  } catch (err) {
    console.error('[catalog/storefront]', req.params.slug, err);
    return res.status(500).json({ error: 'No se pudo cargar la categoría' });
  }
  const moviesOk = canMovies(req.user);
  const seriesOk = canSeries(req.user);
  if (page.sections) {
    page.sections = page.sections.filter((sec) => {
      if (sec.type === 'series') return seriesOk;
      if (sec.type === 'movie') return moviesOk;
      if (sec.type === 'mixed') {
        sec.items = (sec.items || []).filter((i) => {
          const t = i.content_type || 'movie';
          return t === 'series' ? seriesOk : moviesOk;
        });
        return sec.items.length > 0;
      }
      return true;
    });
  }
  if (page.hero) {
    page.hero = page.hero.filter((i) => {
      const t = i.content_type || 'movie';
      return t === 'series' ? seriesOk : moviesOk;
    });
  }
  if (page.recent) {
    page.recent = page.recent.filter((i) => {
      const t = i.content_type || 'movie';
      return t === 'series' ? seriesOk : moviesOk;
    });
  }
  try {
    page = await enrichStorefrontHero(page, req.user);
    page = await enrichStorefrontPosters(page);
    if (req.params.slug === 'explorar' && page.sections?.length) {
      const { enrichExternalItems: enrichSeries } = require('../services/externalSeries');
      for (const sec of page.sections) {
        if (sec.externalSource && sec.items?.length) {
          const need = countEnrichmentNeeds(sec.items);
          if (!need) continue;
          const enrich = sec.contentType === 'series' ? enrichSeries : enrichExternalItems;
          sec.items = await enrich(sec.items, { maxLookup: Math.min(need, sec.items.length), concurrency: 10 });
        }
      }
    }
  } catch (err) {
    console.warn('[catalog/storefront] hero enrich', req.params.slug, err.message || err);
  }
  res.json(page);
});

router.get('/external/sources', auth, (req, res) => {
  if (!canMovies(req.user)) return res.status(403).json({ error: 'No tienes acceso a películas' });
  res.json(Object.values(EXTERNAL_SOURCES));
});

router.get('/external/:source/browse', auth, async (req, res) => {
  const source = String(req.params.source || '').toLowerCase();
  if (!EXTERNAL_SOURCES[source]) return res.status(404).json({ error: 'Fuente no encontrada' });
  const contentType = req.query.content_type === 'series' ? 'series' : 'movie';
  if (contentType === 'series' && !canSeries(req.user)) {
    return res.status(403).json({ error: 'No tienes acceso a series' });
  }
  if (contentType === 'movie' && !canMovies(req.user)) {
    return res.status(403).json({ error: 'No tienes acceso a películas' });
  }
  try {
    if (contentType === 'series') {
      const { ensureSeriesCatalog } = require('../services/externalSeries');
      await ensureSeriesCatalog(source).catch(() => {});
    } else {
      await ensureCatalog(source).catch(() => {});
    }
    const { getExternalSourceBrowseSections, enrichExternalGenres } = require('../services/externalCatalog');
    const sections = getExternalSourceBrowseSections(source, contentType, 10);
    const allItems = sections.flatMap((s) => s.items || []);
    if (allItems.length) {
      enrichExternalGenres(allItems, { maxLookup: 16, concurrency: 8 }).catch(() => {});
    }
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.json({
      source,
      title: EXTERNAL_SOURCES[source].title,
      content_type: contentType,
      sections
    });
  } catch (err) {
    console.error('[catalog/external/browse]', source, err.message || err);
    res.status(500).json({ error: err.message || 'No se pudo cargar categorías' });
  }
});

router.get('/external/:source', auth, async (req, res) => {
  if (!canMovies(req.user)) return res.status(403).json({ error: 'No tienes acceso a películas' });
  const source = String(req.params.source || '').toLowerCase();
  if (!EXTERNAL_SOURCES[source]) return res.status(404).json({ error: 'Fuente no encontrada' });
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const refresh = req.query.refresh === '1';
  try {
    if (refresh) await ensureCatalog(source, { force: true });
    else await ensureCatalog(source).catch(() => {});
    const data = getCatalogItems(source, { limit, offset, q: req.query.q });
    const need = countEnrichmentNeeds(data.items);
    const maxLookup = need ? Math.min(need, limit <= 40 ? need : 24) : 0;
    if (maxLookup) data.items = await enrichExternalItems(data.items, { maxLookup, concurrency: 12 });
    res.setHeader('Cache-Control', 'private, max-age=90');
    res.json(data);
  } catch (err) {
    console.error('[catalog/external]', source, err);
    res.status(500).json({ error: err.message || 'No se pudo cargar el catálogo' });
  }
});

router.get('/external/:source/series', auth, async (req, res) => {
  if (!canSeries(req.user)) return res.status(403).json({ error: 'No tienes acceso a series' });
  const source = String(req.params.source || '').toLowerCase();
  if (!EXTERNAL_SOURCES[source]) return res.status(404).json({ error: 'Fuente no encontrada' });
  const { ensureSeriesCatalog, getSeriesCatalogItems, enrichExternalItems: enrichSeries } = require('../services/externalSeries');
  const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  try {
    if (req.query.refresh === '1') await ensureSeriesCatalog(source, { force: true });
    else await ensureSeriesCatalog(source).catch(() => {});
    const data = getSeriesCatalogItems(source, { limit, offset, q: req.query.q });
    const need = countEnrichmentNeeds(data.items);
    const maxLookup = need ? Math.min(need, limit <= 40 ? need : 24) : 0;
    if (maxLookup) data.items = await enrichSeries(data.items, { maxLookup, concurrency: 12 });
    res.setHeader('Cache-Control', 'private, max-age=90');
    res.json(data);
  } catch (err) {
    console.error('[catalog/external/series]', source, err);
    res.status(500).json({ error: err.message || 'No se pudo cargar series' });
  }
});

router.get('/external/:source/series/:slug/play', auth, async (req, res) => {
  if (!canSeries(req.user)) return res.status(403).json({ error: 'No tienes acceso a series' });
  const source = String(req.params.source || '').toLowerCase();
  if (!EXTERNAL_SOURCES[source]) return res.status(404).json({ error: 'Fuente no encontrada' });
  const slug = decodeURIComponent(String(req.params.slug || '').trim());
  const season = parseInt(req.query.season, 10) || 0;
  const episode = parseInt(req.query.episode, 10) || 0;
  const quality = ['max', '1080', '720', '480'].includes(String(req.query.quality || ''))
    ? String(req.query.quality)
    : '1080';
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    const { resolveExternalSeriesPlay } = require('../services/externalSeries');
    const play = await resolveExternalSeriesPlay(source, slug, season, episode, token, quality);
    res.setHeader('Cache-Control', 'no-store');
    res.json(play);
  } catch (err) {
    console.error('[catalog/external/series/play]', source, slug, err.message || err);
    res.status(502).json({ error: err.message || 'No se pudo reproducir' });
  }
});

router.get('/external/:source/series/:slug', auth, async (req, res) => {
  if (!canSeries(req.user)) return res.status(403).json({ error: 'No tienes acceso a series' });
  const source = String(req.params.source || '').toLowerCase();
  if (!EXTERNAL_SOURCES[source]) return res.status(404).json({ error: 'Fuente no encontrada' });
  const slug = decodeURIComponent(String(req.params.slug || '').trim());
  try {
    const { ensureSeriesCatalog, getExternalSeriesDetail } = require('../services/externalSeries');
    await ensureSeriesCatalog(source).catch(() => {});
    const meta = await getExternalSeriesDetail(source, slug);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.json(meta);
  } catch (err) {
    console.error('[catalog/external/series/meta]', source, slug, err.message || err);
    res.status(404).json({ error: err.message || 'Serie no encontrada' });
  }
});

router.get('/external/:source/:slug', auth, async (req, res) => {
  if (!canMovies(req.user)) return res.status(403).json({ error: 'No tienes acceso a películas' });
  const source = String(req.params.source || '').toLowerCase();
  if (!EXTERNAL_SOURCES[source]) return res.status(404).json({ error: 'Fuente no encontrada' });
  const slug = decodeURIComponent(String(req.params.slug || '').trim());
  const year = parseInt(req.query.year, 10) || null;
  try {
    await ensureCatalog(source).catch(() => {});
    const meta = await getExternalItemMeta(source, slug, year);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.json(meta);
  } catch (err) {
    console.error('[catalog/external/meta]', source, slug, err.message || err);
    res.status(404).json({ error: err.message || 'Título no encontrado' });
  }
});

router.get('/external/:source/:slug/play', auth, async (req, res) => {
  if (!canMovies(req.user)) return res.status(403).json({ error: 'No tienes acceso a películas' });
  const source = String(req.params.source || '').toLowerCase();
  if (!EXTERNAL_SOURCES[source]) return res.status(404).json({ error: 'Fuente no encontrada' });
  const slug = decodeURIComponent(String(req.params.slug || '').trim());
  const year = parseInt(req.query.year, 10) || null;
  const quality = ['max', '1080', '720', '480'].includes(String(req.query.quality || ''))
    ? String(req.query.quality)
    : '1080';
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    const play = await resolveExternalPlay(source, slug, year, token, quality);
    res.setHeader('Cache-Control', 'no-store');
    res.json(play);
  } catch (err) {
    console.error('[catalog/external/play]', source, slug, err.message || err);
    res.status(502).json({ error: err.message || 'No se pudo reproducir' });
  }
});

router.get('/section/:sectionId', auth, async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 500));
  const sectionId = String(req.params.sectionId || '');
  let items = getStorefrontSectionItems(sectionId, limit, {
    profileId: req.profileId,
    profile: req.profile
  });
  if (!items.length) {
    items = getHomeSectionItems(sectionId, limit, {
      profileId: req.profileId,
      profile: req.profile
    });
  }
  if (sectionId.startsWith('external-') && items.length) {
    const { parseExternalSectionId, countEnrichmentNeeds } = require('../services/externalCatalog');
    const parsed = parseExternalSectionId(sectionId);
    const isSeries = parsed?.contentType === 'series';
    const need = countEnrichmentNeeds(items);
    const maxLookup = need ? Math.min(need, limit <= 40 ? need : 20) : 0;
    if (maxLookup) {
      if (isSeries) {
        const { enrichExternalItems: enrichSeries } = require('../services/externalSeries');
        items = await enrichSeries(items, { maxLookup, concurrency: 10 });
      } else {
        items = await enrichExternalItems(items, { maxLookup, concurrency: 10 });
      }
    }
  }
  const moviesOk = canMovies(req.user);
  const seriesOk = canSeries(req.user);
  const filtered = items.filter((it) => {
    const type = it.content_type || 'movie';
    if (type === 'series') return seriesOk;
    return moviesOk;
  });
  const enriched = await enrichCatalogItemsPosters(filtered);
  res.json(enriched);
});

router.get('/categories', auth, (req, res) => {
  const limit = Math.min(40, Math.max(4, parseInt(req.query.limit, 10) || 24));
  const catalog = getCategoriesCatalog({ limitPerGenre: limit });
  catalog.sections = catalog.sections.filter((sec) => {
    if (sec.id === 'cat-movies-label' || sec.type === 'movie') return canMovies(req.user);
    if (sec.id === 'cat-series-label' || sec.type === 'series') return canSeries(req.user);
    return true;
  });
  res.json(catalog);
});

router.get('/movies', auth, (req, res) => {
  if (!canMovies(req.user)) return res.status(403).json({ error: 'No tienes acceso a películas' });
  const limit = Math.min(40, Math.max(4, parseInt(req.query.limit, 10) || 24));
  res.json(getMovieGenreRows({ limitPerGenre: limit }));
});

router.get('/series', auth, (req, res) => {
  if (!canSeries(req.user)) return res.status(403).json({ error: 'No tienes acceso a series' });
  const limit = Math.min(40, Math.max(4, parseInt(req.query.limit, 10) || 24));
  res.json(getSeriesGenreRows({ limitPerGenre: limit }));
});

module.exports = router;
