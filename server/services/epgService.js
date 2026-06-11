const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { getSetting, setSetting } = require('./settings');
const { configFromChannel, serializeConfig } = require('./channelConfig');

const CACHE_TTL_MS = 30 * 60 * 1000;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const PUBLIC_EPG_BASE = 'https://iptv-epg.org/files/epg';
const LOCAL_EPG_DIR = path.join(__dirname, '..', '..', 'data', 'epg');

/** Fuentes por país: primaria iptv-epg.org (https://iptv-epg.org/guides), respaldo open-epg */
const PUBLIC_EPG_FEEDS = {
  ec: [
    `${PUBLIC_EPG_BASE}-ec.xml`,
    'https://www.open-epg.com/files/ecuador1.xml.gz',
    'https://raw.githubusercontent.com/globetvapp/epg/main/Ecuador/ecuador1.xml.gz'
  ],
  es: [
    `${PUBLIC_EPG_BASE}-es.xml`,
    'https://www.open-epg.com/files/spain1.xml.gz',
    'https://www.open-epg.com/files/spain2.xml.gz'
  ],
  mx: [
    `${PUBLIC_EPG_BASE}-mx.xml`,
    'https://www.open-epg.com/files/mexico1.xml.gz'
  ]
};

/** Mapa nombre normalizado → id XMLTV (iptv-epg.org y open-epg) */
const CHANNEL_EPG_ALIASES = {
  ecuavisa: 'Canal Ecuavisa (Ecuador).ec',
  ecuavisaguayaquil: 'Canal Ecuavisa (Ecuador).ec',
  ecuavisaquito: 'Canal Ecuavisa (Ecuador).ec',
  teleamazonas: 'Teleamazonas.ec',
  amc: 'Canal AMC (Ecuador).ec',
  rts: 'RTS.ec',
  redtelesistema: 'RTS.ec',
  ecuadortv: 'Canal Ecuador TV.ec',
  ecuador: 'Canal Ecuador TV.ec',
  dwenespaol: 'DeutscheWelle.es',
  dw: 'DeutscheWelle.es',
  deutschewelle: 'DeutscheWelle.es',
  cnninternacional: 'CNNInternational.ec',
  cnnespanol: 'CNNInternational.ec',
  telemundo: 'Canal Telemundo (Ecuador).ec',
  golden: 'Canal Golden (Ecuador).ec',
  space: 'Canal Space (Ecuador).ec',
  sonych: 'Canal Sony (Ecuador).ec',
  sonytv: 'Canal Sony (Ecuador).ec',
  hboespanol: 'Canal HBO (Ecuador).ec',
  espn: 'Canal ESPN (Ecuador).ec',
  foxsports: 'Canal Fox Sports (Ecuador).ec',
  tnt: 'Canal TNT (Ecuador).ec',
  warner: 'Canal Warner TV (Ecuador).ec',
  discovery: 'Canal Discovery Channel (Ecuador).ec',
  history: 'Canal History (Ecuador).ec',
  nick: 'Canal Nickelodeon (Ecuador).ec',
  cartoonnetwork: 'Canal Cartoon Network (Ecuador).ec',
  disney: 'Canal Disney Channel (Ecuador).ec',
  star: 'Canal Star Channel (Ecuador).ec',
  univision: 'Canal Univision (Ecuador).ec',
  canaluno: 'Canal Uno (Ecuador).ec',
  tycsports: 'TyCSports.ec',
  directvsports: 'DIRECTVSports.ec',
  gamavision: 'Gamavision.ec',
  manavision: 'Manavision.ec',
  asomavision: 'Asomavision.ec',
  oromartv: 'OromarTV.ec',
  oromar: 'OromarTV.ec',
  telerama: 'Telerama.ec',
  tvlegislativa: 'TVLegislativa.ec',
  puruwatv: 'PuruwaTV.ec',
  puruwa: 'PuruwaTV.ec',
  americaestereoquito: 'AmericaEstereoQuito.ec',
  canalsur: 'CanalSur.ec',
  educatv: 'EducaTV.ec',
  tctelevision: 'TCtv.ec',
  tvc: 'TVC.ec',
  nickjr: 'NickJrLatinAmerica.ec',
  nickjunior: 'NickJrLatinAmerica.ec',
  comedycentral: 'ComedyCentralLatinAmerica.ec',
  lifetime: 'LifetimeLatinAmerica.ec',
  tcm: 'TCMLatinAmerica.ec',
  tlc: 'TLCLatinAmerica.ec',
  mtv: 'MTVLatinAmerica.ec',
  cinecanal: 'CinecanalLatinAmerica.ec',
  usa: 'USANetworkLatinAmerica.ec',
  usanetwork: 'USANetworkLatinAmerica.ec',
  investigationdiscovery: 'InvestigationDiscoveryLatinAmerica.ec',
  history2: 'History2LatinAmerica.ec',
  antena3: 'Antena3Internacional.ec',
  a3series: 'Atreseries.ec',
  ae: 'AandEAndes.ec',
  animalplanet: 'AnimalPlanetInternational.ec',
  discoveryhh: 'DiscoveryHomeAndHealthLatinAmerica.ec',
  discoverykids: 'DiscoveryKidsLatinAmerica.ec',
  espn2: 'ESPN2LatinAmerica.ec',
  espn3: 'ESPN3LatinAmerica.ec',
  espn4: 'ESPN4LatinAmerica.ec',
  espn5: 'ESPN5LatinAmerica.ec',
  espn6: 'ESPN6LatinAmerica.ec',
  espn7: 'ESPN7LatinAmerica.ec',
  goldenedge: 'GoldenLatinAmerica.ec',
  universalcinema: 'UNIVERSALCinemaWest.ec',
  universalpremiere: 'UniversalPremiere.ec',
  warnerbrostv: 'WarnerChannelAndes.ec',
  warnerchannel: 'WarnerChannelAndes.ec',
  tntseries: 'TNTLatinAmerica.ec',
  fx: 'FXLatinAmerica.ec',
  cinemax: 'CinemaxLatinAmerica.ec',
  cartoonito: 'CartoonitoLatinAmerica.ec',
  eentertainment: 'E!LatinAmerica.ec'
};

