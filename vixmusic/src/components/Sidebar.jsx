import { Link, NavLink } from 'react-router-dom';
import { listFavorites } from '../lib/favorites';
import VixMusicLogo from './VixMusicLogo';

export default function Sidebar() {
  const favs = listFavorites().slice(0, 12);

  return (
    <aside className="library-sidebar">
      <div className="library-sidebar__head">
        <span className="library-sidebar__title">Tu biblioteca</span>
        <Link to="/biblioteca" className="library-sidebar__create" title="Favoritos" aria-label="Ir a favoritos">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 1.5a.75.75 0 0 1 .75.75v5.25H14a.75.75 0 0 1 0 1.5H8.75V14a.75.75 0 0 1-1.5 0V8.75H2a.75.75 0 0 1 0-1.5h5.25V2.25A.75.75 0 0 1 8 1.5z" />
          </svg>
        </Link>
      </div>

      <div className="library-sidebar__filters">
        <NavLink to="/biblioteca" className={({ isActive }) => `lib-chip${isActive ? ' active' : ''}`}>Playlists</NavLink>
        <NavLink to="/descargas" className={({ isActive }) => `lib-chip${isActive ? ' active' : ''}`}>Descargas</NavLink>
        <NavLink to="/artistas" className={({ isActive }) => `lib-chip${isActive ? ' active' : ''}`}>Artistas</NavLink>
        <NavLink to="/" end className={({ isActive }) => `lib-chip${isActive ? ' active' : ''}`}>Álbumes</NavLink>
        <NavLink to="/buscar" className={({ isActive }) => `lib-chip${isActive ? ' active' : ''}`}>Podcasts</NavLink>
      </div>

      <div className="library-sidebar__list-header">
        <span className="library-sidebar__list-label">Lista</span>
      </div>

      <div className="library-sidebar__list">
        <NavLink to="/biblioteca" className="lib-item lib-item--liked">
          <div className="lib-item__thumb lib-item__thumb--heart">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 1.413a4.5 4.5 0 0 0-3.324 7.49l3.324 3.18 3.324-3.18A4.5 4.5 0 0 0 8 1.413z" />
            </svg>
          </div>
          <div className="lib-item__text">
            <div className="lib-item__name">Tus me gusta</div>
            <div className="lib-item__sub">Playlist • VixMusic</div>
          </div>
        </NavLink>
        <NavLink to="/descargas" className="lib-item">
          <div className="lib-item__thumb lib-item__thumb--download">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1zm-7 13a1 1 0 0 1 1 1v3h12v-3a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
            </svg>
          </div>
          <div className="lib-item__text">
            <div className="lib-item__name">Descargas</div>
            <div className="lib-item__sub">Playlist • Offline</div>
          </div>
        </NavLink>
        {favs.map((f) => (
          <div key={f.id} className="lib-item">
            <img className="lib-item__thumb" src={f.image} alt="" />
            <div className="lib-item__text">
              <div className="lib-item__name">{f.title}</div>
              <div className="lib-item__sub">{f.artist}</div>
            </div>
          </div>
        ))}
      </div>

      <VixMusicLogo className="library-sidebar__logo" compact />
    </aside>
  );
}
