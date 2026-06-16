const { getUserRow, getMaxConnections } = require('./userAccess');

const ACTIVE_TTL_MS = 120000;
const STREAM_TOUCH_MIN_MS = 6000;
const GENERIC_SESSION_KEYS = new Set(['main', 'live', 'stream', 'tv-stream']);

/** sessionKey: `${userId}:${clientSessionId}` */
const sessions = new Map();

function sessionMapKey(userId, sessionKey = 'main') {
  return `${userId}:${String(sessionKey || 'main')}`;
}

function activityContentId(data = {}) {
  if (data.contentId != null && data.contentId !== '') return String(data.contentId);
  if (data.content_id != null && data.content_id !== '') return String(data.content_id);
  return '';
}

/** Evita filas duplicadas live/main cuando el móvil y el proxy marcan la misma reproducción. */
function normalizeSessionKey(userId, sessionKey, data = {}) {
  const raw = String(sessionKey || 'main').slice(0, 64);
  if (!GENERIC_SESSION_KEYS.has(raw)) return raw;

  purgeExpiredSessions();
  const status = data.status || '';
  const contentId = activityContentId(data);

  let genericMatch = null;

  for (const [, session] of sessions) {
    if (session.userId !== userId) continue;
    const sameWatch = status
      && session.status === status
      && String(session.contentId || '') === contentId;

    if (!GENERIC_SESSION_KEYS.has(session.sessionKey)) {
      if (sameWatch) return session.sessionKey;
    } else if (sameWatch && !genericMatch) {
      genericMatch = session.sessionKey;
    }
  }

  if (genericMatch) return genericMatch;
  return raw;
}

function pruneGenericDuplicates(userId, keepKey, data = {}) {
  const status = data.status || '';
  if (!status) return;
  const contentId = activityContentId(data);
  const prefix = `${userId}:`;
  for (const [mapKey, session] of sessions) {
    if (!mapKey.startsWith(prefix)) continue;
    if (session.sessionKey === keepKey) continue;
    if (!GENERIC_SESSION_KEYS.has(session.sessionKey)) continue;
    if (session.status === status && String(session.contentId || '') === contentId) {
      sessions.delete(mapKey);
    }
  }
}

/** Una sola fila por usuario + canal en vivo (evita fantasmas webtest/live/sid distintos). */
function pruneDuplicateWatchSessions(userId, keepKey, data = {}) {
  const status = data.status || '';
  const contentId = activityContentId(data);
  if (!contentId || !/^watching_/.test(status)) return;
  const prefix = `${userId}:`;
  for (const [mapKey, session] of sessions) {
    if (!mapKey.startsWith(prefix)) continue;
    if (session.sessionKey === keepKey) continue;
    if (session.status === status && String(session.contentId || '') === contentId) {
      sessions.delete(mapKey);
    }
  }
}

function purgeExpiredSessions() {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.updatedAt > ACTIVE_TTL_MS) sessions.delete(key);
  }
}

function countUserSessions(userId) {
  purgeExpiredSessions();
  const prefix = `${userId}:`;
  let n = 0;
  for (const key of sessions.keys()) {
    if (key.startsWith(prefix)) n += 1;
  }
  return n;
}

function maxConnectionsForUser(userId) {
  return getMaxConnections(getUserRow(userId));
}

function ensureSessionAllowed(userId, sessionKey = 'main') {
  purgeExpiredSessions();
  const key = sessionMapKey(userId, sessionKey);
  if (sessions.has(key)) return true;
  const max = maxConnectionsForUser(userId);
  return countUserSessions(userId) < max;
}

function setActivity(userId, data, sessionKey = 'main') {
  const resolvedKey = normalizeSessionKey(userId, sessionKey, data);
  const key = sessionMapKey(userId, resolvedKey);
  const prev = sessions.get(key);
  sessions.set(key, {
    userId,
    sessionKey: String(resolvedKey || 'main'),
    username: data.username || (prev && prev.username) || '',
    role: data.role || (prev && prev.role) || 'user',
    profileId: data.profileId != null ? data.profileId : (prev && prev.profileId != null ? prev.profileId : null),
    status: data.status || 'browsing',
    page: data.page || (prev && prev.page) || '',
    title: data.title || '',
    contentType: data.contentType || data.content_type || '',
    contentId: data.contentId != null ? data.contentId : (data.content_id != null ? data.content_id : null),
    progress: Number(data.progress) || 0,
    duration: Number(data.duration) || 0,
    updatedAt: Date.now()
  });
  pruneGenericDuplicates(userId, resolvedKey, data);
  pruneDuplicateWatchSessions(userId, resolvedKey, data);
}

