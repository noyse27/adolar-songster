import { Router } from 'express';
import argon2 from 'argon2';
import { pool } from '../db/pool';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';

export const usersRouter = Router();

// GET /users/me - own profile incl. score and karma (per API spec section 2).
usersRouter.get('/users/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  const result = await pool.query(
    `SELECT id, username, email, role, can_create_invites, karma_points, score_points, created_at
     FROM app_user WHERE id = $1`,
    [req.userId],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  const user = result.rows[0];
  res.status(200).json({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    canCreateInvites: user.can_create_invites,
    karmaPoints: user.karma_points,
    scorePoints: user.score_points,
    createdAt: user.created_at,
  });
});

usersRouter.post('/users/me/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (!currentPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'currentPassword and newPassword (min. 8 characters) are required' });
    return;
  }

  const result = await pool.query(`SELECT password_hash FROM app_user WHERE id = $1`, [req.userId]);
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user not found' });
    return;
  }

  const valid = await argon2.verify(result.rows[0].password_hash, currentPassword);
  if (!valid) {
    res.status(401).json({ error: 'current password is incorrect' });
    return;
  }

  const newHash = await argon2.hash(newPassword);
  await pool.query(`UPDATE app_user SET password_hash = $1 WHERE id = $2`, [newHash, req.userId]);

  res.status(200).json({ ok: true });
});
