exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Which Adolar radio station (see Adolar_Songster_Adolar_Integration_
    -- Konzept_v1_20260821.md section 4.2) this table draws its songs from.
    -- NULL keeps the pre-existing local-admin-maintained-songs fallback.
    ALTER TABLE game_table ADD COLUMN source_playlist_id INTEGER;

    -- Malus / repeat-avoidance across sessions (section 4.4): updated on
    -- every actual song selection in selectSongForGame(), independent of
    -- Adolar's own play_count (which isn't Songster-specific).
    ALTER TABLE song_ref ADD COLUMN last_played_at TIMESTAMPTZ;

    -- Scopes a table_session's candidate pool to the fixed 50-song batch
    -- drawn once at session start (section 4.3/4.5) when the table has an
    -- Adolar source_playlist_id. A session with no rows here falls back to
    -- the entire song_ref library, preserving the pre-Adolar behavior for
    -- tables using the local-admin-maintained-songs fallback.
    CREATE TABLE IF NOT EXISTS table_session_song_pool (
        table_session_id UUID NOT NULL REFERENCES table_session(id),
        song_ref_id UUID NOT NULL REFERENCES song_ref(id),
        PRIMARY KEY (table_session_id, song_ref_id)
    );

    CREATE INDEX IF NOT EXISTS idx_table_session_song_pool_session
    ON table_session_song_pool(table_session_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS table_session_song_pool;
    ALTER TABLE song_ref DROP COLUMN IF EXISTS last_played_at;
    ALTER TABLE game_table DROP COLUMN IF EXISTS source_playlist_id;
  `);
};
