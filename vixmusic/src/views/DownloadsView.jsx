import { useEffect, useState } from 'react';
import { usePlayer } from '../context/PlayerContext';
import { useOffline } from '../context/OfflineContext';
import { parseTrackForSearch } from '../api/unified';

export default function DownloadsView() {
  const { playTrack } = usePlayer();
  const { downloads, storageLabel, removeDownload, refreshDownloads, activeDownload } = useOffline();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    refreshDownloads().finally(() => setReady(true));
  }, [refreshDownloads]);

  const play = (d, i) => {
    const track = {
      id: d.id,
      title: d.title,
      artist: d.artist,
      album: d.album,
      image: d.image,
      duration: d.duration,
      videoId: d.videoId,
      spotifyId: d.spotifyId,
      offline: true,
    };
    playTrack(track, downloads.map((x) => ({
      id: x.id,
      title: x.title,
      artist: x.artist,
      album: x.album,
      image: x.image,
      duration: x.duration,
      videoId: x.videoId,
      spotifyId: x.spotifyId,
      offline: true,
    })), i);
  };

  return (
    <div className="home-view">
      <section className="home-hero">
        <h1>Descargas</h1>
        <p className="subtitle">
          Música guardada en este dispositivo · {storageLabel} usados
        </p>
      </section>

      {activeDownload && (
        <div className="download-progress-banner">
          <span>Descargando «{activeDownload.title}»… {activeDownload.progress}%</span>
          <div className="download-progress-banner__bar">
            <div style={{ width: `${activeDownload.progress}%` }} />
          </div>
        </div>
      )}

      {!ready && <div className="view-loading">Cargando descargas…</div>}

      {ready && downloads.length === 0 && (
        <div className="empty-library">
          <p>No tienes descargas aún.</p>
          <p className="hint">
            Pulsa el icono ↓ en el reproductor o en una canción para escucharla sin internet.
          </p>
        </div>
      )}

      {ready && downloads.length > 0 && (
        <section className="home-section">
          <div className="download-list">
            {downloads.map((d, i) => (
              <div key={d.id} className="download-row">
                <button type="button" className="download-row__play" onClick={() => play(d, i)}>
                  <img src={d.image} alt="" />
                  <div className="download-row__meta">
                    <div className="download-row__title">
                      {parseTrackForSearch(d).title || d.title}
                    </div>
                    <div className="download-row__artist">{d.artist}</div>
                  </div>
                  <span className="download-row__badge">Offline</span>
                </button>
                <button
                  type="button"
                  className="download-row__remove"
                  onClick={() => removeDownload(d)}
                  title="Eliminar descarga"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
