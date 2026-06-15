/** Orden y clasificación de categorías en TV En Vivo (no tocar Ecuador). */

const LIVE_CATEGORY_ORDER = [
  'Ecuador',
  'Películas',
  'Series',
  'Novelas',
  'Kids',
  'Música',
  'Noticias',
  'Deportes',
  'ViX',
  'Pluto'
];

function isEcuadorChannel(ch) {
  return /^ecuador$/i.test(String(ch?.group_title || '').trim());
}

function isPlutoChannel(ch) {
  return String(ch?.group_title || '').startsWith('Pluto TV ·');
}

function isVixChannel(ch) {
  return String(ch?.group_title || '').startsWith('ViX ·');
}

function classifyLiveChannel(channel) {
  if (isEcuadorChannel(channel)) return null;
  const config = typeof channel?.config === 'string'
    ? (() => { try { return JSON.parse(channel.config); } catch { return {}; } })()
    : (channel?.config || {});
  if (config.radio || String(channel?.group_title || '').trim() === 'Radio Ecuador') return null;

  const name = String(channel?.name || '').trim();
  const old = String(channel?.group_title || '').trim();
  const hay = `${name} ${old}`.toLowerCase();

  if (isPlutoChannel(channel) || isVixChannel(channel)) return null;

  if (old === 'Cine en Vivo' || /cinecanal|universal cinema|multipremier|golden edge|warner bros|studio universal/i.test(hay)) {
    return 'Películas';
  }
  if (/novela|las estrellas|tnt novelas|tl novelas|telefe|telemundo internacional|univision/i.test(hay) || old === 'Novelas') {
    return 'Novelas';
  }
  if (/cartoon|tooncast|disney channel|nick|kids|junior|spongebob|padrinos/i.test(hay)) {
    return 'Kids';
  }
  if (/retrix|música|musica|vevo|hits|radio/i.test(hay) || old === 'ViX · Música') {
    return 'Música';
  }
  if (/noticia|news|dw |euronews|univision 24|noticias internacionales/i.test(hay) || old === 'Noticias Internacionales' || old === 'ViX · Noticias') {
    return 'Noticias';
  }
  if (old === 'Deportes' || /espn|fox sports|liga 1|tyc|tudn|dazn|win sports|ecdf|directv sports|tnt sports|bundesliga|deportes/i.test(hay)) {
    return 'Deportes';
  }
  if (/history|series|discovery|animal planet|antena|a&e|nat geo|investigation|a3 series|sony|fx|amc|axn|tnt series|starchannel|space|warner|golden|universal|usa|aqui y ahora|vixred/i.test(hay) || old === 'En Vivo') {
    return 'Series';
  }

  if (old === 'En Vivo' || old === 'Cine en Vivo') return 'Películas';
  return old || 'Series';
}

function countBySidebarCategory(channels) {
  const counts = {};
  for (const key of LIVE_CATEGORY_ORDER) counts[key] = 0;
  for (const ch of channels) {
    if (isEcuadorChannel(ch)) {
      counts.Ecuador += 1;
      continue;
    }
    if (isPlutoChannel(ch)) {
      counts.Pluto += 1;
      continue;
    }
    if (isVixChannel(ch)) {
      counts.ViX += 1;
      continue;
    }
    const cat = classifyLiveChannel(ch) || ch.group_title;
    if (counts[cat] != null) counts[cat] += 1;
  }
  return counts;
}

module.exports = {
  LIVE_CATEGORY_ORDER,
  isEcuadorChannel,
  isPlutoChannel,
  isVixChannel,
  classifyLiveChannel,
  countBySidebarCategory
};
