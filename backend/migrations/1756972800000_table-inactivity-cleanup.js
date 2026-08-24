exports.shorthands = undefined;

// Backs the automatic inactive-table cleanup: last_activity_at is touched
// on every table/round interaction (see services/tableActivity.ts) and
// checked by a periodic job (services/tableCleanup.ts) that hard-deletes
// any table untouched for 60 minutes - "for performance reasons" per the
// product ask, not a penalty, so it must NOT go through the normal
// leave-table path (no early-leave karma malus, no games_played credit,
// since that's only ever awarded by matchOutcome.finishGame()).
//
// A hard DELETE FROM game_table needs every dependent table's FK to
// cascade (or, for the two ledgers, null out) - none of them did before
// this, since nothing ever deleted a table row. Exact constraint names
// confirmed against the live schema (they're all Postgres's default
// <table>_<column>_fkey naming for an inline unnamed FK).
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE game_table ADD COLUMN last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    ALTER TABLE table_seat DROP CONSTRAINT table_seat_table_id_fkey,
      ADD CONSTRAINT table_seat_table_id_fkey FOREIGN KEY (table_id) REFERENCES game_table(id) ON DELETE CASCADE;

    ALTER TABLE table_session DROP CONSTRAINT table_session_table_id_fkey,
      ADD CONSTRAINT table_session_table_id_fkey FOREIGN KEY (table_id) REFERENCES game_table(id) ON DELETE CASCADE;

    ALTER TABLE game DROP CONSTRAINT game_table_id_fkey,
      ADD CONSTRAINT game_table_id_fkey FOREIGN KEY (table_id) REFERENCES game_table(id) ON DELETE CASCADE;
    ALTER TABLE game DROP CONSTRAINT game_table_session_id_fkey,
      ADD CONSTRAINT game_table_session_id_fkey FOREIGN KEY (table_session_id) REFERENCES table_session(id) ON DELETE CASCADE;

    ALTER TABLE round DROP CONSTRAINT round_game_id_fkey,
      ADD CONSTRAINT round_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE;

    ALTER TABLE session_song_history DROP CONSTRAINT session_song_history_table_session_id_fkey,
      ADD CONSTRAINT session_song_history_table_session_id_fkey FOREIGN KEY (table_session_id) REFERENCES table_session(id) ON DELETE CASCADE;
    ALTER TABLE session_song_history DROP CONSTRAINT session_song_history_first_played_round_id_fkey,
      ADD CONSTRAINT session_song_history_first_played_round_id_fkey FOREIGN KEY (first_played_round_id) REFERENCES round(id) ON DELETE CASCADE;

    ALTER TABLE guess DROP CONSTRAINT guess_round_id_fkey,
      ADD CONSTRAINT guess_round_id_fkey FOREIGN KEY (round_id) REFERENCES round(id) ON DELETE CASCADE;

    ALTER TABLE token_usage DROP CONSTRAINT token_usage_round_id_fkey,
      ADD CONSTRAINT token_usage_round_id_fkey FOREIGN KEY (round_id) REFERENCES round(id) ON DELETE CASCADE;

    ALTER TABLE timeline_card DROP CONSTRAINT timeline_card_game_id_fkey,
      ADD CONSTRAINT timeline_card_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE;
    ALTER TABLE timeline_card DROP CONSTRAINT timeline_card_source_round_id_fkey,
      ADD CONSTRAINT timeline_card_source_round_id_fkey FOREIGN KEY (source_round_id) REFERENCES round(id) ON DELETE CASCADE;

    ALTER TABLE table_session_song_pool DROP CONSTRAINT table_session_song_pool_table_session_id_fkey,
      ADD CONSTRAINT table_session_song_pool_table_session_id_fkey FOREIGN KEY (table_session_id) REFERENCES table_session(id) ON DELETE CASCADE;

    ALTER TABLE round_ready DROP CONSTRAINT round_ready_game_id_fkey,
      ADD CONSTRAINT round_ready_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE;
    ALTER TABLE round_sitout DROP CONSTRAINT round_sitout_round_id_fkey,
      ADD CONSTRAINT round_sitout_round_id_fkey FOREIGN KEY (round_id) REFERENCES round(id) ON DELETE CASCADE;

    -- Ledger rows are the audit trail for points already applied to
    -- app_user - they must survive table deletion, just losing the
    -- now-meaningless game reference.
    ALTER TABLE karma_ledger DROP CONSTRAINT karma_ledger_game_id_fkey,
      ADD CONSTRAINT karma_ledger_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE SET NULL;
    ALTER TABLE score_ledger DROP CONSTRAINT score_ledger_game_id_fkey,
      ADD CONSTRAINT score_ledger_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE SET NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE score_ledger DROP CONSTRAINT score_ledger_game_id_fkey,
      ADD CONSTRAINT score_ledger_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id);
    ALTER TABLE karma_ledger DROP CONSTRAINT karma_ledger_game_id_fkey,
      ADD CONSTRAINT karma_ledger_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id);

    ALTER TABLE round_sitout DROP CONSTRAINT round_sitout_round_id_fkey,
      ADD CONSTRAINT round_sitout_round_id_fkey FOREIGN KEY (round_id) REFERENCES round(id);
    ALTER TABLE round_ready DROP CONSTRAINT round_ready_game_id_fkey,
      ADD CONSTRAINT round_ready_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id);

    ALTER TABLE table_session_song_pool DROP CONSTRAINT table_session_song_pool_table_session_id_fkey,
      ADD CONSTRAINT table_session_song_pool_table_session_id_fkey FOREIGN KEY (table_session_id) REFERENCES table_session(id);

    ALTER TABLE timeline_card DROP CONSTRAINT timeline_card_source_round_id_fkey,
      ADD CONSTRAINT timeline_card_source_round_id_fkey FOREIGN KEY (source_round_id) REFERENCES round(id);
    ALTER TABLE timeline_card DROP CONSTRAINT timeline_card_game_id_fkey,
      ADD CONSTRAINT timeline_card_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id);

    ALTER TABLE token_usage DROP CONSTRAINT token_usage_round_id_fkey,
      ADD CONSTRAINT token_usage_round_id_fkey FOREIGN KEY (round_id) REFERENCES round(id);

    ALTER TABLE guess DROP CONSTRAINT guess_round_id_fkey,
      ADD CONSTRAINT guess_round_id_fkey FOREIGN KEY (round_id) REFERENCES round(id);

    ALTER TABLE session_song_history DROP CONSTRAINT session_song_history_first_played_round_id_fkey,
      ADD CONSTRAINT session_song_history_first_played_round_id_fkey FOREIGN KEY (first_played_round_id) REFERENCES round(id);
    ALTER TABLE session_song_history DROP CONSTRAINT session_song_history_table_session_id_fkey,
      ADD CONSTRAINT session_song_history_table_session_id_fkey FOREIGN KEY (table_session_id) REFERENCES table_session(id);

    ALTER TABLE round DROP CONSTRAINT round_game_id_fkey,
      ADD CONSTRAINT round_game_id_fkey FOREIGN KEY (game_id) REFERENCES game(id);

    ALTER TABLE game DROP CONSTRAINT game_table_session_id_fkey,
      ADD CONSTRAINT game_table_session_id_fkey FOREIGN KEY (table_session_id) REFERENCES table_session(id);
    ALTER TABLE game DROP CONSTRAINT game_table_id_fkey,
      ADD CONSTRAINT game_table_id_fkey FOREIGN KEY (table_id) REFERENCES game_table(id);

    ALTER TABLE table_session DROP CONSTRAINT table_session_table_id_fkey,
      ADD CONSTRAINT table_session_table_id_fkey FOREIGN KEY (table_id) REFERENCES game_table(id);

    ALTER TABLE table_seat DROP CONSTRAINT table_seat_table_id_fkey,
      ADD CONSTRAINT table_seat_table_id_fkey FOREIGN KEY (table_id) REFERENCES game_table(id);

    ALTER TABLE game_table DROP COLUMN IF EXISTS last_activity_at;
  `);
};
