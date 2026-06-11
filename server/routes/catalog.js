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
const { getHeroSlides, getSeriesHeroSlides, enrichMoviesHeroBackdrops } = require('../services/heroSlides');
const { enrichHeroBanners, bannerUrlForItem } = require('../services/bannerArt');

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

router.get('/home', auth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
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
  } catch (err) {
    console.warn('[catalog/storefront] hero enrich', req.params.slug, err.message || err);
  }
  res.json(page);
});

router.get('/section/:sectionId', auth, (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 500));
  let items = getStorefrontSectionItems(req.params.sectionId, limit, {
    profileId: req.profileId,
    profile: req.profile
  });
  if (!items.length) {
    items = getHomeSectionItems(req.params.sectionId, limit, {
      profileId: req.profileId,
      profile: req.profile
    });
  }
  const moviesOk = canMovies(req.user);
  const seriesOk = canSeries(req.user);
  const filtered = items.filter((it) => {
    const type = it.content_type || 'movie';
    if (type === 'series') return seriesOk;
    return moviesOk;
  });
  res.json(filtered);
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
