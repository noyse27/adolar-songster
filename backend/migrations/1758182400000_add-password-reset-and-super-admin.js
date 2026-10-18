exports.shorthands = undefined;

// Admin-mediated password reset: a locked-out user flags their own account via
// the public /auth/request-password-reset endpoint (password_reset_requested_at),
// an admin sees the flag and issues a temporary password (which also sets
// must_change_password so the user is forced through the change-password flow
// on next login before they can do anything else).
//
// is_super_admin marks the single account created by the one-time /setup
// bootstrap flow. Promoting/demoting admins is restricted to that account so a
// promoted admin can't appoint an accomplice or demote whoever appointed them -
// see routes/admin.ts's role-change endpoint.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user
      ADD COLUMN password_reset_requested_at TIMESTAMPTZ,
      ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user
      DROP COLUMN IF EXISTS password_reset_requested_at,
      DROP COLUMN IF EXISTS must_change_password,
      DROP COLUMN IF EXISTS is_super_admin;
  `);
};
