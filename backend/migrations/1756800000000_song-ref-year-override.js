exports.shorthands = undefined;

// Backs the admin Song-Pool search dialog's manual year correction: an
// admin can fix a wrong year_value by hand (e.g. Adolar's original_year
// tag is still missing/wrong for that track), but the daily/manual Adolar
// sync's upsertSongRefTrack() otherwise overwrites year_value on every
// run - year_override, once set, tells that upsert to leave year_value
// alone for this song from then on.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE song_ref ADD COLUMN year_override BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE song_ref DROP COLUMN IF EXISTS year_override;
  `);
};
