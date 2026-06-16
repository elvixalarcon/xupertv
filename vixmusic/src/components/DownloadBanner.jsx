import { useOffline } from '../context/OfflineContext';

/** Barra de progreso global visible en cualquier pantalla durante una descarga. */
export default function DownloadBanner() {
  const { activeDownload } = useOffline();
  if (!activeDownload) return null;

  const { title, progress = 0, phase = 'Descargando…' } = activeDownload;

  return (
    <div className="download-toast" role="status" aria-live="polite">
      <div className="download-toast__head">
        <span className="download-toast__icon" aria-hidden>↓</span>
        <div className="download-toast__text">
          <strong>{phase}</strong>
          <span className="download-toast__title">{title}</span>
        </div>
        <span className="download-toast__pct">{progress}%</span>
      </div>
      <div className="download-toast__bar">
        <div className="download-toast__fill" style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
    </div>
  );
}
