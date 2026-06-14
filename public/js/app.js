const API = '/api';
const SESSION_KEY_STORAGE = 'vixtv_session_key';
const ACTIVITY_USER_KEY = 'vixtv_activity_user';

function decodeJwtUsername(authToken) {
  if (!authToken || authToken.length < 20) return '';
  try {
    const part = authToken.split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return String(json.username || '').trim();
  } catch {
    return '';
  }
}

function resetClientSessionKey() {
  try { sessionStorage.removeItem(SESSION_KEY_STORAGE); } catch { /* ignore */ }
  try { localStorage.removeItem(SESSION_KEY_STORAGE); } catch { /* ignore */ }
}

function onActivityUserChanged(nextUser) {
  const prev = localStorage.getItem(ACTIVITY_USER_KEY) || '';
  if (prev && nextUser && prev !== nextUser) {
    sendActivityOffline();
    resetClientSessionKey();
  }
  if (nextUser) localStorage.setItem(ACTIVITY_USER_KEY, nextUser);
}

function syncAuthTokenForActivity() {
  const fresh = readStoredToken();
  if (fresh) token = fresh;
  if (!token) return '';
  onActivityUserChanged(decodeJwtUsername(token));
  return decodeJwtUsername(token);
}

function getClientSessionKey() {
  let key = sessionStorage.getItem(SESSION_KEY_STORAGE);
  if (!key) key = localStorage.getItem(SESSION_KEY_STORAGE);
  if (!key) {
    key = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try { sessionStorage.setItem(SESSION_KEY_STORAGE, key); } catch { /* ignore */ }
    try { localStorage.setItem(SESSION_KEY_STORAGE, key); } catch { /* ignore */ }
  }
  return key;
}

function appendStreamSession(url) {
  if (!url) return url;
  const sid = encodeURIComponent(getClientSessionKey());
  return `${url}${url.includes('?') ? '&' : '?'}sid=${sid}`;
}

function readStoredToken() {
  const fromNativeBridge = () => {
    try {
      const bridgeToken = window.VixTvAndroid?.getAuthToken?.();
      if (bridgeToken && bridgeToken.length > 20) return bridgeToken;
    } catch {
      /* bridge no disponible */
    }
    return null;
  };
  if (/VixTV\//i.test(navigator.userAgent || '') || window.VIXTV_NATIVE) {
    const nativeToken = fromNativeBridge();
    if (nativeToken) {
      localStorage.setItem('vixtv_token', nativeToken);
      localStorage.removeItem('xupertv_token');
      return nativeToken;
    }
  }
  let t = localStorage.getItem('vixtv_token') || localStorage.getItem('xupertv_token');
  if (!t) t = fromNativeBridge();
  if (t) localStorage.setItem('vixtv_token', t);
  return t || null;
}

function persistAuthToken(value) {
  if (value) {
    localStorage.setItem('vixtv_token', value);
    localStorage.removeItem('xupertv_token');
    try {
      window.VixTvAndroid?.saveAuthToken?.(value);
    } catch {
      /* ignore */
    }
  } else {
    resetClientSessionKey();
    localStorage.removeItem(ACTIVITY_USER_KEY);
    localStorage.removeItem('vixtv_token');
    localStorage.removeItem('xupertv_token');
    try {
      window.VixTvAndroid?.clearAuthToken?.();
    } catch {
      /* ignore */
    }
  }
}

let token = readStoredToken();
let currentUser = null;
let currentProfile = null;
let userPermissions = { can_live: true, can_movies: true, can_series: true };
let hlsInstance = null;
let allChannels = [];
let currentGroup = 'all';

function isCapacitorIos() {
  try {
    if (window.Capacitor?.getPlatform?.() === 'ios') return true;
    if (window.Capacitor?.isNativePlatform?.() && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return true;
  } catch { /* ignore */ }
  return false;
}

function getVixPlatform() {
  if (window.VIXTV_NATIVE?.platform) return window.VIXTV_NATIVE.platform;
  if (isCapacitorIos()) return 'ios';
  const q = new URLSearchParams(location.search).get('vix_platform');
  if (q === 'tv' || q === 'mobile' || q === 'ios') return q;
  const ua = navigator.userAgent || '';
  if (/VixTV\/[^\s]+\s+tv\b/i.test(ua)) return 'tv';
  if (/VixTV\/[^\s]+\s+mobile\b/i.test(ua)) return 'mobile';
  if (/VixTV\/[^\s]+\s+ios\b/i.test(ua)) return 'ios';
  if (/Android TV|Google TV|AFT[A-Z0-9]|Bravia|SmartTV|Tizen.*TV|Web0S/i.test(ua)) return 'tv';
  return 'mobile';
}

function isVixNativeApp() {
  return !!(window.VIXTV_NATIVE || /VixTV\//i.test(navigator.userAgent) || isCapacitorIos());
}

function isTvMode() {
  return getVixPlatform() === 'tv';
}

function isMobileNativeApp() {
  return isVixNativeApp() && getVixPlatform() === 'mobile';
}

function isTvNativeApp() {
  return isVixNativeApp() && getVixPlatform() === 'tv';
}

const VIX_PLATFORM = getVixPlatform();
const VIX_NATIVE_APP = isVixNativeApp();
let vixTvFocusedEl = null;

function applyVixPlatformUi() {
  const platform = getVixPlatform();
  document.documentElement.classList.remove('vix-tv', 'vix-mobile', 'vix-ios');
  document.documentElement.classList.add(`vix-${platform}`);
  if (isVixNativeApp()) document.documentElement.classList.add('vix-native');
  if (isCapacitorIos()) {
    document.documentElement.classList.add('vix-capacitor');
    if (isAppleMobile() && Math.min(screen.width, screen.height) >= 768) {
      document.documentElement.classList.add('vix-ipad');
    }
    try { document.body.style.webkitOverflowScrolling = 'touch'; } catch { /* ignore */ }
    document.getElementById('vix-update-banner')?.remove();
  }
  if (platform === 'tv') {
    applyTvNavFocusables();
    trackTvFocus();
  }
  syncAccountPageLayout();
}

function syncAccountPageLayout() {
  const mobileAccount = isMobileNativeApp();
  document.documentElement.classList.toggle('vix-account-mobile', mobileAccount);
  const head = $('#account-mobile-head');
  const title = $('#page-mylist-title');
  const logoutBtn = $('#account-logout-btn');
  if (head) head.classList.toggle('is-visible', mobileAccount);
  if (title) title.classList.toggle('hidden', mobileAccount);
  if (logoutBtn) logoutBtn.classList.toggle('is-visible', mobileAccount);
  $$('.mylist-tab-default').forEach((t) => t.classList.toggle('hidden', mobileAccount));
  $$('.mylist-tab-account').forEach((t) => t.classList.toggle('hidden', !mobileAccount));
  $('#logout-btn')?.classList.toggle('hidden', mobileAccount);
  $('#switch-profile-btn')?.classList.toggle('hidden', mobileAccount);
  $('#account-btn')?.classList.toggle('hidden', mobileAccount);
  $('#account-web-actions')?.classList.toggle('is-visible', !mobileAccount);
  if (mobileAccount) updateAccountProfileHeader();
}

function updateAccountProfileHeader() {
  const nameEl = $('#account-profile-name');
  const userEl = $('#account-profile-user');
  const avatarEl = $('#account-avatar');
  if (!nameEl) return;
  const profileName = currentProfile?.name || currentUser?.username || 'Cuenta';
  nameEl.textContent = profileName;
  if (userEl) {
    const parts = [];
    if (currentUser?.username && currentProfile?.name) parts.push(`@${currentUser.username}`);
    if (currentProfile?.is_kids) parts.push('Perfil infantil');
    userEl.textContent = parts.join(' · ') || (currentUser?.username ? `@${currentUser.username}` : '');
  }
  if (avatarEl) {
    avatarEl.textContent = currentProfile?.is_kids ? '🧒' : '👤';
  }
}

async function applyNativeSession(authToken) {
  if (!authToken || authToken.length < 20) {
    dismissNativeSplashIfNeeded();
    return;
  }
  token = authToken;
  onActivityUserChanged(decodeJwtUsername(authToken));
  persistAuthToken(token);
  setLoginBusy(false);
  window.__vixBootAttempted = true;
  armNativeBootWatchdog();
  try {
    currentUser = await api('/auth/me');
    userPermissions = {
      can_live: currentUser.can_live,
      can_movies: currentUser.can_movies,
      can_series: currentUser.can_series
    };
    if (currentUser.needsProfileSetup) {
      showProfileSetup();
      notifyNativeBootComplete();
      return;
    }
    if (currentUser.needsProfilePick) {
      showProfilePicker(currentUser.profiles || []);
      notifyNativeBootComplete();
      return;
    }
    currentProfile = currentUser.profile || null;
    clearNativeBootWatchdog();
    await finishAppBoot();
  } catch (err) {
    clearNativeBootWatchdog();
    const bridgeToken = (() => {
      try { return window.VixTvAndroid?.getAuthToken?.() || ''; } catch { return ''; }
    })();
    if (bridgeToken && bridgeToken.length > 20 && bridgeToken !== authToken) {
      return applyNativeSession(bridgeToken);
    }
    token = null;
    window.__vixBootAttempted = false;
    if (isTvNativeApp()) {
      persistAuthToken(null);
      try {
        window.VixTvAndroid?.notifyNativeBootFailed?.(err?.message || 'No se pudo iniciar sesión');
      } catch { /* */ }
      return;
    }
    persistAuthToken(null);
    showScreen('login-screen');
    $('#login-error').textContent = (err?.message || 'No se pudo iniciar sesión') + '. Intenta de nuevo.';
    dismissNativeSplashIfNeeded();
    try {
      window.VixTvAndroid?.clearAuthToken?.();
    } catch { /* */ }
  } finally {
    if (!currentUser || $('#profile-screen')?.classList.contains('active')) {
      dismissNativeSplashIfNeeded();
    }
  }
}

function notifyNativeBootComplete() {
  try { window.VixTvAndroid?.notifyNativeBootComplete?.(); } catch { /* */ }
}

function dismissNativeSplashIfNeeded() {
  if (isMobileNativeApp()) notifyNativeBootComplete();
}
window.applyNativeSession = applyNativeSession;

function refreshVixNativeBridge() {
  const restored = readStoredToken();
  if (restored) token = restored;
  applyVixPlatformUi();
  updateNativeLoginHint();
  if (token && !currentUser && !window.__vixBootAttempted) {
    scheduleAppBoot();
  }
  if (isTvMode()) {
    initTvRemoteNav();
    requestAnimationFrame(() => focusTvScreenStart());
  }
  checkNativeAppUpdate();
}

function updateNativeLoginHint() {
  const hint = $('#login-server-hint');
  if (!hint || !isVixNativeApp()) return;
  const server = window.VIXTV_NATIVE?.server || location.origin;
  const display = (server || 'https://tv.vixred.com').replace(/\/$/, '');
  hint.textContent = `Servidor: ${display} · Menú o Ajustes para cambiar la URL`;
  hint.classList.remove('hidden');
}

function trackTvFocus() {
  if (window.__vixTvFocusTracked) return;
  window.__vixTvFocusTracked = true;
  document.addEventListener('focusin', (e) => {
    const ctrl = tvNavControl(e.target);
    if (ctrl) vixTvFocusedEl = ctrl;
    else if (e.target?.classList?.contains('tv-focusable')) vixTvFocusedEl = e.target;
  }, true);
}

function tvActiveControl() {
  const active = document.activeElement;
  const fromActive = tvNavControl(active);
  if (fromActive) {
    vixTvFocusedEl = fromActive;
    return fromActive;
  }
  if (active?.classList?.contains('tv-focusable') && active !== document.body) {
    vixTvFocusedEl = active;
    return active;
  }
  if (vixTvFocusedEl && document.contains(vixTvFocusedEl) && !vixTvFocusedEl.classList.contains('hidden')) {
    return vixTvFocusedEl;
  }
  return null;
}

function submitTvForm(form) {
  if (!form) return;
  if (typeof form.requestSubmit === 'function') {
    form.requestSubmit();
    return;
  }
  const btn = form.querySelector('button[type="submit"]');
  if (btn) {
    btn.click();
    return;
  }
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function focusTvElement(el) {
  if (!el) return false;
  document.querySelectorAll('.tv-has-focus').forEach((node) => node.classList.remove('tv-has-focus'));
  vixTvFocusedEl = el;
  el.classList.add('tv-has-focus');
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  if (isTvMode() && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    try {
      if (window.VixTvAndroid?.showKeyboard) window.VixTvAndroid.showKeyboard();
      else el.click();
    } catch {
      el.click();
    }
  }
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

function applyTvNavFocusables() {
  $$('.topnav .nav-btn, .topbar-right button, .topbar-right a.admin-panel-link').forEach((el) => {
    el.classList.add('tv-focusable');
    el.tabIndex = 0;
  });
  $$('#login-form input, #login-form button, #profile-setup-form input, #profile-setup-form button, #profile-setup-kids').forEach((el) => {
    el.classList.add('tv-focusable');
    el.tabIndex = 0;
  });
}

function getTvActiveScreen() {
  if ($('#login-screen')?.classList.contains('active')) return 'login';
  if ($('#profile-screen')?.classList.contains('active')) return 'profile';
  if ($('#app')?.classList.contains('active')) return 'app';
  return null;
}

function tvScreenFocusables(screen = getTvActiveScreen()) {
  if (screen === 'login') {
    return [
      $('#login-user'),
      $('#login-pass'),
      $('#login-submit-btn'),
      $('#vix-update-banner')?.querySelector('.vix-update-btn'),
      $('#vix-update-banner')?.querySelector('.vix-update-dismiss')
    ].filter((el) => el && !el.closest('.hidden'));
  }
  if (screen === 'profile') {
    const setup = $('#profile-setup-panel');
    if (setup && !setup.classList.contains('hidden')) {
      return [
        $('#profile-setup-name'),
        $('#profile-setup-kids'),
        $('#profile-setup-form')?.querySelector('button[type="submit"]')
      ].filter(Boolean);
    }
    return [...document.querySelectorAll('#profile-grid .profile-card')].filter((el) => el.offsetParent);
  }
  return null;
}

function focusTvScreenStart() {
  const screen = getTvActiveScreen();
  if (screen === 'app') return focusTvTopbarStart();
  const first = tvScreenFocusables(screen)?.[0];
  return first ? focusTvElement(first) : null;
}

function tryTvFormListNav(ctrl, key, e, items) {
  if (!items?.length) return false;
  let idx = items.indexOf(ctrl);
  if (idx < 0) idx = items.findIndex((el) => el === ctrl || el.contains?.(ctrl));
  if (idx < 0) return false;

  if (key === 'Enter') {
    e.preventDefault();
    if (ctrl.tagName === 'INPUT' && ctrl.type === 'checkbox') {
      ctrl.checked = !ctrl.checked;
      return true;
    }
    if (ctrl.id === 'login-submit-btn') {
      performLogin();
      return true;
    }
    if (ctrl.tagName === 'INPUT' && ctrl.type !== 'submit') {
      if (ctrl.id === 'login-pass') {
        performLogin();
        return true;
      }
      if (ctrl.id === 'profile-setup-name') {
        submitTvForm(ctrl.closest('form'));
        return true;
      }
      if (ctrl.id === 'login-user') {
        const pass = $('#login-pass');
        if (pass?.value?.trim()) performLogin();
        else {
          const next = items[idx + 1];
          if (next) focusTvElement(next);
        }
        return true;
      }
      const next = items[idx + 1];
      if (next) focusTvElement(next);
      return true;
    }
    ctrl.click?.();
    return true;
  }

  if (key === 'ArrowDown' || key === 'ArrowRight') {
    const next = items[idx + 1];
    if (next) {
      e.preventDefault();
      focusTvElement(next);
      return true;
    }
  }
  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    const prev = items[idx - 1];
    if (prev) {
      e.preventDefault();
      focusTvElement(prev);
      return true;
    }
  }
  return false;
}

function tvTopnavFocusables() {
  return [...document.querySelectorAll('#topnav .nav-btn')].filter((el) => {
    return !el.disabled && !el.classList.contains('hidden');
  });
}

function tvTopbarRightFocusables() {
  return [...document.querySelectorAll('.topbar-right button, .topbar-right a.admin-panel-link')].filter((el) => {
    return !el.disabled && !el.classList.contains('hidden');
  });
}

function tvTopbarFocusables() {
  return [...tvTopnavFocusables(), ...tvTopbarRightFocusables()];
}

function focusTvTopbarStart() {
  const first = tvTopnavFocusables()[0] || tvTopbarFocusables()[0];
  if (first) focusTvElement(first);
  return first;
}

function focusTvTopnavItem(el) {
  return focusTvElement(el);
}

function tvNavControl(el) {
  if (!el || el === document.body) return null;
  const nav = el.closest('#topnav .nav-btn:not(.hidden)');
  if (nav) return nav;
  const right = el.closest('.topbar-right button:not(.hidden), .topbar-right a.admin-panel-link:not(.hidden)');
  if (right) return right;
  if (el.classList?.contains('tv-focusable')) return el;
  return el.closest('.tv-focusable:not(.hidden)');
}

function tvFocusPool(root = document) {
  const activeScreen = document.querySelector('.screen.active');
  const nodes = root === document
    ? document.querySelectorAll('.tv-focusable:not([disabled]), #topnav .nav-btn:not(.hidden):not([disabled]), .topbar-right button:not(.hidden):not([disabled]), .topbar-right a.admin-panel-link:not(.hidden)')
    : root.querySelectorAll('.tv-focusable:not([disabled])');
  return [...nodes].filter((el) => {
    if (el.closest('.hidden')) return false;
    if (root === document && activeScreen && activeScreen.id !== 'app') {
      if (!activeScreen.contains(el) && !el.closest('#vix-update-banner')) return false;
    }
    if (el.closest('#topnav, .topbar-right')) return activeScreen?.id === 'app';
    if (!el.offsetParent) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

function focusFirstContentBelowTopbar() {
  const page = document.querySelector('.page.active');
  if (!page) return false;
  const candidates = [
    page.querySelector('.hero-actions .tv-focusable'),
    page.querySelector('.hero-dot.tv-focusable'),
    page.querySelector('.carousel .tv-focusable'),
    page.querySelector('.mylist-tab.tv-focusable'),
    page.querySelector('.grid .tv-focusable'),
    page.querySelector('.btn-back.tv-focusable'),
    ...page.querySelectorAll('.tv-focusable')
  ].filter((el) => el && !el.closest('.topbar'));
  const first = candidates.find(Boolean);
  if (!first) return false;
  return focusTvElement(first);
}

function focusContentBelowTopbar() {
  if (focusFirstContentBelowTopbar()) return true;
  const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
  if (!topbar) return false;
  const below = tvFocusPool().filter((el) => {
    if (el.closest('.topbar')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= topbar.bottom - 8;
  });
  if (!below.length) return false;
  below.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  return focusTvElement(below[0]);
}

function tryTvTopbarNav(ctrl, key, e) {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
  if (!ctrl?.closest('.topbar')) return false;

  const items = tvTopbarFocusables();
  const idx = items.indexOf(ctrl);
  if (idx < 0) return false;

  const delta = key === 'ArrowRight' ? 1 : -1;
  const next = items[idx + delta];
  e.preventDefault();
  e.stopPropagation();
  if (next) focusTvElement(next);
  return true;
}

function isIosSafariWeb() {
  return isAppleMobile() && !VIX_NATIVE_APP;
}

/** App iOS nativa (Capacitor): tráiler con <video> + stream del servidor (no iframe YouTube). */
function trailerUsesNativePlayer() {
  return isCapacitorIos() || (VIX_NATIVE_APP && isAppleMobile());
}

/** iPhone/iPad web: sin tráiler de fondo. App nativa iOS: sí con <video>. */
function heroBackgroundTrailerSupported() {
  if (trailerUsesNativePlayer()) return true;
  return !isAppleMobile();
}

function heroTrailerUsesAudio() {
  if (trailerUsesNativePlayer()) return true;
  if (isAppleMobile()) return false;
  return true;
}

const trailerPlayCache = new Map();

async function fetchTrailerPlayUrl(youtubeKey) {
  const id = normalizeYoutubeKey(youtubeKey);
  if (!id) throw new Error('Tráiler no disponible');
  const cached = trailerPlayCache.get(id);
  if (cached && cached.expires > Date.now()) return cached;
  const data = await api(`/trailers/youtube/${encodeURIComponent(id)}`);
  const entry = {
    id,
    playUrl: data.playUrl,
    mime: data.mime || 'video/mp4',
    title: data.title || 'Tráiler',
    expires: Date.now() + 40 * 60 * 1000
  };
  trailerPlayCache.set(id, entry);
  return entry;
}

function mountNativeTrailerVideo(container, playUrl, { muted = false, loop = false, controls = true, autoplay = true } = {}) {
  if (!container) return null;
  container.innerHTML = `<video
    class="trailer-native-video"
    playsinline
    webkit-playsinline
    x-webkit-airplay="allow"
    ${controls ? 'controls' : ''}
    ${muted ? 'muted' : ''}
    ${loop ? 'loop' : ''}
    ${autoplay ? 'autoplay' : ''}
    preload="auto"></video>`;
  const video = container.querySelector('video');
  if (!video) return null;
  video.src = playUrl;
  video.load();
  if (autoplay) video.play().catch(() => {});
  return video;
}

function youtubeEmbedHost() {
  return isIosSafariWeb() ? 'www.youtube.com' : 'www.youtube-nocookie.com';
}

function normalizeYoutubeKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const match = s.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?(?:[^&]*&)*v=))([A-Za-z0-9_-]{11})/i);
  return match ? match[1] : '';
}

function heroTrailerEmbedUrl(key, opts = {}) {
  const id = normalizeYoutubeKey(key);
  if (!id) return '';
  const withControls = opts.withControls === true;
  const background = opts.background === true;
  const withAudio = opts.withAudio === true;
  const iosWeb = isIosSafariWeb();
  const wantsAudio = heroTrailerUsesAudio() && !withControls && !background;
  let mute = 1;
  let vol = 0;
  if (withControls) {
    mute = iosWeb ? 1 : 0;
    vol = mute ? 0 : 50;
  } else if (background) {
    mute = 1;
    vol = 0;
  } else {
    mute = wantsAudio ? 0 : 1;
    vol = wantsAudio ? 50 : 0;
  }
  const controls = withControls ? 1 : 0;
  const origin = encodeURIComponent(location.origin);
  const loop = background ? `&loop=1&playlist=${id}` : '';
  const bgExtras = background ? '&disablekb=1&fs=0&enablejsapi=1' : '&enablejsapi=1';
  return `https://${youtubeEmbedHost()}/embed/${id}?autoplay=1&mute=${mute}&controls=${controls}&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3&start=0&origin=${origin}${vol ? `&volume=${vol}` : ''}${loop}${bgExtras}`;
}

function setHeroTrailerIframeAudio(iframe) {
  if (!iframe?.contentWindow) return;
  const send = (func, args = []) => {
    try {
      iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    } catch (_) {}
  };
  if (heroTrailerAudioOn) {
    send('unMute');
    send('setVolume', [50]);
  } else {
    send('mute');
  }
}

function scheduleHeroTrailerAudioSync(iframe) {
  if (!iframe || !heroTrailerAudioOn) return;
  const sync = () => setHeroTrailerIframeAudio(iframe);
  iframe.addEventListener('load', sync);
  setTimeout(sync, 350);
  setTimeout(sync, 900);
}

function bindTrailerModal() {
  if (window.__trailerModalBound) return;
  window.__trailerModalBound = true;
  $('#trailer-modal-close')?.addEventListener('click', closeTrailerModal);
  $('#trailer-modal-backdrop')?.addEventListener('click', closeTrailerModal);
}

async function openTrailerModal(youtubeKey) {
  if (!youtubeKey) return toast('Tráiler no disponible', true);
  bindTrailerModal();
  const modal = $('#trailer-modal');
  const player = $('#trailer-modal-player');
  if (!modal || !player) return;
  modal.classList.remove('hidden');

  if (trailerUsesNativePlayer()) {
    player.innerHTML = '<p class="trailer-ios-hint">Cargando tráiler…</p>';
    try {
      const info = await fetchTrailerPlayUrl(youtubeKey);
      player.innerHTML = '';
      mountNativeTrailerVideo(player, info.playUrl, { muted: false, loop: false, controls: true, autoplay: true });
    } catch (err) {
      player.innerHTML = '';
      toast(err.message || 'Tráiler no disponible', true);
      modal.classList.add('hidden');
    }
    return;
  }

  const apple = isAppleMobile();
  const embedUrl = heroTrailerEmbedUrl(youtubeKey, { withControls: true });
  const iosHint = apple
    ? '<p class="trailer-ios-hint">En iPhone/iPad el tráiler inicia en silencio. Toca ▶ en el reproductor y luego 🔊 para activar el sonido.</p>'
    : '';
  player.innerHTML = `${iosHint}<iframe
    src=""
    data-src="${escHtml(embedUrl)}"
    title="Tráiler"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen; web-share"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
    playsinline
    webkit-playsinline></iframe>`;
  const iframe = player.querySelector('iframe');
  if (iframe) {
    if (apple) {
      iframe.src = embedUrl;
    } else {
      requestAnimationFrame(() => {
        iframe.src = iframe.dataset.src || embedUrl;
      });
    }
  }
}

function closeTrailerModal() {
  $('#trailer-modal')?.classList.add('hidden');
  const player = $('#trailer-modal-player');
  if (player) player.innerHTML = '';
}

function bindDetailTrailerButton(scope = document) {
  scope.querySelectorAll('.btn-trailer[data-trailer]').forEach((btn) => {
    const key = btn.dataset.trailer;
    const open = () => openTrailerModal(key);
    btn.onclick = open;
    btn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    };
  });
}

const HERO_TRAILER_MS = 30000;
const HERO_STATIC_MS = 8000;
let heroTrailerAudioOn = false;

function shuffleArray(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function nextRandomHeroIndex() {
  if (heroSlides.length <= 1) return 0;
  let next = heroIndex;
  while (next === heroIndex) {
    next = Math.floor(Math.random() * heroSlides.length);
  }
  return next;
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

applyVixPlatformUi();
if (isMobileNativeApp()) {
  setTimeout(() => {
    if (!document.getElementById('app')?.classList.contains('active')) {
      dismissNativeSplashIfNeeded();
    }
  }, 4000);
}
if (isTvMode()) {
  initTvRemoteNav();
  requestAnimationFrame(() => focusTvScreenStart());
}

const externalApiCache = new Map();
const EXTERNAL_API_CACHE_MS = 3 * 60 * 1000;

function isExternalCatalogPath(path) {
  return /^\/catalog\/external\/(allcalidad|cinecalidad|cuevana)/.test(path);
}

async function apiCached(path, opts = {}, ttl = EXTERNAL_API_CACHE_MS) {
  if (opts.method && opts.method !== 'GET') return api(path, opts);
  if (!isExternalCatalogPath(path)) return api(path, opts);
  const hit = externalApiCache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await api(path, opts);
  externalApiCache.set(path, { at: Date.now(), data });
  return data;
}

function prefetchExternalCatalogs() {
  if (!canAccess('movies') && !canAccess('series')) return;
  const sources = ['allcalidad', 'cinecalidad'];
  for (const src of sources) {
    if (canAccess('movies')) {
      apiCached(`/catalog/external/${src}/browse?content_type=movie`).catch(() => {});
    }
    if (canAccess('series')) {
      apiCached(`/catalog/external/${src}/browse?content_type=series`).catch(() => {});
    }
  }
}

async function api(path, opts = {}) {
  const authToken = token;
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const timeoutMs = opts.timeoutMs ?? 25000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(API + path, { ...opts, headers, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('El servidor tardó demasiado — intenta de nuevo');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    if (authToken !== token) {
      throw new Error('Sesión expirada');
    }
    if (isTvMode() && isVixNativeApp() && window.VixTvAndroid?.getAuthToken) {
      try {
        const fresh = window.VixTvAndroid.getAuthToken();
        if (fresh && fresh.length > 20 && fresh !== token) {
          token = fresh;
          persistAuthToken(token);
          return api(path, opts);
        }
      } catch { /* */ }
    }
    const booting = window.__vixBootAttempted && !currentUser && $('#login-screen')?.classList.contains('active');
    if (booting) {
      token = null;
      persistAuthToken(null);
      window.__vixBootAttempted = false;
      throw new Error('Sesión expirada');
    }
    logout();
    throw new Error('Sesión expirada');
  }
  const raw = await res.text();
  const trimmed = raw.trim();
  if (trimmed.startsWith('<')) {
    throw new Error('El servidor no devolvió datos JSON — recarga la página o contacta soporte');
  }
  let data = {};
  if (trimmed) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error('Respuesta inválida del servidor');
    }
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Error');
    if (data.needs_pin) err.needs_pin = true;
    throw err;
  }
  return data;
}

function formatUploadBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function apiUpload(path, opts = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method || 'POST', API + path);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.addEventListener('progress', (e) => {
      if (!onProgress) return;
      if (e.lengthComputable) {
        onProgress({
          phase: 'upload',
          loaded: e.loaded,
          total: e.total,
          pct: Math.min(100, Math.round((e.loaded / e.total) * 100))
        });
      } else {
        onProgress({ phase: 'upload', loaded: e.loaded, total: 0, pct: -1 });
      }
    });

    xhr.upload.addEventListener('load', () => {
      onProgress?.({ phase: 'processing', pct: 100 });
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 401) {
        logout();
        reject(new Error('Sesión expirada'));
        return;
      }
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Error al subir'));
    });

    xhr.addEventListener('error', () => reject(new Error('Error de conexión al subir')));
    xhr.addEventListener('abort', () => reject(new Error('Subida cancelada')));
    xhr.send(opts.body);
  });
}

function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.borderColor = isError ? 'var(--red)' : 'var(--gold)';
  t.style.color = isError ? 'var(--red)' : 'var(--gold)';
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(`#${id}`).classList.add('active');
  if (isTvMode()) {
    requestAnimationFrame(() => focusTvScreenStart());
  }
}

let playerCloseTimer = null;
let vixInitialPageEnter = true;
let heroFirstPaint = true;

function showPage(name) {
  $$('.page').forEach(p => p.classList.remove('active', 'page-enter'));
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  $$('.mob-nav-btn').forEach(b => b.classList.remove('active'));
  $$('.ios-nav-btn').forEach(b => b.classList.remove('active'));
  const pageEl = $(`#page-${name}`);
  const mobileNative = isMobileNativeApp();
  const animateEnter = !mobileNative && !vixInitialPageEnter && !window.__vixSkipPageEnter;
  pageEl?.classList.add('active');
  if (animateEnter) {
    pageEl?.classList.add('page-enter');
    pageEl?.addEventListener('animationend', () => pageEl.classList.remove('page-enter'), { once: true });
  }
  if (!['movie-detail', 'series-detail'].includes(name)) {
    $(`.nav-btn[data-page="${name}"]`)?.classList.add('active');
    if (mobileNative) {
      syncMobileBottomNav(name);
    } else {
      $(`.mob-nav-btn[data-page="${name}"]`)?.classList.add('active');
    }
    $(`.ios-nav-btn[data-page="${name}"]`)?.classList.add('active');
  }
  const bottomNav = $('#mobile-bottom-nav');
  if (bottomNav) bottomNav.classList.toggle('hidden', name === 'admin');
  const smoothScroll = !mobileNative && !['movie-detail', 'series-detail'].includes(name) && animateEnter;
  window.scrollTo({ top: 0, behavior: smoothScroll ? 'smooth' : 'auto' });
  sendActivityHeartbeat();
}

const MOBILE_HOME_PAGES = new Set(['home', 'destacados', 'kids', 'anime', 'explorar', 'categories', 'movies', 'series', 'browse']);

function syncMobileBottomNav(page) {
  $$('.mob-nav-btn.mob-nav-core').forEach((b) => b.classList.remove('active'));
  if (page === 'live') {
    $('.mob-nav-btn.mob-nav-core[data-page="live"]')?.classList.add('active');
  } else if (page === 'mylist') {
    $('.mob-nav-btn.mob-nav-core[data-page="mylist"]')?.classList.add('active');
  } else if (MOBILE_HOME_PAGES.has(page)) {
    $('.mob-nav-btn.mob-nav-core[data-page="home"]')?.classList.add('active');
  }
}

const ROUTE_MAIN = new Set(['home', 'destacados', 'kids', 'anime', 'explorar', 'categories', 'mylist', 'movies', 'series', 'live', 'browse']);

const STOREFRONT_CONFIG = {
  destacados: { rowsId: 'destacados-rows', emptyId: 'destacados-empty' },
  kids: { rowsId: 'kids-rows', emptyId: 'kids-empty' },
  anime: { rowsId: 'anime-rows', emptyId: 'anime-empty' },
  explorar: { rowsId: 'explorar-rows', platformsId: 'explorar-platforms', emptyId: 'explorar-empty' },
  movies: { rowsId: 'movies-catalog-rows', emptyId: 'movies-empty' },
  series: { rowsId: 'series-catalog-rows', emptyId: 'series-empty' }
};

async function buildStorefrontFallback(slug) {
  let hero = [];
  let recent = [];
  let sections = [];
  let platforms = null;

  if (slug === 'movies' || slug === 'destacados') {
    const rows = await api('/catalog/movies');
    sections = sections.concat(genreRowsToSections(rows, 'movie'));
    hero = await api('/movies/hero').catch(() => []);
    recent = await api('/movies/recent').catch(() => []);
  }
  if (slug === 'series' || slug === 'destacados') {
    const rows = await api('/catalog/series');
    sections = sections.concat(genreRowsToSections(rows, 'series'));
    if (!hero.length) hero = await api('/series/hero').catch(() => []);
  }
  if (slug === 'kids' || slug === 'anime' || slug === 'explorar') {
    try {
      return await api(`/catalog/storefront/${encodeURIComponent(slug)}`);
    } catch {
      const mRows = await api('/catalog/movies');
      const sRows = await api('/catalog/series');
      sections = genreRowsToSections(mRows, 'movie').concat(genreRowsToSections(sRows, 'series'));
      hero = await api('/movies/hero').catch(() => []);
    }
  }
  return { slug, hero, recent, sections, platforms };
}

const HOME_SECTION_TITLES = {
  'for-you': 'Para ti',
  'top-picks': 'Recomendadas',
  trending: 'Tendencias',
  'new-releases': 'Recién añadido'
};

function buildRouteHash(page, meta = {}) {
  if (page === 'movie-detail' && meta.id != null) {
    const from = meta.from && meta.from !== 'movies' ? `?from=${encodeURIComponent(meta.from)}` : '';
    return `#/movie/${meta.id}${from}`;
  }
  if (page === 'series-detail' && meta.id != null) {
    const from = meta.from && meta.from !== 'series' ? `?from=${encodeURIComponent(meta.from)}` : '';
    return `#/series/${meta.id}${from}`;
  }
  if (page === 'browse') {
    const params = new URLSearchParams();
    if (meta.title) params.set('title', meta.title);
    if (meta.back && meta.back !== 'home') params.set('back', meta.back);
    if (meta.type && meta.type !== 'movie') params.set('type', meta.type);
    const qs = params.toString();
    if (meta.sectionId) {
      return `#/browse/${encodeURIComponent(meta.sectionId)}${qs ? `?${qs}` : ''}`;
    }
    if (meta.genre) {
      params.set('g', meta.genre);
      return `#/browse/genre?${params.toString()}`;
    }
    return '#/browse';
  }
  if (!page || page === 'home') return '#/';
  return `#/${page}`;
}

