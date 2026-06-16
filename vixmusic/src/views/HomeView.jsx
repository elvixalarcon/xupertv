import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchUnifiedHome,
  fetchHomePodcasts,
} from '../api/unified';
import { vixApi } from '../api/vixApi';
import { useAuth } from '../context/AuthContext';
import { listPlayHistory } from '../lib/playHistory';
import { listFavorites as listLocalFavorites } from '../lib/favorites';
import {
  buildPersonalizedHome,
  discoverFromTopArtists,
} from '../lib/homePersonalization';
import MediaCard, { QuickPick } from '../components/MediaCard';
import ArtistCard from '../components/ArtistCard';

const HOME_FILTERS = ['Todo', 'Música', 'Podcasts'];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function renderTrackSection(section) {
  return (
    <section key={section.id} className="home-section">
      <div className="section-head">
        <h2>{section.title}</h2>
        {section.hint ? <span className="section-hint">{section.hint}</span> : null}
        {section.id === 'explore' ? (
          <Link to="/buscar" className="section-link">Explorar más</Link>
        ) : null}
      </div>
      <div className="media-grid">
        {section.items.map((t, i) => (
          <MediaCard key={`${section.id}-${t.id}`} track={t} list={section.items} index={i} />
        ))}
      </div>
    </section>
  );
}

export default function HomeView() {
  const { isLoggedIn, user, favorites } = useAuth();
  const [sections, setSections] = useState([]);
  const [podcasts, setPodcasts] = useState([]);
  const [hasTaste, setHasTaste] = useState(false);
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
        const [exploreTracks, podcastItems] = await Promise.all([
          fetchUnifiedHome(24),
          fetchHomePodcasts(8).catch(() => []),
        ]);
        let userFavorites = favorites;
        let history = [];

        if (isLoggedIn) {
          if (!userFavorites.length) {
            const favRes = await vixApi.listFavorites().catch(() => ({ items: [] }));
            userFavorites = favRes.items || [];
          }
          const histRes = await vixApi.listHistory(40).catch(() => ({ items: [] }));
          history = histRes.items || [];
        } else {
          userFavorites = listLocalFavorites();
          history = listPlayHistory();
        }

        let built = buildPersonalizedHome({
          favorites: userFavorites,
          history,
          exploreTracks,
        });

        if (built.hasTaste && built.topArtists.length) {
          const forYou = built.sections.find((s) => s.id === 'for_you');
          if (!forYou || forYou.items.length < 6) {
            const used = new Set(
              built.sections.flatMap((s) => (s.items || []).map((t) => t.id)),
            );
            const discovered = await discoverFromTopArtists(built.topArtists, used, 8);
            if (discovered.length) {
              if (forYou) {
                forYou.items = [...forYou.items, ...discovered].slice(0, 12);
              } else {
                built.sections.splice(1, 0, {
                  id: 'for_you',
                  title: 'Hecho para ti',
                  type: 'tracks',
                  items: discovered,
                  hint: `Descubre más de ${built.topArtists[0]}`,
                });
              }
            }
          }
        }

        if (!cancelled) {
          setSections(built.sections);
          setHasTaste(built.hasTaste);
          if (podcastItems.length) setPodcasts(podcastItems);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Error al cargar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isLoggedIn, favorites]);

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

  if (loading) return <div className="view-loading">Cargando tu música…</div>;
  if (error) return <div className="view-error">{error}</div>;

  const exploreSection = sections.find((s) => s.id === 'explore');
  const artistSection = sections.find((s) => s.type === 'artists');
  const quickSection = sections.find((s) => s.type === 'quick');

  const showMusic = filter === 'Todo' || filter === 'Música';
  const showPodcasts = filter === 'Todo' || filter === 'Podcasts';

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
          <p className="subtitle">
            {hasTaste ? 'Tu inicio, adaptado a lo que escuchas' : 'Canciones, álbumes y artistas'}
          </p>
        )}
        {filter === 'Podcasts' && (
          <p className="subtitle">Programas y episodios para escuchar</p>
        )}
        {filter === 'Todo' && hasTaste && (
          <p className="subtitle">Organizado según tus gustos y reproducciones</p>
        )}
      </section>

      {filter === 'Podcasts' && podcastLoading && (
        <div className="view-loading">Cargando podcasts…</div>
      )}

      {filter === 'Podcasts' && !podcastLoading && podcasts.length === 0 && (
        <div className="empty-library">
          <p>No hay podcasts en este momento.</p>
          <Link to="/buscar?q=podcast" className="btn-secondary">Buscar podcasts</Link>
        </div>
      )}

      {showMusic && filter !== 'Podcasts' && (
        <>
          {!hasTaste && (
            <p className="home-personalize-hint">
              Inicia sesión o marca canciones con ♥ para que tu inicio sea único.
            </p>
          )}

          {quickSection?.items?.length > 0 && (
            <section className="home-quick">
              <div className="quick-grid">
                {quickSection.items.map((t, i) => (
                  <QuickPick key={t.id} track={t} list={quickSection.items} index={i} />
                ))}
              </div>
            </section>
          )}

          {sections
            .filter((s) => s.type === 'tracks' && s.id !== 'explore')
            .map((section) => renderTrackSection(section))}

          {artistSection?.artists?.length > 0 && (
            <section className="home-section">
              <div className="section-head">
                <h2>{artistSection.title}</h2>
                <Link to="/artistas" className="section-link">Mostrar todo</Link>
              </div>
              <div className="artist-row">
                {artistSection.artists.map((a) => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </div>
            </section>
          )}

          {exploreSection?.items?.length > 0 && (
            renderTrackSection(exploreSection)
          )}
        </>
      )}

      {showPodcasts && filter === 'Podcasts' && podcasts.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2>Podcasts populares</h2>
            <Link to="/buscar?q=podcast" className="section-link">Explorar más</Link>
          </div>
          <div className="media-grid">
            {podcasts.map((t, i) => (
              <MediaCard key={`pod-${t.id}`} track={t} list={podcasts} index={i} />
            ))}
          </div>
        </section>
      )}

      {showPodcasts && filter === 'Todo' && podcasts.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <h2>Podcasts</h2>
            <button type="button" className="section-link section-link--btn" onClick={() => setFilter('Podcasts')}>
              Ver todos
            </button>
          </div>
          <div className="media-grid">
            {podcasts.slice(0, 6).map((t, i) => (
              <MediaCard key={`mix-pod-${t.id}`} track={t} list={podcasts} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
