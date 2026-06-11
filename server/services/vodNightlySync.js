const { execSync } = require('child_process');
const { getSetting, setSetting } = require('./settings');
const cuevanaImport = require('./cuevanaImport');
const allcalidadImport = require('./allcalidadImport');

const TZ = 'America/Guayaquil';
let tickTimer = null;
let running = false;

function ecuadorNow() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    label: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (Ecuador)`
  };
}

function isEnabled() {
  return getSetting('vod_nightly_enabled', '1') !== '0';
}

function isPaused() {
  return getSetting('vod_nightly_paused', '0') === '1';
}

function cuevanaEnabled() {
  return getSetting('vod_nightly_cuevana', '1') !== '0';
}

function allcalidadEnabled() {
  return getSetting('vod_nightly_allcalidad', '1') !== '0';
}

function parseYears() {
  const raw = getSetting('vod_nightly_years', '2026,2025,2024');
  return raw.split(',').map((y) => parseInt(y.trim(), 10)).filter((y) => y >= 1900);
}

function downloadLimitPerSource() {
  return Math.max(0, parseInt(getSetting('vod_nightly_limit', '2'), 10) || 2);
}

function scheduleHour() {
  return parseInt(getSetting('vod_nightly_hour', '2'), 10) || 2;
}

function scheduleMinute() {
  return parseInt(getSetting('vod_nightly_minute', '0'), 10) || 0;
}

function ytDlpRunning() {
  const { isYtDlpRunning } = require('./vodDownloadProgress');
  return isYtDlpRunning();
}

function shouldRunNow(force = false) {
  if (force) return true;
  if (!isEnabled() || isPaused()) return false;
  const now = ecuadorNow();
  const h = scheduleHour();
  const m = scheduleMinute();
  if (now.hour !== h) return false;
  if (now.minute < m || now.minute > m + 8) return false;
  const lastDate = getSetting('vod_nightly_last_date', '');
  return lastDate !== now.dateKey;
}

function getPublicSettings() {
  const last = getSetting('vod_nightly_last_result', '');
  let lastResult = null;
  try {
    if (last) lastResult = JSON.parse(last);
  } catch { /* ignore */ }

  return {
    vod_nightly_enabled: isEnabled(),
    vod_nightly_paused: isPaused(),
    vod_nightly_cuevana: cuevanaEnabled(),
    vod_nightly_allcalidad: allcalidadEnabled(),
    vod_nightly_years: getSetting('vod_nightly_years', '2026,2025,2024'),
    vod_nightly_limit: downloadLimitPerSource(),
    vod_nightly_hour: scheduleHour(),
    vod_nightly_minute: scheduleMinute(),
    vod_nightly_timezone: TZ,
    vod_nightly_last_date: getSetting('vod_nightly_last_date', ''),
    vod_nightly_last_run: getSetting('vod_nightly_last_run', ''),
    vod_nightly_last_result: lastResult,
    vod_nightly_next_hint: `Todos los días ${String(scheduleHour()).padStart(2, '0')}:${String(scheduleMinute()).padStart(2, '0')} hora Ecuador`,
    ecuador_now: ecuadorNow().label
  };
}

function applySettings(body = {}) {
  if (body.vod_nightly_enabled !== undefined) {
    setSetting('vod_nightly_enabled', body.vod_nightly_enabled ? '1' : '0');
  }
  if (body.vod_nightly_paused !== undefined) {
    setSetting('vod_nightly_paused', body.vod_nightly_paused ? '1' : '0');
  }
  if (body.vod_nightly_cuevana !== undefined) {
    setSetting('vod_nightly_cuevana', body.vod_nightly_cuevana ? '1' : '0');
  }
  if (body.vod_nightly_allcalidad !== undefined) {
    setSetting('vod_nightly_allcalidad', body.vod_nightly_allcalidad ? '1' : '0');
  }
  if (body.vod_nightly_years !== undefined) {
    setSetting('vod_nightly_years', String(body.vod_nightly_years || '2026,2025,2024').trim());
  }
  if (body.vod_nightly_limit !== undefined) {
    setSetting('vod_nightly_limit', String(Math.max(0, parseInt(body.vod_nightly_limit, 10) || 0)));
  }
  if (body.vod_nightly_hour !== undefined) {
    const h = Math.min(23, Math.max(0, parseInt(body.vod_nightly_hour, 10) || 2));
    setSetting('vod_nightly_hour', String(h));
  }
  if (body.vod_nightly_minute !== undefined) {
    const m = Math.min(59, Math.max(0, parseInt(body.vod_nightly_minute, 10) || 0));
    setSetting('vod_nightly_minute', String(m));
  }
}

async function runNightlyJob(options = {}) {
  const force = !!options.force;
  if (running) return { skipped: true, reason: 'job en curso' };
  if (!force && (!isEnabled() || isPaused())) {
    return { skipped: true, reason: 'automatización desactivada o en pausa' };
  }
  if (!force && ytDlpRunning()) {
    return { skipped: true, reason: 'hay otra descarga yt-dlp activa' };
  }

  running = true;
  const started = Date.now();
  const years = parseYears();
  const limit = options.limit ?? downloadLimitPerSource();
  const result = {
    started_at: new Date().toISOString(),
    years,
    limit_per_source: limit,
    cuevana: { discovered: 0, catalog: 0, downloaded: 0, errors: [] },
    allcalidad: { discovered: 0, catalog: 0, downloaded: 0, errors: [] }
  };

  try {
    if (force || cuevanaEnabled()) {
      try {
        const discovered = await cuevanaImport.discoverNewMovies(years, 60);
        result.cuevana.discovered = discovered.length;
        let dl = 0;
        for (const m of discovered) {
          try {
            if (dl < limit && !ytDlpRunning()) {
              await cuevanaImport.importMovie(m.slug, { download: true, recommended: true });
              result.cuevana.downloaded++;
              dl++;
            } else {
              await cuevanaImport.importMovie(m.slug, { download: false, recommended: true });
              result.cuevana.catalog++;
            }
          } catch (err) {
            result.cuevana.errors.push({ slug: m.slug, title: m.title, error: err.message });
          }
        }
      } catch (err) {
        result.cuevana.errors.push({ error: err.message });
      }
    }

    if (force || allcalidadEnabled()) {
      try {
        const discovered = await allcalidadImport.discoverNewMovies(years);
        result.allcalidad.discovered = discovered.length;
        let dl = 0;
        for (const m of discovered) {
          try {
            if (dl < limit && !ytDlpRunning()) {
              await allcalidadImport.importMovie(m.slug, { download: true, recommended: true });
              result.allcalidad.downloaded++;
              dl++;
            } else {
              await allcalidadImport.importMovie(m.slug, { download: false, recommended: true });
              result.allcalidad.catalog++;
            }
          } catch (err) {
            result.allcalidad.errors.push({ slug: m.slug, error: err.message });
          }
        }
      } catch (err) {
        result.allcalidad.errors.push({ error: err.message });
      }
    }

    result.duration_ms = Date.now() - started;
    result.finished_at = new Date().toISOString();
    const now = ecuadorNow();
    setSetting('vod_nightly_last_date', now.dateKey);
    setSetting('vod_nightly_last_run', result.finished_at);
    setSetting('vod_nightly_last_result', JSON.stringify(result));
    console.log('[vod-nightly] completado', JSON.stringify({
      cuevana: result.cuevana.downloaded,
      allcalidad: result.allcalidad.downloaded,
      errors: result.cuevana.errors.length + result.allcalidad.errors.length
    }));
    return result;
  } finally {
    running = false;
  }
}

function tick() {
  if (!shouldRunNow(false)) return;
  console.log('[vod-nightly] Iniciando job programado (Ecuador 2:00 AM)');
  runNightlyJob().catch((err) => {
    console.error('[vod-nightly]', err.message);
    setSetting('vod_nightly_last_result', JSON.stringify({
      error: err.message,
      at: new Date().toISOString()
    }));
  });
}

function startVodNightlyScheduler() {
  if (tickTimer) return;
  if (!isEnabled()) return;
  tickTimer = setInterval(tick, 60 * 1000);
  if (tickTimer.unref) tickTimer.unref();
  console.log(`[vod-nightly] Programador activo · ${scheduleHour()}:${String(scheduleMinute()).padStart(2, '0')} ${TZ}`);
}

function stopVodNightlyScheduler() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function restartVodNightlyScheduler() {
  stopVodNightlyScheduler();
  startVodNightlyScheduler();
}

module.exports = {
  runNightlyJob,
  getPublicSettings,
  applySettings,
  startVodNightlyScheduler,
  stopVodNightlyScheduler,
  restartVodNightlyScheduler,
  ecuadorNow,
  isEnabled,
  isPaused
};