function parseRouteHash() {
  const raw = (location.hash || '#/').replace(/^#/, '') || '/';
  const qIdx = raw.indexOf('?');
  const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const params = new URLSearchParams(qIdx >= 0 ? raw.slice(qIdx + 1) : '');
  const parts = pathPart.split('/').filter(Boolean);

  if (!parts.length || parts[0] === 'home') return { page: 'home' };
  if (parts[0] === 'movie' && parts[1]) {
    return { page: 'movie-detail', id: parts[1], from: params.get('from') || 'movies' };
  }
  if (parts[0] === 'series' && parts[1] && /^\d+$/.test(parts[1])) {
    return { page: 'series-detail', id: parts[1], from: params.get('from') || 'series' };
  }
  if (parts[0] === 'browse') {
    if (parts[1] === 'genre') {
      const genre = params.get('g') || '';
      return {
        page: 'browse',
        genre,
        type: params.get('type') || 'movie',
        title: params.get('title') || genre,
        back: params.get('back') || 'categories'
      };
    }
    if (parts[1]) {
      const sectionId = decodeURIComponent(parts[1]);
      return {
        page: 'browse',
        sectionId,
        type: params.get('type') || 'mixed',
        title: params.get('title') || HOME_SECTION_TITLES[sectionId] || sectionId,
        back: params.get('back') || 'home'
      };
    }
    return { page: 'browse' };
  }
  if (ROUTE_MAIN.has(parts[0])) return { page: parts[0] };
  return { page: 'home' };
}

function syncAppRoute(page, meta = {}, { replace = false } = {}) {
  const hash = buildRouteHash(page, meta);
  const state = { page, ...meta, vix: 1 };
  if (replace) {
    if (location.hash !== hash) history.replaceState(state, '', hash);
    return;
  }
  if (location.hash === hash) return;
  history.pushState(state, '', hash);
}

function isPlayerOpen() {
  const modal = $('#player-modal');
  return !!(modal && !modal.classList.contains('hidden'));
}

function isMovieDetailOpen() {
  return $('#page-movie-detail')?.classList.contains('active');
}

function isSeriesDetailOpen() {
  return $('#page-series-detail')?.classList.contains('active');
}

function handleAppBack() {
  if ($('#login-screen')?.classList.contains('active')) return false;
  if (!$('#trailer-modal')?.classList.contains('hidden')) {
    closeTrailerModal();
    return true;
  }
  if (!$('#password-modal')?.classList.contains('hidden')) {
    closePasswordModal();
    return true;
  }
  if (isPlayerOpen()) {
    closePlayer();
    return true;
  }
  if (isMovieDetailOpen()) {
    if (history.state?.page === 'movie-detail' && history.length > 1) {
      history.back();
    } else {
      navigateToPage(movieDetailBackPage, { replaceRoute: true });
    }
    return true;
  }
  if (isSeriesDetailOpen()) {
    if (history.state?.page === 'series-detail' && history.length > 1) {
      history.back();
    } else {
      navigateToPage(seriesDetailBackPage, { replaceRoute: true });
    }
    return true;
  }
  if ($('#page-browse')?.classList.contains('active')) {
    closeBrowsePage();
    return true;
  }
  return false;
}

window.handleAppBack = handleAppBack;

function bindAppBackNavigation() {
  if (window.__vixBackBound) return;
  window.__vixBackBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && handleAppBack()) e.preventDefault();
  });
  window.addEventListener('popstate', () => {
    if (!$('#app')?.classList.contains('active')) return;
    restoreRouteFromHash().catch(() => navigateToPage(defaultPageForUser(), { replaceRoute: true }));
  });
}

function canAccess(area) {
  if (currentUser?.role === 'admin') return true;
  if (area === 'movies') return !!userPermissions.can_movies;
  if (area === 'series') return !!userPermissions.can_series;
  if (area === 'live') return !!userPermissions.can_live;
  return true;
}

function defaultPageForUser() {
  if (canAccess('movies')) return 'home';
  if (canAccess('series')) return 'series';
  if (canAccess('live')) return 'live';
  return 'mylist';
}

function applyNavPermissions() {
  const map = { movies: 'movies', series: 'series', live: 'live' };
  const mixedPages = new Set(['destacados', 'kids', 'anime', 'explorar', 'home']);
  $$('.nav-btn, .mob-nav-btn, .ios-nav-btn').forEach((btn) => {
    const page = btn.dataset.page;
    if (mixedPages.has(page)) {
      const show = canAccess('movies') || canAccess('series');
      btn.classList.toggle('hidden', !show);
      return;
    }
    const area = map[page];
    if (!area) return;
    const show = canAccess(area);
    btn.classList.toggle('hidden', !show);
  });
  const adminLink = $('#admin-panel-link');
  if (adminLink) adminLink.classList.toggle('hidden', currentUser?.role !== 'admin');
  const sw = $('#switch-profile-btn');
  if (sw) sw.classList.toggle('hidden', !currentProfile);
  const showCategories = canAccess('movies') || canAccess('series');
  $('#nav-categories')?.classList.toggle('hidden', !showCategories);
  $('#mob-nav-categories')?.classList.toggle('hidden', !showCategories);
  $('#ios-nav-categories')?.classList.toggle('hidden', !showCategories);
  if (VIX_PLATFORM === 'tv') applyTvNavFocusables();
}

async function navigateToPage(page, { replaceRoute = false } = {}) {
  if (page === 'movies' && !canAccess('movies')) {
    toast('No tienes acceso a películas', true);
    return;
  }
  if (page === 'series' && !canAccess('series')) {
    toast('No tienes acceso a series', true);
    return;
  }
  if (['destacados', 'kids', 'anime', 'explorar'].includes(page) && !canAccess('movies') && !canAccess('series')) {
    toast('No tienes acceso al catálogo', true);
    return;
  }
  if (page === 'live' && !canAccess('live')) {
    toast('No tienes acceso a TV en vivo', true);
    return;
  }
  if (page === 'home' && !canAccess('movies')) {
    page = defaultPageForUser();
  }
  if (page !== 'live') {
    exitLiveHeroFullscreen();
    stopLivePreview();
  }
  if (page !== 'home') stopHeroSlider();
  showPage(page);
  syncAppRoute(page, {}, { replace: replaceRoute });
  if (page === 'home') {
    activeBrowse = null;
    loadHome();
  }
  if (page === 'categories') loadCategories();
  if (page === 'mylist') {
    syncAccountPageLayout();
    const title = $('#page-mylist-title') || $('#page-mylist .page-title');
    if (title && !isMobileNativeApp()) title.textContent = 'Mi lista';
    if (isMobileNativeApp()) showMyListTab($('.mylist-tab-account.active')?.dataset.tab || 'likes-account');
    loadMyListPage();
  }
  if (page === 'destacados') loadStorefront('destacados');
  if (page === 'kids') loadStorefront('kids');
  if (page === 'anime') loadStorefront('anime');
  if (page === 'explorar') loadStorefront('explorar');
  if (page === 'movies') loadStorefront('movies');
  if (page === 'series') loadStorefront('series');
  if (page === 'live') loadLive();
  if (page === 'browse') loadBrowsePage();
}

async function restoreRouteFromHash() {
  const route = parseRouteHash();

  if (route.page === 'movie-detail' && route.id) {
    await showMovieDetail(route.id, route.from || 'movies', { replaceRoute: true });
    return;
  }
  if (route.page === 'series-detail' && route.id) {
    await showSeriesDetail(route.id, route.from || 'series', { replaceRoute: true });
    return;
  }
  if (route.page === 'browse' && (route.sectionId || route.genre)) {
    activeBrowse = {
      sectionId: route.sectionId || null,
      genre: route.genre || null,
      title: route.title || route.sectionId || route.genre || 'Sección',
      type: route.type || 'movie',
      backPage: route.back || 'home'
    };
    showPage('browse');
    syncAppRoute('browse', {
      sectionId: activeBrowse.sectionId,
      genre: activeBrowse.genre,
      type: activeBrowse.type,
      title: activeBrowse.title,
      back: activeBrowse.backPage
    }, { replace: true });
    await loadBrowsePage();
    return;
  }

  const page = ROUTE_MAIN.has(route.page) ? route.page : defaultPageForUser();
  await navigateToPage(page === 'home' ? defaultPageForUser() : page, { replaceRoute: true });
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str).replace(/'/g, '&#39;');
}

function videoFormatLabel(path) {
  if (!path) return '';
  const m = path.split('?')[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toUpperCase() : 'VIDEO';
}

function activateFocusable(el) {
  if (!el) return;
  el.focus?.();
  el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

function posterUrl(path, item) {
  if (path) return path;
  if (item?.title) {
    const params = new URLSearchParams({ title: item.title, year: String(item.year || '') });
    return `/api/posters/cover?${params}`;
  }
  return '';
}

function watchProgressPercent(wh) {
  if (!wh) return 0;
  if (wh.percent > 0) return wh.percent;
  if (wh.duration > 0) return Math.min(100, (wh.progress / wh.duration) * 100);
  if (wh.progress >= 30) return Math.min(15, Math.max(4, wh.progress / 60));
  return 0;
}

function cardHtml(item, type = 'movie') {
  if (item?.external) return externalCardHtml(item);
  cacheVodItem(item, type);
  const src = posterUrl(item.poster, item);
  const img = src
    ? `<img src="${src}" alt="${item.title || item.name}" loading="lazy" onerror="this.onerror=null;this.src='/api/posters/cover?title=${encodeURIComponent(item.title||item.name||'Vix')}&year=${item.year||''}'">`
    : `<div class="no-img">${type === 'live' ? '📺' : '🎬'}</div>`;
  const title = escHtml(item.title || item.name);
  let wh = null;
  let sub = '';
  if (type === 'movie') {
    wh = watchProgressMap[`movie-${item.id}`];
    sub = item.rating ? `⭐ ${item.rating}/10` : (item.genre || item.group_title || item.year || '');
  } else if (type === 'series') {
    wh = watchProgressMap[`series-${item.id}`];
    sub = wh
      ? `Continuar · ${Math.round(watchProgressPercent(wh))}%`
      : (item.rating ? `⭐ ${item.rating}/10` : (item.genre || item.year || ''));
  } else {
    sub = item.rating ? `⭐ ${item.rating}/10` : (item.genre || item.group_title || item.year || '');
  }
  const pct = watchProgressPercent(wh);
  const media = pct >= 2
    ? `<div class="card-media">${img}<div class="card-progress"><span style="width:${pct}%"></span></div></div>`
    : img;
  const actions = (type === 'movie' || type === 'series') ? cardQuickActions(type, item.id) : '';
  return `<div class="card tv-focusable" role="button" tabindex="0" data-id="${item.id}" data-type="${type}" aria-label="${title}">
    ${actions}
    ${media}
    <div class="card-info"><h4>${title}</h4><p>${escHtml(sub)}</p></div>
  </div>`;
}

function externalCardKey(item) {
  return `external:${item.source}:${item.slug}`;
}

function isExternalCard(card) {
  return card?.dataset?.external === '1';
}

function externalCardHtml(item) {
  const displayTitle = formatDisplayTitle(item.title || slugToDisplayTitle(item.slug) || '');
  const src = posterUrl(item.poster, { ...item, title: displayTitle });
  const type = item.content_type === 'series' ? 'series' : 'movie';
  const img = src
    ? `<img src="${src}" alt="${displayTitle}" loading="lazy" onerror="this.onerror=null;this.src='/api/posters/cover?title=${encodeURIComponent(displayTitle || 'Vix')}&year=${item.year || ''}'">`
    : `<div class="no-img">${type === 'series' ? '📺' : '🎬'}</div>`;
  const title = escHtml(displayTitle || (type === 'series' ? 'Serie' : 'Película'));
  const sub = item.year ? String(item.year) : (item.source || '');
  const cacheKey = externalCardKey(item);
  vodItemCache.set(cacheKey, { ...item, _type: type, _external: true });
  return `<div class="card tv-focusable card-external" role="button" tabindex="0"
    data-external="1" data-source="${escAttr(item.source)}" data-slug="${escAttr(item.slug)}"
    data-year="${item.year || ''}" data-type="${type}" data-id="${escAttr(cacheKey)}" aria-label="${title}">
    ${img}
    <div class="card-info"><h4>${title}</h4><p>${escHtml(sub)}</p></div>
  </div>`;
}

let continueWatchingCache = {};
const vodItemCache = new Map();
let watchProgressMap = {};
let userLibrary = { watchlist: new Set(), likes: new Set() };

function cacheVodItem(item, type = 'movie') {
  if (!item?.id) return;
  vodItemCache.set(`${type}-${item.id}`, { ...item, _type: type });
}

function getVodCache(type, id) {
  return vodItemCache.get(`${type}-${id}`) || null;
}

function detailContentEnter(el) {
  if (!el) return;
  el.classList.remove('detail-content-enter');
  void el.offsetWidth;
  el.classList.add('detail-content-enter');
  el.addEventListener('animationend', () => el.classList.remove('detail-content-enter'), { once: true });
}

function libKey(type, id) {
  return `${type}-${id}`;
}

function externalContentKey(type, data) {
  return `external-${type}-${data.source}-${data.slug}`;
}

function externalProgressCacheKey(source, slug, season, episode) {
  return `${source}:${slug}:ext-${season}x${episode}`;
}

async function loadUserLibrary() {
  try {
    const data = await api('/library');
    userLibrary.watchlist = new Set(data.watchlist || []);
    userLibrary.likes = new Set(data.likes || []);
  } catch {
    userLibrary = { watchlist: new Set(), likes: new Set() };
  }
}

function isInWatchlist(type, id, opts = {}) {
  if (opts.external) return userLibrary.watchlist.has(externalContentKey(type, opts));
  return userLibrary.watchlist.has(libKey(type, id));
}

function isLiked(type, id, opts = {}) {
  if (opts.external) return userLibrary.likes.has(externalContentKey(type, opts));
  return userLibrary.likes.has(libKey(type, id));
}

function cardQuickActions(type, id) {
  const inList = isInWatchlist(type, id);
  const liked = isLiked(type, id);
  return `<div class="card-actions">
    <button type="button" class="card-action-btn library-action-btn${inList ? ' active' : ''}"
      data-action="watchlist" data-type="${type}" data-id="${id}" aria-label="Mi lista">${inList ? '✓' : '+'}</button>
    <button type="button" class="card-action-btn library-action-btn${liked ? ' active' : ''}"
      data-action="like" data-type="${type}" data-id="${id}" aria-label="Me gusta">👍</button>
  </div>`;
}

function detailActionsHtml(contentType, contentId, playBtnHtml, trailerKey = '', opts = {}) {
  const { external = false, source = '', slug = '' } = opts;
  const libOpts = external ? { external: true, source, slug } : {};
  const inList = isInWatchlist(contentType, contentId, libOpts);
  const liked = isLiked(contentType, contentId, libOpts);
  const libId = external ? externalContentKey(contentType, { source, slug }) : contentId;
  const trailerBtn = trailerKey
    ? `<button type="button" class="btn-secondary btn-trailer tv-focusable" data-trailer="${escHtml(trailerKey)}" tabindex="0">▶ Tráiler</button>`
    : '';
  return `<div class="detail-actions">
    ${playBtnHtml}
    ${trailerBtn}
    <button type="button" class="btn-circle library-action-btn${inList ? ' active' : ''}"
      data-action="watchlist" data-type="${contentType}" data-id="${escAttr(String(libId))}" data-external="${external ? '1' : '0'}"
      data-source="${escAttr(source)}" data-slug="${escAttr(slug)}"
      title="${inList ? 'En Mi lista' : 'Añadir a Mi lista'}" aria-pressed="${inList}" tabindex="0">
      <span class="btn-circle-icon">${inList ? '✓' : '+'}</span>
    </button>
    <button type="button" class="btn-circle library-action-btn${liked ? ' active' : ''}"
      data-action="like" data-type="${contentType}" data-id="${escAttr(String(libId))}" data-external="${external ? '1' : '0'}"
      data-source="${escAttr(source)}" data-slug="${escAttr(slug)}"
      title="${liked ? 'Te gusta' : 'Me gusta'}" aria-pressed="${liked}" tabindex="0">
      <span class="btn-circle-icon">👍</span>
    </button>
  </div>`;
}

function syncLibraryButtons(type, id, opts = {}) {
  const key = opts.external || String(id).startsWith('external-') ? id : libKey(type, id);
  document.querySelectorAll(`.library-action-btn[data-type="${type}"][data-id="${id}"]`).forEach((btn) => {
    const isList = btn.dataset.action === 'watchlist';
    const active = isList ? userLibrary.watchlist.has(key) : userLibrary.likes.has(key);
    btn.classList.toggle('active', active);
    if (btn.classList.contains('card-action-btn')) {
      btn.textContent = isList ? (active ? '✓' : '+') : '👍';
    } else if (btn.classList.contains('btn-circle') && isList) {
      btn.querySelector('.btn-circle-icon').textContent = active ? '✓' : '+';
    }
    btn.setAttribute('aria-pressed', active);
  });
}

async function toggleLibrary(contentType, contentId, listType, opts = {}) {
  let data;
  if (opts.external) {
    data = await api('/library/external/toggle', {
      method: 'POST',
      body: JSON.stringify({
        content_type: contentType,
        source: opts.source,
        slug: opts.slug,
        list_type: listType,
        title: opts.title || '',
        poster: opts.poster || '',
        year: opts.year || null
      })
    });
    const key = data.key || externalContentKey(contentType, opts);
    const set = listType === 'watchlist' ? userLibrary.watchlist : userLibrary.likes;
    if (data.active) set.add(key);
    else set.delete(key);
    syncLibraryButtons(contentType, key, { external: true });
  } else {
    data = await api('/library/toggle', {
      method: 'POST',
      body: JSON.stringify({
        content_type: contentType,
        content_id: contentId,
        list_type: listType
      })
    });
    const key = libKey(contentType, contentId);
    const set = listType === 'watchlist' ? userLibrary.watchlist : userLibrary.likes;
    if (data.active) set.add(key);
    else set.delete(key);
    syncLibraryButtons(contentType, contentId);
  }
  const msg = listType === 'watchlist'
    ? (data.active ? 'Añadido a Mi lista' : 'Eliminado de Mi lista')
    : (data.active ? 'Marcado como Me gusta' : 'Eliminado de Me gusta');
  toast(msg);
  if ($('#page-mylist')?.classList.contains('active')) loadMyListPage();
  return data.active;
}

async function loadMyListPage() {
  syncAccountPageLayout();
  await loadUserLibrary();
  const emptyList = '<p class="mylist-empty">No hay títulos aquí todavía. Explora películas y series y pulsa + o 👍.</p>';
  const emptyFav = '<p class="mylist-empty">Sin favoritos. Marca 👍 en una película o serie.</p>';
  const emptyContinue = '<p class="mylist-empty">Nada pendiente. Retoma desde Inicio cuando empieces algo.</p>';
  const emptyHistory = '<p class="mylist-empty">Sin historial todavía.</p>';

  if (isMobileNativeApp()) {
    const [likes, cont, hist] = await Promise.all([
      api('/library/likes'),
      api('/watch/continue').catch(() => []),
      api('/watch/history').catch(() => [])
    ]);
    $('#mylist-likes').innerHTML = likes.length
      ? likes.map((item) => cardHtml(item, item.type)).join('')
      : emptyFav;
    $('#mylist-continue').innerHTML = cont.length
      ? cont.map(continueCardHtml).join('')
      : emptyContinue;
    $('#mylist-history').innerHTML = hist.length
      ? hist.map(historyCardHtml).join('')
      : emptyHistory;
    bindCardClicks('#mylist-likes');
    bindCardClicks('#mylist-continue');
    bindCardClicks('#mylist-history');
    const activeTab = $('.mylist-tab-account.active')?.dataset.tab || 'likes-account';
    showMyListTab(activeTab);
    return;
  }

  const [watchlist, likes] = await Promise.all([
    api('/library/watchlist'),
    api('/library/likes')
  ]);
  $('#mylist-watchlist').innerHTML = watchlist.length
    ? watchlist.map((item) => cardHtml(item, item.type)).join('')
    : emptyList;
  $('#mylist-likes').innerHTML = likes.length
    ? likes.map((item) => cardHtml(item, item.type)).join('')
    : emptyList;
  bindCardClicks('#mylist-watchlist');
  bindCardClicks('#mylist-likes');
}

function showMyListTab(name) {
  const tabName = name === 'likes-account' ? 'likes-account' : name;
  $$('.mylist-tab').forEach((t) => {
    const match = t.dataset.tab === tabName
      || (tabName === 'likes' && t.dataset.tab === 'likes')
      || (tabName === 'likes-account' && t.dataset.tab === 'likes-account');
    t.classList.toggle('active', match);
  });
  const showLikes = tabName === 'likes' || tabName === 'likes-account';
  $('#mylist-watchlist')?.classList.toggle('hidden', tabName !== 'watchlist');
  $('#mylist-likes')?.classList.toggle('hidden', !showLikes);
  $('#mylist-continue')?.classList.toggle('hidden', tabName !== 'continue');
  $('#mylist-history')?.classList.toggle('hidden', tabName !== 'history');
}

function historyCardHtml(item) {
  const pct = item.duration > 0 ? Math.min(100, (item.progress / item.duration) * 100) : (item.percent || 0);
  const src = posterUrl(item.poster, item);
  const img = src
    ? `<img src="${src}" alt="${item.title || item.series_title}" loading="lazy" onerror="this.onerror=null;this.src='/api/posters/cover?title=${encodeURIComponent(item.title||item.series_title||'Vix')}&year=${item.year||''}'">`
    : `<div class="no-img">🎬</div>`;
  const title = item.content_type === 'episode'
    ? escHtml(item.series_title)
    : escHtml(item.title);
  const sub = escHtml(item.progress_label || `${Math.round(pct)}% visto`);
  return `<div class="card card-continue tv-focusable" role="button" tabindex="0"
    data-resume="1" data-type="${item.content_type}" data-id="${item.content_id}"
    aria-label="Ver ${title}">
    <div class="card-media">
      ${img}
      <div class="card-progress"><span style="width:${pct}%"></span></div>
    </div>
    <div class="card-info"><h4>${title}</h4><p>${sub}</p></div>
  </div>`;
}

function bindMyListTabs() {
  if ($('#page-mylist')?.dataset.tabsBound) return;
  $('#page-mylist').dataset.tabsBound = '1';
  $$('.mylist-tab').forEach((tab) => {
    tab.addEventListener('click', () => showMyListTab(tab.dataset.tab));
  });
  if (isMobileNativeApp()) showMyListTab('likes-account');
}

function bindAccountMobileActions() {
  if (window.__accountMobileBound) return;
  window.__accountMobileBound = true;
  $('#account-switch-profile')?.addEventListener('click', async () => {
    try {
      const profiles = await api('/profiles');
      showProfilePicker(profiles, { fromSwitch: true });
    } catch (e) {
      toast(e.message, true);
    }
  });
  $('#account-logout-btn')?.addEventListener('click', logout);
  $('#account-change-password')?.addEventListener('click', openPasswordModal);
  $('#account-change-password-web')?.addEventListener('click', openPasswordModal);
}

function continueCardHtml(item) {
  const pct = item.percent || (item.duration > 0 ? Math.min(100, (item.progress / item.duration) * 100) : 0);
  const posterTitle = item.series_title || item.title;
  const src = posterUrl(item.poster, { ...item, title: posterTitle });
  const img = src
    ? `<img src="${src}" alt="${posterTitle}" loading="lazy" onerror="this.onerror=null;this.src='/api/posters/cover?title=${encodeURIComponent(posterTitle || 'Vix')}&year=${item.year || ''}'">`
    : `<div class="no-img">🎬</div>`;
  const isExtEp = item.content_type === 'external_episode';
  const isExtMovie = item.content_type === 'external_movie';
  const title = isExtEp
    ? escHtml(item.series_title || item.title)
    : escHtml(item.title);
  const sub = isExtEp
    ? `T${item.season} · E${item.episode} · ${Math.round(pct)}%`
    : isExtMovie
      ? `${Math.round(pct)}% visto`
      : (item.content_type === 'episode'
        ? `T${item.season} · E${item.episode} · ${Math.round(pct)}%`
        : `${Math.round(pct)}% visto`);
  continueWatchingCache[`${item.content_type}-${item.content_id}`] = item;
  const extAttrs = item.external
    ? ` data-external="1" data-source="${escAttr(item.source)}" data-slug="${escAttr(item.slug)}" data-season="${item.season || ''}" data-episode="${item.episode || ''}"`
    : '';
  return `<div class="card card-continue tv-focusable" role="button" tabindex="0"
    data-resume="1" data-type="${item.content_type}" data-id="${escAttr(String(item.content_id))}"${extAttrs}
    aria-label="Continuar ${title}">
    <div class="card-media">
      ${img}
      <div class="card-progress"><span style="width:${pct}%"></span></div>
    </div>
    <div class="card-info"><h4>${title}</h4><p>${escHtml(sub)}</p></div>
  </div>`;
}

function liveCardHtml(ch) {
  const logo = ch.logo
    ? `<img src="${ch.logo}" alt="${ch.name}" loading="lazy" onerror="this.outerHTML='<div class=\\'ch-logo-placeholder\\'>📺</div>'">`
    : `<div class="ch-logo-placeholder">📺</div>`;
  const safeName = ch.name.replace(/"/g, '&quot;');
  return `<div class="live-card" data-id="${ch.id}" data-url="${encodeURIComponent(ch.stream_url)}" data-name="${safeName}" data-logo="${encodeURIComponent(ch.logo || '')}">
    ${logo}<h4>${ch.name}</h4>
  </div>`;
}

let livePreviewHls = null;
let livePreviewWatchdog = null;
let livePlayerWatchdog = null;
let liveHlsOwner = null;
let selectedLiveChannelId = null;
let liveClockTimer = null;
let liveEpgTimer = null;
let liveEpgFetchPromise = null;
let liveCategoriesList = [];
let liveEpgMap = {};
let liveEpgMeta = { source: 'none' };
let liveInitialChannelPicked = false;
let livePreviewMuted = false;
let livePreviewScheduleTimer = null;
let livePreviewGen = 0;
let livePreviewRecoverCount = 0;
let livePreviewGraceUntil = 0;
let liveAudioControlsBound = false;
let liveHeroHoverBound = false;
let liveHeroPanelHideTimer = null;
const LIVE_PANEL_HIDE_MS = 3000;

const nativeLiveCleanups = new WeakMap();

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function prefersNativeHls(video) {
  return !!(video?.canPlayType('application/vnd.apple.mpegurl'))
    && (typeof Hls === 'undefined' || !Hls.isSupported());
}

function absoluteMediaUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, location.origin).href;
  } catch {
    return url;
  }
}

function reloadNativeLiveVideo(video, url, { hard = false } = {}) {
  if (!video || !url) return Promise.resolve();
  if (!hard && !video.ended && video.readyState >= 2) {
    return video.play().catch(() => reloadNativeLiveVideo(video, url, { hard: true }));
  }
  const abs = absoluteMediaUrl(url);
  const bust = `${abs}${abs.includes('?') ? '&' : '?'}_ios=${Date.now()}`;
  video.src = bust;
  video.load();
  return video.play().catch(() => {});
}

function clearNativeLiveHandlers(video) {
  const cleanup = nativeLiveCleanups.get(video);
  if (cleanup) {
    cleanup();
    nativeLiveCleanups.delete(video);
  }
}

function syncLivePreviewAudio(video) {
  if (!video) return;
  const vol = Math.max(0, Math.min(1, Number($('#live-preview-volume')?.value || 100) / 100));
  video.volume = vol;
  video.muted = livePreviewMuted;
  syncLiveMuteUi(video, $('#live-preview-mute'), livePreviewMuted);
}

function enableLiveAudio() {
  livePreviewMuted = false;
  syncLivePreviewAudio($('#live-preview-video'));
  const player = $('#video-player');
  if (player && playerLiveMode) {
    player.muted = false;
    player.volume = Math.max(0.6, Number($('#player-volume')?.value || 100) / 100);
    const pm = $('#player-mute');
    if (pm) {
      pm.textContent = '🔊';
      pm.classList.remove('is-muted');
    }
  }
}

function attachNativeLiveHandlers(video, getUrl) {
  clearNativeLiveHandlers(video);
  if (!video || !isAppleMobile() || typeof getUrl !== 'function') return;

  let errorTimer = null;
  let reloadCount = 0;

  const hardReload = () => {
    if (reloadCount >= 2) return;
    reloadCount += 1;
    reloadNativeLiveVideo(video, getUrl(), { hard: true });
  };

  const onError = () => {
    clearTimeout(errorTimer);
    errorTimer = setTimeout(hardReload, 5000);
  };

  video.addEventListener('error', onError);

  nativeLiveCleanups.set(video, () => {
    clearTimeout(errorTimer);
    video.removeEventListener('error', onError);
  });
}

function playNativeLiveVideo(video, url) {
  if (!video || !url) return Promise.resolve();
  syncLivePreviewAudio(video);
  attachNativeLiveHandlers(video, () => url);
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.src = absoluteMediaUrl(url);
  video.load();
  return video.play().then(() => syncLivePreviewAudio(video)).catch(() => {});
}

const LIVE_ANIME_RE = /anim[eé]|gaming|pok[eé]mon|naruto|one\s*piece|yu-?gi|hunter\s*x|inuyasha|jojo|boruto|tokusato|avatar:\s*la\s*leyenda/i;
const LIVE_MOVIE_RE = /pel[ií]cula|cine\s|estelar|acci[oó]n|terror|drama|romance|suspenso|nuestro\s*cine|de\s*pel[ií]cula|golden|hollywood/i;

function formatLiveClock(date = new Date()) {
  return date.toLocaleTimeString('es-EC', { hour: 'numeric', minute: '2-digit' });
}

function formatLiveSlotRange(start, end) {
  const opts = { hour: 'numeric', minute: '2-digit', timeZone: 'America/Guayaquil' };
  return `${start.toLocaleTimeString('es-EC', opts)} – ${end.toLocaleTimeString('es-EC', opts)}`;
}

function syntheticLiveEpg(channel) {
  const now = new Date();
  const ecNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Guayaquil' }));
  const slotMin = ecNow.getMinutes() < 30 ? 0 : 30;
  const start = new Date(ecNow);
  start.setMinutes(slotMin, 0, 0);
  const end = new Date(start);
  end.setMinutes(start.getMinutes() + 30);
  const nextEnd = new Date(end);
  nextEnd.setMinutes(end.getMinutes() + 30);
  const elapsed = Math.max(0, ecNow - start);
  const total = Math.max(1, end - start);
  return {
    now: {
      title: channel.name,
      subtitle: channel.group_title || 'En vivo',
      range: formatLiveSlotRange(start, end),
      progress: Math.min(100, (elapsed / total) * 100)
    },
    next: {
      title: 'Programación en vivo',
      subtitle: channel.group_title || 'Canal en directo',
      range: formatLiveSlotRange(end, nextEnd)
    }
  };
}

function getLiveEpg(channel) {
  const entry = liveEpgMap[String(channel.id)];
  if (entry?.now?.title) return entry;
  return syntheticLiveEpg(channel);
}

async function fetchLiveEpg({ refresh = false } = {}) {
  try {
    const q = refresh ? '?refresh=1' : '';
    const data = await api(`/live/epg${q}`);
    liveEpgMap = data.epg || {};
    liveEpgMeta = {
      source: data.source || 'none',
      updated_at: data.updated_at || null,
      error: data.error || '',
      matched: data.channels_matched,
      total: data.channels_total
    };
  } catch {
    liveEpgMap = {};
    liveEpgMeta = { source: 'error' };
  }
}

function applyLiveEpgToUi() {
  if (!$('#page-live')?.classList.contains('active')) return;
  refreshLiveGuideEpgRows();
  const ch = allChannels.find((c) => String(c.id) === String(selectedLiveChannelId));
  if (ch) updateLiveHero(ch);
}

function fetchLiveEpgInBackground({ refresh = false } = {}) {
  if (liveEpgFetchPromise && !refresh) return liveEpgFetchPromise;
  liveEpgFetchPromise = fetchLiveEpg({ refresh })
    .then(() => applyLiveEpgToUi())
    .catch(() => {})
    .finally(() => { liveEpgFetchPromise = null; });
  return liveEpgFetchPromise;
}

function liveChannelLogoHtml(ch, small = false) {
  if (ch.logo) {
    return `<img class="live-epg-logo${small ? ' is-sm' : ''}" src="${escHtml(ch.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'live-epg-logo-ph',textContent:'📺'}))">`;
  }
  return `<span class="live-epg-logo-ph">📺</span>`;
}

function liveEpgRowHtml(ch, index) {
  const epg = getLiveEpg(ch);
  const active = String(selectedLiveChannelId) === String(ch.id) ? ' active' : '';
  const safeName = escHtml(ch.name);
  return `<button type="button" class="live-epg-row tv-focusable${active}" data-id="${ch.id}"
    data-url="${encodeURIComponent(ch.stream_url || '')}" data-name="${safeName}"
    data-logo="${encodeURIComponent(ch.logo || '')}" data-group="${escHtml(ch.group_title || 'General')}">
    <div class="live-epg-channel">
      <span class="live-epg-num">${100 + index}</span>
      ${liveChannelLogoHtml(ch, true)}
      <span class="live-epg-ch-name">${safeName}</span>
    </div>
    <div class="live-epg-now">
      <strong>${escHtml(epg.now.title)}</strong>
      <span class="live-epg-sub">${escHtml(epg.now.subtitle)} · ${epg.now.range}</span>
      <div class="live-epg-progress" aria-hidden="true"><span style="width:${(epg.now.progress ?? 0).toFixed(1)}%"></span></div>
    </div>
    <div class="live-epg-next">
      <strong>${escHtml(epg.next.title)}</strong>
      <span class="live-epg-sub">${escHtml(epg.next.subtitle)} · ${epg.next.range}</span>
    </div>
    <span class="live-epg-play" aria-hidden="true">▶</span>
  </button>`;
}

function epgRangeParts(range) {
  const raw = String(range || '').trim();
  if (!raw) return { start: '', end: '' };
  const sep = raw.includes('–') ? '–' : (raw.includes(' - ') ? ' - ' : '');
  if (!sep) return { start: raw, end: '' };
  const parts = raw.split(sep).map((s) => s.trim());
  return { start: parts[0] || '', end: parts[parts.length - 1] || '' };
}

function hideLiveHeroPanelNow() {
  clearTimeout(liveHeroPanelHideTimer);
  liveHeroPanelHideTimer = null;
  $('#live-hero-player')?.classList.remove('live-hero-panel-visible');
}

function showLiveHeroPanelNow() {
  const panel = $('#live-hero-overlay');
  if (panel?.classList.contains('hidden')) return;
  clearTimeout(liveHeroPanelHideTimer);
  liveHeroPanelHideTimer = null;
  $('#live-hero-player')?.classList.add('live-hero-panel-visible');
}

function scheduleHideLiveHeroPanel() {
  clearTimeout(liveHeroPanelHideTimer);
  liveHeroPanelHideTimer = setTimeout(hideLiveHeroPanelNow, LIVE_PANEL_HIDE_MS);
}

