exports.shorthands = undefined;

// Game start (not each round - see roundEngine.startRound, which is
// owner-only with no readiness gate) requires every seated player to mark
// themselves ready first: the table auto-starts once the configured player
// count is reached and everyone is ready, or the admin can force an early
// start once everyone currently seated (even below the configured count)
// is ready - see tables.ts's /ready endpoint and tableStart.ts.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE table_seat ADD COLUMN ready BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE table_seat DROP COLUMN IF EXISTS ready;
  `);
};
