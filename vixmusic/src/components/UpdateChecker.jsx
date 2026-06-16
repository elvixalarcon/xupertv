import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { getServerUrl } from '../lib/appConfig';
import { httpFetch } from '../lib/http';
import { isNativeApp } from '../lib/platform';
import {
  dismissUpdateVersion,
  getDismissedUpdateVersion,
  isRemoteUpdateAvailable,
  startPlatformUpdate,
} from '../lib/appUpdate';

export default function UpdateChecker() {
  const [update, setUpdate] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isNativeApp()) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const info = await App.getInfo();
        const platform = Capacitor.getPlatform();
        const server = getServerUrl();
        const res = await httpFetch(`${server}/versions.json`, { cache: 'no-store', timeout: 10000 });
        if (!res.ok || cancelled) return;
        const versions = await res.json();
        const remote = platform === 'ios' ? versions.ios : versions.android;
        if (!remote || !isRemoteUpdateAvailable(remote, info)) return;

        const dismissed = await getDismissedUpdateVersion();
        if (dismissed === remote.version) return;

        if (!cancelled) {
          setUpdate({
            version: remote.version,
            url: remote.url,
            notes: remote.notes || '',
            platform,
          });
        }
      } catch {
        /* ignore */
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const onLater = async () => {
    if (update?.version) await dismissUpdateVersion(update.version);
    setUpdate(null);
    setPhase('idle');
    setError('');
  };

  const onDownload = async () => {
    if (!update?.url || phase === 'downloading') return;
    setPhase('downloading');
    setError('');
    setProgress(0);
    setStatus('Iniciando…');

    try {
      await startPlatformUpdate(update, (pct, msg) => {
        setProgress(pct);
        setStatus(msg);
      });
      await dismissUpdateVersion(update.version);
      setPhase('done');
    } catch (e) {
      setPhase('error');
      setError(e?.message || 'No se pudo descargar la actualización');
    }
  };

  if (!update) return null;

  const isAndroid = update.platform === 'android';
  const busy = phase === 'downloading';

  return (
    <div className="modal-backdrop update-backdrop" role="presentation">
      <div className="modal update-modal" role="dialog" aria-labelledby="update-title">
        <h2 id="update-title">Actualización {update.version}</h2>
        <p>{update.notes}</p>

        {phase === 'idle' && (
          <p className="update-modal__hint">
            {isAndroid
              ? 'La descarga e instalación se harán dentro de VixMusic. Al terminar, confirma en la pantalla del sistema.'
              : 'Se abrirá el enlace para obtener la nueva versión.'}
          </p>
        )}

        {busy && (
          <div className="update-modal__progress-wrap">
            <div className="update-modal__progress-bar">
              <div className="update-modal__progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="update-modal__progress-text">{status || `${progress}%`}</p>
          </div>
        )}

        {phase === 'done' && (
          <p className="update-modal__hint update-modal__hint--ok">
            {isAndroid
              ? 'Si no ves el instalador, revisa las notificaciones o permisos de instalación.'
              : 'Sigue las instrucciones del enlace para instalar.'}
          </p>
        )}

        {phase === 'error' && (
          <p className="update-modal__hint update-modal__hint--error">{error}</p>
        )}

        <div className="modal-actions">
          {phase !== 'done' && (
            <button type="button" className="btn-secondary" onClick={onLater} disabled={busy}>
              Más tarde
            </button>
          )}
          {phase === 'done' ? (
            <button type="button" className="btn-primary" onClick={() => setUpdate(null)}>
              Entendido
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={onDownload} disabled={busy}>
              {busy ? 'Descargando…' : isAndroid ? 'Actualizar ahora' : 'Descargar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
