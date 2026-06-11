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

  // Try table with id=stream for edit form sources
  const tableIds = ['stream', 'stream_view', 'stream_sources', 'sources', 'streampage_sources'];
  for (const tid of tableIds) {
    const params = new URLSearchParams({
      draw: '1', start: '0', length: '50', id: tid, stream_id: '1'
    });
    const body = params.toString();
    const res = await req(`${baseUrl}/table`, {
      method: 'POST',
      headers: {
        Cookie: cookie, Referer: `${baseUrl}/stream_view?id=1`,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(body)
      },
      body
    });
    try {
      const j = JSON.parse(res.body);
      if (j.data?.length) console.log('table', tid, 'rows', j.data.length, JSON.stringify(j.data[0]).slice(0, 400));
    } catch { console.log('table', tid, 'non-json', res.body.slice(0, 80)); }
  }

  const page = await req(`${baseUrl}/stream_view?id=1`, { headers: { Cookie: cookie } });
  const idx = page.body.indexOf('stream_source');
  console.log('stream_source idx', idx);
  if (idx >= 0) console.log(page.body.slice(idx, idx + 2000));

  const inputs = [...page.body.matchAll(/<(input|textarea|select)[^>]+name=["']([^"']+)["'][^>]*(?:value=["']([^"']*)["'])?/gi)];
  const interesting = inputs.filter((m) => /stream|source|category|icon|display|url/i.test(m[2]));
  interesting.slice(0, 25).forEach((m) => console.log(m[2], '=', (m[3] || '').slice(0, 120)));

  // search for m3u8 or http in page
  const urls = [...page.body.matchAll(/https?:[^"'\\s<>]+/g)].slice(0, 10);
  urls.forEach((m) => console.log('url in page', m[0].slice(0, 120)));
})().catch((e) => { console.error(e); process.exit(1); });