function bindLiveHeroPanelHover() {
  if (liveHeroHoverBound) return;
  liveHeroHoverBound = true;
  const player = $('#live-hero-player');
  const panel = $('#live-hero-overlay');
  if (!player) return;

  const isInPlayerZone = (target) => !!(target && player.contains(target));

  const onPlayerInteract = () => {
    if (panel?.classList.contains('hidden')) return;
    showLiveHeroPanelNow();
    scheduleHideLiveHeroPanel();
  };

  player.addEventListener('mouseenter', showLiveHeroPanelNow);
  player.addEventListener('mouseleave', scheduleHideLiveHeroPanel);

  player.addEventListener('pointerdown', (e) => {
    if (panel?.classList.contains('hidden')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    onPlayerInteract();
  }, { passive: true });

  panel?.addEventListener('pointerdown', onPlayerInteract, { passive: true });
  panel?.addEventListener('touchstart', onPlayerInteract, { passive: true });
  panel?.addEventListener('input', onPlayerInteract, { passive: true });
  panel?.addEventListener('change', onPlayerInteract, { passive: true });

  player.addEventListener('touchstart', (e) => {
    if (panel?.classList.contains('hidden')) return;
    if (e.target.closest('button, input, label, .live-hero-controls-row, .live-volume-wrap')) return;
    onPlayerInteract();
  }, { passive: true });

  document.addEventListener('pointerdown', (e) => {
    if (panel?.classList.contains('hidden')) return;
    if (isInPlayerZone(e.target)) return;
    scheduleHideLiveHeroPanel();
  });

  document.addEventListener('touchstart', (e) => {
    if (panel?.classList.contains('hidden')) return;
    if (isInPlayerZone(e.target)) return;
    scheduleHideLiveHeroPanel();
  }, { passive: true });
}

function updateLiveHero(channel) {
  const titleEl = $('#live-hero-title');
  const metaEl = $('#live-hero-meta');
  const watchBtn = $('#live-hero-watch');
  const placeholder = $('#live-hero-placeholder');
  const barFill = $('#live-hero-bar-fill');
  const timeStart = $('#live-hero-time-start');
  const timeEnd = $('#live-hero-time-end');
  hideLiveHeroPanelNow();
  if (!channel) {
    titleEl.textContent = 'Selecciona un canal';
    metaEl.textContent = '';
    if (watchBtn) watchBtn.disabled = true;
    placeholder?.classList.remove('hidden');
    $('#live-hero-overlay')?.classList.add('hidden');
    $('#live-hero-player')?.classList.remove('is-playable');
    if (barFill) {
      barFill.style.width = '0%';
      barFill.style.animation = '';
    }
    if (timeStart) timeStart.textContent = '';
    if (timeEnd) timeEnd.textContent = '';
    return;
  }
  $('#live-hero-overlay')?.classList.remove('hidden');
  $('#live-hero-player')?.classList.add('is-playable');
  const epg = getLiveEpg(channel);
  titleEl.textContent = epg.now.title || channel.name;
  metaEl.textContent = channel.group_title || channel.name;
  if (watchBtn) watchBtn.disabled = false;
  placeholder?.classList.add('hidden');
  const times = epgRangeParts(epg.now.range);
  if (timeStart) timeStart.textContent = times.start;
  if (timeEnd) timeEnd.textContent = times.end;
  if (barFill) {
    const pct = Math.min(100, Math.max(0, Number(epg.now.progress) || 0));
    barFill.style.width = `${pct || 8}%`;
    barFill.style.animation = pct ? 'none' : '';
  }
}

function clearLivePreviewWatchdog() {
  if (livePreviewWatchdog) {
    clearInterval(livePreviewWatchdog);
    livePreviewWatchdog = null;
  }
}

function clearLivePlayerWatchdog() {
  if (livePlayerWatchdog) {
    clearInterval(livePlayerWatchdog);
    livePlayerWatchdog = null;
  }
}

function nudgeLiveHlsToEdge(hls, video) {
  if (!hls || !video) return;
  try {
    hls.startLoad(-1);
    if (typeof hls.liveSyncPosition === 'number' && hls.liveSyncPosition > 0) {
      video.currentTime = hls.liveSyncPosition;
    }
    video.play().catch(() => {});
  } catch (_) {}
}

function attachLiveHlsHandlers(hls, video, { preview = false, autoplay = true } = {}) {
  if (!hls || !video) return;
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      hls.startLoad(-1);
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
      nudgeLiveHlsToEdge(hls, video);
      return;
    }
    if (liveHlsOwner === 'player' && !playerClosing) recoverLivePlayer(false);
    else if (liveHlsOwner === 'preview') recoverLivePreview(false);
  });
  if (Hls.Events.BUFFER_STALLED) {
    hls.on(Hls.Events.BUFFER_STALLED, () => nudgeLiveHlsToEdge(hls, video));
  }
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    applyLiveMaxQuality(hls);
    if (autoplay) video.play().catch(() => {});
  });
}

function startLiveStallWatchdog(video, {
  isActive,
  getHls,
  onRecover,
  intervalMs = 2000,
  stallTicks = 5,
  mode = 'preview'
}) {
  const clear = mode === 'preview' ? clearLivePreviewWatchdog : clearLivePlayerWatchdog;
  clear();
  if (!video) return;
  if (isAppleMobile() && !getHls?.()) return;

  let lastTime = video.currentTime || 0;
  let ticks = 0;

  const timer = setInterval(() => {
    if (!isActive()) {
      clear();
      return;
    }
    if (!video || video.paused || video.readyState < 2) return;
    const ct = video.currentTime;
    if (Math.abs(ct - lastTime) > 0.2) {
      lastTime = ct;
      ticks = 0;
      return;
    }
    ticks += 1;
    if (ticks < stallTicks) return;
    ticks = 0;
    const hls = getHls();
    if (hls) nudgeLiveHlsToEdge(hls, video);
    onRecover(!!hls);
  }, intervalMs);

  if (mode === 'preview') livePreviewWatchdog = timer;
  else livePlayerWatchdog = timer;
}

function recoverLivePreview(soft = false) {
  const ch = allChannels.find((c) => String(c.id) === String(selectedLiveChannelId));
  if (!ch || !$('#page-live')?.classList.contains('active') || isLivePlayerModalOpen()) return;
  const previewVideo = $('#live-preview-video');
  if (!livePreviewHls && prefersNativeHls(previewVideo)) return;
  if (Date.now() < livePreviewGraceUntil) {
    if (livePreviewHls) nudgeLiveHlsToEdge(livePreviewHls, $('#live-preview-video'));
    return;
  }
  if (soft && livePreviewHls) {
    nudgeLiveHlsToEdge(livePreviewHls, $('#live-preview-video'));
    return;
  }
  livePreviewRecoverCount += 1;
  if (livePreviewRecoverCount > 2) return;
  scheduleLivePreview(ch, 400);
}

function recoverLivePlayer(soft = false) {
  const ch = allChannels.find((c) => String(c.id) === String(selectedLiveChannelId));
  if (!ch || !playerLiveMode || playerClosing) return;
  const modalVideo = $('#video-player');
  if (!hlsInstance && prefersNativeHls(modalVideo)) return;
  if (soft && hlsInstance) {
    nudgeLiveHlsToEdge(hlsInstance, $('#video-player'));
    return;
  }
  playLive(ch.id, ch.stream_url, ch.name, ch.logo);
}

function stopLivePreview({ keepHls = false, bumpGen = true } = {}) {
  cancelScheduledLivePreview();
  if (bumpGen) livePreviewGen += 1;
  clearLivePreviewWatchdog();
  if (!keepHls && livePreviewHls) {
    livePreviewHls.destroy();
    livePreviewHls = null;
    liveHlsOwner = liveHlsOwner === 'preview' ? null : liveHlsOwner;
  }
  const video = $('#live-preview-video');
  if (video) {
    clearNativeLiveHandlers(video);
    video.onerror = null;
    video.onwaiting = null;
    video.onstalled = null;
    video.pause();
    if (!keepHls) {
      video.removeAttribute('src');
      video.load();
    }
  }
  if (liveClockTimer) {
    clearInterval(liveClockTimer);
    liveClockTimer = null;
  }
}

function canSeamlessLiveHandoff(channelId) {
  if (!channelId || String(channelId) !== String(selectedLiveChannelId)) return false;
  const previewVideo = $('#live-preview-video');
  if (!previewVideo || previewVideo.readyState < 2) return false;
  return !!(livePreviewHls || previewVideo.src);
}

function bindLiveVideoWaitingHandlers(video, getHls) {
  const onWaiting = () => {
    const hls = getHls();
    if (hls) nudgeLiveHlsToEdge(hls, video);
  };
  video.onwaiting = onWaiting;
  video.onstalled = onWaiting;
}

function handoffPreviewToModal(modalVideo, playUrl) {
  const previewVideo = $('#live-preview-video');
  const vol = previewVideo?.volume ?? 1;
  const muted = previewVideo?.muted ?? livePreviewMuted;

  stopLivePreview({ keepHls: true });

  if (livePreviewHls) {
    livePreviewHls.detachMedia();
    hlsInstance = livePreviewHls;
    livePreviewHls = null;
    liveHlsOwner = 'player';
    hlsInstance.attachMedia(modalVideo);
    applyLiveMaxQuality(hlsInstance);
  } else if (previewVideo?.src) {
    modalVideo.src = previewVideo.src;
    if (previewVideo.currentTime > 0 && !isAppleMobile()) modalVideo.currentTime = previewVideo.currentTime;
    attachNativeLiveHandlers(modalVideo, () => playUrl);
    previewVideo.removeAttribute('src');
    clearNativeLiveHandlers(previewVideo);
    previewVideo.load();
  }

  bindLiveVideoWaitingHandlers(modalVideo, () => hlsInstance);
  modalVideo.volume = vol;
  modalVideo.muted = muted;
  modalVideo.playsInline = true;
  modalVideo.play().catch(() => {});

  clearPlayerLoading();
  playerClosing = false;
  playerCurrentPath = playUrl;

  if (hlsInstance) {
    startLiveStallWatchdog(modalVideo, {
      mode: 'player',
      isActive: () => playerLiveMode && !playerClosing && !$('#player-modal')?.classList.contains('hidden'),
      getHls: () => hlsInstance,
      onRecover: (soft) => recoverLivePlayer(soft)
    });
  }
}

function handoffModalToPreview() {
  const previewVideo = $('#live-preview-video');
  const modalVideo = $('#video-player');
  if (!previewVideo || !modalVideo) return false;

  const vol = modalVideo.volume ?? 1;
  livePreviewMuted = modalVideo.muted;

  modalVideo.onwaiting = null;
  modalVideo.onstalled = null;

  if (hlsInstance) {
    clearLivePlayerWatchdog();
    hlsInstance.detachMedia();
    livePreviewHls = hlsInstance;
    hlsInstance = null;
    liveHlsOwner = 'preview';
    livePreviewHls.attachMedia(previewVideo);
    bindLiveVideoWaitingHandlers(previewVideo, () => livePreviewHls);
    previewVideo.volume = vol;
    previewVideo.muted = livePreviewMuted;
    syncLiveMuteUi(previewVideo, $('#live-preview-mute'), livePreviewMuted);
    previewVideo.play().catch(() => {});
    startLiveStallWatchdog(previewVideo, {
      mode: 'preview',
      isActive: () => $('#page-live')?.classList.contains('active') && !isLivePlayerModalOpen(),
      getHls: () => livePreviewHls,
      onRecover: (soft) => recoverLivePreview(soft)
    });
    return true;
  }

  if (modalVideo.src) {
    previewVideo.src = modalVideo.src;
    if (modalVideo.currentTime > 0 && !isAppleMobile()) previewVideo.currentTime = modalVideo.currentTime;
    attachNativeLiveHandlers(previewVideo, () => {
      const ch = allChannels.find((c) => String(c.id) === String(selectedLiveChannelId));
      return ch ? livePlayUrl(ch.id, ch.stream_url) : modalVideo.src;
    });
    clearNativeLiveHandlers(modalVideo);
    previewVideo.volume = vol;
    previewVideo.muted = livePreviewMuted;
    syncLiveMuteUi(previewVideo, $('#live-preview-mute'), livePreviewMuted);
    previewVideo.play().catch(() => {});
    return true;
  }

  return false;
}

function hideLivePreviewPlaceholder() {
  $('#live-hero-placeholder')?.classList.add('hidden');
}

async function startLivePreview(channel, { autoStart = false } = {}) {
  const video = $('#live-preview-video');
  if (!video || !channel) return;
  cancelScheduledLivePreview();
  stopLivePreview({ keepHls: false, bumpGen: false });
  livePreviewRecoverCount = 0;

  const url = livePlayUrl(channel.id, channel.stream_url);
  await warmLiveManifest(url);
  if (String(selectedLiveChannelId) !== String(channel.id)) return;

  hideLivePreviewPlaceholder();

  syncLivePreviewAudio(video);

  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    liveHlsOwner = 'preview';
    livePreviewHls = new Hls(createHlsConfig(true, { preview: false }));
    const onWaiting = () => {
      if (livePreviewHls) nudgeLiveHlsToEdge(livePreviewHls, video);
    };
    video.onwaiting = onWaiting;
    video.onstalled = onWaiting;
    attachLiveHlsHandlers(livePreviewHls, video, { preview: false, autoplay: true });

    let started = false;
    const kickPlay = () => {
      if (started || String(selectedLiveChannelId) !== String(channel.id)) return;
      started = true;
      applyLiveMaxQuality(livePreviewHls);
      video.play().then(() => {
        syncLivePreviewAudio(video);
        sendActivityHeartbeat();
      }).catch(() => {});
    };

    livePreviewHls.on(Hls.Events.FRAG_BUFFERED, kickPlay);
    livePreviewHls.on(Hls.Events.MANIFEST_PARSED, kickPlay);
    livePreviewHls.loadSource(url);
    livePreviewHls.attachMedia(video);
    syncLivePreviewAudio(video);
    setTimeout(kickPlay, 1200);
  } else if (prefersNativeHls(video)) {
    await playNativeLiveVideo(video, url);
  }
}

function isSportsLiveChannel(ch) {
  const g = String(ch?.group_title || '').toLowerCase();
  return g.includes('deporte') || g.includes('sport');
}

function pickAutoPreviewCandidates(list) {
  const pool = list.filter((c) =>
    !isAnimeChannel(c) && !isSlowLiveChannel(c) && !isSportsLiveChannel(c));
  if (pool.length) return pool;
  const fallback = list.filter((c) => !isAnimeChannel(c) && !isSportsLiveChannel(c));
  return fallback.length ? fallback : list.filter((c) => !isAnimeChannel(c));
}

function pickRandomLiveChannel(list) {
  const pool = pickAutoPreviewCandidates(list);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function startFeaturedLivePreview() {
  const pool = pickAutoPreviewCandidates(allChannels);
  if (!pool.length) return;

  const tries = [...pool].sort(() => Math.random() - 0.5);
  const maxTries = isAppleMobile() ? 1 : 5;

  for (const ch of tries.slice(0, maxTries)) {
    selectedLiveChannelId = ch.id;
    liveInitialChannelPicked = true;
    updateLiveHero(ch);
    $$('.live-epg-row').forEach((row) => {
      row.classList.toggle('active', String(row.dataset.id) === String(ch.id));
    });
    await startLivePreview(ch, { autoStart: true });
    enableLiveAudio();
    if (isAppleMobile()) return;
    await new Promise((r) => setTimeout(r, 3000));
    const video = $('#live-preview-video');
    if (video && (video.readyState >= 2 || !video.paused || video.currentTime > 0)) return;
    stopLivePreview();
  }
}

function isLivePlayerModalOpen() {
  const modal = $('#player-modal');
  return !!(modal && !modal.classList.contains('hidden') && playerLiveMode);
}

let liveHeroFullscreen = false;

function getLiveHeroFullscreenTarget() {
  return $('#live-hero-player') || $('#live-hero');
}

function documentFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function isLiveHeroFullscreen() {
  const target = getLiveHeroFullscreenTarget();
  if (!target) return false;
  const fsEl = documentFullscreenElement();
  if (fsEl && (fsEl === target || target.contains(fsEl))) return true;
  return liveHeroFullscreen || target.classList.contains('live-hero-fullscreen');
}

function syncLiveFullscreenUi() {
  const fs = isLiveHeroFullscreen();
  const btn = $('#live-preview-fullscreen');
  if (btn) {
    btn.textContent = fs ? '🗗' : '⛶';
    btn.setAttribute('aria-label', fs ? 'Salir de pantalla completa' : 'Pantalla completa');
    btn.setAttribute('title', fs ? 'Salir de pantalla completa' : 'Pantalla completa');
    btn.classList.toggle('is-active', fs);
  }
  document.body.classList.toggle('live-page-fullscreen', fs);
}

function clearLiveHeroFullscreenState() {
  liveHeroFullscreen = false;
  getLiveHeroFullscreenTarget()?.classList.remove('live-hero-fullscreen');
  $('#page-live')?.classList.remove('live-hero-fullscreen-active');
  document.body.classList.remove('live-page-fullscreen');
  syncLiveFullscreenUi();
}

async function exitLiveHeroFullscreen() {
  clearLiveHeroFullscreenState();
  try {
    if (documentFullscreenElement()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  } catch (_) { /* ignore */ }
  syncLiveFullscreenUi();
}

async function enterLiveHeroFullscreen() {
  const ch = allChannels.find((c) => String(c.id) === String(selectedLiveChannelId));
  if (!ch) return;
  enableLiveAudio();
  const target = getLiveHeroFullscreenTarget();
  if (!target) return;

  showLiveHeroPanelNow();
  liveHeroFullscreen = true;
  target.classList.add('live-hero-fullscreen');
  $('#page-live')?.classList.add('live-hero-fullscreen-active');
  document.body.classList.add('live-page-fullscreen');
  syncLiveFullscreenUi();

  try {
    if (target.requestFullscreen) await target.requestFullscreen();
    else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
  } catch (_) { /* CSS fallback */ }
  syncLiveFullscreenUi();
}

function toggleLiveHeroFullscreen() {
  if (isLiveHeroFullscreen()) exitLiveHeroFullscreen();
  else enterLiveHeroFullscreen();
}

function restoreLivePreview() {
  const ch = allChannels.find((c) => String(c.id) === String(selectedLiveChannelId));
  if (ch && $('#page-live')?.classList.contains('active')) startLivePreview(ch);
}

function minimizeLiveVideo() {
  if (isLiveHeroFullscreen()) {
    exitLiveHeroFullscreen();
    return;
  }
  if (isLivePlayerModalOpen()) closePlayer();
}

function maximizeLiveVideo() {
  enterLiveHeroFullscreen();
}

function toggleLiveVideoSize() {
  if (isLivePlayerModalOpen()) {
    minimizeLiveVideo();
    return;
  }
  toggleLiveHeroFullscreen();
}

function openSelectedLiveFull() {
  maximizeLiveVideo();
}

function selectLiveChannel(channel, { preview = true, openFull = false, forcePreview = false } = {}) {
  if (!channel) return;
  enableLiveAudio();
  const sameChannel = String(selectedLiveChannelId) === String(channel.id);
  selectedLiveChannelId = channel.id;
  livePreviewRecoverCount = 0;
  updateLiveHero(channel);
  $$('.live-epg-row').forEach((row) => {
    row.classList.toggle('active', String(row.dataset.id) === String(channel.id));
  });
  if (preview && (!sameChannel || forcePreview) && $('#page-live')?.classList.contains('active')) {
    scheduleLivePreview(channel, 80);
  }
  if (openFull) {
    const enterFs = () => {
      if ($('#page-live')?.classList.contains('active')) enterLiveHeroFullscreen();
    };
    if (preview && (!sameChannel || forcePreview)) {
      setTimeout(enterFs, 120);
    } else {
      enterFs();
    }
  }
}

function bindLiveGuide(container) {
  container.querySelectorAll('.live-epg-row').forEach((row) => {
    row.addEventListener('pointerdown', () => {
      warmLiveManifest(livePlayUrl(row.dataset.id, decodeURIComponent(row.dataset.url || '')));
    }, { passive: true });
    row.addEventListener('click', () => {
      const channel = allChannels.find((c) => String(c.id) === String(row.dataset.id));
      if (!channel) return;
      selectLiveChannel(channel, { preview: true, openFull: false, forcePreview: true });
    });
    row.addEventListener('dblclick', () => {
      const channel = allChannels.find((c) => String(c.id) === String(row.dataset.id));
      if (!channel) return;
      selectLiveChannel(channel, { preview: true, openFull: true, forcePreview: true });
    });
  });
}

function isAnimeChannel(ch) {
  const hay = `${ch?.name || ''} ${ch?.group_title || ''}`;
  return LIVE_ANIME_RE.test(hay);
}

function isMovieChannel(ch) {
  const hay = `${ch?.name || ''} ${ch?.group_title || ''}`;
  return LIVE_MOVIE_RE.test(hay);
}

const DEPORTES_CHANNEL_ORDER = [
  'dsports', 'win sports', 'tyc sports', 'fox deportes',
  'espn premium', 'espn deportes', 'dsports 2', 'claro sports', 'bein sports'
];

function liveChannelSortKey(ch) {
  const g = String(ch?.group_title || '').trim();
  if (/^deportes$/i.test(g)) {
    const n = String(ch?.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const idx = DEPORTES_CHANNEL_ORDER.findIndex((needle) => n === needle);
    if (idx >= 0) return idx;
  }
  const o = Number(ch?.order);
  return Number.isFinite(o) && o > 0 ? o + 100 : 9999;
}

function sortLiveChannels(list) {
  return [...list].sort((a, b) => {
    const aAnime = isAnimeChannel(a) ? 1 : 0;
    const bAnime = isAnimeChannel(b) ? 1 : 0;
    if (aAnime !== bAnime) return aAnime - bAnime;
    const g = String(a.group_title || '').localeCompare(String(b.group_title || ''), 'es');
    if (g !== 0) return g;
    const ak = liveChannelSortKey(a);
    const bk = liveChannelSortKey(b);
    if (ak !== bk) return ak - bk;
    return String(a.name || '').localeCompare(String(b.name || ''), 'es');
  });
}

function isSlowLiveChannel(ch) {
  const url = String(ch?.stream_url || '');
  const group = String(ch?.group_title || '');
  return /saohgdasregions\.fun|tvporinternet/i.test(url)
    || /cine en vivo|deportes/i.test(group) && /saohgdasregions/i.test(url);
}

function pickFeaturedLiveChannel(list) {
  const ecuador = list.filter((c) => /^ecuador$/i.test(c.group_title || '') && !isAnimeChannel(c));
  const pluto = list.filter((c) => String(c.group_title || '').startsWith('Pluto TV ·'));
  const vix = list.filter(isLiveVixSidebarChannel);
  const pool = [...ecuador, ...pluto, ...vix];
  const fast = list.filter((c) => !isSlowLiveChannel(c) && !isAnimeChannel(c));
  const rawPool = ecuador.length ? ecuador : (pool.length ? pool : fast);
  const seen = new Set();
  const finalPool = rawPool.filter((ch) => {
    if (seen.has(ch.id)) return false;
    seen.add(ch.id);
    return true;
  });
  if (!finalPool.length) return list.find((c) => !isAnimeChannel(c)) || list[0] || null;

  const idx = Math.floor(Math.random() * finalPool.length);
  return finalPool[idx];
}

function cancelScheduledLivePreview() {
  if (livePreviewScheduleTimer) {
    clearTimeout(livePreviewScheduleTimer);
    livePreviewScheduleTimer = null;
  }
}

function scheduleLivePreview(channel, delayMs = 80) {
  cancelScheduledLivePreview();
  if (!channel) return;
  const gen = ++livePreviewGen;
  livePreviewScheduleTimer = setTimeout(() => {
    livePreviewScheduleTimer = null;
    if (gen !== livePreviewGen) return;
    if (String(selectedLiveChannelId) !== String(channel.id)) return;
    if (!$('#page-live')?.classList.contains('active') || isLivePlayerModalOpen()) return;
    startLivePreview(channel, { autoStart: false });
  }, delayMs);
}

function syncLiveMuteUi(video, btn, muted) {
  if (video) video.muted = muted;
  if (!btn) return;
  btn.classList.toggle('is-muted', muted);
  btn.setAttribute('aria-label', muted ? 'Activar audio' : 'Silenciar');
  if (!btn.querySelector('.live-ctrl-icon')) {
    btn.textContent = muted ? '🔇' : '🔊';
  }
}

function setLivePreviewVolume(value) {
  const video = $('#live-preview-video');
  const vol = Math.max(0, Math.min(1, Number(value) / 100));
  if (video) video.volume = vol;
  if (vol > 0 && livePreviewMuted) {
    livePreviewMuted = false;
    syncLiveMuteUi(video, $('#live-preview-mute'), false);
    if (video) video.muted = false;
  }
}

function bindLiveAudioControls() {
  if (liveAudioControlsBound) return;
  liveAudioControlsBound = true;

  const previewVideo = $('#live-preview-video');
  const muteBtn = $('#live-preview-mute');
  const volInput = $('#live-preview-volume');
  const fsBtn = $('#live-preview-fullscreen');

  syncLiveMuteUi(previewVideo, muteBtn, false);
  livePreviewMuted = false;

  muteBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    livePreviewMuted = !livePreviewMuted;
    if (!livePreviewMuted && previewVideo) previewVideo.volume = (Number(volInput?.value || 100)) / 100;
    syncLiveMuteUi(previewVideo, muteBtn, livePreviewMuted);
  });

  volInput?.addEventListener('input', (e) => {
    e.stopPropagation();
    setLivePreviewVolume(volInput.value);
  });
  volInput?.addEventListener('click', (e) => e.stopPropagation());

  fsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLiveHeroFullscreen();
  });

  if (!window.__liveFsBound) {
    window.__liveFsBound = true;
    const onFsChange = () => {
      const target = getLiveHeroFullscreenTarget();
      const fsEl = documentFullscreenElement();
      if (fsEl && target && (fsEl === target || target.contains(fsEl))) {
        liveHeroFullscreen = true;
        target.classList.add('live-hero-fullscreen');
        $('#page-live')?.classList.add('live-hero-fullscreen-active');
        document.body.classList.add('live-page-fullscreen');
      } else if (liveHeroFullscreen || target?.classList.contains('live-hero-fullscreen')) {
        clearLiveHeroFullscreenState();
      }
      syncLiveFullscreenUi();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
  }

  const heroPlayer = $('#live-hero-player');
  const onPreviewDblClick = (e) => {
    if (e.target.closest('button, input, label, .live-hero-controls-row, .live-volume-wrap')) return;
    e.preventDefault();
    e.stopPropagation();
    toggleLiveVideoSize();
  };
  heroPlayer?.addEventListener('dblclick', onPreviewDblClick);
  previewVideo?.addEventListener('dblclick', onPreviewDblClick);

  const playerVideo = $('#video-player');
  playerVideo?.addEventListener('dblclick', () => {
    if (isLivePlayerModalOpen()) minimizeLiveVideo();
  });
  const playerMute = $('#player-mute');
  const playerVol = $('#player-volume');

  playerMute?.addEventListener('click', () => {
    if (!playerVideo) return;
    playerVideo.muted = !playerVideo.muted;
    playerMute.textContent = playerVideo.muted ? '🔇' : '🔊';
    playerMute.classList.toggle('is-muted', playerVideo.muted);
  });

  playerVol?.addEventListener('input', () => {
    if (!playerVideo) return;
    playerVideo.volume = Math.max(0, Math.min(1, Number(playerVol.value) / 100));
    if (playerVideo.volume > 0) {
      playerVideo.muted = false;
      playerMute.textContent = '🔊';
      playerMute.classList.remove('is-muted');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!$('#page-live')?.classList.contains('active')) return;
    if (e.key === 'Escape' && isLiveHeroFullscreen() && !isLivePlayerModalOpen()) {
      e.preventDefault();
      exitLiveHeroFullscreen();
      return;
    }
    if (e.key.toLowerCase() !== 'm' || e.target.matches('input, textarea')) return;
    if ($('#player-modal') && !$('#player-modal').classList.contains('hidden')) {
      playerMute?.click();
    } else {
      muteBtn?.click();
    }
  });

  bindLiveHeroPanelHover();

}

if (!window.__livePageVisibilityBound) {
  window.__livePageVisibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!$('#page-live')?.classList.contains('active')) return;
    refreshLiveChannelsList().catch(() => {});
    if (isLivePlayerModalOpen()) recoverLivePlayer(true);
    else recoverLivePreview(true);
  });
}

const LIVE_SIDEBAR_ORDER = [
  'Ecuador',
  'Películas',
  'Series',
  'Novelas',
  'Kids',
  'Música',
  'Noticias',
  'Deportes'
];

function liveCategoryLabel(name) {
  return String(name || '')
    .replace(/^Pluto TV · /, '')
    .replace(/^ViX · /, '')
    .trim() || name;
}

function isLiveVixSidebarChannel(ch) {
  const g = String(ch?.group_title || '');
  return g === 'VIX' || g.startsWith('ViX ·');
}

function isLiveFreeTvChannel(ch) {
  return String(ch?.group_title || '') === 'Freetv';
}

function isLivePlutoChannel(ch) {
  return String(ch?.group_title || '').startsWith('Pluto TV ·');
}

function isLiveMusicaChannel(ch) {
  const g = String(ch?.group_title || '');
  if (isLiveVixSidebarChannel(ch) || isLiveFreeTvChannel(ch)) return false;
  return g === 'Música' || /retrix|vevo|hits/i.test(ch?.name || '');
}

function isLiveNoticiasChannel(ch) {
  const g = String(ch?.group_title || '');
  if (isLiveVixSidebarChannel(ch) || isLiveFreeTvChannel(ch)) return false;
  return g === 'Noticias';
}

function countLiveSidebarCategories() {
  const counts = {};
  LIVE_SIDEBAR_ORDER.forEach((k) => { counts[k] = 0; });
  counts.__vix__ = 0;
  counts.__freetv__ = 0;
  counts.__pluto__ = 0;
  for (const ch of allChannels) {
    const g = String(ch.group_title || '').trim();
    if (!g) continue;
    if (/^ecuador$/i.test(g)) counts.Ecuador += 1;
    else if (isLiveFreeTvChannel(ch)) counts.__freetv__ += 1;
    else if (isLiveVixSidebarChannel(ch)) counts.__vix__ += 1;
    else if (isLivePlutoChannel(ch)) counts.__pluto__ += 1;
    else if (isLiveMusicaChannel(ch)) counts['Música'] = (counts['Música'] || 0) + 1;
    else if (isLiveNoticiasChannel(ch)) counts.Noticias = (counts.Noticias || 0) + 1;
    else counts[g] = (counts[g] || 0) + 1;
  }
  return counts;
}

function liveCategoryChipLabel(key) {
  if (key === '__vix__') return 'VIX';
  if (key === '__freetv__') return 'Freetv';
  if (key === '__pluto__') return 'Pluto';
  return liveCategoryLabel(key);
}

function liveCategoryMenuKeys(counts) {
  const keys = [];
  const used = new Set();
  const add = (key) => {
    if (!key || used.has(key)) return;
    const n = counts[key] || 0;
    if (n <= 0) return;
    keys.push(key);
    used.add(key);
  };

  add('Ecuador');
  add('Deportes');
  add('__vix__');
  add('__freetv__');
  add('__pluto__');
  for (const key of LIVE_SIDEBAR_ORDER) {
    if (key === 'Ecuador' || key === 'Deportes') continue;
    add(key);
  }

  const extras = Object.keys(counts)
    .filter((k) => !k.startsWith('__') && !used.has(k) && counts[k] > 0 && !k.startsWith('Pluto TV ·'))
    .sort((a, b) => a.localeCompare(b, 'es'));
  extras.forEach((k) => add(k));
  return keys;
}

function renderLiveCategoryFilters() {
  const makeChip = (group, label, count, sidebar = false) => {
    const countHtml = (!sidebar && count != null) ? ` <span>${count}</span>` : '';
    const cls = sidebar ? 'live-cat-chip live-cat-sidebar-item' : 'live-cat-chip';
    return `<button type="button" class="${cls}" data-group="${escHtml(group)}">${escHtml(label)}${countHtml}</button>`;
  };

  const counts = countLiveSidebarCategories();
  const menuKeys = liveCategoryMenuKeys(counts);

  const sidebarItems = menuKeys.map((key) => makeChip(key, liveCategoryChipLabel(key), null, true));
  const scrollItems = [makeChip('all', 'Destacado', allChannels.length)];
  menuKeys.forEach((key) => {
    scrollItems.push(makeChip(key, liveCategoryChipLabel(key), counts[key]));
  });

  const sidebar = $('#live-pluto-cats');
  const scroll = $('#live-pluto-cats-scroll');
  if (sidebar) sidebar.innerHTML = sidebarItems.join('');
  if (scroll) scroll.innerHTML = scrollItems.join('');
  $$('.live-cat-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('.live-cat-chip').forEach((c) => c.classList.remove('active'));
      document.querySelectorAll(`.live-cat-chip[data-group="${chip.dataset.group}"]`).forEach((c) => c.classList.add('active'));
      currentGroup = chip.dataset.group;
      renderLiveGuide();
    });
  });
  document.querySelectorAll('.live-cat-chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.group === currentGroup);
  });
}

function refreshLiveGuideEpgRows() {
  $$('.live-epg-row').forEach((row) => {
    const ch = allChannels.find((c) => String(c.id) === String(row.dataset.id));
    if (!ch) return;
    const epg = getLiveEpg(ch);
    const nowEl = row.querySelector('.live-epg-now');
    const nextEl = row.querySelector('.live-epg-next');
    if (nowEl) {
      nowEl.innerHTML = `<strong>${escHtml(epg.now.title)}</strong><span class="live-epg-sub">${escHtml(epg.now.subtitle)} · ${epg.now.range}</span><div class="live-epg-progress" aria-hidden="true"><span style="width:${(epg.now.progress ?? 0).toFixed(1)}%"></span></div>`;
    }
    if (nextEl) {
      nextEl.innerHTML = `<strong>${escHtml(epg.next.title)}</strong><span class="live-epg-sub">${escHtml(epg.next.subtitle)} · ${epg.next.range}</span>`;
    }
  });
}

function renderLiveGuide() {
  const guide = $('#live-pluto-guide');
  if (!guide) return;
  const search = ($('#live-search')?.value || '').trim().toLowerCase();
  let filtered = [...allChannels];
  if (currentGroup === '__vix__') filtered = filtered.filter(isLiveVixSidebarChannel);
  else if (currentGroup === '__freetv__') filtered = filtered.filter(isLiveFreeTvChannel);
  else if (currentGroup === '__pluto__') filtered = filtered.filter(isLivePlutoChannel);
  else if (currentGroup === 'Música') filtered = filtered.filter(isLiveMusicaChannel);
  else if (currentGroup === 'Noticias') filtered = filtered.filter(isLiveNoticiasChannel);
  else if (currentGroup === 'Ecuador') filtered = filtered.filter((c) => /^ecuador$/i.test(String(c.group_title || '')));
  else if (currentGroup !== 'all') filtered = filtered.filter((c) => String(c.group_title || '').trim() === currentGroup);
  if (search) filtered = filtered.filter((c) => c.name.toLowerCase().includes(search));

  if (!filtered.length) {
    guide.innerHTML = '<div class="live-pluto-empty">No hay canales en esta categoría.</div>';
    updateLiveHero(null);
    stopLivePreview();
    selectedLiveChannelId = null;
    return;
  }

  const sorted = sortLiveChannels(filtered);
  guide.innerHTML = sorted.map((ch, i) => liveEpgRowHtml(ch, i)).join('');
  bindLiveGuide(guide);

  const selected = sorted.find((c) => String(c.id) === String(selectedLiveChannelId));
  let next;
  let autoPreview = true;
  if (selected) {
    next = selected;
  } else if (!search && currentGroup === 'all' && !liveInitialChannelPicked) {
    liveInitialChannelPicked = true;
    next = pickRandomLiveChannel(sorted) || sorted.find((c) => !isAnimeChannel(c)) || sorted[0];
    selectLiveChannel(next, { preview: false, openFull: false });
    return;
  } else {
    next = pickRandomLiveChannel(sorted) || sorted.find((c) => !isAnimeChannel(c)) || sorted[0];
  }
  selectLiveChannel(next, { preview: autoPreview, openFull: false });
}

function tickLiveClock() {
  const now = formatLiveClock();
  const el = $('#live-now-time');
  if (el) el.textContent = `Ahora: ${now}`;
  const ch = allChannels.find((c) => String(c.id) === String(selectedLiveChannelId));
  if (ch && $('#page-live')?.classList.contains('active')) {
    const epg = getLiveEpg(ch);
    const times = epgRangeParts(epg.now.range);
    if (times.start) {
      const startEl = $('#live-hero-time-start');
      if (startEl && !startEl.textContent) startEl.textContent = times.start;
    }
  }
  const playerLive = $('#player-live-time');
  if (playerLive && playerLiveMode) playerLive.textContent = now;
}

