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
  const hdrs = {
    Cookie: cookie,
    Referer: `${baseUrl}/streams`,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
  };

  // single stream sources table
  for (const streamId of [1, 2, 96]) {
    const params = new URLSearchParams({
      draw: '1', start: '0', length: '50',
      'search[value]': '', 'search[regex]': 'false',
      id: 'streams', stream_id: String(streamId), single: 'true'
    });
    const body = params.toString();
    const res = await req(`${baseUrl}/table`, { method: 'POST', headers: { ...hdrs, 'Content-Length': Buffer.byteLength(body) }, body });
    const j = JSON.parse(res.body);
    console.log('\nstream', streamId, 'rows', j.data?.length);
    j.data?.forEach((row, i) => console.log(' ', i, row.map((c) => String(c).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).join(' | ')));
  }

  // stream_view page for stream 1
  const page = await req(`${baseUrl}/stream_view?id=1`, { headers: { Cookie: cookie, Referer: `${baseUrl}/streams` } });
  const srcMatch = page.body.match(/name=\"stream_source\[\]\"[^>]*value=\"([^\"]+)\"/);
  const nameMatch = page.body.match(/name=\"stream_display_name\"[^>]*value=\"([^\"]+)\"/);
  const catMatch = page.body.match(/name=\"category_id\[\]\"[^>]*value=\"([^\"]+)\"/);
  console.log('\nstream_view id=1');
  console.log('name', nameMatch?.[1]);
  console.log('source', srcMatch?.[1]);
  console.log('category', catMatch?.[1]);
  // all stream_source inputs
  const sources = [...page.body.matchAll(/name=\"stream_source\[\]\"[^>]*value=\"([^\"]*)\"/g)].map((m) => m[1]);
  console.log('all sources', sources);
})().catch((e) => { console.error(e); process.exit(1); });
