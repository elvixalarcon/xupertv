/** Chromecast + AirPlay para el reproductor web de Vix TV */
(function () {
  const CAST_APP_ID = 'CC1AD845';
  let castSession = null;
  let castReady = false;

  function $(sel) { return document.querySelector(sel); }

  function currentVideo() {
    return $('#video-player');
  }

  function absoluteMediaUrl(src) {
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    return `${location.origin}${src.startsWith('/') ? '' : '/'}${src}`;
  }

  function detectMediaType(url) {
    const u = String(url || '').toLowerCase();
    if (u.includes('.m3u8') || u.includes('application/vnd.apple.mpegurl')) return 'application/x-mpegURL';
    return 'video/mp4';
  }

  function getActiveStreamUrl() {
    const video = currentVideo();
    if (!video) return '';
    const src = video.currentSrc || video.src || '';
    return absoluteMediaUrl(src);
  }

  function supportsAirPlay() {
    const video = currentVideo();
    return !!(video && (video.webkitShowPlaybackTargetPicker || window.WebKitPlaybackTargetAvailabilityEvent));
  }

  function updateCastButtons() {
    const castBtn = $('#player-cast');
    const airplayBtn = $('#player-airplay');
    if (castBtn) castBtn.classList.toggle('hidden', !castReady);
    if (airplayBtn) airplayBtn.classList.toggle('hidden', !supportsAirPlay());
  }

  function bindAirPlay() {
    const btn = $('#player-airplay');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const video = currentVideo();
      if (!video) return;
      if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
        video.webkitShowPlaybackTargetPicker();
        return;
      }
      if (typeof window.toast === 'function') toast('AirPlay no disponible en este dispositivo', true);
    });
  }

  function loadCastMedia(session) {
    const url = getActiveStreamUrl();
    if (!url || !window.chrome?.cast?.media) return;
    const video = currentVideo();
    const mediaInfo = new chrome.cast.media.MediaInfo(url, detectMediaType(url));
    mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;
    mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = $('#player-title')?.textContent || 'Vix TV';
    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    if (video && Number.isFinite(video.currentTime) && video.currentTime > 1) {
      request.currentTime = video.currentTime;
    }
    session.loadMedia(request,
      () => { if (video) video.pause(); },
      (err) => { if (typeof window.toast === 'function') toast('No se pudo enviar a Chromecast', true); console.warn(err); }
    );
  }

  function bindCastButton() {
    const btn = $('#player-cast');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      if (!window.chrome?.cast?.isAvailable) {
        if (typeof window.toast === 'function') toast('Chromecast no disponible', true);
        return;
      }
      const ctx = cast.framework.CastContext.getInstance();
      const state = ctx.getCastState();
      if (state === cast.framework.CastState.NO_DEVICES_AVAILABLE) {
        if (typeof window.toast === 'function') toast('No hay dispositivos Chromecast', true);
        return;
      }
      if (castSession) {
        loadCastMedia(castSession);
        return;
      }
      ctx.requestSession().then(
        (session) => {
          castSession = session;
          loadCastMedia(session);
        },
        () => {}
      );
    });
  }

  function initCastFramework() {
    if (!window.cast || !window.chrome?.cast?.isAvailable) return;
    const ctx = cast.framework.CastContext.getInstance();
    ctx.setOptions({
      receiverApplicationId: CAST_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });
    ctx.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      (ev) => {
        if (ev.sessionState === cast.framework.SessionState.SESSION_STARTED
          || ev.sessionState === cast.framework.SessionState.SESSION_RESUMED) {
          castSession = ctx.getCurrentSession();
        } else if (ev.sessionState === cast.framework.SessionState.SESSION_ENDED) {
          castSession = null;
        }
      }
    );
    castReady = true;
    updateCastButtons();
    bindCastButton();
  }

  window.__onGCastApiAvailable = function (isAvailable) {
    if (!isAvailable) return;
    if (window.cast?.framework) {
      initCastFramework();
    }
  };

  window.VixCast = {
    refreshButtons: updateCastButtons,
    supportsAirPlay,
    isCastReady: () => castReady
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindAirPlay();
    updateCastButtons();
    if (window.cast?.framework && window.chrome?.cast?.isAvailable) initCastFramework();
  });
})();