const {
  gatotvSlugForChannel,
  gatotvXmltvId,
  iptvEpgIdForChannel,
  IPTV_EPG_IDS
} = require('../data/epg-channel-map');

for (const [alias, id] of Object.entries(IPTV_EPG_IDS)) {
  if (!CHANNEL_EPG_ALIASES[alias]) CHANNEL_EPG_ALIASES[alias] = id;
}

const GROUP_FEED_CODES = {
  ecuador: ['ec'],
  noticias: ['es'],
  internacional: ['es', 'ec'],
  cine: ['ec', 'es'],
  deportes: ['ec', 'es'],
  novelas: ['ec', 'es', 'mx'],
  general: ['ec', 'es']
};

let cache = {
  fetchedAt: 0,
  urls: [],
  source: 'none',
  error: '',
  channelsById: new Map(),
  programmesByChannel: new Map(),
  nameToChannelId: new Map()
};

let refreshTimer = null;
let refreshPromise = null;

function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function cleanDisplayName(name) {
  return String(name || '')
    .replace(/^[A-Z]{2}\s*-\s*/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .trim();
}

function decodeXml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseXmltvDate(str) {
  const m = String(str || '').trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2] - 1;
  const d = +m[3];
  const h = +m[4];
  const mi = +m[5];
  const s = +m[6];
  let ts = Date.UTC(y, mo, d, h, mi, s);
  if (m[7] && m[8] && m[9]) {
    const offMin = parseInt(m[8], 10) * 60 + parseInt(m[9], 10);
    ts -= (m[7] === '-' ? -1 : 1) * offMin * 60000;
  }
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRange(start, end) {
  const opts = { hour: 'numeric', minute: '2-digit', timeZone: 'America/Guayaquil' };
  return `${start.toLocaleTimeString('es-EC', opts)} – ${end.toLocaleTimeString('es-EC', opts)}`;
}

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: 60000,
      headers: {
        'User-Agent': 'VixTV/1.0',
        Accept: 'application/xml,text/xml,application/gzip,*/*'
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
      const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (encoding.includes('gzip') || /\.gz(?:\?|$)/i.test(url.split('?')[0])) {
        stream = res.pipe(zlib.createGunzip());
      }

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function publicFeedUrl(code) {
  const feeds = PUBLIC_EPG_FEEDS[String(code).toLowerCase()];
  return feeds?.[0] || `${PUBLIC_EPG_BASE}-${String(code).toLowerCase()}.xml`;
}

function localEpgPaths(code) {
  const c = String(code).toLowerCase();
  const names = [`epg-${c}-iptv.xml`, `epg-${c}.xml`, `epg-${c}.xml.gz`];
  if (c === 'ec') names.push('epg-ec-globe.xml.gz');
  if (c === 'es') names.push('epg-es2.xml.gz', 'epg-es-iptv.xml');
  if (c === 'mx') names.push('epg-mx-iptv.xml', 'epg-mx.xml.gz');
  return names
    .map((name) => path.join(LOCAL_EPG_DIR, name))
    .filter((p) => fs.existsSync(p));
}

function feedUrlsForCodes(feedCodes) {
  const urls = [];
  const seen = new Set();
  const add = (url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  for (const code of feedCodes) {
    for (const filePath of localEpgPaths(code)) {
      add(`file://${filePath}`);
    }
    const list = PUBLIC_EPG_FEEDS[String(code).toLowerCase()] || [publicFeedUrl(code)];
    for (const url of list) add(url);
  }
  return urls;
}

function readLocalEpgFile(filePath) {
  const buf = fs.readFileSync(filePath);
  if (/\.gz$/i.test(filePath)) {
    return zlib.gunzipSync(buf).toString('utf8');
  }
  return buf.toString('utf8');
}

async function loadFeedXml(url) {
  if (url.startsWith('file://')) {
    return readLocalEpgFile(url.slice(7));
  }
  return fetchUrl(url);
}

function xmltvIdCore(xmltvId) {
  return normalizeName(String(xmltvId || '')
    .replace(/&amp;/gi, '')
    .replace(/\.[a-z]{2}$/i, '')
    .replace(/^canal/i, '')
    .replace(/\(ecuador\)/gi, '')
    .replace(/internacional/gi, ''));
}

function inferFeedCodes(channels = []) {
  const codes = new Set(['ec', 'es']);

  for (const ch of channels) {
    const groupKey = normalizeName(ch.group_title);
    if (groupKey.includes('novelas')) codes.add('mx');
    if (groupKey.includes('internacional') || groupKey.includes('noticias')) {
      codes.add('es');
    }
  }

  const extra = getSetting('epg_extra_feeds', '').trim();
  if (extra) {
    extra.split(/[,;\s]+/).filter(Boolean).forEach((c) => codes.add(c.toLowerCase()));
  }

  return [...codes].filter((c) => c !== 'us' && c !== 'gb');
}

function parseXmltv(xml) {
  const channelsById = new Map();
  const programmesByChannel = new Map();
  const nameToChannelId = new Map();

  const channelBlocks = xml.match(/<channel\b[\s\S]*?<\/channel>/gi) || [];
  for (const block of channelBlocks) {
    const idMatch = block.match(/\bid="([^"]+)"/i);
    if (!idMatch) continue;
    const id = decodeXml(idMatch[1].trim());
    const names = [...block.matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/gi)]
      .map((m) => decodeXml(m[1]))
      .filter(Boolean);
    channelsById.set(id, { id, displayNames: names });

    for (const rawName of names) {
      const cleaned = cleanDisplayName(rawName);
      for (const candidate of [rawName, cleaned]) {
        const key = normalizeName(candidate);
        if (key && !nameToChannelId.has(key)) nameToChannelId.set(key, id);
      }
    }
    const idKey = normalizeName(id.replace(/\.[a-z]{2}$/i, ''));
    if (idKey && !nameToChannelId.has(idKey)) nameToChannelId.set(idKey, id);
  }

  const programmeBlocks = xml.match(/<programme\b[\s\S]*?<\/programme>/gi) || [];
  for (const block of programmeBlocks) {
    const start = parseXmltvDate((block.match(/\bstart="([^"]+)"/i) || [])[1]);
    const stop = parseXmltvDate((block.match(/\bstop="([^"]+)"/i) || [])[1]);
    const channelId = (block.match(/\bchannel="([^"]+)"/i) || [])[1]?.trim();
    if (!start || !stop || !channelId || stop <= start) continue;

    const title = decodeXml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]) || 'Sin título';
    const desc = decodeXml((block.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i) || [])[1]) || '';
    const category = decodeXml((block.match(/<category[^>]*>([\s\S]*?)<\/category>/i) || [])[1]) || '';

    if (!programmesByChannel.has(channelId)) programmesByChannel.set(channelId, []);
    programmesByChannel.get(channelId).push({ start, stop, title, desc, category });
  }

  for (const list of programmesByChannel.values()) {
    list.sort((a, b) => a.start - b.start);
  }

  return { channelsById, programmesByChannel, nameToChannelId };
}

