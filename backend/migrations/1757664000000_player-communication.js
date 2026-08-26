/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE chat_message (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope VARCHAR(20) NOT NULL,
      table_id UUID REFERENCES game_table(id) ON DELETE CASCADE,
      sender_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      body VARCHAR(500) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      CHECK (scope IN ('lobby', 'table')),
      CHECK (char_length(trim(body)) BETWEEN 1 AND 500),
      CHECK (
        (scope = 'lobby' AND table_id IS NULL) OR
        (scope = 'table' AND table_id IS NOT NULL)
      )
    );

    CREATE INDEX idx_chat_message_lobby_created
      ON chat_message(created_at DESC)
      WHERE scope = 'lobby' AND deleted_at IS NULL;

    CREATE INDEX idx_chat_message_table_created
      ON chat_message(table_id, created_at DESC)
      WHERE scope = 'table' AND deleted_at IS NULL;

    CREATE INDEX idx_chat_message_sender_created
      ON chat_message(sender_user_id, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS chat_message;');
};
