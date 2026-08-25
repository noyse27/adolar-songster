exports.shorthands = undefined;

// Hostmodus (gemeinsames Anzeigegerät): tracks whether a display-token
// socket (see services/displayToken.ts) is currently connected for this
// table. Deliberately NOT a table_seat row - the display device has no
// app_user login at all (would collide with single-active-session, see
// middleware/auth.ts), so there is no user_id to hang a seat off of. A
// timestamp column survives a server restart better than an in-memory
// counter would - socketServer.ts sets/clears it on connect/disconnect.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table ADD COLUMN display_connected_at TIMESTAMPTZ;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table DROP COLUMN IF EXISTS display_connected_at;
  `);
};
