exports.shorthands = undefined;

// Risk-free solo mode: a table flagged is_solo is forced server-side (see
// routes/tables.ts) to exactly 1 max player and private visibility, so it
// never shows up in a public lobby as an already-full, un-joinable table.
// Relaxes the max_players CHECK to allow 1 - non-solo tables still enforce
// 2-5 purely in application code (routes/tables.ts), same as before.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table
      ADD COLUMN is_solo BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE game_table DROP CONSTRAINT IF EXISTS game_table_max_players_check;
    ALTER TABLE game_table ADD CONSTRAINT game_table_max_players_check CHECK (max_players BETWEEN 1 AND 5);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table DROP CONSTRAINT IF EXISTS game_table_max_players_check;
    ALTER TABLE game_table ADD CONSTRAINT game_table_max_players_check CHECK (max_players BETWEEN 2 AND 5);

    ALTER TABLE game_table DROP COLUMN IF EXISTS is_solo;
  `);
};
