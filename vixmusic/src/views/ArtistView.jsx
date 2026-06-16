import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { loadArtistPage } from '../api/unified';
import { usePlayer } from '../context/PlayerContext';
import { formatTime } from '../lib/utils';
import ArtistCard from '../components/ArtistCard';

export default function ArtistView() {
  const { artistId } = useParams();
  const { playTrack, playArtistQueue, track: current, playing } = usePlayer();
  const [artist, setArtist] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await loadArtistPage(decodeURIComponent(artistId));
        if (!cancelled) {
          setArtist(data.artist);
          setTracks(data.tracks);
          setRelated(data.related);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [artistId]);

  const playOne = (t, i) => {
    playTrack(t, tracks, i);
  };

  if (loading) return <div className="view-loading">Cargando artista…</div>;
  if (error === 'SPOTIFY_CONFIG') {
    return (
      <div className="view-error">
        <h2>Artista de Spotify</h2>
        <p>Configura Spotify en Ajustes o explora artistas desde <Link to="/artistas">Artistas</Link>.</p>
      </div>
    );
  }
  if (error) return <div className="view-error">{error}</div>;
  if (!artist) return null;

  const followers = artist.followers
    ? `${artist.followers.toLocaleString()} seguidores`
    : 'Artista en YouTube / Spotify';

  return (
    <div className="artist-page">
      <div className="artist-hero" style={artist.image ? { backgroundImage: `linear-gradient(transparent, #121212), url(${artist.image})` } : undefined}>
        <div className="artist-hero__inner">
          {artist.image && <img className="artist-hero__avatar" src={artist.image} alt="" />}
          <div>
            <p className="artist-hero__type">Artista</p>
            <h1>{artist.name}</h1>
            <p className="artist-hero__meta">{followers}</p>
          </div>
        </div>
      </div>

      <div className="artist-actions">
        <button
          type="button"
          className="btn-play-big"
          onClick={() => playArtistQueue(tracks, artist, { shuf: false, radio: false, startIndex: 0 })}
          title="Reproducir desde la primera"
        >
          ▶
        </button>
        <button
          type="button"
          className="btn-action-pill"
          onClick={() => playArtistQueue(tracks, artist, { shuf: true, radio: false, startIndex: 0 })}
          title="Aleatorio"
        >
          🔀 Aleatorio
        </button>
        <button
          type="button"
          className="btn-action-pill"
          onClick={() => playArtistQueue(tracks, artist, { shuf: true, radio: true, startIndex: 0 })}
          title="Radio del artista"
        >
          📻 Radio
        </button>
      </div>

      <section className="artist-tracks">
        <h2>Popular</h2>
        <p className="hint track-list__hint">Toca el nombre de la canción para reproducir</p>
        <div className="track-list">
          {tracks.map((t, i) => {
            const active = current && (
              current.id === t.id
              || (current.title === t.title && current.artist?.split(',')[0] === t.artist?.split(',')[0])
            ) && playing;
            return (
              <div
                key={t.id}
                className={`track-list__row ${active ? 'active' : ''}`}
              >
                <span className="track-list__num">{active ? '♪' : i + 1}</span>
                <img className="track-list__thumb" src={t.image} alt="" />
                <div className="track-list__info">
                  <button
                    type="button"
                    className="track-list__title-btn"
                    onClick={() => playOne(t, i)}
                  >
                    {t.title}
                  </button>
                  <div className="track-list__sub">{t.artist}</div>
                </div>
                <span className="track-list__dur">{t.durationLabel || formatTime(t.duration)}</span>
              </div>
            );
          })}
        </div>
      </section>

      {related.length > 0 && (
        <section className="home-section">
          <div className="section-head"><h2>Artistas similares</h2></div>
          <div className="artist-grid">
            {related.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </div>
        </section>
      )}

      <p className="hint" style={{ marginTop: 24 }}>
        <Link to="/artistas">← Todos los artistas</Link>
      </p>
    </div>
  );
}
