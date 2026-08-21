exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Start-of-game timeline cards (FR-023) are not the result of any
    -- round, so source_round_id must be optional for them.
    ALTER TABLE timeline_card ALTER COLUMN source_round_id DROP NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE timeline_card ALTER COLUMN source_round_id SET NOT NULL;
  `);
};
