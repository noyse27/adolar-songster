exports.shorthands = undefined;

// The playlist dropdowns in "Tisch erstellen" (GET /adolar/playlists) and
// the admin Song-Pool search (GET /admin/adolar-playlists) used to call
// Adolar live on every page load just to get playlist names - adolar_
// playlist_track (see the earlier adolar-playlist-track-map migration)
// only ever stored the numeric playlist_id, never a name. That meant
// neither endpoint could fall back to the already-synced local pool if
// Adolar was briefly unreachable, even though every track behind that
// playlist_id was sitting right there in song_ref. This table gives the
// daily/manual sync (syncAllAdolarPlaylists) somewhere to persist the
// name/description it already fetches via listPlaylists() while
// discovering playlists, so both dropdowns can read the local catalog
// instead - the sync run is the only place that still talks to Adolar for
// the playlist list itself.
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS adolar_playlist (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS adolar_playlist;
  `);
};
