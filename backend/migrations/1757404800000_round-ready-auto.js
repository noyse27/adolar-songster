exports.shorthands = undefined;

// "Auto bereit" (per-player, per-match toggle - see roundReady.ts): a
// player can lock themselves into auto-readying for every round-ready
// window of the *current* game. Deliberately keyed on game_id (not
// table_id/table_seat) so it resets to off on its own once a new match
// starts (table restart always creates a fresh game row, see
// tableStart.ts/tableRestart.ts) - no explicit reset logic needed.
//
// Kept separate from round_ready itself because that table is emptied on
// every window resolution (see roundReady.ts's clearReadyState) - a sticky
// per-match preference needs a row that survives across many round-ready
// cycles within the same game.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS round_ready_pref (
        game_id UUID NOT NULL REFERENCES game(id),
        user_id UUID NOT NULL REFERENCES app_user(id),
        auto_ready BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (game_id, user_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS round_ready_pref;
  `);
};
