import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { evaluateOwnerHandover } from '../services/tableHandover';
import { computeYearRange, generateStartBlocks } from '../services/timeline';
import { applyEarlyLeavePenalty } from '../services/matchOutcome';
import { AdolarClientError, isPlaylistAvailable } from '../services/adolarClient';
import { startTableGame } from '../services/tableStart';
import { fetchLobbyTables, loadTableDetail } from '../services/tableQueries';
import { broadcastLobby, broadcastTable } from '../realtime/broadcast';

export const tablesRouter = Router();

// FR-045: technical disconnect gets a 90s rejoin window without penalty;
// overridable via env for fast, deterministic tests.
const REJOIN_GRACE_MS = Number(process.env.REJOIN_GRACE_MS ?? 90000);

function scheduleEarlyLeavePenaltyCheck(gameId: string, tableId: string, userId: string): void {
  setTimeout(() => {
    (async () => {
      const rejoinedResult = await pool.query(
        `SELECT id FROM table_seat WHERE table_id = $1 AND user_id = $2 AND left_at IS NULL LIMIT 1`,
        [tableId, userId],
      );
      if ((rejoinedResult.rowCount ?? 0) > 0) {
        return; // rejoined within the grace window - no penalty (FR-045)
      }

      const gameResult = await pool.query(`SELECT status FROM game WHERE id = $1`, [gameId]);
      if (gameResult.rows[0]?.status !== 'active') {
        return; // match already ended by other means - nothing to penalize
      }

      await applyEarlyLeavePenalty(pool, gameId, tableId, userId);
    })().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('failed to evaluate early-leave penalty', err);
    });
  }, REJOIN_GRACE_MS);
}

function generateJoinCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

