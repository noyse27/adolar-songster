import { pool } from '../db/pool';
import { RoundEngineError } from './errors';
import { selectSongForGame } from './songPool';
import { fetchTimeline, insertCardAndReindex, isPlacementCorrect } from './timeline';

// FR-021/022: fixed in production; overridable via env so integration
// tests can run a full countdown -> song -> resolve cycle in milliseconds
// instead of real 3s + 25s, keeping the suite fast and deterministic.
export const COUNTDOWN_MS = Number(process.env.ROUND_COUNTDOWN_MS ?? 3000);
export const SONG_DURATION_MS = Number(process.env.ROUND_SONG_DURATION_MS ?? 25000);

const ACTIVE_ROUND_STATUSES = ['countdown', 'playing', 'token_solo', 'token_others'];

export interface RoundGuessResult {
  userId: string;
  submitted: boolean;
  correct: boolean;
}

export async function startRound(gameId: string, requesterId: string, requesterRole?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const gameResult = await client.query(
      `SELECT id, table_id, table_session_id, status FROM game WHERE id = $1 FOR UPDATE`,
      [gameId],
    );
    if (gameResult.rowCount === 0) {
      throw new RoundEngineError('GAME_NOT_FOUND', 'game not found');
    }
    const game = gameResult.rows[0];
    if (game.status !== 'active') {
      throw new RoundEngineError('GAME_NOT_ACTIVE', 'game is not active');
    }

    const tableResult = await client.query(`SELECT owner_user_id FROM game_table WHERE id = $1`, [
      game.table_id,
    ]);
    const table = tableResult.rows[0];
    if (table.owner_user_id !== requesterId && requesterRole !== 'admin') {
      throw new RoundEngineError('FORBIDDEN', 'only the table admin can start a round');
    }

    const activeRoundResult = await client.query(
      `SELECT id FROM round WHERE game_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
      [gameId, ACTIVE_ROUND_STATUSES],
    );
    if ((activeRoundResult.rowCount ?? 0) > 0) {
      throw new RoundEngineError('ROUND_ALREADY_ACTIVE', 'a round is already in progress');
    }

    const song = await selectSongForGame(client, gameId, game.table_session_id);

    const nextIndexResult = await client.query(
      `SELECT COALESCE(MAX(index_no), 0) + 1 AS next_index FROM round WHERE game_id = $1`,
      [gameId],
    );
    const indexNo = nextIndexResult.rows[0].next_index;

    const roundResult = await client.query(
      `INSERT INTO round (game_id, index_no, song_id, mode, status, started_at)
       VALUES ($1, $2, $3, 'normal', 'countdown', NOW())
       RETURNING id, index_no`,
      [gameId, indexNo, song.id],
    );
    const round = roundResult.rows[0];

    await client.query(
      `INSERT INTO session_song_history (table_session_id, song_ref_id, first_played_round_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (table_session_id, song_ref_id)
       DO UPDATE SET play_count = session_song_history.play_count + 1`,
      [game.table_session_id, song.id, round.id],
    );

    await client.query('COMMIT');

    scheduleRoundTransitions(round.id);

    return {
      roundId: round.id as string,
      indexNo: round.index_no as number,
      status: 'countdown' as const,
      songTitle: song.title,
      songDurationSec: song.durationSec,
      countdownSeconds: COUNTDOWN_MS / 1000,
      songWindowSeconds: SONG_DURATION_MS / 1000,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function scheduleRoundTransitions(roundId: string): void {
  setTimeout(() => {
    pool
      .query(`UPDATE round SET status = 'playing' WHERE id = $1 AND status = 'countdown'`, [roundId])
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('failed to transition round to playing', err);
      });
  }, COUNTDOWN_MS);

  setTimeout(() => {
    resolveRound(roundId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('failed to resolve round', err);
    });
  }, COUNTDOWN_MS + SONG_DURATION_MS);
}

export async function submitGuess(
  roundId: string,
  userId: string,
  index: number,
): Promise<{ accepted: true }> {
  const roundResult = await pool.query(`SELECT id, game_id, status FROM round WHERE id = $1`, [roundId]);
  if (roundResult.rowCount === 0) {
    throw new RoundEngineError('ROUND_NOT_FOUND', 'round not found');
  }
  const round = roundResult.rows[0];
  if (round.status !== 'playing') {
    throw new RoundEngineError('ROUND_LOCKED', 'round is not currently accepting guesses');
  }

  const timeline = await fetchTimeline(pool, round.game_id, userId);
  if (!Number.isInteger(index) || index < 0 || index > timeline.length) {
    throw new RoundEngineError('INVALID_GUESS', 'index out of range for the current timeline');
  }

  await pool.query(
    `INSERT INTO guess (round_id, user_id, guess_type, value_number) VALUES ($1, $2, 'position', $3)`,
    [roundId, userId, index],
  );

  return { accepted: true };
}

export async function resolveRound(
  roundId: string,
): Promise<{ roundId: string; songYear: number; results: RoundGuessResult[] } | undefined> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(
      `SELECT id, game_id, song_id, status FROM round WHERE id = $1 FOR UPDATE`,
      [roundId],
    );
    if (roundResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return undefined;
    }
    const round = roundResult.rows[0];
    if (round.status !== 'playing') {
      // Already resolved (or aborted) - avoid double-processing on retry/race.
      await client.query('ROLLBACK');
      return undefined;
    }

    const songResult = await client.query(`SELECT year_value FROM song_ref WHERE id = $1`, [
      round.song_id,
    ]);
    const songYear = songResult.rows[0].year_value as number;

    const gameResult = await client.query(`SELECT table_id FROM game WHERE id = $1`, [round.game_id]);
    const tableId = gameResult.rows[0].table_id;

    const participantsResult = await client.query(
      `SELECT user_id FROM table_seat WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL`,
      [tableId],
    );

    const results: RoundGuessResult[] = [];
    for (const participant of participantsResult.rows) {
      const userId = participant.user_id as string;
      const guessResult = await client.query(
        `SELECT id, value_number FROM guess WHERE round_id = $1 AND user_id = $2
         ORDER BY submitted_at DESC LIMIT 1`,
        [roundId, userId],
      );

      if (guessResult.rowCount === 0) {
        results.push({ userId, submitted: false, correct: false });
        continue;
      }

      const guessId = guessResult.rows[0].id;
      const index = guessResult.rows[0].value_number as number;
      const timeline = await fetchTimeline(client, round.game_id, userId);
      const correct = isPlacementCorrect(timeline, index, songYear);

      await client.query(`UPDATE guess SET is_correct = $1 WHERE id = $2`, [correct, guessId]);

      if (correct) {
        await insertCardAndReindex(client, {
          gameId: round.game_id,
          userId,
          sourceRoundId: roundId,
          songYear,
          index,
        });
      }

      results.push({ userId, submitted: true, correct });
    }

    await client.query(`UPDATE round SET status = 'resolved', ended_at = NOW() WHERE id = $1`, [roundId]);

    await client.query('COMMIT');
    return { roundId, songYear, results };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
