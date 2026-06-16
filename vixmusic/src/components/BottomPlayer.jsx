import { usePlayer } from '../context/PlayerContext';
import { formatTime } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import DownloadButton from './DownloadButton';

function IconShuffle({ on }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className={on ? 'sp-icon on' : 'sp-icon'}>
      <path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.129 7.38A2.75 2.75 0 0 1 .99 12.25H0v1.5h.99a4.25 4.25 0 0 0 3.24-2.07l6.13-7.38a2.25 2.25 0 0 1 1.724-.804h1.95l-.02 1.02 1.06-1.06L15.272 0l-2.12 2.12zM10.5 6.5a.75.75 0 0 0-1.06 0L7.44 8.5 5.44 6.5a.75.75 0 0 0-1.06 1.06L6.38 9.56l-2 2a.75.75 0 1 0 1.06 1.06l2-2 2 2a.75.75 0 1 0 1.06-1.06l-2-2 2-2a.75.75 0 0 0 0-1.06z" />
    </svg>
  );
}

export default function BottomPlayer({ onOpenNowPlaying }) {
  const {
    track,
    playing,
    progress,
    duration,
    volume,
    setVolume,
    toggle,
    next,
    prev,
    seek,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    radioMode,
    setRadioMode,
    videoPreview,
    toggleVideoPreview,
    playerError,
    resolving,
    retryCurrentTrack,
    offlineMode,
    backgroundAudio,
    useNativeAudio,
  } = usePlayer();
  const { isFavorite, toggleFavorite } = useAuth();

  const pct = duration ? (progress / duration) * 100 : 0;

  const onFav = async () => {
    if (track) await toggleFavorite(track);
  };

  return (
    <footer className={`player-bar ${track ? '' : 'player-bar--idle'}`}>
      <div className="player-bar__left">
        {track ? (
          <button
            type="button"
            className="player-bar__now-playing-btn"
            onClick={onOpenNowPlaying}
            title="Ver lo que suena"
          >
            <img className="player-bar__cover" src={track.image} alt="" />
            <div className="player-bar__info">
              <div className="player-bar__title">{track.title}</div>
              <div className="player-bar__artist">{track.artist}</div>
            </div>
          </button>
        ) : (
          <span className="player-bar__hint">Elige una canción para reproducir</span>
        )}
        {track && (
            <button type="button" className="player-bar__heart" onClick={onFav} title="Favorito">
              {isFavorite(track.id) ? '♥' : '♡'}
            </button>
        )}
        {track && <DownloadButton track={track} className="player-bar__dl" />}
      </div>

      <div className="player-bar__center">
        {(playerError || resolving) && (
          <div className="player-bar__status">
            <span>
              {offlineMode && !playerError
                ? 'Modo offline'
                : backgroundAudio && !playerError
                  ? 'Reproduciendo en segundo plano'
                  : resolving
                    ? 'Buscando audio…'
                    : playerError}
            </span>
            {playerError && track && !resolving && (
              <button type="button" className="player-bar__retry" onClick={retryCurrentTrack}>
                Probar otra versión
              </button>
            )}
          </div>
        )}
        <div className="player-bar__buttons">
          <button type="button" className={shuffle ? 'sp-btn on' : 'sp-btn'} onClick={() => setShuffle(!shuffle)} title="Modo aleatorio">
            <IconShuffle on={shuffle} />
          </button>
          <button type="button" className={radioMode ? 'sp-btn on' : 'sp-btn'} onClick={() => setRadioMode(!radioMode)} title="Modo radio">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm-.75 2.5v5l4.5 2.6.75-1.3-3.75-2.15V5z" /></svg>
          </button>
          <button type="button" className="sp-btn" onClick={prev} disabled={!track} aria-label="Anterior">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-1.4 0V1.7a.7.7 0 0 1 .7-.7z" /></svg>
          </button>
          <button type="button" className="sp-btn-play" onClick={toggle} disabled={!track} aria-label={playing ? 'Pausa' : 'Play'}>
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7zm5 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7zm5 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7z" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3 1.713a.7.7 0 0 0-1.05.607v12.575a.7.7 0 0 0 1.075.618l9.671-5.825a.7.7 0 0 0 0-1.234L3 1.713z" /></svg>
            )}
          </button>
          <button type="button" className="sp-btn" onClick={next} disabled={!track} aria-label="Siguiente">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7z" /></svg>
          </button>
          <button type="button" className={repeat ? 'sp-btn on' : 'sp-btn'} onClick={() => setRepeat(!repeat)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.811 12.25h2.439a2.25 2.25 0 0 0 2.25-2.25v-5a2.25 2.25 0 0 0-2.25-2.25h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75v-5z" /></svg>
          </button>
        </div>
        <div className="player-bar__timeline">
          <span>{formatTime(progress)}</span>
          <div className="player-bar__seek">
            <div className="player-bar__seek-fill" style={{ width: `${pct}%` }} />
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={progress}
              onChange={(e) => seek(Number(e.target.value))}
              disabled={!track}
            />
          </div>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="player-bar__right">
        {track && (
          <button
            type="button"
            className={`player-bar__video-btn ${videoPreview ? 'on' : ''}`}
            onClick={toggleVideoPreview}
            title={videoPreview ? 'Ocultar video' : 'Ver video'}
            aria-label={videoPreview ? 'Ocultar video' : 'Ver video'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
            </svg>
          </button>
        )}
        <input
          type="range"
          className="player-bar__vol"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
    </footer>
  );
}
