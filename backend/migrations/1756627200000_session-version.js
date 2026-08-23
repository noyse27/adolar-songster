exports.shorthands = undefined;

// Single-active-session enforcement: each login stamps the issued JWT with
// the user's current session_version and bumps it in the same step, so any
// previously-issued token (a different device/browser still logged in)
// stops matching on its next request and gets treated the same as an
// expired token - see middleware/auth.ts's requireAuth and
// realtime/socketServer.ts's handshake check. A user is never permanently
// locked out by this: logging in again on a new/replacement device always
// works and simply supersedes whatever session existed before, so a dead
// laptop doesn't strand the account - only concurrent *use* is prevented,
// not recovery.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user DROP COLUMN IF EXISTS session_version;
  `);
};
