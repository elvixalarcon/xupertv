import { useOffline } from '../context/OfflineContext';
import { getOfflineId } from '../lib/offlineIds';

export default function DownloadButton({ track, className = '' }) {
  const { isDownloaded, downloadTrack, removeDownload, activeDownload } = useOffline();
  const downloaded = isDownloaded(track);
  const oid = track ? getOfflineId(track) : '';
  const busy = activeDownload?.id === oid;

  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!track) return;
    if (downloaded) {
      await removeDownload(track);
      return;
    }
    try {
      await downloadTrack(track);
    } catch (err) {
      alert(err.message || 'No se pudo descargar');
    }
  };

  if (!track) return null;

  return (
    <button
      type="button"
      className={[
        'dl-btn',
        downloaded ? 'dl-btn--done' : '',
        busy ? 'dl-btn--busy' : '',
        className,
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      title={downloaded ? 'Quitar descarga' : 'Descargar para offline'}
      aria-label={downloaded ? 'Quitar descarga' : 'Descargar'}
      disabled={Boolean(activeDownload && !downloaded && !busy)}
    >
      {downloaded ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V3a1 1 0 0 1 1-1zm-7 16a1 1 0 0 1 1-1h12a1 1 0 0 1 0 2H6a1 1 0 0 1-1-1z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1zm-7 13a1 1 0 0 1 1 1v3h12v-3a1 1 0 1 1 2 0v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
        </svg>
      )}
    </button>
  );
}
