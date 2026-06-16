/** ID estable para guardar/reproducir offline la misma canción */
export function getOfflineId(track) {
  if (!track) return '';
  if (track.spotifyId) return `sp-${track.spotifyId}`;
  if (track.videoId) return `yt-${track.videoId}`;
  return String(track.id || `${track.title}|${track.artist}`);
}
