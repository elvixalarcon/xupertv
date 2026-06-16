import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createYouTubePlayer, loadYouTubeIframeApi } from '../lib/youtubeIframe';
import { resolveForPlayback, fetchRadioMoreTracks, cleanSongTitle, parseTrackForSearch } from '../api/unified';
import { getCompatPlayback } from '../lib/playbackSettings';
import { getDownloadForTrack, getPlaybackUrl, hasOfflineAudio } from '../lib/downloads';
import { getOfflineId } from '../lib/offlineIds';

const PlayerContext = createContext(null);
export const PLAYER_HOST_ID = 'vix-yt-player-host';

function normKey(title, artist) {
  return `${(title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(artist || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

export function PlayerProvider({ children }) {
  const playerRef = useRef(null);
  const tickRef = useRef(null);
  const queueRef = useRef([]);
  const indexRef = useRef(0);
  const repeatRef = useRef(false);
  const shuffleRef = useRef(false);
  const radioRef = useRef(false);
  const radioArtistRef = useRef({ name: '', spotifyId: null });
  const nextRef = useRef(() => {});
  const pendingRef = useRef(null);
  const advancingRef = useRef(false);
  const wantsPlayRef = useRef(false);
  const playTrackInternalRef = useRef(null);
  const failedVideosRef = useRef(new Set());
  const alternateVideosRef = useRef([]);
  const retryingRef = useRef(false);
  const compatRef = useRef(getCompatPlayback());
  const offlineAudioRef = useRef(null);
  const offlineBlobUrlRef = useRef(null);
  const usingOfflineRef = useRef(false);

  const [compatPlayback, setCompatPlaybackState] = useState(() => getCompatPlayback());
  const [offlineMode, setOfflineMode] = useState(false);

  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [radioMode, setRadioMode] = useState(false);
  const [current, setCurrent] = useState(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [videoPreview, setVideoPreview] = useState(false);

  queueRef.current = queue;
  indexRef.current = index;
  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  radioRef.current = radioMode;
  compatRef.current = compatPlayback;

  const setCompatPlayback = useCallback((v) => {
    compatRef.current = v;
    setCompatPlaybackState(v);
    try {
      localStorage.setItem('vixmusic_compat_playback', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const stopOffline = useCallback(() => {
    const audio = offlineAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (offlineBlobUrlRef.current?.startsWith('blob:')) {
      URL.revokeObjectURL(offlineBlobUrlRef.current);
      offlineBlobUrlRef.current = null;
    } else {
      offlineBlobUrlRef.current = null;
    }
    usingOfflineRef.current = false;
    setOfflineMode(false);
  }, []);

  const pauseYouTube = useCallback(() => {
    try {
      playerRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
  }, []);

  const playOffline = useCallback(
    async (record, list, startIndex, fromUser = true) => {
      stopOffline();
      pauseYouTube();

      let audio = offlineAudioRef.current;
      if (!audio) {
        audio = new Audio();
        offlineAudioRef.current = audio;
        audio.addEventListener('ended', () => nextRef.current());
        audio.addEventListener('timeupdate', () => {
          if (!usingOfflineRef.current) return;
          setProgress(audio.currentTime || 0);
          if (audio.duration && Number.isFinite(audio.duration)) {
            setDuration(audio.duration);
          }
        });
        audio.addEventListener('play', () => setPlaying(true));
        audio.addEventListener('pause', () => setPlaying(false));
      }

      const url = await getPlaybackUrl(record);
      if (!url) throw new Error('Archivo offline no válido');
      offlineBlobUrlRef.current = url;
      usingOfflineRef.current = true;
      setOfflineMode(true);
      audio.volume = volume / 100;
      audio.src = url;

      const track = {
        id: record.id,
        title: record.title,
        artist: record.artist,
        album: record.album,
        image: record.image,
        duration: record.duration,
        videoId: record.videoId,
        spotifyId: record.spotifyId,
        offline: true,
      };

      const newList = [...list];
      newList[startIndex] = track;
      setQueue(newList);
      setIndex(startIndex);
      setCurrent({
        ...track,
        title: cleanSongTitle(parseTrackForSearch(track).title || track.title) || track.title,
      });
      setVideoPreview(false);
      setPlayerError('');

      if (fromUser) {
        audio.play().catch(() => setPlayerError('No se pudo reproducir offline'));
      }
    },
    [pauseYouTube, stopOffline, volume],
  );

  const startVideo = useCallback((videoId, fromUser = false) => {
    stopOffline();
    const p = playerRef.current;
    if (!p || !videoId) return false;
    setPlayerError('');
    wantsPlayRef.current = fromUser;
    try {
      if (typeof p.loadVideoById === 'function') {
        p.loadVideoById(videoId, 0);
        if (fromUser) {
          setTimeout(() => {
            try {
              p.playVideo();
              setPlaying(true);
            } catch {
              /* onStateChange reintentará */
            }
          }, 150);
        }
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }, [stopOffline]);

  const tryNextAlternateRef = useRef(() => false);

  const tryNextAlternate = useCallback((fromUser = true) => {
    while (alternateVideosRef.current.length) {
      const vid = alternateVideosRef.current.shift();
      if (!vid || failedVideosRef.current.has(vid)) continue;
      setPlayerError('Probando otra versión…');
      if (startVideo(vid, fromUser)) {
        const q = [...queueRef.current];
        const idx = indexRef.current;
        if (q[idx]) {
          q[idx] = { ...q[idx], videoId: vid };
          setQueue(q);
        }
        setCurrent((c) => (c ? { ...c, videoId: vid } : c));
        return true;
      }
    }
    return false;
  }, [startVideo]);

  tryNextAlternateRef.current = tryNextAlternate;

  const playTrackInternal = useCallback(
    async (t, list, startIndex, fromUser = true) => {
      if (!t) return;
      setPlayerError('');

      const offline = await getDownloadForTrack(t);
      if (hasOfflineAudio(offline)) {
        setResolving(false);
        alternateVideosRef.current = [];
        try {
          await playOffline(offline, list, startIndex, fromUser);
        } catch (e) {
          setPlayerError(e.message || 'Error offline');
        }
        return;
      }

      stopOffline();
      let track = t;
      setResolving(true);
      try {
        track = await resolveForPlayback(t, [...failedVideosRef.current], {
          compat: compatRef.current,
        });
      } catch (e) {
        setPlayerError(e.message || 'No se pudo cargar');
        setResolving(false);
        alternateVideosRef.current = [];
        return;
      }
      setResolving(false);
      alternateVideosRef.current = track.alternateVideoIds || [];

      const newList = [...list];
      newList[startIndex] = track;
      setQueue(newList);
      setIndex(startIndex);
      setCurrent({
        ...track,
        title: cleanSongTitle(parseTrackForSearch(track).title || track.title) || track.title,
      });
      setVideoPreview(false);

      const p = playerRef.current;
      if (playerReady && p?.loadVideoById && track.videoId) {
        startVideo(track.videoId, fromUser);
      } else {
        pendingRef.current = { t: track, list: newList, startIndex, fromUser };
      }
    },
    [startVideo, playerReady, playOffline],
  );

  playTrackInternalRef.current = playTrackInternal;

  const playTrack = useCallback(
    (t, list = [t], startIndex = 0, { keepShuffle = false, keepRadio = false } = {}) => {
      if (!keepShuffle) {
        setShuffle(false);
        shuffleRef.current = false;
      }
      if (!keepRadio) {
        setRadioMode(false);
        radioRef.current = false;
      }
      failedVideosRef.current = new Set();
      alternateVideosRef.current = [];
      playTrackInternal(t, list, startIndex, true);
    },
    [playTrackInternal],
  );

  const pickNextIndex = useCallback((cur, q) => {
    if (!q.length) return -1;
    if (shuffleRef.current && q.length > 1) {
      let ni;
      let guard = 0;
      do {
        ni = Math.floor(Math.random() * q.length);
        guard += 1;
      } while (ni === cur && q.length > 1 && guard < 20);
      return ni;
    }
    let ni = cur + 1;
    if (ni >= q.length) return repeatRef.current ? 0 : -1;
    return ni;
  }, []);

  const pickPrevIndex = useCallback((cur, q) => {
    if (!q.length) return -1;
    if (shuffleRef.current && q.length > 1) {
      let ni;
      let guard = 0;
      do {
        ni = Math.floor(Math.random() * q.length);
        guard += 1;
      } while (ni === cur && q.length > 1 && guard < 20);
      return ni;
    }
    let ni = cur - 1;
    if (ni < 0) return repeatRef.current ? q.length - 1 : 0;
    return ni;
  }, []);

  const appendRadioTracks = useCallback(async () => {
    const q = queueRef.current;
    const cur = current;
    const artistName = radioArtistRef.current.name || cur?.artist;
    if (!artistName) return q;

    const keys = q.map((t) => normKey(t.title, t.artist));
    const more = await fetchRadioMoreTracks(
      artistName,
      radioArtistRef.current.spotifyId,
      keys,
    );
    if (!more.length) return q;
    return [...q, ...more];
  }, [current]);

  const advance = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      let q = queueRef.current;
      let cur = indexRef.current;
      let ni = pickNextIndex(cur, q);

      if (ni < 0 && radioRef.current) {
        const extended = await appendRadioTracks();
        if (extended.length > q.length) {
          q = extended;
          queueRef.current = extended;
          setQueue(extended);
          ni = cur + 1;
        }
      }

      if (ni < 0 || ni === cur) {
        if (repeatRef.current && q.length) {
          ni = shuffleRef.current ? pickNextIndex(cur, q) : 0;
        } else {
          return;
        }
      }

      if (ni >= 0 && q[ni]) {
        await playTrackInternal(q[ni], q, ni, true);
      }
    } finally {
      advancingRef.current = false;
    }
  }, [appendRadioTracks, pickNextIndex, playTrackInternal]);

  nextRef.current = () => { advance(); };

  const next = useCallback(() => { advance(); }, [advance]);

  const prev = useCallback(() => {
    if (usingOfflineRef.current) {
      const audio = offlineAudioRef.current;
      if (audio && audio.currentTime > 3) {
        audio.currentTime = 0;
        setProgress(0);
        return;
      }
    } else {
      const p = playerRef.current;
      try {
        if (p?.getCurrentTime && p.getCurrentTime() > 3) {
          p.seekTo(0, true);
          setProgress(0);
          return;
        }
      } catch {
        /* ignore */
      }
    }
    const q = queueRef.current;
    const cur = indexRef.current;
    const ni = pickPrevIndex(cur, q);
    if (ni >= 0 && q[ni]) playTrackInternal(q[ni], q, ni, true);
  }, [pickPrevIndex, playTrackInternal]);

  const toggle = useCallback(() => {
    if (usingOfflineRef.current) {
      const audio = offlineAudioRef.current;
      if (!audio) return;
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
      return;
    }
    const p = playerRef.current;
    if (!p?.getPlayerState) return;
    try {
      const st = p.getPlayerState();
      const YT = window.YT;
      if (st === YT?.PlayerState?.PLAYING) {
        p.pauseVideo();
        setPlaying(false);
      } else {
        p.playVideo();
        setPlaying(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const seek = useCallback((sec) => {
    if (usingOfflineRef.current && offlineAudioRef.current) {
      offlineAudioRef.current.currentTime = sec;
      setProgress(sec);
      return;
    }
    try {
      playerRef.current?.seekTo(sec, true);
      setProgress(sec);
    } catch {
      /* ignore */
    }
  }, []);

  /** Reproducir cola de artista con opciones shuffle / radio */
  const playArtistQueue = useCallback(
    (tracks, artist, { shuf = false, radio = false, startIndex = 0 } = {}) => {
      if (!tracks?.length) return;
      setShuffle(shuf);
      shuffleRef.current = shuf;
      setRadioMode(radio);
      radioRef.current = radio;
      radioArtistRef.current = {
        name: artist?.name || tracks[0]?.artist || '',
        spotifyId:
          artist?.spotifyArtistId ||
          (artist?.id?.startsWith?.('yt-') ? null : artist?.id) ||
          null,
      };
      playTrack(tracks[startIndex], tracks, startIndex, { keepShuffle: shuf, keepRadio: radio });
    },
    [playTrack],
  );

  const retryCurrentTrack = useCallback(async () => {
    const cur = queueRef.current[indexRef.current];
    if (!cur) return;
    if (tryNextAlternate(true)) return;

    if (cur.videoId) failedVideosRef.current.add(cur.videoId);
    setResolving(true);
    setPlayerError('Buscando otra versión…');
    try {
      const alt = await resolveForPlayback(
        { ...cur, videoId: null },
        [...failedVideosRef.current],
        { compat: true },
      );
      alternateVideosRef.current = alt.alternateVideoIds || [];
      const q = [...queueRef.current];
      const idx = indexRef.current;
      q[idx] = alt;
      setQueue(q);
      setCurrent({ ...alt, title: cleanSongTitle(alt.title) || alt.title });
      startVideo(alt.videoId, true);
      setPlayerError('');
    } catch (e) {
      setPlayerError(e.message || 'No se pudo reproducir');
    } finally {
      setResolving(false);
    }
  }, [tryNextAlternate, startVideo]);

  useEffect(() => {
    let cancelled = false;
    let created = false;

    const boot = async () => {
      await loadYouTubeIframeApi();
      if (cancelled || created) return;

      const host = document.getElementById(PLAYER_HOST_ID);
      if (!host) {
        setTimeout(boot, 200);
        return;
      }

      created = true;
      playerRef.current = createYouTubePlayer(PLAYER_HOST_ID, {
        events: {
          onReady: (ev) => {
            if (cancelled) return;
            playerRef.current = ev.target;
            setPlayerReady(true);
            try { ev.target.setVolume(80); } catch { /* */ }
            const pending = pendingRef.current;
            if (pending?.t?.videoId) {
              pendingRef.current = null;
              startVideo(pending.t.videoId, pending.fromUser !== false);
            }
          },
          onStateChange: (e) => {
            const YT = window.YT;
            if (!YT) return;
            const p = playerRef.current;
            if (e.data === YT.PlayerState.PLAYING) {
              setPlaying(true);
              setPlayerError('');
              wantsPlayRef.current = false;
            }
            if (e.data === YT.PlayerState.PAUSED) setPlaying(false);
            if (e.data === YT.PlayerState.ENDED) nextRef.current();
            if (
              wantsPlayRef.current
              && p
              && (e.data === YT.PlayerState.CUED || e.data === YT.PlayerState.PAUSED)
            ) {
              try {
                p.playVideo();
                setPlaying(true);
              } catch {
                /* ignore */
              }
            }
          },
          onError: async (e) => {
            const codes = {
              2: 'ID de vídeo no válido',
              5: 'Error del reproductor',
              100: 'Vídeo no encontrado',
              101: 'No se puede reproducir aquí',
              150: 'No se puede reproducir aquí',
            };
            setPlaying(false);
            wantsPlayRef.current = false;

            const cur = queueRef.current[indexRef.current];
            const q = queueRef.current;
            const idx = indexRef.current;
            if (cur?.videoId) failedVideosRef.current.add(cur.videoId);

            const retryable = [2, 5, 100, 101, 150].includes(e.data);
            if (!retryable) {
              setPlayerError(codes[e.data] || 'Error de reproducción');
              return;
            }

            if (tryNextAlternateRef.current(true)) return;

            if (!cur || retryingRef.current) {
              setPlayerError(codes[e.data] || 'Error de reproducción');
              return;
            }

            retryingRef.current = true;
            setPlayerError('Buscando otra versión…');
            try {
              const alt = await resolveForPlayback(
                { ...cur, videoId: null },
                [...failedVideosRef.current],
                { compat: true },
              );
              if (alt?.videoId && !failedVideosRef.current.has(alt.videoId)) {
                alternateVideosRef.current = alt.alternateVideoIds || [];
                await playTrackInternalRef.current?.(alt, q, idx, true);
                setPlayerError('');
              } else {
                setPlayerError('No se puede reproducir. Pulsa «Probar otra versión».');
              }
            } catch {
              setPlayerError(codes[e.data] || 'No se puede reproducir. Pulsa «Probar otra versión».');
            } finally {
              retryingRef.current = false;
            }
          },
        },
      });
    };

    boot();
    return () => {
      cancelled = true;
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [startVideo]);

  useEffect(() => {
    if (!playerReady) return;
    const pending = pendingRef.current;
    if (pending?.t?.videoId) {
      pendingRef.current = null;
      startVideo(pending.t.videoId, pending.fromUser !== false);
    }
  }, [playerReady, startVideo]);

  useEffect(() => {
    if (usingOfflineRef.current && offlineAudioRef.current) {
      offlineAudioRef.current.volume = volume / 100;
      return;
    }
    if (!playerReady) return;
    try { playerRef.current?.setVolume(volume); } catch { /* */ }
  }, [volume, playerReady]);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (usingOfflineRef.current) return;
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      try {
        const t = p.getCurrentTime() || 0;
        const d = p.getDuration() || 0;
        setProgress(t);
        if (d > 0) setDuration(d);
      } catch { /* */ }
    }, 400);
    return () => clearInterval(tickRef.current);
  }, [playerReady]);

  const track = current || queue[index] || null;

  return (
    <PlayerContext.Provider
      value={{
        track,
        queue,
        playing,
        progress,
        duration,
        volume,
        setVolume,
        shuffle,
        setShuffle: (v) => { setShuffle(v); shuffleRef.current = v; },
        repeat,
        setRepeat,
        radioMode,
        setRadioMode: (v) => {
          setRadioMode(v);
          radioRef.current = v;
          if (v && current) {
            radioArtistRef.current = {
              name: current.artist || '',
              spotifyId: null,
            };
          }
        },
        playTrack,
        playArtistQueue,
        toggle,
        next,
        prev,
        seek,
        playerReady,
        playerError,
        resolving,
        videoPreview,
        setVideoPreview,
        toggleVideoPreview: () => setVideoPreview((v) => !v),
        compatPlayback,
        setCompatPlayback,
        retryCurrentTrack,
        offlineMode,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer outside provider');
  return ctx;
}
