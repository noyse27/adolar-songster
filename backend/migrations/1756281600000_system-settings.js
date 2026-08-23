exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Small key/value store for admin-configured, deployment-wide settings
    -- entered through the setup wizard (e.g. the Adolar connection) rather
    -- than baked into env vars. See docs/Adolar_Songster_Playboard_UI_Spec
    -- adjacent work: setup wizard "Musikdaten" step.
    CREATE TABLE IF NOT EXISTS system_setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS system_setting;`);
};
