import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { loadArtistSearchHub } from '../api/unified';
import { usePlayer } from '../context/PlayerContext';
import { formatTime } from '../lib/utils';
import { assetUrl } from '../lib/platform';
import ArtistCard from '../components/ArtistCard';

const FILTERS = [
  { id: 'todo', label: 'Todo' },
  { id: 'canciones', label: 'Canciones' },
  { id: 'artistas', label: 'Artistas' },
  { id: 'videos', label: 'Videos musicales' },
];

export default function SearchView() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const query = params.get('q') || '';
  const [filter, setFilter] = useState('todo');
  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { playTrack, playArtistQueue, track: current, playing } = usePlayer();

  useEffect(() => {
    if (!query.trim()) {
      setHub(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await loadArtistSearchHub(query);
        if (!cancelled) setHub(data);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Error');
          setHub(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [query]);

  const onSearch = (e) => {
    e.preventDefault();
    const term = e.target.elements.q.value.trim();
    if (!term) return;
    setParams({ q: term });
  };

  const playSong = (t, list) => {
    const i = list.findIndex((x) => x.id === t.id);
    playTrack(t, list, i >= 0 ? i : 0);
  };

  const isActive = (t) => current && (
    current.id === t.id
    || (current.title === t.title && current.artist?.split(',')[0] === t.artist?.split(',')[0])
  ) && playing;

  const onPlaylist = (pl) => {
    if (!hub?.artist) return;
    if (pl.mode === 'radio') {
      playArtistQueue(hub.songs, hub.artist, { shuf: true, radio: true });
    } else if (pl.mode === 'play') {
      playArtistQueue(hub.songs, hub.artist, { shuf: false, radio: false });
    } else if (pl.artistId) {
      navigate(`/artista/${encodeURIComponent(pl.artistId)}`);
    }
  };

  const artistLink = hub?.artist
    ? `/artista/${encodeURIComponent(hub.artist.spotifyArtistId || hub.artist.id)}`
    : '#';

  return (
    <div className="search-spotify">
      <form className="search-spotify__query" onSubmit={onSearch}>
        <input name="q" type="search" defaultValue={query} placeholder="¿Qué quieres reproducir?" />
        {query && (
          <button type="button" className="search-spotify__clear" onClick={() => setParams({})} aria-label="Limpiar">
            ×
          </button>
        )}
      </form>

      {query && (
        <div className="search-spotify__filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`search-chip${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {!query && (
        <div className="search-spotify__empty">
          <h2>Busca artistas, canciones y más</h2>
          <p className="subtitle">Prueba con el nombre de un artista, como en Spotify</p>
        </div>
      )}

      {loading && <div className="view-loading">Buscando «{query}»…</div>}
      {error && <div className="view-error">{error}</div>}

      {hub && !loading && (
        <>
          {(filter === 'todo' || filter === 'artistas') && (
            <section className="search-artist-hero">
              <Link to={artistLink} className="search-artist-hero__main">
                <img src={hub.artist.image || assetUrl('icon-192.png')} alt="" />
                <div>
                  <span className="search-artist-hero__type">Artista</span>
                  <h2>{hub.artist.name}</h2>
                </div>
              </Link>
              <div className="search-artist-hero__actions">
                <button type="button" className="btn-follow">Seguir</button>
                <button
                  type="button"
                  className="btn-play-big"
                  onClick={() => playArtistQueue(hub.songs, hub.artist, { shuf: false, radio: false })}
                  title="Reproducir artista"
                >
                  ▶
                </button>
              </div>
            </section>
          )}

          {filter === 'todo' && hub.playlists?.length > 0 && (
            <section className="search-section">
              <h3>Con {hub.artist.name}</h3>
              <div className="search-playlist-row">
                {hub.playlists.map((pl) => (
                  <button key={pl.id} type="button" className="search-playlist-card" onClick={() => onPlaylist(pl)}>
                    <img src={pl.image || assetUrl('icon-192.png')} alt="" />
                    <div className="search-playlist-card__title">{pl.title}</div>
                    <div className="search-playlist-card__sub">{pl.subtitle}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {(filter === 'todo' || filter === 'canciones') && hub.songs.length > 0 && (
            <section className="search-section">
              <h3>Canciones</h3>
              <div className="search-track-list">
                {hub.songs.map((t, i) => (
                  <div key={t.id} className={`search-track-row${isActive(t) ? ' active' : ''}`}>
                    <img src={t.image} alt="" />
                    <div className="search-track-row__info">
                      <button type="button" className="search-track-row__title" onClick={() => playSong(t, hub.songs)}>
                        {t.title}
                      </button>
                      <div className="search-track-row__meta">
                      {t.videoId ? 'Audio' : 'Canción'} • {t.artist}
                      </div>
                    </div>
                    <span className="search-track-row__tag">{t.videoId ? 'Video' : 'Canción'}</span>
                    <span className="search-track-row__dur">{t.durationLabel || formatTime(t.duration)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(filter === 'todo' || filter === 'videos') && hub.videos.length > 0 && (
            <section className="search-section">
              <h3>Videos musicales</h3>
              <div className="search-video-grid">
                {hub.videos.map((t, i) => (
                  <button
                    key={`v-${t.id}-${i}`}
                    type="button"
                    className="search-video-card"
                    onClick={() => playSong(t, hub.videos)}
                  >
                    <img src={t.image} alt="" />
                    <div className="search-video-card__title">{t.title}</div>
                    <div className="search-video-card__sub">{t.artist}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {filter === 'artistas' && (
            <section className="search-section">
              <h3>Artistas</h3>
              <div className="artist-grid">
                {hub.artists.map((a) => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </div>
            </section>
          )}

          {filter === 'todo' && (
            <p className="hint search-spotify__link">
              <Link to={artistLink}>Ver perfil completo de {hub.artist.name} →</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
