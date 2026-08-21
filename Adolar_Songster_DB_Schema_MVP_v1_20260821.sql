-- Adolar Songster - DB Basisschema (PostgreSQL)
-- Version: 1.0
-- Stand: 2026-08-21
-- Zweck: Startpunkt fuer erste Migrationen, inkl. Regeln fuer Neue Partie und Songpool

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users
CREATE TABLE IF NOT EXISTS app_user (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    karma_points INTEGER NOT NULL DEFAULT 0,
    score_points INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (role IN ('user', 'admin')),
    CHECK (status IN ('active', 'blocked'))
);

-- Invite tokens
CREATE TABLE IF NOT EXISTS invite_token (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES app_user(id),
    max_uses INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (max_uses > 0),
    CHECK (used_count >= 0)
);

-- Tables (game rooms)
CREATE TABLE IF NOT EXISTS game_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES app_user(id),
    name VARCHAR(120) NOT NULL,
    visibility VARCHAR(20) NOT NULL,
    join_code VARCHAR(32),
    allow_spectators BOOLEAN NOT NULL DEFAULT TRUE,
    max_players INTEGER NOT NULL DEFAULT 5,
    max_spectators INTEGER NOT NULL DEFAULT 10,
    state VARCHAR(20) NOT NULL DEFAULT 'open',
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (visibility IN ('public', 'private')),
    CHECK (state IN ('open', 'running', 'finished', 'closed')),
    CHECK (max_players BETWEEN 2 AND 5),
    CHECK (max_spectators BETWEEN 0 AND 50)
);

-- Seats for players and spectators
CREATE TABLE IF NOT EXISTS table_seat (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES game_table(id),
    user_id UUID NOT NULL REFERENCES app_user(id),
    seat_type VARCHAR(20) NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    CHECK (seat_type IN ('player', 'spectator'))
);

CREATE INDEX IF NOT EXISTS idx_table_seat_table ON table_seat(table_id);
CREATE INDEX IF NOT EXISTS idx_table_seat_user ON table_seat(user_id);

-- One active seat per user per table
CREATE UNIQUE INDEX IF NOT EXISTS uq_table_seat_active_user
ON table_seat(table_id, user_id)
WHERE left_at IS NULL;

-- Table session groups multiple games started via "Neue Partie"
CREATE TABLE IF NOT EXISTS table_session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES game_table(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    CHECK (status IN ('active', 'ended'))
);

CREATE INDEX IF NOT EXISTS idx_table_session_table ON table_session(table_id);

-- Songs from source systems (adolar/local)
CREATE TABLE IF NOT EXISTS song_ref (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(20) NOT NULL,
    source_song_id VARCHAR(255) NOT NULL,
    title TEXT NOT NULL,
    year_value INTEGER,
    duration_sec INTEGER,
    stream_ref TEXT,
    is_valid BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source IN ('adolar', 'local')),
    CHECK (year_value IS NULL OR year_value BETWEEN 1900 AND 2100),
    CHECK (duration_sec IS NULL OR duration_sec > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_song_ref_source_external
ON song_ref(source, source_song_id);

-- Game instances
CREATE TABLE IF NOT EXISTS game (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID NOT NULL REFERENCES game_table(id),
    table_session_id UUID NOT NULL REFERENCES table_session(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    winner_user_id UUID REFERENCES app_user(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('pending', 'active', 'finished', 'aborted'))
);

CREATE INDEX IF NOT EXISTS idx_game_table ON game(table_id);
CREATE INDEX IF NOT EXISTS idx_game_table_session ON game(table_session_id);

-- Rounds
CREATE TABLE IF NOT EXISTS round (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES game(id),
    index_no INTEGER NOT NULL,
    song_id UUID NOT NULL REFERENCES song_ref(id),
    mode VARCHAR(20) NOT NULL DEFAULT 'normal',
    status VARCHAR(20) NOT NULL DEFAULT 'countdown',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (index_no > 0),
    CHECK (mode IN ('normal', 'token', 'bonus')),
    CHECK (status IN ('countdown', 'playing', 'token_solo', 'token_others', 'resolved', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_round_game ON round(game_id);
CREATE INDEX IF NOT EXISTS idx_round_song ON round(song_id);

-- Rule: a song must not repeat in the same game
CREATE UNIQUE INDEX IF NOT EXISTS uq_round_game_song ON round(game_id, song_id);

-- Session-level song history for no-repeat-until-exhausted behavior
CREATE TABLE IF NOT EXISTS session_song_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_session_id UUID NOT NULL REFERENCES table_session(id),
    song_ref_id UUID NOT NULL REFERENCES song_ref(id),
    first_played_round_id UUID NOT NULL REFERENCES round(id),
    play_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (play_count > 0)
);

-- Rule: one history row per song per table session
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_song_history_unique
ON session_song_history(table_session_id, song_ref_id);

CREATE INDEX IF NOT EXISTS idx_session_song_history_session
ON session_song_history(table_session_id);

-- Guesses
CREATE TABLE IF NOT EXISTS guess (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID NOT NULL REFERENCES round(id),
    user_id UUID NOT NULL REFERENCES app_user(id),
    guess_type VARCHAR(20) NOT NULL,
    value_text TEXT,
    value_number INTEGER,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_correct BOOLEAN,
    CHECK (guess_type IN ('position', 'exact_year'))
);

CREATE INDEX IF NOT EXISTS idx_guess_round ON guess(round_id);
CREATE INDEX IF NOT EXISTS idx_guess_user ON guess(user_id);

-- Token usage
CREATE TABLE IF NOT EXISTS token_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID NOT NULL REFERENCES round(id),
    user_id UUID NOT NULL REFERENCES app_user(id),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    result VARCHAR(30),
    CHECK (result IS NULL OR result IN ('solo_correct', 'solo_wrong', 'solo_timeout'))
);

CREATE INDEX IF NOT EXISTS idx_token_usage_round ON token_usage(round_id);

-- Timeline cards
CREATE TABLE IF NOT EXISTS timeline_card (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES game(id),
    user_id UUID NOT NULL REFERENCES app_user(id),
    source_round_id UUID NOT NULL REFERENCES round(id),
    year_value INTEGER NOT NULL,
    special_type VARCHAR(30) NOT NULL DEFAULT 'normal',
    placed_position INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (special_type IN ('normal', 'token_win'))
);

CREATE INDEX IF NOT EXISTS idx_timeline_card_game_user
ON timeline_card(game_id, user_id);

-- Karma ledger
CREATE TABLE IF NOT EXISTS karma_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_user(id),
    game_id UUID REFERENCES game(id),
    delta INTEGER NOT NULL,
    reason VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_karma_ledger_user ON karma_ledger(user_id);

-- Score ledger
CREATE TABLE IF NOT EXISTS score_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_user(id),
    game_id UUID REFERENCES game(id),
    delta INTEGER NOT NULL,
    reason VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_ledger_user ON score_ledger(user_id);

COMMIT;
