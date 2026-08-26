import { pool } from '../db/pool';
import { fetchTimeline } from './timeline';
import { BONUS_SONG_DURATION_MS, ROUND_READY_WINDOW_MS, TOKENS_PER_PLAYER } from './roundConfig';
import { AUTO_CLOSE_MS } from './tableRestart';
import { RANK_SCORE_SQL } from './rankScore';
import { loadReactionConfig, ReactionConfig } from './communication';

export interface GamePlayerState {
  userId: string;
  username: string;
  timeline: number[];
  tokensRemaining: number;
  scorePoints: number;
  karmaPoints: number;
  gamesPlayed: number;
  // Global skill rank across every app_user (see rankScore.ts), not a
  // per-table/per-match placement - the Playboard tooltip shows this as
  // "Rang" so it reflects overall standing, same number as the profile
  // page and leaderboard.
  globalRank: number;
}

export interface CurrentRoundState {
  roundId: string;
  indexNo: number;
  mode: 'normal' | 'token' | 'bonus';
  status: 'countdown' | 'playing' | 'token_solo' | 'token_others' | 'resolved';
  startedAt: string;
  countdownMs: number;
  windowMs: number;
  // How long the audio itself actually plays, in ms from the moment the
  // round enters 'playing'. Equal to windowMs for 'normal'/'token' (music
  // and the guess window end together, as before). For 'bonus' this is
  // shorter than windowMs: the Stichsong plays for BONUS_SONG_DURATION_MS,
  // then the guess field stays open on its own for the remaining grace
  // period - see LiveGameBoard's audio-pause effect.
  songPlaybackMs: number;
  tokenClaimantUserId: string | null;
  tokenWrongGuessYear: number | null;
  exactYearAttemptedUserIds: string[];
  sitOutUserIds: string[];
  // Unlike title/artist/year below, the audio itself is safe to expose as
  // soon as a round has a song at all (countdown/playing/token_*) - hearing
  // the track is the whole point of a guessing round, same as real Hitster.
  // Points at GET /songs/:id/stream (routes/songs.ts), never the raw
  // song_ref id/year/title.
  songStreamPath: string | null;
  // Only populated once status === 'resolved' - never sent earlier, that
  // would spoil the song for everyone still guessing (see Playboard UI
  // spec's anti-spoiler rule, section 2.4/8).
  songTitle: string | null;
  songArtist: string | null;
  songYear: number | null;
  results: {
    userId: string;
    submitted: boolean;
    correct: boolean;
    guessedIndex: number | null;
    // Only meaningful for mode 'bonus' (the guessed exact year) - lets the
    // client show a Stichrunde reveal (who guessed what, how close) instead
    // of jumping straight from "song played" to the match-winner screen.
    // Null for 'normal' (guessedIndex covers that case) and when nothing
    // was submitted.
    guessedYear: number | null;
  }[];
}

export interface RoundReadyPhase {
  startedAt: string | null;
  windowMs: number;
  readyUserIds: string[];
}

export interface GameState {
  gameId: string;
  tableId: string;
  // Playlist-Tracking (Fehleranalyse): die nicht erratbare Playlist-ID
  // dieser Partie (siehe game_playlist, angelegt in tableStart.ts), gezeigt
  // im Playboard neben dem Markennamen und aufgedruckt im Spielabschluss-PDF.
  playlistId: string;
  status: string;
  winnerUserId: string | null;
  // Set once the match finishes (matchOutcome.ts's finishGame) - drives
  // the client's synced "closes in Xs" countdown on the winner screen; see
  // tableRestart.ts for the matching server-side auto-close.
  matchEndedAt: string | null;
  matchCloseWindowMs: number;
  players: GamePlayerState[];
  currentRound: CurrentRoundState | null;
  roundReadyPhase: RoundReadyPhase | null;
  // "Auto bereit" lock (see roundReady.ts's setAutoReady) - unlike
  // roundReadyPhase.readyUserIds, this is meaningful regardless of whether
  // a round is currently active, since it's a standing per-match
  // preference rather than a transient per-window state.
  autoReadyUserIds: string[];
  // Hostmodus (gemeinsames Anzeigegerät): true while a display-token socket
  // is connected for this table (see socketServer.ts/displayToken.ts).
  // Drives LiveGameBoard's compact mode - every seated player's own device
  // switches to showing only their own row and muting itself once a shared
  // screen is doing the showing/playing for everyone.
  displayAnchorPresent: boolean;
  reactionConfig: ReactionConfig;
}

