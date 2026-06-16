import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { OfflineProvider } from './context/OfflineContext';
import { AuthProvider } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import TopBar from './components/TopBar';
import NowPlayingPanel from './components/NowPlayingPanel';
import YouTubePlayerHost from './components/YouTubePlayerHost';
import BottomPlayer from './components/BottomPlayer';
import SettingsModal from './components/SettingsModal';
import HomeView from './views/HomeView';
import SearchView from './views/SearchView';
import { PlayerProvider } from './context/PlayerContext';
import LibraryView from './views/LibraryView';
import DownloadsView from './views/DownloadsView';
import ArtistsView from './views/ArtistsView';
import ArtistView from './views/ArtistView';
import LoginView from './views/LoginView';
import RegisterView from './views/RegisterView';
import AccountView from './views/AccountView';
import AdminView from './views/AdminView';
import PlaylistsView from './views/PlaylistsView';
import { initAppConfig, getConfigStatus } from './api/config';
import { getRouterBasename } from './lib/platform';
import './index.css';

const PANEL_KEY = 'vixmusic_panel_open';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cfg, setCfg] = useState({ spotify: false });
  const [booting, setBooting] = useState(true);
  const [panelOpen, setPanelOpen] = useState(() => {
    const v = localStorage.getItem(PANEL_KEY);
    return v === null ? true : v === '1';
  });
  const [nowPlayingView, setNowPlayingView] = useState(false);

  const openNowPlaying = () => {
    if (window.innerWidth > 1100) {
      setPanelOpen(true);
      localStorage.setItem(PANEL_KEY, '1');
    } else {
      setNowPlayingView(true);
    }
  };

  const closeNowPlayingView = () => setNowPlayingView(false);

  const togglePanel = () => {
    setPanelOpen((o) => {
      const next = !o;
      localStorage.setItem(PANEL_KEY, next ? '1' : '0');
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initAppConfig();
      if (!cancelled) {
        setCfg(getConfigStatus());
        setBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (booting) {
    return (
      <div className="boot-screen">
        <img src={`${import.meta.env.BASE_URL || '/'}logo.svg`} alt="" className="boot-screen__logo" width="56" height="56" />
        <span>Cargando VixMusic…</span>
      </div>
    );
  }

  return (
    <AuthProvider>
    <OfflineProvider>
      <PlayerProvider>
        <BrowserRouter basename={getRouterBasename()}>
        <div className={`app-frame ${nowPlayingView ? 'app-frame--now-playing' : ''}`}>
          <YouTubePlayerHost />
          <div className={`spotify-app ${panelOpen ? '' : 'spotify-app--panel-hidden'}`}>
            <Sidebar />
            <div className="spotify-main">
              <TopBar
                onOpenSettings={() => setSettingsOpen(true)}
                panelOpen={panelOpen}
                onTogglePanel={togglePanel}
              />
              {!cfg.spotify && (
                <div className="api-banner" onClick={() => setSettingsOpen(true)} role="button" tabIndex={0}>
                  ⚠ Configura Spotify Client ID + Secret en Ajustes para buscar artistas y canciones
                </div>
              )}
              <div className="spotify-content">
                <Routes>
                  <Route path="/" element={<HomeView key={cfg.spotify ? 'sp' : 'piped'} />} />
                  <Route path="/buscar" element={<SearchView />} />
                  <Route path="/biblioteca" element={<LibraryView />} />
                  <Route path="/descargas" element={<DownloadsView />} />
                  <Route path="/artistas" element={<ArtistsView />} />
                  <Route path="/artista/:artistId" element={<ArtistView />} />
                  <Route path="/playlists" element={<PlaylistsView />} />
                  <Route path="/login" element={<LoginView />} />
                  <Route path="/registro" element={<RegisterView />} />
                  <Route path="/cuenta" element={<AccountView />} />
                  <Route path="/admin" element={<AdminView />} />
                </Routes>
              </div>
            </div>
            <NowPlayingPanel
              open={panelOpen}
              onClose={togglePanel}
              viewOpen={nowPlayingView}
              onCloseView={closeNowPlayingView}
            />
            <MobileNav />
          </div>
          <BottomPlayer onOpenNowPlaying={openNowPlaying} />
        </div>
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setCfg(getConfigStatus())}
        />
      </BrowserRouter>
      </PlayerProvider>
    </OfflineProvider>
    </AuthProvider>
  );
}
