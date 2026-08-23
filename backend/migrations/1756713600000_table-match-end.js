exports.shorthands = undefined;

// Powers the "fancy" winner screen's synced 60s auto-close countdown and
// the table-restart flow: match_ended_at is stamped by finishGame() the
// moment a match concludes, cleared again by tableRestart.ts's
// restartTable() if someone rematches before the window elapses. See
// services/tableRestart.ts.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table ADD COLUMN match_ended_at TIMESTAMPTZ;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table DROP COLUMN IF EXISTS match_ended_at;
  `);
};
