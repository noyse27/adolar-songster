import { Response, Router } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { RoundEngineError } from '../services/errors';
import { claimToken, startRound, submitBonusGuess, submitGuess, submitTokenGuess } from '../services/roundEngine';
import { setAutoReady, setRoundReady } from '../services/roundReady';
import { loadGameState } from '../services/gameState';
import { touchTableActivityForGame } from '../services/tableActivity';
import { BONUS_WINDOW_MS, COUNTDOWN_MS, SONG_DURATION_MS } from '../services/roundConfig';
import { verifyDisplayToken } from '../services/displayToken';
import { isHostDisplayTokenActive } from '../services/hostDevices';
import { authorizeGameViewer } from '../services/tableAuthorization';
import { storeGameEvent } from '../services/debugLogging';
import { RequestWithId } from '../middleware/requestId';

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
  TOKEN_NOT_AVAILABLE: 409,
  TOKEN_ALREADY_USED: 409,
  SITTING_OUT: 403,
};

function handleEngineError(err: unknown, res: Response): boolean {
  if (err instanceof RoundEngineError) {
    const status = STATUS_BY_ERROR_CODE[err.code] ?? 400;
    res.status(status).json({ error: err.code, message: err.message });
    return true;
  }
  return false;
}

// H-01: requires an active seat (player or spectator) at this game's table
// - "logged in" alone used to be enough, so any account could read another
// table's full game/player detail just by knowing/guessing a gameId.
roundsRouter.get('/games/:gameId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { gameId } = req.params;

  const access = await authorizeGameViewer(gameId, req.userId as string);
  if (!access) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

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

  await touchTableActivityForGame(gameId);

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

// Consolidated snapshot for the Playboard client (players + full timelines
// + current round incl. reveal-if-resolved) - what GET /games/:gameId and
// GET .../rounds/:roundId each give separately, merged into the one shape
// the socket broadcaster (broadcastGame) also emits on every state change.
roundsRouter.get('/games/:gameId/state', requireAuth, async (req: AuthenticatedRequest, res) => {
  const access = await authorizeGameViewer(req.params.gameId, req.userId as string);
  if (!access) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

  const state = await loadGameState(req.params.gameId, COUNTDOWN_MS, SONG_DURATION_MS, BONUS_WINDOW_MS);
  if (!state) {
    res.status(404).json({ error: 'game not found' });
    return;
  }
  await touchTableActivityForGame(req.params.gameId);
  res.status(200).json(state);
});

// Anzeigegerät variant of the state snapshot above, authenticated by a
// display token (see displayToken.ts) instead of a normal session - checks
// the token's tableId actually owns this game before returning anything, so
// a display token from one table can't be pointed at another table's game.
roundsRouter.get('/games/display/:token/:gameId', async (req, res) => {
  const verified = verifyDisplayToken(req.params.token);
  if (!verified || (verified.hostDeviceId && !(await isHostDisplayTokenActive(verified.hostDeviceId)))) {
    res.status(401).json({ error: 'invalid or expired display token' });
    return;
  }

  const gameResult = await pool.query(`SELECT table_id FROM game WHERE id = $1`, [req.params.gameId]);
  if (gameResult.rowCount === 0 || gameResult.rows[0].table_id !== verified.tableId) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

  const state = await loadGameState(req.params.gameId, COUNTDOWN_MS, SONG_DURATION_MS, BONUS_WINDOW_MS);
  if (state) {
    await touchTableActivityForGame(req.params.gameId);
  }
  res.status(200).json(state);
});

// Self-service per-round readiness (see roundReady.ts): any active player
// marks themselves ready for the next round. Auto-starts the round once
// everyone is ready, or after the 30s window with stragglers sitting the
// round out - there is no response payload describing the outcome, the
// caller (and everyone else) finds out via the game:update broadcast.
roundsRouter.post('/games/:gameId/ready', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { ready = true } = req.body ?? {};
  if (typeof ready !== 'boolean') {
    res.status(400).json({ error: 'ready must be a boolean' });
    return;
  }
  try {
    await setRoundReady(req.params.gameId, req.userId as string, ready);
    await touchTableActivityForGame(req.params.gameId);
    void storeGameEvent({
      eventType: 'player_ready_changed',
      gameId: req.params.gameId,
      userId: req.userId as string,
      requestId: (req as RequestWithId).requestId,
      payload: { ready },
    });
    res.status(200).json({ accepted: true });
  } catch (err) {
    if (!handleEngineError(err, res)) throw err;
  }
});

// "Auto bereit" lock (see roundReady.ts's setAutoReady): scoped to this
// game only, toggled from the player's own avatar in the Playboard
// (double-click), not a table-level admin setting.
roundsRouter.post('/games/:gameId/ready/auto', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { autoReady } = req.body ?? {};
  if (typeof autoReady !== 'boolean') {
    res.status(400).json({ error: 'autoReady must be a boolean' });
    return;
  }
  try {
    await setAutoReady(req.params.gameId, req.userId as string, autoReady);
    await touchTableActivityForGame(req.params.gameId);
    void storeGameEvent({
      eventType: 'player_auto_ready_changed',
      gameId: req.params.gameId,
      userId: req.userId as string,
      requestId: (req as RequestWithId).requestId,
      payload: { autoReady },
    });
    res.status(200).json({ accepted: true });
  } catch (err) {
    if (!handleEngineError(err, res)) throw err;
  }
});

