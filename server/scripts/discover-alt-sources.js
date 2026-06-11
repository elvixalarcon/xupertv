#!/usr/bin/env node
const pool = require('../services/streamProxyPool');
const { probeHlsManifest } = require('../services/streamAudio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const PAGES = {
  AMC: [
    'https://www.tvporinternet2.com/amc-en-vivo-por-internet.php',
    'https://www.tvenvivo2.com/amc-en-vivo-por-internet.php',
    'https://teleonline.org/canal/amc-latin-america/',
    'https://tvlibreonline.com/amc/',
    'https://tvlibreonline.com/canal/amc/'
  ],
  AXN: [
    'https://www.tvporinternet2.com/axn-en-vivo-por-internet.php',
    'https://teleonline.org/canal/axn-latin-america/',
    'https://tvlibreonline.com/axn/'
  ],
  'Sony Channel': [
    'https://www.tvporinternet2.com/canal-sony-en-vivo-por-internet.php',
    'https://teleonline.org/canal/sony-channel-latin-america/',
    'https://tvlibreonline.com/sony/'
  ],
  'Star Channel': [
    'https://www.tvporinternet2.com/star-channel-en-vivo-por-internet.php',
    'https://teleonline.org/canal/star-channel-latin-america/',
    'https://tvlibreonline.com/star-channel/'
  ],
  FX: [
    'https://www.tvporinternet2.com/fx-en-vivo-por-internet.php',
    'https://teleonline.org/canal/fx-latin-america/',
    'https://tvlibreonline.com/fx/'
  ],
  Cinemax: [
    'https://www.tvporinternet2.com/cinemax-en-vivo-por-internet.php',
    'https://teleonline.org/canal/cinemax-latin-america/',
    'https://tvlibreonline.com/cinemax/'
  ],
  Universal: [
    'https://www.tvporinternet2.com/universal-channel-en-vivo-por-internet.php',
    'https://teleonline.org/canal/universal-channel-latin-america/',
    'https://tvlibreonline.com/universal/'
  ],
  'Studio Universal': [
    'https://www.tvporinternet2.com/studio-universal-en-vivo-por-internet.php',
    'https://teleonline.org/canal/studio-universal-latin-america/',
    'https://tvlibreonline.com/studio-universal/'
  ]
};

const STREAM_HOSTS = [
  'https://regionales.saohgdasregions.fun',
  'https://saohgdasregions.fun',
  'https://nacionales.saohgdasregions.fun',
  'https://internacionales.saohgdasregions.fun'
];

const CANAL_ALIASES = {
  AMC: ['amc', 'amclatin', 'amchd'],
  AXN: ['axn', 'axnhd'],
  'Sony Channel': ['canalsony', 'sony', 'sonychannel'],
  'Star Channel': ['starchannel', 'starchannelhd', 'fox'],
  FX: ['fx', 'fxhd'],
  Cinemax: ['cinemax', 'cinemaxhd'],
  Universal: ['universalchannel', 'universal', 'universalhd'],
  'Studio Universal': ['studiouniversal', 'studiouniversalhd']
};

