import { Link } from 'react-router-dom';
import { assetUrl } from '../lib/platform';

export default function ArtistCard({ artist }) {
  const key = artist.spotifyArtistId || artist.id;
  const to = `/artista/${encodeURIComponent(key)}`;

  return (
    <Link to={to} className="artist-card">
      <div className="artist-card__img-wrap">
        <img src={artist.image || assetUrl('icon-192.png')} alt="" className="artist-card__img" />
      </div>
      <div className="artist-card__name">{artist.name}</div>
      <div className="artist-card__sub">Artista</div>
    </Link>
  );
}
