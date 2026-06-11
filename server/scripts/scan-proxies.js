#!/usr/bin/env node
const https = require('https');
const streamProxyPool = require('../services/streamProxyPool');
const { setSetting } = require('../services/settings');

const TEST = {
  url: process.argv[2] || 'https://regionales.saohgdasregions.fun/stream.php?canal=liga1&target=1',
  referer: process.argv[3] || 'https://www.tvporinternet2.com/liga-1-en-vivo-por-internet.php'
};

function fetchList() {
  return new Promise((resolve, reject) => {
    https.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all', (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)));
    }).on('error', reject);
  });
}

(async () => {
  const list = await fetchList();
  const good = [];
  console.log('Scanning', list.length, 'proxies for', TEST.url);
  for (const raw of list) {
    const proxy = raw.startsWith('http') ? raw : `http://${raw}`;
    try {
      const res = await streamProxyPool.request(TEST.url, {
        proxy,
        timeout: 9000,
        headers: {
          Referer: TEST.referer,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,*/*'
        }
      });
      const body = res.body.toString('utf8');
      if (/\.m3u8/i.test(body) && !/registrada en nuestra base de datos/i.test(body)) {
        good.push(proxy);
        console.log('OK', proxy);
        if (good.length >= 10) break;
      }
    } catch {
      /* skip */
    }
  }
  if (good.length && process.argv.includes('--apply')) {
    const existing = streamProxyPool.listProxies().map((p) => p.raw);
    const merged = [...new Set([...good, ...existing])].slice(0, 15);
    setSetting('stream_proxy_enabled', '1');
    setSetting('stream_proxy_list', merged.join('\n'));
    console.log('Applied', merged.length, 'proxies');
  }
  console.log('FOUND', good.length);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
