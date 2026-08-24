exports.shorthands = undefined;

// Fixes a real gap in the original min_karma_points/min_score_points/
// min_games_played design: they were NOT NULL DEFAULT 0, so there was no
// way to represent "this table has no requirement at all" distinct from
// "the requirement is exactly 0" - every table silently required at least
// 0 karma/score/games whether the owner meant to or not. Making them
// nullable (NULL = not required) lets the create-table UI use a genuine
// checkbox-to-enable per field (see CreateTablePage.tsx) instead of an
// always-on numeric input that can never truly be "off".
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table
      ALTER COLUMN min_karma_points DROP NOT NULL,
      ALTER COLUMN min_karma_points DROP DEFAULT,
      ALTER COLUMN min_score_points DROP NOT NULL,
      ALTER COLUMN min_score_points DROP DEFAULT,
      ALTER COLUMN min_games_played DROP NOT NULL,
      ALTER COLUMN min_games_played DROP DEFAULT;

    UPDATE game_table SET min_karma_points = NULL WHERE min_karma_points = 0;
    UPDATE game_table SET min_score_points = NULL WHERE min_score_points = 0;
    UPDATE game_table SET min_games_played = NULL WHERE min_games_played = 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE game_table SET min_karma_points = 0 WHERE min_karma_points IS NULL;
    UPDATE game_table SET min_score_points = 0 WHERE min_score_points IS NULL;
    UPDATE game_table SET min_games_played = 0 WHERE min_games_played IS NULL;

    ALTER TABLE game_table
      ALTER COLUMN min_karma_points SET DEFAULT 0,
      ALTER COLUMN min_karma_points SET NOT NULL,
      ALTER COLUMN min_score_points SET DEFAULT 0,
      ALTER COLUMN min_score_points SET NOT NULL,
      ALTER COLUMN min_games_played SET DEFAULT 0,
      ALTER COLUMN min_games_played SET NOT NULL;
  `);
};
