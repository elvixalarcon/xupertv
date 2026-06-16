import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { resolveForPlayback } from '../api/unified';
import { getPipedAudioStreamUrl } from '../api/piped';
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
import { YT_STREAM_HEADERS } from '../lib/audioPlayback';

const OfflineContext = createContext(null);

export function OfflineProvider({ children }) {
  const [downloads, setDownloads] = useState([]);
  const [downloadedIds, setDownloadedIds] = useState(() => new Set());
  const [storageLabel, setStorageLabel] = useState('0 MB');
  const [activeDownload, setActiveDownload] = useState(null);

  const refresh = useCallback(async () => {
    const list = await listDownloads();
    setDownloads(list);
    setDownloadedIds(new Set(list.map((d) => d.id)));
    const bytes = await getDownloadsSize();
    setStorageLabel(formatBytes(bytes));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isDownloaded = useCallback(
    (track) => downloadedIds.has(getOfflineId(track)),
    [downloadedIds],
  );

  const downloadTrack = useCallback(
    async (track) => {
      const oid = getOfflineId(track);
      if (downloadedIds.has(oid)) return;

      setActiveDownload({ id: oid, title: track.title, progress: 5 });
      try {
        let resolved = track;
        if (!track.videoId) {
          setActiveDownload({ id: oid, title: track.title, progress: 15 });
          resolved = await resolveForPlayback(track, [], { compat: true });
        }

        setActiveDownload({ id: oid, title: track.title, progress: 35 });
        const stream = await getPipedAudioStreamUrl(
          resolved.videoId,
          resolved.alternateVideoIds || [],
        );

        setActiveDownload({ id: oid, title: track.title, progress: 55 });
        const blob = await httpGetBlob(stream.url, 180000, YT_STREAM_HEADERS);
        if (!blob.size) throw new Error('Archivo vacío');

        await saveDownload(
          { ...track, ...resolved, videoId: stream.videoId },
          blob,
          stream.videoId,
        );

        setActiveDownload({ id: oid, title: track.title, progress: 100 });
        await refresh();
      } catch (e) {
        setActiveDownload(null);
        throw e;
      } finally {
        setTimeout(() => setActiveDownload(null), 600);
      }
    },
    [downloadedIds, refresh],
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
