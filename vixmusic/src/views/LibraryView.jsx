import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import MediaCard from '../components/MediaCard';

export default function LibraryView() {
  const { favorites, isLoggedIn, refreshFavorites, toggleFavorite } = useAuth();
  const [items, setItems] = useState(favorites);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setItems(favorites);
  }, [favorites]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshFavorites()
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshFavorites]);

  const remove = async (track) => {
    await toggleFavorite(track);
    const next = await refreshFavorites();
    setItems(next);
  };

  return (
    <div className="home-view">
      <section className="home-hero">
        <h1>Tus favoritos</h1>
        <p className="subtitle">
          {isLoggedIn ? 'Sincronizados con tu cuenta' : 'Solo en este dispositivo — inicia sesión para guardarlos en la nube'}
        </p>
        {!isLoggedIn && (
          <Link to="/login" className="btn-secondary">Iniciar sesión</Link>
        )}
      </section>

      {loading ? (
        <div className="empty-library">
          <p>Cargando favoritos…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-library">
          <p>No hay favoritos aún.</p>
          <p className="hint">Marca ♥ en el reproductor o busca música.</p>
        </div>
      ) : (
        <section className="home-section">
          <div className="media-grid">
            {items.map((t, i) => (
              <div key={t.id} className="fav-wrap">
                <MediaCard track={t} list={items} index={i} />
                <button type="button" className="fav-remove" onClick={() => remove(t)}>
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
