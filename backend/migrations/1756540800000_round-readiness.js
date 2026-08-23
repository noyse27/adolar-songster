exports.shorthands = undefined;

// Per-round readiness (distinct from table_seat.ready, which only gates the
// very first game start - see 1756454400000_table-seat-ready.js): every
// round after that also opens with a 30s ready window. The round
// auto-starts once every active player has readied up, or after 30s with
// whoever hasn't sitting that round out (round_sitout) - see
// services/roundReady.ts.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE game ADD COLUMN round_ready_started_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS round_ready (
        game_id UUID NOT NULL REFERENCES game(id),
        user_id UUID NOT NULL REFERENCES app_user(id),
        ready BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (game_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS round_sitout (
        round_id UUID NOT NULL REFERENCES round(id),
        user_id UUID NOT NULL REFERENCES app_user(id),
        PRIMARY KEY (round_id, user_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS round_sitout;
    DROP TABLE IF EXISTS round_ready;
    ALTER TABLE game DROP COLUMN IF EXISTS round_ready_started_at;
  `);
};
