const db = require('../db');
const tv = require('../services/tvPorInternet');
const live = require('../services/liveStreamProxy');
const { configFromChannel } = require('../services/channelConfig');
const { resolveUrl } = require('../services/playlistImport');
const { spawnSync } = require('child_process');

function probeSegment(seg, hdrs) {
  const args = [
    '-v', 'error', '-show_streams', '-of', 'json',
    '-headers', `Referer: ${hdrs.Referer || ''}\r\nUser-Agent: ${hdrs['User-Agent'] || ''}\r\n`,
    '-user_agent', hdrs['User-Agent'] || 'Mozilla/5.0',
    seg
  ];
  const r = spawnSync('ffprobe', args, { encoding: 'utf8', timeout: 25000 });
  if (r.status !== 0) return { ok: false, err: (r.stderr || 'ffprobe failed').trim().slice(0, 120) };
  const j = JSON.parse(r.stdout || '{}');
  const aud = (j.streams || []).filter((s) => s.codec_type === 'audio');
  const vid = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!aud.length) {
    return { ok: false, video: vid?.codec_name || '?', err: 'sin pista de audio' };
  }
  return {
    ok: true,
    codec: aud[0].codec_name,
    channels: aud[0].channels || 0,
    video: vid?.codec_name || '?'
  };
}

async function probeSource(src, hdrs) {
  const resolved = await tv.resolveSourceStream(src, hdrs.Referer);
  if (!resolved?.url) return { label: src.label, ok: false, err: 'sin url' };
  const manifest = await live.fetchManifestText(resolved.url, {
    ...hdrs,
    Referer: resolved.referer || hdrs.Referer
  });
  const lines = manifest.content.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  for (const line of lines.slice(0, 3)) {
    const seg = resolveUrl(manifest.base, line);
    const probe = probeSegment(seg, { ...hdrs, Referer: resolved.referer || hdrs.Referer });
    if (probe.ok) {
      return { label: src.label, ok: true, codec: probe.codec, channels: probe.channels, seg: line };
    }
  }
  const seg = lines[0] ? resolveUrl(manifest.base, lines[0]) : '';
  const last = seg ? probeSegment(seg, { ...hdrs, Referer: resolved.referer || hdrs.Referer }) : { err: 'sin segmentos' };
  return { label: src.label, ok: false, err: last.err || 'sin audio' };
}

(async () => {
  const channels = db.prepare(`
    SELECT * FROM live_channels
    WHERE config LIKE '%tvporinternet%' OR config LIKE '%saohgdasregions%'
    ORDER BY name COLLATE NOCASE
  `).all();

  const report = [];
  for (const ch of channels) {
    const cfg = configFromChannel(ch);
    let hdrs = live.channelHeaders(ch);
    hdrs = await tv.resolveChannelHeaders(ch, hdrs);
    const sources = (cfg.sources || []).filter((s) =>
      s.resolver === 'tvporinternet' || /saohgdasregions\.fun\/stream\.php/i.test(s.url || '')
    );
    const sourceResults = [];
    for (const src of sources.slice(0, 4)) {
      try {
        sourceResults.push(await probeSource(src, hdrs));
      } catch (err) {
        sourceResults.push({ label: src.label || src.url, ok: false, err: err.message.slice(0, 100) });
      }
    }
    const working = sourceResults.filter((s) => s.ok);
    report.push({
      id: ch.id,
      name: ch.name,
      has_audio: working.length > 0,
      working_sources: working.length,
      total_sources: sourceResults.length,
      sources: sourceResults
    });
  }

  const noAudio = report.filter((r) => !r.has_audio);
  console.log(JSON.stringify({
    total: report.length,
    with_audio: report.length - noAudio.length,
    without_audio: noAudio.length,
    no_audio: noAudio.map((r) => ({ id: r.id, name: r.name, sources: r.sources }))
  }, null, 2));
})();
