const PREFIX = 'vixmusic_cache_';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

function keyFor(kind, query) {
  return `${PREFIX}${kind}:${query.toLowerCase().trim()}`;
}

export function getCached(kind, query) {
  try {
    const raw = localStorage.getItem(keyFor(kind, query));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > DEFAULT_TTL_MS) {
      localStorage.removeItem(keyFor(kind, query));
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function setCached(kind, query, data) {
  try {
    localStorage.setItem(keyFor(kind, query), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* quota de localStorage */
  }
}