function livePlayUrl(channelId, fallbackUrl) {
  if (channelId) {
    const q = `token=${encodeURIComponent(token)}&sid=${encodeURIComponent(getClientSessionKey())}`;
    return `/api/live/ch/${channelId}/play.m3u8?${q}`;
  }
  if (/^https?:\/\//i.test(fallbackUrl || '')) return proxyStreamUrl(fallbackUrl);
  return fallbackUrl || '';
}

const TC_PAGE_URL = 'https://tctelevision.com/envivo/';
const TC_EMBEDDER_URL = 'https://tctelevision.com';
const TC_DEFAULT_VIDEO_ID = 'x7wijay';
const TC_REFERER = TC_PAGE_URL;
let tcResolvedCache = { url: '', expires: 0, channelId: null };

function parseChannelConfig(ch) {
  if (!ch?.config) return {};
  if (typeof ch.config === 'object') return ch.config;
  try { return JSON.parse(ch.config); } catch { return {}; }
}

function isTcChannel(ch) {
  if (!ch) return false;
  if (String(ch.name || '').trim().toLowerCase() === 'tc') return true;
  const cfg = parseChannelConfig(ch);
  if (cfg?.tctelevision?.video_id) return true;
  return (cfg.sources || []).some((s) => s.resolver === 'tctelevision');
}

function isTcVariantUrl(url = '') {
  return /dmcdn\.net\/sec2\(/i.test(String(url || '')) && /\.m3u8/i.test(String(url || ''));
}

function pickBestTcVariant(body = '') {
  const lines = String(body).split(/\r?\n/);
  let best1080 = '';
  let best720 = '';
  let bestAny = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    const next = (lines[i + 1] || '').split('#')[0].trim();
    if (!next.startsWith('http')) continue;
    if (/NAME="1080"|RESOLUTION=1920x1080|live-1080/i.test(line)) best1080 = next;
    else if (/NAME="720"|RESOLUTION=1280x720|live-720/i.test(line)) best720 = next;
    if (!bestAny) bestAny = next;
  }
  return best1080 || best720 || bestAny || '';
}

async function resolveTcLivePlayback(ch) {
  const cfg = parseChannelConfig(ch);
  const videoId = cfg?.tctelevision?.video_id || TC_DEFAULT_VIDEO_ID;
  const metaRes = await fetch(
    `https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(videoId)}?embedder=${encodeURIComponent(TC_EMBEDDER_URL)}`,
    {
      credentials: 'include',
      headers: { Referer: TC_REFERER, Accept: 'application/json' }
    }
  );
  if (!metaRes.ok) throw new Error('No se pudo leer metadata de TC');
  const meta = await metaRes.json();
  if (meta?.error?.code) throw new Error(meta.error.message || 'Señal TC no disponible');
  const directorUrl = meta?.qualities?.auto?.[0]?.url;
  if (!directorUrl) throw new Error('TC sin URL M3U8');

  const masterRes = await fetch(directorUrl, {
    credentials: 'include',
    headers: {
      Referer: TC_REFERER,
      Origin: TC_EMBEDDER_URL,
      Accept: '*/*'
    }
  });
  if (!masterRes.ok) throw new Error('No se pudo abrir manifest de TC');
  const masterBody = await masterRes.text();
  const variantUrl = pickBestTcVariant(masterBody);
  if (!variantUrl) throw new Error('No se encontró variante HLS de TC');
  return { url: variantUrl, videoId, referer: TC_REFERER };
}

async function publishTcStreamUrl(channelId, streamUrl, videoId) {
  await api('/live/tc/publish-stream', {
    method: 'POST',
    body: JSON.stringify({ channel_id: channelId, stream_url: streamUrl, video_id: videoId })
  });
}

async function refreshTcFromServer(ch) {
  const data = await api('/live/tc/refresh', {
    method: 'POST',
    body: JSON.stringify({ channel_id: ch.id }),
    timeoutMs: 90000
  });
  if (!data?.stream_url) throw new Error('No se pudo renovar la señal TC');
  ch.stream_url = data.stream_url;
  const idx = allChannels.findIndex((c) => String(c.id) === String(ch.id));
  if (idx >= 0) allChannels[idx].stream_url = data.stream_url;
  return ch;
}

async function ensureTcStreamReady(ch) {
  if (!isTcChannel(ch)) return ch;
  if (!token) throw new Error('Inicia sesión para ver TC Televisión');

  const now = Date.now();
  const playUrl = () => livePlayUrl(ch.id, ch.stream_url);

  if (
    tcResolvedCache.channelId === ch.id
    && tcResolvedCache.expires > now
    && await warmLiveManifest(playUrl())
  ) {
    return ch;
  }

  if (await warmLiveManifest(playUrl())) {
    tcResolvedCache = { url: ch.stream_url, expires: now + 15 * 60 * 1000, channelId: ch.id };
    return ch;
  }

  await refreshTcFromServer(ch);
  if (await warmLiveManifest(playUrl())) {
    tcResolvedCache = { url: ch.stream_url, expires: now + 15 * 60 * 1000, channelId: ch.id };
    return ch;
  }

  throw new Error('No se pudo conectar TC Televisión. Intenta de nuevo en unos segundos.');
}

async function warmLiveManifest(url) {
  if (!url || !token) return false;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    return res.ok;
  } catch {
    return false;
  }
}

function applyLiveMaxQuality(hls) {
  if (!hls?.levels?.length) return;
  const maxLevel = hls.levels.length - 1;
  hls.autoLevelCapping = maxLevel;
  hls.nextLevel = maxLevel;
  hls.loadLevel = maxLevel;
}

function createHlsConfig(live, opts = {}) {
  const { preview = false, tcReferer = TC_REFERER } = opts;
  const xhrSetup = (xhr, url) => {
    if (url.includes('/api/live/')) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (/dmcdn\.net|dailymotion\.com/i.test(url)) {
      xhr.setRequestHeader('Referer', tcReferer);
      xhr.setRequestHeader('Origin', TC_EMBEDDER_URL);
    }
  };
  if (!live) {
    return {
      maxBufferLength: 12,
      maxMaxBufferLength: 24,
      maxBufferSize: 30 * 1000 * 1000,
      startFragPrefetch: true,
      enableWorker: true,
      renderTextTracksNatively: true,
      enableWebVTT: true,
      xhrSetup
    };
  }
  return {
    enableWorker: true,
    xhrSetup,
    lowLatencyMode: false,
    liveBackBufferLength: 0,
    maxLiveSyncPlaybackRate: 1.25,
    backBufferLength: preview ? 12 : 30,
    maxBufferLength: preview ? 18 : 30,
    maxMaxBufferLength: preview ? 36 : 60,
    maxBufferSize: preview ? 28 * 1000 * 1000 : 60 * 1000 * 1000,
    maxBufferHole: 0.5,
    startLevel: -1,
    testBandwidth: !preview,
    abrEwmaDefaultEstimate: preview ? 2500000 : 8000000,
    abrBandWidthFactor: 0.95,
    abrBandWidthUpFactor: preview ? 0.85 : 0.95,
    capLevelToPlayerSize: false,
    startFragPrefetch: true,
    initialLiveManifestSize: 1,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 10,
    manifestLoadingTimeOut: 12000,
    levelLoadingTimeOut: 12000,
    fragLoadingTimeOut: 15000,
    manifestLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
    fragLoadingMaxRetry: 6
  };
}

function proxyStreamUrl(url, referer = '', watch = {}) {
  let q = `url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}&sid=${encodeURIComponent(getClientSessionKey())}`;
  if (referer) q += `&referer=${encodeURIComponent(referer)}`;
  if (watch.title) q += `&watch_title=${encodeURIComponent(String(watch.title).slice(0, 160))}`;
  if (watch.content_type) q += `&watch_type=${encodeURIComponent(watch.content_type)}`;
  if (watch.status) q += `&watch_status=${encodeURIComponent(watch.status)}`;
  if (watch.content_id != null && watch.content_id !== '') {
    q += `&watch_id=${encodeURIComponent(String(watch.content_id))}`;
  }
  return `/api/live/stream?${q}`;
}

function bindLiveCards(container) {
  container.querySelectorAll('.live-card').forEach(card => {
    card.addEventListener('pointerdown', () => {
      const id = card.dataset.id;
      const url = decodeURIComponent(card.dataset.url || '');
      warmLiveManifest(livePlayUrl(id, url));
    }, { passive: true });
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const url = decodeURIComponent(card.dataset.url || '');
      const name = card.dataset.name;
      const logo = decodeURIComponent(card.dataset.logo || '');
      playLive(id, url, name, logo);
    });
  });
}

/* AUTH & PERFILES */
let profileManageMode = false;
let profileFormState = { mode: 'setup', profileId: null };

function resetProfileFormFields(profile = null) {
  const nameEl = $('#profile-setup-name');
  const kidsEl = $('#profile-setup-kids');
  const pinEl = $('#profile-setup-pin');
  if (nameEl) nameEl.value = profile?.name || '';
  if (kidsEl) kidsEl.checked = !!profile?.is_kids;
  if (pinEl) pinEl.value = '';
  kidsEl?.dispatchEvent(new Event('change'));
}

function openProfileForm(mode, profile = null) {
  profileFormState = { mode, profileId: profile?.id || null };
  setLoginBusy(false);
  showScreen('profile-screen');
  $('#profile-setup-panel')?.classList.remove('hidden');
  $('#profile-picker-panel')?.classList.add('hidden');
  $('#profile-setup-error').textContent = '';

  const title = $('#profile-form-title');
  const sub = $('#profile-form-sub');
  const submit = $('#profile-setup-submit');
  const cancel = $('#profile-form-cancel');
  const del = $('#profile-form-delete');
  const pinLabel = $('#profile-pin-wrap');

  resetProfileFormFields(profile);

  if (mode === 'setup') {
    if (title) title.textContent = 'Crea tu perfil';
    if (sub) sub.textContent = 'La primera vez debes elegir un nombre. Tu lista, favoritos y progreso serán solo de este perfil.';
    if (submit) submit.textContent = 'Empezar a ver';
    cancel?.classList.add('hidden');
    del?.classList.add('hidden');
    if (!profile && currentUser?.username && $('#profile-setup-name')) {
      $('#profile-setup-name').value = currentUser.username;
    }
  } else if (mode === 'add') {
    if (title) title.textContent = 'Agregar perfil';
    if (sub) sub.textContent = 'Marca «Perfil infantil» para filtrar contenido y proteger con PIN al cambiar de perfil.';
    if (submit) submit.textContent = 'Guardar perfil';
    cancel?.classList.remove('hidden');
    del?.classList.add('hidden');
  } else {
    if (title) title.textContent = 'Editar perfil';
    if (sub) sub.textContent = profile?.is_kids
      ? 'Deja el PIN en blanco para mantener el actual. Desmarca infantil para quitar la restricción.'
      : 'Activa «Perfil infantil» y define un PIN de 4 dígitos.';
    if (submit) submit.textContent = 'Guardar cambios';
    cancel?.classList.remove('hidden');
    del?.classList.remove('hidden');
    if (pinLabel) pinLabel.textContent = profile?.is_kids ? 'Nuevo PIN (opcional)' : 'PIN de 4 dígitos';
  }

  if (VIX_PLATFORM === 'tv') {
    applyTvNavFocusables();
    requestAnimationFrame(() => focusTvScreenStart());
  } else {
    setTimeout(() => $('#profile-setup-name')?.focus(), 100);
  }
}

function showProfileSetup() {
  openProfileForm('setup');
  dismissNativeSplashIfNeeded();
}

function showProfilePicker(profiles, opts = {}) {
  profileManageMode = !!opts.manage;
  showScreen('profile-screen');
  $('#profile-setup-panel')?.classList.add('hidden');
  $('#profile-picker-panel')?.classList.remove('hidden');
  $('#profile-error').textContent = '';

  const title = $('#profile-picker-title');
  const sub = $('#profile-picker-sub');
  const manageBtn = $('#profile-manage-btn');
  const grid = $('#profile-grid');

  if (profileManageMode) {
    if (title) title.textContent = 'Administrar perfiles';
    if (sub) sub.textContent = 'Selecciona un perfil para editarlo o eliminarlo.';
    if (manageBtn) manageBtn.textContent = 'Listo';
  } else {
    if (title) title.textContent = '¿Quién está viendo?';
    if (sub) {
      sub.textContent = opts.fromSwitch
        ? 'Elige quién va a ver para continuar.'
        : 'Inicio de sesión correcto. Elige quién va a ver para continuar.';
    }
    if (manageBtn) manageBtn.textContent = 'Administrar perfiles';
  }

  grid?.classList.toggle('manage-mode', profileManageMode);

  const cards = (profiles || []).map((p) => `
    <button type="button" class="profile-card" data-id="${p.id}" data-kids="${p.is_kids ? '1' : '0'}">
      <span class="profile-avatar" style="background:${escHtml(p.avatar_color || '#e50914')}">${escHtml((p.name || 'P').charAt(0).toUpperCase())}</span>
      <span class="profile-name">${escHtml(p.name)}</span>
      ${p.is_kids ? '<span class="profile-kids-badge">Infantil</span>' : ''}
    </button>
  `).join('');
  const addBtn = (profiles || []).length < 5
    ? `<button type="button" class="profile-card profile-card-add" id="profile-add-btn">
        <span class="profile-avatar profile-avatar-add">+</span>
        <span class="profile-name">Agregar perfil</span>
      </button>`
    : '';
  grid.innerHTML = cards + addBtn;
  grid.querySelectorAll('.profile-card').forEach((btn) => {
    btn.classList.add('tv-focusable');
    btn.tabIndex = 0;
  });

  const profileMap = Object.fromEntries((profiles || []).map((p) => [String(p.id), p]));
  grid.querySelectorAll('.profile-card[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      if (profileManageMode) openProfileForm('edit', profileMap[String(id)]);
      else selectProfile(id);
    });
  });

  $('#profile-add-btn')?.addEventListener('click', () => openProfileForm('add'));
  if (VIX_PLATFORM === 'tv') requestAnimationFrame(() => focusTvScreenStart());
  dismissNativeSplashIfNeeded();
}

async function selectProfile(profileId, pin = '') {
  try {
    const data = await api('/profiles/select', {
      method: 'POST',
      body: JSON.stringify({ profileId, pin: pin || undefined })
    });
    token = data.token;
    currentUser = data.user;
    currentProfile = data.profile;
    userPermissions = {
      can_live: data.user.can_live,
      can_movies: data.user.can_movies,
      can_series: data.user.can_series
    };
    persistAuthToken(token);
    await refreshWatchProgress();
    await finishAppBoot();
  } catch (err) {
    if (err.needs_pin || err.message?.includes('PIN')) {
      const pin = prompt('Introduce el PIN del perfil infantil (4 dígitos):');
      if (pin) return selectProfile(profileId, pin);
    }
    $('#profile-error').textContent = err.message;
  }
}

function tvRowFocusables(active) {
  const ctrl = tvNavControl(active) || active;
  if (ctrl?.closest('.topbar')) return null;
  const carousel = ctrl?.closest('.carousel');
  if (carousel) return tvFocusPool(carousel);
  const dots = ctrl?.closest('.hero-dots');
  if (dots) return tvFocusPool(dots);
  const tabs = ctrl?.closest('.mylist-tabs');
  if (tabs) return [...tabs.querySelectorAll('.mylist-tab:not(.hidden)')].filter((el) => el.offsetParent);
  return null;
}

function tryTvRowNav(ctrl, key, e) {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
  const rowItems = tvRowFocusables(ctrl);
  if (!rowItems?.length) return false;
  const rowIdx = rowItems.indexOf(ctrl);
  if (rowIdx < 0) return false;

  const delta = key === 'ArrowRight' ? 1 : -1;
  const next = rowItems[rowIdx + delta];
  e.preventDefault();
  e.stopPropagation();
  if (next) focusTvElement(next);
  return true;
}

function processTvRemoteKey(key, e) {
  if (!isTvMode()) return false;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) return false;

  const screen = getTvActiveScreen();
  let ctrl = tvActiveControl();
  if (!ctrl) ctrl = focusTvScreenStart();
  if (!ctrl) return false;

  if (screen === 'login') {
    if (key === 'Enter') {
      const user = ($('#login-user')?.value || '').trim();
      const pass = $('#login-pass')?.value || '';
      if (user && pass) {
        e.preventDefault();
        performLogin();
        return true;
      }
    }
    const items = tvScreenFocusables('login');
    if (tryTvFormListNav(ctrl, key, e, items)) return true;
    return tryTvSpatialNav(ctrl, key, e, items);
  }

  if (screen === 'profile') {
    const setupVisible = !$('#profile-setup-panel')?.classList.contains('hidden');
    if (setupVisible) {
      return tryTvFormListNav(ctrl, key, e, tvScreenFocusables('profile'));
    }
    if (key === 'Enter') {
      e.preventDefault();
      ctrl.click?.();
      return true;
    }
    const items = tvScreenFocusables('profile');
    if (!items.length) return false;
    let idx = items.indexOf(ctrl);
    if (idx < 0) {
      e.preventDefault();
      focusTvElement(items[0]);
      return true;
    }
    return tryTvSpatialNav(ctrl, key, e, items) || tryTvFormListNav(ctrl, key, e, items);
  }

  if (key === 'Enter') {
    e.preventDefault();
    ctrl.click?.();
    return true;
  }

  if (tryTvTopbarNav(ctrl, key, e)) return true;

  if (key === 'ArrowDown' && ctrl.closest('.topbar')) {
    e.preventDefault();
    focusContentBelowTopbar();
    return true;
  }

  if (key === 'ArrowUp' && !ctrl.closest('.topbar')) {
    const r = ctrl.getBoundingClientRect?.();
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect?.();
    if (r && topbar && r.top > topbar.bottom - 20) {
      e.preventDefault();
      focusTvTopbarStart();
      return true;
    }
  }

  if (tryTvRowNav(ctrl, key, e)) return true;

  const items = tvFocusPool();
  if (!items.length) return false;
  return tryTvSpatialNav(ctrl, key, e, items);
}

function tryTvSpatialNav(ctrl, key, e, items) {
  let idx = items.indexOf(ctrl);
  if (idx < 0) {
    e.preventDefault();
    focusTvElement(items[0]);
    return true;
  }

  const cur = items[idx].getBoundingClientRect();
  const cx = (cur.left + cur.right) / 2;
  const cy = (cur.top + cur.bottom) / 2;
  let best = null;
  let bestScore = Infinity;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  items.forEach((el, i) => {
    if (i === idx) return;
    const r = el.getBoundingClientRect();
    const ex = (r.left + r.right) / 2;
    const ey = (r.top + r.bottom) / 2;
    let ok = false;
    let primary = 0;
    let secondary = 0;
    if (key === 'ArrowRight') { ok = ex > cx + 8; primary = ex - cx; secondary = Math.abs(ey - cy); }
    if (key === 'ArrowLeft') { ok = ex < cx - 8; primary = cx - ex; secondary = Math.abs(ey - cy); }
    if (key === 'ArrowDown') { ok = ey > cy + 8; primary = ey - cy; secondary = Math.abs(ex - cx); }
    if (key === 'ArrowUp') { ok = ey < cy - 8; primary = cy - ey; secondary = Math.abs(ex - cx); }
    if (!ok) return;
    const score = primary * 10000 + secondary * (horizontal ? 80 : 1);
    if (score < bestScore) { bestScore = score; best = el; }
  });
  if (best) {
    e.preventDefault();
    e.stopPropagation();
    focusTvElement(best);
    return true;
  }
  return false;
}

function initTvRemoteNav() {
  if (!isTvMode()) return;
  if (window.__vixTvNavBound) return;
  window.__vixTvNavBound = true;

  document.addEventListener('keydown', (e) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return;
    processTvRemoteKey(e.key, e);
  }, true);
}

window.refreshVixNativeBridge = refreshVixNativeBridge;
window.getVixPlatform = getVixPlatform;
window.isTvMode = isTvMode;
window.processTvRemoteKey = processTvRemoteKey;
window.focusTvScreenStart = focusTvScreenStart;
window.focusTvTopbarStart = focusTvTopbarStart;
window.tvActiveControl = tvActiveControl;
window.trackTvFocus = trackTvFocus;
window.focusTvElement = focusTvElement;
window.handleTvKey = function handleTvKey(key) {
  if (!key) return false;
  return processTvRemoteKey(key, { preventDefault() {}, stopPropagation() {} });
};

async function finishAppBoot() {
  clearNativeBootWatchdog();
  const errEl = $('#login-error');
  if (errEl) errEl.textContent = '';
  showScreen('app');
  if (!location.hash || location.hash === '#') {
    history.replaceState({ page: defaultPageForUser() }, '', buildRouteHash(defaultPageForUser()));
  }
  const label = currentProfile?.name || currentUser?.username || 'Cuenta';
  const userNameEl = $('#user-name');
  if (userNameEl) userNameEl.textContent = label;
  updateAccountProfileHeader();
  applyNavPermissions();
  try {
    await loadUserLibrary();
  } catch (err) {
    if (/perfil/i.test(err.message) && currentUser?.profiles?.length) {
      showProfilePicker(currentUser.profiles);
      return;
    }
    throw err;
  }
  bindNav();
  bindGlobalSearch();
  bindProfileKidsPin();
  applyTvNavFocusables();
  if (!window.__passwordModalBound) {
    bindPasswordModal();
    window.__passwordModalBound = true;
  }
  bindMyListTabs();
  bindAccountMobileActions();
  bindCardDelegation();
  initCarouselDragScroll();
  initTvRemoteNav();
  bindPlayerControls();
  bindHeroTrailerAudio();
  bindAppBackNavigation();
  startActivityHeartbeat();
  window.addEventListener('pagehide', sendActivityOffline);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sendActivityHeartbeat();
  });
  restoreRouteFromHash().catch(() => navigateToPage(defaultPageForUser(), { replaceRoute: true }));
  if (isTvMode()) requestAnimationFrame(() => focusTvScreenStart());
  checkNativeAppUpdate();
  notifyNativeBootComplete();
}

function nativeAppPlatform() {
  const p = window.VIXTV_NATIVE?.platform;
  if (p === 'tv' || p === 'mobile') return p;
  return VIX_PLATFORM === 'tv' ? 'tv' : 'mobile';
}

function isUpdateForThisApp(info, platform) {
  if (!info?.update_available) return false;
  if (info.platform && info.platform !== platform) return false;
  const expected = platform === 'tv' ? 'VixTV-tv.apk' : 'VixTV-mobile.apk';
  if (info.target_apk && info.target_apk !== expected) return false;
  if (info.download_url && !info.download_url.includes(expected)) return false;
  return true;
}

async function checkNativeAppUpdate() {
  if (!isVixNativeApp()) return;
  /* iOS/Capacitor: la app carga la web del servidor; no usa APK ni banner de Android. */
  if (isCapacitorIos() || VIX_PLATFORM === 'ios') return;
  const platform = nativeAppPlatform();
  const code = window.VIXTV_NATIVE?.versionCode
    ?? (parseInt(new URLSearchParams(location.search).get('vix_build') || '0', 10) || 1);
  try {
    const info = await fetch(`${API}/app/update?platform=${platform}&version_code=${code}`).then((r) => r.json());
    if (isUpdateForThisApp(info, platform)) showAppUpdateBanner(info);
  } catch {
    /* offline or server unavailable */
  }
}

function triggerNativeAppUpdate(downloadUrl) {
  if (!downloadUrl) return toast('Enlace de actualización no disponible', true);
  if (window.VixTvAndroid?.downloadUpdate) {
    window.VixTvAndroid.downloadUpdate(downloadUrl);
    toast('Descargando actualización…', false);
    return;
  }
  window.open(downloadUrl, '_blank');
  toast('Descarga el APK e instálalo manualmente', false);
}

function showAppUpdateBanner(info) {
  if (document.getElementById('vix-update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'vix-update-banner';
  banner.className = 'vix-update-banner';
  const version = info.version_name ? ` v${escHtml(info.version_name)}` : '';
  banner.innerHTML = `
    <div class="vix-update-banner-text">
      <strong>Nueva versión${version}</strong>
      <span>${escHtml(info.message || 'Actualiza la app para obtener las últimas mejoras.')}</span>
    </div>
    <div class="vix-update-banner-actions">
      <button type="button" class="vix-update-btn tv-focusable" tabindex="0">Actualizar</button>
      ${info.force ? '' : '<button type="button" class="vix-update-dismiss tv-focusable" tabindex="0">Más tarde</button>'}
    </div>`;
  const runUpdate = () => {
    triggerNativeAppUpdate(info.download_url);
    if (!info.force) banner.remove();
  };
  const bindAction = (el, fn) => {
    if (!el) return;
    el.addEventListener('click', fn);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
      }
    });
  };
  bindAction(banner.querySelector('.vix-update-btn'), runUpdate);
  bindAction(banner.querySelector('.vix-update-dismiss'), () => banner.remove());
  document.body.prepend(banner);
  if (VIX_PLATFORM === 'tv') {
    requestAnimationFrame(() => banner.querySelector('.vix-update-btn')?.focus());
  }
}

function setLoginBusy(on, text = 'Conectando…') {
  const busy = $('#login-busy');
  const box = busy?.querySelector('.login-busy-box');
  if (!busy) return;
  if (box) box.textContent = text;
  busy.classList.toggle('hidden', !on);
}

async function performLogin() {
  if (window.__vixLoginBusy) return;
  window.__vixBootAttempted = true;
  clearNativeBootWatchdog();
  const username = ($('#login-user')?.value || '').trim();
  const password = $('#login-pass')?.value || '';
  const errEl = $('#login-error');
  const submitBtn = $('#login-submit-btn');
  if (!username || !password) {
    if (errEl) errEl.textContent = 'Escribe usuario y contraseña.';
    try { window.VixTvAndroid?.showToast?.('Escribe usuario y contraseña'); } catch { /* */ }
    return;
  }
  if (isTvMode() && window.VixTvAndroid?.nativeLogin) {
    try {
      window.VixTvAndroid.nativeLogin(username, password);
      return;
    } catch { /* fallback web */ }
  }
  window.__vixLoginBusy = true;
  if (errEl) errEl.textContent = '';
  setLoginBusy(true, 'Conectando…');
  if (submitBtn) submitBtn.disabled = true;
  try {
    try { window.VixTvAndroid?.showToast?.('Conectando…'); } catch { /* */ }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: ctrl.signal
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('El servidor no respondió a tiempo. Intenta de nuevo.');
      }
      const server = (window.VIXTV_NATIVE?.server || location.origin).replace(/\/$/, '');
      throw new Error(`Sin conexión con ${server}. Revisa Ajustes y tu red.`);
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Usuario o contraseña incorrectos.');
    }
    token = data.token;
    currentUser = data.user;
    onActivityUserChanged(data.user?.username || decodeJwtUsername(data.token));
    userPermissions = {
      can_live: data.user.can_live,
      can_movies: data.user.can_movies,
      can_series: data.user.can_series
    };
    persistAuthToken(token);
    if (errEl) errEl.textContent = '';
    setLoginBusy(true, 'Entrando…');
    if (data.needsProfileSetup) {
      setLoginBusy(false);
      if (errEl) errEl.textContent = '';
      showProfileSetup();
      try { window.VixTvAndroid?.showToast?.('Crea tu perfil para continuar'); } catch { /* */ }
      dismissNativeSplashIfNeeded();
      return;
    }
    if (data.needsProfilePick) {
      setLoginBusy(false);
      showProfilePicker(data.profiles || []);
      dismissNativeSplashIfNeeded();
      return;
    }
    currentProfile = data.profile || null;
    window.__vixBootAttempted = true;
    await finishAppBoot();
    setLoginBusy(false);
    dismissNativeSplashIfNeeded();
  } catch (err) {
    setLoginBusy(false);
    window.__vixBootAttempted = false;
    if (errEl) errEl.textContent = err.message;
    token = null;
    persistAuthToken(null);
    try { window.VixTvAndroid?.showToast?.(err.message); } catch { /* */ }
  } finally {
    window.__vixLoginBusy = false;
    if (submitBtn) submitBtn.disabled = false;
    if (isTvMode() && $('#login-screen')?.classList.contains('active') && !$('#profile-screen')?.classList.contains('active')) {
      focusTvElement(submitBtn || $('#login-pass'));
    }
  }
}

window.performLogin = performLogin;
window.vixDoLogin = function vixDoLogin(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  performLogin();
  return false;
};

function bindLoginForm() {
  $('#login-submit-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    performLogin();
  });
  $('#login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    performLogin();
  });
}

bindLoginForm();

$('#logout-btn')?.addEventListener('click', logout);
$('#switch-profile-btn')?.addEventListener('click', async () => {
  try {
    const profiles = await api('/profiles');
    showProfilePicker(profiles, { fromSwitch: true });
  } catch (e) {
    toast(e.message, true);
  }
});

function logout() {
  sendActivityOffline();
  stopActivityHeartbeat();
  connectionLimitNotified = false;
  token = null;
  currentUser = null;
  currentProfile = null;
  continueWatchingCache = {};
  watchProgressMap = {};
  window.__vixBootAttempted = false;
  persistAuthToken(null);
  showScreen('login-screen');
}

function getCurrentPageName() {
  const page = document.querySelector('.page.active');
  if (!page) return 'home';
  return page.id.replace('page-', '') || 'home';
}

function isLivePreviewActive() {
  if (!$('#page-live')?.classList.contains('active') || !selectedLiveChannelId) return false;
  const video = $('#live-preview-video');
  if (!video) return false;
  if (isLivePlayerModalOpen()) return false;
  return !!(livePreviewHls || video.src || video.currentSrc) && !video.ended;
}

function liveActivityChannel() {
  return allChannels.find((c) => String(c.id) === String(selectedLiveChannelId)) || null;
}

function isPlayerOpen() {
  const modal = $('#player-modal');
  return !!modal && !modal.classList.contains('hidden');
}

function buildActivityPayload() {
  const video = $('#video-player');
  const page = getCurrentPageName();
  let payload = {
    status: page === 'admin' ? 'admin' : 'browsing',
    page,
    title: '',
    content_type: '',
    content_id: null,
    progress: 0,
    duration: 0,
    session_key: getClientSessionKey()
  };

  if (playerLiveMode && isPlayerOpen()) {
    const ch = liveActivityChannel();
    payload.status = 'watching_live';
    payload.title = currentPlayerTitle.replace(/^🔴\s*/, '') || ch?.name || $('#live-channel-name')?.textContent || 'Canal en vivo';
    payload.content_type = 'live';
    payload.content_id = selectedLiveChannelId || ch?.id || null;
  } else if (isLivePreviewActive()) {
    const ch = liveActivityChannel();
    payload.status = 'watching_live';
    payload.page = 'live';
    payload.title = ch?.name || 'Canal en vivo';
    payload.content_type = 'live';
    payload.content_id = ch?.id || selectedLiveChannelId || null;
  } else if (isPlayerOpen() && (playerWatchMeta || externalPlaySession)) {
    const meta = playerWatchMeta || {};
    const ext = externalPlaySession || {};
    const isEpisode = meta.content_type === 'episode'
      || ext._series
      || (Number(ext.season) > 0 && Number(ext.episode) > 0);
    payload.status = isEpisode ? 'watching_episode' : 'watching_movie';
    payload.page = 'player';
    const baseTitle = currentPlayerTitle || meta.title || meta.episodeTitle || $('#player-title')?.textContent || '';
    const source = meta.source || ext.source || '';
    const sourceLabel = EXTERNAL_SOURCE_LABELS[source] || source;
    if (source && sourceLabel) {
      payload.title = isEpisode
        ? `${meta.title || baseTitle} T${ext.season || meta.season}E${ext.episode || meta.episode} (${sourceLabel})`
        : `${baseTitle || meta.title || slugToDisplayTitle(ext.slug || meta.slug || '')} (${sourceLabel})`;
    } else {
      payload.title = baseTitle;
    }
    payload.content_type = isEpisode ? 'episode' : (meta.content_type || 'movie');
    payload.content_id = meta.content_id || ext.slug || meta.slug || null;
    payload.progress = video?.currentTime || 0;
    payload.duration = getPlayerDuration(video) || 0;
  } else if (page === 'admin') {
    payload.status = 'admin';
    payload.title = 'Panel de administración';
  } else {
    const pageTitles = { home: 'Inicio', mylist: 'Mi lista', movies: 'Películas', series: 'Series', live: 'TV En vivo', 'movie-detail': 'Detalle película', 'series-detail': 'Detalle serie' };
    payload.title = pageTitles[page] || page;
  }

  currentActivity = payload;
  return payload;
}

let connectionLimitNotified = false;

function sendActivityHeartbeat() {
  syncAuthTokenForActivity();
  if (!token) return;
  const payload = buildActivityPayload();
  fetch(`${API}/activity/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  }).then(async (res) => {
    if (res.status !== 429) return;
    const data = await res.json().catch(() => ({}));
    if (connectionLimitNotified) return;
    connectionLimitNotified = true;
    toast(data.error || 'Límite de conexiones alcanzado para esta cuenta', true);
  }).catch(() => {});
}

function sendActivityOffline() {
  syncAuthTokenForActivity();
  if (!token) return;
  fetch(`${API}/activity/offline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ session_key: getClientSessionKey() })
  }).catch(() => {});
}

function startActivityHeartbeat() {
  stopActivityHeartbeat();
  sendActivityHeartbeat();
  activityTimer = setInterval(sendActivityHeartbeat, 8000);
}

function stopActivityHeartbeat() {
  if (activityTimer) {
    clearInterval(activityTimer);
    activityTimer = null;
  }
}

async function initApp() {
  currentUser = await api('/auth/me');
  userPermissions = {
    can_live: currentUser.can_live,
    can_movies: currentUser.can_movies,
    can_series: currentUser.can_series
  };
  if (currentUser.needsProfileSetup) {
    showProfileSetup();
    notifyNativeBootComplete();
    return;
  }
  if (currentUser.needsProfilePick) {
    showProfilePicker(currentUser.profiles || []);
    notifyNativeBootComplete();
    return;
  }
  currentProfile = currentUser.profile || null;
  await finishAppBoot();
}

