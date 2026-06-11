const https = require('https');
const {
  GATOTV_SLUGS,
  gatotvSlugForChannel,
  gatotvXmltvId,
  normalizeName
} = require('../data/epg-channel-map');

const GATOTV_BASE = 'https://www.gatotv.com/canal';
const CACHE_TTL_MS = 25 * 60 * 1000;
const FETCH_CONCURRENCY = 5;

let cache = {
  fetchedAt: 0,
  date: '',
  error: '',
  channelsById: new Map(),
  programmesByChannel: new Map(),
  nameToChannelId: new Map()
};

let refreshPromise = null;

function decodeHtml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function ecuadorToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
}

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      timeout: 45000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VixTV-EPG/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-EC,es;q=0.9'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 6) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchUrl(next, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function parseTimeOnDate(timeStr, dateStr) {
  const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const localStr = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00`;
  const guess = new Date(localStr);
  const offsetGuess = guess.getTime();
  const ref = new Date(`${dateStr}T12:00:00`);
  const ecParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guayaquil',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(ref);
  void get;
  void ecParts;
  const utcFromLocal = (yy, mm, dd, hh, min) => {
    let lo = Date.UTC(yy, mm - 1, dd, hh, min, 0) + 5 * 3600000;
    let hi = lo + 2 * 3600000;
    for (let i = 0; i < 24; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const shown = new Date(mid).toLocaleString('en-US', {
        timeZone: 'America/Guayaquil',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const sm = shown.match(/(\d{1,2}):(\d{2})/);
      if (!sm) break;
      const sh = parseInt(sm[1], 10);
      const smi = parseInt(sm[2], 10);
      if (sh === hh && smi === min) return new Date(mid);
      const target = hh * 60 + min;
      const current = sh * 60 + smi;
      if (current < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return new Date(Date.UTC(yy, mm - 1, dd, hh + 5, min, 0));
  };
  void offsetGuess;
  return utcFromLocal(y, mo, d, h, mi);
}

function extractPageDate(html) {
  const m = html.match(/Horarios para hoy\s*<time datetime="(\d{4}-\d{2}-\d{2})"/i)
    || html.match(/guia_tv\/ecuador\/(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : ecuadorToday();
}

function extractChannelTitle(html, slug) {
  const m = html.match(/<title>\s*([^<]+?)\s*-\s*GatoTV/i)
    || html.match(/property="og:title"\s+content="([^"]+)"/i);
  if (m) return decodeHtml(m[1]).replace(/\s*-\s*Horarios.*$/i, '').trim();
  return slug.replace(/_/g, ' ');
}

function parseProgrammeRows(html, slug, dateStr) {
  const programmes = [];
  const rowRe = /<tr class="tbl_EPG_row[^"]*">([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRe.exec(html)) !== null) {
    const block = row[1];
    const times = [...block.matchAll(/<time datetime="(\d{1,2}:\d{2})">/gi)].map((m) => m[1]);
    if (times.length < 2) continue;
    const start = parseTimeOnDate(times[0], dateStr);
    const stop = parseTimeOnDate(times[1], dateStr);
    if (!start || !stop || stop <= start) continue;

    let title = '';
    const titleLink = block.match(/div_program_title_on_channel[\s\S]*?<span>([^<]+)<\/span>/i);
    const titleSpan = block.match(/div_program_title_on_channel[\s\S]*?<span>([^<]+)<\/span>/i);
    const titleAttr = block.match(/title="([^"]{2,120})"/i);
    if (titleLink) title = decodeHtml(titleLink[1]);
    else if (titleSpan) title = decodeHtml(titleSpan[1]);
    else if (titleAttr) title = decodeHtml(titleAttr[1]);
    if (!title || /^canal\b/i.test(title)) continue;

    const episode = block.match(/div_episode_[^"]*_on_channel[^>]*>([\s\S]*?)<\/div>/i);
    const subtitle = episode ? decodeHtml(episode[1]) : '';
    const descBlock = block.match(/tbl_EPG_ProgramsColumn[^>]*>[\s\S]*?<\/div>\s*([^<][\s\S]*?)\s*<\/div>\s*<\/td>/i);
    const desc = descBlock ? decodeHtml(descBlock[1]).replace(title, '').trim() : '';

    programmes.push({
      start,
      stop,
      title,
      desc: desc || subtitle,
      category: ''
    });
  }
  programmes.sort((a, b) => a.start - b.start);
  return programmes;
}

function addChannelToIndex(index, slug, displayName, programmes) {
  const id = gatotvXmltvId(slug);
  index.channelsById.set(id, {
    id,
    displayNames: [displayName, `Canal ${displayName}`]
  });
  index.programmesByChannel.set(id, programmes);
  for (const raw of [displayName, slug.replace(/_/g, ' ')]) {
    const key = normalizeName(raw);
    if (key && !index.nameToChannelId.has(key)) index.nameToChannelId.set(key, id);
  }
  return id;
}

async function fetchSlugProgrammes(slug, dateStr) {
  const url = `${GATOTV_BASE}/${slug}`;
  const html = await fetchUrl(url);
  const pageDate = extractPageDate(html) || dateStr;
  const title = extractChannelTitle(html, slug);
  const programmes = parseProgrammeRows(html, slug, pageDate);
  return { slug, title, pageDate, programmes };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (err) {
        results[idx] = { error: err.message || String(err) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function uniqueSlugs(channelNames = []) {
  const slugs = new Set(Object.values(GATOTV_SLUGS));
  for (const name of channelNames) {
    const slug = gatotvSlugForChannel(name);
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

async function refreshGatotvEpg({ force = false, channelNames = [] } = {}) {
  if (!force && cache.fetchedAt && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return getGatotvIndex();
  }
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const dateStr = ecuadorToday();
    const slugs = uniqueSlugs(channelNames);
    const index = {
      channelsById: new Map(),
      programmesByChannel: new Map(),
      nameToChannelId: new Map()
    };
    const errors = [];

    const results = await mapWithConcurrency(slugs, FETCH_CONCURRENCY, async (slug) => {
      const data = await fetchSlugProgrammes(slug, dateStr);
      if (!data.programmes.length) return { slug, skipped: true };
      addChannelToIndex(index, data.slug, data.title, data.programmes);
      return { slug, count: data.programmes.length };
    });

    for (const r of results) {
      if (r?.error) errors.push(`${r.slug || '?'}: ${r.error}`);
    }

    cache = {
      fetchedAt: Date.now(),
      date: dateStr,
      error: errors[0] || '',
      ...index
    };
    return getGatotvIndex();
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function getGatotvIndex() {
  return {
    source: 'gatotv',
    date: cache.date,
    fetchedAt: cache.fetchedAt,
    error: cache.error || '',
    channelsById: cache.channelsById,
    programmesByChannel: cache.programmesByChannel,
    nameToChannelId: cache.nameToChannelId
  };
}

function programmesCoverToday(programmes) {
  if (!programmes?.length) return false;
  const today = ecuadorToday();
  return programmes.some((p) => {
    const d = p.start.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
    return d === today;
  });
}

module.exports = {
  refreshGatotvEpg,
  getGatotvIndex,
  gatotvSlugForChannel,
  gatotvXmltvId,
  programmesCoverToday,
  uniqueSlugs
};
