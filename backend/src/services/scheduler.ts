import cron from 'node-cron';
import { syncAllAdolarPlaylists } from './adolarSync';
import { deleteInactiveTables } from './tableCleanup';
import { deleteExpiredPlaylists } from './playlistCleanup';

// Once daily at 03:00 server time (low-traffic hour for a private-group
// game) plus once immediately on boot, so a fresh deploy doesn't wait up
// to 24h for its first sync. Runs only from index.ts (the real server
// entrypoint) - never from createApp()/tests, which don't want a live
// background job touching the DB during a test run.
const DAILY_SCHEDULE = '0 3 * * *';

function runSync(reason: string): void {
  syncAllAdolarPlaylists()
    .then((result) => {
      console.log(`[adolar-sync] ${reason}: synced ${result.trackCount} tracks across ${result.playlistCount} playlists`);
    })
    .catch((err) => {
      console.error(`[adolar-sync] ${reason} failed`, err);
    });
}

export function startAdolarSyncSchedule(): void {
  runSync('startup sync');
  cron.schedule(DAILY_SCHEDULE, () => runSync('daily sync'));
}

// Every minute: cheap enough at this scale (a private-group game, not
// thousands of concurrent tables) and keeps a table from lingering for up
// to a day if it goes stale - see tableCleanup.ts for why this is a hard
// delete rather than the normal leave-table path.
export function startTableCleanupSchedule(): void {
  cron.schedule('* * * * *', () => {
    deleteInactiveTables().catch((err) => {
      console.error('[table-cleanup] failed', err);
    });
  });
}

// Once daily at 04:00 server time: Playlist-Tracking-Daten (Fehleranalyse)
// werden nach 1 Woche geloescht (siehe playlistCleanup.ts) - kein
// minuetlicher Job noetig, expires_at aendert sich nur ueber Tage.
export function startPlaylistCleanupSchedule(): void {
  cron.schedule('0 4 * * *', () => {
    deleteExpiredPlaylists().catch((err) => {
      console.error('[playlist-cleanup] failed', err);
    });
  });
}
