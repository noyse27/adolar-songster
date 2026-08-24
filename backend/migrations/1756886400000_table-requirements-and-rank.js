exports.shorthands = undefined;

// Table-creation feature: an owner can require a minimum karma/score/games-
// played before someone may join as a *player* (spectating stays open
// regardless - enforced in routes/tables.ts's POST /tables/:id/join).
// games_played is a new running total on app_user, incremented in
// matchOutcome.ts's finishGame() for every player who submitted at least
// one guess in that game - mirrors how score_points/karma_points already
// work (see initial-schema.js), not summed from a ledger at read time.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE game_table
      ADD COLUMN min_karma_points INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN min_score_points INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN min_games_played INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE game_table ADD CONSTRAINT game_table_min_karma_points_check CHECK (min_karma_points >= 0);
    ALTER TABLE game_table ADD CONSTRAINT game_table_min_score_points_check CHECK (min_score_points >= 0);
    ALTER TABLE game_table ADD CONSTRAINT game_table_min_games_played_check CHECK (min_games_played >= 0);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table
      DROP CONSTRAINT IF EXISTS game_table_min_karma_points_check,
      DROP CONSTRAINT IF EXISTS game_table_min_score_points_check,
      DROP CONSTRAINT IF EXISTS game_table_min_games_played_check,
      DROP COLUMN IF EXISTS min_karma_points,
      DROP COLUMN IF EXISTS min_score_points,
      DROP COLUMN IF EXISTS min_games_played;

    ALTER TABLE app_user DROP COLUMN IF EXISTS games_played;
  `);
};
