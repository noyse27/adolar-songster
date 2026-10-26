import { NextFunction, Request, Response } from 'express';
import { DEMO_MODE } from '../config/demoMode';

// Applied to individual destructive admin routes (see routes/admin.ts) -
// blocks the actions that would let one demo visitor lock other visitors
// out of the shared instance (revoking someone's invite rights, blocking
// their registered account, wiping the seeded song pool) or otherwise
// fight the periodic reset/reseed. Read-only admin endpoints (GET
// /admin/users, /admin/songs search, /admin/adolar-playlists) and
// low-risk ones stay available so the demo still shows a working admin
// screen.
export function blockInDemoMode(action: string) {
  return function demoBlockMiddleware(_req: Request, res: Response, next: NextFunction): void {
    if (DEMO_MODE) {
      res.status(403).json({ error: `${action} is disabled in demo mode` });
      return;
    }
    next();
  };
}
