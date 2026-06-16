import { useEffect, useState } from 'react';
import { searchArtistsUnified } from '../api/unified';
import { fetchHomeArtists } from '../api/unified';
import ArtistCard from '../components/ArtistCard';

export default function ArtistsView() {
  const [artists, setArtists] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHomeArtists(12).then(setArtists).finally(() => setLoading(false));
  }, []);

  const search = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      setArtists(await searchArtistsUnified(query.trim(), 24));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-view">
      <section className="home-hero">
        <h1>Artistas</h1>
        <p className="subtitle">Entra a un artista y verás sus canciones populares</p>
      </section>

      <form className="search-page__form" onSubmit={search}>
        <input type="search" placeholder="Buscar artista…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit">Buscar</button>
      </form>

      {loading && <div className="view-loading">Cargando…</div>}

      {!loading && (
        <div className="artist-grid">
          {artists.map((a) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </div>
      )}
    </div>
  );
}
