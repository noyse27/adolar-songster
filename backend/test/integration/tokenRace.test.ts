import request from 'supertest';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, uniqueSuffix } from '../helpers/testUtils';

// See rounds.test.ts for why these are set here (before the deferred
// require) rather than via a normal import. Kept small so every timer
// this file schedules fires well within the file's own runtime, and the
// final afterAll below still waits past the largest possible one before
// tearing down the pool.
process.env.ROUND_COUNTDOWN_MS = '100';
process.env.ROUND_SONG_DURATION_MS = '300';
process.env.TOKEN_CLAIM_GRACE_MS = '100';
process.env.TOKEN_SOLO_WINDOW_MS = '200';
process.env.TOKEN_OTHERS_WINDOW_MS = '200';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createApp } = require('../../src/app');
const app = createApp();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedSong(year: number): Promise<void> {
  await pool.query(
    `INSERT INTO song_ref (source, source_song_id, title, year_value, duration_sec)
     VALUES ('local', $1, $2, $3, 180)`,
    [`song_${uniqueSuffix()}`, `Song ${uniqueSuffix()}`, year],
  );
}

async function getRound(userId: string, gameId: string, roundId: string) {
  const response = await request(app)
    .get(`/api/v1/games/${gameId}/rounds/${roundId}`)
    .set(authHeader(userId, 'user'));
  return response.body;
}

// Polls instead of sleeping a guessed-at duration, since the round engine's
// state transitions are timer-driven and a fixed sleep is either wastefully
// long or flaky under CI/DB load. Bounded so a real bug still fails fast.
async function waitForRoundStatus(
  userId: string,
  gameId: string,
  roundId: string,
  targetStatuses: string[],
  maxMs = 3000,
): Promise<ReturnType<typeof getRound> extends Promise<infer T> ? T : never> {
  const deadline = Date.now() + maxMs;
  let last = await getRound(userId, gameId, roundId);
  while (!targetStatuses.includes(last.status) && Date.now() < deadline) {
    await wait(20);
    last = await getRound(userId, gameId, roundId);
  }
  if (!targetStatuses.includes(last.status)) {
    throw new Error(
      `round ${roundId} did not reach [${targetStatuses.join(',')}] within ${maxMs}ms (stuck at ${last.status})`,
    );
  }
  return last;
}

async function createPlayingRound(): Promise<{
  gameId: string;
  roundId: string;
  owner: { id: string };
  other: { id: string };
  songYear: number;
}> {
  const owner = await createUserDirect({});
  const other = await createUserDirect({});

  const tableResponse = await request(app)
    .post('/api/v1/tables')
    .set(authHeader(owner.id, 'user'))
    .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public' });
  const tableId = tableResponse.body.tableId;

  await request(app)
    .post(`/api/v1/tables/${tableId}/join`)
    .set(authHeader(other.id, 'user'))
    .send({ joinAs: 'player' });

  // song_ref is one global playlist shared by every integration test file;
  // invalidate whatever another suite left behind so the song seeded next
  // is deterministically the one drawn (this test asserts on its year).
  await pool.query('UPDATE song_ref SET is_valid = FALSE');
  const songYear = 1990;
  await seedSong(songYear);

  const startResponse = await request(app)
    .post(`/api/v1/tables/${tableId}/start`)
    .set(authHeader(owner.id, 'user'));
  const gameId = startResponse.body.gameId;

  const roundResponse = await request(app)
    .post(`/api/v1/games/${gameId}/rounds`)
    .set(authHeader(owner.id, 'user'));
  const roundId = roundResponse.body.roundId;

  await waitForRoundStatus(owner.id, gameId, roundId, ['playing']);

  return { gameId, roundId, owner, other, songYear };
}

afterAll(async () => {
  // Let any straggler timer (e.g. a round's normal song-window resolver
  // that lost the race to an earlier token resolution) fire and no-op
  // before the pool goes away.
  await wait(500);
  await pool.end();
});

