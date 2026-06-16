/** Controles en pantalla de bloqueo / auriculares (Android + iOS) */
export function setupMediaSession(track, handlers = {}) {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const title = track?.title || 'VixMusic';
  const artist = track?.artist || '';
  const artwork = track?.image
    ? [{ src: track.image, sizes: '512x512', type: 'image/jpeg' }]
    : [];

  try {
    ms.metadata = new MediaMetadata({ title, artist, album: track?.album || 'VixMusic', artwork });
  } catch {
    ms.metadata = new MediaMetadata({ title, artist });
  }

  ms.setActionHandler('play', () => handlers.onPlay?.());
  ms.setActionHandler('pause', () => handlers.onPause?.());
  ms.setActionHandler('previoustrack', () => handlers.onPrev?.());
  ms.setActionHandler('nexttrack', () => handlers.onNext?.());
  ms.setActionHandler('seekto', (d) => {
    if (d?.seekTime != null) handlers.onSeek?.(d.seekTime);
  });
}

export function setMediaPlaybackState(playing) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
}

export function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.setActionHandler('play', null);
    navigator.mediaSession.setActionHandler('pause', null);
    navigator.mediaSession.setActionHandler('previoustrack', null);
    navigator.mediaSession.setActionHandler('nexttrack', null);
    navigator.mediaSession.setActionHandler('seekto', null);
  } catch {
    /* ignore */
  }
}
