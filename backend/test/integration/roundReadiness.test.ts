import request from 'supertest';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, markSeatReadyDirect, uniqueSuffix } from '../helpers/testUtils';

// See rounds.test.ts's comment: these are read once at module import time,
// so they must be set before requiring the app.
process.env.ROUND_COUNTDOWN_MS = '150';
process.env.ROUND_SONG_DURATION_MS = '400';
process.env.ROUND_READY_WINDOW_MS = '200';

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

async function createRunningGame(): Promise<{
  tableId: string;
  gameId: string;
  owner: { id: string };
  other: { id: string };
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

  await pool.query('UPDATE song_ref SET is_valid = FALSE');
  await seedSong(1990);
  await seedSong(2005);

  await markSeatReadyDirect(tableId, owner.id);
  await markSeatReadyDirect(tableId, other.id);

  const startResponse = await request(app)
    .post(`/api/v1/tables/${tableId}/start`)
    .set(authHeader(owner.id, 'user'));

  return { tableId, gameId: startResponse.body.gameId, owner, other };
}

afterAll(async () => {
  await pool.end();
});

describe('per-round readiness (30s ready window, sit-outs)', () => {
  it('auto-starts the round once every active player is ready', async () => {
    const { gameId, owner, other } = await createRunningGame();

    const first = await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    expect(first.status).toBe(200);

    const stateAfterFirst = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateAfterFirst.body.currentRound).toBeNull();
    expect(stateAfterFirst.body.roundReadyPhase.readyUserIds).toContain(owner.id);

    const second = await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(other.id, 'user'))
      .send({ ready: true });
    expect(second.status).toBe(200);

    const stateAfterSecond = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(stateAfterSecond.body.currentRound).not.toBeNull();
    expect(stateAfterSecond.body.currentRound.status).toBe('countdown');
    expect(stateAfterSecond.body.currentRound.sitOutUserIds).toEqual([]);
  });

  it('starts the round after the ready window with stragglers sitting it out, and rejects their guess', async () => {
    const { gameId, owner, other } = await createRunningGame();

    await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    // other never readies up.

    await wait(350); // past ROUND_READY_WINDOW_MS=200

    const state = await request(app)
      .get(`/api/v1/games/${gameId}/state`)
      .set(authHeader(owner.id, 'user'));
    expect(state.body.currentRound).not.toBeNull();
    expect(state.body.currentRound.sitOutUserIds).toEqual([other.id]);

    const roundId = state.body.currentRound.roundId;
    await wait(200); // past ROUND_COUNTDOWN_MS=150, into 'playing'

    const guessAttempt = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(other.id, 'user'))
      .send({ type: 'position', value: 0 });
    expect(guessAttempt.status).toBe(403);
    expect(guessAttempt.body.error).toBe('SITTING_OUT');

    const ownerGuess = await request(app)
      .post(`/api/v1/games/${gameId}/rounds/${roundId}/guess`)
      .set(authHeader(owner.id, 'user'))
      .send({ type: 'position', value: 0 });
    expect(ownerGuess.status).toBe(200);
  });

  it('refuses to mark ready while a round is already in progress', async () => {
    const { gameId, owner, other } = await createRunningGame();

    await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(other.id, 'user'))
      .send({ ready: true });

    const lateReady = await request(app)
      .post(`/api/v1/games/${gameId}/ready`)
      .set(authHeader(owner.id, 'user'))
      .send({ ready: true });
    expect(lateReady.status).toBe(409);
    expect(lateReady.body.error).toBe('ROUND_ALREADY_ACTIVE');
  });
});
