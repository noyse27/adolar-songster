import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { AdolarTrack } from './adolarClient';
import { RoundEngineError } from './errors';

type Queryable = PoolClient | typeof pool;

const BATCH_SIZE = 50;

export interface BatchCandidate {
  songRefId: string;
  artist: string;
  yearValue: number;
  lastPlayedAt: string | null;
}

// Upserts one Adolar track into song_ref (idempotent on (source,
// source_song_id), see the initial-schema migration's unique index) -
// used by the daily/manual full-library sync (adolarSync.ts). Session
// start (loadAdolarBatch below) no longer calls Adolar live at all - it
// used to page through the *entire* playlist inside the same DB
// transaction that locks the table row, which was fine for a small test
// playlist but took well over a minute of sequential HTTP calls against a
// real ~7000-track playlist. It now reads whatever the sync already
// upserted here instead. last_played_at is deliberately left untouched by
// the upsert so a track already known from a previous session keeps its
// malus history.
export async function upsertSongRefTrack(
  client: Queryable,
  track: AdolarTrack,
): Promise<{ songRefId: string; lastPlayedAt: string | null }> {
  const result = await client.query(
    `INSERT INTO song_ref (source, source_song_id, title, artist, year_value, duration_sec, is_valid)
     VALUES ('adolar', $1, $2, $3, $4, $5, TRUE)
     ON CONFLICT (source, source_song_id)
     DO UPDATE SET title = EXCLUDED.title, artist = EXCLUDED.artist,
                    year_value = EXCLUDED.year_value, duration_sec = EXCLUDED.duration_sec,
                    is_valid = TRUE
     RETURNING id, last_played_at`,
    [String(track.id), track.title, track.artist, track.year, track.duration],
  );
  return { songRefId: result.rows[0].id, lastPlayedAt: result.rows[0].last_played_at };
}

// Section 4.3, steps 2-3: sort by malus (never-played first), bucket by
// decade, then round-robin the buckets picking the longest-not-played song
// of a not-yet-used artist from each, until BATCH_SIZE is reached or every
// bucket is exhausted.
export function selectBatch(candidates: BatchCandidate[]): BatchCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.lastPlayedAt === null && b.lastPlayedAt === null) return 0;
    if (a.lastPlayedAt === null) return -1;
    if (b.lastPlayedAt === null) return 1;
    return new Date(a.lastPlayedAt).getTime() - new Date(b.lastPlayedAt).getTime();
  });

  const buckets = new Map<number, BatchCandidate[]>();
  for (const candidate of sorted) {
    const decade = Math.floor(candidate.yearValue / 10) * 10;
    const bucket = buckets.get(decade);
    if (bucket) {
      bucket.push(candidate);
    } else {
      buckets.set(decade, [candidate]);
    }
  }
  const bucketKeys = [...buckets.keys()].sort((a, b) => a - b);

  const selected: BatchCandidate[] = [];
  const usedArtists = new Set<string>();
  let remaining = true;
  while (selected.length < BATCH_SIZE && remaining) {
    remaining = false;
    for (const decade of bucketKeys) {
      if (selected.length >= BATCH_SIZE) break;
      const bucket = buckets.get(decade) as BatchCandidate[];
      const index = bucket.findIndex((candidate) => !usedArtists.has(candidate.artist));
      if (index === -1) continue;
      const [candidate] = bucket.splice(index, 1);
      usedArtists.add(candidate.artist);
      selected.push(candidate);
      remaining = true;
    }
  }
  return selected;
}

export async function loadAdolarBatch(client: Queryable, playlistId: number): Promise<string[]> {
  const result = await client.query(
    `SELECT sr.id, sr.artist, sr.year_value, sr.last_played_at
     FROM song_ref sr
     JOIN adolar_playlist_track apt ON apt.song_ref_id = sr.id
     WHERE apt.playlist_id = $1 AND sr.is_valid = TRUE
       AND sr.year_value IS NOT NULL AND sr.artist IS NOT NULL`,
    [playlistId],
  );

  if (result.rowCount === 0) {
    throw new RoundEngineError(
      'ADOLAR_PLAYLIST_NOT_SYNCED',
      'this playlist has not been synced from Adolar yet - try again after the next sync, or ask an admin to trigger one manually',
    );
  }

  const candidates: BatchCandidate[] = result.rows.map((row) => ({
    songRefId: row.id,
    artist: row.artist,
    yearValue: row.year_value,
    lastPlayedAt: row.last_played_at,
  }));

  const batch = selectBatch(candidates);
  return batch.map((candidate) => candidate.songRefId);
}
