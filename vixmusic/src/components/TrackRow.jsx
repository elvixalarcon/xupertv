import { formatTime } from '../lib/utils';
import { assetUrl } from '../lib/platform';

export default function TrackRow({
  track,
  index,
  list,
  onPlay,
  onFavorite,
  isFavorite,
}) {
  const dur = track.duration || 0;
  const durLabel = track.durationLabel || formatTime(dur);

  return (
    <div className="track-row" onDoubleClick={() => onPlay(track, list, index)}>
      <span className="col-index">{index + 1}</span>
      <div className="col-title">
        <img src={track.image || assetUrl('icon-192.png')} alt="" className="row-thumb" />
        <div>
          <div className="row-name">{track.title}</div>
          <div className="row-sub">{track.artist}</div>
        </div>
      </div>
      <span className="col-album hide-mobile">
        <span className="badge-yt">YouTube</span>
      </span>
      <span className="col-license hide-mobile" />
      <span className="col-actions">
        <button
          type="button"
          className={isFavorite ? 'btn-fav on' : 'btn-fav'}
          onClick={(e) => {
            e.stopPropagation();
            onFavorite?.(track);
          }}
          title="Favorito"
        >
          {isFavorite ? '♥' : '♡'}
        </button>
        <button
          type="button"
          className="btn-play-row"
          onClick={() => onPlay(track, list, index)}
          title="Reproducir"
        >
          ▶
        </button>
      </span>
      <span className="col-dur">{durLabel || '—'}</span>
    </div>
  );
}