function emptyEpgIndex() {
  return {
    channelsById: new Map(),
    programmesByChannel: new Map(),
    nameToChannelId: new Map()
  };
}

function mergeIndexes(indexes) {
  const merged = {
    channelsById: new Map(),
    programmesByChannel: new Map(),
    nameToChannelId: new Map()
  };

  for (const idx of indexes) {
    for (const [id, ch] of idx.channelsById) {
      if (!merged.channelsById.has(id)) merged.channelsById.set(id, ch);
    }
    for (const [id, list] of idx.programmesByChannel) {
      if (!merged.programmesByChannel.has(id)) merged.programmesByChannel.set(id, []);
      merged.programmesByChannel.get(id).push(...list);
    }
    for (const [key, id] of idx.nameToChannelId) {
      if (!merged.nameToChannelId.has(key)) merged.nameToChannelId.set(key, id);
    }
  }

  for (const list of merged.programmesByChannel.values()) {
    list.sort((a, b) => a.start - b.start);
  }

  return merged;
}

function aliasCandidatesForChannel(channelRow) {
  const nameKey = normalizeName(channelRow.name);
  const out = [];
  const seen = new Set();
  const add = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  const gSlug = gatotvSlugForChannel(channelRow.name);
  if (gSlug) add(gatotvXmltvId(gSlug));
  add(iptvEpgIdForChannel(channelRow.name));

  if (CHANNEL_EPG_ALIASES[nameKey]) add(CHANNEL_EPG_ALIASES[nameKey]);
  for (const [alias, xmltvId] of Object.entries(CHANNEL_EPG_ALIASES)) {
    if (alias.length < 4 || nameKey.length < 4) continue;
    if (nameKey.includes(alias) || alias.includes(nameKey)) add(xmltvId);
  }
  return out;
}

