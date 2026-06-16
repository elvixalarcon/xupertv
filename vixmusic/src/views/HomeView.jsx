import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchUnifiedHome, fetchHomeArtists } from '../api/unified';
import { vixApi } from '../api/vixApi';
import { useAuth } from '../context/AuthContext';
import MediaCard, { QuickPick } from '../components/MediaCard';
import ArtistCard from '../components/ArtistCard';

const HOME_FILTERS = ['Todo', 'Música', 'Podcasts'];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function HomeView() {
  const { isLoggedIn, user } = useAuth();
  const [tracks, setTracks] = useState([]);
  const [artists, setArtists] = useState([]);
  const [recs, setRecs] = useState([]);
  const [recHint, setRecHint] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('Todo');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const jobs = [
          fetchUnifiedHome(18),
          fetchHomeArtists(10).catch(() => []),
        ];
        if (isLoggedIn) {
          jobs.push(vixApi.recommendations().catch(() => ({ items: [], hint: '' })));
        }
        const results = await Promise.all(jobs);
        if (!cancelled) {
          setTracks(results[0]);
          setArtists(results[1]);
          if (isLoggedIn && results[2]) {
            setRecs(results[2].items || []);
            setRecHint(results[2].hint || '');
          } else {
            setRecs([]);
            setRecHint('');
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Error al cargar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  if (loading) return <div className="view-loading">Cargando música…</div>;
  if (error) return <div className="view-error">{error}</div>;

  const quick = tracks.slice(0, 8);
  const rest = tracks.slice(4);

  return (
    <div className="home-view">
      <div className="content-filters">
        {HOME_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`content-chip${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <section className="home-hero">
        <h1>{getGreeting()}{user ? `, ${user.displayName}` : ''}</h1>
      </section>

      {isLoggedIn && recs.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2>Hecho para ti</h2>
            <span className="section-hint">{recHint}</span>
          </div>
          <div className="media-grid">
            {recs.filter((r) => r.type !== 'artist_radio').map((t, i) => (
              <MediaCard key={t.id} track={t} list={recs} index={i} />
            ))}
          </div>
        </section>
      )}

      <section className="home-quick">
        <div className="quick-grid">
          {quick.map((t, i) => (
            <QuickPick key={t.id} track={t} list={tracks} index={i} />
          ))}
        </div>
      </section>

      {artists.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2>Tus artistas favoritos</h2>
            <Link to="/artistas" className="section-link">Mostrar todo</Link>
          </div>
          <div className="artist-row">
            {artists.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="section-head"><h2>Álbumes con canciones que te gustan</h2></div>
        <div className="media-grid">
          {rest.map((t, i) => (
            <MediaCard key={t.id} track={t} list={tracks} index={i + 4} />
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="section-head"><h2>Recientes</h2></div>
        <div className="media-grid">
          {tracks.map((t, i) => (
            <MediaCard key={`all-${t.id}`} track={t} list={tracks} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