function extractFromHtml(body, pageUrl) {
  const out = { iframes: [], m3u8: [], streamPhp: [], hosts: new Set() };
  const text = String(body || '');

  for (const m of text.matchAll(/iframe[^>]+src=["']([^"']+)["']/gi)) {
    out.iframes.push(m[1].replace(/&amp;/g, '&'));
  }
  for (const m of text.matchAll(/https?:\\?\/\\?\/[^"'\\<> ]+/g)) {
    const u = m[0].replace(/\\\//g, '/');
    if (/\.m3u8/i.test(u)) out.m3u8.push(u);
    if (/stream\.php/i.test(u)) out.streamPhp.push(u);
    if (/saohgdas|mdstrm|claro\.net|dmcdn|dai\.google|frequency\.stream/i.test(u)) out.hosts.add(u);
  }
  for (const m of text.matchAll(/https?:\/\/[^"'\\<> ]+/g)) {
    const u = m[0];
    if (/\.m3u8/i.test(u)) out.m3u8.push(u);
    if (/stream\.php/i.test(u)) out.streamPhp.push(u);
    if (/saohgdas|mdstrm|claro\.net|dmcdn|dai\.google|frequency\.stream/i.test(u)) out.hosts.add(u);
  }
  const srcVar = text.match(/var\s+src\s*=\s*"([^"]+)"/i);
  if (srcVar) out.m3u8.push(srcVar[1].replace(/\\\//g, '/'));

  out.m3u8 = [...new Set(out.m3u8)];
  out.streamPhp = [...new Set(out.streamPhp)];
  out.hosts = [...out.hosts];
  return out;
}

function extractM3u8(body) {
  const fromVar = body.match(/var\s+src\s*=\s*"([^"]+)"/i);
  if (fromVar) return fromVar[1].replace(/\\\//g, '/');
  for (const match of body.matchAll(/https:\\\\\/\\\\\/[^"'\\]+?\.m3u8[^"'\\]*/g)) {
    return match[0].replace(/\\\//g, '/');
  }
  for (const match of body.matchAll(/https:\/\/[^"'\\<> ]+?\.m3u8[^"'\\<> ]*/g)) {
    return match[0];
  }
  return '';
}

async function probeStreamPhp(url, referer) {
  try {
    const page = await pool.fetchText(url, { headers: { Referer: referer, 'User-Agent': UA } });
    const m3u8 = extractM3u8(page.body || '');
    if (!m3u8) return { ok: false, error: 'sin m3u8' };
    const audio = await probeHlsManifest(m3u8, { Referer: page.url || referer, 'User-Agent': UA });
    return { ok: audio.ok, m3u8, error: audio.error || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function probeM3u8(url, referer) {
  try {
    const audio = await probeHlsManifest(url, { Referer: referer, 'User-Agent': UA });
    return { ok: audio.ok, m3u8: url, error: audio.error || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  const results = {};

  for (const [channel, pages] of Object.entries(PAGES)) {
    results[channel] = { hits: [], tried: [] };
    const aliases = CANAL_ALIASES[channel] || [];

    for (const pageUrl of pages) {
      try {
        const page = await pool.fetchText(pageUrl, {
          headers: { Referer: pageUrl, 'User-Agent': UA },
          timeout: 25000
        });
        const ex = extractFromHtml(page.body, pageUrl);
        results[channel].tried.push({ page: pageUrl, status: page.status, iframes: ex.iframes.length, m3u8: ex.m3u8.length });

        for (const m3u8 of ex.m3u8.slice(0, 5)) {
          const probe = await probeM3u8(m3u8, pageUrl);
          if (probe.ok) {
            results[channel].hits.push({ type: 'm3u8', source: pageUrl, url: m3u8 });
          }
        }

        for (const sp of ex.streamPhp.slice(0, 3)) {
          const probe = await probeStreamPhp(sp, pageUrl);
          if (probe.ok) {
            results[channel].hits.push({ type: 'stream.php', source: pageUrl, url: probe.m3u8, resolver: sp });
          }
        }

        for (const iframe of ex.iframes.slice(0, 2)) {
          try {
            const inner = await pool.fetchText(iframe, {
              headers: { Referer: pageUrl, 'User-Agent': UA },
              timeout: 20000
            });
            const m3u8 = extractM3u8(inner.body || '');
            if (m3u8) {
              const probe = await probeM3u8(m3u8, iframe);
              if (probe.ok) {
                results[channel].hits.push({ type: 'iframe', source: pageUrl, iframe, url: m3u8 });
              }
            }
          } catch { /* ignore */ }
        }
      } catch (err) {
        results[channel].tried.push({ page: pageUrl, error: err.message });
      }
    }

    for (const host of STREAM_HOSTS) {
      for (const canal of aliases) {
        for (const target of [4, 5, 1, 2]) {
          const resolver = `${host}/stream.php?canal=${encodeURIComponent(canal)}&target=${target}`;
          const probe = await probeStreamPhp(resolver, pages[0] || 'https://www.tvporinternet2.com/');
          if (probe.ok) {
            results[channel].hits.push({ type: 'bruteforce', resolver, url: probe.m3u8, canal, target, host });
          }
        }
      }
    }

    results[channel].hits = results[channel].hits.filter((h, i, arr) =>
      arr.findIndex((x) => x.url === h.url) === i
    );
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
