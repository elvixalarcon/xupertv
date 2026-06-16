import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import { vixApi } from '../api/vixApi';
import { parseTrackForSearch } from '../api/unified';

export default function PlaylistsView() {
  const { user, playlists, refreshPlaylists, isLoggedIn } = useAuth();
  const { playTrack } = usePlayer();
  const [name, setName] = useState('');
  const [active, setActive] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoggedIn) refreshPlaylists();
  }, [isLoggedIn, refreshPlaylists]);

  if (!isLoggedIn) {
    return (
      <div className="auth-view">
        <div className="auth-card">
          <h1>Playlists</h1>
          <p>Inicia sesión para crear y guardar playlists en tu cuenta.</p>
          <Link to="/login" className="btn-primary">Iniciar sesión</Link>
        </div>
      </div>
    );
  }

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await vixApi.createPlaylist({ name: name.trim() });
      setName('');
      await refreshPlaylists();
    } catch (err) {
      setError(err.message);
    }
  };

  const open = async (id) => {
    try {
      const res = await vixApi.getPlaylist(id);
      setActive(res.playlist);
    } catch (err) {
      setError(err.message);
    }
  };

  const play = (pl) => {
    if (!pl.tracks?.length) return;
    playTrack(pl.tracks[0], pl.tracks, 0);
  };

  return (
    <div className="home-view">
      <section className="home-hero">
        <h1>Playlists</h1>
        <p className="subtitle">De {user.displayName}</p>
      </section>

      {error && <div className="view-error">{error}</div>}

      <section className="home-section">
        <form onSubmit={create} className="playlist-create">
          <input
            placeholder="Nueva playlist…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn-primary">Crear</button>
        </form>
      </section>

      {!active && (
        <section className="home-section">
          <div className="playlist-list">
            {playlists.map((pl) => (
              <div key={pl.id} className="playlist-row">
                <button type="button" className="playlist-row__open" onClick={() => open(pl.id)}>
                  <span className="playlist-row__name">{pl.name}</span>
                  <span className="playlist-row__meta">{pl.trackCount} canciones</span>
                </button>
                <button type="button" className="btn-ghost" onClick={() => open(pl.id).then(() => {})}>Abrir</button>
              </div>
            ))}
            {playlists.length === 0 && <p className="hint">Aún no tienes playlists. Crea una arriba.</p>}
          </div>
        </section>
      )}

      {active && (
        <section className="home-section">
          <button type="button" className="btn-ghost" onClick={() => setActive(null)}>← Todas las playlists</button>
          <h2>{active.name}</h2>
          {active.tracks?.length > 0 && (
            <button type="button" className="btn-play-big" onClick={() => play(active)}>▶ Reproducir</button>
          )}
          <div className="download-list">
            {active.tracks?.map((t, i) => (
              <button
                key={t.id}
                type="button"
                className="download-row__play"
                onClick={() => playTrack(t, active.tracks, i)}
              >
                <img src={t.image} alt="" />
                <div className="download-row__meta">
                  <div className="download-row__title">{parseTrackForSearch(t).title || t.title}</div>
                  <div className="download-row__artist">{t.artist}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
