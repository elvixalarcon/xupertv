import { usePlayer } from '../context/PlayerContext';

export function QuickPick({ track, list, index }) {
  const { playTrack } = usePlayer();
  return (
    <button type="button" className="quick-pick" onClick={() => playTrack(track, list, index)}>
      <img src={track.image} alt="" />
      <span>{track.title}</span>
    </button>
  );
}

export default function MediaCard({ track, list, index }) {
  const { playTrack, track: current, playing } = usePlayer();
  const isActive = current?.id === track.id && playing;

  return (
    <div className="media-card">
      <div className="media-card__img-wrap">
        <img src={track.image} alt="" className="media-card__img" />
        <button
          type="button"
          className={`media-card__play ${isActive ? 'is-playing' : ''}`}
          onClick={() => playTrack(track, list, index)}
          aria-label="Reproducir"
        >
          {isActive ? (
            <svg width="24" height="24" viewBox="0 0 16 16" fill="#000"><path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7zm5 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7zm5 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 1.4 0V1.7a.7.7 0 0 0-.7-.7z" /></svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 16 16" fill="#000"><path d="M3 1.713a.7.7 0 0 0-1.05.607v12.575a.7.7 0 0 0 1.075.618l9.671-5.825a.7.7 0 0 0 0-1.234L3 1.713z" /></svg>
          )}
        </button>
      </div>
      <div className="media-card__title" title={track.title}>{track.title}</div>
      <div className="media-card__artist">
        {track.artist}
        {track.source === 'spotify' && <span className="src-badge src-badge--sp"> Spotify</span>}
        {track.source === 'youtube' && <span className="src-badge src-badge--yt"> YouTube</span>}
      </div>
    </div>
  );
}
