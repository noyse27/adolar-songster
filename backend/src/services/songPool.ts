import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { RoundEngineError } from './errors';

type Queryable = PoolClient | typeof pool;

export interface SelectedSong {
  id: string;
  title: string;
  yearValue: number;
  durationSec: number | null;
}

// Feinkonzept 4.3: candidates are valid songs not yet played in this game
// nor in this table session; once the whole playlist has been exhausted in
// the session, the session pool resets so repeats become possible again.
export async function selectSongForGame(
  client: Queryable,
  gameId: string,
  tableSessionId: string,
): Promise<SelectedSong> {
  const candidates = await fetchCandidates(client, gameId, tableSessionId);

  if (candidates.length > 0) {
    const song = pickRandom(candidates);
    await markPlayed(client, song.id);
    return song;
  }

  // A scoped pool (Adolar-sourced table, see adolarBatch.ts) is the "total"
  // to compare the session history against for exhaustion, not the whole
  // song_ref library - otherwise a 50-song batch table would never be seen
  // as exhausted while other tables' songs still sit in the shared library.
  const totalValidResult = await client.query(
    `SELECT COUNT(*)::int AS count FROM song_ref sr
     WHERE sr.is_valid = TRUE
       AND (
         NOT EXISTS (SELECT 1 FROM table_session_song_pool WHERE table_session_id = $1)
         OR sr.id IN (SELECT song_ref_id FROM table_session_song_pool WHERE table_session_id = $1)
       )`,
    [tableSessionId],
  );
  const historyCountResult = await client.query(
    `SELECT COUNT(*)::int AS count FROM session_song_history WHERE table_session_id = $1`,
    [tableSessionId],
  );
  const playlistExhausted =
    totalValidResult.rows[0].count > 0 &&
    historyCountResult.rows[0].count >= totalValidResult.rows[0].count;

  if (playlistExhausted) {
    await client.query(`DELETE FROM session_song_history WHERE table_session_id = $1`, [tableSessionId]);
    const candidatesAfterReset = await fetchCandidates(client, gameId, tableSessionId);
    if (candidatesAfterReset.length > 0) {
      const song = pickRandom(candidatesAfterReset);
      await markPlayed(client, song.id);
      return song;
    }
  }

  throw new RoundEngineError('NO_SONGS_AVAILABLE', 'no eligible songs left in the playlist');
}

// Section 4.4: malus/repeat-avoidance bookkeeping, independent of Adolar's
// own play_count. Updated on every actual selection, not on every pool
// insert (see adolarBatch.ts, which deliberately leaves this untouched).
async function markPlayed(client: Queryable, songId: string): Promise<void> {
  await client.query(`UPDATE song_ref SET last_played_at = NOW() WHERE id = $1`, [songId]);
}

// A session with a scoped pool (table_session_song_pool) is restricted to
// just those song_ref rows (the fixed 50-song Adolar batch drawn once at
// session start, see adolarBatch.ts); a session with no scoped pool rows
// keeps drawing from the entire song_ref library, unchanged from before the
// Adolar integration.
async function fetchCandidates(
  client: Queryable,
  gameId: string,
  tableSessionId: string,
): Promise<SelectedSong[]> {
  const result = await client.query(
    `SELECT sr.id, sr.title, sr.year_value, sr.duration_sec
     FROM song_ref sr
     WHERE sr.is_valid = TRUE
       AND sr.year_value IS NOT NULL
       AND sr.id NOT IN (SELECT song_id FROM round WHERE game_id = $1)
       AND sr.id NOT IN (SELECT song_ref_id FROM session_song_history WHERE table_session_id = $2)
       AND (
         NOT EXISTS (SELECT 1 FROM table_session_song_pool WHERE table_session_id = $2)
         OR sr.id IN (SELECT song_ref_id FROM table_session_song_pool WHERE table_session_id = $2)
       )`,
    [gameId, tableSessionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    yearValue: row.year_value,
    durationSec: row.duration_sec,
  }));
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
