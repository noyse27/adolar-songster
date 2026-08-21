exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table
      ADD COLUMN owner_left_at TIMESTAMPTZ;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table
      DROP COLUMN IF EXISTS owner_left_at;
  `);
};
