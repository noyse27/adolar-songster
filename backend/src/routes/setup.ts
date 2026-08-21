import { Router } from 'express';
import argon2 from 'argon2';
import { pool } from '../db/pool';

export const setupRouter = Router();

// One-time bootstrap: creates the first admin account. Only usable while
// no admin exists yet, so it cannot be used to escalate privileges later.
setupRouter.post('/setup/bootstrap', async (req, res) => {
  const { username, email, password } = req.body ?? {};

  if (!username || !email || !password) {
    res.status(400).json({ error: 'username, email and password are required' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingAdmin = await client.query(
      `SELECT id FROM app_user WHERE role = 'admin' LIMIT 1 FOR UPDATE`,
    );

    if ((existingAdmin.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'an admin account already exists' });
      return;
    }

    const passwordHash = await argon2.hash(password);
    const result = await client.query(
      `INSERT INTO app_user (username, email, password_hash, role, can_create_invites)
       VALUES ($1, $2, $3, 'admin', TRUE)
       RETURNING id, username`,
      [username, email, passwordHash],
    );

    await client.query('COMMIT');
    res.status(201).json({ userId: result.rows[0].id, username: result.rows[0].username });
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'username or email already in use' });
      return;
    }
    throw err;
  } finally {
    client.release();
  }
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
