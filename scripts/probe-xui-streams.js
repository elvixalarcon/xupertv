const http = require('http');
const https = require('https');
const Database = require('better-sqlite3');
const db = new Database('/app/data/xupertv.db', { readonly: true });
const baseUrl = db.prepare("SELECT value FROM settings WHERE key='xui_admin_url'").get()?.value?.replace(/\/$/, '');
const user = db.prepare("SELECT value FROM settings WHERE key='xui_admin_user'").get()?.value;
const pass = db.prepare("SELECT value FROM settings WHERE key='xui_admin_pass'").get()?.value;

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const r = client.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: 30000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

(async () => {
  const body = new URLSearchParams({ username: user, password: pass, login: 'Login' }).toString();
  const login = await req(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body
  });
  const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('PHPSESSID='));
  if (!cookie) throw new Error('login failed');
  const hdrs = { Cookie: cookie, Referer: `${baseUrl}/streams`, 'X-Requested-With': 'XMLHttpRequest' };

  for (const action of ['get_streams', 'get_categories', 'get_bouquets']) {
    const res = await req(`${baseUrl}/api?action=${action}`, { headers: hdrs });
    const j = JSON.parse(res.body);
    console.log('\n===', action, '===');
    console.log('top keys', Object.keys(j));
    const rows = j.result || j.data || j;
    const list = Array.isArray(rows) ? rows : Object.values(rows || {});
    console.log('count', list.length);
    if (list[0]) {
      console.log('sample keys', Object.keys(list[0]).join(', '));
      console.log('sample', JSON.stringify(list[0], null, 2).slice(0, 1200));
    }
    if (list[1]) console.log('sample2 name', list[1].stream_display_name || list[1].category_name);
  }
})().catch((e) => { console.error(e); process.exit(1); });
