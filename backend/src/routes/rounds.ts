import { Response, Router } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { RoundEngineError } from '../services/errors';
import { startRound, submitGuess } from '../services/roundEngine';

export const roundsRouter = Router();

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  GAME_NOT_FOUND: 404,
  GAME_NOT_ACTIVE: 409,
  FORBIDDEN: 403,
  ROUND_ALREADY_ACTIVE: 409,
  NO_SONGS_AVAILABLE: 409,
  ROUND_NOT_FOUND: 404,
  ROUND_LOCKED: 409,
  INVALID_GUESS: 400,
};

function handleEngineError(err: unknown, res: Response): boolean {
  if (err instanceof RoundEngineError) {
    const status = STATUS_BY_ERROR_CODE[err.code] ?? 400;
    res.status(status).json({ error: err.code, message: err.message });
    return true;
  }
  return false;
}

roundsRouter.get('/games/:gameId', requireAuth, async (req, res) => {
  const { gameId } = req.params;

  const gameResult = await pool.query(
    `SELECT id, table_id, table_session_id, status, started_at, ended_at, winner_user_id
     FROM game WHERE id = $1`,
    [gameId],
  );
  if (gameResult.rowCount === 0) {
    res.status(404).json({ error: 'game not found' });
    return;
  }
  const game = gameResult.rows[0];

  const playersResult = await pool.query(
    `SELECT u.id AS user_id, u.username, COUNT(tc.id)::int AS card_count
     FROM table_seat s
     JOIN app_user u ON u.id = s.user_id
     LEFT JOIN timeline_card tc ON tc.game_id = $1 AND tc.user_id = s.user_id
     WHERE s.table_id = $2 AND s.seat_type = 'player' AND s.left_at IS NULL
     GROUP BY u.id, u.username`,
    [gameId, game.table_id],
  );

  res.status(200).json({
    gameId: game.id,
    tableId: game.table_id,
    tableSessionId: game.table_session_id,
    status: game.status,
    startedAt: game.started_at,
    endedAt: game.ended_at,
    winnerUserId: game.winner_user_id,
    players: playersResult.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      cardCount: row.card_count,
    })),
  });
});

roundsRouter.post('/games/:gameId/rounds', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const round = await startRound(req.params.gameId, req.userId as string, req.userRole);
    res.status(201).json(round);
  } catch (err) {
    if (!handleEngineError(err, res)) throw err;
  }
});

roundsRouter.get('/games/:gameId/rounds/:roundId', requireAuth, async (req, res) => {
  const { roundId } = req.params;

  const roundResult = await pool.query(
    `SELECT r.id, r.index_no, r.status, r.started_at, r.ended_at,
            CASE WHEN r.status = 'resolved' THEN sr.year_value ELSE NULL END AS song_year
     FROM round r
     JOIN song_ref sr ON sr.id = r.song_id
     WHERE r.id = $1`,
    [roundId],
  );
  if (roundResult.rowCount === 0) {
    res.status(404).json({ error: 'round not found' });
    return;
  }
  const round = roundResult.rows[0];

  let results: Array<{ userId: string; guessedIndex: number; correct: boolean }> = [];
  if (round.status === 'resolved') {
    const guessResult = await pool.query(
      `SELECT DISTINCT ON (user_id) user_id, value_number, is_correct
       FROM guess WHERE round_id = $1
       ORDER BY user_id, submitted_at DESC`,
      [roundId],
    );
    results = guessResult.rows.map((row) => ({
      userId: row.user_id,
      guessedIndex: row.value_number,
      correct: row.is_correct,
    }));
  }

  res.status(200).json({
    roundId: round.id,
    indexNo: round.index_no,
    status: round.status,
    startedAt: round.started_at,
    endedAt: round.ended_at,
    songYear: round.song_year,
    results,
  });
});

roundsRouter.post(
  '/games/:gameId/rounds/:roundId/guess',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const { type, value } = req.body ?? {};

    if (type !== 'position') {
      res.status(400).json({ error: 'only position guesses are supported in this sprint' });
      return;
    }

    try {
      const result = await submitGuess(req.params.roundId, req.userId as string, Number(value));
      res.status(200).json(result);
    } catch (err) {
      if (!handleEngineError(err, res)) throw err;
    }
  },
);
