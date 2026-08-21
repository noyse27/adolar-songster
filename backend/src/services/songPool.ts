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
    return pickRandom(candidates);
  }

  const totalValidResult = await client.query(
    `SELECT COUNT(*)::int AS count FROM song_ref WHERE is_valid = TRUE`,
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
      return pickRandom(candidatesAfterReset);
    }
  }

  throw new RoundEngineError('NO_SONGS_AVAILABLE', 'no eligible songs left in the playlist');
}

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
       AND sr.id NOT IN (SELECT song_ref_id FROM session_song_history WHERE table_session_id = $2)`,
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
