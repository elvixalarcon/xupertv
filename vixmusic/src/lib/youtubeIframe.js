let loadPromise = null;

export function loadYouTubeIframeApi() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();

  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    const done = () => resolve();

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      done();
    };

    if (document.querySelector('script[src*="iframe_api"]')) {
      const poll = setInterval(() => {
        if (window.YT?.Player) {
          clearInterval(poll);
          done();
        }
      }, 100);
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    document.head.appendChild(tag);
  });

  return loadPromise;
}

export function createYouTubePlayer(elementId, opts = {}) {
  const { events, ...rest } = opts;
  return new window.YT.Player(elementId, {
    height: '1',
    width: '1',
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      enablejsapi: 1,
      fs: 0,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      iv_load_policy: 3,
    },
    events,
    ...rest,
  });
}
