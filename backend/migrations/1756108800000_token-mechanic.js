exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- 'race_lost': a claim was submitted but lost the claim-race tie-break
    -- (FR-031: the token is spent on every claim, win or lose).
    ALTER TABLE token_usage DROP CONSTRAINT token_usage_result_check;
    ALTER TABLE token_usage ADD CONSTRAINT token_usage_result_check
      CHECK (result IS NULL OR result IN ('solo_correct', 'solo_wrong', 'solo_timeout', 'race_lost'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE token_usage DROP CONSTRAINT token_usage_result_check;
    ALTER TABLE token_usage ADD CONSTRAINT token_usage_result_check
      CHECK (result IS NULL OR result IN ('solo_correct', 'solo_wrong', 'solo_timeout'));
  `);
};
