/**
 * Auditoría de reproducción y rendimiento (Playwright headless).
 * Uso: node server/scripts/browser-audit.js
 */
const { chromium } = require('playwright');
const http = require('http');

const BASE = process.env.VIX_BASE || 'http://127.0.0.1:80';
const USER = process.env.VIX_USER || 'admin';
const PASS = process.env.VIX_PASS || 'admin123';

function ms(start) {
  return `${Date.now() - start}ms`;
}

function apiJson(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login() {
  const t0 = Date.now();
  const res = await apiJson('POST', '/api/auth/login', { username: USER, password: PASS });
  if (!res.data?.token) throw new Error(`Login falló: ${JSON.stringify(res.data)}`);
  let token = res.data.token;
  let profile = res.data.profile || null;
  const profiles = res.data.profiles || [];
  if (!profile && profiles.length) {
    const pick = profiles[0];
    const sel = await apiJson('POST', '/api/profiles/select', { profileId: pick.id }, token);
    if (sel.data?.token) {
      token = sel.data.token;
      profile = sel.data.profile;
    }
  }
  return { token, user: res.data.user, profiles, profile, loginMs: Date.now() - t0 };
}

async function apiTimings(token) {
  const paths = [
    '/api/catalog/home',
    '/api/movies/hero',
    '/api/watch/continue',
    '/api/live/channels?enabled=1',
    '/api/catalog/section/trending?limit=20'
  ];
  const out = [];
  for (const p of paths) {
    const t0 = Date.now();
    const res = await apiJson('GET', p, null, token);
    out.push({ path: p, status: res.status, ms: Date.now() - t0, size: JSON.stringify(res.data).length });
  }
  return out;
}

async function testLiveStreams(token, limit = 8) {
  const res = await apiJson('GET', '/api/live/channels?enabled=1', null, token);
  const channels = (res.data?.channels || res.data || []).filter((c) => c.enabled !== 0).slice(0, limit);
  const results = [];
  for (const ch of channels) {
    const t0 = Date.now();
    const url = ch.stream_url || ch.streamUrl || '';
    if (!url) {
      results.push({ name: ch.name, ok: false, error: 'sin URL' });
      continue;
    }
    try {
      const proxyUrl = `${BASE}/api/live/ch/${ch.id}/play.m3u8?token=${encodeURIComponent(token)}`;
      const head = await fetch(proxyUrl, { method: 'HEAD', signal: AbortSignal.timeout(12000) }).catch(() => null);
      const get0 = Date.now();
      const probe = await fetch(proxyUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-4095' },
        signal: AbortSignal.timeout(15000)
      }).catch((e) => ({ ok: false, status: 0, error: e.message }));
      results.push({
        name: ch.name,
        ok: probe.ok || probe.status === 206,
        status: probe.status,
        headMs: head ? Date.now() - t0 : null,
        firstBytesMs: Date.now() - get0,
        totalMs: Date.now() - t0
      });
    } catch (e) {
      results.push({ name: ch.name, ok: false, error: e.message });
    }
  }
  return results;
}

async function testVodSample(token) {
  const movies = await apiJson('GET', '/api/movies?all=0', null, token);
  const list = Array.isArray(movies.data) ? movies.data.filter((m) => m.available !== 0).slice(0, 5) : [];
  const results = [];
  for (const m of list) {
    const path = m.video_path || '';
    if (!path) {
      results.push({ title: m.title, ok: false, error: 'sin video_path' });
      continue;
    }
    const t0 = Date.now();
    const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-65535', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(20000)
      });
      results.push({
        title: m.title,
        ok: res.ok || res.status === 206,
        status: res.status,
        firstChunkMs: Date.now() - t0
      });
    } catch (e) {
      results.push({ title: m.title, ok: false, error: e.message });
    }
  }
  return results;
}

