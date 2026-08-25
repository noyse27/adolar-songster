exports.shorthands = undefined;

// The "Bisher insgesamt gespielte Spiele auf dem Server" home-screen stat
// (leaderboard.ts's /stats/games-played) used to just COUNT(*) finished
// games - but game.table_id is ON DELETE CASCADE off game_table, and
// tableCleanup.ts hard-deletes any table inactive for over an hour,
// silently wiping its finished game(s) along with it. The count would
// quietly drop back toward zero as old tables got swept, days after the
// games were actually played. A dedicated counter in system_setting
// (matchOutcome.ts's finishGame now increments it atomically) survives
// that cleanup - seeded here from whatever finished games still exist so
// existing history isn't lost, then only ever incremented from now on.
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO system_setting (key, value)
    VALUES ('total_games_finished', (SELECT COUNT(*) FROM game WHERE status = 'finished')::text)
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_setting WHERE key = 'total_games_finished';`);
};
