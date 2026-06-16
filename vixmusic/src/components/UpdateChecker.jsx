import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { getServerUrl } from '../lib/appConfig';
import { httpFetch } from '../lib/http';
import { isNativeApp } from '../lib/platform';

function isNewer(remote, current) {
  const a = String(remote).split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(current).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

export default function UpdateChecker() {
  const [update, setUpdate] = useState(null);

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
        if (!remote?.version || !isNewer(remote.version, info.version)) return;
        setUpdate({ version: remote.version, url: remote.url, notes: remote.notes || '', platform });
      } catch {
        /* ignore */
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (!update) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog">
        <h2>Actualización {update.version}</h2>
        <p>{update.notes}</p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={() => setUpdate(null)}>Más tarde</button>
          <button type="button" className="btn-primary" onClick={() => window.open(update.url, '_system')}>
            Descargar
          </button>
        </div>
      </div>
    </div>
  );
}
