import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { RoundEngineError } from './errors';
import { checkForWinOrTie, finishGame } from './matchOutcome';
import { selectSongForGame } from './songPool';
import { fetchTimeline, findSortedInsertIndex, insertCardAndReindex, isPlacementCorrect } from './timeline';
import { resolveClaimWinner } from './tokenRace';
import { broadcastGame } from '../realtime/broadcast';
import { startReadyWindow } from './roundReadyWindow';
import { scheduleAutoClose } from './tableRestart';
import {
  BONUS_WINDOW_MS,
  COUNTDOWN_MS,
  SONG_DURATION_MS,
  TOKENS_PER_PLAYER,
  TOKEN_CLAIM_GRACE_MS,
  TOKEN_OTHERS_WINDOW_MS,
  TOKEN_SOLO_WINDOW_MS,
} from './roundConfig';

export { BONUS_WINDOW_MS, COUNTDOWN_MS, SONG_DURATION_MS, TOKEN_CLAIM_GRACE_MS, TOKEN_OTHERS_WINDOW_MS, TOKEN_SOLO_WINDOW_MS };

const ACTIVE_ROUND_STATUSES = ['countdown', 'playing', 'token_solo', 'token_others'];

// Called (within the same transaction as a card award) after any round
// that could push a player to the winning threshold. A single leader
// finishes the game (FR-040/042/043); a tie is left for the next
// startRound() call to resolve via a bonus round (FR-041).
async function checkForGameEnd(client: PoolClient, gameId: string): Promise<void> {
  const outcome = await checkForWinOrTie(client, gameId);
  if ('winnerUserId' in outcome) {
    await finishGame(client, gameId, outcome.winnerUserId);
  }
}

// Called once, right after a round's resolution has committed. Either the
// game is still active - in which case the next round-ready window arms
// itself automatically (see roundReadyWindow.ts) - or this round's
// checkForGameEnd() just finished the match, in which case the table
// starts its 60s auto-close countdown (see tableRestart.ts) instead.
async function afterRoundResolved(gameId: string): Promise<void> {
  const result = await pool.query(`SELECT status, table_id FROM game WHERE id = $1`, [gameId]);
  if (result.rowCount === 0) return;
  const { status, table_id: tableId } = result.rows[0];
  if (status === 'finished') {
    scheduleAutoClose(tableId);
  } else {
    await startReadyWindow(gameId);
  }
}

export interface RoundGuessResult {
  userId: string;
  submitted: boolean;
  correct: boolean;
}

interface StartRoundAuth {
  requesterId: string;
  requesterRole?: string;
}