async function submitProfileForm() {
  const name = $('#profile-setup-name')?.value?.trim();
  const errEl = $('#profile-setup-error');
  const mode = profileFormState.mode;
  if (!name) {
    errEl.textContent = 'Escribe un nombre para tu perfil';
    return;
  }
  const isKids = !!$('#profile-setup-kids')?.checked;
  const pin = ($('#profile-setup-pin')?.value || '').trim();
  const pinOk = /^\d{4}$/.test(pin);
  const existing = (currentUser?.profiles || []).find((p) => p.id === profileFormState.profileId);
  const editingKids = mode === 'edit' && !!existing?.is_kids;

  if (isKids) {
    if ((mode === 'setup' || mode === 'add') && !pinOk) {
      errEl.textContent = 'El perfil infantil requiere un PIN de 4 dígitos';
      return;
    }
    if (mode === 'edit' && !editingKids && !pinOk) {
      errEl.textContent = 'El perfil infantil requiere un PIN de 4 dígitos';
      return;
    }
    if (mode === 'edit' && editingKids && pin && !pinOk) {
      errEl.textContent = 'El PIN debe tener 4 dígitos';
      return;
    }
  }

  try {
    if (mode === 'setup') {
      const data = await api('/profiles/setup', {
        method: 'POST',
        body: JSON.stringify({ name, is_kids: isKids, pin: pin || undefined })
      });
      token = data.token;
      currentUser = data.user;
      currentProfile = data.profile;
      userPermissions = {
        can_live: data.user.can_live,
        can_movies: data.user.can_movies,
        can_series: data.user.can_series
      };
      persistAuthToken(token);
      await finishAppBoot();
      return;
    }

    if (mode === 'add') {
      await api('/profiles', {
        method: 'POST',
        body: JSON.stringify({ name, is_kids: isKids, pin: pin || undefined })
      });
    } else {
      await api(`/profiles/${profileFormState.profileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, is_kids: isKids, pin: pin || undefined })
      });
    }

    const list = await api('/profiles');
    if (currentUser) currentUser.profiles = list;
    showProfilePicker(list, { manage: profileManageMode });
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteCurrentProfileForm() {
  const id = profileFormState.profileId;
  if (!id) return;
  if (!confirm('¿Eliminar este perfil? Se perderá su historial y listas.')) return;
  try {
    await api(`/profiles/${id}`, { method: 'DELETE' });
    const list = await api('/profiles');
    if (currentUser) currentUser.profiles = list;
    showProfilePicker(list, { manage: profileManageMode });
  } catch (err) {
    $('#profile-setup-error').textContent = err.message;
  }
}

$('#profile-setup-submit')?.addEventListener('click', (e) => {
  e.preventDefault();
  submitProfileForm();
});
$('#profile-setup-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  submitProfileForm();
});
$('#profile-form-cancel')?.addEventListener('click', async () => {
  const list = await api('/profiles');
  showProfilePicker(list, { manage: profileManageMode });
});
$('#profile-form-delete')?.addEventListener('click', () => deleteCurrentProfileForm());
$('#profile-manage-btn')?.addEventListener('click', async () => {
  const list = await api('/profiles');
  showProfilePicker(list, { manage: !profileManageMode, fromSwitch: true });
});

if (isVixNativeApp()) {
  document.addEventListener('DOMContentLoaded', updateNativeLoginHint);
}

function armNativeBootWatchdog() {
  if (!isVixNativeApp()) return;
  clearTimeout(window.__vixBootWatchdog);
  window.__vixBootWatchdog = setTimeout(() => {
    if (currentUser) return;
    window.__vixBootAttempted = false;
    document.documentElement.classList.remove('vix-booting');
    showScreen('login-screen');
    dismissNativeSplashIfNeeded();
  }, 16000);
}

function clearNativeBootWatchdog() {
  clearTimeout(window.__vixBootWatchdog);
}

function scheduleAppBoot() {
  if (!token || window.__vixBootAttempted) return;
  window.__vixBootAttempted = true;
  armNativeBootWatchdog();
  const boot = (isTvMode() && isVixNativeApp() && typeof applyNativeSession === 'function')
    ? applyNativeSession(token)
    : initApp();
  boot.catch((err) => {
    clearNativeBootWatchdog();
    token = null;
    currentUser = null;
    currentProfile = null;
    window.__vixBootAttempted = false;
    if (isTvMode() && isVixNativeApp()) {
      try {
        window.VixTvAndroid?.notifyNativeBootFailed?.(err?.message || 'No se pudo iniciar sesión');
      } catch { /* */ }
      return;
    }
    persistAuthToken(null);
    showScreen('login-screen');
    const msg = err?.message || '';
    if (msg && msg !== 'Sesión expirada') {
      const errEl = $('#login-error');
      if (errEl) errEl.textContent = `${msg}. Ingresa de nuevo.`;
    }
    dismissNativeSplashIfNeeded();
  });
}

if (token) {
  const runBoot = () => {
    if (!window.__vixLoginBusy) scheduleAppBoot();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runBoot, { once: true });
  } else {
    runBoot();
  }
}

/* CONTRASEÑA */
function openPasswordModal() {
  const modal = $('#password-modal');
  if (!modal) return;
  $('#password-modal-user').textContent = currentUser?.username || '';
  $('#pwd-current').value = '';
  $('#pwd-new').value = '';
  $('#pwd-new2').value = '';
  $('#password-change-error').textContent = '';
  modal.classList.remove('hidden');
}

function closePasswordModal() {
  $('#password-modal')?.classList.add('hidden');
}

function bindPasswordModal() {
  $('#account-btn')?.addEventListener('click', openPasswordModal);
  $('#password-modal-close')?.addEventListener('click', closePasswordModal);
  $('#password-modal-backdrop')?.addEventListener('click', closePasswordModal);
  $('#password-change-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = $('#pwd-current').value;
    const next = $('#pwd-new').value;
    const next2 = $('#pwd-new2').value;
    const errEl = $('#password-change-error');
    if (next !== next2) {
      errEl.textContent = 'Las contraseñas nuevas no coinciden';
      return;
    }
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next })
      });
      closePasswordModal();
      toast('Contraseña actualizada');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

/* NAV */
function bindNav() {
  $$('.nav-btn, .mob-nav-btn, .ios-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateToPage(btn.dataset.page));
  });
}

let globalSearchTimer = null;

function bindGlobalSearch() {
  const modal = $('#search-modal');
  const input = $('#global-search');
  const results = $('#global-search-results');
  const openBtn = $('#global-search-btn');
  const closeBtn = $('#search-modal-close');
  const clearBtn = $('#search-clear-btn');
  const backdrop = $('#search-modal-backdrop');
  if (!modal || !input || !results || input.dataset.bound) return;
  input.dataset.bound = '1';

  const searchEmptyHtml = (title, hint = '') => `
    <div class="search-empty-state">
      <div class="search-empty-icon" aria-hidden="true">⌕</div>
      <p>${title}</p>
      ${hint ? `<p class="search-empty-hint">${hint}</p>` : ''}
    </div>`;

  const syncClearBtn = () => {
    if (!clearBtn) return;
    clearBtn.classList.toggle('hidden', !input.value.length);
  };

  const closeSearch = () => {
    modal.classList.add('hidden');
    input.value = '';
    results.innerHTML = '';
    syncClearBtn();
    document.body.classList.remove('search-open');
  };

  const openSearch = () => {
    modal.classList.remove('hidden');
    document.body.classList.add('search-open');
    results.innerHTML = searchEmptyHtml(
      'Busca películas, series o canales',
      'Escribe al menos 2 letras · Atajo: /'
    );
    syncClearBtn();
    setTimeout(() => input.focus(), 40);
  };

  const openResult = (type, id, hit) => {
    closeSearch();
    if (hit?.external || String(id || '').startsWith('external:')) {
      const parts = String(id || '').split(':');
      const source = parts[1];
      const slug = parts.slice(2).join(':');
      if (!source || !slug) return;
      if (type === 'series') showExternalSeriesDetail(source, slug);
      else showExternalMovieDetail(source, slug, hit?.year || '');
      return;
    }
    if (type === 'live') navigateToPage('live');
    else if (type === 'series') showSeriesDetail(id);
    else showMovieDetail(id);
  };

  const typeLabels = { movie: 'Película', series: 'Serie', live: 'Canal' };

  const renderSection = (title, items, type) => {
    if (!items.length) return '';
    const rows = items.map((it) => {
      const poster = posterUrl(it.poster, it);
      const name = escHtml(formatDisplayTitle(it.title || it.name || slugToDisplayTitle(it.slug || '')));
      const meta = type === 'live'
        ? escHtml(it.group_title || 'En vivo')
        : escHtml([it.year, it.genre || (it.external ? EXTERNAL_SOURCE_LABELS[it.source] || it.source : '')].filter(Boolean).join(' · '));
      const liveClass = type === 'live' ? ' search-hit--live' : '';
      const thumb = poster
        ? `<img src="${poster}" alt="" loading="lazy">`
        : `<span class="search-hit-fallback" aria-hidden="true">${type === 'live' ? '📡' : type === 'series' ? '📺' : '🎬'}</span>`;
      return `<button type="button" class="search-hit tv-focusable${liveClass}" data-type="${type}" data-id="${it.id}" data-external="${it.external ? '1' : '0'}" data-source="${escAttr(it.source || '')}" data-slug="${escAttr(it.slug || '')}" data-year="${it.year || ''}">
        <span class="search-hit-thumb-wrap">${thumb}</span>
        <span class="search-hit-body">
          <span class="search-hit-type">${typeLabels[type] || title}</span>
          <span class="search-hit-title">${name}</span>
          ${meta ? `<span class="search-hit-meta">${meta}</span>` : ''}
        </span>
        <span class="search-hit-chevron" aria-hidden="true">›</span>
      </button>`;
    }).join('');
    return `<section class="search-results-group"><h3 class="search-results-group-title">${title}</h3>${rows}</section>`;
  };

  const bindSearchHits = () => {
    results.querySelectorAll('.search-hit[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hit = {
          external: btn.dataset.external === '1',
          source: btn.dataset.source,
          slug: btn.dataset.slug,
          year: btn.dataset.year
        };
        const id = btn.dataset.external === '1' ? btn.dataset.id : parseInt(btn.dataset.id, 10);
        openResult(btn.dataset.type, id, hit);
      });
    });
  };

  const runSearch = async (q) => {
    syncClearBtn();
    if (q.length < 2) {
      results.innerHTML = searchEmptyHtml(
        'Busca películas, series o canales',
        'Escribe al menos 2 letras · Atajo: /'
      );
      return;
    }
    results.innerHTML = searchEmptyHtml('Buscando…');
    try {
      const data = await api(`/search?q=${encodeURIComponent(q)}&limit=12`);
      const movies = (data.movies || []).map((m) => ({ ...m, _type: 'movie' }));
      const series = (data.series || []).map((s) => ({ ...s, _type: 'series' }));
      const live = (data.live || []).map((c) => ({ ...c, title: c.name, _type: 'live' }));
      if (!movies.length && !series.length && !live.length) {
        results.innerHTML = searchEmptyHtml(
          `Sin resultados para «${escHtml(q)}»`,
          'Prueba otro título o revisa la ortografía'
        );
        return;
      }
      results.innerHTML = [
        renderSection('Series', series, 'series'),
        renderSection('Películas', movies, 'movie'),
        renderSection('Canales', live, 'live')
      ].join('');
      bindSearchHits();
    } catch {
      results.innerHTML = searchEmptyHtml('Error al buscar', 'Intenta de nuevo en unos segundos');
    }
  };

  openBtn?.addEventListener('click', openSearch);
  closeBtn?.addEventListener('click', closeSearch);
  backdrop?.addEventListener('click', closeSearch);
  clearBtn?.addEventListener('click', () => {
    input.value = '';
    syncClearBtn();
    runSearch('');
    input.focus();
  });

  input.addEventListener('input', () => {
    clearTimeout(globalSearchTimer);
    const q = input.value.trim();
    globalSearchTimer = setTimeout(() => runSearch(q), 260);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && modal.classList.contains('hidden') && !e.target.closest('input, textarea, select, [contenteditable="true"]')) {
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      e.preventDefault();
      closeSearch();
    }
  });
}

function bindProfileKidsPin() {
  const kids = $('#profile-setup-kids');
  const wrap = $('#profile-pin-wrap');
  const pin = $('#profile-setup-pin');
  const hint = $('#profile-pin-hint');
  if (!kids || !wrap || !pin) return;
  const toggle = () => {
    const on = kids.checked;
    wrap.classList.toggle('hidden', !on);
    pin.classList.toggle('hidden', !on);
    hint?.classList.toggle('hidden', !on);
    const label = document.querySelector('label[for="profile-setup-pin"]');
    if (label) {
      label.textContent = profileFormState.mode === 'edit' && on
        ? 'Nuevo PIN (opcional)'
        : 'PIN de 4 dígitos';
    }
  };
  kids.addEventListener('change', toggle);
  toggle();
}

let heroSlideTimeout = null;
let heroSlides = [];
let heroIndex = 0;
let playerClosing = false;
let playerLiveMode = false;
let playerKnownDuration = 0;
let playerLocalFast = false;
let playerCurrentPath = '';
let playerStreamOffset = 0;
let playerWatchMeta = null;
let playerSeriesEpisodesCache = null;
let playerAdvancingEpisode = false;
let lastSavedProgress = 0;
let watchSaveThrottle = 0;
let skipHintTimer = null;
let playerControlsBound = false;
let playerUiHideTimer = null;
let playerUiPinned = false;
let activityTimer = null;
let lastPlaybackActivityPulse = 0;

function pulsePlaybackActivity() {
  if (playerClosing || !isPlayerOpen()) return;
  const now = Date.now();
  if (now - lastPlaybackActivityPulse < 8000) return;
  lastPlaybackActivityPulse = now;
  sendActivityHeartbeat();
}
let currentActivity = { status: 'browsing', page: 'home', title: '' };
let currentPlayerTitle = '';

function cssUrl(url) {
  return String(url || '').replace(/'/g, '%27').replace(/"/g, '%22');
}

function stopHeroSlider(clearVideo = true) {
  if (heroSlideTimeout) {
    clearTimeout(heroSlideTimeout);
    heroSlideTimeout = null;
  }
  if (clearVideo) stopHeroVideos();
}

function bindHeroPlay(slide) {
  const btn = $('#hero-play');
  const open = () => {
    if (slide.content_type === 'series') showSeriesDetail(slide.id);
    else showMovieDetail(slide.id);
  };
  btn.onclick = open;
  btn.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
}

function stopHeroVideos() {
  $$('.hero-slide-video video').forEach((v) => {
    try { v.pause(); } catch { /* ignore */ }
  });
  $$('.hero-slide-video').forEach(el => { el.innerHTML = ''; });
  $$('.hero-slide').forEach(el => el.classList.remove('has-trailer', 'has-trailer-audio'));
  $('#hero-banner')?.classList.remove('hero-has-trailer', 'hero-has-trailer-audio');
  syncHeroTrailerAudioBtn();
  if (isMobileNativeApp() && $('#page-home')?.classList.contains('active') && heroSlides.length > 1) {
    startHeroSlider();
  }
}

function syncHeroTrailerAudioBtn() {
  const btn = $('#hero-trailer-audio');
  const slide = heroSlides[heroIndex];
  const hasTrailer = !!normalizeYoutubeKey(slide?.trailer);
  const active = document.querySelector('.hero-slide.active.has-trailer');
  if (!btn) return;
  if (!hasTrailer) {
    btn.classList.add('hidden');
    return;
  }
  if (isAppleMobile() && !trailerUsesNativePlayer()) {
    btn.classList.remove('hidden');
    btn.textContent = '▶';
    btn.setAttribute('aria-label', 'Reproducir tráiler');
    btn.setAttribute('title', 'Tráiler');
    btn.classList.remove('is-active');
    return;
  }
  if (!active) {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  if (heroTrailerAudioOn) {
    btn.textContent = '🔇';
    btn.setAttribute('aria-label', 'Silenciar tráiler');
    btn.setAttribute('title', 'Silenciar');
    btn.classList.add('is-active');
  } else {
    btn.textContent = '🔊';
    btn.setAttribute('aria-label', 'Activar audio del tráiler');
    btn.setAttribute('title', 'Activar audio');
    btn.classList.remove('is-active');
  }
}

function bindHeroTrailerAudio() {
  const btn = $('#hero-trailer-audio');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  const toggle = () => toggleHeroTrailerAudio();
  btn.addEventListener('click', toggle);
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

function toggleHeroTrailerAudio() {
  const slide = heroSlides[heroIndex];
  const key = normalizeYoutubeKey(slide?.trailer);
  if (!key) return;
  if (isAppleMobile() && !trailerUsesNativePlayer()) {
    openTrailerModal(key);
    return;
  }
  heroTrailerAudioOn = !heroTrailerAudioOn;
  const slideEl = document.querySelector('.hero-slide.active');
  slideEl?.classList.toggle('has-trailer-audio', heroTrailerAudioOn);
  $('#hero-banner')?.classList.toggle('hero-has-trailer-audio', heroTrailerAudioOn);
  const video = slideEl?.querySelector('.hero-slide-video video');
  if (video) {
    video.muted = !heroTrailerAudioOn;
    if (heroTrailerAudioOn) video.play().catch(() => {});
  } else {
    const iframe = slideEl?.querySelector('.hero-slide-video iframe');
    setHeroTrailerIframeAudio(iframe);
    if (heroTrailerAudioOn) {
      setTimeout(() => setHeroTrailerIframeAudio(iframe), 300);
    }
  }
  syncHeroTrailerAudioBtn();
}

async function playHeroTrailer(index) {
  stopHeroVideos();
  const slide = heroSlides[index];
  const key = normalizeYoutubeKey(slide?.trailer);
  if (!key) return;
  if (!heroBackgroundTrailerSupported()) {
    syncHeroTrailerAudioBtn();
    return;
  }
  const wrap = $(`.hero-slide[data-index="${index}"] .hero-slide-video`);
  if (!wrap) return;
  const slideEl = wrap.closest('.hero-slide');
  slideEl?.classList.add('has-trailer');
  if (heroTrailerAudioOn) slideEl?.classList.add('has-trailer-audio');
  $('#hero-banner')?.classList.add('hero-has-trailer');
  if (heroTrailerAudioOn) $('#hero-banner')?.classList.add('hero-has-trailer-audio');

  if (trailerUsesNativePlayer()) {
    try {
      const info = await fetchTrailerPlayUrl(key);
      if (heroIndex !== index) return;
      const video = mountNativeTrailerVideo(wrap, info.playUrl, {
        muted: !heroTrailerAudioOn,
        loop: true,
        controls: false,
        autoplay: true
      });
      if (video) {
        video.addEventListener('ended', () => {
          if (heroIndex === index) video.play().catch(() => {});
        });
      }
      if (isMobileNativeApp() && heroSlideTimeout) {
        clearTimeout(heroSlideTimeout);
        heroSlideTimeout = null;
      }
    } catch {
      slideEl?.classList.remove('has-trailer', 'has-trailer-audio');
      $('#hero-banner')?.classList.remove('hero-has-trailer', 'hero-has-trailer-audio');
    }
    syncHeroTrailerAudioBtn();
    return;
  }

  const embedUrl = heroTrailerEmbedUrl(key, { background: true });
  if (!embedUrl) return;
  wrap.innerHTML = `<iframe
    src=""
    data-src="${escHtml(embedUrl)}"
    title="Trailer"
    allow="autoplay; encrypted-media; picture-in-picture"
    referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  const iframe = wrap.querySelector('iframe');
  scheduleHeroTrailerAudioSync(iframe);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (heroIndex !== index || !iframe?.isConnected) return;
      iframe.src = iframe.dataset.src || embedUrl;
    });
  });
  if (isMobileNativeApp() && heroSlideTimeout) {
    clearTimeout(heroSlideTimeout);
    heroSlideTimeout = null;
  }
  syncHeroTrailerAudioBtn();
}

function goHeroSlide(index, opts = {}) {
  if (!heroSlides.length) return;
  heroIndex = ((index % heroSlides.length) + heroSlides.length) % heroSlides.length;
  const slide = heroSlides[heroIndex];

  $$('.hero-slide').forEach((el, i) => el.classList.toggle('active', i === heroIndex));
  $$('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === heroIndex));
  playHeroTrailer(heroIndex);

  const content = $('.hero-content');
  const useFade = !opts.instant && !heroFirstPaint;
  if (heroFirstPaint) heroFirstPaint = false;

  const paint = () => {
    $('#hero-title').textContent = slide.title;
    $('#hero-desc').textContent = slide.description || slide.genre || '';
    const meta = [];
    if (slide.rating) meta.push(`<span class="meta-chip rating-chip">⭐ ${slide.rating}/10</span>`);
    if (slide.year) meta.push(`<span class="meta-chip">${slide.year}</span>`);
    if (slide.genre) meta.push(`<span class="meta-chip">${escHtml(slide.genre)}</span>`);
    $('#hero-meta').innerHTML = meta.join('');
    bindHeroPlay(slide);
  };

  if (useFade) {
    content.classList.add('hero-fade');
    setTimeout(() => {
      paint();
      content.classList.remove('hero-fade');
    }, 280);
  } else {
    paint();
  }
}

function heroSlideDelay() {
  const slide = heroSlides[heroIndex];
  if (!heroBackgroundTrailerSupported()) return HERO_STATIC_MS;
  if (isMobileNativeApp()) {
    return slide?.trailer ? 90000 : 14000;
  }
  return slide?.trailer ? HERO_TRAILER_MS : HERO_STATIC_MS;
}

function scheduleNextHeroSlide() {
  if (heroSlideTimeout) clearTimeout(heroSlideTimeout);
  if (heroSlides.length <= 1) return;
  if (isMobileNativeApp() && document.querySelector('.hero-slide.active.has-trailer')) return;
  heroSlideTimeout = setTimeout(() => {
    goHeroSlide(nextRandomHeroIndex());
    scheduleNextHeroSlide();
  }, heroSlideDelay());
}

function startHeroSlider() {
  scheduleNextHeroSlide();
}

function initHeroSlider(slides) {
  stopHeroSlider();
  const pool = (slides || []).filter((s) => normalizeYoutubeKey(s.trailer));
  heroSlides = shuffleArray(pool.length ? pool : (slides || []));
  heroIndex = heroSlides.length ? Math.floor(Math.random() * heroSlides.length) : 0;

  const slidesEl = $('#hero-slides');
  const dotsEl = $('#hero-dots');

  if (!heroSlides.length) {
    slidesEl.innerHTML = '';
    dotsEl.innerHTML = '';
    $('#hero-title').textContent = 'Bienvenido a Vix TV';
    $('#hero-desc').textContent = 'Disfruta películas, series y TV en vivo';
    $('#hero-meta').innerHTML = '';
    return;
  }

  slidesEl.innerHTML = heroSlides.map((s, i) => {
    const bg = cssUrl(s.backdrop || s.poster);
    return `<div class="hero-slide${i === 0 ? ' active' : ''}" data-index="${i}">
      <div class="hero-slide-bg" style="background-image:url('${bg}')"></div>
      <div class="hero-slide-video"></div>
    </div>`;
  }).join('');

  dotsEl.innerHTML = heroSlides.map((_, i) =>
    `<button type="button" class="hero-dot tv-focusable${i === 0 ? ' active' : ''}" aria-label="Película ${i + 1}" tabindex="0"></button>`
  ).join('');

  $$('.hero-dot').forEach((dot, i) => {
    dot.addEventListener('click', () => {
      goHeroSlide(i);
      startHeroSlider();
    });
    dot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goHeroSlide(i);
        startHeroSlider();
      }
    });
  });

  heroSlides.forEach(s => {
    const img = new Image();
    img.src = s.backdrop || s.poster;
  });

  goHeroSlide(heroIndex, { instant: true });
  if (!document.querySelector('.hero-slide.active.has-trailer')) {
    startHeroSlider();
  }
}

/* HOME */
async function refreshWatchProgress() {
  continueWatchingCache = {};
  watchProgressMap = {};
  try {
    const [items, map] = await Promise.all([
      api('/watch/continue'),
      api('/watch/progress-map').catch(() => null)
    ]);
    items.forEach((item) => {
      continueWatchingCache[`${item.content_type}-${item.content_id}`] = item;
    });
    if (map) {
      Object.entries(map.movies || {}).forEach(([id, p]) => {
        watchProgressMap[`movie-${id}`] = { content_type: 'movie', content_id: parseInt(id, 10), ...p };
      });
      Object.entries(map.episodes || {}).forEach(([id, p]) => {
        watchProgressMap[`episode-${id}`] = { content_type: 'episode', content_id: parseInt(id, 10), ...p };
      });
      Object.entries(map.series || {}).forEach(([id, p]) => {
        watchProgressMap[`series-${id}`] = { content_type: 'series', content_id: parseInt(id, 10), ...p };
      });
      Object.entries(map.external_episodes || {}).forEach(([key, p]) => {
        watchProgressMap[`external-${key}`] = { content_type: 'external_episode', ...p };
        const epId = key.split(':').pop();
        if (epId) watchProgressMap[`episode-${epId}`] = { content_type: 'external_episode', ...p };
      });
      Object.entries(map.external_movies || {}).forEach(([key, p]) => {
        watchProgressMap[`external-movie-${key}`] = { content_type: 'external_movie', ...p };
      });
      Object.entries(map.external_series || {}).forEach(([key, p]) => {
        watchProgressMap[`external-series-${key}`] = { content_type: 'external_series', ...p };
      });
    } else {
      items.forEach((item) => {
        if (item.content_type === 'movie') watchProgressMap[`movie-${item.content_id}`] = item;
        if (item.content_type === 'episode') {
          watchProgressMap[`episode-${item.content_id}`] = item;
          if (item.series_id) watchProgressMap[`series-${item.series_id}`] = item;
        }
        if (item.external) {
          watchProgressMap[`${item.content_type}-${item.content_id}`] = item;
          if (item.content_type === 'external_episode') {
            watchProgressMap[`episode-ext-${item.season}x${item.episode}`] = item;
          }
        }
      });
    }
    return items;
  } catch {
    return [];
  }
}

function episodeProgressBarHtml(episodeId, progressMap) {
  const wh = progressMap?.[episodeId] || watchProgressMap[`episode-${episodeId}`];
  const pct = watchProgressPercent(wh);
  if (pct < 2) return '';
  return `<div class="episode-progress"><span style="width:${pct}%"></span></div>`;
}

async function loadContinueWatching() {
  try {
    const items = await refreshWatchProgress();
    const section = $('#row-continue-section');
    const row = $('#row-continue');
    if (!section || !row) return items;
    if (!items.length) {
      section.classList.add('hidden');
      row.innerHTML = '';
      return items;
    }
    section.classList.remove('hidden');
    row.innerHTML = items.map(continueCardHtml).join('');
    bindCardClicks('#row-continue');
    return items;
  } catch {
    $('#row-continue-section')?.classList.add('hidden');
    return [];
  }
}

const GENRE_ICONS = {
  'Acción': '🎯',
  'Aventura': '🧭',
  'Animación': '✨',
  'Comedia': '😂',
  'Crimen': '🔍',
  'Documental': '📽',
  'Drama': '🎭',
  'Familia': '👨‍👩‍👧',
  'Fantasía': '🐉',
  'Historia': '📜',
  'Terror': '👻',
  'Música': '🎵',
  'Misterio': '🕵',
  'Romance': '💕',
  'Ciencia ficción': '🚀',
  'Suspense': '⚡',
  'Western': '🤠',
  Kids: '👶',
  Reality: '📺',
  'Película de TV': '📡',
  'Sci-Fi & Fantasy': '🛸',
  'Action & Adventure': '💥',
  'Ciencia ficción y fantasía': '🛸',
  'Acción y aventura': '💥',
  Infantil: '👶'
};

function genreRowTitle(title, section = null) {
  if (section?.saga) {
    const icon = section.icon || '🎬';
    return `${icon} ${title}`;
  }
  const icon = GENRE_ICONS[title] || '🎬';
  return `${icon} ${title}`;
}

function catalogItemType(item, fallback = 'movie') {
  return item.content_type || fallback;
}

function renderCatalogSection(section) {
  if (section.type === 'label') {
    return `
      <section class="catalog-row catalog-row--label" data-section-id="${escHtml(section.id)}">
        <div class="catalog-row__header">
          <h2 class="catalog-row__title">${escHtml(section.title)}</h2>
        </div>
      </section>`;
  }

  const items = section.items || [];
  if (!items.length) return '';

  const cards = items.map((item) => {
    if (section.externalSource || item.external) return externalCardHtml(item);
    const type = catalogItemType(item, section.type === 'series' ? 'series' : 'movie');
    return cardHtml(item, type);
  }).join('');

  const HOME_MORE_IDS = new Set(['for-you', 'top-picks', 'trending', 'new-releases']);
  const itemsCount = items.length;
  const totalCount = section.total > 0 ? section.total : itemsCount;
  const showGenreMore = section.genre && section.type !== 'mixed' && !section.saga && !section.externalSource;
  const showSagaMore = section.saga && section.type !== 'mixed';
  const showSectionMore = HOME_MORE_IDS.has(section.id)
    || showSagaMore
    || (!showGenreMore && section.id && totalCount > itemsCount);
  const moreLabel = HOME_MORE_IDS.has(section.id) ? 'Ver más' : 'Ver todo';
  const moreBtn = showGenreMore
    ? `<button type="button" class="catalog-row__more tv-focusable" data-genre="${escHtml(section.genre)}" data-type="${escHtml(section.type)}">${moreLabel}</button>`
    : (showSectionMore
      ? `<button type="button" class="catalog-row__more tv-focusable" data-section-id="${escHtml(section.id)}" data-section-title="${escHtml(section.title)}" data-type="${escHtml(section.type)}"${section.saga ? ` data-saga="${escHtml(section.saga)}"` : ''}>${moreLabel}</button>`
      : '');

  const subtitle = section.subtitle
    ? `<span class="catalog-row__subtitle">${escHtml(section.subtitle)}</span>`
    : '';

  return `
    <section class="catalog-row" data-section-id="${escHtml(section.id)}" data-type="${escHtml(section.type)}"${section.genre ? ` data-genre="${escHtml(section.genre)}"` : ''}${section.saga ? ` data-saga="${escHtml(section.saga)}"` : ''}>
      <div class="catalog-row__header">
        <div>
          <h2 class="catalog-row__title">${escHtml(genreRowTitle(section.title, section))}</h2>
          ${subtitle}
        </div>
        ${moreBtn}
      </div>
      <div class="catalog-row__track carousel">${cards}</div>
    </section>`;
}

function renderCatalogPage(container, sections) {
  if (!container) return;
  if (!sections?.length) {
    container.innerHTML = '<p class="catalog-empty">No hay contenido en esta sección todavía.</p>';
    return;
  }
  container.innerHTML = sections.map(renderCatalogSection).join('');
  bindCardClicks(container);
  container.querySelectorAll('.catalog-row__more').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.catalog-row');
      const sectionId = (btn.dataset.sectionId || row?.dataset.sectionId || '').trim();
      const sectionTitle = (btn.dataset.sectionTitle || row?.querySelector('.catalog-row__title')?.textContent || '').trim();
      const type = btn.dataset.type || row?.dataset.type || 'movie';
      if (sectionId) {
        browseHomeSection(sectionId, sectionTitle, type);
        return;
      }
      const genre = (btn.dataset.genre || row?.dataset.genre || '').trim();
      if (!genre) {
        toast('No se pudo abrir esta sección', true);
        return;
      }
      browseCatalogGenre(genre, type);
    });
  });
}

let activeBrowse = null;
let homeCatalogSections = [];
let categoriesCatalogSections = [];

async function fetchCatalogBrowseItems(browse) {
  const type = browse.type || 'movie';
  if (browse.sectionId && browse.sectionId.includes('-genre-')) {
    return api(`/catalog/section/${encodeURIComponent(browse.sectionId)}`);
  }
  if (browse.externalSource && browse.browseMode !== 'external-genres') {
    const isSeries = browse.contentType === 'series';
    const q = `limit=2000&offset=0`;
    const path = isSeries
      ? `/catalog/external/${encodeURIComponent(browse.externalSource)}/series?${q}`
      : `/catalog/external/${encodeURIComponent(browse.externalSource)}?${q}`;
    const data = await apiCached(path);
    return Array.isArray(data) ? data : (data.items || []);
  }
  if (browse.sectionId) {
    return api(`/catalog/section/${encodeURIComponent(browse.sectionId)}`);
  }
  if (browse.saga) {
    const q = `saga=${encodeURIComponent(browse.saga)}&limit=500`;
    return api(`/movies/by-saga?${q}`);
  }
  if (browse.genre) {
    const q = `genre=${encodeURIComponent(browse.genre)}&limit=500`;
    return api(type === 'series' ? `/series/by-genre?${q}` : `/movies/by-genre?${q}`);
  }
  throw new Error('Sección no disponible');
}

