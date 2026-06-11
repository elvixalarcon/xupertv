const https = require('https');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data', 'xupertv.db'));

function classifyEntry(name) {
  const ep = name.match(/^(.+?)\s+S(\d+)E(\d+)\s*$/i);
  if (ep) return { type: 'episode', seriesTitle: ep[1].trim(), season: +ep[2], episode: +ep[3] };
  const movie = name.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (movie) return { type: 'movie', title: movie[1].trim(), year: +movie[2] };
  return { type: 'live' };
}

function liveCategory(name) {
  const n = name.toLowerCase();
  if (/sport|fútbol|futbol/.test(n)) return 'Deportes';
  if (/novelas|telemundo|estrellas|turcas/.test(n)) return 'Novelas';
  if (/cnn|\bdw\b|rt en/.test(n)) return 'Noticias';
  if (/cinemax|\bamc\b|space|golden|\bsony\b|peliculas 24|freetv/.test(n)) return 'Cine en Vivo';
  if (/ecuavisa|ecuador|gamavision|teleamazonas|canal uno|telerama|asoma|oroma|puruwa|\btvc\b|\btc\b|vixred|canal 5/.test(n)) return 'Ecuador';
  return 'Internacional';
}

const M3U = 'https://tv.vixred.com/playlist/vixtv/vixtev/m3u?output=hls';
const playlistId = 4;

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false, headers: { 'User-Agent': 'VixTV' } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

fetch(M3U).then((content) => {
  const lines = content.split(/\r?\n/);
  const items = [];
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#EXTINF:')) cur = { name: t.replace(/^#EXTINF:[^,]*,/, '').trim(), logo: '', stream_url: '' };
    else if (t && !t.startsWith('#') && cur) { cur.stream_url = t; items.push(cur); cur = null; }
  }

  db.prepare("DELETE FROM movies WHERE genre = 'VixRED'").run();
  db.prepare("DELETE FROM series WHERE genre = 'VixRED'").run();
  db.prepare('DELETE FROM live_channels WHERE playlist_id = ?').run(playlistId);

  const liveIns = db.prepare('INSERT INTO live_channels (playlist_id,name,logo,stream_url,group_title) VALUES (?,?,?,?,?)');
  const movieIns = db.prepare("INSERT INTO movies (title,description,poster,video_path,genre,year,recommended) VALUES (?,'','',?,'VixRED',?,0)");
  const seriesIns = db.prepare("INSERT INTO series (title,description,poster,genre) VALUES (?,'','','VixRED')");
  const epIns = db.prepare("INSERT INTO episodes (series_id,season,episode,title,description,poster,video_path) VALUES (?,?,?,?,'','',?)");

  const sm = new Map();
  let live = 0, movies = 0, eps = 0;

  for (const item of items) {
    const k = classifyEntry(item.name);
    if (k.type === 'movie') {
      movieIns.run(k.title, item.stream_url, k.year);
      movies++;
    } else if (k.type === 'episode') {
      if (!sm.has(k.seriesTitle)) {
        const r = seriesIns.run(k.seriesTitle);
        sm.set(k.seriesTitle, r.lastInsertRowid);
      }
      epIns.run(sm.get(k.seriesTitle), k.season, k.episode, `Ep ${k.episode}`, item.stream_url);
      eps++;
    } else {
      liveIns.run(playlistId, item.name, item.logo, item.stream_url, liveCategory(item.name));
      live++;
    }
  }

  console.log(JSON.stringify({ live, movies, series: sm.size, episodes: eps }, null, 2));
}).catch((e) => { console.error(e); process.exit(1); });
