/* eslint-disable @typescript-eslint/no-var-requires */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE playboard_reaction (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phase VARCHAR(20) NOT NULL,
      asset_id VARCHAR(40) NOT NULL,
      label VARCHAR(24) NOT NULL,
      sort_order SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (phase IN ('waiting', 'countdown', 'playing', 'token', 'resolved', 'finished')),
      CHECK (char_length(trim(label)) BETWEEN 1 AND 24),
      CHECK (sort_order BETWEEN 0 AND 7),
      UNIQUE (phase, asset_id),
      UNIQUE (phase, sort_order)
    );

    INSERT INTO playboard_reaction (phase, asset_id, label, sort_order) VALUES
      ('waiting', 'hello', 'Hallo', 0), ('waiting', 'like', 'Stark', 1),
      ('waiting', 'laugh', 'Lustig', 2), ('waiting', 'target', 'Guter Tipp', 3),
      ('waiting', 'technical', 'Technikproblem', 4),
      ('countdown', 'like', 'Stark', 0), ('countdown', 'think', 'Keine Ahnung', 1),
      ('countdown', 'technical', 'Technikproblem', 2),
      ('playing', 'like', 'Stark', 0), ('playing', 'think', 'Keine Ahnung', 1),
      ('playing', 'technical', 'Technikproblem', 2),
      ('token', 'like', 'Stark', 0), ('token', 'think', 'Keine Ahnung', 1),
      ('token', 'technical', 'Technikproblem', 2),
      ('resolved', 'like', 'Stark', 0), ('resolved', 'laugh', 'Lustig', 1),
      ('resolved', 'target', 'Guter Tipp', 2), ('resolved', 'technical', 'Technikproblem', 3),
      ('finished', 'like', 'Stark', 0), ('finished', 'laugh', 'Lustig', 1),
      ('finished', 'target', 'Guter Tipp', 2), ('finished', 'technical', 'Technikproblem', 3);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS playboard_reaction;');
};
