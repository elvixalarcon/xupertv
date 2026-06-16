import { getAuthToken, vixApi } from '../api/vixApi';
import { addPlayHistory } from './playHistory';

const lastRecorded = { id: '', at: 0 };

/** Registra una reproducción localmente y en el servidor si hay sesión. */
export function recordPlayForUser(track) {
  if (!track?.id) return;
  const now = Date.now();
  if (lastRecorded.id === track.id && now - lastRecorded.at < 45000) return;
  lastRecorded.id = track.id;
  lastRecorded.at = now;

  addPlayHistory(track);
  if (getAuthToken()) {
    vixApi.addHistory(track).catch(() => {});
  }
}
