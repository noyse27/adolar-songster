import { Router } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';

export const leaderboardRouter = Router();

leaderboardRouter.get('/leaderboard', requireAuth, async (_req, res) => {
  const result = await pool.query(
    `SELECT id, username, score_points, karma_points
     FROM app_user
     ORDER BY score_points DESC, karma_points DESC, username ASC
     LIMIT 100`,
  );

  res.status(200).json({
    leaderboard: result.rows.map((row) => ({
      userId: row.id,
      username: row.username,
      scorePoints: row.score_points,
      karmaPoints: row.karma_points,
    })),
  });
});

leaderboardRouter.get('/users/:userId/karma-ledger', requireAuth, async (req, res) => {
  const { userId } = req.params;

  const userResult = await pool.query(`SELECT id, karma_points FROM app_user WHERE id = $1`, [userId]);
  if (userResult.rowCount === 0) {
    res.status(404).json({ error: 'user not found' });
    return;
  }

  const ledgerResult = await pool.query(
    `SELECT id, game_id, delta, reason, created_at
     FROM karma_ledger WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  res.status(200).json({
    userId,
    karmaPoints: userResult.rows[0].karma_points,
    entries: ledgerResult.rows.map((row) => ({
      entryId: row.id,
      gameId: row.game_id,
      delta: row.delta,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  });
});