// Manual/admin override - see roundEngine.startRound's comment. Normal
// play uses POST /games/:id/ready instead.
roundsRouter.post('/games/:gameId/rounds', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const round = await startRound(req.params.gameId, req.userId as string, req.userRole);
    await touchTableActivityForGame(req.params.gameId);
    res.status(201).json(round);
  } catch (err) {
    if (!handleEngineError(err, res)) throw err;
  }
});

// H-01/H-03: requires an active seat at the game's table, and the roundId
// must actually belong to the gameId in the path - previously a roundId
// from a different game slipped through unbound, and any logged-in user
// could read any round's detail regardless of membership.
roundsRouter.get('/games/:gameId/rounds/:roundId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { gameId, roundId } = req.params;

  const access = await authorizeGameViewer(gameId, req.userId as string);
  if (!access) {
    res.status(404).json({ error: 'game not found' });
    return;
  }

  const roundResult = await pool.query(
    `SELECT r.id, r.index_no, r.status, r.mode, r.started_at, r.ended_at,
            CASE WHEN r.status = 'resolved' THEN sr.year_value ELSE NULL END AS song_year
     FROM round r
     JOIN song_ref sr ON sr.id = r.song_id
     WHERE r.id = $1 AND r.game_id = $2`,
    [roundId, gameId],
  );
  if (roundResult.rowCount === 0) {
    res.status(404).json({ error: 'round not found' });
    return;
  }
  const round = roundResult.rows[0];

  let results: Array<{ userId: string; value: number; correct: boolean }> = [];
  if (round.status === 'resolved' && round.mode !== 'token') {
    const guessType = round.mode === 'bonus' ? 'exact_year' : 'position';
    const guessResult = await pool.query(
      `SELECT DISTINCT ON (user_id) user_id, value_number, is_correct
       FROM guess WHERE round_id = $1 AND guess_type = $2
       ORDER BY user_id, submitted_at DESC`,
      [roundId, guessType],
    );
    results = guessResult.rows.map((row) => ({
      userId: row.user_id,
      value: row.value_number,
      correct: row.is_correct,
    }));
  }

  let tokenSoloUserId: string | null = null;
  let tokenWrongGuessYear: number | null = null;
  if (['token_solo', 'token_others', 'resolved'].includes(round.status) && round.mode === 'token') {
    const tokenResult = await pool.query(
      `SELECT tu.user_id, tu.result, g.value_number AS wrong_year
       FROM token_usage tu
       LEFT JOIN guess g ON g.round_id = tu.round_id AND g.user_id = tu.user_id AND g.guess_type = 'exact_year'
       WHERE tu.round_id = $1
         AND (tu.result IN ('solo_wrong', 'solo_correct', 'solo_timeout') OR tu.resolved_at IS NULL)`,
      [roundId],
    );
    const row = tokenResult.rows[0];
    if (row) {
      tokenSoloUserId = row.user_id;
      tokenWrongGuessYear = row.result === 'solo_wrong' ? row.wrong_year : null;
    }
  }

  await touchTableActivityForGame(gameId);

  res.status(200).json({
    roundId: round.id,
    indexNo: round.index_no,
    status: round.status,
    mode: round.mode,
    startedAt: round.started_at,
    endedAt: round.ended_at,
    songYear: round.song_year,
    results,
    tokenSoloUserId,
    tokenWrongGuessYear,
  });
});

roundsRouter.post(
  '/games/:gameId/rounds/:roundId/guess',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const { type, value } = req.body ?? {};

    try {
      if (type === 'position') {
        const result = await submitGuess(req.params.gameId, req.params.roundId, req.userId as string, Number(value));
        await touchTableActivityForGame(req.params.gameId);
        res.status(200).json(result);
        return;
      }
      if (type === 'exact_year') {
        // Bonus-round (Stichsong) exact-year guess (FR-041); the token
        // mechanic's exact-year guess has its own dedicated endpoint.
        const result = await submitBonusGuess(req.params.gameId, req.params.roundId, req.userId as string, Number(value));
        await touchTableActivityForGame(req.params.gameId);
        res.status(200).json(result);
        return;
      }
      res.status(400).json({ error: 'type must be position or exact_year' });
    } catch (err) {
      if (!handleEngineError(err, res)) throw err;
    }
  },
);

roundsRouter.post(
  '/games/:gameId/rounds/:roundId/token-claim',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await claimToken(req.params.gameId, req.params.roundId, req.userId as string);
      await touchTableActivityForGame(req.params.gameId);
      res.status(202).json(result);
    } catch (err) {
      if (!handleEngineError(err, res)) throw err;
    }
  },
);

roundsRouter.post(
  '/games/:gameId/rounds/:roundId/token-submit',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const { year } = req.body ?? {};

    try {
      const result = await submitTokenGuess(req.params.gameId, req.params.roundId, req.userId as string, Number(year));
      await touchTableActivityForGame(req.params.gameId);
      res.status(200).json(result);
    } catch (err) {
      if (!handleEngineError(err, res)) throw err;
    }
  },
);
