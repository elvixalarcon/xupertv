const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Dominios informativos / legales — no enlaces de reproducción directa. */
const BLOCKED_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'pinterest.com', 'reddit.com', 'wikipedia.org',
  'amazon.com', 'amazon.es', 'primevideo.com', 'netflix.com',
  'disneyplus.com', 'hbomax.com', 'max.com', 'apple.com', 'tv.apple.com',
  'justwatch.com', 'moviefone.com', 'allmovie.com', 'filmelier.com', 'filmin.es',
  'sensacine.com', 'cine.com', 'imdb.com', 'rottentomatoes.com', 'metacritic.com',
  'themoviedb.org', 'google.com', 'google.es', 'bing.com', 'duckduckgo.com',
  'mojeek.com', 'youtube.com', 'datastudio.google.com', 'play.google.com',
  'linkedin.com', 'graphy.com'
]);

const STREAMING_HINTS = [
  'cuevana', 'allcalidad', 'pelisplus', 'pelisflix', 'pelispedia', 'cinecalidad',
  'gnula', 'repelis', 'hackstore', 'doramasflix', 'animeflv', 'seriesflix',
  'divxtotal', 'maxcine', 'peliculaspro', 'peelink', 'bajalogratis', 'genteclic',
  'verpeliculas', 'peliculasonline', 'goodstream', 'voe.sx', 'vimeos', 'embed',
  'ver-online', 'ver_online', 'pelicula', 'serie', 'temporada', 'capitulo',
  'watch', 'online', 'latino', 'castellano', 'gratis', 'completa'
];

function fetchText(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'es-ES,es;q=0.9' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchText(next, timeoutMs).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

function decodeDdgHref(href) {
  if (!href) return '';
  if (href.startsWith('//')) href = `https:${href}`;
  try {
    const u = new URL(href);
    const raw = u.searchParams.get('uddg');
    return raw ? decodeURIComponent(raw) : href;
  } catch {
    return href;
  }
}

function parseDdgResults(html) {
  const out = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const url = decodeDdgHref(m[1]);
    if (url && url.startsWith('http')) out.push({ title, url });
  }
  return out;
}

function parseMojeekResults(html) {
  const out = [];
  const re = /<a[^>]+class="[^"]*title[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let title = m[2].replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
    let url = m[1].replace(/&amp;/g, '&');
    if (!url.startsWith('http')) continue;
    if (url.includes('mojeek.com')) continue;
    out.push({ title, url });
  }
  return out;
}

function hostAllowed(hostname) {
  const host = String(hostname || '').replace(/^www\./, '').toLowerCase();
  if (!host) return false;
  for (const blocked of BLOCKED_HOSTS) {
    if (host === blocked || host.endsWith(`.${blocked}`)) return false;
  }
  return true;
}

function scoreResult(item) {
  const blob = `${item.url} ${item.title}`.toLowerCase();
  let score = 0;
  for (const hint of STREAMING_HINTS) {
    if (blob.includes(hint)) score += 4;
  }
  if (/pel[ií]cula|serie|ver online|watch online|latino|espa[nñ]ol|gratis|completa/i.test(blob)) {
    score += 3;
  }
  if (/cinecalidad|pelisplus|cuevana|allcalidad|repelis|gnula|hackstore|maxcine|peliculaspro/i.test(blob)) {
    score += 8;
  }
  return score;
}

function guessTypeFromUrl(url, title) {
  const blob = `${url} ${title}`.toLowerCase();
  if (/tvshows?|\/serie|\/series|temporada|capitulo|episode|\/show\//i.test(blob)) return 'series';
  return 'movie';
}

function sourceLabelFromHost(hostname) {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  if (host.includes('cuevana')) return 'cuevana';
  if (host.includes('allcalidad')) return 'allcalidad';
  if (host.includes('cinecalidad')) return 'cinecalidad';
  if (host.includes('pelisplus')) return 'pelisplus';
  if (host.includes('repelis')) return 'repelis';
  if (host.includes('gnula')) return 'gnula';
  const parts = host.split('.');
  if (parts.length >= 2) return parts[parts.length - 2];
  return host;
}

function webQueries(query) {
  const q = String(query || '').trim();
  const yearMatch = q.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : '';
  const title = q.replace(/\b(19|20)\d{2}\b/g, '').trim();
  return [
    `${q} película ver online español latino`,
    `${title} ${year} ver online gratis completa`.trim(),
    `${title} pelicula online latino hd`.trim(),
    `${q} cinecalidad pelisplus repelis cuevana`.trim()
  ].filter((s, i, arr) => s && arr.indexOf(s) === i);
}

async function searchDuckDuckGo(query) {
  const body = `q=${encodeURIComponent(query)}`;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'html.duckduckgo.com',
      path: '/html/',
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'text/html'
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function searchMojeek(query) {
  const url = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  return parseMojeekResults(html);
}

function mergeWebRows(merged, rows, query) {
  const { isRelevantVodResult } = require('./vodResultFilter');
  for (const row of rows) {
    let parsed;
    try { parsed = new URL(row.url); } catch { continue; }
    if (!hostAllowed(parsed.hostname)) continue;
    const item = {
      type: guessTypeFromUrl(row.url, row.title),
      source: 'web',
      source_site: sourceLabelFromHost(parsed.hostname),
      slug: '',
      title: row.title,
      year: parseInt(query.match(/\b(19|20)\d{2}\b/)?.[0] || '0', 10) || null,
      poster: '',
      url: row.url,
      overview: `Internet · ${parsed.hostname}`,
      score: scoreResult(row)
    };
    if (!isRelevantVodResult(item, query)) continue;
    const key = parsed.origin + parsed.pathname;
    if (merged.has(key)) continue;
    merged.set(key, item);
  }
}

/**
 * Busca en internet (Mojeek + DuckDuckGo si responde).
 */
async function searchInternet(query, limit = 20) {
  const queries = webQueries(query);
  const merged = new Map();

  for (const q of queries) {
    try {
      const mojeekRows = await searchMojeek(q);
      mergeWebRows(merged, mojeekRows, query);
      if (merged.size >= limit) break;

      try {
        const ddgHtml = await searchDuckDuckGo(q);
        if (!/anomaly\.js|botnet/i.test(ddgHtml) || /result__a/i.test(ddgHtml)) {
          mergeWebRows(merged, parseDdgResults(ddgHtml), query);
        }
      } catch { /* DDG opcional */ }

      if (merged.size >= limit) break;
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      console.warn('[vodWebSearch]', q, err.message);
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...rest }) => rest);
}

module.exports = {
  searchInternet,
  webQueries,
  hostAllowed,
  sourceLabelFromHost
};
