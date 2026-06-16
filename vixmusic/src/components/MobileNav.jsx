import { NavLink } from 'react-router-dom';

const items = [
  {
    to: '/',
    label: 'Inicio',
    end: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12.5 3.247a1 1 0 0 0-1 0L4 7.577V20h4.5v-6.75a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V20H20V7.577l-7.5-4.33z" />
      </svg>
    ),
  },
  {
    to: '/buscar',
    label: 'Buscar',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M10.533 1.279c-5.18 0-9.407 4.14-9.407 9.279s4.226 9.279 9.407 9.279c2.234 0 4.29-.77 5.918-2.066l4.957 4.957a1 1 0 1 0 1.414-1.414l-4.957-4.957A9.266 9.266 0 0 0 10.533 1.279zm-7.407 9.279c0-4.006 3.312-7.279 7.407-7.279s7.407 3.273 7.407 7.279-3.312 7.279-7.407 7.279-7.407-3.273-7.407-7.279z" />
      </svg>
    ),
  },
  {
    to: '/artistas',
    label: 'Artistas',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 1.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zm0 2.25a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm-5.25 9.75a5.25 5.25 0 0 1 10.5 0 .75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75z" />
      </svg>
    ),
  },
  {
    to: '/descargas',
    label: 'Descargas',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1zm-7 13a1 1 0 0 1 1 1v3h12v-3a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
      </svg>
    ),
  },
  {
    to: '/biblioteca',
    label: 'Favoritos',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
      </svg>
    ),
  },
];

export default function MobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Navegación principal">
      {items.map(({ to, label, icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `mobile-nav__item${isActive ? ' active' : ''}`}
        >
          {icon}
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
