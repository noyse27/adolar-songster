import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';

export const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: string;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }

  let payload: { sub: string; role: string; sessionVersion: number };
  try {
    payload = jwt.verify(header.slice('Bearer '.length), JWT_SECRET) as {
      sub: string;
      role: string;
      sessionVersion: number;
    };
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
    return;
  }

  // The JWT signature/expiry alone doesn't prove the user still exists -
  // e.g. a dev DB reset, or the account being deleted/blocked after the
  // token was issued. Without this check, a stale-but-unexpired token sails
  // through here and then blows up downstream as a raw FK-violation on
  // whichever table references the user (see game_table.owner_user_id).
  //
  // session_version also enforces single-active-session: every login bumps
  // it (see routes/auth.ts), so a token from an earlier login on another
  // device stops matching here on its very next request.
  const result = await pool.query(`SELECT status, session_version FROM app_user WHERE id = $1`, [payload.sub]);
  if (
    result.rowCount === 0 ||
    result.rows[0].status !== 'active' ||
    result.rows[0].session_version !== payload.sessionVersion
  ) {
    res.status(401).json({ error: 'invalid or expired token' });
    return;
  }

  req.userId = payload.sub;
  req.userRole = payload.role;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.userRole !== 'admin') {
    res.status(403).json({ error: 'admin role required' });
    return;
  }
  next();
}