export async function loadGameState(
  gameId: string,
  countdownMs: number,
  songWindowMs: number,
  bonusWindowMs: number,
): Promise<GameState | null> {
  const gameResult = await pool.query(
    `SELECT g.id, g.table_id, g.status, g.winner_user_id, t.match_ended_at,
            t.display_connected_at IS NOT NULL AS display_anchor_present,
            gp.id AS playlist_id
     FROM game g
     JOIN game_table t ON t.id = g.table_id
     LEFT JOIN game_playlist gp ON gp.game_id = g.id
     WHERE g.id = $1`,
    [gameId],
  );
  if (gameResult.rowCount === 0) return null;
  const game = gameResult.rows[0];

  const seatsResult = await pool.query(
    `SELECT u.id AS user_id, u.username, u.score_points, u.karma_points, u.games_played
     FROM table_seat s
     JOIN app_user u ON u.id = s.user_id
     WHERE s.table_id = $1 AND s.seat_type = 'player' AND s.left_at IS NULL
     ORDER BY s.joined_at ASC`,
    [game.table_id],
  );

  const globalRankResult = await pool.query(
    `WITH ranked AS (
       SELECT id, RANK() OVER (ORDER BY ${RANK_SCORE_SQL} DESC) AS global_rank FROM app_user
     )
     SELECT id, global_rank FROM ranked WHERE id = ANY($1::uuid[])`,
    [seatsResult.rows.map((row) => row.user_id)],
  );
  const globalRankByUserId = new Map<string, number>(
    globalRankResult.rows.map((row) => [row.id, Number(row.global_rank)]),
  );

  const players: GamePlayerState[] = [];
  for (const seat of seatsResult.rows) {
    const timeline = await fetchTimeline(pool, gameId, seat.user_id);
    const usedResult = await pool.query(
      `SELECT COUNT(*)::int AS used FROM token_usage tu
       JOIN round r ON r.id = tu.round_id
       WHERE r.game_id = $1 AND tu.user_id = $2`,
      [gameId, seat.user_id],
    );
    players.push({
      userId: seat.user_id,
      username: seat.username,
      timeline: timeline.map((t) => t.yearValue),
      tokensRemaining: Math.max(0, TOKENS_PER_PLAYER - usedResult.rows[0].used),
      scorePoints: seat.score_points,
      karmaPoints: seat.karma_points,
      gamesPlayed: seat.games_played,
      globalRank: globalRankByUserId.get(seat.user_id) ?? 0,
    });
  }

  const roundResult = await pool.query(
    `SELECT r.id, r.index_no, r.mode, r.status, r.started_at, r.song_id,
            CASE WHEN r.status = 'resolved' THEN sr.title ELSE NULL END AS song_title,
            CASE WHEN r.status = 'resolved' THEN sr.artist ELSE NULL END AS song_artist,
            CASE WHEN r.status = 'resolved' THEN sr.year_value ELSE NULL END AS song_year
     FROM round r
     JOIN song_ref sr ON sr.id = r.song_id
     WHERE r.game_id = $1
     ORDER BY r.index_no DESC
     LIMIT 1`,
    [gameId],
  );

  let currentRound: CurrentRoundState | null = null;
  if ((roundResult.rowCount ?? 0) > 0) {
    const round = roundResult.rows[0];

    let results: CurrentRoundState['results'] = [];
    if (round.status === 'resolved' && round.mode !== 'token') {
      const guessType = round.mode === 'bonus' ? 'exact_year' : 'position';
      const guessResult = await pool.query(
        `SELECT DISTINCT ON (user_id) user_id, is_correct, value_number
         FROM guess WHERE round_id = $1 AND guess_type = $2
         ORDER BY user_id, submitted_at DESC`,
        [round.id, guessType],
      );
      const submittedIds = new Set(guessResult.rows.map((r) => r.user_id));
      results = players.map((p) => {
        const row = guessResult.rows.find((r) => r.user_id === p.userId);
        return {
          userId: p.userId,
          submitted: submittedIds.has(p.userId),
          correct: row?.is_correct ?? false,
          // Only meaningful for mode 'normal' (a timeline insertion index) -
          // lets the client re-create the reveal-tile animation for every
          // player's guess, not just the viewer's own. Null for 'bonus'
          // (that guess is a year, not an index) and when nothing was
          // submitted.
          guessedIndex: round.mode === 'normal' && row ? row.value_number : null,
          guessedYear: round.mode === 'bonus' && row ? row.value_number : null,
        };
      });
    }

    let tokenClaimantUserId: string | null = null;
    let tokenWrongGuessYear: number | null = null;
    if (['token_solo', 'token_others', 'resolved'].includes(round.status) && round.mode === 'token') {
      const tokenResult = await pool.query(
        `SELECT tu.user_id, tu.result, g.value_number AS wrong_year
         FROM token_usage tu
         LEFT JOIN guess g ON g.round_id = tu.round_id AND g.user_id = tu.user_id AND g.guess_type = 'exact_year'
         WHERE tu.round_id = $1
           AND (tu.result IN ('solo_wrong', 'solo_correct', 'solo_timeout') OR tu.resolved_at IS NULL)`,
        [round.id],
      );
      const row = tokenResult.rows[0];
      if (row) {
        tokenClaimantUserId = row.user_id;
        tokenWrongGuessYear = row.result === 'solo_wrong' ? row.wrong_year : null;
      }
    }

    const attemptedResult = await pool.query(
      `SELECT DISTINCT user_id FROM guess WHERE round_id = $1 AND guess_type = 'exact_year'`,
      [round.id],
    );
    const sitOutResult = await pool.query(`SELECT user_id FROM round_sitout WHERE round_id = $1`, [round.id]);

    const windowMs = round.mode === 'bonus' ? bonusWindowMs : songWindowMs;

    currentRound = {
      roundId: round.id,
      indexNo: round.index_no,
      mode: round.mode,
      status: round.status,
      startedAt: round.started_at,
      countdownMs,
      windowMs,
      songPlaybackMs: round.mode === 'bonus' ? Math.min(BONUS_SONG_DURATION_MS, bonusWindowMs) : windowMs,
      tokenClaimantUserId,
      tokenWrongGuessYear,
      exactYearAttemptedUserIds: attemptedResult.rows.map((r) => r.user_id),
      sitOutUserIds: sitOutResult.rows.map((r) => r.user_id),
      songStreamPath: `/songs/${round.song_id}/stream`,
      songTitle: round.song_title,
      songArtist: round.song_artist,
      songYear: round.song_year,
      results,
    };
  }

  // Only meaningful between rounds (no round yet, or the last one resolved)
  // - once a round is actually active, round_ready is empty (cleared on
  // start, see roundReady.ts) so this would just show nobody ready.
  let roundReadyPhase: RoundReadyPhase | null = null;
  if (!currentRound || currentRound.status === 'resolved') {
    const readyGameResult = await pool.query(`SELECT round_ready_started_at FROM game WHERE id = $1`, [gameId]);
    const readyResult = await pool.query(`SELECT user_id FROM round_ready WHERE game_id = $1 AND ready = TRUE`, [
      gameId,
    ]);
    roundReadyPhase = {
      startedAt: readyGameResult.rows[0]?.round_ready_started_at ?? null,
      windowMs: ROUND_READY_WINDOW_MS,
      readyUserIds: readyResult.rows.map((r) => r.user_id),
    };
  }

  const autoReadyResult = await pool.query(
    `SELECT user_id FROM round_ready_pref WHERE game_id = $1 AND auto_ready = TRUE`,
    [gameId],
  );

  return {
    gameId: game.id,
    tableId: game.table_id,
    playlistId: game.playlist_id,
    status: game.status,
    winnerUserId: game.winner_user_id,
    matchEndedAt: game.match_ended_at,
    matchCloseWindowMs: AUTO_CLOSE_MS,
    players,
    currentRound,
    roundReadyPhase,
    autoReadyUserIds: autoReadyResult.rows.map((r) => r.user_id),
    displayAnchorPresent: game.display_anchor_present,
    reactionConfig: await loadReactionConfig(),
  };
}
