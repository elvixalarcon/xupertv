import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { resolveForPlayback } from '../api/unified';
import { resolveAudioStream } from '../lib/resolveAudio';
import {
  getDownloadForTrack,
  listDownloads,
  removeDownloadForTrack,
  saveDownload,
  getDownloadsSize,
  formatBytes,
} from '../lib/downloads';
import { getOfflineId } from '../lib/offlineIds';
import { httpGetBlob } from '../lib/http';
import { getProxiedStreamUrl, isNativePlayback } from '../lib/audioPlayback';

const OfflineContext = createContext(null);

function bumpProgress(setter, oid, patch) {
  setter((prev) => (prev?.id === oid ? { ...prev, ...patch } : prev));
}

export function OfflineProvider({ children }) {
  const [downloads, setDownloads] = useState([]);
  const [downloadedIds, setDownloadedIds] = useState(() => new Set());
  const [storageLabel, setStorageLabel] = useState('0 MB');
  const [activeDownload, setActiveDownload] = useState(null);
  const progressTimer = useRef(null);

  const clearProgressTimer = useCallback(() => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }, []);

  const startProgressPulse = useCallback((oid, from, to) => {
    clearProgressTimer();
    progressTimer.current = setInterval(() => {
      setActiveDownload((prev) => {
        if (!prev || prev.id !== oid) return prev;
        if (prev.progress >= to) return prev;
        return { ...prev, progress: Math.min(prev.progress + 1, to) };
      });
    }, 450);
  }, [clearProgressTimer]);

  const refresh = useCallback(async () => {
    const list = await listDownloads();
    setDownloads(list);
    setDownloadedIds(new Set(list.map((d) => d.id)));
    const bytes = await getDownloadsSize();
    setStorageLabel(formatBytes(bytes));
  }, []);

  useEffect(() => {
    refresh();
    return () => clearProgressTimer();
  }, [refresh, clearProgressTimer]);

  const isDownloaded = useCallback(
    (track) => downloadedIds.has(getOfflineId(track)),
    [downloadedIds],
  );

  const downloadTrack = useCallback(
    async (track) => {
      const oid = getOfflineId(track);
      if (downloadedIds.has(oid)) return;

      setActiveDownload({
        id: oid,
        title: track.title,
        progress: 3,
        phase: 'Preparando…',
      });

      try {
        let resolved = track;
        if (!track.videoId) {
          bumpProgress(setActiveDownload, oid, { progress: 12, phase: 'Buscando canción…' });
          resolved = await resolveForPlayback(track, [], { compat: true });
        }

        bumpProgress(setActiveDownload, oid, { progress: 28, phase: 'Obteniendo audio…' });
        const stream = await resolveAudioStream(
          resolved.videoId,
          resolved.alternateVideoIds || [],
        );

        bumpProgress(setActiveDownload, oid, { progress: 42, phase: 'Descargando archivo…' });
        startProgressPulse(oid, 42, 88);

        const downloadUrl = isNativePlayback()
          ? getProxiedStreamUrl(stream.url)
          : stream.url;
        const blob = await httpGetBlob(downloadUrl, 300000);

        clearProgressTimer();
        bumpProgress(setActiveDownload, oid, { progress: 92, phase: 'Guardando en el dispositivo…' });

        if (!blob.size) throw new Error('Archivo vacío');

        await saveDownload(
          { ...track, ...resolved, videoId: stream.videoId },
          blob,
          stream.videoId,
        );

        setActiveDownload({
          id: oid,
          title: track.title,
          progress: 100,
          phase: '¡Descarga completa!',
        });
        await refresh();
      } catch (e) {
        clearProgressTimer();
        setActiveDownload(null);
        throw e;
      } finally {
        clearProgressTimer();
        setTimeout(() => {
          setActiveDownload((prev) => (prev?.id === oid && prev?.progress === 100 ? null : prev));
        }, 2500);
      }
    },
    [downloadedIds, refresh, startProgressPulse, clearProgressTimer],
  );

  const removeDownload = useCallback(
    async (track) => {
      await removeDownloadForTrack(track);
      await refresh();
    },
    [refresh],
  );

  const getOfflineRecord = useCallback((track) => getDownloadForTrack(track), []);

  const value = useMemo(
    () => ({
      downloads,
      downloadedIds,
      storageLabel,
      activeDownload,
      isDownloaded,
      downloadTrack,
      removeDownload,
      getOfflineRecord,
      refreshDownloads: refresh,
    }),
    [
      downloads,
      downloadedIds,
      storageLabel,
      activeDownload,
      isDownloaded,
      downloadTrack,
      removeDownload,
      getOfflineRecord,
      refresh,
    ],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline outside provider');
  return ctx;
}
