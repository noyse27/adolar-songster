import 'dotenv/config';
import { createServer } from 'http';
import { createApp } from './app';
import { createSocketServer } from './realtime/socketServer';
import { startAdolarSyncSchedule, startTableCleanupSchedule } from './services/scheduler';

const port = Number(process.env.PORT ?? 4000);

const app = createApp();
const httpServer = createServer(app);
createSocketServer(httpServer);
startAdolarSyncSchedule();
startTableCleanupSchedule();

httpServer.listen(port, () => {
  console.log(`adolar-songster backend listening on port ${port}`);
});
