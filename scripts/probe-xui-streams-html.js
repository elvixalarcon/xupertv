const http = require('http');
const fs = require('fs');
const Database = require('better-sqlite3');
const db = new Database('/app/data/xupertv.db', { readonly: true });
const baseUrl = db.prepare("SELECT value FROM settings WHERE key='xui_admin_url'").get().value.replace(/\/$/, '');
const user = db.prepare("SELECT value FROM settings WHERE key='xui_admin_user'").get().value;
const pass = db.prepare("SELECT value FROM settings WHERE key='xui_admin_pass'").get().value;

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search,
      method: opts.method || 'GET', headers: opts.headers || {}, timeout: 30000
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ headers: res.headers, body: d }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

(async () => {
  const loginBody = new URLSearchParams({ username: user, password: pass, login: 'Login' }).toString();
  const login = await req(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(loginBody) },
    body: loginBody
  });
  const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('PHPSESSID='));
  const html = (await req(`${baseUrl}/streams`, { headers: { Cookie: cookie } })).body;

  const patterns = ['serverSide', 'ajax:', 'EventSource', 'WebSocket', 'recordsTotal', 'streampage', 'initStreams', 'loadStreams', 'rTable', 'table.php', 'sse', 'refreshTable', 'stream_search', 'stream_show'];
  for (const p of patterns) {
    let idx = 0;
    let count = 0;
    while ((idx = html.indexOf(p, idx)) >= 0 && count < 2) {
      console.log(`\n=== ${p} @ ${idx} ===`);
      console.log(html.slice(Math.max(0, idx - 80), idx + 400).replace(/\s+/g, ' '));
      idx += p.length;
      count++;
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
