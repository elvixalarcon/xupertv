import { Link } from 'react-router-dom';

const base = import.meta.env.BASE_URL || '/';

export default function VixMusicLogo({ className = '', compact = false, showText = true }) {
  return (
    <Link
      to="/"
      end
      className={['vix-logo', compact ? 'vix-logo--compact' : '', className].filter(Boolean).join(' ')}
      aria-label="VixMusic — Ir al inicio"
      title="Inicio"
    >
      <img src={`${base}logo.svg`} alt="" className="vix-logo__mark" width="36" height="36" />
      {showText && !compact && <span className="vix-logo__text">VixMusic</span>}
    </Link>
  );
}
