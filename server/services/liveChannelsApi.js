const { configFromChannel, primarySourceUrl, isDirectPlaybackChannel, obsHlsPlaybackPath, isVixredObsHls } = require('./channelConfig');
const { preferRelayPlayback, publicPlaybackUrl } = require('./streamCache');

/** Respuesta ligera para clientes (web/TV). ~90% menos payload que SELECT c.* */
function formatChannelLite(ch) {
  const config = configFromChannel(ch);
  const upstreamRaw = primarySourceUrl(config, ch.stream_url);
  const upstream = isVixredObsHls(upstreamRaw) ? obsHlsPlaybackPath(upstreamRaw) : upstreamRaw;
  const order = Number(config.order);
  const group = ch.group_title || '';
  const radio = !!config.radio || group === 'Radio Ecuador';
  const adv = config.advanced || {};
  const src = (config.sources || [])[0] || {};
  const directSource = isDirectPlaybackChannel(config, upstream);
  const useRelay = !directSource && preferRelayPlayback(ch);
  const playbackReferer = String(adv.referer || src.referer || src.playerUrl || '').trim();
  const playbackUa = String(adv.user_agent || src.user_agent || '').trim();
  return {
    id: ch.id,
    name: ch.name,
    logo: ch.logo || '',
    group_title: group,
    radio,
    stream_url: directSource ? upstream : (useRelay ? publicPlaybackUrl(ch, { autostart: false }) : upstream),
    direct_source: directSource,
    playback_referer: (radio || directSource) ? playbackReferer : '',
    playback_ua: (radio || directSource) ? playbackUa : '',
    number: ch.id,
    order: Number.isFinite(order) ? order : 0,
    enabled: ch.enabled ?? 1,
    catchup: useRelay ? 1 : 0
  };
}

module.exports = { formatChannelLite };
