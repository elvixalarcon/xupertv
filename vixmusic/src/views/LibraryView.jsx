import { useEffect, useState } from 'react';
import { listFavorites, removeFavorite } from '../lib/favorites';
import MediaCard from '../components/MediaCard';

export default function LibraryView() {
  const [items, setItems] = useState([]);

  const reload = () => setItems(listFavorites());

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="home-view">
      <section className="home-hero">
        <h1>Tus favoritos</h1>
        <p className="subtitle">Guardados en este dispositivo</p>
      </section>

      {items.length === 0 ? (
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
                <button type="button" className="fav-remove" onClick={() => { removeFavorite(t.id); reload(); }}>
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
