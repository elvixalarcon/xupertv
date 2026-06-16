import { Link, useLocation } from 'react-router-dom';
import { usePlayer } from '../context/PlayerContext';
import { formatTime } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import DownloadButton from './DownloadButton';

const SOURCE_LABELS = {
  '/': 'INICIO',
  '/buscar': 'BÚSQUEDA',
  '/biblioteca': 'BIBLIOTECA',
  '/descargas': 'DESCARGAS',
  '/artistas': 'ARTISTAS',
  '/favoritos': 'FAVORITOS',
  '/cuenta': 'TU CUENTA',
  '/playlists': 'PLAYLISTS',
};

function sourceLabel(pathname) {
  if (pathname.startsWith('/artista/')) return 'ARTISTA';
  const base = pathname.split('/').slice(0, 2).join('/') || '/';
  return SOURCE_LABELS[base] || SOURCE_LABELS[pathname] || 'VIXMUSIC';
}

function IconShuffle({ on }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" className={on ? 'sp-icon on' : 'sp-icon'}>
      <path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.129 7.38A2.75 2.75 0 0 1 .99 12.25H0v1.5h.99a4.25 4.25 0 0 0 3.24-2.07l6.13-7.38a2.25 2.25 0 0 1 1.724-.804h1.95l-.02 1.02 1.06-1.06L15.272 0l-2.12 2.12zM10.5 6.5a.75.75 0 0 0-1.06 0L7.44 8.5 5.44 6.5a.75.75 0 0 0-1.06 1.06L6.38 9.56l-2 2a.75.75 0 1 0 1.06 1.06l2-2 2 2a.75.75 0 1 0 1.06-1.06l-2-2 2-2a.75.75 0 0 0 0-1.06z" />
    </svg>
  );
}

