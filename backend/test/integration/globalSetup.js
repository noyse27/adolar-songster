/* eslint-disable @typescript-eslint/no-var-requires */
const { Pool } = require('pg');

// Runs once before the whole integration suite so every test file starts
// from a known-empty state (e.g. the admin-bootstrap tests rely on "no
// admin exists yet").
module.exports = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`
    TRUNCATE TABLE
      score_ledger, karma_ledger, timeline_card, token_usage, guess,
      session_song_history, round, game, song_ref, table_session,
      table_seat, game_table, invite_token, app_user
    RESTART IDENTITY CASCADE;
  `);
  await pool.end();
};
