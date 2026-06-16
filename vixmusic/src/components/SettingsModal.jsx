import { useState } from 'react';
import {
  getSpotifyClientId,
  getSpotifyClientSecret,
  saveUserConfig,
} from '../api/config';
import { usePlayer } from '../context/PlayerContext';

export default function SettingsModal({ open, onClose, onSaved }) {
  const [sid, setSid] = useState(getSpotifyClientId());
  const [sec, setSec] = useState(getSpotifyClientSecret());
  const [saved, setSaved] = useState(false);
  const { compatPlayback, setCompatPlayback } = usePlayer();

  if (!open) return null;

  const save = () => {
    if (!sid.trim() || !sec.trim()) {
      alert('Spotify Client ID y Secret son necesarios para buscar artistas y canciones.');
      return;
    }
    saveUserConfig({ spotifyId: sid, spotifySecret: sec });
    setSaved(true);
    onSaved?.();
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 400);
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog">
        <h2>Ajustes de VixMusic</h2>

        <h3 className="modal-section">Spotify (catálogo)</h3>
        <p className="hint">
          <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
            Spotify for Developers
          </a>
          {' '}→ crea una app → copia <strong>Client ID</strong> y <strong>Client Secret</strong>.
          Se usa para buscar artistas, álbumes y canciones.
        </p>
        <input className="field-input mb-2" value={sid} onChange={(e) => setSid(e.target.value)} placeholder="Spotify Client ID" />
        <input className="field-input" value={sec} onChange={(e) => setSec(e.target.value)} placeholder="Spotify Client Secret" type="password" />

        <h3 className="modal-section">Reproducción</h3>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={compatPlayback}
            onChange={(e) => setCompatPlayback(e.target.checked)}
          />
          <span>
            <strong>Modo compatibilidad máxima</strong> (recomendado)
            <br />
            <span className="hint">Prueba varias versiones de cada canción hasta que una suene. Actívalo si algunas no reproducen.</span>
          </span>
        </label>

        <p className="hint" style={{ marginTop: 16 }}>
          El audio usa el reproductor de YouTube embebido. La búsqueda no requiere API Key de Google.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button>
          <button type="button" className="btn-primary" onClick={save}>{saved ? 'Guardado ✓' : 'Guardar'}</button>
        </div>
        <p className="legal">
          No es la app oficial de Spotify ni YouTube. Spotify no permite streaming directo en apps de terceros;
          por eso la reproducción usa versiones de audio disponibles en YouTube.
        </p>
      </div>
    </div>
  );
}