function aliasForChannel(channelRow) {
  return aliasCandidatesForChannel(channelRow)[0] || null;
}

function fuzzyNameMatch(nameKey, indexKey) {
  if (!nameKey || !indexKey) return false;
  if (nameKey === indexKey) return true;
  if (nameKey.length < 5 || indexKey.length < 5) return false;
  if (!nameKey.includes(indexKey) && !indexKey.includes(nameKey)) return false;
  const shorter = Math.min(nameKey.length, indexKey.length);
  const longer = Math.max(nameKey.length, indexKey.length);
  return shorter / longer >= 0.65;
}

function channelIdMatchesName(xmltvId, channelName, index) {
  const nameKey = normalizeName(channelName);
  const idCore = xmltvIdCore(xmltvId);

  for (const candidate of aliasCandidatesForChannel({ name: channelName })) {
    if (candidate === xmltvId || xmltvIdCore(candidate) === idCore) return true;
  }

  for (const alias of Object.keys(CHANNEL_EPG_ALIASES)) {
    if (nameKey.includes(alias) && idCore.includes(alias)) return true;
  }

  if (nameKey.length >= 4 && (idCore.includes(nameKey) || nameKey.includes(idCore))) return true;

  const ch = index.channelsById.get(xmltvId);
  if (!ch) return false;
  for (const dn of ch.displayNames) {
    const dk = normalizeName(cleanDisplayName(dn));
    if (nameKey === dk || fuzzyNameMatch(nameKey, dk)) return true;
  }
  return false;
}