async function runStartRound(gameId: string, sitOutUserIds: string[], auth?: StartRoundAuth) {
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

    // Manual/admin trigger (POST /games/:id/rounds) is owner-gated; the
    // self-service readiness trigger (POST /games/:id/ready, see
    // roundReady.ts) has no `auth` - it only ever fires once the readiness
    // condition itself is already satisfied for everyone (or the 30s window
    // elapsed), so there is no single "requester" to authorize.
    if (auth) {
      const tableResult = await client.query(`SELECT owner_user_id FROM game_table WHERE id = $1`, [
        game.table_id,
      ]);
      const table = tableResult.rows[0];
      if (table.owner_user_id !== auth.requesterId && auth.requesterRole !== 'admin') {
        throw new RoundEngineError('FORBIDDEN', 'only the table admin can start a round');
      }
    }

    const activeRoundResult = await client.query(
      `SELECT id FROM round WHERE game_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
      [gameId, ACTIVE_ROUND_STATUSES],
    );
    if ((activeRoundResult.rowCount ?? 0) > 0) {
      throw new RoundEngineError('ROUND_ALREADY_ACTIVE', 'a round is already in progress');
    }

    // FR-041: if the previous round left players tied at the winning card
    // count, this round is a Stichsong bonus round instead of a normal one.
    const outcome = await checkForWinOrTie(client, gameId);
    const isBonusRound = 'tiedUserIds' in outcome;

    const song = await selectSongForGame(client, gameId, game.table_session_id);

    const nextIndexResult = await client.query(
      `SELECT COALESCE(MAX(index_no), 0) + 1 AS next_index FROM round WHERE game_id = $1`,
      [gameId],
    );
    const indexNo = nextIndexResult.rows[0].next_index;

    const roundResult = await client.query(
      `INSERT INTO round (game_id, index_no, song_id, mode, status, started_at)
       VALUES ($1, $2, $3, $4, 'countdown', NOW())
       RETURNING id, index_no`,
      [gameId, indexNo, song.id, isBonusRound ? 'bonus' : 'normal'],
    );
    const round = roundResult.rows[0];

    // Per-round readiness (see roundReady.ts): whoever didn't ready up
    // within the 30s window sits this specific round out - excluded from
    // guessing/tokens and from the resolve-time participant list, see
    // submitGuess/claimToken/resolveRound.
    for (const userId of sitOutUserIds) {
      await client.query(
        `INSERT INTO round_sitout (round_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [round.id, userId],
      );
    }

    await client.query(
      `INSERT INTO session_song_history (table_session_id, song_ref_id, first_played_round_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (table_session_id, song_ref_id)
       DO UPDATE SET play_count = session_song_history.play_count + 1`,
      [game.table_session_id, song.id, round.id],
    );

    await client.query('COMMIT');
    await broadcastGame(gameId);

    if (isBonusRound) {
      scheduleBonusRoundTransitions(round.id, gameId);
    } else {
      scheduleRoundTransitions(round.id, gameId);
    }

    return {
      roundId: round.id as string,
      indexNo: round.index_no as number,
      status: 'countdown' as const,
      mode: isBonusRound ? ('bonus' as const) : ('normal' as const),
      songTitle: song.title,
      songDurationSec: song.durationSec,
      countdownSeconds: COUNTDOWN_MS / 1000,
      songWindowSeconds: isBonusRound ? BONUS_WINDOW_MS / 1000 : SONG_DURATION_MS / 1000,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Manual/admin override - unchanged from before the per-round readiness
// gate existed, kept for admin/testing use. The normal player-facing path
// is the self-service POST /games/:id/ready flow (roundReady.ts).
export async function startRound(gameId: string, requesterId: string, requesterRole?: string) {
  return runStartRound(gameId, [], { requesterId, requesterRole });
}

// System-triggered start once the per-round readiness condition is met
// (everyone ready, or the 30s window elapsed) - see roundReady.ts.
export async function startRoundAuto(gameId: string, sitOutUserIds: string[]) {
  return runStartRound(gameId, sitOutUserIds);
}

function scheduleRoundTransitions(roundId: string, gameId: string): void {
  setTimeout(() => {
    pool
      .query(`UPDATE round SET status = 'playing' WHERE id = $1 AND status = 'countdown'`, [roundId])
      .then(() => broadcastGame(gameId))
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

function scheduleBonusRoundTransitions(roundId: string, gameId: string): void {
  setTimeout(() => {
    pool
      .query(`UPDATE round SET status = 'playing' WHERE id = $1 AND status = 'countdown'`, [roundId])
      .then(() => broadcastGame(gameId))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('failed to transition bonus round to playing', err);
      });
  }, COUNTDOWN_MS);

  setTimeout(() => {
    resolveBonusRound(roundId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('failed to resolve bonus round', err);
    });
  }, COUNTDOWN_MS + BONUS_WINDOW_MS);
}

async function assertNotSittingOut(roundId: string, userId: string): Promise<void> {
  const sitoutResult = await pool.query(
    `SELECT 1 FROM round_sitout WHERE round_id = $1 AND user_id = $2`,
    [roundId, userId],
  );
  if ((sitoutResult.rowCount ?? 0) > 0) {
    throw new RoundEngineError('SITTING_OUT', 'you did not ready up in time and are sitting this round out');
  }
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

  await assertNotSittingOut(roundId, userId);

  // FR-032: a token claim stops the song, which also ends normal
  // position-guessing for this round even during the brief tie-break
  // grace window before the round officially moves to token_solo.
  const claimResult = await pool.query(`SELECT id FROM token_usage WHERE round_id = $1 LIMIT 1`, [roundId]);
  if ((claimResult.rowCount ?? 0) > 0) {
    throw new RoundEngineError('ROUND_LOCKED', 'a token was claimed for this round');
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
      `SELECT user_id FROM table_seat
       WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL
         AND user_id NOT IN (SELECT user_id FROM round_sitout WHERE round_id = $2)`,
      [tableId, roundId],
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

    await checkForGameEnd(client, round.game_id);

    await client.query('COMMIT');
    await broadcastGame(round.game_id);
    // From round 2 onward, the next ready window opens automatically as
    // soon as this one resolves (no-ops if the match just ended) - keeps
    // play moving without everyone re-clicking ready after every reveal.
    await afterRoundResolved(round.game_id);
    return { roundId, songYear, results };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function submitBonusGuess(
  roundId: string,
  userId: string,
  year: number,
): Promise<{ correct: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(
      `SELECT id, game_id, song_id, status, mode FROM round WHERE id = $1 FOR UPDATE`,
      [roundId],
    );
    if (roundResult.rowCount === 0) {
      throw new RoundEngineError('ROUND_NOT_FOUND', 'round not found');
    }
    const round = roundResult.rows[0];

    if (round.mode !== 'bonus' || round.status !== 'playing') {
      throw new RoundEngineError('ROUND_LOCKED', 'no bonus guess window is open');
    }
    if (!Number.isInteger(year)) {
      throw new RoundEngineError('INVALID_GUESS', 'year must be an integer');
    }

    const tieResult = await checkForWinOrTie(client, round.game_id);
    if (!('tiedUserIds' in tieResult) || !tieResult.tiedUserIds.includes(userId)) {
      throw new RoundEngineError('TOKEN_NOT_AVAILABLE', 'you are not tied for the win in this round');
    }

    const existingAttemptResult = await client.query(
      `SELECT id FROM guess WHERE round_id = $1 AND user_id = $2 AND guess_type = 'exact_year'`,
      [roundId, userId],
    );
    if ((existingAttemptResult.rowCount ?? 0) > 0) {
      throw new RoundEngineError('TOKEN_ALREADY_USED', 'already attempted this bonus round');
    }

    const songResult = await client.query(`SELECT year_value FROM song_ref WHERE id = $1`, [
      round.song_id,
    ]);
    const correct = year === (songResult.rows[0].year_value as number);

    await client.query(
      `INSERT INTO guess (round_id, user_id, guess_type, value_number, submitted_at, is_correct)
       VALUES ($1, $2, 'exact_year', $3, NOW(), $4)`,
      [roundId, userId, year, correct],
    );

    await client.query('COMMIT');
    await broadcastGame(round.game_id);
    return { correct };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resolveBonusRound(roundId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(
      `SELECT id, game_id, status, mode FROM round WHERE id = $1 FOR UPDATE`,
      [roundId],
    );
    if (roundResult.rowCount === 0 || roundResult.rows[0].mode !== 'bonus' || roundResult.rows[0].status !== 'playing') {
      await client.query('ROLLBACK');
      return;
    }
    const round = roundResult.rows[0];

    const correctGuessesResult = await client.query(
      `SELECT id, user_id, submitted_at FROM guess
       WHERE round_id = $1 AND guess_type = 'exact_year' AND is_correct = TRUE
       ORDER BY submitted_at ASC`,
      [roundId],
    );

    if ((correctGuessesResult.rowCount ?? 0) > 0) {
      const winner = resolveClaimWinner(
        correctGuessesResult.rows.map((row) => ({
          id: row.id,
          claimedAtMs: new Date(row.submitted_at).getTime(),
        })),
      );
      const winnerUserId = correctGuessesResult.rows.find((row) => row.id === winner.id).user_id;

      await client.query(`UPDATE round SET status = 'resolved', ended_at = NOW() WHERE id = $1`, [
        roundId,
      ]);
      await finishGame(client, round.game_id, winnerUserId);
    } else {
      // Nobody guessed correctly - stays tied. The next POST .../rounds
      // call will detect the tie again and draw another Stichsong.
      await client.query(`UPDATE round SET status = 'resolved', ended_at = NOW() WHERE id = $1`, [
        roundId,
      ]);
    }

    await client.query('COMMIT');
    await broadcastGame(round.game_id);
    await afterRoundResolved(round.game_id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function claimToken(
  roundId: string,
  userId: string,
): Promise<{ accepted: true; graceMs: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(
      `SELECT id, game_id, status FROM round WHERE id = $1 FOR UPDATE`,
      [roundId],
    );
    if (roundResult.rowCount === 0) {
      throw new RoundEngineError('ROUND_NOT_FOUND', 'round not found');
    }
    const round = roundResult.rows[0];
    if (round.status !== 'playing') {
      throw new RoundEngineError('TOKEN_NOT_AVAILABLE', 'no token claim window is open');
    }

    await assertNotSittingOut(roundId, userId);

    const alreadyClaimedResult = await client.query(
      `SELECT id FROM token_usage WHERE round_id = $1 AND user_id = $2`,
      [roundId, userId],
    );
    if ((alreadyClaimedResult.rowCount ?? 0) > 0) {
      throw new RoundEngineError('TOKEN_ALREADY_USED', 'already claimed a token for this round');
    }

    const usedCountResult = await client.query(
      `SELECT COUNT(*)::int AS used FROM token_usage tu
       JOIN round r ON r.id = tu.round_id
       WHERE r.game_id = $1 AND tu.user_id = $2`,
      [round.game_id, userId],
    );
    if (usedCountResult.rows[0].used >= TOKENS_PER_PLAYER) {
      throw new RoundEngineError('TOKEN_ALREADY_USED', 'no tokens remaining this game');
    }

    const existingClaimsResult = await client.query(
      `SELECT id FROM token_usage WHERE round_id = $1 LIMIT 1`,
      [roundId],
    );
    const isFirstClaim = (existingClaimsResult.rowCount ?? 0) === 0;

    await client.query(
      `INSERT INTO token_usage (round_id, user_id, claimed_at) VALUES ($1, $2, NOW())`,
      [roundId, userId],
    );

    await client.query('COMMIT');
    await broadcastGame(round.game_id);

    if (isFirstClaim) {
      setTimeout(() => {
        resolveClaimRace(roundId).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('failed to resolve token claim race', err);
        });
      }, TOKEN_CLAIM_GRACE_MS);
    }

    return { accepted: true, graceMs: TOKEN_CLAIM_GRACE_MS };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resolveClaimRace(roundId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(`SELECT id, game_id, status FROM round WHERE id = $1 FOR UPDATE`, [
      roundId,
    ]);
    if (roundResult.rowCount === 0 || roundResult.rows[0].status !== 'playing') {
      await client.query('ROLLBACK');
      return;
    }
    const round = roundResult.rows[0];

    const claimsResult = await client.query(
      `SELECT id, user_id, claimed_at FROM token_usage WHERE round_id = $1 AND resolved_at IS NULL`,
      [roundId],
    );
    if (claimsResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return;
    }

    const winner = resolveClaimWinner(
      claimsResult.rows.map((row) => ({ id: row.id, claimedAtMs: new Date(row.claimed_at).getTime() })),
    );

    const loserIds = claimsResult.rows.map((row) => row.id).filter((id) => id !== winner.id);
    if (loserIds.length > 0) {
      await client.query(
        `UPDATE token_usage SET resolved_at = NOW(), result = 'race_lost' WHERE id = ANY($1::uuid[])`,
        [loserIds],
      );
    }

    await client.query(`UPDATE round SET status = 'token_solo', mode = 'token' WHERE id = $1`, [roundId]);

    await client.query('COMMIT');
    await broadcastGame(round.game_id);

    setTimeout(() => {
      resolveSoloTimeout(roundId).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('failed to resolve token solo timeout', err);
      });
    }, TOKEN_SOLO_WINDOW_MS);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resolveSoloTimeout(roundId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(`SELECT id, game_id, status FROM round WHERE id = $1 FOR UPDATE`, [
      roundId,
    ]);
    if (roundResult.rowCount === 0 || roundResult.rows[0].status !== 'token_solo') {
      // Winner already submitted (or something else moved the round on).
      await client.query('ROLLBACK');
      return;
    }
    const round = roundResult.rows[0];

    await client.query(
      `UPDATE token_usage SET resolved_at = NOW(), result = 'solo_timeout'
       WHERE round_id = $1 AND resolved_at IS NULL`,
      [roundId],
    );
    await client.query(`UPDATE round SET status = 'resolved', ended_at = NOW() WHERE id = $1`, [roundId]);

    await client.query('COMMIT');
    await broadcastGame(round.game_id);
    await afterRoundResolved(round.game_id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function submitTokenGuess(
  roundId: string,
  userId: string,
  year: number,
): Promise<{ correct: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(
      `SELECT id, game_id, song_id, status FROM round WHERE id = $1 FOR UPDATE`,
      [roundId],
    );
    if (roundResult.rowCount === 0) {
      throw new RoundEngineError('ROUND_NOT_FOUND', 'round not found');
    }
    const round = roundResult.rows[0];

    if (!['token_solo', 'token_others'].includes(round.status)) {
      throw new RoundEngineError('ROUND_LOCKED', 'no token guess window is open');
    }
    if (!Number.isInteger(year)) {
      throw new RoundEngineError('INVALID_GUESS', 'year must be an integer');
    }

    const songResult = await client.query(`SELECT year_value FROM song_ref WHERE id = $1`, [
      round.song_id,
    ]);
    const songYear = songResult.rows[0].year_value as number;
    const correct = year === songYear;

    if (round.status === 'token_solo') {
      const winnerClaimResult = await client.query(
        `SELECT id FROM token_usage WHERE round_id = $1 AND user_id = $2 AND resolved_at IS NULL`,
        [roundId, userId],
      );
      if (winnerClaimResult.rowCount === 0) {
        throw new RoundEngineError('TOKEN_NOT_AVAILABLE', 'it is not your solo turn');
      }

      await client.query(
        `UPDATE token_usage SET resolved_at = NOW(), result = $1 WHERE id = $2`,
        [correct ? 'solo_correct' : 'solo_wrong', winnerClaimResult.rows[0].id],
      );
      await client.query(
        `INSERT INTO guess (round_id, user_id, guess_type, value_number, submitted_at, is_correct)
         VALUES ($1, $2, 'exact_year', $3, NOW(), $4)`,
        [roundId, userId, year, correct],
      );

      if (correct) {
        const timeline = await fetchTimeline(client, round.game_id, userId);
        await insertCardAndReindex(client, {
          gameId: round.game_id,
          userId,
          sourceRoundId: roundId,
          songYear,
          index: findSortedInsertIndex(timeline, songYear),
          specialType: 'token_win',
        });
        await client.query(`UPDATE round SET status = 'resolved', ended_at = NOW() WHERE id = $1`, [
          roundId,
        ]);
        await checkForGameEnd(client, round.game_id);
        await client.query('COMMIT');
        await broadcastGame(round.game_id);
        await afterRoundResolved(round.game_id);
        return { correct: true };
      }

      // FR-034: a wrong solo guess opens a 10s window for opponents.
      await client.query(`UPDATE round SET status = 'token_others' WHERE id = $1`, [roundId]);
      await client.query('COMMIT');
      await broadcastGame(round.game_id);

      setTimeout(() => {
        resolveOthersWindow(roundId).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('failed to resolve token others window', err);
        });
      }, TOKEN_OTHERS_WINDOW_MS);

      return { correct: false };
    }

    // status === 'token_others': any active opponent gets a single attempt.
    const originalWinnerResult = await client.query(
      `SELECT user_id FROM token_usage WHERE round_id = $1 AND result IN ('solo_wrong') LIMIT 1`,
      [roundId],
    );
    if (originalWinnerResult.rowCount === 0) {
      throw new RoundEngineError('ROUND_LOCKED', 'token round is not open for opponents');
    }
    if (originalWinnerResult.rows[0].user_id === userId) {
      throw new RoundEngineError('TOKEN_NOT_AVAILABLE', 'the solo claimant does not get a second attempt');
    }

    const existingAttemptResult = await client.query(
      `SELECT id FROM guess WHERE round_id = $1 AND user_id = $2 AND guess_type = 'exact_year'`,
      [roundId, userId],
    );
    if ((existingAttemptResult.rowCount ?? 0) > 0) {
      throw new RoundEngineError('TOKEN_ALREADY_USED', 'already attempted this round');
    }

    await client.query(
      `INSERT INTO guess (round_id, user_id, guess_type, value_number, submitted_at, is_correct)
       VALUES ($1, $2, 'exact_year', $3, NOW(), $4)`,
      [roundId, userId, year, correct],
    );

    await client.query('COMMIT');
    await broadcastGame(round.game_id);
    return { correct };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resolveOthersWindow(roundId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(
      `SELECT id, game_id, song_id, status FROM round WHERE id = $1 FOR UPDATE`,
      [roundId],
    );
    if (roundResult.rowCount === 0 || roundResult.rows[0].status !== 'token_others') {
      await client.query('ROLLBACK');
      return;
    }
    const round = roundResult.rows[0];

    const songResult = await client.query(`SELECT year_value FROM song_ref WHERE id = $1`, [
      round.song_id,
    ]);
    const songYear = songResult.rows[0].year_value as number;

    const correctGuessesResult = await client.query(
      `SELECT id, user_id, submitted_at FROM guess
       WHERE round_id = $1 AND guess_type = 'exact_year' AND is_correct = TRUE
       ORDER BY submitted_at ASC`,
      [roundId],
    );

    if ((correctGuessesResult.rowCount ?? 0) > 0) {
      const winner = resolveClaimWinner(
        correctGuessesResult.rows.map((row) => ({
          id: row.id,
          claimedAtMs: new Date(row.submitted_at).getTime(),
        })),
      );
      const winnerUserId = correctGuessesResult.rows.find((row) => row.id === winner.id).user_id;

      const timeline = await fetchTimeline(client, round.game_id, winnerUserId);
      await insertCardAndReindex(client, {
        gameId: round.game_id,
        userId: winnerUserId,
        sourceRoundId: roundId,
        songYear,
        index: findSortedInsertIndex(timeline, songYear),
        specialType: 'token_win',
      });
    }

    await client.query(`UPDATE round SET status = 'resolved', ended_at = NOW() WHERE id = $1`, [roundId]);

    await checkForGameEnd(client, round.game_id);

    await client.query('COMMIT');
    await broadcastGame(round.game_id);
    await afterRoundResolved(round.game_id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
