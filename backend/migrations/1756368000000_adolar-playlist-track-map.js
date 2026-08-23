exports.shorthands = undefined;

// Session-start (POST /tables/:id/start) used to page through an entire
// Adolar playlist live, inside the same DB transaction that locks the
// table row - fine for a small test playlist, but a real 7000+ track
// playlist took well over a minute of sequential HTTP calls, holding that
// lock the whole time. This migration lets loadAdolarBatch query the
// already-synced local data instead (see adolarSync.ts): song_ref gets an
// artist column (previously only held transiently in memory, needed for
// the one-artist-per-batch rule), and a playlist membership map so
// candidates can be scoped to one playlist without a live Adolar call.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE song_ref ADD COLUMN artist TEXT;

    CREATE TABLE IF NOT EXISTS adolar_playlist_track (
        playlist_id INTEGER NOT NULL,
        song_ref_id UUID NOT NULL REFERENCES song_ref(id),
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (playlist_id, song_ref_id)
    );

    CREATE INDEX IF NOT EXISTS idx_adolar_playlist_track_playlist
    ON adolar_playlist_track(playlist_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS adolar_playlist_track;
    ALTER TABLE song_ref DROP COLUMN IF EXISTS artist;
  `);
};
