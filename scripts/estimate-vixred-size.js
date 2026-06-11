const https = require('https');
const path = require('path');
const db = require(path.join(__dirname, '..', 'server', 'db'));

const movies = db.prepare("SELECT id, title, video_path FROM movies WHERE video_path LIKE 'http%'").all();
const eps = db.prepare(`
  SELECT e.id, e.season, e.episode, e.video_path, s.title AS series
  FROM episodes e JOIN series s ON s.id = e.series_id
  WHERE e.video_path LIKE 'http%'
`).all();

function headSize(url) {
  return new Promise((resolve) => {
    const get = (u) => {
      const req = https.get(u, {
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://tv.vixred.com/' }
      }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume();
          const next = r.headers.location.startsWith('http')
            ? r.headers.location
            : new URL(r.headers.location, u).href;
          return get(next);
        }
        const n = +(r.headers['content-length'] || 0);
        r.resume();
        resolve(n);
      });
      req.on('error', () => resolve(0));
    };
    get(url);
  });
}

(async () => {
  let total = 0;
  for (const m of movies) {
    const n = await headSize(m.video_path);
    total += n;
    console.log('M', m.id, (n / 1e9).toFixed(2) + 'GB', m.title);
  }
  for (const e of eps) {
    const n = await headSize(e.video_path);
    total += n;
    console.log('E', e.id, (n / 1e9).toFixed(2) + 'GB', e.series, `S${e.season}E${e.episode}`);
  }
  console.log('TOTAL_GB', (total / 1e9).toFixed(2));
})();