function cleanBrowseTitle(title) {
  return String(title || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

async function loadBrowsePage() {
  const grid = $('#browse-grid');
  const titleEl = $('#browse-page-title');
  const countEl = $('#browse-page-count');
  const empty = $('#browse-empty');
  if (!grid || !activeBrowse) return;

  titleEl.textContent = cleanBrowseTitle(activeBrowse.title) || 'Sección';
  countEl.textContent = '';
  grid.innerHTML = '<p class="catalog-loading">Cargando…</p>';
  empty?.classList.add('hidden');

  if (activeBrowse.browseMode === 'external-genres' && activeBrowse.externalSource) {
    grid.className = 'catalog-page';
    try {
      const contentType = activeBrowse.contentType || (activeBrowse.type === 'series' ? 'series' : 'movie');
      const data = await apiCached(`/catalog/external/${encodeURIComponent(activeBrowse.externalSource)}/browse?content_type=${encodeURIComponent(contentType)}`);
      const sections = (data.sections || []).filter((s) => s.items?.length);
      if (!sections.length) {
        grid.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
      }
      const total = sections.reduce((n, s) => n + (s.total || s.items.length), 0);
      countEl.textContent = `${sections.length} categorías · ${total} títulos`;
      renderCatalogPage(grid, sections);
    } catch (err) {
      grid.innerHTML = `<p class="catalog-empty">${escHtml(err.message || 'Error al cargar')}</p>`;
      toast(err.message, true);
    }
    return;
  }

  grid.className = 'grid page-catalog-grid';

  try {
    await refreshWatchProgress();
    const items = await fetchCatalogBrowseItems(activeBrowse);
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      grid.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    countEl.textContent = `${list.length} títulos`;
    const type = activeBrowse.type || 'movie';
    grid.innerHTML = list.map((item) => {
      if (activeBrowse.externalSource || item.external) return externalCardHtml(item);
      const fallback = type === 'series' ? 'series' : (type === 'mixed' ? 'movie' : type);
      return cardHtml(item, catalogItemType(item, fallback));
    }).join('');
    bindCardClicks(grid);
  } catch (err) {
    grid.innerHTML = `<p class="catalog-empty">${escHtml(err.message || 'Error al cargar')}</p>`;
    toast(err.message, true);
  }
}

async function openBrowsePage(browse) {
  const needsMovies = browse.type !== 'series';
  const needsSeries = browse.type === 'series';
  if (needsMovies && !canAccess('movies')) {
    toast('No tienes acceso a películas', true);
    return;
  }
  if (needsSeries && !canAccess('series')) {
    toast('No tienes acceso a series', true);
    return;
  }
  activeBrowse = browse;
  stopHeroSlider();
  showPage('browse');
  syncAppRoute('browse', {
    sectionId: browse.sectionId,
    genre: browse.genre,
    type: browse.type,
    title: browse.title,
    back: browse.backPage
  });
  await loadBrowsePage();
}

function closeBrowsePage() {
  const back = activeBrowse?.backPage || 'home';
  activeBrowse = null;
  navigateToPage(back, { replaceRoute: true });
}

async function browseHomeSection(sectionId, title, type) {
  const sid = String(sectionId || '').trim();
  if (!sid) {
    toast('Sección no disponible', true);
    return;
  }
  const cached = homeCatalogSections.find((s) => s.id === sid);
  const extMatch = sid.match(/^external-(allcalidad|cuevana|cinecalidad)(?:-series)?/);
  const externalSource = extMatch ? extMatch[1] : null;
  const contentType = (sid.includes('-series-genre-') || /^external-(allcalidad|cuevana|cinecalidad)-series$/.test(sid))
    ? 'series' : 'movie';
  const isExternalMainBrowse = /^external-(allcalidad|cuevana|cinecalidad)(-series)?$/.test(sid);
  const backPage = $('#page-explorar')?.classList.contains('active') ? 'explorar'
    : ($('#page-series')?.classList.contains('active') ? 'series' : 'home');
  await openBrowsePage({
    sectionId: sid,
    externalSource,
    contentType,
    browseMode: isExternalMainBrowse ? 'external-genres' : 'default',
    genre: null,
    title: cleanBrowseTitle(title) || cached?.title || HOME_SECTION_TITLES[sid] || sid,
    type: type || cached?.type || 'movie',
    backPage
  });
}

async function browseCatalogGenre(genre, type) {
  const g = String(genre || '').trim();
  if (!g) {
    toast('Categoría no disponible', true);
    return;
  }
  const backPage = $('#page-categories')?.classList.contains('active') ? 'categories' : 'home';
  await openBrowsePage({
    sectionId: null,
    genre: g,
    title: g,
    type: type || 'movie',
    backPage
  });
}

function genreRowsToSections(rows, contentType) {
  return (rows || []).map((row) => ({
    id: `${contentType}-${row.genre}`,
    title: row.genre,
    subtitle: contentType === 'series' ? 'Series' : 'Películas',
    type: contentType,
    genre: row.genre,
    items: contentType === 'series' ? row.series : row.movies,
    total: row.count || (contentType === 'series' ? row.series?.length : row.movies?.length) || 0
  }));
}

async function loadMoviesCatalog() {
  const container = $('#movies-catalog-rows');
  try {
    const rows = await api('/catalog/movies');
    renderCatalogPage(container, genreRowsToSections(rows, 'movie'));
  } catch {
    if (container) container.innerHTML = '';
  }
}

async function loadSeriesCatalog() {
  const container = $('#series-catalog-rows');
  try {
    const rows = await api('/catalog/series');
    renderCatalogPage(container, genreRowsToSections(rows, 'series'));
  } catch {
    if (container) container.innerHTML = '';
  }
}

async function loadCategories() {
  const container = $('#categories-catalog-rows');
  if (!container) return;
  container.innerHTML = '<p class="catalog-loading">Cargando categorías…</p>';
  try {
    await refreshWatchProgress();
    const catalog = await api('/catalog/categories');
    categoriesCatalogSections = catalog.sections || [];
    renderCatalogPage(container, categoriesCatalogSections);
  } catch (err) {
    container.innerHTML = '';
    toast(err.message, true);
  }
}

async function pollNotifications() {
  try {
    const rows = await api('/notifications');
    const unread = (rows || []).filter((n) => !n.read);
    if (unread.length) {
      const n = unread[0];
      toast(`📢 ${n.title}${n.body ? ': ' + n.body : ''}`, false);
      api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => null);
    }
  } catch { /* opcional */ }
}

async function loadHome() {
  try {
    stopHeroSlider();
    pollNotifications();
    const rowsEl = $('#home-catalog-rows');

    api('/movies/hero')
      .then((slides) => initHeroSlider(slides))
      .catch(() => initHeroSlider([]));

    const catalogP = api('/catalog/home');
    const continueP = refreshWatchProgress().then(() => loadContinueWatching());

    const catalog = await catalogP;
    homeCatalogSections = catalog.sections || [];
    renderCatalogPage(rowsEl, homeCatalogSections);
    await continueP;
  } catch (err) {
    toast(err.message, true);
  }
}

let carouselDrag = null;
let carouselSuppressTarget = null;

function initCarouselDragScroll() {
  if (window.__carouselDragBound) return;
  window.__carouselDragBound = true;

  const dragThreshold = 10;

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const track = e.target.closest('.carousel, .catalog-row__track');
    if (!track) return;
    if (e.target.closest('button, a, input, .library-action-btn, .card-action-btn')) return;
    carouselDrag = {
      el: track,
      startX: e.clientX,
      startY: e.clientY,
      startScroll: track.scrollLeft,
      pointerId: e.pointerId,
      active: false
    };
  });

  document.addEventListener('pointermove', (e) => {
    if (!carouselDrag || e.pointerId !== carouselDrag.pointerId) return;
    const dx = e.clientX - carouselDrag.startX;
    const dy = e.clientY - carouselDrag.startY;
    if (!carouselDrag.active) {
      if (Math.abs(dx) < dragThreshold && Math.abs(dy) < dragThreshold) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        carouselDrag = null;
        return;
      }
      carouselDrag.active = true;
      carouselDrag.el.classList.add('is-dragging');
      try { carouselDrag.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    carouselDrag.el.scrollLeft = carouselDrag.startScroll - dx;
    e.preventDefault();
  });

  const endCarouselDrag = (e) => {
    if (!carouselDrag || e.pointerId !== carouselDrag.pointerId) return;
    const { el, active } = carouselDrag;
    el.classList.remove('is-dragging');
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (active) carouselSuppressTarget = el;
    carouselDrag = null;
  };

  document.addEventListener('pointerup', endCarouselDrag);
  document.addEventListener('pointercancel', endCarouselDrag);

  document.addEventListener('click', (e) => {
    if (!carouselSuppressTarget) return;
    if (carouselSuppressTarget.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
    carouselSuppressTarget = null;
  }, true);
}

function bindCardDelegation() {
  const main = $('#main-content');
  if (!main || main.dataset.cardsBound) return;
  main.dataset.cardsBound = '1';
  initCarouselDragScroll();

  async function handleCard(card) {
    if (isExternalCard(card)) {
      if (card.dataset.type === 'series') {
        showExternalSeriesDetail(card.dataset.source, card.dataset.slug);
      } else {
        showExternalMovieDetail(card.dataset.source, card.dataset.slug, card.dataset.year);
      }
      return;
    }
    if (!card?.dataset?.id && card?.dataset?.resume !== '1') return;
    if (card.dataset.resume === '1') {
      try {
        if (card.dataset.external === '1') {
          await resumeExternalWatching(card.dataset);
        } else {
          await resumeWatching(card.dataset.type, card.dataset.id);
        }
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const type = card.dataset.type || 'movie';
    const id = card.dataset.id;
    if (type === 'series') showSeriesDetail(id);
    else showMovieDetail(id);
  }

  main.addEventListener('click', async (e) => {
    const libBtn = e.target.closest('.library-action-btn');
    if (libBtn?.dataset?.action) {
      e.preventDefault();
      e.stopPropagation();
      const listType = libBtn.dataset.action === 'watchlist' ? 'watchlist' : 'like';
      try {
        if (libBtn.dataset.external === '1') {
          const detail = movieDetailState?._external ? movieDetailState : seriesDetailState?.data;
          await toggleLibrary(libBtn.dataset.type, libBtn.dataset.id, listType, {
            external: true,
            source: libBtn.dataset.source || detail?.source,
            slug: libBtn.dataset.slug || detail?.slug,
            title: detail?.title || '',
            poster: detail?.poster || '',
            year: detail?.year || null
          });
        } else {
          await toggleLibrary(libBtn.dataset.type, parseInt(libBtn.dataset.id, 10), listType);
        }
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const card = e.target.closest('.card');
    if (!card || (!card.dataset.id && card.dataset.resume !== '1' && !isExternalCard(card))) return;
    handleCard(card);
  });

  main.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (!card || (!card.dataset.id && card.dataset.resume !== '1' && !isExternalCard(card))) return;
    e.preventDefault();
    handleCard(card);
  });
}

function bindCardClicks(root) {
  if (!root) return;
  const cards = typeof root === 'string'
    ? document.querySelectorAll(`${root} .card`)
    : root.querySelectorAll('.card');
  cards.forEach((card) => {
    if (card.dataset.bound) return;
    card.dataset.bound = '1';
    card.style.cursor = 'pointer';
  });
}

function bindCategoriesLinks() {
  ['[data-goto-categories-movies]', '[data-goto-categories-series]'].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', () => navigateToPage('categories'));
  });
}

function renderStorefrontHero(slug, hero, recent) {
  const wrap = document.querySelector(`[data-sf-hero="${slug}"]`);
  if (!wrap) return;
  if (!isTvMode()) {
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const slides = Array.isArray(hero) ? hero : [];
  const tiles = Array.isArray(recent) ? recent.slice(0, 4) : [];
  if (!slides.length) {
    wrap.innerHTML = '';
    return;
  }
  const rotating = slides.slice(1);
  const fixed = slides[0];
  const rot = rotating.length ? rotating[0] : fixed;
  const openItem = (item) => {
    if (!item?.id) return;
    const type = item.content_type || 'movie';
    if (type === 'series') showSeriesDetail(item.id, slug);
    else showMovieDetail(item.id, slug);
  };
  const img = (item) => {
    const src = posterUrl(item && (item.backdrop || item.poster), item);
    return escAttr(src || '/api/posters/cover?title=Vix');
  };
  const fallbackImg = "this.onerror=null;this.src='/api/posters/cover?title=Vix'";
  wrap.innerHTML = `<div class="sf-hero-grid">
    <div class="sf-hero-top-left tv-focusable" tabindex="0" data-sf-main="rotate">
      <img class="sf-hero-img" src="${img(rot)}" alt="" onerror="${fallbackImg}">
      <div class="sf-hero-dots">${slides.map((_, i) => `<span class="sf-hero-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
    </div>
    <div class="sf-hero-top-right tv-focusable" tabindex="0" data-sf-main="fixed">
      <img class="sf-hero-img" src="${img(fixed)}" alt="" onerror="${fallbackImg}">
    </div>
    <div class="sf-hero-bottom">
      ${[0, 1, 2, 3].map((i) => {
        const t = tiles[i] || slides[(i + 2) % slides.length];
        return `<div class="sf-hero-tile tv-focusable" tabindex="0" data-sf-tile="${i}">
          <img class="sf-hero-img" src="${img(t)}" alt="" onerror="${fallbackImg}">
        </div>`;
      }).join('')}
    </div>
  </div>`;
  const rotEl = wrap.querySelector('[data-sf-main="rotate"]');
  const fixEl = wrap.querySelector('[data-sf-main="fixed"]');
  rotEl?.addEventListener('click', () => openItem(rot));
  fixEl?.addEventListener('click', () => openItem(fixed));
  wrap.querySelectorAll('[data-sf-tile]').forEach((el) => {
    const idx = parseInt(el.dataset.sfTile, 10);
    const t = tiles[idx] || slides[(idx + 2) % slides.length];
    el.addEventListener('click', () => openItem(t));
  });
}

function renderPlatformGrid(container, platforms) {
  if (!container) return;
  if (!isTvMode()) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  const list = (Array.isArray(platforms) ? platforms : []).filter((p) => (p.total || 0) > 0);
  if (!list.length) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = list.map((p) => `
    <button type="button" class="platform-card tv-focusable" data-platform-id="${escAttr(p.id)}"
      style="background:linear-gradient(145deg, ${escAttr(p.color || '#333')}, #111)"
      tabindex="0">
      ${escHtml(p.title)}
      <small>${p.total || 0} títulos</small>
    </button>
  `).join('');
  container.querySelectorAll('.platform-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.platformId;
      openBrowsePage({
        sectionId: `platform-${id}`,
        title: btn.textContent.trim().split('\n')[0],
        type: 'mixed',
        back: 'explorar'
      });
    });
  });
}

async function loadStorefront(slug) {
  const cfg = STOREFRONT_CONFIG[slug];
  if (!cfg) return;
  if (slug === 'explorar') prefetchExternalCatalogs();
  const rowsEl = $(`#${cfg.rowsId}`);
  const emptyEl = cfg.emptyId ? $(`#${cfg.emptyId}`) : null;
  if (rowsEl) rowsEl.innerHTML = '<p class="catalog-loading">Cargando…</p>';
  emptyEl?.classList.add('hidden');
  try {
    await refreshWatchProgress();
    let page;
    try {
      page = await api(`/catalog/storefront/${encodeURIComponent(slug)}`);
    } catch {
      page = await buildStorefrontFallback(slug);
    }
    if (!page.hero || !page.hero.length) {
      if (slug === 'movies' || slug === 'destacados') {
        page.hero = await api('/movies/hero').catch(() => []);
        page.recent = page.recent || await api('/movies/recent').catch(() => []);
      } else if (slug === 'series') {
        page.hero = await api('/series/hero').catch(() => []);
      }
    }
    if (!page.sections || !page.sections.length) {
      page = await buildStorefrontFallback(slug);
    }
    renderStorefrontHero(slug, page.hero || [], page.recent || []);
    if (cfg.platformsId) renderPlatformGrid($(`#${cfg.platformsId}`), page.platforms);
    const sections = (page.sections || []).map((sec) => ({
      ...sec,
      items: sec.items || [],
      total: sec.total || (sec.items && sec.items.length) || 0
    })).filter((sec) => sec.items && sec.items.length);
    if (!sections.length) {
      if (rowsEl) rowsEl.innerHTML = '';
      emptyEl?.classList.remove('hidden');
      return;
    }
    emptyEl?.classList.add('hidden');
    renderCatalogPage(rowsEl, sections);
  } catch (err) {
    if (rowsEl) rowsEl.innerHTML = '';
    emptyEl?.classList.remove('hidden');
    toast(err.message, true);
  }
}

/* MOVIES (alias) */
async function loadMovies() {
  return loadStorefront('movies');
}

let movieDetailBackPage = 'movies';
let movieDetailState = null;
let externalPlaySession = null;
let externalStreamRefreshTimer = null;
let externalPlayPrefetch = null;
let playerQualityPref = '1080';
let playerQualityChanging = false;
const PLAYBACK_QUALITY_KEY = 'vix_playback_quality';
const SUBTITLE_PREF_KEY = 'vix_subtitles_enabled';
let playerSubtitlesEnabled = localStorage.getItem(SUBTITLE_PREF_KEY) === '1';

function getPlaybackQualityPref() {
  const v = localStorage.getItem(PLAYBACK_QUALITY_KEY);
  return ['auto', 'max', '1080', '720', '480'].includes(v) ? v : '1080';
}

function serverQualityFromPref(pref) {
  if (pref === 'auto') return '1080';
  return pref === 'max' ? '1080' : pref;
}

function qualityHeightFromValue(value, hls = hlsInstance) {
  if (value === 'auto') return 0;
  if (value === 'max') {
    const levels = hls?.levels || [];
    return levels.length ? Math.max(...levels.map((l) => l.height || 0)) : 1080;
  }
  return parseInt(value, 10) || 0;
}

function pickDefaultPlaybackQuality(maxHeight = 0, hls = hlsInstance) {
  const pref = getPlaybackQualityPref();
  const heights = (hls?.levels || []).map((l) => l.height || 0).filter(Boolean).sort((a, b) => b - a);
  const maxH = heights[0] || maxHeight || 0;
  const tryPref = (val) => {
    const h = qualityHeightFromValue(val, hls);
    if (!h) return val === 'auto' ? 'auto' : null;
    if (heights.length && pickHlsLevelForHeight(hls, h) >= 0) return val;
    if (!heights.length && maxH >= h) return val;
    return null;
  };
  const saved = tryPref(pref);
  if (saved) return saved;
  if (maxH >= 1080 || tryPref('1080')) return '1080';
  if (maxH >= 720 || tryPref('720')) return '720';
  if (maxH >= 480 || tryPref('480')) return '480';
  return heights.length > 1 ? 'auto' : String(maxH || 'auto');
}

function qualityLabelFromValue(value, maxHeight = 0) {
  if (value === 'auto') return 'Auto';
  if (value === 'max') return maxHeight >= 1080 ? '1080p' : maxHeight >= 720 ? '720p' : 'Máx';
  if (value === '1080') return '1080p';
  if (value === '720') return '720p';
  if (value === '480') return '480p';
  const n = parseInt(value, 10);
  if (n >= 1080) return '1080p';
  if (n >= 720) return '720p';
  if (n >= 480) return '480p';
  return n ? `${n}p` : String(value);
}

function resetPlayerQualityUi() {
  playerQualityPref = getPlaybackQualityPref();
  $('#player-quality-menu')?.classList.add('hidden');
  $('#player-quality-wrap')?.classList.add('hidden');
  updatePlayerQualityButton(qualityLabelFromValue(playerQualityPref));
  refreshSubtitleButton();
}

function setPlayerQualityVisible(show) {
  $('#player-quality-wrap')?.classList.toggle('hidden', !show);
}

function updatePlayerQualityButton(label) {
  const labelEl = $('#player-quality-label');
  if (labelEl) labelEl.textContent = label || qualityLabelFromValue(playerQualityPref);
}

function updateQualityMenuActive(activeValue) {
  $('#player-quality-options')?.querySelectorAll('.player-quality-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.quality === String(activeValue));
  });
}

function renderPlayerQualityMenu(options, activeValue) {
  const menu = $('#player-quality-menu');
  const body = $('#player-quality-options');
  if (!menu || !body) return;
  const list = Array.isArray(options) && options.length
    ? options
    : [
      { value: 'auto', label: 'Automática' },
      { value: '1080', label: '1080p · Full HD' },
      { value: '720', label: '720p · HD' },
      { value: '480', label: '480p · SD' }
    ];
  body.innerHTML = list.map((opt) => {
    const val = String(opt.value || opt);
    const label = opt.label || qualityLabelFromValue(val);
    const active = val === String(activeValue) ? ' active' : '';
    return `<button type="button" class="player-quality-option${active}" data-quality="${escAttr(val)}" role="menuitemradio" aria-checked="${val === String(activeValue)}">
      <span>${escHtml(label)}</span><span class="pq-check" aria-hidden="true">✓</span>
    </button>`;
  }).join('');
  body.querySelectorAll('.player-quality-option').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      changePlaybackQuality(btn.dataset.quality);
      menu.classList.add('hidden');
    });
  });
  setPlayerQualityVisible(true);
  updatePlayerQualityButton(qualityLabelFromValue(activeValue));
}

const SPANISH_TRACK_RE = /español|espanol|latino|castellano|spanish|\bes\b|\bspa\b/i;
const ENGLISH_TRACK_RE = /english|ingl[eé]s|\ben\b|\beng\b/i;

function trackLabel(track) {
  return `${track?.name || ''} ${track?.lang || ''} ${track?.language || ''}`;
}

function isSpanishTrack(track) {
  const label = trackLabel(track);
  return SPANISH_TRACK_RE.test(label) && !ENGLISH_TRACK_RE.test(label);
}

function isEnglishTrack(track) {
  return ENGLISH_TRACK_RE.test(trackLabel(track));
}

function findSpanishAudioTrackIndex(hls) {
  if (!hls?.audioTracks?.length) return -1;
  let pick = hls.audioTracks.findIndex((t) => isSpanishTrack(t));
  if (pick < 0) pick = hls.audioTracks.findIndex((t) => !isEnglishTrack(t));
  return pick;
}

function findSpanishSubtitleTrackIndex(hls) {
  if (!hls?.subtitleTracks?.length) return -1;
  return hls.subtitleTracks.findIndex((t) => isSpanishTrack(t));
}

function preferSpanishLatinoHlsTracks(hls) {
  if (!hls || playerLiveMode) return;
  const audioIdx = findSpanishAudioTrackIndex(hls);
  if (audioIdx >= 0 && hls.audioTrack !== audioIdx) hls.audioTrack = audioIdx;
  const subIdx = findSpanishSubtitleTrackIndex(hls);
  if (subIdx >= 0 && playerSubtitlesEnabled) {
    hls.subtitleTrack = subIdx;
  } else if (externalPlaySession) {
    hls.subtitleTrack = -1;
  }
}

function hasSubtitleTracksAvailable() {
  const video = $('#video-player');
  if (externalPlaySession) {
    return findSpanishSubtitleTrackIndex(hlsInstance) >= 0;
  }
  if (hlsInstance?.subtitleTracks?.length) return true;
  if (video?.textTracks?.length) {
    for (let i = 0; i < video.textTracks.length; i++) {
      const kind = video.textTracks[i].kind;
      if (kind === 'subtitles' || kind === 'captions') return true;
    }
  }
  return false;
}

function refreshSubtitleButton() {
  const wrap = $('#player-subtitle-wrap');
  const btn = $('#player-subtitle-btn');
  const available = hasSubtitleTracksAvailable();
  wrap?.classList.toggle('hidden', !available || playerLiveMode);
  if (!btn) return;
  btn.classList.toggle('active', playerSubtitlesEnabled && available);
  btn.setAttribute('aria-pressed', playerSubtitlesEnabled && available ? 'true' : 'false');
}

function applySubtitlePreference() {
  const video = $('#video-player');
  if (hlsInstance?.subtitleTracks?.length) {
    if (externalPlaySession) {
      const subIdx = findSpanishSubtitleTrackIndex(hlsInstance);
      hlsInstance.subtitleTrack = playerSubtitlesEnabled && subIdx >= 0 ? subIdx : -1;
      return;
    }
    hlsInstance.subtitleTrack = playerSubtitlesEnabled ? (hlsInstance.subtitleTrack >= 0 ? hlsInstance.subtitleTrack : 0) : -1;
    return;
  }
  if (!video?.textTracks) return;
  for (let i = 0; i < video.textTracks.length; i++) {
    const t = video.textTracks[i];
    if (t.kind === 'subtitles' || t.kind === 'captions') {
      t.mode = playerSubtitlesEnabled ? 'showing' : 'hidden';
    }
  }
}

function togglePlayerSubtitles() {
  if (!hasSubtitleTracksAvailable()) return;
  playerSubtitlesEnabled = !playerSubtitlesEnabled;
  localStorage.setItem(SUBTITLE_PREF_KEY, playerSubtitlesEnabled ? '1' : '0');
  applySubtitlePreference();
  refreshSubtitleButton();
}

function onHlsManifestReady(hls, maxHeight = 0) {
  if (!hls?.levels?.length || playerLiveMode) return;
  preferSpanishLatinoHlsTracks(hls);
  syncPlayerQualityFromHls(hls);
  const defaultQ = pickDefaultPlaybackQuality(maxHeight || externalPlaySession?.maxHeight || 0, hls);
  playerQualityPref = defaultQ;
  applyHlsQualityPref(hls, defaultQ);
  updateQualityMenuActive(defaultQ);
  if (externalPlaySession?.availableQualities?.length) {
    syncExternalQualityMenu(hls, externalPlaySession);
    updateQualityMenuActive(playerQualityPref);
  }
  if (hls.subtitleTracks?.length) {
    preferSpanishLatinoHlsTracks(hls);
  }
  refreshSubtitleButton();
  applySubtitlePreference();
}

function pickHlsLevelForHeight(hls, targetHeight) {
  if (!hls?.levels?.length || !targetHeight) return -1;
  let best = -1;
  let bestDiff = Infinity;
  hls.levels.forEach((level, index) => {
    const h = level.height || 0;
    if (!h) return;
    const diff = Math.abs(h - targetHeight);
    if (h >= targetHeight - 40 && diff < bestDiff) {
      bestDiff = diff;
      best = index;
    }
  });
  if (best >= 0) return best;
  let closest = -1;
  let closestDiff = Infinity;
  hls.levels.forEach((level, index) => {
    const h = level.height || 0;
    if (!h) return;
    const diff = Math.abs(h - targetHeight);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = index;
    }
  });
  return closest;
}

function syncPlayerQualityFromHls(hls) {
  if (!hls?.levels?.length || playerLiveMode) return;
  if (externalPlaySession?.availableQualities?.length) {
    syncExternalQualityMenu(hls, externalPlaySession);
    return;
  }
  const byHeight = new Map();
  hls.levels.forEach((level, index) => {
    const h = level.height || 0;
    if (!h) return;
    const prev = byHeight.get(h);
    if (!prev || (level.bitrate || 0) > (hls.levels[prev]?.bitrate || 0)) {
      byHeight.set(h, index);
    }
  });
  const heights = [...byHeight.keys()].sort((a, b) => b - a);
  if (heights.length < 1) return;
  const options = heights.length > 1 ? [{ value: 'auto', label: 'Automática' }] : [];
  heights.forEach((h) => {
    const val = h >= 1080 ? '1080' : h >= 720 ? '720' : h >= 480 ? '480' : String(h);
    const label = h >= 1080 ? '1080p · Full HD' : h >= 720 ? '720p · HD' : h >= 480 ? '480p · SD' : `${h}p`;
    options.push({ value: val, label });
  });
  renderPlayerQualityMenu(options, playerQualityPref);
}

function syncExternalQualityMenu(hls, session = externalPlaySession) {
  const serverOpts = session?.availableQualities || [];
  const hlsHeights = (hls?.levels || []).map((l) => l.height || 0).filter(Boolean);
  const maxH = session?.maxHeight || 0;
  if (!serverOpts.length) {
    if (hls?.levels?.length) {
      const byHeight = new Map();
      hls.levels.forEach((level, index) => {
        const h = level.height || 0;
        if (!h) return;
        const prev = byHeight.get(h);
        if (!prev || (level.bitrate || 0) > (hls.levels[prev]?.bitrate || 0)) byHeight.set(h, index);
      });
      const heights = [...byHeight.keys()].sort((a, b) => b - a);
      const options = heights.length > 1 ? [{ value: 'auto', label: 'Automática' }] : [];
      heights.forEach((h) => {
        const val = h >= 1080 ? '1080' : h >= 720 ? '720' : h >= 480 ? '480' : String(h);
        const label = h >= 1080 ? '1080p · Full HD' : h >= 720 ? '720p · HD' : h >= 480 ? '480p · SD' : `${h}p`;
        options.push({ value: val, label });
      });
      renderPlayerQualityMenu(options, playerQualityPref);
    }
    return;
  }

  const options = hlsHeights.length > 1 ? [{ value: 'auto', label: 'Automática' }] : [];
  const seen = new Set(options.map((o) => o.value));
  serverOpts.forEach((opt) => {
    const val = String(opt.value || '');
    if (!val || seen.has(val)) return;
    const h = val === 'max' ? maxH : val === '1080' ? 1080 : val === '720' ? 720 : val === '480' ? 480 : parseInt(val, 10) || 0;
    if (h && maxH && h > maxH + 40) return;
    seen.add(val);
    options.push({ value: val, label: opt.label || qualityLabelFromValue(val, maxH) });
  });
  renderPlayerQualityMenu(options, playerQualityPref);
}

function hlsHasQualityLevel(hls, targetHeight) {
  if (!hls?.levels?.length || !targetHeight) return false;
  return hls.levels.some((level) => {
    const h = level.height || 0;
    return h && Math.abs(h - targetHeight) < 80;
  });
}

function applyHlsQualityPref(hls, pref) {
  if (!hls?.levels?.length) return false;
  if (pref === 'auto') {
    hls.currentLevel = -1;
    updatePlayerQualityButton('Auto');
    return true;
  }
  const target = pref === 'max' ? Math.max(...hls.levels.map((l) => l.height || 0)) : parseInt(pref, 10);
  const level = pickHlsLevelForHeight(hls, target);
  if (level < 0) return false;
  hls.currentLevel = level;
  const h = hls.levels[level]?.height || target;
  updatePlayerQualityButton(h >= 1080 ? '1080p' : h >= 720 ? '720p' : h >= 480 ? '480p' : `${h}p`);
  return true;
}

async function fetchExternalPlay(source, slug, year, pref = playerQualityPref) {
  const q = new URLSearchParams();
  if (year) q.set('year', String(year));
  q.set('quality', serverQualityFromPref(pref));
  return api(`/catalog/external/${encodeURIComponent(source)}/${encodeURIComponent(slug)}/play?${q}`);
}

function externalPlayPrefetchKey(source, slug, season = null, episode = null) {
  if (season != null && episode != null) return `${source}:${slug}:s${season}e${episode}`;
  return `${source}:${slug}`;
}

function takeExternalPlayPrefetch(source, slug, season = null, episode = null) {
  const key = externalPlayPrefetchKey(source, slug, season, episode);
  if (!externalPlayPrefetch || externalPlayPrefetch.key !== key) return null;
  if (Date.now() - externalPlayPrefetch.at > 120000) {
    externalPlayPrefetch = null;
    return null;
  }
  const data = externalPlayPrefetch.data;
  externalPlayPrefetch = null;
  return data;
}

function prefetchExternalPlay(source, slug, year) {
  const key = externalPlayPrefetchKey(source, slug);
  const pref = getPlaybackQualityPref();
  fetchExternalPlay(source, slug, year, pref)
    .then((data) => { externalPlayPrefetch = { key, at: Date.now(), data }; })
    .catch(() => {});
}

function prefetchExternalEpisodePlay(source, slug, season, episode) {
  const key = externalPlayPrefetchKey(source, slug, season, episode);
  const pref = getPlaybackQualityPref();
  const q = new URLSearchParams({
    season: String(season),
    episode: String(episode),
    quality: serverQualityFromPref(pref)
  });
  api(`/catalog/external/${encodeURIComponent(source)}/series/${encodeURIComponent(slug)}/play?${q}`)
    .then((data) => { externalPlayPrefetch = { key, at: Date.now(), data }; })
    .catch(() => {});
}

async function changePlaybackQuality(value) {
  if (!value || playerQualityChanging || playerLiveMode) return;
  playerQualityPref = value;
  localStorage.setItem(PLAYBACK_QUALITY_KEY, value);
  updateQualityMenuActive(value);

  const video = $('#video-player');
  const pos = video?.currentTime || 0;

  if (value === 'auto' && hlsInstance?.levels?.length) {
    hlsInstance.currentLevel = -1;
    updatePlayerQualityButton('Auto');
    if (externalPlaySession) externalPlaySession.quality = value;
    return;
  }

  const targetHeight = qualityHeightFromValue(value, hlsInstance);

  if (externalPlaySession && targetHeight && hlsInstance?.levels?.length && hlsHasQualityLevel(hlsInstance, targetHeight)) {
    const level = pickHlsLevelForHeight(hlsInstance, targetHeight);
    if (level >= 0) {
      hlsInstance.currentLevel = level;
      const h = hlsInstance.levels[level]?.height || targetHeight;
      updatePlayerQualityButton(qualityLabelFromValue(String(h >= 1080 ? '1080' : h >= 720 ? '720' : h >= 480 ? '480' : h)));
      externalPlaySession.quality = value;
      updateQualityMenuActive(value);
      return;
    }
  }

  if (!externalPlaySession && hlsInstance?.levels?.length && targetHeight) {
    const level = pickHlsLevelForHeight(hlsInstance, targetHeight);
    if (level >= 0) {
      hlsInstance.currentLevel = level;
      const h = hlsInstance.levels[level]?.height || targetHeight;
      updatePlayerQualityButton(qualityLabelFromValue(String(h >= 1080 ? '1080' : h >= 720 ? '720' : h >= 480 ? '480' : h)));
      return;
    }
    if (applyHlsQualityPref(hlsInstance, value)) return;
    return;
  }

  if (!externalPlaySession) return;

  const maxH = externalPlaySession.maxHeight || 0;
  if (targetHeight && maxH && targetHeight > maxH) {
    toast(`Este título solo está disponible hasta ${qualityLabelFromValue(String(maxH >= 1080 ? '1080' : maxH >= 720 ? '720' : '480'))}`, true);
    return;
  }

  playerQualityChanging = true;
  const wrap = $('#player-video-wrap');
  wrap?.classList.add('player-video-loading', 'player-loading-vod', 'player-loading-external');
  try {
    const { source, slug, year, season, episode, _series } = externalPlaySession;
    let data;
    if (_series) {
      const q = new URLSearchParams({
        season: String(season),
        episode: String(episode),
        quality: serverQualityFromPref(value)
      });
      data = await api(`/catalog/external/${encodeURIComponent(source)}/series/${encodeURIComponent(slug)}/play?${q}`);
    } else {
      data = await fetchExternalPlay(source, slug, year, value);
    }
    const playPath = appendStreamSession(data.proxied || data.url);
    if (!playPath) throw new Error('Stream no disponible');
    externalPlaySession.referer = data.referer;
    externalPlaySession.refreshSec = data.refreshSec || 240;
    externalPlaySession.quality = value;
    externalPlaySession.maxHeight = data.maxHeight || 0;
    externalPlaySession.availableQualities = data.available_qualities || externalPlaySession.availableQualities || [];
    if (hlsInstance && /\.m3u8|\/api\/live\/stream/i.test(playPath)) {
      await new Promise((resolve, reject) => {
        hlsInstance.loadSource(playPath);
        hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => {
          if (pos > 5 && video) video.currentTime = pos;
          onHlsManifestReady(hlsInstance, data.maxHeight || 0);
          video?.play().catch(() => {});
          clearPlayerLoading();
          resolve();
        });
        hlsInstance.once(Hls.Events.ERROR, (_, err) => {
          if (err?.fatal) reject(new Error('No se pudo cambiar la calidad'));
        });
      });
    } else {
      setupVideoPlayer(video, playPath, 0, pos, false);
      updatePlayerQualityButton(qualityLabelFromValue(value, data.maxHeight || 0));
    }
  } catch (err) {
    toast(err.message || 'No se pudo cambiar la calidad', true);
    clearPlayerLoading();
  } finally {
    playerQualityChanging = false;
  }
}

async function startExternalPlayback(data, title, pref = playerQualityPref, startTime = 0) {
  const playPath = appendStreamSession(data.proxied || data.url);
  if (!playPath) throw new Error('Stream no disponible');
  const defaultQ = pickDefaultPlaybackQuality(data.maxHeight || 0);
  playerQualityPref = defaultQ;
  externalPlaySession = {
    ...externalPlaySession,
    referer: data.referer,
    refreshSec: data.refreshSec || 240,
    quality: defaultQ,
    maxHeight: data.maxHeight || 0,
    availableQualities: data.available_qualities || []
  };
  playerWatchMeta = { external: true, ...externalPlaySession, title };
  setPlayerQualityVisible(true);
  if (externalPlaySession.availableQualities?.length) {
    syncExternalQualityMenu(hlsInstance, externalPlaySession);
  }
  updatePlayerQualityButton(qualityLabelFromValue(defaultQ, data.maxHeight || 0));
  lastSavedProgress = startTime || 0;
  watchSaveThrottle = 0;
  $('#live-player-info')?.classList.add('hidden');
  setupVideoPlayer($('#video-player'), playPath, 0, startTime, false);
  sendActivityHeartbeat();
  startExternalStreamRefresh(externalPlaySession.refreshSec);
}

const EXTERNAL_SOURCE_LABELS = {
  allcalidad: 'AllCalidad',
  cinecalidad: 'Cinecalidad',
  cuevana: 'Cuevana'
};

function clearExternalStreamRefresh() {
  if (externalStreamRefreshTimer) {
    clearInterval(externalStreamRefreshTimer);
    externalStreamRefreshTimer = null;
  }
}

function externalDetailBackPage() {
  if ($('#page-explorar')?.classList.contains('active')) return 'explorar';
  if ($('#page-browse')?.classList.contains('active')) return 'browse';
  return 'home';
}

function formatDisplayTitle(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return raw.replace(/\b([a-záéíóúñü])([a-záéíóúñü]*)/gi, (m, first, rest) => first.toUpperCase() + rest);
}

function slugToDisplayTitle(slug) {
  const cleaned = String(slug || '')
    .replace(/-online-gratis-en-cinecalidad$/i, '')
    .replace(/-\d{4}$/, '')
    .replace(/-/g, ' ')
    .trim();
  return formatDisplayTitle(cleaned);
}

function externalEpisodeLabel(ep) {
  const title = String(ep.title || '').trim();
  if (title && !/^T\d+\s*E\d+$/i.test(title)) return title;
  return `Episodio ${ep.episode}`;
}

function externalDetailId(data) {
  return `${data.source}:${data.slug}`;
}

function flattenExternalSeasonBlocks(seasonBlocks) {
  const out = [];
  for (const block of seasonBlocks || []) {
    for (const ep of block.episodes || []) {
      out.push({
        id: `ext-${ep.season}x${ep.episode}`,
        season: ep.season,
        episode: ep.episode,
        title: ep.title || externalEpisodeLabel(ep),
        description: ep.overview || ep.description || '',
        poster: ep.poster || '',
        runtime: ep.runtime || null,
        air_date: ep.air_date || ''
      });
    }
  }
  return out.sort((a, b) => a.season - b.season || a.episode - b.episode);
}

function normalizeExternalMovieForDetail(meta) {
  const genres = meta.genres?.length
    ? meta.genres
    : (meta.genre ? String(meta.genre).split(/,\s*/).map((g) => g.trim()).filter(Boolean) : []);
  return {
    id: externalDetailId(meta),
    source: meta.source,
    slug: meta.slug,
    title: formatDisplayTitle(meta.title || slugToDisplayTitle(meta.slug)),
    poster: meta.poster,
    backdrop: meta.backdrop || meta.poster,
    year: meta.year || null,
    rating: meta.rating || null,
    runtime: meta.runtime || null,
    genres,
    cast: meta.cast || [],
    synopsis: meta.synopsis || meta.overview || '',
    trailer: meta.trailer || '',
    similar: meta.similar || [],
    _external: true
  };
}

function normalizeExternalSeriesForDetail(meta) {
  const seasonBlocks = Array.isArray(meta.seasons) && meta.seasons[0]?.episodes
    ? meta.seasons
    : [];
  const episodes = flattenExternalSeasonBlocks(seasonBlocks);
  const genres = meta.genres?.length
    ? meta.genres
    : (meta.genre ? String(meta.genre).split(/,\s*/).map((g) => g.trim()).filter(Boolean) : []);
  return {
    id: externalDetailId(meta),
    source: meta.source,
    slug: meta.slug,
    title: formatDisplayTitle(meta.title || slugToDisplayTitle(meta.slug)),
    poster: meta.poster,
    backdrop: meta.backdrop || meta.poster,
    year: meta.year || null,
    rating: meta.rating || null,
    genres,
    cast: meta.cast || [],
    synopsis: meta.synopsis || meta.overview || '',
    trailer: meta.trailer || '',
    seasons: meta.season_count || seasonBlocks.length || null,
    episodes_count: meta.episodes_count || episodes.length || null,
    status: meta.status || '',
    episodes,
    similar: meta.similar || [],
    _external: true
  };
}

function paintExternalMovieDetail(raw, { shell = false } = {}) {
  const data = normalizeExternalMovieForDetail(raw);
  const el = $('#movie-detail-content');
  el.className = shell ? 'movie-detail-shell' : '';
  el.innerHTML = buildMovieDetailHtml(data, { shell, external: true });
  detailContentEnter(el);
  if (!shell) bindExternalMovieDetailActions(data);
}

function paintExternalSeriesDetail(raw, { shell = false, episodeProgressMap = {} } = {}) {
  const data = normalizeExternalSeriesForDetail(raw);
  const el = $('#series-detail-content');
  el.className = shell ? 'movie-detail-shell' : '';
  const selectedSeason = shell ? null : pickDefaultSeriesSeason(data.episodes, episodeProgressMap);
  el.innerHTML = buildSeriesDetailHtml(data, episodeProgressMap, { shell, external: true, selectedSeason });
  detailContentEnter(el);
  if (!shell) bindExternalSeriesDetailActions(data, selectedSeason, episodeProgressMap);
}

function bindExternalMovieDetailActions(data) {
  movieDetailState = { ...data, _external: true };
  const playBtn = $('#movie-play-btn');
  if (!playBtn) return;
  const play = () => playExternalMovie(data.source, data.slug, data.year, data.title);
  playBtn.onclick = play;
  playBtn.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
  };
  bindCardClicks('#row-movie-similar');
  bindDetailTrailerButton($('#movie-detail-content') || document);
  setTimeout(() => activateFocusable(playBtn), 80);
}

