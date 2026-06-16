import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { vixApi, getAuthToken, setAuthToken } from '../api/vixApi';
import { listFavorites as listLocalFavorites } from '../lib/favorites';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [favorites, setFavorites] = useState([]);
  const [playlists, setPlaylists] = useState([]);

  const refreshFavorites = useCallback(async () => {
    if (!getAuthToken()) {
      setFavorites(listLocalFavorites());
      return listLocalFavorites();
    }
    const res = await vixApi.listFavorites();
    setFavorites(res.items || []);
    return res.items || [];
  }, []);

  const refreshPlaylists = useCallback(async () => {
    if (!getAuthToken()) {
      setPlaylists([]);
      return [];
    }
    const res = await vixApi.listPlaylists();
    setPlaylists(res.items || []);
    return res.items || [];
  }, []);

  const bootstrap = useCallback(async () => {
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      setFavorites(listLocalFavorites());
      setPlaylists([]);
      setLoading(false);
      return;
    }
    try {
      const res = await vixApi.me();
      setUser(res.user);
      const local = listLocalFavorites();
      if (local.length) {
        await vixApi.syncFavorites(local);
      }
      await refreshFavorites();
      await refreshPlaylists();
    } catch {
      setAuthToken('');
      setUser(null);
      setFavorites(listLocalFavorites());
    } finally {
      setLoading(false);
    }
  }, [refreshFavorites, refreshPlaylists]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (username, password) => {
    const res = await vixApi.login({ username, password });
    setAuthToken(res.token);
    setUser(res.user);
    const local = listLocalFavorites();
    if (local.length) await vixApi.syncFavorites(local);
    await refreshFavorites();
    await refreshPlaylists();
    return res.user;
  }, [refreshFavorites, refreshPlaylists]);

  const register = useCallback(async ({ username, email, password, displayName }) => {
    const res = await vixApi.register({ username, email, password, displayName });
    setAuthToken(res.token);
    setUser(res.user);
    const local = listLocalFavorites();
    if (local.length) await vixApi.syncFavorites(local);
    await refreshFavorites();
    await refreshPlaylists();
    return res.user;
  }, [refreshFavorites, refreshPlaylists]);

  const logout = useCallback(() => {
    setAuthToken('');
    setUser(null);
    setFavorites(listLocalFavorites());
    setPlaylists([]);
  }, []);

  const isFavorite = useCallback(
    (id) => favorites.some((t) => t.id === id),
    [favorites],
  );

  const toggleFavorite = useCallback(
    async (track) => {
      if (!user) {
        const { toggleFavorite: localToggle } = await import('../lib/favorites');
        const list = localToggle(track);
        setFavorites(list);
        return list;
      }
      if (isFavorite(track.id)) {
        await vixApi.removeFavorite(track.id);
      } else {
        await vixApi.addFavorite(track);
      }
      return refreshFavorites();
    },
    [user, isFavorite, refreshFavorites],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      isLoggedIn: Boolean(user),
      isAdmin: user?.role === 'admin',
      favorites,
      playlists,
      login,
      register,
      logout,
      refreshFavorites,
      refreshPlaylists,
      isFavorite,
      toggleFavorite,
      bootstrap,
    }),
    [
      user,
      loading,
      favorites,
      playlists,
      login,
      register,
      logout,
      refreshFavorites,
      refreshPlaylists,
      isFavorite,
      toggleFavorite,
      bootstrap,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
