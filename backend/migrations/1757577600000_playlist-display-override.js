exports.shorthands = undefined;

// Admin-only overlay on top of the Adolar-synced adolar_playlist catalog
// (see adolar-playlist-catalog migration). name/description on that table
// are overwritten by every syncAllAdolarPlaylists run, so an admin-set
// display name or description needs its own columns to survive a sync.
// display_name replaces the Adolar name everywhere a playlist is shown to
// players (table creation, admin Song-Pool, the "Songster PlayLists" lobby
// dialog); admin_description is the short blurb shown in that lobby dialog.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE adolar_playlist
      ADD COLUMN IF NOT EXISTS display_name TEXT,
      ADD COLUMN IF NOT EXISTS admin_description TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE adolar_playlist
      DROP COLUMN IF EXISTS display_name,
      DROP COLUMN IF EXISTS admin_description;
  `);
};
