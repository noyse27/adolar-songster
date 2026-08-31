exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE adolar_playlist
      ADD COLUMN IF NOT EXISTS is_default_playlist BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_adolar_playlist_single_default
    ON adolar_playlist(is_default_playlist)
    WHERE is_default_playlist IS TRUE;

    UPDATE adolar_playlist
    SET is_default_playlist = TRUE
    WHERE id = (
      SELECT id
      FROM adolar_playlist
      WHERE COALESCE(display_name, name) = 'Songster Play!'
         OR name = 'Songster Play!'
      ORDER BY id
      LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM adolar_playlist WHERE is_default_playlist IS TRUE
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS uq_adolar_playlist_single_default;

    ALTER TABLE adolar_playlist
      DROP COLUMN IF EXISTS is_default_playlist;
  `);
};
