exports.shorthands = undefined;

// Playlist-Tracking fuer Fehleranalyse: jede gestartete Partie bekommt eine
// eigene, nicht erratbare Playlist-ID, verknuepft mit der Tisch-ID. Bewusst
// OHNE FK auf game_table/game - beide werden spaetestens ~1h nach der
// letzten Aktivitaet hart geloescht (siehe tableCleanup.ts), die Playlist
// soll aber 1 Woche fuer die Fehleranalyse ueberleben. table_id/game_id sind
// deshalb denormalisierte Snapshots, kein Fremdschluessel.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS game_playlist (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_id UUID NOT NULL,
        table_name TEXT NOT NULL,
        game_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
    );

    CREATE INDEX IF NOT EXISTS idx_game_playlist_expires ON game_playlist(expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_game_playlist_game ON game_playlist(game_id);

    CREATE TABLE IF NOT EXISTS game_playlist_track (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        playlist_id UUID NOT NULL REFERENCES game_playlist(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        song_ref_id UUID REFERENCES song_ref(id),
        title TEXT NOT NULL,
        artist TEXT,
        year_value INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (position > 0)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_game_playlist_track_position
    ON game_playlist_track(playlist_id, position);

    CREATE INDEX IF NOT EXISTS idx_game_playlist_track_playlist ON game_playlist_track(playlist_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS game_playlist_track;
    DROP TABLE IF EXISTS game_playlist;
  `);
};
