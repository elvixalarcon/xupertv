const fs = require('fs');
const path = require('path');
const { listResumableMovies, hasPartialFiles, destBaseFromMovie, findFinishedFile } = require('./vodYtDlp');
const { isYtDlpRunning } = require('./vodDownloadProgress');
const { getSetting } = require('./settings');
const { spawn } = require('child_process');

function downloadsAllowed() {
  return getSetting('vod_queue_enabled', '1') !== '0'
    && getSetting('vod_downloads_paused', '0') !== '1';
}

let timer = null;
let resuming = false;

function logStale(movie, maxMin = 5) {
  const base = destBaseFromMovie(movie);
  const winscp = path.join(__dirname, '..', '..', 'data', 'winscp');
  if (!fs.existsSync(winscp)) return true;
  let best = 0;
  for (const name of fs.readdirSync(winscp)) {
    if (!name.endsWith('.log') || !name.includes(base.slice(0, 10))) continue;
    try {
      best = Math.max(best, fs.statSync(path.join(winscp, name)).mtimeMs);
    } catch { /* ignore */ }
  }
  return !best || Date.now() - best > maxMin * 60 * 1000;
}

function tick() {
  if (!downloadsAllowed()) return;
  if (resuming || isYtDlpRunning()) return;
  const list = listResumableMovies().filter((m) => {
    if (findFinishedFile(destBaseFromMovie(m))) return false;
    if (!hasPartialFiles(destBaseFromMovie(m))) return false;
    return logStale(m);
  });
  if (!list.length) return;
  const m = list[0];
  resuming = true;
  console.log(`[vod-stuck] Reanudando automáticamente #${m.id} ${m.title}`);
  const script = path.join(__dirname, '..', 'scripts', 'resume-vod-download.js');
  const child = spawn('node', [script, String(m.id)], {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..', '..')
  });
  child.unref();
  child.on('close', () => { resuming = false; });
  setTimeout(() => { resuming = false; }, 60000);
}

function startVodStuckWatch() {
  if (timer) return;
  timer = setInterval(tick, 90 * 1000);
  if (timer.unref) timer.unref();
  console.log('[vod-stuck] Vigilancia de descargas cortadas activa (cada 3 min)');
}

module.exports = { startVodStuckWatch };
