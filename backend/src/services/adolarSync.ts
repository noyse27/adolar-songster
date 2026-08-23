import { pool } from '../db/pool';
import { AdolarClientError, fetchAllPlaylistTracks, listPlaylists } from './adolarClient';
import { upsertSongRefTrack } from './adolarBatch';

export interface AdolarSyncResult {
  playlistCount: number;
  trackCount: number;
}

/** Daily full-library sync (see scheduler.ts): mirrors every track of
 * every playlist Adolar currently exposes to Songster into song_ref, so a
 * table's game-time batch fetch (loadAdolarBatch) - and the admin's
 * Song-Pool view - reflect songs added on the Adolar side without needing
 * to wait for someone to start a session on that specific playlist first.
 * Tracks without a usable year are skipped, same rule as game-time upserts. */
export async function syncAllAdolarPlaylists(): Promise<AdolarSyncResult> {
  let playlists;
  try {
    playlists = await listPlaylists();
  } catch (err) {
    if (err instanceof AdolarClientError && err.code === 'NOT_CONFIGURED') {
      return { playlistCount: 0, trackCount: 0 };
    }
    throw err;
  }

  let trackCount = 0;
  for (const playlist of playlists) {
    const tracks = await fetchAllPlaylistTracks(playlist.id);
    for (const track of tracks) {
      if (track.year === null) continue;
      const { songRefId } = await upsertSongRefTrack(pool, track);
      await pool.query(
        `INSERT INTO adolar_playlist_track (playlist_id, song_ref_id, synced_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (playlist_id, song_ref_id) DO UPDATE SET synced_at = NOW()`,
        [playlist.id, songRefId],
      );
      trackCount += 1;
    }
  }

  return { playlistCount: playlists.length, trackCount };
}
