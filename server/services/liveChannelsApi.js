const { configFromChannel, primarySourceUrl } = require('./channelConfig');
const { relayActiveForChannel, publicPlaybackUrl } = require('./streamCache');

/** Respuesta ligera para clientes (web/TV). ~90% menos payload que SELECT c.* */
function formatChannelLite(ch) {
  const config = configFromChannel(ch);
  const upstream = primarySourceUrl(config, ch.stream_url);
  const relay = relayActiveForChannel(ch);
  return {
    id: ch.id,
    name: ch.name,
    logo: ch.logo || '',
    group_title: ch.group_title || '',
    stream_url: relay ? publicPlaybackUrl(ch) : upstream,
    number: ch.id,
    enabled: ch.enabled ?? 1,
    catchup: relay ? 1 : 0
  };
}

module.exports = { formatChannelLite };
