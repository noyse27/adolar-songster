exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS client_debug_event (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type TEXT NOT NULL,
      client_session_id TEXT,
      device_id TEXT,
      client_kind TEXT,
      user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
      table_id UUID,
      game_id UUID,
      round_id UUID,
      round_index INTEGER,
      request_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX IF NOT EXISTS idx_client_debug_event_game_created
      ON client_debug_event(game_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_debug_event_round_created
      ON client_debug_event(round_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_debug_event_session_created
      ON client_debug_event(client_session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_debug_event_type_created
      ON client_debug_event(event_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS game_event_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type TEXT NOT NULL,
      table_id UUID,
      game_id UUID,
      round_id UUID,
      round_index INTEGER,
      user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
      request_id TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX IF NOT EXISTS idx_game_event_log_game_created
      ON game_event_log(game_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_game_event_log_round_created
      ON game_event_log(round_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_game_event_log_type_created
      ON game_event_log(event_type, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS game_event_log;
    DROP TABLE IF EXISTS client_debug_event;
  `);
};