describe('token claim race (FR-030/031/032/036)', () => {
  it('consumes the token and stops normal position guessing on claim', async () => {
    const { gameId, roundId, owner } = await createPlayingRound();

    const claim = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/token-claim`)
      .set(authHeader(owner.id, 'user'));
    expect(claim.status).toBe(202);

    const positionGuess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ type: 'position', value: 0 });
    expect(positionGuess.status).toBe(409);

    await waitForRoundStatus(owner.id, gameId, roundId, ['resolved']);
  });

  it('picks a winner among near-simultaneous claims and marks the rest race_lost', async () => {
    const { gameId, roundId, owner, other } = await createPlayingRound();

    await Promise.all([
      request(app)
        .post(`/api/v1/games/${gameId}/rounds/${roundId}/token-claim`)
        .set(authHeader(owner.id, 'user')),
      request(app)
        .post(`/api/v1/games/${gameId}/rounds/${roundId}/token-claim`)
        .set(authHeader(other.id, 'user')),
    ]);

    await waitForRoundStatus(owner.id, gameId, roundId, ['token_solo']);

    const claims = await pool.query(`SELECT user_id, result FROM token_usage WHERE round_id = $1`, [
      roundId,
    ]);
    expect(claims.rows).toHaveLength(2);
    expect(claims.rows.find((r) => r.result === 'race_lost')).toBeDefined();
    expect(claims.rows.find((r) => r.result === null)).toBeDefined();

    await waitForRoundStatus(owner.id, gameId, roundId, ['resolved']); // solo window times out
  });

  it('rejects a claim once a player has used both tokens for the game', async () => {
    const { gameId, roundId: firstRoundId, owner } = await createPlayingRound();

    // Each round needs its own not-yet-played-in-this-game song; only the
    // first round's song was seeded by createPlayingRound.
    await seedSong(1991);
    await seedSong(1992);

    // Burn token #1 on the round createPlayingRound already started.
    await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${firstRoundId}/token-claim`)
      .set(authHeader(owner.id, 'user'));
    await waitForRoundStatus(owner.id, gameId, firstRoundId, ['resolved']);

    // Burn token #2 on a fresh round.
    const secondRoundResponse = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    const secondRoundId = secondRoundResponse.body.roundId;
    await waitForRoundStatus(owner.id, gameId, secondRoundId, ['playing']);
    await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${secondRoundId}/token-claim`)
      .set(authHeader(owner.id, 'user'));
    await waitForRoundStatus(owner.id, gameId, secondRoundId, ['resolved']);

    const thirdRoundResponse = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    const thirdRoundId = thirdRoundResponse.body.roundId;
    await waitForRoundStatus(owner.id, gameId, thirdRoundId, ['playing']);

    const thirdClaim = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${thirdRoundId}/token-claim`)
      .set(authHeader(owner.id, 'user'));
    expect(thirdClaim.status).toBe(409);
    expect(thirdClaim.body.error).toBe('TOKEN_ALREADY_USED');

    await waitForRoundStatus(owner.id, gameId, thirdRoundId, ['resolved']); // normal window still runs out
  });
});

describe('token solo and opponents windows (FR-033/034/035)', () => {
  it('awards a token_win card immediately on a correct solo guess', async () => {
    const { gameId, roundId, owner, songYear } = await createPlayingRound();

    await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/token-claim`)
      .set(authHeader(owner.id, 'user'));
    await waitForRoundStatus(owner.id, gameId, roundId, ['token_solo']);

    const submit = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/token-submit`)
      .set(authHeader(owner.id, 'user'))
      .send({ year: songYear });
    expect(submit.status).toBe(200);
    expect(submit.body.correct).toBe(true);

    const roundDetail = await getRound(owner.id, gameId, roundId);
    expect(roundDetail.status).toBe('resolved');

    const gameDetail = await request(app)
      .get(`/api/v1/games/${gameId}`)
      .set(authHeader(owner.id, 'user'));
    const ownerPlayer = gameDetail.body.players.find((p: { userId: string }) => p.userId === owner.id);
    expect(ownerPlayer.cardCount).toBe(3); // 2 start blocks + 1 token_win card
  });

  it('opens an opponents window with the wrong year shown, and awards the card to a correct opponent', async () => {
    const { gameId, roundId, owner, other, songYear } = await createPlayingRound();

    await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/token-claim`)
      .set(authHeader(owner.id, 'user'));
    await waitForRoundStatus(owner.id, gameId, roundId, ['token_solo']);

    const wrongYear = songYear + 5;
    const soloSubmit = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/token-submit`)
      .set(authHeader(owner.id, 'user'))
      .send({ year: wrongYear });
    expect(soloSubmit.body.correct).toBe(false);

    const midDetail = await getRound(other.id, gameId, roundId);
    expect(midDetail.status).toBe('token_others');
    expect(midDetail.tokenWrongGuessYear).toBe(wrongYear); // FR-035

    const opponentSubmit = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/token-submit`)
      .set(authHeader(other.id, 'user'))
      .send({ year: songYear });
    expect(opponentSubmit.status).toBe(200);
    expect(opponentSubmit.body.correct).toBe(true);

    await waitForRoundStatus(owner.id, gameId, roundId, ['resolved']);

    const gameDetail = await request(app)
      .get(`/api/v1/games/${gameId}`)
      .set(authHeader(owner.id, 'user'));
    const otherPlayer = gameDetail.body.players.find((p: { userId: string }) => p.userId === other.id);
    const ownerPlayer = gameDetail.body.players.find((p: { userId: string }) => p.userId === owner.id);
    expect(otherPlayer.cardCount).toBe(3); // won the card as the correct opponent
    expect(ownerPlayer.cardCount).toBe(2); // guessed wrong, no card
  });

  it('resolves with no card if the solo winner never submits (timeout)', async () => {
    const { gameId, roundId, owner } = await createPlayingRound();

    await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/token-claim`)
      .set(authHeader(owner.id, 'user'));

    await waitForRoundStatus(owner.id, gameId, roundId, ['resolved']);

    const gameDetail = await request(app)
      .get(`/api/v1/games/${gameId}`)
      .set(authHeader(owner.id, 'user'));
    const ownerPlayer = gameDetail.body.players.find((p: { userId: string }) => p.userId === owner.id);
    expect(ownerPlayer.cardCount).toBe(2); // timeout, no card

    const tokenRow = await pool.query('SELECT result FROM token_usage WHERE round_id = $1', [roundId]);
    expect(tokenRow.rows[0].result).toBe('solo_timeout');
  });
});
