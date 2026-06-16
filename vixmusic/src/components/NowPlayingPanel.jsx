import { Link } from 'react-router-dom';
import { usePlayer } from '../context/PlayerContext';
import { formatTime } from '../lib/utils';

export default function NowPlayingPanel({ open, onClose, viewOpen, onCloseView }) {
  const {
    track,
    queue,
    playing,
    progress,
    duration,
    playerError,
    resolving,
    shuffle,
    radioMode,
    videoPreview,
    toggleVideoPreview,
    playTrack,
    toggle,
    next,
    prev,
  } = usePlayer();

  const fullscreen = viewOpen && track;
  const artistSlug = track?.artist?.split(',')[0]?.trim();

  return (
    <>
      {fullscreen && (
        <div className="now-playing-backdrop" onClick={onCloseView} role="presentation" />
      )}
      <aside
        className={[
          'now-playing',
          track ? 'now-playing--active' : '',
          open ? '' : 'now-playing--collapsed',
          fullscreen ? 'now-playing--fullscreen' : '',
        ].filter(Boolean).join(' ')}
      >
        {!fullscreen && (
          <div className="now-playing__header">
            <span className="now-playing__label">En reproducción</span>
            <button type="button" className="now-playing__close" onClick={onClose} title="Cerrar">×</button>
          </div>
        )}

        {track ? (
          <>
            <div className="now-playing__track-head">
              <h2 className="now-playing__title">{track.title}</h2>
              <p className="now-playing__artist">{track.artist}</p>
            </div>

            <div className="now-playing__art">
              <img src={track.image} alt="" />
            </div>

            {track && !resolving && (
              <button
                type="button"
                className={`now-playing__audio-toggle ${videoPreview ? '' : 'on'}`}
                onClick={toggleVideoPreview}
              >
                {videoPreview ? 'Cambiar a audio' : 'Ver video'}
              </button>
            )}

            {resolving && (
              <p className="now-playing__placeholder">Buscando audio…</p>
            )}

            {playerError && (
              <p className="now-playing__error">{playerError}</p>
            )}

            {(shuffle || radioMode) && (
              <div className="now-playing__modes">
                {shuffle && <span className="mode-tag">Aleatorio</span>}
                {radioMode && <span className="mode-tag">Radio</span>}
              </div>
            )}

            {artistSlug && (
              <section className="now-playing__about">
                <h3 className="now-playing__about-title">Acerca del artista</h3>
                <Link
                  to={`/buscar?q=${encodeURIComponent(artistSlug)}`}
                  className="now-playing__about-card"
                >
                  <img src={track.image} alt="" />
                  <div className="now-playing__about-overlay">
                    <span className="now-playing__about-name">{artistSlug}</span>
                  </div>
                </Link>
              </section>
            )}
          </>
        ) : (
          <p className="now-playing__placeholder">Pulsa una canción para reproducir</p>
        )}

        {fullscreen && track && (
          <>
            <div className="now-playing__controls">
              <button type="button" className="sp-btn" onClick={prev} aria-label="Anterior">⏮</button>
              <button type="button" className="sp-btn-play" onClick={toggle} aria-label={playing ? 'Pausa' : 'Play'}>
                {playing ? '⏸' : '▶'}
              </button>
              <button type="button" className="sp-btn" onClick={next} aria-label="Siguiente">⏭</button>
              <span className="now-playing__time">
                {formatTime(progress)} / {formatTime(duration)}
              </span>
            </div>
            <div className="now-playing__progress">
              <div className="now-playing__progress-fill" style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }} />
            </div>
            <button type="button" className="now-playing__close now-playing__close--float" onClick={onCloseView} title="Cerrar">×</button>
          </>
        )}

        {!fullscreen && queue.length > 1 && (
          <div className="now-playing__queue">
            <div className="now-playing__label">Siguientes</div>
            {queue.slice(0, 8).map((t, i) => (
              <button key={`${t.id}-${i}`} type="button" className="queue-item" onClick={() => playTrack(t, queue, i)}>
                <img src={t.image} alt="" />
                <span>{t.title}</span>
              </button>
            ))}
          </div>
        )}
      </aside>
    </>
  );
}