function bindExternalSeriesDetailActions(data, selectedSeason = null, episodeProgressMap = {}) {
  const activeSeason = selectedSeason ?? pickDefaultSeriesSeason(data.episodes, episodeProgressMap);
  seriesDetailState = { data, episodeProgressMap, selectedSeason: activeSeason, _external: true };
  updateSeriesPlayButton(data, episodeProgressMap, activeSeason);
  bindSeriesSeasonTabs(data, episodeProgressMap);
  bindEpisodeItems(data, episodeProgressMap);
  bindCardClicks('#row-series-similar');
  bindDetailTrailerButton($('#series-detail-content') || document);
  const focusEl = $('#series-play-btn') || $('#series-season-tabs .series-season-tab') || $('#series-episodes-list .episode-item');
  setTimeout(() => activateFocusable(focusEl), 80);
}

async function showExternalSeriesDetail(source, slug) {
  const cacheKey = `external:${source}:${slug}`;
  const cached = vodItemCache.get(cacheKey) || {
    external: true,
    source,
    slug,
    title: slugToDisplayTitle(slug),
    poster: '',
    seasons: [],
    content_type: 'series'
  };
  seriesDetailBackPage = $('#page-series')?.classList.contains('active') ? 'series'
    : ($('#page-explorar')?.classList.contains('active') ? 'explorar' : 'home');
  showPage('series-detail');
  syncAppRoute('series-detail', { external: source, slug, from: seriesDetailBackPage });
  paintExternalSeriesDetail(cached, { shell: true });

  try {
    const [meta, epProgress] = await Promise.all([
      api(`/catalog/external/${encodeURIComponent(source)}/series/${encodeURIComponent(slug)}`),
      api(`/watch/external/series/${encodeURIComponent(source)}/${encodeURIComponent(slug)}/progress`).catch(() => ({ episodes: {} }))
    ]);
    vodItemCache.set(cacheKey, { ...meta, _type: 'series', _external: true });
    paintExternalSeriesDetail(meta, { shell: false, episodeProgressMap: epProgress.episodes || {} });
    const detail = normalizeExternalSeriesForDetail(meta);
    const progressMap = epProgress.episodes || {};
    const activeSeason = pickDefaultSeriesSeason(
      detail.episodes,
      Object.fromEntries(Object.entries(progressMap).map(([k, v]) => [`ext-${k}`, v]))
    );
    const eps = episodesForSeason(detail.episodes, activeSeason);
    let target = eps[0];
    for (const ep of eps) {
      const prog = progressMap[`${ep.season}x${ep.episode}`];
      if (prog?.percent >= 30 && prog.percent < 95) {
        target = ep;
        break;
      }
    }
    if (target) prefetchExternalEpisodePlay(source, slug, target.season, target.episode);
  } catch (err) {
    toast(err.message || 'No se pudo cargar la serie', true);
  }
}

async function playExternalEpisode(source, slug, season, episode, title, startTime = 0, meta = {}) {
  playerQualityPref = getPlaybackQualityPref();
  openPlayer(title);
  setPlayerLiveMode(false);
  resetPlayerQualityUi();
  playerWatchMeta = {
    external: true,
    source,
    slug,
    season,
    episode,
    _series: true,
    content_type: 'episode',
    title: meta.seriesTitle || title,
    episodeTitle: meta.title || `Episodio ${episode}`,
    poster: meta.poster || seriesDetailState?.data?.poster || vodItemCache.get(`external:${source}:${slug}`)?.poster || ''
  };
  externalPlaySession = { source, slug, season, episode, quality: playerQualityPref, refreshSec: 240, _series: true };
  const wrap = $('#player-video-wrap');
  wrap?.classList.add('player-video-loading', 'player-loading-vod', 'player-loading-external');
  showPlayerChrome({ pin: true });
  if (startTime >= 30) showSkipHint('Continuando…');
  try {
    let data = takeExternalPlayPrefetch(source, slug, season, episode);
    if (!data) {
      const q = new URLSearchParams({
        season: String(season),
        episode: String(episode),
        quality: serverQualityFromPref(playerQualityPref)
      });
      data = await api(`/catalog/external/${encodeURIComponent(source)}/series/${encodeURIComponent(slug)}/play?${q}`);
    }
    await startExternalPlayback(data, title, playerQualityPref, startTime);
  } catch (err) {
    closePlayer();
    toast(err.message || 'No se pudo reproducir', true);
  }
}

async function showExternalMovieDetail(source, slug, year) {
  const cacheKey = `external:${source}:${slug}`;
  const cached = vodItemCache.get(cacheKey) || {
    external: true,
    source,
    slug,
    year: parseInt(year, 10) || null,
    title: slugToDisplayTitle(slug),
    poster: ''
  };
  movieDetailBackPage = externalDetailBackPage();
  showPage('movie-detail');
  syncAppRoute('movie-detail', { external: source, slug, year: cached.year || '', from: movieDetailBackPage });
  paintExternalMovieDetail(cached, { shell: true });

  try {
    const q = cached.year ? `?year=${encodeURIComponent(cached.year)}` : '';
    const meta = await api(`/catalog/external/${encodeURIComponent(source)}/${encodeURIComponent(slug)}${q}`);
    vodItemCache.set(cacheKey, { ...meta, _type: 'movie', _external: true });
    paintExternalMovieDetail(meta, { shell: false });
    prefetchExternalPlay(source, slug, meta.year || cached.year);
  } catch { /* mantener vista inicial */ }
}

async function refreshExternalStream({ silent = false } = {}) {
  if (!externalPlaySession || playerClosing) return false;
  const { source, slug, year, season, episode, _series } = externalPlaySession;
  try {
    let data;
    if (_series) {
      const q = new URLSearchParams({
        season: String(season),
        episode: String(episode),
        quality: serverQualityFromPref(externalPlaySession.quality || playerQualityPref)
      });
      data = await api(`/catalog/external/${encodeURIComponent(source)}/series/${encodeURIComponent(slug)}/play?${q}`);
    } else {
      data = await fetchExternalPlay(source, slug, year, externalPlaySession.quality || playerQualityPref);
    }
    const video = $('#video-player');
    const pos = video?.currentTime || 0;
    const playPath = appendStreamSession(data.proxied || data.url);
    if (!playPath) throw new Error('Stream no disponible');
    externalPlaySession.referer = data.referer;
    externalPlaySession.refreshSec = data.refreshSec || 240;
    externalPlaySession.maxHeight = data.maxHeight || 0;
    if (hlsInstance && /\.m3u8|\/api\/live\/stream/i.test(playPath)) {
      hlsInstance.loadSource(playPath);
      hlsInstance.once(Hls.Events.MANIFEST_PARSED, () => {
        if (pos > 5) video.currentTime = pos;
        video.play().catch(() => {});
      });
    } else {
      setupVideoPlayer(video, data.url, 0, pos, false);
    }
    if (!silent) toast('Enlace actualizado', false);
    return true;
  } catch (err) {
    if (!silent) toast(err.message || 'No se pudo actualizar el stream', true);
    return false;
  }
}

function startExternalStreamRefresh(refreshSec = 240) {
  clearExternalStreamRefresh();
  const ms = Math.max(120, refreshSec) * 1000;
  externalStreamRefreshTimer = setInterval(() => {
    refreshExternalStream({ silent: true }).catch(() => {});
  }, ms);
}

async function playExternalMovie(source, slug, year, title, startTime = 0) {
  playerQualityPref = getPlaybackQualityPref();
  const cached = vodItemCache.get(`external:${source}:${slug}`);
  openPlayer(title);
  setPlayerLiveMode(false);
  resetPlayerQualityUi();
  playerWatchMeta = {
    external: true,
    source,
    slug,
    year: year || null,
    title,
    content_type: 'movie',
    poster: cached?.poster || ''
  };
  externalPlaySession = { source, slug, year: year || null, quality: playerQualityPref, refreshSec: 240 };
  const wrap = $('#player-video-wrap');
  wrap?.classList.add('player-video-loading', 'player-loading-vod', 'player-loading-external');
  showPlayerChrome({ pin: true });
  if (startTime >= 30) showSkipHint('Continuando…');

  try {
    let data = takeExternalPlayPrefetch(source, slug);
    if (!data) data = await fetchExternalPlay(source, slug, year, playerQualityPref);
    await startExternalPlayback(data, title, playerQualityPref, startTime);
  } catch (err) {
    closePlayer();
    toast(err.message || 'No se pudo reproducir', true);
  }
}

function movieDetailFromCache(id) {
  const cached = getVodCache('movie', id);
  if (!cached) return null;
  const genres = cached.genre
    ? String(cached.genre).split(/[,/|]/).map((g) => g.trim()).filter(Boolean)
    : [];
  return {
    id: cached.id,
    title: cached.title,
    poster: cached.poster,
    backdrop: cached.poster,
    year: cached.year,
    rating: cached.rating,
    genres,
    synopsis: cached.description || cached.synopsis || '',
    cast: [],
    runtime: null,
    video_path: cached.video_path || '',
    similar: [],
    _shell: true
  };
}

function buildMovieDetailHtml(data, { shell = false, external = false } = {}) {
  const poster = posterUrl(data.poster, data);
  const backdrop = data.backdrop || poster;
  const coverFallback = `/api/posters/cover?title=${encodeURIComponent(data.title || '')}&year=${data.year || ''}`;
  const genres = (data.genres || []).map(g => `<span class="meta-chip">${escHtml(g)}</span>`).join('');
  const cast = (data.cast || []).length
    ? data.cast.map(a => `<span class="cast-chip">${escHtml(a)}</span>`).join('')
    : (shell
      ? '<div class="detail-skeleton-line wide"></div><div class="detail-skeleton-line short"></div>'
      : '<span class="meta-muted">Sin información de reparto</span>');
  const rating = data.rating ? `<span class="meta-chip rating-chip">⭐ ${data.rating}/10</span>` : '';
  const runtime = data.runtime ? `<span class="meta-chip">⏱ ${data.runtime} min</span>` : '';
  const year = data.year ? `<span class="meta-chip">${data.year}</span>` : '';
  const sourceLabel = EXTERNAL_SOURCE_LABELS[data.source] || data.source || '';
  const format = external
    ? `<span class="meta-chip format-chip">1080p</span>${sourceLabel ? `<span class="meta-chip">${escHtml(sourceLabel)}</span>` : ''}`
    : (data.video_path ? `<span class="meta-chip format-chip">${videoFormatLabel(data.video_path)}</span>` : '');
  const synopsisText = data.synopsis || data.overview || '';
  const synopsis = shell && !synopsisText
    ? '<div class="detail-skeleton-line wide"></div><div class="detail-skeleton-line"></div>'
    : `<p class="movie-synopsis">${escHtml(synopsisText) || (external ? 'Sin sinopsis disponible.' : 'Sin sinopsis disponible.')}</p>`;
  const similarHtml = (data.similar || []).length
    ? data.similar.map(m => cardHtml(m, m.content_type === 'series' ? 'series' : 'movie')).join('')
    : (shell ? '' : '<p class="meta-muted" style="padding:0 24px">No hay más recomendaciones</p>');
  const similarSection = (data.similar || []).length || shell
    ? `<div class="row-section movie-similar-section">
      <h2 class="row-title">🎬 También te puede gustar</h2>
      <div class="carousel" id="row-movie-similar">${similarHtml}</div>
    </div>`
    : '';
  const playLabel = external ? '▶ Reproducir' : (data._watchProgress >= 30 ? '▶ Continuar viendo' : '▶ Reproducir');
  const playBtn = `<button class="btn-primary btn-play-movie tv-focusable" id="movie-play-btn" tabindex="0" ${external || data.video_path ? '' : 'disabled'}>
            ${playLabel}
          </button>`;
  return `
    <div class="movie-detail-hero" style="${backdrop ? `background-image:url('${escHtml(backdrop)}')` : ''}">
      <div class="movie-detail-hero-overlay"></div>
      <div class="movie-detail-hero-inner">
        <img class="movie-detail-poster" src="${poster || coverFallback}" alt="${escHtml(data.title)}" loading="eager"
          onerror="this.onerror=null;this.src='${coverFallback}'">
        <div class="movie-detail-info">
          <h1>${escHtml(data.title)}</h1>
          <div class="movie-meta-row movie-meta-primary">${year}${rating}${runtime}${format}</div>
          <div class="movie-meta-row movie-meta-genres">${genres}</div>
          ${synopsis}
          <div class="movie-cast-block">
            <h3>Reparto</h3>
            <div class="movie-cast-list">${cast}</div>
          </div>
          ${detailActionsHtml('movie', data.id, playBtn, data.trailer || '', { external, source: data.source, slug: data.slug })}
        </div>
      </div>
    </div>
    ${similarSection}`;
}

function bindMovieDetailActions(data) {
  movieDetailState = data;
  const playBtn = $('#movie-play-btn');
  if (!playBtn) return;
  const watchMeta = { content_type: 'movie', content_id: data.id, subtitle_path: data.subtitle_path || '' };
  const play = () => {
    if (!data.video_path) return toast('Video no disponible', true);
    playVideo(
      data.video_path,
      data.title,
      data._durationSec || (data.runtime || 0) * 60,
      data._watchProgress || 0,
      watchMeta
    );
  };
  playBtn.onclick = play;
  playBtn.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); }
  };
  bindCardClicks('#row-movie-similar');
  bindDetailTrailerButton($('#movie-detail-content') || document);
  setTimeout(() => activateFocusable(playBtn), 80);
}

function paintMovieDetail(data, { shell = false } = {}) {
  const el = $('#movie-detail-content');
  el.className = shell ? 'movie-detail-shell' : '';
  el.innerHTML = buildMovieDetailHtml(data, { shell });
  detailContentEnter(el);
  bindMovieDetailActions(data);
}

async function showMovieDetail(id, backPage = null, { replaceRoute = false } = {}) {
  if (backPage) movieDetailBackPage = backPage;
  else if ($('#page-home')?.classList.contains('active')) movieDetailBackPage = 'home';
  else if ($('#page-mylist')?.classList.contains('active')) movieDetailBackPage = 'mylist';
  else if ($('#page-movies')?.classList.contains('active')) movieDetailBackPage = 'movies';
  else if ($('#page-browse')?.classList.contains('active')) movieDetailBackPage = 'browse';
  else if ($('#page-explorar')?.classList.contains('active')) movieDetailBackPage = 'explorar';
  else if ($('#page-movie-detail')?.classList.contains('active')) { /* keep current */ }
  else movieDetailBackPage = 'home';

  showPage('movie-detail');
  syncAppRoute('movie-detail', { id, from: movieDetailBackPage }, { replace: replaceRoute });

  const shell = movieDetailFromCache(id) || { id, title: 'Cargando…', genres: [], _shell: true };
  shell._watchProgress = watchProgressMap[`movie-${id}`]?.progress || 0;
  paintMovieDetail(shell, { shell: true });

  try {
    const [data, wh] = await Promise.all([
      api(`/movies/${id}/detail`),
      api(`/watch/progress/movie/${id}`).catch(() => ({ progress: 0, duration: 0 }))
    ]);
    cacheVodItem(data, 'movie');
    data._durationSec = (data.runtime || 0) * 60;
    data._watchProgress = wh.progress || 0;
    if (wh.duration > 0) data._durationSec = Math.max(data._durationSec || 0, wh.duration);
    if (isTranscodedPath(data.video_path)) {
      fetchStreamDuration(data.video_path).then((d) => {
        if (d > 0 && movieDetailState?.id === data.id) {
          data._durationSec = Math.max(data._durationSec || 0, d);
          movieDetailState._durationSec = data._durationSec;
        }
      });
    }
    paintMovieDetail(data, { shell: false });
  } catch (err) {
    toast(err.message, true);
    navigateToPage(movieDetailBackPage);
  }
}

$('#movie-back').addEventListener('click', () => navigateToPage(movieDetailBackPage));
$('#movie-back').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToPage(movieDetailBackPage); }
});

$('#browse-back')?.addEventListener('click', () => closeBrowsePage());
$('#browse-back')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeBrowsePage(); }
});

/* SERIES */
async function loadSeries() {
  return loadStorefront('series');
}

let seriesDetailBackPage = 'series';
let seriesDetailState = null;

function seriesDetailFromCache(id) {
  const cached = getVodCache('series', id);
  if (!cached) return null;
  const genres = cached.genre
    ? String(cached.genre).split(/[,/|]/).map((g) => g.trim()).filter(Boolean)
    : [];
  return {
    id: cached.id,
    title: cached.title,
    poster: cached.poster,
    backdrop: cached.poster,
    genres,
    synopsis: cached.description || '',
    episodes: [],
    similar: [],
    _shell: true
  };
}

function getSeriesSeasonNumbers(episodes) {
  return [...new Set((episodes || []).map((ep) => ep.season))].sort((a, b) => a - b);
}

function episodesForSeason(episodes, season) {
  return (episodes || []).filter((ep) => ep.season === season);
}

function pickDefaultSeriesSeason(episodes, episodeProgressMap) {
  const seasons = getSeriesSeasonNumbers(episodes);
  if (!seasons.length) return 1;
  let best = null;
  for (const ep of episodes || []) {
    const wh = episodeProgressMap[ep.id] || watchProgressMap[`episode-${ep.id}`];
    const pct = watchProgressPercent(wh);
    if (pct >= 2 && (!best || pct > best.pct || (pct === best.pct && ep.episode > best.episode))) {
      best = { season: ep.season, pct, episode: ep.episode };
    }
  }
  return best ? best.season : seasons[0];
}

function pickSeriesPlayEpisode(data, episodeProgressMap, season) {
  const eps = episodesForSeason(data.episodes, season);
  if (!eps.length) return null;
  let resume = null;
  for (const ep of eps) {
    const wh = episodeProgressMap[ep.id] || watchProgressMap[`episode-${ep.id}`];
    const pct = watchProgressPercent(wh);
    if (pct >= 30 && pct < 95 && (!resume || pct > resume.pct)) {
      resume = { ep, wh, pct };
    }
  }
  if (resume) return resume;
  return { ep: eps[0], wh: episodeProgressMap[eps[0].id] || watchProgressMap[`episode-${eps[0].id}`], pct: 0 };
}

function buildEpisodeItemHtml(ep, data, episodeProgressMap, { external = false } = {}) {
  const epLabel = `T${ep.season}E${String(ep.episode).padStart(2, '0')}`;
  const epTitle = escHtml(`${data.title} S${ep.season}E${ep.episode} - ${ep.title}`);
  const thumbSrc = ep.poster ? escHtml(ep.poster) : '';
  const thumbFallback = `/api/posters/cover?title=${encodeURIComponent(`${data.title || ''} S${ep.season}E${ep.episode}`)}`;
  const thumb = ep.poster
    ? `<img src="${thumbSrc}" alt="${escHtml(ep.title)}" loading="lazy" onerror="this.onerror=null;this.src='${thumbFallback}'">`
    : '';
  const metaParts = [`Episodio ${ep.episode}`];
  if (ep.runtime) metaParts.push(`${ep.runtime} min`);
  if (ep.air_date) metaParts.push(ep.air_date);
  const desc = ep.description
    ? `<p class="episode-desc">${escHtml(ep.description)}</p>`
    : '';
  const epPct = episodeProgressMap[ep.id]?.percent || watchProgressPercent(watchProgressMap[`episode-${ep.id}`]);
  const resumeLabel = epPct >= 2 ? ` · ${Math.round(epPct)}% visto` : '';
  if (external) {
    return `<div class="episode-item tv-focusable" role="button" tabindex="0"
      data-season="${ep.season}" data-episode="${ep.episode}" aria-label="${epTitle}">
      <div class="episode-thumb${ep.poster ? '' : ' no-img'}">${thumb}${episodeProgressBarHtml(ep.id, episodeProgressMap)}<span class="episode-badge">${epLabel}${resumeLabel}</span></div>
      <div class="episode-body">
        <strong class="episode-title">${escHtml(ep.title)}</strong>
        <span class="episode-meta">${escHtml(metaParts.join(' · '))}</span>
        ${desc}
      </div>
      <span class="episode-play-icon" aria-hidden="true">▶</span>
    </div>`;
  }
  return `<div class="episode-item tv-focusable" role="button" tabindex="0"
    data-path="${encodeURIComponent(ep.video_path)}" data-title="${epTitle}"
    data-episode-id="${ep.id}" data-series-id="${data.id}" aria-label="${epTitle}">
    <div class="episode-thumb${ep.poster ? '' : ' no-img'}">${thumb}${episodeProgressBarHtml(ep.id, episodeProgressMap)}<span class="episode-badge">${epLabel}${resumeLabel}</span></div>
    <div class="episode-body">
      <strong class="episode-title">${escHtml(ep.title)}</strong>
      <span class="episode-meta">${escHtml(metaParts.join(' · '))}</span>
      ${desc}
    </div>
    <span class="episode-play-icon" aria-hidden="true">▶</span>
  </div>`;
}

function buildSeasonTabsHtml(seasons, selectedSeason) {
  if (seasons.length <= 1) return '';
  return seasons.map((s) => {
    const active = s === selectedSeason;
    return `<button type="button" class="series-season-tab tv-focusable${active ? ' active' : ''}"
      role="tab" aria-selected="${active ? 'true' : 'false'}"
      data-season="${s}" tabindex="0">Temporada ${s}</button>`;
  }).join('');
}

function buildSeriesDetailHtml(data, episodeProgressMap, { shell = false, selectedSeason = null, external = false } = {}) {
  const poster = posterUrl(data.poster, data);
  const backdrop = data.backdrop || poster;
  const coverFallback = `/api/posters/cover?title=${encodeURIComponent(data.title || '')}`;
  const genres = (data.genres || []).map(g => `<span class="meta-chip">${escHtml(g)}</span>`).join('');
  const cast = (data.cast || []).length
    ? data.cast.map(a => `<span class="cast-chip">${escHtml(a)}</span>`).join('')
    : (shell
      ? '<div class="detail-skeleton-line wide"></div>'
      : '<span class="meta-muted">Sin información de reparto</span>');
  const rating = data.rating ? `<span class="meta-chip rating-chip">⭐ ${data.rating}/10</span>` : '';
  const year = data.year ? `<span class="meta-chip">${data.year}</span>` : '';
  const seasons = data.seasons ? `<span class="meta-chip">📺 ${data.seasons} temp.</span>` : '';
  const epCount = data.episodes_count ? `<span class="meta-chip">${data.episodes_count} eps.</span>` : '';
  const status = data.status ? `<span class="meta-chip">${escHtml(data.status)}</span>` : '';
  const sourceLabel = external && data.source ? `<span class="meta-chip">${escHtml(EXTERNAL_SOURCE_LABELS[data.source] || data.source)}</span>` : '';
  const seasonNumbers = getSeriesSeasonNumbers(data.episodes);
  const activeSeason = selectedSeason ?? pickDefaultSeriesSeason(data.episodes, episodeProgressMap);
  const playPick = pickSeriesPlayEpisode(data, episodeProgressMap, activeSeason);
  const playEp = playPick?.ep;
  const synopsisText = data.synopsis || data.overview || '';
  const synopsis = shell && !synopsisText
    ? '<div class="detail-skeleton-line wide"></div><div class="detail-skeleton-line"></div>'
    : `<p class="movie-synopsis">${escHtml(synopsisText) || 'Sin sinopsis disponible.'}</p>`;
  const similarHtml = (data.similar || []).length
    ? data.similar.map(s => cardHtml(s, s.content_type === 'series' ? 'series' : 'movie')).join('')
    : (shell ? '' : '<p class="meta-muted" style="padding:0 24px">No hay más series similares</p>');
  const episodesHtml = shell && !(data.episodes || []).length
    ? '<div class="detail-skeleton-line wide" style="margin:12px 0"></div><div class="detail-skeleton-line wide"></div>'
    : episodesForSeason(data.episodes, activeSeason).map((ep) => buildEpisodeItemHtml(ep, data, episodeProgressMap, { external })).join('')
      || '<p class="meta-muted">Sin episodios en esta temporada</p>';
  const seasonTabsHtml = shell && !(data.episodes || []).length
    ? ''
    : buildSeasonTabsHtml(seasonNumbers, activeSeason);
  const playBtnLabel = playEp
    ? (external
      ? (playPick.pct >= 30
        ? `▶ Continuar T${playEp.season}E${String(playEp.episode).padStart(2, '0')}`
        : `▶ Reproducir T${playEp.season}E${String(playEp.episode).padStart(2, '0')}`)
      : (playPick.pct >= 30
        ? `▶ Continuar T${playEp.season}E${String(playEp.episode).padStart(2, '0')}`
        : `▶ Reproducir T${playEp.season}E${String(playEp.episode).padStart(2, '0')}`))
    : '';
  const similarSection = (data.similar || []).length || shell
    ? `<div class="row-section movie-similar-section">
      <h2 class="row-title">📺 Series similares</h2>
      <div class="carousel" id="row-series-similar">${similarHtml}</div>
    </div>`
    : '';
  const playBtn = playEp
    ? `<button class="btn-primary btn-play-movie tv-focusable" id="series-play-btn" tabindex="0">${playBtnLabel}</button>`
    : '';
  return `
    <div class="movie-detail-hero" style="${backdrop ? `background-image:url('${escHtml(backdrop)}')` : ''}">
      <div class="movie-detail-hero-overlay"></div>
      <div class="movie-detail-hero-inner">
        <img class="movie-detail-poster" src="${poster || coverFallback}" alt="${escHtml(data.title)}" loading="eager"
          onerror="this.onerror=null;this.src='${coverFallback}'">
        <div class="movie-detail-info">
          <h1>${escHtml(data.title)}</h1>
          <div class="movie-meta-row movie-meta-primary">${year}${rating}${seasons}${epCount}${status}${sourceLabel}</div>
          <div class="movie-meta-row movie-meta-genres">${genres}</div>
          ${synopsis}
          <div class="movie-cast-block">
            <h3>Reparto</h3>
            <div class="movie-cast-list">${cast}</div>
          </div>
          ${playEp ? detailActionsHtml('series', data.id, playBtn, data.trailer || '', { external, source: data.source, slug: data.slug }) : detailActionsHtml('series', data.id, '', data.trailer || '', { external, source: data.source, slug: data.slug })}
        </div>
      </div>
    </div>
    <div class="series-episodes-section">
      <h2 class="row-title">📋 Episodios</h2>
      <div class="series-season-tabs" id="series-season-tabs" role="tablist">${seasonTabsHtml}</div>
      <div class="episodes-list" id="series-episodes-list">${episodesHtml}</div>
    </div>
    ${similarSection}`;
}

async function playSeriesEpisode(data, ep, episodeProgressMap, whOverride) {
  cachePlayerSeriesEpisodes(data.id, data.episodes, data.title);
  const wh = whOverride || episodeProgressMap[ep.id] || watchProgressMap[`episode-${ep.id}`];
  let start = wh?.progress || 0;
  let dur = wh?.duration || 0;
  if (!start) {
    try {
      const row = await api(`/watch/progress/episode/${ep.id}`);
      start = row.progress || 0;
      dur = row.duration || 0;
    } catch { /* ignore */ }
  }
  if (isTranscodedPath(ep.video_path) && start > 0) {
    const d = await fetchStreamDuration(ep.video_path);
    if (d > 0) dur = d;
  }
  playVideo(
    ep.video_path,
    `${data.title} S${ep.season}E${ep.episode} - ${ep.title}`,
    dur,
    start,
    { content_type: 'episode', content_id: ep.id, series_id: data.id, subtitle_path: ep.subtitle_path || '' }
  );
}

function bindEpisodeItems(data, episodeProgressMap) {
  $$('#series-episodes-list .episode-item').forEach((el) => {
    const playEp = async () => {
      if (data._external) {
        const season = parseInt(el.dataset.season, 10);
        const episode = parseInt(el.dataset.episode, 10);
        const ep = (data.episodes || []).find((row) => row.season === season && row.episode === episode);
        const wh = ep ? (episodeProgressMap[ep.id] || watchProgressMap[`episode-${ep.id}`]) : null;
        playExternalEpisode(
          data.source,
          data.slug,
          season,
          episode,
          `${data.title} T${season}E${episode}`,
          wh?.progress || 0,
          { title: ep?.title || '', poster: ep?.poster || data.poster || '', seriesTitle: data.title }
        );
        return;
      }
      const path = decodeURIComponent(el.dataset.path || '');
      const title = el.dataset.title || '';
      const epId = parseInt(el.dataset.episodeId, 10);
      const seriesId = parseInt(el.dataset.seriesId, 10);
      const ep = (data.episodes || []).find((row) => row.id === epId);
      if (ep) {
        await playSeriesEpisode(data, ep, episodeProgressMap);
        return;
      }
      const wh = episodeProgressMap[epId] || watchProgressMap[`episode-${epId}`];
      let start = wh?.progress || 0;
      let dur = wh?.duration || 0;
      if (!start) {
        try {
          const row = await api(`/watch/progress/episode/${epId}`);
          start = row.progress || 0;
          dur = row.duration || 0;
        } catch { /* ignore */ }
      }
      if (isTranscodedPath(path) && start > 0) {
        const d = await fetchStreamDuration(path);
        if (d > 0) dur = d;
      }
      playVideo(path, title, dur, start, {
        content_type: 'episode',
        content_id: epId,
        series_id: seriesId,
        subtitle_path: ep.subtitle_path || ''
      });
    };
    el.onclick = playEp;
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playEp(); }
    };
  });
}

function updateSeriesPlayButton(data, episodeProgressMap, selectedSeason) {
  const playBtn = $('#series-play-btn');
  if (!playBtn) return;
  const pick = pickSeriesPlayEpisode(data, episodeProgressMap, selectedSeason);
  if (!pick?.ep) {
    playBtn.style.display = 'none';
    return;
  }
  playBtn.style.display = '';
  playBtn.textContent = pick.pct >= 30
    ? `▶ Continuar T${pick.ep.season}E${String(pick.ep.episode).padStart(2, '0')}`
    : `▶ Reproducir T${pick.ep.season}E${String(pick.ep.episode).padStart(2, '0')}`;
  const playFirst = async () => {
    if (data._external) {
      playExternalEpisode(
        data.source,
        data.slug,
        pick.ep.season,
        pick.ep.episode,
        `${data.title} T${pick.ep.season}E${pick.ep.episode}`,
        pick.wh?.progress || 0,
        { title: pick.ep.title || '', poster: pick.ep.poster || data.poster || '', seriesTitle: data.title }
      );
      return;
    }
    await playSeriesEpisode(data, pick.ep, episodeProgressMap, pick.wh);
  };
  playBtn.onclick = playFirst;
  playBtn.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playFirst(); }
  };
}

function selectSeriesSeason(season) {
  if (!seriesDetailState?.data) return;
  const { data, episodeProgressMap } = seriesDetailState;
  const seasons = getSeriesSeasonNumbers(data.episodes);
  if (!seasons.includes(season)) return;
  seriesDetailState.selectedSeason = season;

  $$('#series-season-tabs .series-season-tab').forEach((tab) => {
    const active = parseInt(tab.dataset.season, 10) === season;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const listEl = $('#series-episodes-list');
  if (listEl) {
    const external = !!data._external;
    listEl.innerHTML = episodesForSeason(data.episodes, season)
      .map((ep) => buildEpisodeItemHtml(ep, data, episodeProgressMap, { external: !!data._external }))
      .join('') || '<p class="meta-muted">Sin episodios en esta temporada</p>';
    bindEpisodeItems(data, episodeProgressMap);
  }
  updateSeriesPlayButton(data, episodeProgressMap, season);
}

function bindSeriesSeasonTabs(data, episodeProgressMap) {
  $$('#series-season-tabs .series-season-tab').forEach((tab) => {
    const activate = () => selectSeriesSeason(parseInt(tab.dataset.season, 10));
    tab.onclick = activate;
    tab.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    };
  });
}

function bindSeriesDetailActions(data, episodeProgressMap, selectedSeason = null) {
  const activeSeason = selectedSeason ?? pickDefaultSeriesSeason(data.episodes, episodeProgressMap);
  seriesDetailState = { data, episodeProgressMap, selectedSeason: activeSeason };
  updateSeriesPlayButton(data, episodeProgressMap, activeSeason);
  bindSeriesSeasonTabs(data, episodeProgressMap);
  bindEpisodeItems(data, episodeProgressMap);
  bindCardClicks('#row-series-similar');
  bindDetailTrailerButton($('#series-detail-content') || document);
  const focusEl = $('#series-play-btn') || $('#series-season-tabs .series-season-tab') || $('#series-episodes-list .episode-item');
  setTimeout(() => activateFocusable(focusEl), 80);
}

function paintSeriesDetail(data, episodeProgressMap, { shell = false } = {}) {
  const el = $('#series-detail-content');
  el.className = shell ? 'movie-detail-shell' : '';
  const selectedSeason = shell ? null : pickDefaultSeriesSeason(data.episodes, episodeProgressMap);
  el.innerHTML = buildSeriesDetailHtml(data, episodeProgressMap, { shell, selectedSeason });
  detailContentEnter(el);
  if (!shell) bindSeriesDetailActions(data, episodeProgressMap, selectedSeason);
}

async function showSeriesDetail(id, backPage = null, { replaceRoute = false } = {}) {
  if (backPage) seriesDetailBackPage = backPage;
  else if ($('#page-home')?.classList.contains('active')) seriesDetailBackPage = 'home';
  else if ($('#page-mylist')?.classList.contains('active')) seriesDetailBackPage = 'mylist';
  else if ($('#page-series')?.classList.contains('active')) seriesDetailBackPage = 'series';
  else if ($('#page-browse')?.classList.contains('active')) seriesDetailBackPage = 'browse';
  else if ($('#page-series-detail')?.classList.contains('active')) { /* keep */ }
  else seriesDetailBackPage = 'home';

  showPage('series-detail');
  syncAppRoute('series-detail', { id, from: seriesDetailBackPage }, { replace: replaceRoute });

  const shell = seriesDetailFromCache(id) || { id, title: 'Cargando…', genres: [], episodes: [], _shell: true };
  paintSeriesDetail(shell, {}, { shell: true });

  try {
    const [, data, epProgress] = await Promise.all([
      refreshWatchProgress().catch(() => []),
      api(`/series/${id}/detail`),
      api(`/watch/series/${id}/progress`).catch(() => ({ episodes: {} }))
    ]);
    cacheVodItem(data, 'series');
    const episodeProgressMap = epProgress.episodes || {};
    paintSeriesDetail(data, episodeProgressMap, { shell: false });
  } catch (err) {
    toast(err.message, true);
    navigateToPage(seriesDetailBackPage);
  }
}

$('#series-back').addEventListener('click', () => navigateToPage(seriesDetailBackPage));
$('#series-back').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToPage(seriesDetailBackPage); }
});

/* LIVE TV */
async function refreshLiveChannelsList() {
  if (!$('#page-live')?.classList.contains('active')) return;
  const prevId = selectedLiveChannelId;
  const [channels, categories] = await Promise.all([
    api('/live/channels'),
    api('/live/categories')
  ]);
  allChannels = channels;
  liveCategoriesList = categories;
  renderLiveCategoryFilters();
  selectedLiveChannelId = prevId;
  renderLiveGuide();
  fetchLiveEpgInBackground();
}

async function loadLive() {
  exitLiveHeroFullscreen();
  stopLivePreview();
  selectedLiveChannelId = null;
  liveInitialChannelPicked = false;
  const [channels, categories] = await Promise.all([
    api('/live/channels'),
    api('/live/categories')
  ]);
  allChannels = channels;
  liveCategoriesList = categories;
  currentGroup = 'all';

  bindLiveAudioControls();
  renderLiveCategoryFilters();

  renderLiveGuide();
  startFeaturedLivePreview().catch(() => {});
  const chNow = allChannels.find((c) => String(c.id) === String(selectedLiveChannelId));
  if (chNow) updateLiveHero(chNow);
  fetchLiveEpgInBackground();

  tickLiveClock();
  if (liveClockTimer) clearInterval(liveClockTimer);
  liveClockTimer = setInterval(tickLiveClock, 30000);
  if (liveEpgTimer) clearInterval(liveEpgTimer);
  liveEpgTimer = setInterval(() => {
    if (!$('#page-live')?.classList.contains('active')) return;
    fetchLiveEpgInBackground();
  }, 10 * 60 * 1000);

  const searchEl = $('#live-search');
  if (searchEl && !searchEl.dataset.bound) {
    searchEl.dataset.bound = '1';
    searchEl.addEventListener('input', renderLiveGuide);
  }

  const watchBtn = $('#live-hero-watch');
  if (watchBtn && !watchBtn.dataset.bound) {
    watchBtn.dataset.bound = '1';
    watchBtn.addEventListener('click', () => openSelectedLiveFull());
  }

}

