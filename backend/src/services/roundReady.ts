import { pool } from '../db/pool';
import { RoundEngineError } from './errors';
import { startRoundAuto } from './roundEngine';
import { broadcastGame } from '../realtime/broadcast';
import { clearScheduledTimeout, registerExpiryHandler, startReadyWindow } from './roundReadyWindow';

const ACTIVE_ROUND_STATUSES = ['countdown', 'playing', 'token_solo', 'token_others'];

// The timer itself (and the "arm the window" logic shared with
// roundEngine.ts's automatic post-resolve trigger) lives in
// roundReadyWindow.ts to avoid a circular import - see that module's
// comment. This file owns what happens once the window actually expires.
registerExpiryHandler(resolveReadyTimeout);

async function activePlayerIds(tableId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT user_id FROM table_seat WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL`,
    [tableId],
  );
  return result.rows.map((row) => row.user_id as string);
}

async function readyUserIds(gameId: string): Promise<Set<string>> {
  const result = await pool.query(`SELECT user_id FROM round_ready WHERE game_id = $1 AND ready = TRUE`, [
    gameId,
  ]);
  return new Set(result.rows.map((row) => row.user_id as string));
}

export async function setRoundReady(gameId: string, userId: string, ready: boolean): Promise<void> {
  const gameResult = await pool.query(`SELECT id, table_id, status FROM game WHERE id = $1`, [gameId]);
  if (gameResult.rowCount === 0) {
    throw new RoundEngineError('GAME_NOT_FOUND', 'game not found');
  }
  const game = gameResult.rows[0];
  if (game.status !== 'active') {
    throw new RoundEngineError('GAME_NOT_ACTIVE', 'game is not active');
  }

  const seatResult = await pool.query(
    `SELECT 1 FROM table_seat WHERE table_id = $1 AND user_id = $2 AND seat_type = 'player' AND left_at IS NULL`,
    [game.table_id, userId],
  );
  if (seatResult.rowCount === 0) {
    throw new RoundEngineError('FORBIDDEN', 'not an active player at this table');
  }

  const activeRoundResult = await pool.query(
    `SELECT id FROM round WHERE game_id = $1 AND status = ANY($2::text[]) LIMIT 1`,
    [gameId, ACTIVE_ROUND_STATUSES],
  );
  if ((activeRoundResult.rowCount ?? 0) > 0) {
    throw new RoundEngineError('ROUND_ALREADY_ACTIVE', 'a round is already in progress');
  }

  await pool.query(
    `INSERT INTO round_ready (game_id, user_id, ready, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (game_id, user_id) DO UPDATE SET ready = EXCLUDED.ready, updated_at = NOW()`,
    [gameId, userId, ready],
  );

  if (ready) {
    await startReadyWindow(gameId);
  }

  const activeIds = await activePlayerIds(game.table_id);
  const readyIds = await readyUserIds(gameId);
  const allReady = activeIds.length > 0 && activeIds.every((id) => readyIds.has(id));

  if (allReady) {
    clearScheduledTimeout(gameId);
    await clearReadyState(gameId);
    await startRoundAuto(gameId, []);
    return;
  }

  await broadcastGame(gameId);
}

async function clearReadyState(gameId: string): Promise<void> {
  await pool.query(`DELETE FROM round_ready WHERE game_id = $1`, [gameId]);
  await pool.query(`UPDATE game SET round_ready_started_at = NULL WHERE id = $1`, [gameId]);
}

async function resolveReadyTimeout(gameId: string): Promise<void> {
  const gameResult = await pool.query(
    `SELECT table_id, status, round_ready_started_at FROM game WHERE id = $1`,
    [gameId],
  );
  if (gameResult.rowCount === 0) return;
  const game = gameResult.rows[0];
  // Already started (or the game ended) via some other path in the
  // meantime - nothing to do.
  if (game.status !== 'active' || !game.round_ready_started_at) return;

  const activeIds = await activePlayerIds(game.table_id);
  const readyIds = await readyUserIds(gameId);
  const sitOutUserIds = activeIds.filter((id) => !readyIds.has(id));

  await clearReadyState(gameId);

  if (sitOutUserIds.length >= activeIds.length) {
    // Nobody readied up at all - don't start a round with no participants;
    // just reset and wait for someone to ready up again.
    await broadcastGame(gameId);
    return;
  }

  await startRoundAuto(gameId, sitOutUserIds);
}
