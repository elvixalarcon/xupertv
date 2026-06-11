const https = require('https');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');
const { setSetting } = require('../services/settings');

const TESTS = [
  {
    name: 'ECDF',
    url: 'https://regionales.saohgdasregions.fun/stream.php?canal=ecdf&target=1',
    referer: 'https://www.tvporinternet2.com/ecdf-en-vivo-por-internet.php'
  },
  {
    name: 'Disney',
    url: 'https://regionales.saohgdasregions.fun/stream.php?canal=disneychannel&target=1',
    referer: 'https://www.tvporinternet2.com/disney-channel-en-vivo-por-internet.php'
  },
  {
    name: 'ESPN',
    url: 'https://regionales.saohgdasregions.fun/stream.php?canal=espn&target=1',
    referer: 'https://www.tvporinternet2.com/espn-en-vivo-por-internet.php'
  }
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function fetchProxyList() {
  return new Promise((resolve, reject) => {
    https.get('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all', (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)));
    }).on('error', reject);
  });
}

function connectViaProxy(proxyUrl, targetHost, targetPort) {
  const u = new URL(proxyUrl.startsWith('http') ? proxyUrl : `http://${proxyUrl}`);
  return new Promise((resolve, reject) => {
    const socket = net.connect(parseInt(u.port || '80', 10), u.hostname, () => {
      socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
    });
    let header = Buffer.alloc(0);
    const onData = (chunk) => {
      header = Buffer.concat([header, chunk]);
      const marker = header.indexOf('\r\n\r\n');
      if (marker === -1) return;
      socket.removeListener('data', onData);
      const statusLine = header.slice(0, marker).toString('utf8').split('\r\n')[0] || '';
      if (!/ 200 /.test(statusLine)) {
        socket.destroy();
        return reject(new Error(statusLine));
      }
      resolve({ socket, leftover: header.slice(marker + 4) });
    };
    socket.on('data', onData);
    socket.on('error', reject);
    socket.setTimeout(12000, () => { socket.destroy(); reject(new Error('timeout')); });
  });
}

function requestViaProxy(proxyUrl, test) {
  const target = new URL(test.url);
  return connectViaProxy(proxyUrl, target.hostname, 443).then(({ socket, leftover }) => new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({ socket, servername: target.hostname, rejectUnauthorized: false }, () => {
      if (leftover.length) tlsSocket.unshift(leftover);
      tlsSocket.write(
        `GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\n`
        + `User-Agent: ${UA}\r\nReferer: ${test.referer}\r\nAccept: text/html,*/*\r\nConnection: close\r\n\r\n`
      );
    });
    const chunks = [];
    tlsSocket.on('data', (c) => chunks.push(c));
    tlsSocket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n');
      resolve({
        blocked: /registrada en nuestra base de datos/i.test(body),
        hasM3u8: /\.m3u8/i.test(body) || /var\s+src/i.test(body)
      });
    });
    tlsSocket.on('error', reject);
    tlsSocket.setTimeout(15000, () => { tlsSocket.destroy(); reject(new Error('timeout')); });
  }));
}

async function scoreProxy(proxyRaw) {
  const proxyUrl = proxyRaw.startsWith('http') ? proxyRaw : `http://${proxyRaw}`;
  let score = 0;
  for (const test of TESTS) {
    try {
      const r = await requestViaProxy(proxyUrl, test);
      if (r.hasM3u8 && !r.blocked) score++;
    } catch {
      return 0;
    }
  }
  return score;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const maxScan = parseInt(process.argv.find((a) => a.startsWith('--scan='))?.split('=')[1] || '120', 10);
  const list = await fetchProxyList();
  console.log(`Escaneando ${Math.min(maxScan, list.length)} proxies…`);

  const ranked = [];
  for (const raw of list.slice(0, maxScan)) {
    try {
      const score = await scoreProxy(raw);
      if (score > 0) {
        const proxyUrl = raw.startsWith('http') ? raw : `http://${raw}`;
        ranked.push({ proxyUrl, score });
        console.log(`OK score=${score} ${proxyUrl}`);
        if (ranked.length >= 8) break;
      }
    } catch {
      /* skip */
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  const picked = ranked.slice(0, 5).map((r) => r.proxyUrl);
  console.log(JSON.stringify({ scanned: Math.min(maxScan, list.length), found: picked.length, proxies: picked }, null, 2));

  if (apply && picked.length) {
    setSetting('stream_proxy_enabled', '1');
    setSetting('stream_proxy_list', picked.join('\n'));
    console.log('Proxy aplicado en settings (enabled=1)');
  } else if (apply) {
    console.error('No se encontraron proxies válidos para aplicar');
    process.exit(1);
  }
})();
