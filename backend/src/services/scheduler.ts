import cron from 'node-cron';
import { syncAllAdolarPlaylists } from './adolarSync';

// Once daily at 03:00 server time (low-traffic hour for a private-group
// game) plus once immediately on boot, so a fresh deploy doesn't wait up
// to 24h for its first sync. Runs only from index.ts (the real server
// entrypoint) - never from createApp()/tests, which don't want a live
// background job touching the DB during a test run.
const DAILY_SCHEDULE = '0 3 * * *';

function runSync(reason: string): void {
  syncAllAdolarPlaylists()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(`[adolar-sync] ${reason}: synced ${result.trackCount} tracks across ${result.playlistCount} playlists`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[adolar-sync] ${reason} failed`, err);
    });
}

export function startAdolarSyncSchedule(): void {
  runSync('startup sync');
  cron.schedule(DAILY_SCHEDULE, () => runSync('daily sync'));
}
