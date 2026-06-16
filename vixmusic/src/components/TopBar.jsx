import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';

export default function TopBar({ onOpenSettings, panelOpen, onTogglePanel }) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onSearchPage = pathname === '/buscar' || pathname.startsWith('/buscar/');

  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    navigate(`/buscar?q=${encodeURIComponent(term)}`);
  };

  return (
    <header className={`top-bar${onSearchPage ? ' top-bar--search-page' : ''}`}>
      <div className="top-bar__left">
        <Link to="/" end className="top-bar__home" title="Inicio" aria-label="Inicio">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12.5 3.247a1 1 0 0 0-1 0L4 7.577V20h4.5v-6.75a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V20H20V7.577l-7.5-4.33z" />
          </svg>
        </Link>
      </div>

      {!onSearchPage && (
        <form className="top-bar__search" onSubmit={submit}>
          <svg className="top-bar__search-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M10.533 1.279c-5.18 0-9.407 4.14-9.407 9.279s4.226 9.279 9.407 9.279c2.234 0 4.29-.77 5.918-2.066l4.957 4.957a1 1 0 1 0 1.414-1.414l-4.957-4.957A9.266 9.266 0 0 0 10.533 1.279zm-7.407 9.279c0-4.006 3.312-7.279 7.407-7.279s7.407 3.273 7.407 7.279-3.312 7.279-7.407 7.279-7.407-3.273-7.407-7.279z" />
          </svg>
          <input
            type="search"
            placeholder="¿Qué quieres reproducir?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar"
          />
        </form>
      )}

      <div className="top-bar__right">
        <button
          type="button"
          className="top-bar__panel top-bar__panel--desktop"
          onClick={onTogglePanel}
          title={panelOpen ? 'Ocultar panel' : 'Mostrar panel'}
          aria-label="Panel lateral"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M4 6h16v2H4V6zm0 5h10v2H4v-2zm0 5h16v2H4v-2z" />
          </svg>
        </button>
        <button type="button" className="top-bar__avatar" onClick={onOpenSettings} aria-label="Ajustes" title="Ajustes">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4a7.96 7.96 0 0 1-.1 1l2.03 1.58a.5.5 0 0 1 .12.64l-1.92 3.32a.5.5 0 0 1-.6.22l-2.39-.96a8.06 8.06 0 0 1-1.73 1l-.36 2.54a.5.5 0 0 1-.5.42h-3.84a.5.5 0 0 1-.5-.42l-.36-2.54a8.06 8.06 0 0 1-1.73-1l-2.39.96a.5.5 0 0 1-.6-.22L2.55 15.2a.5.5 0 0 1 .12-.64L4.7 13a7.96 7.96 0 0 1 0-2L2.67 9.42a.5.5 0 0 1-.12-.64l1.92-3.32a.5.5 0 0 1 .6-.22l2.39.96a8.06 8.06 0 0 1 1.73-1l.36-2.54a.5.5 0 0 1 .5-.42h3.84a.5.5 0 0 1 .5.42l.36 2.54a8.06 8.06 0 0 1 1.73 1l2.39-.96a.5.5 0 0 1 .6.22l1.92 3.32a.5.5 0 0 1-.12.64L21.3 13c.07.33.1.66.1 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