async function browserAudit(token) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'es-ES'
  });
  await context.addInitScript((t) => {
    localStorage.setItem('vixtv_token', t);
    localStorage.removeItem('xupertv_token');
  }, token);

  const page = await context.newPage();
  const consoleErrors = [];
  const failedReqs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    failedReqs.push({ url: req.url().slice(0, 120), error: req.failure()?.errorText });
  });

  const report = { pages: [], playback: [], consoleErrors: [], failedReqs: [] };

  async function loadPage(name, hash, waitSel) {
    const t0 = Date.now();
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (waitSel) {
      await page.waitForSelector(waitSel, { timeout: 30000 }).catch(() => null);
    }
    await page.waitForTimeout(2500);
    report.pages.push({
      name,
      hash,
      loadMs: Date.now() - t0,
      title: await page.title()
    });
  }

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
  const onLogin = await page.locator('#login-screen.active, #profile-screen.active').count();
  if (onLogin) {
    const profileBtn = page.locator('#profile-grid .profile-card').first();
    if (await profileBtn.count()) {
      await profileBtn.click();
      await page.waitForTimeout(3000);
    }
  }
  await page.waitForSelector('#main-app, .hero-banner, #hero-title, .catalog-row', { timeout: 20000 }).catch(() => null);
  report.pages.push({
    name: 'Inicio',
    hash: '#/',
    loadMs: 0,
    booted: await page.locator('#main-app').count() > 0
  });
  const heroTitle = await page.locator('#hero-title').textContent().catch(() => '');
  const heroHasTrailer = await page.locator('.hero-slide.active.has-trailer').count();
  const rowCount = await page.locator('.catalog-row').count();
  report.pages[report.pages.length - 1].heroTitle = (heroTitle || '').trim();
  report.pages[report.pages.length - 1].heroTrailer = heroHasTrailer > 0;
  report.pages[report.pages.length - 1].catalogRows = rowCount;

  await loadPage('En Vivo', '#/live', '#live-guide, .live-channel, .live-grid');
  const liveChannels = await page.locator('.live-channel, .live-grid .card, [data-channel-id]').count();
  report.pages[report.pages.length - 1].channelCards = liveChannels;

  // Intentar reproducir primer canal en vivo
  const liveCard = page.locator('.live-channel, .live-grid .card, [data-channel-id]').first();
  if (await liveCard.count()) {
    const t0 = Date.now();
    await liveCard.click().catch(() => null);
    await page.waitForTimeout(6000);
    const videoState = await page.evaluate(() => {
      const v = document.querySelector('#live-hero-player video, #player video, video');
      if (!v) return { found: false };
      return {
        found: true,
        paused: v.paused,
        readyState: v.readyState,
        currentTime: v.currentTime,
        networkState: v.networkState,
        error: v.error ? v.error.code : null
      };
    });
    report.playback.push({
      type: 'live',
      clickToCheckMs: Date.now() - t0,
      ...videoState
    });
  }

  await loadPage('Películas', '#/movies', '.catalog-row .card');
  const movieCard = page.locator('.catalog-row .card[data-type="movie"]:visible').first();
  if (await movieCard.count()) {
    const t0 = Date.now();
    await movieCard.scrollIntoViewIfNeeded().catch(() => null);
    await movieCard.click({ force: true });
    await page.waitForSelector('#movie-detail, .movie-detail, .btn-play-movie', { timeout: 15000 }).catch(() => null);
    report.pages.push({ name: 'Detalle película', loadMs: Date.now() - t0 });

    const playBtn = page.locator('.btn-play-movie, #movie-play, button:has-text("Reproducir")').first();
    if (await playBtn.count()) {
      const p0 = Date.now();
      await playBtn.click();
      await page.waitForTimeout(8000);
      const vodState = await page.evaluate(() => {
        const v = document.querySelector('#player video, .player-video video, video');
        if (!v) return { found: false };
        return {
          found: true,
          paused: v.paused,
          readyState: v.readyState,
          currentTime: v.currentTime,
          duration: v.duration,
          buffered: v.buffered.length ? v.buffered.end(0) : 0,
          error: v.error ? v.error.code : null
        };
      });
      report.playback.push({
        type: 'vod',
        startMs: Date.now() - p0,
        ...vodState
      });
    }
  }

  report.consoleErrors = [...new Set(consoleErrors)].slice(0, 20);
  report.failedReqs = failedReqs.slice(0, 15);
  await browser.close();
  return report;
}

(async () => {
  console.log('=== Vix TV Browser Audit ===');
  console.log('Base:', BASE);
  const auth = await login();
  console.log(`Login OK (${auth.loginMs}ms) user=${auth.user.username}`);

  console.log('\n--- API timings ---');
  const apis = await apiTimings(auth.token);
  apis.forEach((a) => console.log(`${a.status} ${a.ms}ms ${a.path} (${Math.round(a.size / 1024)}KB)`));

  console.log('\n--- VOD sample (first bytes) ---');
  const vod = await testVodSample(auth.token);
  vod.forEach((v) => console.log(`${v.ok ? 'OK' : 'FAIL'} ${v.firstChunkMs || '-'}ms ${v.title}${v.error ? ' — ' + v.error : ''}`));

  console.log('\n--- Live streams sample ---');
  const live = await testLiveStreams(auth.token, 6);
  live.forEach((l) => console.log(`${l.ok ? 'OK' : 'FAIL'} ${l.totalMs || '-'}ms ${l.name}${l.error ? ' — ' + l.error : ''}`));

  console.log('\n--- Browser UI audit ---');
  const ui = await browserAudit(auth.token);
  ui.pages.forEach((p) => console.log(JSON.stringify(p)));
  ui.playback.forEach((p) => console.log('PLAYBACK', JSON.stringify(p)));
  if (ui.consoleErrors.length) {
    console.log('\nConsole errors:');
    ui.consoleErrors.forEach((e) => console.log(' -', e.slice(0, 200)));
  }
  if (ui.failedReqs.length) {
    console.log('\nFailed requests:');
    ui.failedReqs.forEach((r) => console.log(' -', r.url, r.error));
  }

  const slowApis = apis.filter((a) => a.ms > 3000);
  const failLive = live.filter((l) => !l.ok);
  const failVod = vod.filter((v) => !v.ok);
  console.log('\n=== RESUMEN ===');
  console.log(`APIs lentas (>3s): ${slowApis.length}`);
  console.log(`VOD fallidos: ${failVod.length}/${vod.length}`);
  console.log(`Live fallidos: ${failLive.length}/${live.length}`);
  console.log(`Errores consola: ${ui.consoleErrors.length}`);
  console.log(`Requests fallidos: ${ui.failedReqs.length}`);
})().catch((err) => {
  console.error('AUDIT ERROR:', err);
  process.exit(1);
});
