import { PoolClient } from 'pg';
import { pool } from '../db/pool';

type Queryable = PoolClient | typeof pool;

// FR-040: first to 10 correct cards wins.
export const WIN_CARD_THRESHOLD = 10;

export interface CardStanding {
  userId: string;
  cardCount: number;
}

async function fetchStandings(client: Queryable, gameId: string, tableId: string): Promise<CardStanding[]> {
  const result = await client.query(
    `SELECT s.user_id, COUNT(tc.id)::int AS card_count
     FROM table_seat s
     LEFT JOIN timeline_card tc ON tc.game_id = $1 AND tc.user_id = s.user_id
     WHERE s.table_id = $2 AND s.seat_type = 'player' AND s.left_at IS NULL
     GROUP BY s.user_id`,
    [gameId, tableId],
  );
  return result.rows.map((row) => ({ userId: row.user_id, cardCount: row.card_count }));
}

// FR-040/041: after any round that can award a card, check whether someone
// (or several players simultaneously) reached the winning threshold.
export async function checkForWinOrTie(
  client: Queryable,
  gameId: string,
): Promise<{ winnerUserId: string } | { tiedUserIds: string[] } | { none: true }> {
  const gameResult = await client.query(`SELECT table_id FROM game WHERE id = $1`, [gameId]);
  const tableId = gameResult.rows[0].table_id;

  const standings = await fetchStandings(client, gameId, tableId);
  const maxCards = Math.max(0, ...standings.map((s) => s.cardCount));
  if (maxCards < WIN_CARD_THRESHOLD) {
    return { none: true };
  }

  const leaders = standings.filter((s) => s.cardCount === maxCards);
  if (leaders.length === 1) {
    return { winnerUserId: leaders[0].userId };
  }
  return { tiedUserIds: leaders.map((l) => l.userId) };
}

// FR-042/043: score the winner, credit +5 karma to everyone who completed
// the match, and close out the game and table.
export async function finishGame(
  client: Queryable,
  gameId: string,
  winnerUserId: string,
): Promise<void> {
  const gameResult = await client.query(`SELECT table_id FROM game WHERE id = $1`, [gameId]);
  const tableId = gameResult.rows[0].table_id;

  const standings = await fetchStandings(client, gameId, tableId);
  const opponentCount = Math.max(0, standings.length - 1);
  const winPoints = 1 + opponentCount;

  await client.query(
    `INSERT INTO score_ledger (user_id, game_id, delta, reason) VALUES ($1, $2, $3, 'match_win')`,
    [winnerUserId, gameId, winPoints],
  );
  await client.query(`UPDATE app_user SET score_points = score_points + $1 WHERE id = $2`, [
    winPoints,
    winnerUserId,
  ]);

  for (const standing of standings) {
    await client.query(
      `INSERT INTO karma_ledger (user_id, game_id, delta, reason) VALUES ($1, $2, 5, 'match_completed')`,
      [standing.userId, gameId],
    );
    await client.query(`UPDATE app_user SET karma_points = karma_points + 5 WHERE id = $1`, [
      standing.userId,
    ]);

    // games_played counts "sat at the table and played at least one round"
    // - a guess row is the actual signal for having played a round, not
    // just having been seated. Only credited here, alongside the +5 karma,
    // to the players still active at match end - same set early-leavers
    // (applyEarlyLeavePenalty below) are excluded from, for consistency.
    const playedResult = await client.query(
      `SELECT EXISTS(
         SELECT 1 FROM guess g JOIN round r ON r.id = g.round_id
         WHERE r.game_id = $1 AND g.user_id = $2
       ) AS played`,
      [gameId, standing.userId],
    );
    if (playedResult.rows[0].played) {
      await client.query(`UPDATE app_user SET games_played = games_played + 1 WHERE id = $1`, [
        standing.userId,
      ]);
    }
  }

  await client.query(
    `UPDATE game SET status = 'finished', winner_user_id = $1, ended_at = NOW() WHERE id = $2`,
    [winnerUserId, gameId],
  );
  await client.query(`UPDATE game_table SET state = 'finished', match_ended_at = NOW() WHERE id = $1`, [tableId]);

  await snapshotPlaylistTracks(client, gameId);

  // See the persistent-games-played-counter migration: game.table_id
  // cascades away with its table an hour after the last activity
  // (tableCleanup.ts), so the home screen's "gespielte Spiele auf dem
  // Server" stat can't just COUNT(*) the game table anymore - this counter
  // is the one thing that's meant to survive that cleanup.
  await client.query(
    `INSERT INTO system_setting (key, value) VALUES ('total_games_finished', '1')
     ON CONFLICT (key) DO UPDATE SET value = (system_setting.value::int + 1)::text, updated_at = NOW()`,
  );
}

// Playlist-Tracking (Fehleranalyse): schreibt den Track-Snapshot fuer die
// Fehleranalyse-Playlist dieser Partie (angelegt in tableStart.ts). Nur
// tatsaechlich gespielte Runden (started_at gesetzt) werden uebernommen, in
// exakter Spielreihenfolge (index_no) - eine begonnene, aber nie gestartete
// Runde (z. B. bei vorzeitigem Spielende) zaehlt nicht als "gespielt".
async function snapshotPlaylistTracks(client: Queryable, gameId: string): Promise<void> {
  const playlistResult = await client.query(`SELECT id FROM game_playlist WHERE game_id = $1`, [gameId]);
  if (playlistResult.rowCount === 0) return;
  const playlistId = playlistResult.rows[0].id;

  const tracksResult = await client.query(
    `SELECT r.index_no, r.song_id, sr.title, sr.artist, sr.year_value
     FROM round r
     JOIN song_ref sr ON sr.id = r.song_id
     WHERE r.game_id = $1 AND r.started_at IS NOT NULL
     ORDER BY r.index_no ASC`,
    [gameId],
  );

  for (const track of tracksResult.rows) {
    await client.query(
      `INSERT INTO game_playlist_track (playlist_id, position, song_ref_id, title, artist, year_value)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (playlist_id, position) DO NOTHING`,
      [playlistId, track.index_no, track.song_id, track.title, track.artist, track.year_value],
    );
  }
}

// FR-044: leaving mid-match costs -5, plus -1 per other player still
// seated at the table. Deduplicated per (user, game) via the ledger
// itself so a lazily-retried check never double-penalizes.
export async function applyEarlyLeavePenalty(
  client: Queryable,
  gameId: string,
  tableId: string,
  userId: string,
): Promise<void> {
  const alreadyPenalizedResult = await client.query(
    `SELECT id FROM karma_ledger WHERE user_id = $1 AND game_id = $2 AND reason = 'early_leave'`,
    [userId, gameId],
  );
  if ((alreadyPenalizedResult.rowCount ?? 0) > 0) {
    return;
  }

  const remainingPlayersResult = await client.query(
    `SELECT COUNT(*)::int AS count FROM table_seat
     WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL AND user_id != $2`,
    [tableId, userId],
  );
  const penalty = -5 - remainingPlayersResult.rows[0].count;

  await client.query(
    `INSERT INTO karma_ledger (user_id, game_id, delta, reason) VALUES ($1, $2, $3, 'early_leave')`,
    [userId, gameId, penalty],
  );
  await client.query(`UPDATE app_user SET karma_points = karma_points + $1 WHERE id = $2`, [
    penalty,
    userId,
  ]);
}
