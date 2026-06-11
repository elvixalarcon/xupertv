const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const streamProxyPool = require('./streamProxyPool');
const { resolveUrl } = require('./playlistImport');

const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

function parseProbeOutput(stdout) {
  const streams = JSON.parse(stdout || '{}').streams || [];
  const audio = streams.filter((s) => s.codec_type === 'audio');
  const video = streams.find((s) => s.codec_type === 'video');
  if (!audio.length) {
    return { ok: false, video: video?.codec_name || '', error: 'sin pista de audio' };
  }
  const codec = String(audio[0].codec_name || '').toLowerCase();
  return {
    ok: true,
    codec,
    channels: audio[0].channels || 0,
    video: video?.codec_name || '',
    browser_ok: BROWSER_AUDIO.has(codec)
  };
}

async function probeSegment(url, headers = {}) {
  const proxy = headers._proxy || '';
  const ua = headers['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

  if (proxy) {
    let tmp = '';
    try {
      const res = await streamProxyPool.request(url, {
        headers: { Referer: headers.Referer || '', 'User-Agent': ua, Accept: '*/*' },
        proxy,
        timeout: 22000
      });
      if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}` };
      tmp = path.join(os.tmpdir(), `xui-seg-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
      fs.writeFileSync(tmp, res.body);
      const r = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', tmp], {
        encoding: 'utf8',
        timeout: 15000
      });
      if (r.status !== 0) return { ok: false, error: (r.stderr || 'ffprobe failed').trim().slice(0, 160) };
      return parseProbeOutput(r.stdout);
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    } finally {
      if (tmp) try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }

  const args = [
    '-v', 'error',
    '-show_streams',
    '-of', 'json',
    '-headers', `Referer: ${headers.Referer || ''}\r\nUser-Agent: ${ua}\r\n`,
    '-user_agent', ua,
    url
  ];
  const r = spawnSync('ffprobe', args, { encoding: 'utf8', timeout: 22000 });
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || 'ffprobe failed').trim().slice(0, 160) };
  }
  try {
    return parseProbeOutput(r.stdout);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function probeHlsManifest(url, headers = {}) {
  if (!url) return { ok: false, error: 'URL vacía' };
  try {
    const liveStreamProxy = require('./liveStreamProxy');
    const manifest = await liveStreamProxy.fetchManifestText(url, headers);
    if (liveStreamProxy.isMasterPlaylist(manifest.content)) {
      const hasAudioGroup = /#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/i.test(manifest.content);
      if (hasAudioGroup) {
        return { ok: true, codec: 'hls-audio-group', browser_ok: true, master: true };
      }
    }
    const lines = manifest.content.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    for (const line of lines.slice(0, 3)) {
      const seg = resolveUrl(manifest.base, line);
      const probe = await probeSegment(seg, headers);
      if (probe.ok) return { ...probe, master: false };
    }
    if (lines[0]) {
      return probeSegment(resolveUrl(manifest.base, lines[0]), headers);
    }
    return { ok: false, error: 'playlist sin segmentos' };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function scanInfoFromAudio(probe) {
  if (!probe?.ok) return probe?.error || 'sin audio';
  const parts = [`audio ${probe.codec}`];
  if (probe.channels) parts.push(`${probe.channels}ch`);
  if (probe.browser_ok === false) parts.push('codec no soportado en navegador');
  return parts.join(' · ');
}

module.exports = {
  probeSegment,
  probeHlsManifest,
  scanInfoFromAudio,
  BROWSER_AUDIO
};
