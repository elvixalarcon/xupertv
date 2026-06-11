const https = require('https');
const http = require('http');
const { getSetting, setSetting } = require('./settings');

let session = { cookie: '', expires: 0 };

function getAdminConfig() {
  return {
    baseUrl: (getSetting('xui_admin_url', 'http://5.5.5.5/administracion') || '').replace(/\/$/, ''),
    username: getSetting('xui_admin_user', 'elvixplay'),
    password: getSetting('xui_admin_pass', '')
  };
}

function saveAdminConfig(body) {
  if (body.xui_admin_url !== undefined) setSetting('xui_admin_url', String(body.xui_admin_url || '').trim());
  if (body.xui_admin_user !== undefined) setSetting('xui_admin_user', String(body.xui_admin_user || '').trim());
  if (body.xui_admin_pass !== undefined) {
    const p = String(body.xui_admin_pass || '').trim();
    if (p && !p.startsWith('•')) setSetting('xui_admin_pass', p);
  }
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'VixTV-Panel/1.0',
        Accept: 'application/json, text/plain, */*',
        ...(opts.headers || {})
      },
      timeout: 15000
    };
    if (u.protocol === 'https:') reqOpts.rejectUnauthorized = false;

    const req = client.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, body, headers: res.headers, setCookie });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout XUI')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function login(force = false) {
  const cfg = getAdminConfig();
  if (!cfg.baseUrl || !cfg.username || !cfg.password) {
    return { ok: false, error: 'Credenciales XUI admin no configuradas' };
  }
  if (!force && session.cookie && Date.now() < session.expires) {
    return { ok: true, cached: true };
  }

  const body = new URLSearchParams({
    username: cfg.username,
    password: cfg.password,
    login: 'Login'
  }).toString();

  const res = await request(`${cfg.baseUrl}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });

  const cookie = (res.setCookie || [])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('PHPSESSID='));

  if (!cookie && res.status !== 302) {
    return { ok: false, error: 'Login XUI fallido' };
  }
  if (!cookie) {
    return { ok: false, error: 'Sin sesión XUI' };
  }

  session = { cookie, expires: Date.now() + 25 * 60 * 1000 };
  return { ok: true };
}

async function apiGet(action) {
  const cfg = getAdminConfig();
  const loginRes = await login();
  if (!loginRes.ok) throw new Error(loginRes.error || 'No se pudo conectar a XUI');

  const url = `${cfg.baseUrl}/api?action=${encodeURIComponent(action)}`;
  let res = await request(url, {
    headers: {
      Cookie: session.cookie,
      Referer: `${cfg.baseUrl}/dashboard`,
      'X-Requested-With': 'XMLHttpRequest'
    }
  });

  if (!res.body && res.status === 200) {
    await login(true);
    res = await request(url, {
      headers: {
        Cookie: session.cookie,
        Referer: `${cfg.baseUrl}/dashboard`,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
  }

  if (!res.body) throw new Error(`XUI API ${action} vacía`);
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error(`XUI API ${action} inválida`);
  }
}

async function apiPostTable(params = {}) {
  const cfg = getAdminConfig();
  const loginRes = await login();
  if (!loginRes.ok) throw new Error(loginRes.error || 'No se pudo conectar a XUI');

  const body = new URLSearchParams(params).toString();
  const res = await request(`${cfg.baseUrl}/table`, {
    method: 'POST',
    headers: {
      Cookie: session.cookie,
      Referer: `${cfg.baseUrl}/streams`,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });

  if (!res.body) throw new Error('XUI table vacía');
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error('XUI table inválida');
  }
}

async function fetchAdminStreamsTable() {
  return apiPostTable({
    draw: '1',
    start: '0',
    length: '5000',
    'search[value]': '',
    'search[regex]': 'false',
    id: 'streams',
    category: '',
    filter: '',
    server: '',
    audio: '',
    video: '',
    resolution: ''
  });
}

async function fetchStreamViewHtml(streamId) {
  const cfg = getAdminConfig();
  const loginRes = await login();
  if (!loginRes.ok) throw new Error(loginRes.error || 'No se pudo conectar a XUI');

  const res = await request(`${cfg.baseUrl}/stream_view?id=${encodeURIComponent(streamId)}`, {
    headers: {
      Cookie: session.cookie,
      Referer: `${cfg.baseUrl}/streams`
    }
  });
  if (res.status !== 200) throw new Error(`stream_view ${streamId}: HTTP ${res.status}`);
  return res.body;
}

function seriesValues(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => (Array.isArray(p) ? Number(p[1]) || 0 : Number(p) || 0));
}

async function fetchGraphStats() {
  try {
    const data = await apiGet('graph_stats');
    return {
      ok: true,
      cpu: seriesValues(data.cpu),
      memory: seriesValues(data.memory),
      input: seriesValues(data.input),
      output: seriesValues(data.output),
      connections: seriesValues(data.connections),
      streams: seriesValues(data.streams),
      users: seriesValues(data.users)
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function fetchHeaderStats() {
  try {
    const data = await apiGet('header_stats');
    return {
      ok: true,
      bytes_sent_mbps: Math.floor((data.bytes_sent || 0) / 125000),
      bytes_received_mbps: Math.floor((data.bytes_received || 0) / 125000),
      total_connections: parseInt(data.total_connections, 10) || 0,
      total_users: parseInt(data.total_users, 10) || 0,
      total_running_streams: parseInt(data.total_running_streams, 10) || 0,
      offline_streams: parseInt(data.offline_streams, 10) || 0
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function normalizeServers(data) {
  const list = Array.isArray(data.servers) ? data.servers : [];
  return list.map((s) => ({
    server_id: s.server_id || s.id,
    name: s.server_name || s.name || `Servidor ${s.server_id || s.id || ''}`.trim(),
    cpu: Number(s.cpu) || 0,
    mem: Number(s.mem) || 0,
    io: Number(s.io) || 0,
    disk: Number(s.fs) || 0,
    uptime: s.uptime && s.uptime !== '--' ? s.uptime : '—',
    requests_per_second: Number(s.requests_per_second) || 0,
    connections: parseInt(s.open_connections || s.connections, 10) || 0
  }));
}

async function fetchDashboardStats() {
  try {
    const [data, graph, header] = await Promise.all([
      apiGet('stats'),
      fetchGraphStats().catch(() => ({ ok: false })),
      fetchHeaderStats().catch(() => ({ ok: false }))
    ]);
    const srv = data.servers?.[0] || {};
    const hdr = header.ok ? header : {};
    return {
      ok: true,
      open_connections: parseInt(data.open_connections, 10) || hdr.total_connections || 0,
      online_users: parseInt(data.online_users, 10) || hdr.total_users || 0,
      total_running_streams: parseInt(data.total_running_streams, 10) || hdr.total_running_streams || 0,
      offline_streams: parseInt(data.offline_streams, 10) || hdr.offline_streams || 0,
      total_streams: parseInt(data.total_streams, 10) || 0,
      bytes_sent_mbps: hdr.bytes_sent_mbps ?? Math.floor((data.bytes_sent || 0) / 125000),
      bytes_received_mbps: hdr.bytes_received_mbps ?? Math.floor((data.bytes_received || 0) / 125000),
      cpu: data.cpu || srv.cpu || 0,
      mem: data.mem || srv.mem || 0,
      io: data.io || srv.io || 0,
      disk: data.fs || srv.fs || 0,
      uptime: data.uptime && data.uptime !== '--' ? data.uptime : (srv.uptime || '—'),
      requests_per_second: srv.requests_per_second || data.requests_per_second || 0,
      server_name: srv.server_name || 'Main Server',
      server_id: srv.server_id || 1,
      servers: normalizeServers(data),
      graph: graph.ok ? graph : null
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getAdminSettingsPublic() {
  const cfg = getAdminConfig();
  return {
    xui_admin_url: cfg.baseUrl,
    xui_admin_user: cfg.username,
    xui_admin_pass: cfg.password ? '••••••••' : '',
    xui_admin_configured: !!(cfg.baseUrl && cfg.username && cfg.password)
  };
}

module.exports = {
  fetchDashboardStats,
  fetchGraphStats,
  fetchHeaderStats,
  fetchAdminStreamsTable,
  fetchStreamViewHtml,
  getAdminConfig,
  saveAdminConfig,
  getAdminSettingsPublic,
  login
};
