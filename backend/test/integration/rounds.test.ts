import request from 'supertest';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, uniqueSuffix } from '../helpers/testUtils';

// Round timings are read from these env vars once, at module import time,
// so they must be set before requiring the app (a plain require, not an
// ES import, so it isn't hoisted above these assignments). This lets the
// full countdown -> song-window -> resolve cycle run in milliseconds
// instead of the real 3s + 25s, keeping the suite fast and deterministic.
process.env.ROUND_COUNTDOWN_MS = '150';
process.env.ROUND_SONG_DURATION_MS = '400';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createApp } = require('../../src/app');
const app = createApp();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedSong(year: number): Promise<string> {
  const result = await pool.query(
    `INSERT INTO song_ref (source, source_song_id, title, year_value, duration_sec)
     VALUES ('local', $1, $2, $3, 180)
     RETURNING id`,
    [`song_${uniqueSuffix()}`, `Song ${uniqueSuffix()}`, year],
  );
  return result.rows[0].id;
}

async function setTimeline(gameId: string, userId: string, years: number[]): Promise<void> {
  await pool.query('DELETE FROM timeline_card WHERE game_id = $1 AND user_id = $2', [gameId, userId]);
  for (let i = 0; i < years.length; i += 1) {
    await pool.query(
      `INSERT INTO timeline_card (game_id, user_id, year_value, special_type, placed_position)
       VALUES ($1, $2, $3, 'normal', $4)`,
      [gameId, userId, years[i], i],
    );
  }
}

async function createRunningGame(): Promise<{ tableId: string; gameId: string; owner: { id: string }; other: { id: string } }> {
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

  await seedSong(1990);

  const startResponse = await request(app)
    .post(`/api/v1/tables/${tableId}/start`)
    .set(authHeader(owner.id, 'user'));

  return { tableId, gameId: startResponse.body.gameId, owner, other };
}

afterAll(async () => {
  await pool.end();
});

describe('table start seeds a starting timeline (FR-023)', () => {
  it('refuses to start a table with no songs in the playlist', async () => {
    const owner = await createUserDirect({});
    const other = await createUserDirect({});
    const tableResponse = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Empty_${uniqueSuffix()}`, visibility: 'public' });
    await request(app)
      .post(`/api/v1/tables/${tableResponse.body.tableId}/join`)
      .set(authHeader(other.id, 'user'))
      .send({ joinAs: 'player' });

    const startResponse = await request(app)
      .post(`/api/v1/tables/${tableResponse.body.tableId}/start`)
      .set(authHeader(owner.id, 'user'));

    expect(startResponse.status).toBe(400);
  });

  it('gives each active player 2 start blocks', async () => {
    const { gameId } = await createRunningGame();

    const detail = await request(app).get(`/api/v1/games/${gameId}`).set(authHeader((await createUserDirect({})).id, 'user'));
    expect(detail.status).toBe(200);
    expect(detail.body.players).toHaveLength(2);
    for (const player of detail.body.players) {
      expect(player.cardCount).toBe(2);
    }
  });
});

describe('round lifecycle (FR-021/022/025/026)', () => {

  it('runs countdown -> playing -> resolved deterministically and scores placements correctly', async () => {
    const { gameId, owner, other } = await createRunningGame();

    await setTimeline(gameId, owner.id, [1980, 2000]);
    await setTimeline(gameId, other.id, [1980, 2000]);

    const startRound = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    expect(startRound.status).toBe(201);
    expect(startRound.body.status).toBe('countdown');
    const roundId = startRound.body.roundId;

    const guessDuringCountdown = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ type: 'position', value: 1 });
    expect(guessDuringCountdown.status).toBe(409);

    await wait(200); // past ROUND_COUNTDOWN_MS=150

    const midRound = await request(app)
      .get(`/api/v1/games/${gameId}/rounds/${roundId}`)
      .set(authHeader(owner.id, 'user'));
    expect(midRound.body.status).toBe('playing');
    expect(midRound.body.songYear).toBeNull(); // not revealed before resolution

    // Song year is 1990: index 1 (between 1980 and 2000) is correct for
    // owner's [1980, 2000] timeline; index 0 is wrong for other's.
    const correctGuess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ type: 'position', value: 1 });
    expect(correctGuess.status).toBe(200);

    const wrongGuess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(other.id, 'user'))
      .send({ type: 'position', value: 0 });
    expect(wrongGuess.status).toBe(200);

    await wait(500); // past ROUND_COUNTDOWN_MS + ROUND_SONG_DURATION_MS from round start

    const lateGuess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ type: 'position', value: 1 });
    expect(lateGuess.status).toBe(409);

    const resolved = await request(app)
      .get(`/api/v1/games/${gameId}/rounds/${roundId}`)
      .set(authHeader(owner.id, 'user'));
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.songYear).toBe(1990);

    const ownerResult = resolved.body.results.find((r: { userId: string }) => r.userId === owner.id);
    const otherResult = resolved.body.results.find((r: { userId: string }) => r.userId === other.id);
    expect(ownerResult.correct).toBe(true);
    expect(otherResult.correct).toBe(false);

    const gameDetail = await request(app)
      .get(`/api/v1/games/${gameId}`)
      .set(authHeader(owner.id, 'user'));
    const ownerPlayer = gameDetail.body.players.find((p: { userId: string }) => p.userId === owner.id);
    const otherPlayer = gameDetail.body.players.find((p: { userId: string }) => p.userId === other.id);
    expect(ownerPlayer.cardCount).toBe(3); // gained the correctly placed card
    expect(otherPlayer.cardCount).toBe(2); // wrong guess, no card awarded
  });

  it('refuses to start a round for a non-owner and blocks a second concurrent round', async () => {
    const { gameId, owner, other } = await createRunningGame();

    const forbidden = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(other.id, 'user'));
    expect(forbidden.status).toBe(403);

    const first = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/games/${gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));
    expect(second.status).toBe(409);

    await wait(600); // let the round resolve before pool.end() runs (past 150+400ms)
  });
});