export default function NowPlayingPanel({ open, onClose, viewOpen, onCloseView }) {
  const location = useLocation();
  const { isFavorite, toggleFavorite } = useAuth();
  const {
    track,
    queue,
    playing,
    progress,
    duration,
    playerError,
    resolving,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    radioMode,
    videoPreview,
    toggleVideoPreview,
    playTrack,
    toggle,
    next,
    prev,
    seek,
    useNativeAudio,
    backgroundAudio,
    offlineMode,
  } = usePlayer();

  const fullscreen = viewOpen && track;
  const artistSlug = track?.artist?.split(',')[0]?.trim();
  const pct = duration ? (progress / duration) * 100 : 0;
  const source = sourceLabel(location.pathname);

  const onFav = async () => {
    if (track) await toggleFavorite(track);
  };

  if (fullscreen) {
    return (
      <div className="np-screen">
        <div
          className="np-screen__bg"
          style={{ backgroundImage: `url(${track.image})` }}
          aria-hidden
        />
        <div className="np-screen__shade" aria-hidden />

        <header className="np-screen__header">
          <button type="button" className="np-screen__icon-btn" onClick={onCloseView} aria-label="Minimizar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
          </button>
          <div className="np-screen__source">
            <span className="np-screen__source-label">Reproduciendo desde {source}</span>
            <span className="np-screen__source-sub">{track.album || track.artist}</span>
          </div>
          <button type="button" className="np-screen__icon-btn" aria-label="Opciones">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
          </button>
        </header>

        <div className="np-screen__lyrics">
          {resolving ? (
            <p className="np-screen__lyrics-line np-screen__lyrics-line--dim">Cargando audio…</p>
          ) : playerError ? (
            <p className="np-screen__lyrics-line np-screen__lyrics-line--error">{playerError}</p>
          ) : (
            <>
              <p className="np-screen__lyrics-line np-screen__lyrics-line--active">{track.title}</p>
              <p className="np-screen__lyrics-line np-screen__lyrics-line--dim">{track.artist}</p>
            </>
          )}
        </div>

        <div className="np-screen__dock">
          <div className="np-screen__track-row">
            <img className="np-screen__thumb" src={track.image} alt="" />
            <div className="np-screen__track-meta">
              <div className="np-screen__track-title">{track.title}</div>
              <div className="np-screen__track-artist">{track.artist}</div>
            </div>
            <button
              type="button"
              className={`np-screen__add ${isFavorite(track.id) ? 'on' : ''}`}
              onClick={onFav}
              aria-label="Favorito"
            >
              {isFavorite(track.id) ? '♥' : '+'}
            </button>
          </div>

          <div className="np-screen__progress">
            <div className="np-screen__progress-bar">
              <div className="np-screen__progress-fill" style={{ width: `${pct}%` }} />
              <input
                type="range"
                className="np-screen__progress-input"
                min={0}
                max={duration || 100}
                value={progress}
                onChange={(e) => seek(Number(e.target.value))}
              />
            </div>
            <div className="np-screen__times">
              <span>{formatTime(progress)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="np-screen__controls">
            <button type="button" className={shuffle ? 'np-screen__ctrl on' : 'np-screen__ctrl'} onClick={() => setShuffle(!shuffle)} aria-label="Aleatorio">
              <IconShuffle on={shuffle} />
            </button>
            <button type="button" className="np-screen__ctrl" onClick={prev} aria-label="Anterior">
              <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor"><path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-1.4 0V1.7a.7.7 0 0 1 .7-.7z" /></svg>
            </button>
            <button type="button" className="np-screen__play" onClick={toggle} aria-label={playing ? 'Pausa' : 'Play'}>
              {playing ? (
                <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor"><path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7zm5 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7zm5 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7z" /></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor"><path d="M3 1.713a.7.7 0 0 0-1.05.607v12.575a.7.7 0 0 0 1.075.618l9.671-5.825a.7.7 0 0 0 0-1.234L3 1.713z" /></svg>
              )}
            </button>
            <button type="button" className="np-screen__ctrl" onClick={next} aria-label="Siguiente">
              <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor"><path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7z" /></svg>
            </button>
            <button type="button" className={repeat ? 'np-screen__ctrl on' : 'np-screen__ctrl'} onClick={() => setRepeat(!repeat)} aria-label="Repetir">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.811 12.25h2.439a2.25 2.25 0 0 0 2.25-2.25v-5a2.25 2.25 0 0 0-2.25-2.25h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75v-5z" /></svg>
            </button>
          </div>

          <div className="np-screen__footer">
            <span className="np-screen__device">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" /></svg>
              VixMusic
            </span>
            <div className="np-screen__footer-actions">
              <DownloadButton track={track} className="np-screen__action-btn" />
              {track && !resolving && !useNativeAudio && (
                <button type="button" className={`np-screen__action-btn ${videoPreview ? 'on' : ''}`} onClick={toggleVideoPreview}>
                  Video
                </button>
              )}
            </div>
          </div>

          {(backgroundAudio || offlineMode) && (
            <p className="np-screen__hint">Audio en segundo plano activo</p>
          )}

          <div className="np-screen__lyrics-sheet">
            <div className="np-screen__lyrics-handle" />
            <span>Vista previa de la canción</span>
            <p>{track.title} — {track.artist}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <aside className={['now-playing', track ? 'now-playing--active' : '', open ? '' : 'now-playing--collapsed'].filter(Boolean).join(' ')}>
      <div className="now-playing__header">
        <span className="now-playing__label">En reproducción</span>
        <button type="button" className="now-playing__close" onClick={onClose} title="Cerrar">×</button>
      </div>

      {track ? (
        <>
          <div className="now-playing__track-head">
            <h2 className="now-playing__title">{track.title}</h2>
            <p className="now-playing__artist">{track.artist}</p>
          </div>

          <div className="now-playing__art">
            <img src={track.image} alt="" />
          </div>

          {track && !resolving && !useNativeAudio && (
            <button
              type="button"
              className={`now-playing__audio-toggle ${videoPreview ? '' : 'on'}`}
              onClick={toggleVideoPreview}
            >
              {videoPreview ? 'Cambiar a audio' : 'Ver video'}
            </button>
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
  );
}