function findXmltvByPartialName(channelRow, index) {
  const nameKey = normalizeName(channelRow.name);
  if (!nameKey) return null;

  for (const candidate of aliasCandidatesForChannel(channelRow)) {
    if (index.channelsById.has(candidate)) return candidate;
  }

  let best = null;
  let bestScore = 0;
  for (const [id] of index.channelsById) {
    const idCore = xmltvIdCore(id);
    if (!idCore) continue;
    for (const alias of Object.keys(CHANNEL_EPG_ALIASES)) {
      if (!nameKey.includes(alias) || !idCore.includes(alias)) continue;
      const score = alias.length;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (fuzzyNameMatch(nameKey, idCore)) {
      const score = Math.min(nameKey.length, idCore.length);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
  }
  return best;
}

function programmeCount(index, xmltvId) {
  return (index.programmesByChannel.get(xmltvId) || []).length;
}

function programmeFreshnessBonus(index, xmltvId) {
  const list = index.programmesByChannel.get(xmltvId) || [];
  if (!list.length) return 0;
  const now = Date.now();
  let bonus = 0;
  for (const prog of list) {
    const mid = (prog.start.getTime() + prog.stop.getTime()) / 2;
    const dist = Math.abs(now - mid);
    if (dist < 36 * 3600000) bonus += 500;
    if (dist < 7 * 24 * 3600000) bonus += 100;
  }
  if (String(xmltvId).startsWith('gatotv:')) bonus += 3000;
  return bonus;
}

function bestXmltvCandidate(channelRow, index) {
  const config = configFromChannel(channelRow);
  const epg = config.epg || {};
  const candidates = [];
  const seen = new Set();
  const add = (id) => {
    const key = String(id || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(key);
  };

  add(epg.channel_id);
  add(epg.epg_id);
  for (const candidate of aliasCandidatesForChannel(channelRow)) add(candidate);
  add(findXmltvByPartialName(channelRow, index));

  const nameKey = normalizeName(channelRow.name);
  if (nameKey && index.nameToChannelId.has(nameKey)) add(index.nameToChannelId.get(nameKey));
  for (const [key, id] of index.nameToChannelId) {
    if (fuzzyNameMatch(nameKey, key)) add(id);
  }

  let best = null;
  let bestScore = -1;
  for (const id of candidates) {
    const count = programmeCount(index, id);
    const inGuide = index.channelsById.has(id);
    if (!inGuide && count === 0) continue;
    let score = count + programmeFreshnessBonus(index, id);
    if (channelIdMatchesName(id, channelRow.name, index)) score += 2000;
    for (const candidate of aliasCandidatesForChannel(channelRow)) {
      if (candidate === id) score += 1500;
    }
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function resolveXmltvChannelId(channelRow, index) {
  return bestXmltvCandidate(channelRow, index);
}

function persistBestEpgMapping(channelRow, xmltvId) {
  if (!xmltvId || programmeCount(cache, xmltvId) === 0) return;
  const config = configFromChannel(channelRow);
  const current = config.epg?.channel_id || config.epg?.epg_id || '';
  if (current === xmltvId) return;
  if (programmeCount(cache, current) >= programmeCount(cache, xmltvId)) return;
  config.epg = {
    ...config.epg,
    channel_id: xmltvId,
    epg_id: xmltvId,
    lang: config.epg?.lang || 'es'
  };
  db.prepare('UPDATE live_channels SET config = ? WHERE id = ?').run(serializeConfig(config), channelRow.id);
}


function pickNowNext(programmes, now = new Date()) {
  if (!programmes?.length) return { current: null, next: null };
  const t = now.getTime();
  let current = null;
  let next = null;

  for (const prog of programmes) {
    if (prog.start.getTime() <= t && prog.stop.getTime() > t) current = prog;
    if (!next && prog.start.getTime() > t) next = prog;
  }

  if (!current) {
    let lastPast = null;
    for (const prog of programmes) {
      if (prog.stop.getTime() <= t) lastPast = prog;
    }
    if (lastPast) current = lastPast;
  }

  if (!current && !next) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const prog of programmes) {
      const mid = (prog.start.getTime() + prog.stop.getTime()) / 2;
      const dist = Math.abs(t - mid);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = prog;
      }
    }
    if (nearest && nearestDist < 400 * 24 * 3600000) current = nearest;
  }

  if (!next && current) {
    const idx = programmes.indexOf(current);
    next = programmes[idx + 1] || null;
  }

  if (!next) {
    for (const prog of programmes) {
      if (prog.start.getTime() > (current?.stop?.getTime() || t)) {
        next = prog;
        break;
      }
    }
  }

  return { current, next };
}

function formatProgramme(prog, channelRow, role, now = new Date()) {
  if (!prog) {
    return {
      title: channelRow.name,
      subtitle: channelRow.group_title || 'En vivo',
      range: '',
      progress: role === 'now' ? 0 : undefined
    };
  }

  const total = Math.max(1, prog.stop - prog.start);
  const elapsed = Math.max(0, now - prog.start);
  return {
    title: prog.title,
    subtitle: prog.category || (prog.desc ? prog.desc.slice(0, 80) : '') || channelRow.group_title || 'En vivo',
    range: formatRange(prog.start, prog.stop),
    progress: role === 'now' ? Math.min(100, (elapsed / total) * 100) : undefined
  };
}

function syntheticEntry(channelRow, now = new Date()) {
  const ecNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Guayaquil' }));
  const slotMin = ecNow.getMinutes() < 30 ? 0 : 30;
  const start = new Date(ecNow);
  start.setMinutes(slotMin, 0, 0);
  const end = new Date(start);
  end.setMinutes(start.getMinutes() + 30);
  const nextEnd = new Date(end);
  nextEnd.setMinutes(end.getMinutes() + 30);
  const elapsed = Math.max(0, now - start);
  const total = Math.max(1, end - start);

  return {
    now: {
      title: channelRow.name,
      subtitle: channelRow.group_title || 'En vivo',
      range: formatRange(start, end),
      progress: Math.min(100, (elapsed / total) * 100)
    },
    next: {
      title: 'Programación en vivo',
      subtitle: channelRow.group_title || 'Canal en directo',
      range: formatRange(end, nextEnd)
    },
    source: 'synthetic'
  };
}

function buildEpgEntry(channelRow, index, now = new Date()) {
  const matchedId = resolveXmltvChannelId(channelRow, index);
  if (!matchedId) return syntheticEntry(channelRow, now);

  const programmes = index.programmesByChannel.get(matchedId) || [];
  const { current, next } = pickNowNext(programmes, now);
  if (!current && !next && !programmes.length) return syntheticEntry(channelRow, now);

  persistBestEpgMapping(channelRow, matchedId);

  return {
    now: formatProgramme(current, channelRow, 'now', now),
    next: formatProgramme(next, channelRow, 'next', now),
    matched_id: matchedId,
    source: String(matchedId).startsWith('gatotv:') ? 'gatotv' : 'epg'
  };
}

function epgFreshnessScore(index) {
  const now = Date.now();
  let best = 0;
  let count = 0;
  for (const list of index.programmesByChannel.values()) {
    for (const prog of list) {
      count += 1;
      const mid = (prog.start.getTime() + prog.stop.getTime()) / 2;
      const dist = Math.abs(now - mid);
      if (dist < 72 * 3600000) best += 1;
    }
  }
  return best * 1000 + count;
}

async function fetchPublicEpg(feedCodes) {
  const urls = feedUrlsForCodes(feedCodes);
  const parsed = [];
  const errors = [];

  await Promise.all(urls.map(async (url) => {
    try {
      const xml = await loadFeedXml(url);
      if (!/<tv\b/i.test(xml) && !/<programme\b/i.test(xml)) return;
      const index = parseXmltv(xml);
      parsed.push({ url, index, score: epgFreshnessScore(index) });
    } catch (err) {
      errors.push(`${url}: ${err.message || err}`);
    }
  }));

  if (!parsed.length) {
    throw new Error(errors[0] || 'No se pudo cargar ninguna guía pública');
  }

  parsed.sort((a, b) => b.score - a.score);
  const indexes = parsed.map((p) => p.index);
  const loaded = parsed.map((p) => p.url);

  return { index: mergeIndexes(indexes), urls: loaded, errors };
}

function getOptionalCustomUrl() {
  return getSetting('epg_xmltv_url', '').trim();
}

async function refreshEpg({ force = false } = {}) {
  if (!force && cache.fetchedAt && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return getCacheStatus();
  }
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const channels = db.prepare(`
      SELECT id, name, group_title, config FROM live_channels WHERE COALESCE(enabled, 1) = 1
    `).all();
    const feedCodes = inferFeedCodes(channels);
    const channelNames = channels.map((c) => c.name);
    let lastError = '';
    let mergedIndex = null;
    let loadedUrls = [];

    try {
      const { index, urls } = await fetchPublicEpg(feedCodes);
      mergedIndex = index;
      loadedUrls = urls;
    } catch (err) {
      lastError = err.message || String(err);
    }

    try {
      const gatotvEpg = require('./gatotvEpg');
      const gIndex = await gatotvEpg.refreshGatotvEpg({ force: true, channelNames });
      if (gIndex.programmesByChannel?.size) {
        mergedIndex = mergeIndexes([mergedIndex || emptyEpgIndex(), {
          channelsById: gIndex.channelsById,
          programmesByChannel: gIndex.programmesByChannel,
          nameToChannelId: gIndex.nameToChannelId
        }]);
        loadedUrls.push(`gatotv://ec/${gIndex.date || 'today'}`);
      }
    } catch (err) {
      if (!lastError) lastError = `GatoTV: ${err.message || err}`;
    }

    if (mergedIndex && mergedIndex.programmesByChannel.size) {
      cache = {
        fetchedAt: Date.now(),
        urls: loadedUrls,
        source: 'epg',
        error: lastError,
        ...mergedIndex
      };
      setSetting('epg_last_sync', new Date().toISOString());
      setSetting('epg_last_error', lastError);
      setSetting('epg_feed_codes', feedCodes.join(','));
      return getCacheStatus();
    }

    const customUrl = getOptionalCustomUrl();
    if (customUrl) {
      try {
        const xml = await fetchUrl(customUrl);
        const parsed = parseXmltv(xml);
        cache = {
          fetchedAt: Date.now(),
          urls: [customUrl],
          source: 'epg',
          error: '',
          ...parsed
        };
        setSetting('epg_last_sync', new Date().toISOString());
        setSetting('epg_last_error', '');
        return getCacheStatus();
      } catch (err) {
        lastError = err.message || String(err);
      }
    }

    cache = {
      ...cache,
      fetchedAt: Date.now(),
      urls: feedUrlsForCodes(feedCodes),
      source: 'error',
      error: lastError || 'No se pudo descargar la guía EPG'
    };
    setSetting('epg_last_error', cache.error);
    return getCacheStatus();
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function getCacheStatus() {
  return {
    source: cache.source,
    url: cache.urls?.[0] || '',
    urls: cache.urls || [],
    updated_at: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    error: cache.error || '',
    xmltv_channels: cache.channelsById.size,
    programmes_channels: cache.programmesByChannel.size
  };
}

async function getLiveEpgMap({ force = false } = {}) {
  await refreshEpg({ force });
  const freetvOttera = require('./freetvOttera');
  const plutoTv = require('./plutoTv');
  const channels = db.prepare(`
    SELECT id, name, logo, group_title, stream_url, config
    FROM live_channels
    WHERE COALESCE(enabled, 1) = 1
    ORDER BY group_title, name
  `).all();

  const now = new Date();
  const epg = {};
  let matched = 0;

  for (const ch of channels) {
    let entry = null;
    const config = configFromChannel(ch);
    if (config.fast?.source === 'pluto' && config.fast?.external_id) {
      entry = await plutoTv.getChannelEpg(config.fast.external_id, config.fast.region || 'MX', now);
    }
    if (!entry && freetvOttera.isFreetvChannel(ch)) {
      entry = await freetvOttera.getChannelEpg(ch, now);
    }
    if (!entry) {
      entry = cache.source === 'epg'
        ? buildEpgEntry(ch, cache, now)
        : syntheticEntry(ch, now);
    }
    epg[String(ch.id)] = entry;
    if (entry.source === 'epg' || entry.source === 'gatotv' || entry.source === 'freetv' || entry.source === 'pluto') matched++;
  }

  return {
    ...getCacheStatus(),
    channels_total: channels.length,
    channels_matched: matched,
    epg
  };
}

function startEpgScheduler() {
  if (refreshTimer) return;
  refreshEpg().catch(() => {});
  refreshTimer = setInterval(() => {
    refreshEpg({ force: true }).catch(() => {});
  }, REFRESH_INTERVAL_MS);
  if (refreshTimer.unref) refreshTimer.unref();
}

function getEpgIndex() {
  return {
    channelsById: cache.channelsById,
    programmesByChannel: cache.programmesByChannel,
    nameToChannelId: cache.nameToChannelId,
    source: cache.source
  };
}

module.exports = {
  normalizeName,
  inferFeedCodes,
  refreshEpg,
  getLiveEpgMap,
  getCacheStatus,
  getEpgIndex,
  resolveXmltvChannelId,
  buildEpgEntry,
  aliasCandidatesForChannel,
  startEpgScheduler,
  fetchUrl,
  parseXmltv,
  CHANNEL_EPG_ALIASES,
  publicFeedUrl,
  feedUrlsForCodes,
  PUBLIC_EPG_FEEDS
};
