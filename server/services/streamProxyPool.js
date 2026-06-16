const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { getSetting } = require('./settings');

const failedUntil = new Map();
const FAIL_TTL_MS = 3 * 60 * 1000;
let roundRobin = 0;

function needsStreamProxy(url = '') {
  return /saohgdasregions\.fun|ksdjugfsddeports\.com/i.test(String(url || ''));
}

function streamOriginFor(url = '') {
  const u = String(url || '');
  if (/deportes\.ksdjugfsddeports\.com/i.test(u)) return 'https://deportes.ksdjugfsddeports.com';
  if (/saohgdasregions\.fun/i.test(u)) return 'https://regionales.saohgdasregions.fun';
  return '';
}

function isEnabled() {
  const env = process.env.STREAM_PROXY_ENABLED || '';
  if (env === '1' || env === 'true') return true;
  return getSetting('stream_proxy_enabled', '') === '1'
    || getSetting('stream_proxy_enabled', '') === 'true';
}

function parseProxyList(raw = '') {
  const env = process.env.STREAM_PROXY_LIST || '';
  const text = String(raw || env || '').trim();
  if (!text) return [];
  return text
    .split(/[\r\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseProxyUrl)
    .filter(Boolean);
}

function listProxies() {
  if (!isEnabled()) return [];
  return parseProxyList(getSetting('stream_proxy_list', ''));
}

function parseProxyUrl(raw) {
  try {
    let value = String(raw || '').trim();
    if (!value) return null;
    if (!/^[a-z]+:\/\//i.test(value)) value = `http://${value}`;
    const u = new URL(value);
    if (!u.hostname) return null;
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return {
      raw: value,
      protocol: u.protocol.replace(':', ''),
      host: u.hostname,
      port: parseInt(port, 10),
      username: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || '')
    };
  } catch {
    return null;
  }
}

function markFailed(raw, reason = '') {
  if (!raw) return;
  failedUntil.set(raw, Date.now() + FAIL_TTL_MS);
}

function isFailed(raw) {
  const until = failedUntil.get(raw);
  if (!until) return false;
  if (until < Date.now()) {
    failedUntil.delete(raw);
    return false;
  }
  return true;
}

function pickProxy(exclude = new Set()) {
  const pool = listProxies().filter((p) => !isFailed(p.raw) && !exclude.has(p.raw));
  if (!pool.length) return null;
  roundRobin = (roundRobin + 1) % pool.length;
  return pool[roundRobin];
}

function getProxiesToTry(max = 8) {
  if (!isEnabled()) return [null];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < max; i++) {
    const p = pickProxy(seen);
    if (!p) break;
    if (seen.has(p.raw)) continue;
    seen.add(p.raw);
    out.push(p.raw);
  }
  return out.length ? out : [null];
}

function resolveProxy(explicit = '') {
  const direct = String(explicit || '').trim();
  if (direct) return direct;
  if (!isEnabled()) return '';
  const picked = pickProxy();
  return picked?.raw || '';
}

function proxyAuthHeader(proxy) {
  if (!proxy?.username) return '';
  const token = Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64');
  return `Proxy-Authorization: Basic ${token}\r\n`;
}

