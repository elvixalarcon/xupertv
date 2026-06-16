import { PLAYER_HOST_ID, usePlayer } from '../context/PlayerContext';

/** Reproductor YouTube: oculto por defecto; preview opcional */
export default function YouTubePlayerHost() {
  const { videoPreview, setVideoPreview } = usePlayer();

  return (
    <div
      className={[
        'yt-player-root',
        videoPreview ? 'yt-player-root--preview' : 'yt-player-root--hidden',
      ].join(' ')}
      aria-hidden={!videoPreview}
    >
      {videoPreview && (
        <button
          type="button"
          className="yt-player-root__close"
          onClick={() => setVideoPreview(false)}
          title="Ocultar video"
          aria-label="Ocultar video"
        >
          ×
        </button>
      )}
      <div id={PLAYER_HOST_ID} className="yt-embed-host" />
    </div>
  );
}