/** Marca actividad desde JWT de reproducción (live/VOD proxy) sin esperar heartbeat del cliente. */
function touchActivityFromClaims(claims, data, sessionKey = 'main') {
  if (!claims || !claims.id) return false;
  const resolvedKey = normalizeSessionKey(claims.id, sessionKey, data);
  if (!ensureSessionAllowed(claims.id, resolvedKey)) return false;

  const userId = claims.id;
  const key = sessionMapKey(userId, resolvedKey);
  const now = Date.now();
  const prev = sessions.get(key);
  const nextStatus = data.status || (prev && prev.status);
  const nextContentId = data.contentId != null ? data.contentId : (data.content_id != null ? data.content_id : (prev && prev.contentId));
  const sameState = prev
    && prev.status === nextStatus
    && String(prev.contentId || '') === String(nextContentId || '');
  if (sameState && now - (prev.updatedAt || 0) < STREAM_TOUCH_MIN_MS) {
    prev.updatedAt = now;
    if (data.title) prev.title = data.title;
    if (data.progress != null) prev.progress = Number(data.progress) || 0;
    if (data.duration != null) prev.duration = Number(data.duration) || 0;
    return true;
  }
  setActivity(userId, {
    username: claims.username || (prev && prev.username) || '',
    role: claims.role || (prev && prev.role) || 'user',
    profileId: claims.profileId || null,
    page: data.page || (data.status === 'watching_live' ? 'live' : (prev && prev.page) || ''),
    ...data
  }, resolvedKey);
  return true;
}

function clearActivity(userId, sessionKey = null) {
  if (sessionKey == null || sessionKey === '') {
    const prefix = `${userId}:`;
    for (const key of [...sessions.keys()]) {
      if (key.startsWith(prefix)) sessions.delete(key);
    }
    return;
  }
  sessions.delete(sessionMapKey(userId, sessionKey));
}

function getActiveSessions() {
  purgeExpiredSessions();
  const now = Date.now();
  const active = [];
  for (const [, session] of sessions) {
    active.push({
      user_id: session.userId,
      session_key: session.sessionKey,
      username: session.username,
      role: session.role,
      status: session.status,
      page: session.page,
      title: session.title,
      content_type: session.contentType,
      content_id: session.contentId,
      progress: session.progress,
      duration: session.duration,
      updated_at: new Date(session.updatedAt).toISOString(),
      seconds_ago: Math.round((now - session.updatedAt) / 1000),
      max_connections: maxConnectionsForUser(session.userId)
    });
  }
  active.sort((a, b) => {
    const u = a.username.localeCompare(b.username);
    if (u !== 0) return u;
    return String(a.session_key).localeCompare(String(b.session_key));
  });
  return dedupeActiveSessionsForDisplay(active);
}

function dedupeActiveSessionsForDisplay(rows) {
  const watchBest = new Map();
  const out = [];
  for (const row of rows) {
    const cid = row.content_id != null ? String(row.content_id) : '';
    if (row.status === 'watching_live' && cid) {
      const k = `${row.user_id}:live:${cid}`;
      const prev = watchBest.get(k);
      if (!prev || row.seconds_ago < prev.seconds_ago) watchBest.set(k, row);
      continue;
    }
    if (/^watching_/.test(row.status) && cid) {
      const k = `${row.user_id}:${row.status}:${cid}`;
      const prev = watchBest.get(k);
      if (!prev || row.seconds_ago < prev.seconds_ago) watchBest.set(k, row);
      continue;
    }
    out.push(row);
  }
  return [...out, ...watchBest.values()].sort((a, b) => {
    const u = a.username.localeCompare(b.username);
    if (u !== 0) return u;
    return String(a.session_key).localeCompare(String(b.session_key));
  });
}

function countConnectionsByUser() {
  purgeExpiredSessions();
  const counts = new Map();
  for (const [, session] of sessions) {
    counts.set(session.userId, (counts.get(session.userId) || 0) + 1);
  }
  return counts;
}

function statusLabel(status) {
  return {
    browsing: 'Navegando',
    watching_movie: 'Viendo película',
    watching_episode: 'Viendo episodio',
    watching_live: 'Viendo canal en vivo',
    admin: 'En panel admin'
  }[status] || status;
}

module.exports = {
  setActivity,
  touchActivityFromClaims,
  clearActivity,
  getActiveSessions,
  countConnectionsByUser,
  countUserSessions,
  ensureSessionAllowed,
  maxConnectionsForUser,
  normalizeSessionKey,
  statusLabel,
  ACTIVE_TTL_MS,
  DEFAULT_MAX_CONNECTIONS: 5
};