function connectViaProxy(proxyUrl, targetHost, targetPort) {
  const proxy = parseProxyUrl(proxyUrl);
  if (!proxy) return Promise.reject(new Error('Proxy inválido'));

  return new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host, () => {
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`
        + `Host: ${targetHost}:${targetPort}\r\n`
        + proxyAuthHeader(proxy)
        + `\r\n`
      );
    });

    let header = Buffer.alloc(0);
    const onData = (chunk) => {
      header = Buffer.concat([header, chunk]);
      const marker = header.indexOf('\r\n\r\n');
      if (marker === -1) return;
      socket.removeListener('data', onData);
      const head = header.slice(0, marker).toString('utf8');
      const statusLine = head.split('\r\n')[0] || '';
      if (!/ 200 /.test(statusLine)) {
        socket.destroy();
        markFailed(proxyUrl, statusLine);
        return reject(new Error(`Proxy CONNECT falló: ${statusLine}`));
      }
      const leftover = header.slice(marker + 4);
      resolve({ socket, leftover, proxyUrl });
    };

    socket.on('data', onData);
    socket.on('error', (err) => {
      markFailed(proxyUrl, err.message);
      reject(err);
    });
    socket.setTimeout(25000, () => {
      socket.destroy();
      markFailed(proxyUrl, 'timeout');
      reject(new Error('Timeout de proxy'));
    });
  });
}

function parseHttpResponse(rawBuffer) {
  const marker = rawBuffer.indexOf('\r\n\r\n');
  if (marker === -1) throw new Error('Respuesta HTTP incompleta');
  const head = rawBuffer.slice(0, marker).toString('utf8');
  const body = rawBuffer.slice(marker + 4);
  const lines = head.split('\r\n');
  const statusMatch = lines[0].match(/HTTP\/\d\.\d\s+(\d+)/i);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx === -1) continue;
    headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
  }
  return { status, headers, body };
}

function requestDirect(url, headers = {}, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout,
      headers,
      rejectUnauthorized: false
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers || {},
          body: Buffer.concat(chunks),
          url
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function requestViaProxy(proxyUrl, url, headers = {}, timeout = 25000) {
  const target = new URL(url);
  const port = parseInt(target.port || (target.protocol === 'https:' ? 443 : 80), 10);
  const { socket, leftover } = await connectViaProxy(proxyUrl, target.hostname, port);

  if (target.protocol === 'http:') {
    return new Promise((resolve, reject) => {
      const proxy = parseProxyUrl(proxyUrl);
      const path = target.href;
      const reqLine = `GET ${path} HTTP/1.1\r\nHost: ${target.host}\r\n${proxyAuthHeader(proxy)}`
        + Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')
        + `\r\nConnection: close\r\n\r\n`;
      socket.write(reqLine);
      const chunks = leftover.length ? [leftover] : [];
      socket.on('data', (c) => chunks.push(c));
      socket.on('end', () => {
        try {
          const parsed = parseHttpResponse(Buffer.concat(chunks));
          resolve({
            status: parsed.status,
            headers: parsed.headers,
            body: parsed.body,
            url,
            proxyUrl
          });
        } catch (err) {
          reject(err);
        }
      });
      socket.on('error', reject);
      socket.setTimeout(timeout, () => { socket.destroy(); reject(new Error('Timeout')); });
    });
  }

  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket,
      servername: target.hostname,
      rejectUnauthorized: false
    }, () => {
      if (leftover.length) tlsSocket.unshift(leftover);
      const reqLine = `GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\n`
        + Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')
        + `\r\nConnection: close\r\n\r\n`;
      tlsSocket.write(reqLine);
    });

    const chunks = [];
    tlsSocket.on('data', (c) => chunks.push(c));
    tlsSocket.on('end', () => {
      try {
        const parsed = parseHttpResponse(Buffer.concat(chunks));
        resolve({
          status: parsed.status,
          headers: parsed.headers,
          body: parsed.body,
          url,
          proxyUrl
        });
      } catch (err) {
        reject(err);
      }
    });
    tlsSocket.on('error', (err) => {
      markFailed(proxyUrl, err.message);
      reject(err);
    });
    tlsSocket.setTimeout(timeout, () => {
      tlsSocket.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function request(url, opts = {}) {
  const headers = opts.headers || {};
  const timeout = opts.timeout || 25000;
  const maxRedirects = opts.maxRedirects ?? 6;
  const proxyUrl = resolveProxy(opts.proxy || '');

  const doRequest = (currentUrl, redirectsLeft) => {
    const run = proxyUrl
      ? requestViaProxy(proxyUrl, currentUrl, headers, timeout)
      : requestDirect(currentUrl, headers, timeout);
    return run.then((res) => {
      const location = res.headers.location || res.headers.Location;
      if (location && redirectsLeft > 0 && [301, 302, 303, 307, 308].includes(res.status)) {
        const next = location.startsWith('http') ? location : new URL(location, currentUrl).href;
        return doRequest(next, redirectsLeft - 1);
      }
      return { ...res, url: location && [301, 302, 303, 307, 308].includes(res.status)
        ? (location.startsWith('http') ? location : new URL(location, currentUrl).href)
        : currentUrl };
    });
  };

  return doRequest(url, maxRedirects);
}

async function fetchText(url, opts = {}) {
  const res = await request(url, opts);
  return {
    status: res.status,
    url: res.url,
    body: res.body.toString('utf8'),
    proxyUrl: res.proxyUrl || opts.proxy || ''
  };
}

function pipeViaProxy(proxyUrl, url, res, reqHeaders = {}) {
  const target = new URL(url);
  const port = parseInt(target.port || (target.protocol === 'https:' ? 443 : 80), 10);

  connectViaProxy(proxyUrl, target.hostname, port)
    .then(({ socket, leftover }) => {
      const tlsSocket = tls.connect({
        socket,
        servername: target.hostname,
        rejectUnauthorized: false
      }, () => {
        if (leftover.length) tlsSocket.unshift(leftover);
        const reqLine = `GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\n`
          + Object.entries(reqHeaders).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k}: ${v}`).join('\r\n')
          + (reqHeaders.Range ? `\r\nRange: ${reqHeaders.Range}` : '')
          + `\r\nConnection: close\r\n\r\n`;
        tlsSocket.write(reqLine);

        let headerDone = false;
        let buffer = Buffer.alloc(0);
        const onData = (chunk) => {
          if (headerDone) {
            res.write(chunk);
            return;
          }
          buffer = Buffer.concat([buffer, chunk]);
          const marker = buffer.indexOf('\r\n\r\n');
          if (marker === -1) return;
          const head = buffer.slice(0, marker).toString('utf8');
          const status = parseInt((head.split('\r\n')[0].match(/ (\d+) /) || [])[1] || '502', 10);
          headerDone = true;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Accept-Ranges', 'bytes');
          if (status >= 400) {
            res.status(status >= 500 ? 502 : status).end();
            tlsSocket.destroy();
            return;
          }
          res.status(status);
          const rest = buffer.slice(marker + 4);
          if (rest.length) res.write(rest);
        };
        tlsSocket.on('data', onData);
        tlsSocket.on('end', () => res.end());
        tlsSocket.on('error', () => { if (!res.writableEnded) res.status(502).end(); });
      });
    })
    .catch(() => { if (!res.writableEnded) res.status(502).end(); });
}

async function testProxy(proxyUrl) {
  const res = await requestViaProxy(
    proxyUrl,
    'https://api.ipify.org?format=json',
    { 'User-Agent': 'VixTV/1.0', Accept: 'application/json' },
    20000
  );
  const body = res.body.toString('utf8');
  const ip = JSON.parse(body).ip || body.trim();
  return { ok: true, ip, proxy: proxyUrl };
}

function settingsSnapshot() {
  const list = parseProxyList(getSetting('stream_proxy_list', ''));
  return {
    stream_proxy_enabled: isEnabled(),
    stream_proxy_count: list.length,
    stream_proxy_list: getSetting('stream_proxy_list', process.env.STREAM_PROXY_LIST || '')
  };
}

module.exports = {
  isEnabled,
  needsStreamProxy,
  streamOriginFor,
  listProxies,
  parseProxyList,
  pickProxy,
  getProxiesToTry,
  resolveProxy,
  markFailed,
  request,
  fetchText,
  pipeViaProxy,
  testProxy,
  settingsSnapshot
};