/* PLAYER */
function formatPlayerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showSkipHint(text) {
  const el = $('#player-skip-hint');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(skipHintTimer);
  skipHintTimer = setTimeout(() => el.classList.add('hidden'), 700);
}

function getPlayerDuration(video) {
  const d = video?.duration;
  if (d && Number.isFinite(d) && d > 0 && (playerLocalFast || d > 30)) {
    playerKnownDuration = d;
    return d;
  }
  return playerKnownDuration || 0;
}

function getPlayerCurrentTime(video) {
  const base = (playerCurrentPath || '').split('?')[0];
  if (playerLocalFast || isLocalDirectPlay(base)) {
    return video?.currentTime || 0;
  }
  if (needsStreamReload(playerCurrentPath)) {
    return (video?.currentTime || 0) + playerStreamOffset;
  }
  return video?.currentTime || 0;
}

function getBufferedEnd(video) {
  let end = 0;
  if (!video?.buffered?.length) return 0;
  for (let i = 0; i < video.buffered.length; i++) {
    end = Math.max(end, video.buffered.end(i));
  }
  return end;
}

function isLocalUpload(path) {
  return path?.startsWith('/uploads/');
}

/** MP4/MOV/WEBM en disco: reproducción directa con Range (sin conversión en vivo). */
function isLocalDirectPlay(path) {
  const base = (path || '').split('?')[0];
  return isLocalUpload(base) && /\.(mp4|webm|mov)$/i.test(base);
}

function isLocalRangePlay(path) {
  return isLocalDirectPlay(path) || (isLocalUpload(path) && /\.mkv(\?|$)/i.test((path || '').split('?')[0]));
}

function isLocalTranscodePlay(path) {
  return isLocalUpload(path) && /\.(avi|wmv|flv)(\?|$)/i.test((path || '').split('?')[0]);
}

function isLocalFastPlay(path) {
  return isLocalRangePlay(path);
}

function needsStreamReload(path) {
  const base = (path || '').split('?')[0];
  if (!base || isLocalDirectPlay(base)) return false;
  if (isLocalUpload(base) && /\.mkv$/i.test(base)) return true;
  if (isLocalTranscodePlay(base)) return true;
  return /\.(avi|mkv|wmv|flv)(\?|$)/i.test(base);
}

function isTranscodedPath(path) {
  return needsStreamReload(path);
}

async function fetchStreamDuration(path) {
  if (!path) return 0;
  try {
    if (isLocalUpload(path)) {
      const rel = path.replace(/^\/uploads\//, '');
      const data = await fetch(`/api/stream/duration?path=${encodeURIComponent(rel)}`).then((r) => r.json());
      return data.duration || 0;
    }
    if (!/^https?:\/\//i.test(path)) return 0;
    const url = `/api/live/duration?url=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
    const data = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    return data.duration || 0;
  } catch {
    return 0;
  }
}

function applyPlayerDuration(seconds) {
  const next = Math.max(playerKnownDuration || 0, seconds || 0);
  if (next > 0 && next !== playerKnownDuration) {
    playerKnownDuration = next;
    updatePlayerProgress();
  }
}

function cachePlayerSeriesEpisodes(seriesId, episodes, title) {
  if (!seriesId || !episodes?.length) return;
  playerSeriesEpisodesCache = { seriesId, episodes, title: title || '' };
}

async function ensurePlayerSeriesEpisodes(seriesId) {
  if (playerSeriesEpisodesCache?.seriesId === seriesId && playerSeriesEpisodesCache.episodes?.length) {
    return playerSeriesEpisodesCache;
  }
  if (seriesDetailState?.data?.id === seriesId && seriesDetailState.data.episodes?.length) {
    cachePlayerSeriesEpisodes(seriesId, seriesDetailState.data.episodes, seriesDetailState.data.title);
    return playerSeriesEpisodesCache;
  }
  const data = await api(`/series/${seriesId}/detail`);
  cachePlayerSeriesEpisodes(seriesId, data.episodes, data.title);
  return playerSeriesEpisodesCache;
}

function findNextEpisodeInList(episodes, currentEpisodeId) {
  const list = episodes || [];
  const idx = list.findIndex((ep) => ep.id === currentEpisodeId);
  if (idx < 0 || idx >= list.length - 1) return null;
  return list[idx + 1];
}

async function playNextEpisodeAuto() {
  if (playerClosing || playerLiveMode || !playerWatchMeta) return;
  if (playerWatchMeta.content_type !== 'episode') return;
  const seriesId = playerWatchMeta.series_id;
  const currentId = playerWatchMeta.content_id;
  if (!seriesId || !currentId) return;

  let cached;
  try {
    cached = await ensurePlayerSeriesEpisodes(seriesId);
  } catch {
    return;
  }

  const next = findNextEpisodeInList(cached.episodes, currentId);
  if (!next?.video_path) return;

  const title = `${cached.title} S${next.season}E${String(next.episode).padStart(2, '0')} - ${next.title}`;
  showSkipHint(`Siguiente capítulo · T${next.season}E${String(next.episode).padStart(2, '0')}`);
  playerWatchMeta = { content_type: 'episode', content_id: next.id, series_id: seriesId };
  lastSavedProgress = 0;
  watchSaveThrottle = 0;
  currentPlayerTitle = title;
  $('#player-title').textContent = title;
  setupVideoPlayer($('#video-player'), next.video_path, 0, 0);
}

async function onPlayerEpisodeEnded() {
  saveWatchProgress(true);
  if (playerAdvancingEpisode) return;
  playerAdvancingEpisode = true;
  try {
    await playNextEpisodeAuto();
  } finally {
    playerAdvancingEpisode = false;
  }
}

function saveWatchProgress(force = false) {
  if (!playerWatchMeta || playerLiveMode) return;
  const video = $('#video-player');
  if (!video) return;
  const current = getPlayerCurrentTime(video);
  const dur = getPlayerDuration(video);
  if (current < 5) return;
  if (!force && Math.abs(current - lastSavedProgress) < 8) return;

  lastSavedProgress = current;
  if (playerWatchMeta.external) {
    const isSeries = !!(playerWatchMeta._series || externalPlaySession?._series
      || (playerWatchMeta.season > 0 && playerWatchMeta.episode > 0));
    api('/watch/external/progress', {
      method: 'PUT',
      body: JSON.stringify({
        source: playerWatchMeta.source,
        slug: playerWatchMeta.slug,
        season: isSeries ? playerWatchMeta.season : 0,
        episode: isSeries ? playerWatchMeta.episode : 0,
        content_type: isSeries ? 'episode' : 'movie',
        progress: current,
        duration: dur,
        title: isSeries
          ? `${seriesDetailState?.data?.title || playerWatchMeta.title || ''}::${playerWatchMeta.episodeTitle || ''}`
          : (playerWatchMeta.title || ''),
        poster: playerWatchMeta.poster
          || seriesDetailState?.data?.poster
          || vodItemCache.get(`external:${playerWatchMeta.source}:${playerWatchMeta.slug}`)?.poster
          || ''
      })
    }).then(() => refreshWatchProgress().then(() => {
      if ($('#page-home')?.classList.contains('active')) loadContinueWatching();
      if ($('#page-series')?.classList.contains('active')) loadSeries();
      if ($('#page-series-detail')?.classList.contains('active') && seriesDetailState?.data?._external) {
        const { data } = seriesDetailState;
        api(`/watch/external/series/${encodeURIComponent(data.source)}/${encodeURIComponent(data.slug)}/progress`)
          .then((epProgress) => {
            seriesDetailState.episodeProgressMap = epProgress.episodes || {};
            selectSeriesSeason(seriesDetailState.selectedSeason);
            updateSeriesPlayButton(data, seriesDetailState.episodeProgressMap, seriesDetailState.selectedSeason);
          }).catch(() => {});
      }
    })).catch(() => {});
    return;
  }
  api('/watch/progress', {
    method: 'PUT',
    body: JSON.stringify({
      content_type: playerWatchMeta.content_type,
      content_id: playerWatchMeta.content_id,
      series_id: playerWatchMeta.series_id || null,
      progress: current,
      duration: dur
    })
  }).then(() => refreshWatchProgress().then(() => {
    if ($('#page-home')?.classList.contains('active')) loadContinueWatching();
    if ($('#page-movies')?.classList.contains('active')) loadMovies();
    if ($('#page-series')?.classList.contains('active')) loadSeries();
  })).catch(() => {});
}

function maybeSaveWatchProgress() {
  if (!playerWatchMeta || playerLiveMode) return;
  const now = Date.now();
  if (now - watchSaveThrottle < 10000) return;
  watchSaveThrottle = now;
  saveWatchProgress();
}

async function resumeExternalWatching(dataset) {
  const item = continueWatchingCache[`${dataset.type}-${dataset.id}`] || {
    content_type: dataset.type,
    content_id: dataset.id,
    source: dataset.source,
    slug: dataset.slug,
    season: parseInt(dataset.season, 10) || 0,
    episode: parseInt(dataset.episode, 10) || 0,
    progress: 0,
    duration: 0
  };
  if (item.content_type === 'external_episode') {
    await playExternalEpisode(
      item.source,
      item.slug,
      item.season,
      item.episode,
      `${item.series_title || item.title} T${item.season}E${item.episode}`,
      item.progress || 0,
      { title: item.title || '', poster: item.poster || '' }
    );
    return;
  }
  if (item.content_type === 'external_movie') {
    await playExternalMovie(item.source, item.slug, item.year, item.title, item.progress || 0);
  }
}

async function resumeWatching(type, id) {
  const key = `${type}-${id}`;
  let item = continueWatchingCache[key];
  if (!item) {
    const list = await api('/watch/continue');
    continueWatchingCache = {};
    list.forEach((i) => { continueWatchingCache[`${i.content_type}-${i.content_id}`] = i; });
    item = continueWatchingCache[key];
  }
  if (!item?.video_path) return toast('Video no disponible', true);

  const title = type === 'episode'
    ? `${item.series_title} S${item.season}E${item.episode} - ${item.title}`
    : item.title;
  const meta = type === 'episode'
    ? { content_type: 'episode', content_id: item.content_id, series_id: item.series_id }
    : { content_type: 'movie', content_id: item.content_id };

  playVideo(item.video_path, title, item.duration, item.progress, meta);
}

function updatePlayerProgress() {
  const video = $('#video-player');
  const played = $('#player-progress-played');
  const buffer = $('#player-progress-buffer');
  const thumb = $('#player-progress-thumb');
  const timeEl = $('#player-time');
  const wrap = $('#player-progress-wrap');
  if (!video || !timeEl) return;

  if (playerLiveMode) {
    timeEl.textContent = '🔴 En vivo';
    wrap?.classList.remove('player-loading');
    if (played) played.style.width = '0%';
    if (buffer) buffer.style.width = '0%';
    if (thumb) thumb.style.left = '0%';
    return;
  }

  const dur = getPlayerDuration(video);
  if (!dur) {
    timeEl.textContent = 'Cargando…';
    wrap?.classList.add('player-loading');
    if (played) played.style.width = '0%';
    if (buffer) buffer.style.width = '0%';
    return;
  }

  wrap?.classList.remove('player-loading');
  const current = Math.min(getPlayerCurrentTime(video), dur);
  const pct = (current / dur) * 100;
  if (played) played.style.width = `${pct}%`;
  if (thumb) thumb.style.left = `${pct}%`;

  if (buffer) {
    if (playerLocalFast) {
      buffer.style.display = 'none';
    } else {
      buffer.style.display = '';
      const bufferedEnd = getBufferedEnd(video);
      buffer.style.width = `${Math.min(100, (bufferedEnd / dur) * 100)}%`;
    }
  }

  timeEl.textContent = `${formatPlayerTime(current)} / ${formatPlayerTime(dur)}`;
  const btn = $('#player-play-pause');
  if (btn) btn.textContent = video.paused ? '▶' : '⏸';
  maybeSaveWatchProgress();
  if (!playerLiveMode && playerWatchMeta && !$('#player-modal')?.classList.contains('hidden')) {
    if (!updatePlayerProgress._actTick || Date.now() - updatePlayerProgress._actTick > 12000) {
      updatePlayerProgress._actTick = Date.now();
      sendActivityHeartbeat();
    }
  } else if (isLivePreviewActive()) {
    if (!updatePlayerProgress._liveActTick || Date.now() - updatePlayerProgress._liveActTick > 12000) {
      updatePlayerProgress._liveActTick = Date.now();
      sendActivityHeartbeat();
    }
  }
}

function reloadTranscodedAt(seconds) {
  const video = $('#video-player');
  if (!video || !playerCurrentPath || playerLiveMode) return;
  const dur = getPlayerDuration(video);
  const t = Math.max(0, Math.min(dur || seconds, seconds));
  const base = playerCurrentPath.split('?')[0];

  if (playerLocalFast || isLocalDirectPlay(base)) {
    playerStreamOffset = 0;
    lastSavedProgress = t;
    const wasPlaying = !video.paused;
    video.currentTime = t;
    updatePlayerProgress();
    if (wasPlaying) video.play().catch(() => {});
    return;
  }

  playerStreamOffset = t;
  lastSavedProgress = t;
  const wasPlaying = !video.paused;
  video.src = videoSrc(playerCurrentPath, t);
  video.load();
  updatePlayerProgress();
  if (wasPlaying) video.play().catch(() => {});
}

function hidePlayerChrome() {
  const modal = $('#player-modal');
  const video = $('#video-player');
  if (!modal?.classList.contains('player-open') || !video || video.paused || playerClosing || playerUiPinned) return;
  modal.classList.add('player-ui-hidden');
}

function showPlayerChrome({ pin = false } = {}) {
  clearTimeout(playerUiHideTimer);
  playerUiPinned = pin;
  $('#player-modal')?.classList.remove('player-ui-hidden');
  if (!pin) schedulePlayerUiHide();
}

function schedulePlayerUiHide() {
  clearTimeout(playerUiHideTimer);
  const modal = $('#player-modal');
  const video = $('#video-player');
  if (!modal?.classList.contains('player-open') || !video || video.paused || playerClosing || playerUiPinned) return;
  playerUiHideTimer = setTimeout(hidePlayerChrome, 2500);
}

function resetPlayerUiVisibility() {
  clearTimeout(playerUiHideTimer);
  playerUiPinned = false;
  $('#player-modal')?.classList.remove('player-ui-hidden');
}

function bindPlayerDoubleTapSeek(container) {
  if (!container || container.dataset.dblTapBound) return;
  container.dataset.dblTapBound = '1';
  let lastTap = 0;
  container.addEventListener('click', (e) => {
    if (playerLiveMode) return;
    if (e.target.closest('button, input, label, .player-controls, .player-progress-wrap, .player-topbar')) return;
    const modal = $('#player-modal');
    if (modal?.classList.contains('player-ui-hidden')) {
      e.preventDefault();
      e.stopPropagation();
      showPlayerChrome();
      lastTap = 0;
      return;
    }
    const now = Date.now();
    const rect = container.getBoundingClientRect();
    const x = e.clientX;
    if (now - lastTap < 450) {
      e.preventDefault();
      e.stopPropagation();
      if (x < rect.left + rect.width / 2) seekVideoBy(-10);
      else seekVideoBy(10);
      lastTap = 0;
      showPlayerChrome();
    } else {
      lastTap = now;
    }
  });
}

function seekVideoBy(delta) {
  const video = $('#video-player');
  const dur = getPlayerDuration(video);
  if (playerLiveMode || !dur) return;
  const base = (playerCurrentPath || '').split('?')[0];
  const next = Math.max(0, Math.min(dur, getPlayerCurrentTime(video) + delta));

  if (playerLocalFast || isLocalDirectPlay(base)) {
    playerStreamOffset = 0;
    video.currentTime = next;
    lastSavedProgress = next;
    updatePlayerProgress();
    showSkipHint(delta > 0 ? `+${delta}s` : `${delta}s`);
    return;
  }

  if (needsStreamReload(playerCurrentPath)) {
    reloadTranscodedAt(next);
    showSkipHint(delta > 0 ? `+${delta}s` : `${delta}s`);
    return;
  }
  video.currentTime = next;
  lastSavedProgress = next;
  updatePlayerProgress();
  showSkipHint(delta > 0 ? `+${delta}s` : `${delta}s`);
}

function seekVideoTo(clientX) {
  const video = $('#video-player');
  const bar = $('#player-progress');
  const dur = getPlayerDuration(video);
  if (!video || !bar || playerLiveMode || !dur) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const target = pct * dur;
  const base = (playerCurrentPath || '').split('?')[0];

  if (playerLocalFast || isLocalDirectPlay(base)) {
    playerStreamOffset = 0;
    video.currentTime = target;
    lastSavedProgress = target;
    updatePlayerProgress();
    return;
  }

  if (needsStreamReload(playerCurrentPath)) {
    reloadTranscodedAt(target);
    return;
  }
  video.currentTime = target;
  lastSavedProgress = target;
  updatePlayerProgress();
}

function setPlayerLiveMode(live) {
  playerLiveMode = live;
  $('#player-controls')?.classList.toggle('player-live', live);
  $('#player-tap-zones')?.classList.toggle('hidden', live);
  $('#player-live-bar')?.classList.toggle('hidden', !live);
  if (live) {
    $('#player-quality-menu')?.classList.add('hidden');
    setPlayerQualityVisible(false);
    $('#player-subtitle-wrap')?.classList.add('hidden');
  }
  const liveTime = $('#player-live-time');
  if (live && liveTime) liveTime.textContent = formatLiveClock();
  const video = $('#video-player');
  const playerMute = $('#player-mute');
  if (live && video) {
    video.muted = false;
    video.volume = Math.max(0.6, Number($('#player-volume')?.value || 100) / 100);
    if (playerMute) {
      playerMute.textContent = '🔊';
      playerMute.classList.remove('is-muted');
    }
  }
  updatePlayerProgress();
}

function bindPlayerControls() {
  if (playerControlsBound) return;
  playerControlsBound = true;
  const video = $('#video-player');
  const progressWrap = $('#player-progress-wrap');
  const videoWrap = $('#player-video-wrap');
  if (!video || !progressWrap) return;

  ['timeupdate', 'loadedmetadata', 'play', 'pause', 'progress', 'seeked', 'ended'].forEach(ev => {
    video.addEventListener(ev, updatePlayerProgress);
  });
  video.addEventListener('playing', () => {
    playerUiPinned = false;
    schedulePlayerUiHide();
  });
  video.addEventListener('play', () => {
    playerUiPinned = false;
    schedulePlayerUiHide();
  });
  video.addEventListener('pause', () => showPlayerChrome({ pin: true }));
  video.addEventListener('ended', () => { onPlayerEpisodeEnded(); });

  let lastPointerReveal = 0;
  const onPointerReveal = () => {
    const modal = $('#player-modal');
    if (!modal?.classList.contains('player-ui-hidden')) return;
    const now = Date.now();
    if (now - lastPointerReveal < 300) return;
    lastPointerReveal = now;
    showPlayerChrome();
  };
  videoWrap?.addEventListener('mousemove', onPointerReveal);
  videoWrap?.addEventListener('touchstart', onPointerReveal, { passive: true });

  window.addEventListener('pagehide', () => saveWatchProgress(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveWatchProgress(true);
  });

  $('#player-play-pause')?.addEventListener('click', () => {
    if (video.paused) {
      playerUiPinned = false;
      video.play().catch(() => {});
    } else {
      video.pause();
      saveWatchProgress(true);
      showPlayerChrome({ pin: true });
    }
    updatePlayerProgress();
  });

  $('#player-seek-back')?.addEventListener('click', () => { showPlayerChrome(); seekVideoBy(-10); });
  $('#player-seek-forward')?.addEventListener('click', () => { showPlayerChrome(); seekVideoBy(10); });

  bindPlayerDoubleTapSeek($('#player-tap-zones'));
  bindPlayerDoubleTapSeek($('#player-video-wrap'));

  const seekFromEvent = (e) => {
    if (playerLiveMode) return;
    showPlayerChrome();
    const x = e.touches?.length ? e.touches[0].clientX : e.clientX;
    seekVideoTo(x);
  };

  progressWrap.addEventListener('click', seekFromEvent);
  progressWrap.addEventListener('touchstart', (e) => { seekFromEvent(e); }, { passive: true });
  progressWrap.addEventListener('touchmove', (e) => { seekFromEvent(e); }, { passive: true });

  let dragging = false;
  progressWrap.addEventListener('mousedown', (e) => {
    if (playerLiveMode) return;
    e.preventDefault();
    dragging = true;
    seekFromEvent(e);
  });
  window.addEventListener('mousemove', (e) => { if (dragging) seekFromEvent(e); });
  window.addEventListener('mouseup', () => { dragging = false; });

  document.addEventListener('keydown', (e) => {
    if ($('#player-modal')?.classList.contains('hidden')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); showPlayerChrome(); seekVideoBy(10); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); showPlayerChrome(); seekVideoBy(-10); }
    if (e.key === ' ') {
      e.preventDefault();
      if (video.paused) {
        playerUiPinned = false;
        video.play().catch(() => {});
      } else {
        video.pause();
        showPlayerChrome({ pin: true });
      }
      updatePlayerProgress();
    }
  });

  bindPlayerDoubleTapSeek(video);
}

function openPlayer(title) {
  stopHeroSlider();
  if (VIX_PLATFORM === 'tv') stopLivePreview();
  resetPlayerUiVisibility();
  window.VixCast?.refreshButtons?.();
  const modal = $('#player-modal');
  clearTimeout(playerCloseTimer);
  modal.classList.remove('hidden', 'player-open');
  modal.classList.add('player-fullscreen-mode');
  currentPlayerTitle = title || '';
  $('#mobile-bottom-nav')?.classList.add('hidden');
  $('#player-title').textContent = title;
  document.body.style.overflow = 'hidden';
  sendActivityHeartbeat();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => modal.classList.add('player-open'));
  });
}

function clearPlayerLoading() {
  const wrap = $('#player-video-wrap');
  wrap?.classList.remove('player-video-loading', 'player-loading-live', 'player-loading-vod');
  schedulePlayerUiHide();
}

function finishClosePlayer(wasLive, resumeLive, handedBack) {
  clearExternalStreamRefresh();
  externalPlaySession = null;
  externalPlayPrefetch = null;
  resetPlayerQualityUi();
  const modal = $('#player-modal');
  modal.classList.add('hidden');
  modal.classList.remove('player-fullscreen-mode', 'player-open');
  $('#player-video-wrap')?.classList.remove('player-video-loading', 'player-loading-live', 'player-loading-vod');
  $('#mobile-bottom-nav')?.classList.remove('hidden');
  setTimeout(() => {
    playerClosing = false;
    if (resumeLive && !livePreviewHls && !$('#live-preview-video')?.src) restoreLivePreview();
  }, 80);
  refreshWatchProgress().then(() => {
    if ($('#page-home')?.classList.contains('active')) loadContinueWatching();
  });
  sendActivityHeartbeat();
}

function closePlayer() {
  const wasLive = playerLiveMode;
  resetPlayerUiVisibility();
  clearLivePlayerWatchdog();
  saveWatchProgress(true);
  playerClosing = true;
  playerWatchMeta = null;
  playerSeriesEpisodesCache = null;
  playerAdvancingEpisode = false;
  playerCurrentPath = '';
  playerStreamOffset = 0;
  lastSavedProgress = 0;
  watchSaveThrottle = 0;
  const modal = $('#player-modal');
  modal.classList.remove('player-open');
  $('#mobile-bottom-nav')?.classList.remove('hidden');
  setPlayerLiveMode(false);
  const video = $('#video-player');
  clearNativeLiveHandlers(video);
  video.onerror = null;
  video.onwaiting = null;
  video.onstalled = null;
  video.pause();
  document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const resumeLive = wasLive && $('#page-live')?.classList.contains('active');
  const handedBack = resumeLive && handoffModalToPreview();
  if (!handedBack) {
    destroyHls();
    liveHlsOwner = null;
  }
  video.removeAttribute('src');
  video.load();
  clearTimeout(playerCloseTimer);
  playerCloseTimer = setTimeout(() => finishClosePlayer(wasLive, resumeLive, handedBack), 220);
}

function localStreamApiUrl(path, opts = {}) {
  let url = path;
  if (path.startsWith('/uploads/movies/')) {
    url = `/api/stream/movies/${path.replace('/uploads/movies/', '')}`;
  } else if (path.startsWith('/uploads/series/')) {
    url = `/api/stream/series/${path.replace('/uploads/series/', '')}`;
  } else if (path.startsWith('/uploads/winscp/')) {
    url = `/api/stream/winscp/${path.replace('/uploads/winscp/', '')}`;
  }
  if (opts.forceTranscode) {
    url += `${url.includes('?') ? '&' : '?'}transcode=1`;
  }
  return url;
}

function videoSrc(path, startSec = 0, opts = {}) {
  if (!path) return '';
  const base = path.split('?')[0];
  let url = path;
  if (/^https?:\/\//i.test(path)) {
    const meta = playerWatchMeta || {};
    url = proxyStreamUrl(path, meta.referer || '', {
      title: meta.title || currentPlayerTitle || '',
      content_type: meta.content_type || '',
      status: meta.content_type === 'episode' ? 'watching_episode' : 'watching_movie',
      content_id: meta.content_id ?? meta.slug ?? ''
    });
  } else if (isLocalDirectPlay(base)) {
    url = base;
  } else if (isLocalUpload(base)) {
    url = localStreamApiUrl(base, opts);
    if (startSec > 0 && /\.mkv$/i.test(base)) url += `${url.includes('?') ? '&' : '?'}t=${Math.floor(startSec)}`;
  }
  if (startSec > 0 && needsStreamReload(path) && !/[\?&]t=/.test(url)) {
    url += `${url.includes('?') ? '&' : '?'}t=${Math.floor(startSec)}`;
  }
  return url;
}

function attachSubtitleTrack(video, subtitlePath) {
  if (!video) return;
  video.querySelectorAll('track[data-vix-sub]').forEach((t) => t.remove());
  const sub = String(subtitlePath || '').trim();
  if (!sub) return;
  if (localStorage.getItem(SUBTITLE_PREF_KEY) === null) playerSubtitlesEnabled = true;
  const src = sub.startsWith('http') ? sub : sub;
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.src = src;
  track.srclang = 'es';
  track.label = 'Español';
  track.default = playerSubtitlesEnabled;
  track.setAttribute('data-vix-sub', '1');
  video.appendChild(track);
  video.addEventListener('loadedmetadata', () => {
    applySubtitlePreference();
    refreshSubtitleButton();
  }, { once: true });
}

function setupVideoPlayer(video, path, durationHint = 0, startTime = 0, live = false, subtitlePath = '') {
  playerClosing = false;
  playerCurrentPath = path;
  playerKnownDuration = durationHint > 0 ? durationHint : 0;
  playerLocalFast = isLocalDirectPlay(path);
  const needsReload = needsStreamReload(path);
  playerStreamOffset = needsReload && startTime >= 5 ? startTime : 0;
  destroyHls();
  if (!path) {
    toast('Video no disponible', true);
    return;
  }
  const isHls = /\.m3u8|\.m3u/i.test(path) || /\/live\/ch\/\d+\/play\.m3u8/i.test(path);
  const src = videoSrc(path, playerStreamOffset);
  const isLiveHls = live || playerLiveMode;
  let usedMkvFallback = false;
  let usedRemuxFromStart = false;
  let usedForceTranscode = false;

  video.preload = 'auto';
  if (!live) attachSubtitleTrack(video, subtitlePath);
  const wrap = $('#player-video-wrap');
  wrap?.classList.toggle('player-loading-live', isLiveHls);
  wrap?.classList.toggle('player-loading-vod', !isLiveHls);
  wrap?.classList.add('player-video-loading');
  if (!live && !isLiveHls) {
    video.muted = false;
    video.volume = Math.max(0.7, Number($('#player-volume')?.value || 100) / 100);
  }
  const onReady = () => clearPlayerLoading();
  video.addEventListener('playing', onReady, { once: true });
  video.addEventListener('canplay', onReady, { once: true });
  video.addEventListener('playing', pulsePlaybackActivity);
  video.addEventListener('timeupdate', pulsePlaybackActivity);

  const seekToStart = () => {
    if (playerClosing || !startTime || startTime < 5) return;
    const dur = getPlayerDuration(video);
    if (dur && startTime >= dur - 15) return;
    if (needsReload && !playerLocalFast) {
      lastSavedProgress = playerStreamOffset;
      updatePlayerProgress();
      return;
    }
    playerStreamOffset = 0;
    video.currentTime = Math.min(startTime, Math.max(0, (dur || startTime + 3600) - 5));
    lastSavedProgress = video.currentTime;
    updatePlayerProgress();
  };

  video.addEventListener('loadedmetadata', seekToStart, { once: true });
  video.addEventListener('canplay', seekToStart, { once: true });

  if (isLocalUpload(path) || needsReload) {
    fetchStreamDuration(path).then((d) => applyPlayerDuration(d));
  }

  video.onerror = () => {
    if (playerClosing) return;
    const basePath = (path || '').split('?')[0];
    if (!usedRemuxFromStart && needsReload && playerStreamOffset > 0) {
      usedRemuxFromStart = true;
      playerStreamOffset = 0;
      lastSavedProgress = 0;
      toast('No se pudo saltar ahí. Reproduciendo desde el inicio…', false);
      video.src = videoSrc(basePath, 0);
      video.load();
      video.play().catch(() => {});
      return;
    }
    if (!usedMkvFallback && /\.mp4$/i.test(basePath)) {
      const mkvPath = basePath.replace(/\.mp4$/i, '.mkv');
      if (mkvPath !== basePath) {
        usedMkvFallback = true;
        playerLocalFast = false;
        playerCurrentPath = mkvPath;
        const off = usedRemuxFromStart ? 0 : (playerStreamOffset || (startTime >= 5 ? startTime : 0));
        video.src = videoSrc(mkvPath, off);
        video.load();
        video.play().catch(() => {});
        return;
      }
    }
    if (isLocalRangePlay(path) && /\.mkv(\?|$)/i.test(path) && !usedMkvFallback) {
      usedMkvFallback = true;
      playerLocalFast = false;
      video.src = videoSrc(basePath, 0);
      video.load();
      video.play().catch(() => {});
      return;
    }
    if (needsReload && !usedForceTranscode) {
      usedForceTranscode = true;
      playerStreamOffset = 0;
      toast('Reintentando con conversión completa…', false);
      video.src = videoSrc(basePath, 0, { forceTranscode: true });
      video.load();
      video.play().catch(() => {});
      return;
    }
    toast(needsReload
      ? 'Error al convertir el video. Intenta de nuevo en unos segundos.'
      : 'No se pudo reproducir. Formato no soportado o enlace caído.', true);
  };

  if (needsReload && !playerLocalFast) {
    toast('Preparando video… puede tardar unos segundos', false);
  }

  if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
    let liveStarted = false;
    const startPlayback = () => {
      if (playerClosing || liveStarted) return;
      liveStarted = true;
      video.play().catch(() => { if (!playerClosing) toast('Pulsa play para iniciar', true); });
    };
    const onWaiting = () => {
      if (isLiveHls && hlsInstance) nudgeLiveHlsToEdge(hlsInstance, video);
    };
    video.onwaiting = onWaiting;
    video.onstalled = onWaiting;
    hlsInstance = new Hls(createHlsConfig(isLiveHls));
    hlsInstance.loadSource(src);
    hlsInstance.attachMedia(video);
    if (isLiveHls) {
      liveHlsOwner = 'player';
      attachLiveHlsHandlers(hlsInstance, video, { preview: false, autoplay: false });
      hlsInstance.on(Hls.Events.FRAG_BUFFERED, () => {
        clearPlayerLoading();
        startPlayback();
      });
      setTimeout(() => startPlayback(), 2000);
      startLiveStallWatchdog(video, {
        mode: 'player',
        isActive: () => playerLiveMode && !playerClosing && !$('#player-modal')?.classList.contains('hidden'),
        getHls: () => hlsInstance,
        onRecover: (soft) => recoverLivePlayer(soft)
      });
    } else {
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (playerClosing) return;
        clearPlayerLoading();
        onHlsManifestReady(hlsInstance, externalPlaySession?.maxHeight || 0);
        startPlayback();
      });
      hlsInstance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        preferSpanishLatinoHlsTracks(hlsInstance);
        refreshSubtitleButton();
        applySubtitlePreference();
      });
      hlsInstance.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        preferSpanishLatinoHlsTracks(hlsInstance);
      });
      hlsInstance.on(Hls.Events.ERROR, (_, data) => {
        if (playerClosing || !data.fatal) return;
        if (externalPlaySession) {
          refreshExternalStream({ silent: true }).then((ok) => {
            if (!ok && !playerClosing) {
              clearPlayerLoading();
              toast('Error al cargar stream', true);
            }
          });
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hlsInstance.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hlsInstance.recoverMediaError();
          return;
        }
        toast('Error al cargar stream', true);
      });
    }
  } else if (isHls && prefersNativeHls(video)) {
    playNativeLiveVideo(video, src).then(() => {
      if (!playerClosing) clearPlayerLoading();
    });
  } else {
    video.src = src;
    video.load();
    video.play().catch(() => { if (!playerClosing) toast('Pulsa play para iniciar', true); });
  }
  setTimeout(updatePlayerProgress, 500);
}

function playVideo(path, title, durationHint = 0, startTime = 0, watchMeta = null) {
  playerWatchMeta = watchMeta;
  openPlayer(title);
  setPlayerLiveMode(false);
  if (!watchMeta?.external) resetPlayerQualityUi();
  playerLocalFast = false;
  if (watchMeta?.content_type === 'episode' && watchMeta.series_id) {
    ensurePlayerSeriesEpisodes(watchMeta.series_id).catch(() => {});
  }
  lastSavedProgress = startTime || 0;
  watchSaveThrottle = 0;
  if (startTime >= 30) showSkipHint('Continuando…');
  const liveInfo = $('#live-player-info');
  liveInfo?.classList.add('hidden');
  const logoEl = $('#live-channel-logo');
  if (logoEl) {
    logoEl.removeAttribute('src');
    logoEl.style.display = 'none';
  }
  setupVideoPlayer($('#video-player'), path, durationHint, startTime, false, watchMeta?.subtitle_path || '');
}

function playLive(channelId, url, name, logo) {
  enableLiveAudio();
  playerKnownDuration = 0;
  playerWatchMeta = null;
  setPlayerLiveMode(true);
  openPlayer('🔴 ' + name);
  $('#live-player-info').classList.remove('hidden');
  $('#live-channel-name').textContent = name;
  const logoEl = $('#live-channel-logo');
  if (logo) { logoEl.src = logo; logoEl.style.display = 'block'; }
  else logoEl.style.display = 'none';

  const begin = async () => {
    const ch = allChannels.find((c) => String(c.id) === String(channelId));
    const playUrl = livePlayUrl(channelId, ch?.stream_url || url);
    const modalVideo = $('#video-player');
    if (canSeamlessLiveHandoff(channelId) && modalVideo) {
      handoffPreviewToModal(modalVideo, playUrl);
      return;
    }
    stopLivePreview();
    setupVideoPlayer(modalVideo, playUrl, 0, 0, true);
  };
  begin();
}

function destroyHls() {
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
}

$('#player-close').addEventListener('click', closePlayer);

$('#player-fullscreen')?.addEventListener('click', () => {
  const modal = $('#player-modal');
  const video = $('#video-player');
  if (video.requestFullscreen) {
    video.requestFullscreen().catch(() => {
      modal.classList.toggle('player-fullscreen-mode');
    });
  } else if (video.webkitEnterFullscreen) {
    video.webkitEnterFullscreen();
  } else {
    modal.classList.toggle('player-fullscreen-mode');
  }
});

$('#player-quality-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('#player-quality-menu');
  if (!menu) return;
  const open = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !open);
  if (open) showPlayerChrome({ pin: true });
});

$('#player-subtitle-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlayerSubtitles();
  showPlayerChrome({ pin: true });
});

document.addEventListener('click', (e) => {
  const wrap = $('#player-quality-wrap');
  const menu = $('#player-quality-menu');
  if (!wrap || !menu || menu.classList.contains('hidden')) return;
  if (!wrap.contains(e.target)) menu.classList.add('hidden');
});
