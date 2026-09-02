exports.shorthands = undefined;

// Auto-ready preferences are per-game scratch state. They must disappear
// with their game when an inactive/admin-deleted table cascades through
// game_table -> game; otherwise old games with auto-ready rows block table
// cleanup entirely.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE round_ready_pref DROP CONSTRAINT round_ready_pref_game_id_fkey,
      ADD CONSTRAINT round_ready_pref_game_id_fkey
      FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE round_ready_pref DROP CONSTRAINT round_ready_pref_game_id_fkey,
      ADD CONSTRAINT round_ready_pref_game_id_fkey
      FOREIGN KEY (game_id) REFERENCES game(id);
  `);
};
