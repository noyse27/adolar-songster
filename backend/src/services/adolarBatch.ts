import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { AdolarTrack, fetchPlaylistTracksPage } from './adolarClient';
import { RoundEngineError } from './errors';

type Queryable = PoolClient | typeof pool;

// Section 4.3: raw material for the batch selection is drawn from a few
// pages of the Adolar playlist (3-4 pages of 50 = up to 200 candidates),
// not the whole playlist - keeps the request burst small and bounded
// regardless of playlist size.
const RAW_MATERIAL_PAGE_SIZE = 50;
const RAW_MATERIAL_PAGE_COUNT = 4;
const BATCH_SIZE = 50;

export interface BatchCandidate {
  songRefId: string;
  artist: string;
  yearValue: number;
  lastPlayedAt: string | null;
}

async function fetchRawMaterial(playlistId: number): Promise<AdolarTrack[]> {
  const tracks: AdolarTrack[] = [];
  for (let page = 0; page < RAW_MATERIAL_PAGE_COUNT; page += 1) {
    const offset = page * RAW_MATERIAL_PAGE_SIZE;
    const result = await fetchPlaylistTracksPage(playlistId, RAW_MATERIAL_PAGE_SIZE, offset);
    tracks.push(...result.tracks);
    if (offset + result.tracks.length >= result.total) {
      break;
    }
  }
  return tracks;
}

// Upserts each Adolar track into song_ref (idempotent on (source,
// source_song_id), see the initial-schema migration's unique index) and
// returns it enriched with its song_ref id and current last_played_at -
// last_played_at is deliberately left untouched by the upsert so a track
// already known from a previous session keeps its malus history.
async function upsertCandidates(client: Queryable, tracks: AdolarTrack[]): Promise<BatchCandidate[]> {
  const candidates: BatchCandidate[] = [];
  for (const track of tracks) {
    // Games are played on year alone; a track without one (or without an
    // artist, needed for the one-artist-per-batch rule below) can't be used.
    if (track.year === null || !track.artist) {
      continue;
    }
    const result = await client.query(
      `INSERT INTO song_ref (source, source_song_id, title, year_value, duration_sec, is_valid)
       VALUES ('adolar', $1, $2, $3, $4, TRUE)
       ON CONFLICT (source, source_song_id)
       DO UPDATE SET title = EXCLUDED.title, year_value = EXCLUDED.year_value,
                      duration_sec = EXCLUDED.duration_sec, is_valid = TRUE
       RETURNING id, last_played_at`,
      [String(track.id), track.title, track.year, track.duration],
    );
    candidates.push({
      songRefId: result.rows[0].id,
      artist: track.artist,
      yearValue: track.year,
      lastPlayedAt: result.rows[0].last_played_at,
    });
  }
  return candidates;
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
  const tracks = await fetchRawMaterial(playlistId);
  const candidates = await upsertCandidates(client, tracks);
  if (candidates.length === 0) {
    throw new RoundEngineError(
      'ADOLAR_PLAYLIST_EMPTY',
      'the Adolar playlist has no usable tracks (year and artist required)',
    );
  }
  const batch = selectBatch(candidates);
  return batch.map((candidate) => candidate.songRefId);
}
