import 'dotenv/config';
import { createServer } from 'http';
import { createApp } from './app';
import { createSocketServer } from './realtime/socketServer';
import { startAdolarSyncSchedule, startTableCleanupSchedule, startPlaylistCleanupSchedule, startChatCleanupSchedule } from './services/scheduler';
import { DEMO_MODE } from './config/demoMode';
import { assertDemoSafeToManage, startDemoResetSchedule } from './services/demoReset';

const port = Number(process.env.PORT ?? 4000);

async function main(): Promise<void> {
  if (DEMO_MODE) {
    // Fail closed: refuse to start rather than risk periodically wiping a
    // database that turns out not to be a fresh demo instance (see
    // assertDemoSafeToManage's own comment).
    await assertDemoSafeToManage();
    startDemoResetSchedule();
    console.log('[demo-reset] DEMO_MODE is active - destructive admin actions are blocked, see middleware/demoBlock.ts');
  }

  const app = createApp();
  const httpServer = createServer(app);
  createSocketServer(httpServer);
  startAdolarSyncSchedule();
  startTableCleanupSchedule();
  startPlaylistCleanupSchedule();
  startChatCleanupSchedule();

  httpServer.listen(port, () => {
    console.log(`adolar-songster backend listening on port ${port}`);
  });
}

main().catch((err) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
