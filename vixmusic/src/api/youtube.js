import { getCached, setCached } from '../lib/searchCache';
import { pipedSearch } from './piped';

/** Búsqueda y metadatos vía Piped (sin YouTube Data API ni cuotas) */

export function parseIsoDuration(iso) {
  if (!iso || typeof iso !== 'string') return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

export function formatDuration(iso) {
  const sec = typeof iso === 'number' ? iso : parseIsoDuration(iso);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export async function searchMusic(query, maxResults = 25) {
  const q = query.trim();
  if (!q) return [];

  const cacheKey = `${q}:${maxResults}`;
  const cached = getCached('search', cacheKey);
  if (cached) return cached;

  const items = await pipedSearch(q, maxResults);
  setCached('search', cacheKey, items);
  return items;
}

export async function filterEmbeddable(tracks) {
  return tracks;
}

export async function fetchPopularMusic(maxResults = 24) {
  const cached = getCached('popular', `mx:${maxResults}`);
  if (cached) return cached;

  const queries = [
    'música latina éxitos audio',
    'reggaeton hits audio',
    'pop en español audio',
  ];

  const seen = new Set();
  const merged = [];

  for (const q of queries) {
    try {
      const batch = await pipedSearch(q, 12);
      for (const t of batch) {
        if (t.videoId && !seen.has(t.videoId)) {
          seen.add(t.videoId);
          merged.push(t);
        }
      }
    } catch {
      /* siguiente */
    }
    if (merged.length >= maxResults) break;
  }

  const items = merged.slice(0, maxResults);
  if (!items.length) throw new Error('No se pudo cargar música popular');
  setCached('popular', `mx:${maxResults}`, items);
  return items;
}

export async function enrichDurations(tracks) {
  return tracks.map((t) => {
    if (t.duration && !t.durationLabel) {
      return { ...t, durationLabel: formatDuration(t.duration) };
    }
    return t;
  });
}
