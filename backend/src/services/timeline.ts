import { PoolClient } from 'pg';
import { pool } from '../db/pool';

type Queryable = PoolClient | typeof pool;

export interface TimelineEntry {
  yearValue: number;
}

// FR-023/024: each player starts with 2 cards drawn from a range derived
// from the current playlist's song years.
const START_BLOCKS_PER_PLAYER = 2;

export async function fetchTimeline(client: Queryable, gameId: string, userId: string): Promise<TimelineEntry[]> {
  const result = await client.query(
    `SELECT year_value FROM timeline_card
     WHERE game_id = $1 AND user_id = $2
     ORDER BY placed_position ASC`,
    [gameId, userId],
  );
  return result.rows.map((row) => ({ yearValue: row.year_value }));
}

// FR-026: correct if the guessed insertion point respects the relative
// order between neighboring cards; FR-027: equal years at the boundary
// are also correct (achieved by using <= on both sides).
export function isPlacementCorrect(timeline: TimelineEntry[], index: number, songYear: number): boolean {
  const lower = index > 0 ? timeline[index - 1].yearValue : null;
  const upper = index < timeline.length ? timeline[index].yearValue : null;
  return (lower === null || lower <= songYear) && (upper === null || songYear <= upper);
}

// Used when a card is awarded without a guessed position (token win: the
// player already proved they know the exact year, so it is inserted at
// its objectively correct sorted position).
export function findSortedInsertIndex(timeline: TimelineEntry[], year: number): number {
  return timeline.filter((entry) => entry.yearValue <= year).length;
}

export async function insertCardAndReindex(
  client: Queryable,
  opts: {
    gameId: string;
    userId: string;
    sourceRoundId: string | null;
    songYear: number;
    index: number;
    specialType?: 'normal' | 'token_win';
  },
): Promise<void> {
  await client.query(
    `UPDATE timeline_card SET placed_position = placed_position + 1
     WHERE game_id = $1 AND user_id = $2 AND placed_position >= $3`,
    [opts.gameId, opts.userId, opts.index],
  );
  await client.query(
    `INSERT INTO timeline_card (game_id, user_id, source_round_id, year_value, special_type, placed_position)
     VALUES ($1, $2, $3, $4, $6, $5)`,
    [opts.gameId, opts.userId, opts.sourceRoundId, opts.songYear, opts.index, opts.specialType ?? 'normal'],
  );
}

export async function computeYearRange(client: Queryable): Promise<{ lower: number; upper: number } | null> {
  const result = await client.query(
    `SELECT MIN(year_value) AS min_year, MAX(year_value) AS max_year
     FROM song_ref WHERE is_valid = TRUE AND year_value IS NOT NULL`,
  );
  const { min_year: minYear, max_year: maxYear } = result.rows[0];
  if (minYear === null || maxYear === null) {
    return null;
  }
  const currentYear = new Date().getUTCFullYear();
  return {
    lower: minYear - 10,
    upper: Math.max(maxYear + 10, currentYear),
  };
}

function randomYearInRange(lower: number, upper: number): number {
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

export async function generateStartBlocks(
  client: Queryable,
  gameId: string,
  playerUserIds: string[],
): Promise<void> {
  const range = await computeYearRange(client);
  if (!range) {
    throw new Error('cannot generate start blocks without any valid songs in the playlist');
  }

  for (const userId of playerUserIds) {
    const years = Array.from({ length: START_BLOCKS_PER_PLAYER }, () =>
      randomYearInRange(range.lower, range.upper),
    ).sort((a, b) => a - b);

    for (let position = 0; position < years.length; position += 1) {
      await client.query(
        `INSERT INTO timeline_card (game_id, user_id, source_round_id, year_value, special_type, placed_position)
         VALUES ($1, $2, NULL, $3, 'normal', $4)`,
        [gameId, userId, years[position], position],
      );
    }
  }
}
