const db = require('../db');
const { syncMovieFromTmdb, syncSeriesFromTmdb } = require('./tmdbMetadata');
const { ensureCategory } = require('./categories');
const { serializeConfig, DEFAULT_CONFIG } = require('./channelConfig');

function resolveUrl(base, relative) {
  if (!relative) return '';
  if (/^https?:\/\//i.test(relative)) return relative;
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function extractAttr(line, attr) {
  const dq = line.match(new RegExp(`${attr}="([^"]*)"`, 'i'));
  if (dq) return dq[1].trim();
  const sq = line.match(new RegExp(`${attr}='([^']*)'`, 'i'));
  if (sq) return sq[1].trim();
  return '';
}

function extractChannelName(extinfLine) {
  const tvgName = extractAttr(extinfLine, 'tvg-name');
  if (tvgName) return tvgName;

  const afterComma = extinfLine.replace(/^#EXTINF:[^,]*,/, '').trim();
  if (afterComma && !/^[\d.]+$/.test(afterComma)) return afterComma;

  return '';
}

function isHlsPlaylist(content) {
  return /#EXT-X-(VERSION|TARGETDURATION|MEDIA-SEQUENCE|STREAM-INF|MEDIA)/i.test(content);
}

function isIptvChannelList(content) {
  if (/tvg-id=|tvg-logo=|tvg-name=|group-title=/i.test(content)) return true;
  if (/#EXTGRP:/i.test(content)) return true;
  const lines = content.match(/#EXTINF:[^\n]*/gi) || [];
  return lines.some((line) => {
    const name = extractChannelName(line);
    return name && name !== 'Canal' && !/^[\d.]+$/.test(name);
  });
}

function parseM3U(content, sourceUrl, defaultName = 'Canal en vivo') {
  if (isHlsPlaylist(content) && !isIptvChannelList(content)) {
    return [{
      name: defaultName,
      logo: '',
      group_title: defaultName || 'En Vivo',
      stream_url: sourceUrl
    }];
  }

  const lines = content.split(/\r?\n/);
  const channels = [];
  const seen = new Set();
  let current = null;
  let pendingGroup = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#EXTGRP:')) {
      pendingGroup = trimmed.replace('#EXTGRP:', '').trim();
      continue;
    }

    if (trimmed.startsWith('#EXTINF:')) {
      const name = extractChannelName(trimmed) || defaultName;
      const group = extractAttr(trimmed, 'group-title') || pendingGroup || 'General';
      current = {
        name,
        logo: extractAttr(trimmed, 'tvg-logo'),
        epg_id: extractAttr(trimmed, 'tvg-id'),
        tvg_country: extractAttr(trimmed, 'tvg-country'),
        group_title: group,
        stream_url: ''
      };
      pendingGroup = '';
    } else if (!trimmed.startsWith('#') && current) {
      const url = resolveUrl(sourceUrl, trimmed);
      if (/\.ts(\?|$)/i.test(url.split('?')[0]) && !/\.m3u8/i.test(url)) {
        current = null;
        continue;
      }
      current.stream_url = url;
      const key = current.stream_url.toLowerCase();
      if (!seen.has(key) && current.name) {
        seen.add(key);
        channels.push(current);
      }
      current = null;
    }
  }

  return channels;
}

function classifyEntry(name) {
  const ep = name.match(/^(.+?)\s+S(\d+)E(\d+)\s*$/i);
  if (ep) {
    return {
      type: 'episode',
      seriesTitle: ep[1].trim(),
      season: parseInt(ep[2], 10),
      episode: parseInt(ep[3], 10)
    };
  }
  const movie = name.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (movie) {
    return { type: 'movie', title: movie[1].trim(), year: parseInt(movie[2], 10) };
  }
  return { type: 'live' };
}

function liveCategory(name) {
  const n = name.toLowerCase();
  if (/sport|fútbol|futbol|ecdf/.test(n)) return 'Deportes';
  if (/novelas|telemundo|estrellas|turcas/.test(n)) return 'Novelas';
  if (/cnn|\bdw\b|rt en|noticias/.test(n)) return 'Noticias';
  if (/cinemax|\bamc\b|space|golden|\bsony\b|peliculas 24|freetv|cine/.test(n)) return 'Películas';
  if (/ecuavisa|ecuador|gamavision|teleamazonas|canal uno|telerama|asoma|oroma|puruwa|\btvc\b|\btc\b|vixred|canal 5/.test(n)) return 'Ecuador';
  return 'Internacional';
}

function clearVixredVod() {
  db.prepare("DELETE FROM movies WHERE genre = 'VixRED'").run();
  db.prepare("DELETE FROM series WHERE genre = 'VixRED'").run();
}

async function importSplitPlaylist(playlistId, playlistName, items, singleMode = false) {
  if (singleMode || items.length === 1) {
    db.prepare('DELETE FROM live_channels WHERE playlist_id = ?').run(playlistId);
    const insert = db.prepare(`
      INSERT INTO live_channels (playlist_id, name, logo, stream_url, group_title)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const ch of items) {
      insert.run(playlistId, ch.name, ch.logo, ch.stream_url, ch.group_title || playlistName);
      ensureCategory(ch.group_title || playlistName, 'live');
    }
    return { live: items.length, movies: 0, series: 0, episodes: 0 };
  }

  clearVixredVod();
  db.prepare('DELETE FROM live_channels WHERE playlist_id = ?').run(playlistId);

  const liveIns = db.prepare(`
    INSERT INTO live_channels (playlist_id, name, logo, stream_url, group_title)
    VALUES (?, ?, ?, ?, ?)
  `);
  const movieIns = db.prepare(`
    INSERT INTO movies (title, description, poster, video_path, genre, year, recommended)
    VALUES (?, '', ?, ?, 'VixRED', ?, 0)
  `);
  const seriesIns = db.prepare(`
    INSERT INTO series (title, description, poster, genre) VALUES (?, '', ?, 'VixRED')
  `);
  const epIns = db.prepare(`
    INSERT INTO episodes (series_id, season, episode, title, description, poster, video_path)
    VALUES (?, ?, ?, ?, '', ?, ?)
  `);

  const seriesMap = new Map();
  const movieIds = [];
  const seriesIds = [];
  let live = 0;
  let movies = 0;
  let episodes = 0;

  const run = db.transaction(() => {
    for (const item of items) {
      const kind = classifyEntry(item.name);
      if (kind.type === 'movie') {
        const r = movieIns.run(kind.title, '', item.stream_url, kind.year);
        movieIds.push(r.lastInsertRowid);
        movies++;
      } else if (kind.type === 'episode') {
        if (!seriesMap.has(kind.seriesTitle)) {
          const r = seriesIns.run(kind.seriesTitle, '');
          const sid = r.lastInsertRowid;
          seriesMap.set(kind.seriesTitle, sid);
          seriesIds.push(sid);
        }
        epIns.run(
          seriesMap.get(kind.seriesTitle),
          kind.season,
          kind.episode,
          '',
          '',
          item.stream_url
        );
        episodes++;
      } else {
        liveIns.run(playlistId, item.name, item.logo, item.stream_url, liveCategory(item.name));
        live++;
      }
    }
  });
  run();
  if (movies > 0) ensureCategory('VixRED', 'movie');
  if (seriesMap.size > 0) ensureCategory('VixRED', 'series');

  for (const id of movieIds) {
    try {
      await syncMovieFromTmdb(id);
    } catch (err) {
      console.warn(`[playlistImport] TMDB película ${id}:`, err.message);
    }
  }
  for (const id of seriesIds) {
    try {
      await syncSeriesFromTmdb(id);
    } catch (err) {
      console.warn(`[playlistImport] TMDB serie ${id}:`, err.message);
    }
  }

  return { live, movies, series: seriesMap.size, episodes };
}

function filterLiveM3uItems(items) {
  return items.filter((item) => {
    const url = String(item.stream_url || '').toLowerCase();
    if (/\/movie\//.test(url) || /\/series\//.test(url)) return false;
    return classifyEntry(item.name).type === 'live';
  });
}

function configWithEpgId(epgId) {
  if (!epgId) return null;
  const config = mergeConfigForImport({ ...DEFAULT_CONFIG });
  config.epg = { ...config.epg, epg_id: epgId };
  return serializeConfig(config);
}

function mergeConfigForImport(patch) {
  const out = { ...DEFAULT_CONFIG, ...patch };
  out.advanced = { ...DEFAULT_CONFIG.advanced, ...(patch.advanced || {}) };
  out.map = { ...DEFAULT_CONFIG.map, ...(patch.map || {}) };
  out.epg = { ...DEFAULT_CONFIG.epg, ...(patch.epg || {}) };
  out.rtmp = { ...DEFAULT_CONFIG.rtmp, ...(patch.rtmp || {}) };
  out.servers = { ...DEFAULT_CONFIG.servers, ...(patch.servers || {}) };
  if (Array.isArray(patch.sources)) out.sources = patch.sources;
  return out;
}

function importLiveChannelsOnly(playlistId, playlistName, items) {
  const liveItems = filterLiveM3uItems(items);
  db.prepare('DELETE FROM live_channels WHERE playlist_id = ?').run(playlistId);

  const liveIns = db.prepare(`
    INSERT INTO live_channels (playlist_id, name, logo, stream_url, group_title, config)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let live = 0;
  const run = db.transaction(() => {
    for (const item of liveItems) {
      const group = item.group_title && item.group_title !== 'General'
        ? item.group_title
        : liveCategory(item.name);
      liveIns.run(
        playlistId,
        item.name,
        item.logo || '',
        item.stream_url,
        group,
        configWithEpgId(item.epg_id)
      );
      ensureCategory(group, 'live');
      live++;
    }
  });
  run();

  return { live, movies: 0, series: 0, episodes: 0, skipped: items.length - liveItems.length };
}

module.exports = {
  resolveUrl,
  parseM3U,
  classifyEntry,
  liveCategory,
  filterLiveM3uItems,
  importSplitPlaylist,
  importLiveChannelsOnly
};
