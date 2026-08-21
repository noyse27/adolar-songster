import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { setupRouter } from './routes/setup';
import { invitesRouter } from './routes/invites';
import { adminRouter } from './routes/admin';
import { tablesRouter } from './routes/tables';
import { roundsRouter } from './routes/rounds';
import { leaderboardRouter } from './routes/leaderboard';
import { apiLimiter, authLimiter } from './middleware/rateLimit';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.use('/api/v1', healthRouter);
  app.use('/api/v1', apiLimiter);
  app.use('/api/v1/auth', authLimiter);
  app.use('/api/v1/setup', authLimiter);

  app.use('/api/v1', authRouter);
  app.use('/api/v1', setupRouter);
  app.use('/api/v1', invitesRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1', tablesRouter);
  app.use('/api/v1', roundsRouter);
  app.use('/api/v1', leaderboardRouter);

  return app;
}
