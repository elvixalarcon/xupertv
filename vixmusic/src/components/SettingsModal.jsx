import { usePlayer } from '../context/PlayerContext';

export default function SettingsModal({ open, onClose }) {
  const { compatPlayback, setCompatPlayback } = usePlayer();
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <h2>Ajustes</h2>
        <label className="settings-toggle">
          <input type="checkbox" checked={compatPlayback} onChange={(e) => setCompatPlayback(e.target.checked)} />
          <span>
            <strong>Modo compatibilidad</strong>
            <br />
            <span className="hint">Prueba varias versiones si una canción no suena.</span>
          </span>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
