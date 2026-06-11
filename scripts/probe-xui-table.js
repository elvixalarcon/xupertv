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
      method: opts.method || 'GET', headers: opts.headers || {}, timeout: 60000
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

  const params = new URLSearchParams({
    draw: '1', start: '0', length: '500',
    'search[value]': '', 'search[regex]': 'false',
    id: 'streams',
    category: '', filter: '', server: '', audio: '', video: '', resolution: ''
  });
  const body = params.toString();
  const res = await req(`${baseUrl}/table`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Referer: `${baseUrl}/streams`,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': Buffer.byteLength(body)
    },
    body
  });

  console.log('status', res.status);
  const j = JSON.parse(res.body);
  console.log('keys', Object.keys(j));
  console.log('recordsTotal', j.recordsTotal, 'recordsFiltered', j.recordsFiltered, 'data len', j.data?.length);
  if (j.data?.[0]) {
    console.log('row0 type', typeof j.data[0], Array.isArray(j.data[0]) ? 'array len '+j.data[0].length : '');
    console.log('row0', JSON.stringify(j.data[0]).slice(0, 800));
  }
  if (j.data?.[1]) console.log('row1 col2 name html', String(j.data[1][2]).slice(0, 300));
})().catch((e) => { console.error(e); process.exit(1); });
