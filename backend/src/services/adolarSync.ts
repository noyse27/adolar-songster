import { pool } from '../db/pool';
import { AdolarClientError, fetchAllPlaylistTracks, listPlaylists } from './adolarClient';
import { upsertSongRefTrack } from './adolarBatch';

export interface AdolarSyncResult {
  playlistCount: number;
  trackCount: number;
}

export type AdolarSyncState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: string }
  | { status: 'completed'; finishedAt: string; result: AdolarSyncResult }
  | { status: 'failed'; finishedAt: string; error: string };

let syncState: AdolarSyncState = { status: 'idle' };

export function getSyncState(): AdolarSyncState {
  return syncState;
}

/** Kicks off syncAllAdolarPlaylists() in the background instead of making
 * the caller wait on it - a real ~8000-track playlist takes well over a
 * minute to page through and upsert, which routinely exceeded nginx's
 * default 60s proxy_read_timeout on the admin "Sync jetzt" button (504,
 * shown to the admin as "Sync fehlgeschlagen" even though the sync itself
 * was still running server-side and completed fine a bit later - see
 * routes/admin.ts). Callers poll getSyncState() instead of holding the
 * connection open. Returns started:false without doing anything if a sync
 * is already in flight, rather than running two full syncs concurrently. */
export function triggerBackgroundSync(): { started: boolean } {
  if (syncState.status === 'running') {
    return { started: false };
  }
  syncState = { status: 'running', startedAt: new Date().toISOString() };
  syncAllAdolarPlaylists()
    .then((result) => {
      syncState = { status: 'completed', finishedAt: new Date().toISOString(), result };
    })
    .catch((err) => {
      syncState = {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    });
  return { started: true };
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
    // Local catalog (adolar_playlist) so table creation, session start, and
    // the playlist dropdowns can check name/availability without calling
    // Adolar live on every request - see adolarPlaylistCatalog.ts.
    await pool.query(
      `INSERT INTO adolar_playlist (id, name, description, synced_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, synced_at = NOW()`,
      [playlist.id, playlist.name, playlist.description],
    );

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

  // Drops catalog rows for playlists Adolar no longer lists, so a
  // deleted/disabled playlist is caught by table creation/session start's
  // local availability check as of the next sync, instead of staying
  // "available" forever (see adolarPlaylistCatalog.ts).
  await pool.query(`DELETE FROM adolar_playlist WHERE id != ALL($1::int[])`, [playlists.map((p) => p.id)]);

  return { playlistCount: playlists.length, trackCount };
}
