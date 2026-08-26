import { pool } from '../db/pool';

export interface PlaylistCleanupResult {
  deletedPlaylistIds: string[];
}

// Playlist-Tracking (Fehleranalyse): Playlists werden 1 Woche aufbewahrt
// (expires_at, siehe game_playlist-Migration) und danach hart geloescht -
// game_playlist_track haengt per ON DELETE CASCADE daran. Laeuft periodisch
// (siehe scheduler.ts), analog zu tableCleanup.ts's Tisch-Bereinigung.
export async function deleteExpiredPlaylists(): Promise<PlaylistCleanupResult> {
  const result = await pool.query(
    `DELETE FROM game_playlist WHERE expires_at <= NOW() RETURNING id`,
  );
  return { deletedPlaylistIds: result.rows.map((row) => row.id) };
}
