#!/usr/bin/env node
/**
 * Descarga guías XMLTV a data/epg/ desde iptv-epg.org y mirrors.
 * Fuentes: https://iptv-epg.org/guides · https://www.open-epg.com/
 * Ejecutar: node server/scripts/refresh-epg-cache.js
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', '..', 'data', 'epg');

const FEEDS = [
  { url: 'https://iptv-epg.org/files/epg-ec.xml', out: 'epg-ec-iptv.xml' },
  { url: 'https://iptv-epg.org/files/epg-es.xml', out: 'epg-es-iptv.xml' },
  { url: 'https://iptv-epg.org/files/epg-mx.xml', out: 'epg-mx-iptv.xml' },
  { url: 'https://www.open-epg.com/files/ecuador1.xml.gz', out: 'epg-ec.xml.gz' },
  { url: 'https://raw.githubusercontent.com/globetvapp/epg/main/Ecuador/ecuador1.xml.gz', out: 'epg-ec-globe.xml.gz' },
  { url: 'https://www.open-epg.com/files/spain1.xml.gz', out: 'epg-es.xml.gz' },
  { url: 'https://www.open-epg.com/files/spain2.xml.gz', out: 'epg-es2.xml.gz' },
  { url: 'https://www.open-epg.com/files/mexico1.xml.gz', out: 'epg-mx.xml.gz' }
];

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      timeout: 180000,
      headers: { 'User-Agent': 'VixTV-EPG-Cache/1.0', Accept: '*/*' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) {
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
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const feed of FEEDS) {
    const dest = path.join(OUT_DIR, feed.out);
    try {
      const buf = await fetchUrl(feed.url);
      if (buf.length < 500 && buf.toString('utf8').includes('download limit')) {
        console.warn(`[skip] ${feed.out}: límite de descarga`);
        continue;
      }
      const head = buf.toString('utf8', 0, 200);
      const isGz = buf[0] === 0x1f && buf[1] === 0x8b;
      if (!isGz && !/<\?xml/i.test(head) && !/<tv\b/i.test(head)) {
        console.warn(`[skip] ${feed.out}: no parece XML (${buf.length} bytes)`);
        continue;
      }
      fs.writeFileSync(dest, buf);
      console.log(`[ok] ${feed.out} (${buf.length} bytes)`);
    } catch (err) {
      console.warn(`[fail] ${feed.out}: ${err.message}`);
    }
  }

  const epg = require('../services/epgService');
  const status = await epg.refreshEpg({ force: true });
  const data = await epg.getLiveEpgMap({ force: false });
  console.log('EPG cache:', status.source, 'feeds:', (status.urls || []).length);
  console.log('Canales con guía:', data.channels_matched, '/', data.channels_total);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
