import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchUnifiedHome,
  fetchHomeArtists,
  fetchHomePodcasts,
  filterHomeTracks,
} from '../api/unified';
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
  const [podcasts, setPodcasts] = useState([]);
  const [recs, setRecs] = useState([]);
  const [recHint, setRecHint] = useState('');
  const [loading, setLoading] = useState(true);
  const [podcastLoading, setPodcastLoading] = useState(false);
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

  useEffect(() => {
    if (filter !== 'Podcasts') return undefined;
    if (podcasts.length) return undefined;

    let cancelled = false;
    (async () => {
      setPodcastLoading(true);
      try {
        const items = await fetchHomePodcasts(20);
        if (!cancelled) setPodcasts(items);
      } catch {
        if (!cancelled) setPodcasts([]);
      } finally {
        if (!cancelled) setPodcastLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filter, podcasts.length]);

  if (loading) return <div className="view-loading">Cargando música…</div>;
  if (error) return <div className="view-error">{error}</div>;

  const musicTracks = filterHomeTracks(tracks, 'Música');
  const inlinePodcasts = filterHomeTracks(tracks, 'Podcasts');
  const podcastList = podcasts.length ? podcasts : inlinePodcasts;

  const showMusic = filter === 'Todo' || filter === 'Música';
  const showPodcasts = filter === 'Todo' || filter === 'Podcasts';
  const showArtists = showMusic && artists.length > 0;

  const activeTracks = filter === 'Podcasts' ? podcastList : filter === 'Música' ? musicTracks : tracks;
  const quick = activeTracks.slice(0, 8);
  const rest = filter === 'Podcasts' ? activeTracks.slice(8) : activeTracks.slice(4);

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
        {filter === 'Música' && (
          <p className="subtitle">Canciones, álbumes y artistas</p>
        )}
        {filter === 'Podcasts' && (
          <p className="subtitle">Programas y episodios para escuchar</p>
        )}
      </section>

      {filter === 'Podcasts' && podcastLoading && (
        <div className="view-loading">Cargando podcasts…</div>
      )}

      {filter === 'Podcasts' && !podcastLoading && podcastList.length === 0 && (
        <div className="empty-library">
          <p>No hay podcasts en este momento.</p>
          <Link to="/buscar?q=podcast" className="btn-secondary">Buscar podcasts</Link>
        </div>
      )}

      {showMusic && filter !== 'Podcasts' && isLoggedIn && recs.length > 0 && (
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

      {showMusic && filter !== 'Podcasts' && quick.length > 0 && (
        <section className="home-quick">
          <div className="quick-grid">
            {quick.map((t, i) => (
              <QuickPick key={t.id} track={t} list={activeTracks} index={i} />
            ))}
          </div>
        </section>
      )}

      {showPodcasts && filter === 'Podcasts' && podcastList.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2>Podcasts populares</h2>
            <Link to="/buscar?q=podcast" className="section-link">Explorar más</Link>
          </div>
          <div className="media-grid">
            {podcastList.map((t, i) => (
              <MediaCard key={`pod-${t.id}`} track={t} list={podcastList} index={i} />
            ))}
          </div>
        </section>
      )}

      {showArtists && (
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

      {showMusic && filter !== 'Podcasts' && rest.length > 0 && (
        <section className="home-section">
          <div className="section-head"><h2>Álbumes con canciones que te gustan</h2></div>
          <div className="media-grid">
            {rest.map((t, i) => (
              <MediaCard key={t.id} track={t} list={activeTracks} index={i + 4} />
            ))}
          </div>
        </section>
      )}

      {showMusic && filter === 'Todo' && tracks.length > 0 && (
        <section className="home-section">
          <div className="section-head"><h2>Recientes</h2></div>
          <div className="media-grid">
            {tracks.map((t, i) => (
              <MediaCard key={`all-${t.id}`} track={t} list={tracks} index={i} />
            ))}
          </div>
        </section>
      )}

      {showPodcasts && filter === 'Todo' && inlinePodcasts.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2>Podcasts</h2>
            <button type="button" className="section-link section-link--btn" onClick={() => setFilter('Podcasts')}>
              Ver todos
            </button>
          </div>
          <div className="media-grid">
            {inlinePodcasts.slice(0, 6).map((t, i) => (
              <MediaCard key={`mix-pod-${t.id}`} track={t} list={inlinePodcasts} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
