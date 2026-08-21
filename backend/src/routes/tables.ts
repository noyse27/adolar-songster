import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';

export const tablesRouter = Router();

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

  const joinCode = visibility === 'private' ? generateJoinCode() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tableResult = await client.query(
      `INSERT INTO game_table
         (owner_user_id, name, visibility, join_code, allow_spectators, max_players, max_spectators)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, visibility, join_code, state`,
      [requesterId, name, visibility, joinCode, Boolean(allowSpectators), maxPlayers, maxSpectators],
    );
    const table = tableResult.rows[0];

    await client.query(
      `INSERT INTO table_seat (table_id, user_id, seat_type) VALUES ($1, $2, 'player')`,
      [table.id, requesterId],
    );

    await client.query('COMMIT');

    res.status(201).json({
      tableId: table.id,
      name: table.name,
      visibility: table.visibility,
      joinCode: table.join_code,
      state: table.state,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

tablesRouter.get('/tables/lobby', requireAuth, async (_req, res) => {
  const result = await pool.query(
    `SELECT
        t.id, t.name, t.visibility, t.allow_spectators, t.max_players, t.max_spectators, t.state,
        COUNT(*) FILTER (WHERE s.seat_type = 'player' AND s.left_at IS NULL) AS active_players,
        COUNT(*) FILTER (WHERE s.seat_type = 'spectator' AND s.left_at IS NULL) AS active_spectators
     FROM game_table t
     LEFT JOIN table_seat s ON s.table_id = t.id
     WHERE t.visibility = 'public' AND t.state = 'open'
     GROUP BY t.id
     ORDER BY t.created_at DESC`,
  );

  res.status(200).json({
    tables: result.rows.map((row) => ({
      tableId: row.id,
      name: row.name,
      visibility: row.visibility,
      allowSpectators: row.allow_spectators,
      maxPlayers: row.max_players,
      maxSpectators: row.max_spectators,
      state: row.state,
      activePlayers: Number(row.active_players),
      activeSpectators: Number(row.active_spectators),
    })),
  });
});
