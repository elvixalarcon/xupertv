#!/usr/bin/env node
const https = require('https');
const { setSetting } = require('../services/settings');
const streamProxyPool = require('../services/streamProxyPool');
const { importChannels } = require('../services/tvPorInternet');

const STREAM_TESTS = [
  {
    url: 'https://regionales.saohgdasregions.fun/stream.php?canal=history&target=1',
    referer: 'https://www.tvporinternet2.com/history-en-vivo-por-internet.php'
  },
  {
    url: 'https://regionales.saohgdasregions.fun/stream.php?canal=ecdf&target=1',
    referer: 'https://www.tvporinternet2.com/ecdf-en-vivo-por-internet.php'
  },
  {
    url: 'https://regionales.saohgdasregions.fun/stream.php?canal=espn&target=1',
    referer: 'https://www.tvporinternet2.com/espn-en-vivo-por-internet.php'
  }
];

function fetchProxyList() {
  return new Promise((resolve, reject) => {
    https.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all', (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)));
    }).on('error', reject);
  });
}

async function testProxyOnStream(proxyRaw, test) {
  const proxy = proxyRaw.startsWith('http') ? proxyRaw : `http://${proxyRaw}`;
  const res = await streamProxyPool.request(test.url, {
    proxy,
    timeout: 12000,
    headers: {
      Referer: test.referer,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,*/*'
    }
  });
  const body = res.body.toString('utf8');
  return {
    ok: /\.m3u8/i.test(body) && !/registrada en nuestra base de datos/i.test(body),
    blocked: /registrada en nuestra base de datos/i.test(body)
  };
}

async function findWorkingProxies(maxScan = 500, need = 5) {
  const list = await fetchProxyList();
  const ranked = new Map();
  console.log(`Buscando proxies operativos (máx. ${maxScan})…`);

  for (const raw of list.slice(0, maxScan)) {
    const proxy = raw.startsWith('http') ? raw : `http://${raw}`;
    let score = 0;
    try {
      for (const test of STREAM_TESTS) {
        const r = await testProxyOnStream(proxy, test);
        if (r.ok) score++;
      }
      if (score > 0) {
        ranked.set(proxy, score);
        console.log(`✓ ${proxy} (${score}/${STREAM_TESTS.length})`);
        if (ranked.size >= need * 2) break;
      }
    } catch {
      /* skip dead proxy */
    }
  }

  return [...ranked.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, need)
    .map(([proxy]) => proxy);
}

const REIMPORT = [
  'ECDF', 'El Canal del Fútbol',
  'Disney Channel', 'Cinemax', 'Warner Channel', 'Universal',
  'ESPN', 'ESPN 2', 'Fox Sports', 'DirecTV Sports', 'TNT Sports',
  'Win Sports Plus', 'TyC Sports', 'Liga 1', 'ECDF'
];

(async () => {
  const proxies = await findWorkingProxies(500, 5);
  if (!proxies.length) {
    console.error('No se encontraron proxies HTTP operativos. Agrega proxies manualmente en Admin → Ajustes.');
    process.exit(1);
  }

  setSetting('stream_proxy_enabled', '1');
  setSetting('stream_proxy_list', proxies.join('\n'));
  console.log('\nProxy activado con', proxies.length, 'servidores:');
  proxies.forEach((p) => console.log(' •', p));

  console.log('\nReimportando canales bloqueados…');
  const names = [...new Set(REIMPORT)];
  const result = await importChannels(names);
  console.log(JSON.stringify({
    proxy_count: proxies.length,
    reimport: {
      total: result.total,
      imported: result.imported,
      failed: result.failed
    }
  }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
