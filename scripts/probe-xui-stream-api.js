const http = require('http');
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
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
  console.log('cookie', !!cookie);
  const hdrs = {
    Cookie: cookie,
    Referer: `${baseUrl}/streams`,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
  };

  const dtBody = new URLSearchParams({
    draw: '1', start: '0', length: '500',
    'search[value]': '', 'search[regex]': 'false'
  }).toString();

  for (const action of ['stream', 'streams', 'get_streams']) {
    const res = await req(`${baseUrl}/api?action=${action}`, {
      method: 'POST', headers: { ...hdrs, 'Content-Length': Buffer.byteLength(dtBody) }, body: dtBody
    });
    console.log('\nPOST', action, res.status);
    console.log(res.body.slice(0, 500));
    try {
      const j = JSON.parse(res.body);
      console.log('keys', Object.keys(j));
      if (j.data) console.log('data len', j.data.length, 'recordsTotal', j.recordsTotal, 'sample', JSON.stringify(j.data[0]).slice(0, 400));
    } catch (e) { console.log('parse err', e.message); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
