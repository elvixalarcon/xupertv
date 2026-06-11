const https = require('https');
const http = require('http');

function fetchJson(url) {
  return new Promise((res, rej) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { rejectUnauthorized: false, timeout: 30000 }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        try { res(JSON.parse(d)); }
        catch (e) { rej(new Error(d.slice(0, 300))); }
      });
    }).on('error', rej);
  });
}

(async () => {
  const base = process.argv[2] || 'https://tv.vixred.com';
  const user = process.argv[3] || 'vixtv';
  const pass = process.argv[4] || 'vixtev';
  const streams = await fetchJson(`${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&action=get_live_streams`);
  console.log('streams count', Array.isArray(streams) ? streams.length : typeof streams);
  if (Array.isArray(streams) && streams[0]) {
    console.log('sample keys', Object.keys(streams[0]).join(','));
    console.log('sample', JSON.stringify(streams[0], null, 2).slice(0, 800));
  } else {
    console.log('raw', JSON.stringify(streams).slice(0, 300));
  }
  const cats = await fetchJson(`${base}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&action=get_live_categories`);
  console.log('cats count', Array.isArray(cats) ? cats.length : typeof cats);
  if (Array.isArray(cats) && cats[0]) console.log('cat sample', cats[0]);
})().catch((e) => { console.error(e); process.exit(1); });
