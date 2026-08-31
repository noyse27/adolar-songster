/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS host_device (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      label VARCHAR(120) NOT NULL,
      install_id_hash TEXT NOT NULL,
      device_secret_hash TEXT NOT NULL,
      authorized_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
      pairing_code VARCHAR(16) UNIQUE,
      pairing_expires_at TIMESTAMPTZ,
      status VARCHAR(20) NOT NULL DEFAULT 'pairing',
      last_seen_at TIMESTAMPTZ,
      current_table_id UUID REFERENCES game_table(id) ON DELETE SET NULL,
      current_display_token TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      authorized_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      CHECK (status IN ('pairing', 'authorized', 'revoked', 'expired'))
    );

    CREATE INDEX IF NOT EXISTS idx_host_device_authorized_user
    ON host_device(authorized_user_id)
    WHERE status = 'authorized';

    CREATE INDEX IF NOT EXISTS idx_host_device_pairing_code
    ON host_device(pairing_code)
    WHERE pairing_code IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS host_device;`);
};
