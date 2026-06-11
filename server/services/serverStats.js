const os = require('os');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const HISTORY_MAX = 48;
const history = [];

let lastCpu = null;

function readCpuPercent() {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    if (!lastCpu) {
      lastCpu = { idle, total };
      return 0;
    }
    const idleDiff = idle - lastCpu.idle;
    const totalDiff = total - lastCpu.total;
    lastCpu = { idle, total };
    if (totalDiff <= 0) return 0;
    return Math.round((1 - idleDiff / totalDiff) * 1000) / 10;
  } catch {
    const cores = os.cpus().length || 1;
    return Math.min(100, Math.round((os.loadavg()[0] / cores) * 100));
  }
}

function memoryStats() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total,
    used,
    free,
    pct: total ? Math.round((used / total) * 1000) / 10 : 0
  };
}

function diskStats() {
  try {
    const st = fs.statfsSync(DATA);
    const total = st.blocks * st.bsize;
    const free = st.bfree * st.bsize;
    const used = total - free;
    return {
      total,
      used,
      free,
      pct: total ? Math.round((used / total) * 1000) / 10 : 0
    };
  } catch {
    return { total: 0, used: 0, free: 0, pct: 0 };
  }
}

function readNetworkRates() {
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf8');
    let rx = 0;
    let tx = 0;
    raw.split('\n').slice(2).forEach((line) => {
      const m = line.trim().match(/^([^:]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
      if (!m) return;
      const iface = m[1];
      if (iface === 'lo') return;
      rx += parseInt(m[2], 10);
      tx += parseInt(m[3], 10);
    });
    return { rx_bytes: rx, tx_bytes: tx };
  } catch {
    return { rx_bytes: 0, tx_bytes: 0 };
  }
}

let lastNet = null;

function networkMbps() {
  const cur = readNetworkRates();
  const now = Date.now();
  if (!lastNet) {
    lastNet = { ...cur, t: now };
    return { input_mbps: 0, output_mbps: 0 };
  }
  const dt = (now - lastNet.t) / 1000;
  if (dt < 0.5) return { input_mbps: lastNet.in || 0, output_mbps: lastNet.out || 0 };
  const inMbps = Math.max(0, ((cur.rx_bytes - lastNet.rx_bytes) * 8) / dt / 1e6);
  const outMbps = Math.max(0, ((cur.tx_bytes - lastNet.tx_bytes) * 8) / dt / 1e6);
  lastNet = { ...cur, t: now, in: Math.round(inMbps * 10) / 10, out: Math.round(outMbps * 10) / 10 };
  return { input_mbps: lastNet.in, output_mbps: lastNet.out };
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${Math.round(v * 10) / 10} ${u[i]}`;
}

function snapshot(extra = {}) {
  const mem = memoryStats();
  const disk = diskStats();
  const net = networkMbps();
  const cpu = readCpuPercent();
  const point = {
    t: Date.now(),
    cpu,
    memory: mem.pct,
    input_mbps: net.input_mbps,
    output_mbps: net.output_mbps,
    connections: extra.connections || 0,
    live_streams: extra.live_streams || 0,
    down_streams: extra.down_streams || 0
  };
  history.push(point);
  if (history.length > HISTORY_MAX) history.shift();
  return {
    hostname: os.hostname(),
    uptime_sec: os.uptime(),
    uptime: formatUptime(os.uptime()),
    cpu_pct: cpu,
    memory: mem,
    disk,
    network: net,
    load: os.loadavg(),
    history: [...history]
  };
}

module.exports = { snapshot, formatBytes, formatUptime };