tablesRouter.post('/tables', requireAuth, async (req: AuthenticatedRequest, res) => {
  const requesterId = req.userId as string;
  const {
    name,
    visibility,
    allowSpectators = true,
    maxPlayers = 5,
    maxSpectators = 10,
    sourcePlaylistId = null,
  } = req.body ?? {};

  if (!name || !['public', 'private'].includes(visibility)) {
    res.status(400).json({ error: 'name and visibility (public|private) are required' });
    return;
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 5) {
    res.status(400).json({ error: 'maxPlayers must be between 2 and 5' });
    return;
  }
  if (!Number.isInteger(maxSpectators) || maxSpectators < 0 || maxSpectators > 50) {
    res.status(400).json({ error: 'maxSpectators must be between 0 and 50' });
    return;
  }
  if (sourcePlaylistId !== null && !Number.isInteger(sourcePlaylistId)) {
    res.status(400).json({ error: 'sourcePlaylistId must be an integer Adolar playlist id' });
    return;
  }

  // Section 4.2: checked at table creation so an unavailable playlist is a
  // clear error to the table admin right away instead of a later failure
  // at session start.
  if (sourcePlaylistId !== null) {
    try {
      const available = await isPlaylistAvailable(sourcePlaylistId);
      if (!available) {
        res.status(409).json({
          error: 'ADOLAR_PLAYLIST_UNAVAILABLE',
          message: 'the selected Adolar playlist is not available',
        });
        return;
      }
    } catch (err) {
      if (err instanceof AdolarClientError) {
        res.status(502).json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  }

  const joinCode = visibility === 'private' ? generateJoinCode() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tableResult = await client.query(
      `INSERT INTO game_table
         (owner_user_id, name, visibility, join_code, allow_spectators, max_players, max_spectators,
          source_playlist_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, visibility, join_code, state, source_playlist_id`,
      [
        requesterId, name, visibility, joinCode, Boolean(allowSpectators), maxPlayers, maxSpectators,
        sourcePlaylistId,
      ],
    );
    const table = tableResult.rows[0];

    await client.query(
      `INSERT INTO table_seat (table_id, user_id, seat_type) VALUES ($1, $2, 'player')`,
      [table.id, requesterId],
    );

    await client.query('COMMIT');

    if (visibility === 'public') await broadcastLobby();

    res.status(201).json({
      tableId: table.id,
      name: table.name,
      visibility: table.visibility,
      joinCode: table.join_code,
      state: table.state,
      sourcePlaylistId: table.source_playlist_id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

tablesRouter.get('/tables/lobby', requireAuth, async (_req, res) => {
  res.status(200).json({ tables: await fetchLobbyTables() });
});

tablesRouter.get('/tables/:tableId', requireAuth, async (req, res) => {
  const { tableId } = req.params;

  await evaluateOwnerHandover(tableId);
  const table = await loadTableDetail(tableId);

  if (!table) {
    res.status(404).json({ error: 'table not found' });
    return;
  }

  res.status(200).json(table);
});

tablesRouter.post('/tables/:tableId/join', requireAuth, async (req: AuthenticatedRequest, res) => {
  const requesterId = req.userId as string;
  const { tableId } = req.params;
  const { joinAs, joinCode } = req.body ?? {};

  if (!['player', 'spectator'].includes(joinAs)) {
    res.status(400).json({ error: 'joinAs must be player or spectator' });
    return;
  }

  await evaluateOwnerHandover(tableId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tableResult = await client.query(
      `SELECT id, owner_user_id, visibility, join_code, allow_spectators, max_players,
              max_spectators, state
       FROM game_table WHERE id = $1 FOR UPDATE`,
      [tableId],
    );
    if (tableResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'table not found' });
      return;
    }
    const table = tableResult.rows[0];

    if (table.state === 'closed' || table.state === 'finished') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'TABLE_NOT_JOINABLE' });
      return;
    }
    if (joinAs === 'player' && table.state !== 'open') {
      // FR-045: a player who already sat at this table (i.e. is
      // reconnecting mid-match) may rejoin while the table is running;
      // a brand-new player may only join while the table is still open.
      const priorSeatResult = await client.query(
        `SELECT id FROM table_seat WHERE table_id = $1 AND user_id = $2 LIMIT 1`,
        [tableId, requesterId],
      );
      if (table.state !== 'running' || (priorSeatResult.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'TABLE_NOT_JOINABLE' });
        return;
      }
    }
    if (joinAs === 'spectator' && !table.allow_spectators) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'TABLE_NOT_JOINABLE' });
      return;
    }
    if (table.visibility === 'private' && joinCode !== table.join_code) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'TABLE_JOIN_CODE_INVALID' });
      return;
    }

    const existingSeatResult = await client.query(
      `SELECT id, seat_type FROM table_seat WHERE table_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [tableId, requesterId],
    );
    if ((existingSeatResult.rowCount ?? 0) > 0) {
      if (requesterId === table.owner_user_id) {
        await client.query(`UPDATE game_table SET owner_left_at = NULL WHERE id = $1`, [tableId]);
      }
      await client.query('COMMIT');
      res.status(200).json({
        tableId,
        seatType: existingSeatResult.rows[0].seat_type,
        alreadyJoined: true,
      });
      return;
    }

    const countResult = await client.query(
      `SELECT
          COUNT(*) FILTER (WHERE seat_type = 'player') AS active_players,
          COUNT(*) FILTER (WHERE seat_type = 'spectator') AS active_spectators
       FROM table_seat WHERE table_id = $1 AND left_at IS NULL`,
      [tableId],
    );
    const activePlayers = Number(countResult.rows[0].active_players);
    const activeSpectators = Number(countResult.rows[0].active_spectators);

    if (joinAs === 'player' && activePlayers >= table.max_players) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'TABLE_FULL' });
      return;
    }
    if (joinAs === 'spectator' && activeSpectators >= table.max_spectators) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'TABLE_FULL' });
      return;
    }

    await client.query(
      `INSERT INTO table_seat (table_id, user_id, seat_type) VALUES ($1, $2, $3)`,
      [tableId, requesterId, joinAs],
    );

    if (requesterId === table.owner_user_id) {
      await client.query(`UPDATE game_table SET owner_left_at = NULL WHERE id = $1`, [tableId]);
    }

    await client.query('COMMIT');
    await Promise.all([broadcastLobby(), broadcastTable(tableId)]);
    res.status(200).json({ tableId, seatType: joinAs, alreadyJoined: false });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

tablesRouter.post('/tables/:tableId/leave', requireAuth, async (req: AuthenticatedRequest, res) => {
  const requesterId = req.userId as string;
  const { tableId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tableResult = await client.query(
      `SELECT owner_user_id FROM game_table WHERE id = $1 FOR UPDATE`,
      [tableId],
    );
    if (tableResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'table not found' });
      return;
    }

    const seatResult = await client.query(
      `UPDATE table_seat SET left_at = NOW()
       WHERE table_id = $1 AND user_id = $2 AND left_at IS NULL
       RETURNING id`,
      [tableId, requesterId],
    );
    if (seatResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'not seated at this table' });
      return;
    }

    const isOwner = tableResult.rows[0].owner_user_id === requesterId;
    if (isOwner) {
      await client.query(`UPDATE game_table SET owner_left_at = NOW() WHERE id = $1`, [tableId]);
    }

    // FR-044/045: leaving mid-match starts a 90s rejoin grace period
    // before the early-leave karma penalty is applied.
    const activeGameResult = await client.query(
      `SELECT id FROM game WHERE table_id = $1 AND status = 'active' LIMIT 1`,
      [tableId],
    );
    const activeGameId = activeGameResult.rows[0]?.id as string | undefined;

    await client.query('COMMIT');
    await Promise.all([broadcastLobby(), broadcastTable(tableId)]);

    if (activeGameId) {
      scheduleEarlyLeavePenaltyCheck(activeGameId, tableId, requesterId);
    }

    res.status(200).json({ tableId, ownerReconnectWindowStarted: isOwner });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Manual early start: the table admin can start once every currently
// seated player is ready, even below the table's configured max player
// count (see startTableGame). Reaching that max count with everyone ready
// auto-starts without anyone needing to call this - see the /ready route.
tablesRouter.post('/tables/:tableId/start', requireAuth, async (req: AuthenticatedRequest, res) => {
  const requesterId = req.userId as string;
  const requesterRole = req.userRole;
  const { tableId } = req.params;

  await evaluateOwnerHandover(tableId);

  const tableResult = await pool.query(`SELECT owner_user_id FROM game_table WHERE id = $1`, [tableId]);
  if (tableResult.rowCount === 0) {
    res.status(404).json({ error: 'table not found' });
    return;
  }
  if (tableResult.rows[0].owner_user_id !== requesterId && requesterRole !== 'admin') {
    res.status(403).json({ error: 'only the table admin can start the game' });
    return;
  }

  const outcome = await startTableGame(tableId);
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.code, message: outcome.message });
    return;
  }

  await Promise.all([broadcastLobby(), broadcastTable(tableId)]);
  res.status(200).json({ tableId, tableSessionId: outcome.tableSessionId, gameId: outcome.gameId });
});

// FR: every seated player must mark themselves ready before the table can
// start. Auto-starts as soon as the configured player count is reached and
// everyone is ready; otherwise the admin can force an early start via
// POST /start once everyone currently seated is ready (see startTableGame).
tablesRouter.post('/tables/:tableId/ready', requireAuth, async (req: AuthenticatedRequest, res) => {
  const requesterId = req.userId as string;
  const { tableId } = req.params;
  const { ready = true } = req.body ?? {};

  if (typeof ready !== 'boolean') {
    res.status(400).json({ error: 'ready must be a boolean' });
    return;
  }

  const tableResult = await pool.query(`SELECT state, max_players FROM game_table WHERE id = $1`, [tableId]);
  if (tableResult.rowCount === 0) {
    res.status(404).json({ error: 'table not found' });
    return;
  }
  const table = tableResult.rows[0];
  if (table.state !== 'open') {
    res.status(409).json({ error: 'TABLE_NOT_OPEN', message: 'table is not open' });
    return;
  }

  const seatResult = await pool.query(
    `UPDATE table_seat SET ready = $1
     WHERE table_id = $2 AND user_id = $3 AND seat_type = 'player' AND left_at IS NULL
     RETURNING id`,
    [ready, tableId, requesterId],
  );
  if (seatResult.rowCount === 0) {
    res.status(404).json({ error: 'not seated as a player at this table' });
    return;
  }

  const seatsResult = await pool.query(
    `SELECT ready FROM table_seat WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL`,
    [tableId],
  );
  const activeCount = seatsResult.rowCount ?? 0;
  const allReady = seatsResult.rows.every((row) => row.ready);

  if (ready && allReady && activeCount === table.max_players) {
    const outcome = await startTableGame(tableId);
    if (outcome.ok) {
      await Promise.all([broadcastLobby(), broadcastTable(tableId)]);
      res.status(200).json({ tableId, started: true, tableSessionId: outcome.tableSessionId, gameId: outcome.gameId });
      return;
    }
    // Someone else's concurrent change (e.g. a leave) invalidated the
    // condition between the query above and the attempt - not an error the
    // requester caused, just report the ready-toggle as accepted.
  }

  await broadcastTable(tableId);
  res.status(200).json({ tableId, started: false, ready });
});

// FR-017/AK-009: starts a new game at the same table, with the same
// player composition and table settings, without requiring anyone to
// rejoin. AK-011: stays in the same table_session so the session-wide
// song no-repeat-until-exhausted rule keeps applying across "Neue Partie".
tablesRouter.post('/tables/:tableId/new-game', requireAuth, async (req: AuthenticatedRequest, res) => {
  const requesterId = req.userId as string;
  const requesterRole = req.userRole;
  const { tableId } = req.params;

  await evaluateOwnerHandover(tableId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tableResult = await client.query(
      `SELECT id, owner_user_id, state FROM game_table WHERE id = $1 FOR UPDATE`,
      [tableId],
    );
    if (tableResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'table not found' });
      return;
    }
    const table = tableResult.rows[0];

    if (table.owner_user_id !== requesterId && requesterRole !== 'admin') {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'only the table admin can start a new game' });
      return;
    }
    if (table.state !== 'finished') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'the current game has not finished yet' });
      return;
    }

    const previousGameResult = await client.query(
      `SELECT table_session_id FROM game WHERE table_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tableId],
    );
    if (previousGameResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'no previous game found for this table' });
      return;
    }
    const tableSessionId = previousGameResult.rows[0].table_session_id;

    const activePlayersResult = await client.query(
      `SELECT user_id FROM table_seat
       WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL`,
      [tableId],
    );
    const activePlayerIds: string[] = activePlayersResult.rows.map((row) => row.user_id);
    if (activePlayerIds.length < 2) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'at least 2 active players are required to start' });
      return;
    }

    const range = await computeYearRange(client);
    if (!range) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'SONG_METADATA_INVALID: no valid songs in the playlist yet' });
      return;
    }

    const gameResult = await client.query(
      `INSERT INTO game (table_id, table_session_id, status, started_at)
       VALUES ($1, $2, 'active', NOW())
       RETURNING id`,
      [tableId, tableSessionId],
    );
    await generateStartBlocks(client, gameResult.rows[0].id, activePlayerIds);
    await client.query(`UPDATE game_table SET state = 'running' WHERE id = $1`, [tableId]);

    await client.query('COMMIT');
    await broadcastTable(tableId);
    res.status(200).json({
      tableId,
      tableSessionId,
      gameId: gameResult.rows[0].id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
