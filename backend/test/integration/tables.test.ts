import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { authHeader, createUserDirect, uniqueSuffix } from '../helpers/testUtils';

const app = createApp();

describe('table creation and lobby listing', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('creates a public table and seats the creator as a player', async () => {
    const owner = await createUserDirect({});

    const response = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Freitagsrunde_${uniqueSuffix()}`, visibility: 'public' });

    expect(response.status).toBe(201);
    expect(response.body.joinCode).toBeNull();

    const seat = await pool.query(
      'SELECT seat_type FROM table_seat WHERE table_id = $1 AND user_id = $2',
      [response.body.tableId, owner.id],
    );
    expect(seat.rows[0].seat_type).toBe('player');
  });

  it('lists open public tables in the lobby but not private ones', async () => {
    const owner = await createUserDirect({});
    const publicName = `PublicTable_${uniqueSuffix()}`;
    const privateName = `PrivateTable_${uniqueSuffix()}`;

    await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: publicName, visibility: 'public' });

    const privateResponse = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: privateName, visibility: 'private' });

    expect(privateResponse.body.joinCode).not.toBeNull();

    const lobby = await request(app)
      .get('/api/v1/tables/lobby')
      .set(authHeader(owner.id, 'user'));

    const names = lobby.body.tables.map((t: { name: string }) => t.name);
    expect(names).toContain(publicName);
    expect(names).not.toContain(privateName);

    const publicEntry = lobby.body.tables.find((t: { name: string }) => t.name === publicName);
    expect(publicEntry.activePlayers).toBe(1);
  });

  it('rejects an invalid visibility value', async () => {
    const owner = await createUserDirect({});

    const response = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: 'Bad table', visibility: 'nonsense' });

    expect(response.status).toBe(400);
  });
});
