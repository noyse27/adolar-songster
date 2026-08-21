exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE app_user
      ADD COLUMN can_create_invites BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN invite_quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN registered_via_invite_id UUID REFERENCES invite_token(id);

    CREATE INDEX IF NOT EXISTS idx_app_user_registered_via_invite
    ON app_user(registered_via_invite_id);

    CREATE INDEX IF NOT EXISTS idx_invite_token_created_by
    ON invite_token(created_by);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_invite_token_created_by;
    DROP INDEX IF EXISTS idx_app_user_registered_via_invite;

    ALTER TABLE app_user
      DROP COLUMN IF EXISTS registered_via_invite_id,
      DROP COLUMN IF EXISTS invite_quota_reset_at,
      DROP COLUMN IF EXISTS can_create_invites;
  `);
};
