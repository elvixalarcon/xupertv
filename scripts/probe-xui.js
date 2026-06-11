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
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: opts.method || 'GET',
      headers: opts.headers || {}, timeout: 15000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

(async () => {
  console.log('baseUrl', baseUrl);
  const body = new URLSearchParams({ username: user, password: pass, login: 'Login' }).toString();
  const login = await req(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body
  });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).find(c => c.startsWith('PHPSESSID='));
  console.log('login', login.status, cookie ? 'OK' : 'FAIL');
  if (!cookie) { console.log(login.body.slice(0, 200)); process.exit(1); }

  const hdrs = { Cookie: cookie, Referer: `${baseUrl}/dashboard`, 'X-Requested-With': 'XMLHttpRequest' };

  const pages = ['dashboard', 'streams', 'lines', 'users', 'servers', 'bouquets', 'categories', 'movies', 'series', 'episodes', 'settings'];
  console.log('\n=== PAGE ROUTES ===');
  for (const p of pages) {
    try {
      const res = await req(`${baseUrl}/${p}`, { headers: { Cookie: cookie } });
      const title = (res.body.match(/<title>([^<]+)/i) || [])[1] || '';
      console.log(p, res.status, title.trim().slice(0, 60));
    } catch (e) { console.log(p, 'ERR', e.message); }
  }

  const dash = await req(`${baseUrl}/dashboard`, { headers: { Cookie: cookie } });
  const navItems = [];
  for (const m of dash.body.matchAll(/navigation-menu[\s\S]*?<\/ul>/gi)) {
    for (const a of m[0].matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = a[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (text) navItems.push({ text, href: a[1] });
    }
  }
  console.log('\n=== NAV MENU ===');
  navItems.forEach(x => console.log(`  ${x.text} -> ${x.href}`));

  const actions = ['stats', 'graph_stats', 'header_stats', 'live_connections', 'activity', 'get_streams', 'get_lines', 'get_users', 'get_servers', 'get_bouquets', 'get_categories', 'get_movies', 'get_series'];
  console.log('\n=== API ACTIONS ===');
  for (const action of actions) {
    try {
      const res = await req(`${baseUrl}/api?action=${action}`, { headers: hdrs });
      let info = res.body.slice(0, 100).replace(/\s+/g, ' ');
      try {
        const j = JSON.parse(res.body);
        if (Array.isArray(j)) info = `array[${j.length}] keys:${Object.keys(j[0]||{}).slice(0,5).join(',')}`;
        else info = `object keys:${Object.keys(j).slice(0,10).join(',')}`;
      } catch {}
      console.log(`  ${action}: ${res.status} ${info}`);
    } catch (e) { console.log(`  ${action}: ERR ${e.message}`); }
  }
})().catch(e => { console.error(e); process.exit(1); });
