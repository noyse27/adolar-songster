/* eslint-disable @typescript-eslint/no-var-requires */
const { Pool } = require('pg');

// H-06: this unconditionally wipes every core table. DATABASE_URL is
// operator-supplied (README/.env), so a typo or a copy-pasted staging URL
// would otherwise empty a real database the moment `npm run
// test:integration` runs. Only proceed against a host that's clearly a
// local/CI throwaway instance, or when the operator has explicitly opted
// in via ALLOW_DESTRUCTIVE_TEST_DB=true.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'db', 'postgres']);

function assertSafeToTruncate(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('globalSetup: DATABASE_URL is not a valid connection string, refusing to run TRUNCATE.');
  }

  const host = url.hostname;
  const database = url.pathname.replace(/^\//, '');
  console.log(`globalSetup: integration tests will TRUNCATE database "${database}" on host "${host}"`);

  if (process.env.ALLOW_DESTRUCTIVE_TEST_DB === 'true') return;
  if (LOCAL_HOSTS.has(host)) return;

  throw new Error(
    `globalSetup: refusing to TRUNCATE database "${database}" on host "${host}" - it doesn't look like ` +
      'a local/CI throwaway instance. Point DATABASE_URL at a disposable database (host localhost/127.0.0.1' +
      '/db/postgres), or set ALLOW_DESTRUCTIVE_TEST_DB=true if you are certain this target is safe to wipe.',
  );
}

// Runs once before the whole integration suite so every test file starts
// from a known-empty state (e.g. the admin-bootstrap tests rely on "no
// admin exists yet").
module.exports = async () => {
  assertSafeToTruncate(process.env.DATABASE_URL);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`
    TRUNCATE TABLE
      score_ledger, karma_ledger, timeline_card, token_usage, guess,
      session_song_history, round, game, song_ref, table_session,
      table_seat, game_table, invite_token, app_user,
      game_playlist, game_playlist_track, adolar_playlist
    RESTART IDENTITY CASCADE;
  `);
  await pool.end();
};
