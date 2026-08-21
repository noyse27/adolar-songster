import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';

export const invitesRouter = Router();

const MONTHLY_QUOTA_FOR_DELEGATED_USERS = 3;
const DEFAULT_EXPIRES_IN_DAYS = 14;

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

invitesRouter.post('/invites', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { maxUses, expiresInDays } = req.body ?? {};
  const requesterId = req.userId as string;

  const requesterResult = await pool.query(
    `SELECT role, can_create_invites, invite_quota_reset_at FROM app_user WHERE id = $1`,
    [requesterId],
  );
  if (requesterResult.rowCount === 0) {
    res.status(401).json({ error: 'unknown user' });
    return;
  }
  const requester = requesterResult.rows[0];
  const isAdmin = requester.role === 'admin';

  if (!isAdmin) {
    if (!requester.can_create_invites) {
      res.status(403).json({ error: 'not authorized to create invites' });
      return;
    }

    const windowStart = new Date(
      Math.max(
        new Date(requester.invite_quota_reset_at).getTime(),
        startOfCurrentMonthUtc().getTime(),
      ),
    );

    const usageResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM invite_token WHERE created_by = $1 AND created_at >= $2`,
      [requesterId, windowStart],
    );
    const usedCount = usageResult.rows[0].count as number;

    if (usedCount >= MONTHLY_QUOTA_FOR_DELEGATED_USERS) {
      res.status(429).json({ error: 'monthly invite quota exhausted' });
      return;
    }
  }

  const resolvedMaxUses = Number.isInteger(maxUses) && maxUses > 0 ? maxUses : 1;
  const resolvedExpiresInDays =
    Number.isInteger(expiresInDays) && expiresInDays > 0 ? expiresInDays : DEFAULT_EXPIRES_IN_DAYS;

  const code = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + resolvedExpiresInDays * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `INSERT INTO invite_token (code, created_by, max_uses, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, code, max_uses, expires_at, created_at`,
    [code, requesterId, resolvedMaxUses, expiresAt],
  );

  res.status(201).json({
    inviteId: result.rows[0].id,
    code: result.rows[0].code,
    maxUses: result.rows[0].max_uses,
    expiresAt: result.rows[0].expires_at,
  });
});

invitesRouter.get('/invites', requireAuth, async (req: AuthenticatedRequest, res) => {
  const requesterId = req.userId as string;
  const requesterResult = await pool.query(`SELECT role FROM app_user WHERE id = $1`, [requesterId]);
  const isAdmin = requesterResult.rows[0]?.role === 'admin';

  const result = await pool.query(
    `SELECT it.id, it.code, it.max_uses, it.used_count, it.expires_at, it.disabled_at, it.created_at,
            u.username AS created_by_username
     FROM invite_token it
     JOIN app_user u ON u.id = it.created_by
     WHERE $1 OR it.created_by = $2
     ORDER BY it.created_at DESC`,
    [isAdmin, requesterId],
  );

  res.status(200).json({
    invites: result.rows.map((row) => ({
      inviteId: row.id,
      code: row.code,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      expiresAt: row.expires_at,
      disabledAt: row.disabled_at,
      createdAt: row.created_at,
      createdByUsername: row.created_by_username,
    })),
  });
});

invitesRouter.post('/invites/:inviteId/disable', requireAuth, async (req: AuthenticatedRequest, res) => {
  const requesterId = req.userId as string;
  const { inviteId } = req.params;

  const requesterResult = await pool.query(`SELECT role FROM app_user WHERE id = $1`, [requesterId]);
  const isAdmin = requesterResult.rows[0]?.role === 'admin';

  const result = await pool.query(
    `UPDATE invite_token
     SET disabled_at = NOW()
     WHERE id = $1 AND ($2 OR created_by = $3) AND disabled_at IS NULL
     RETURNING id`,
    [inviteId, isAdmin, requesterId],
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'invite not found or not owned by requester' });
    return;
  }

  res.status(200).json({ inviteId });
});
