const ACTIVE_TTL_MS = 45000;

const sessions = new Map();

function setActivity(userId, data) {
  sessions.set(userId, {
    userId,
    username: data.username || '',
    role: data.role || 'user',
    status: data.status || 'browsing',
    page: data.page || '',
    title: data.title || '',
    contentType: data.contentType || '',
    contentId: data.contentId || null,
    progress: data.progress || 0,
    duration: data.duration || 0,
    updatedAt: Date.now()
  });
}

function clearActivity(userId) {
  sessions.delete(userId);
}

function getActiveSessions() {
  const now = Date.now();
  const active = [];
  for (const [userId, session] of sessions) {
    if (now - session.updatedAt > ACTIVE_TTL_MS) {
      sessions.delete(userId);
      continue;
    }
    active.push({
      user_id: userId,
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
      seconds_ago: Math.round((now - session.updatedAt) / 1000)
    });
  }
  active.sort((a, b) => a.username.localeCompare(b.username));
  return active;
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
  clearActivity,
  getActiveSessions,
  statusLabel,
  ACTIVE_TTL_MS
};
