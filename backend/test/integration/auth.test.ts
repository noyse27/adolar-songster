import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';

const app = createApp();

async function createInvite(): Promise<{ code: string }> {
  const adminResult = await pool.query(
    `INSERT INTO app_user (username, email, password_hash, role)
     VALUES ($1, $2, 'x', 'admin')
     RETURNING id`,
    [`admin_${Date.now()}`, `admin_${Date.now()}@example.test`],
  );
  const adminId = adminResult.rows[0].id;

  const code = `invite_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await pool.query(
    `INSERT INTO invite_token (code, created_by, max_uses)
     VALUES ($1, $2, 1)`,
    [code, adminId],
  );

  return { code };
}

describe('POST /api/v1/auth/register', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('rejects registration with an unknown invite code', async () => {
    const response = await request(app).post('/api/v1/auth/register').send({
      username: 'someone',
      email: 'someone@example.test',
      password: 'correct horse battery staple',
      inviteCode: 'does-not-exist',
    });

    expect(response.status).toBe(400);
  });

  it('creates a user and consumes the invite on valid registration', async () => {
    const { code } = await createInvite();

    const response = await request(app).post('/api/v1/auth/register').send({
      username: `player_${Date.now()}`,
      email: `player_${Date.now()}@example.test`,
      password: 'correct horse battery staple',
      inviteCode: code,
    });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('userId');

    const inviteRow = await pool.query('SELECT used_count FROM invite_token WHERE code = $1', [code]);
    expect(inviteRow.rows[0].used_count).toBe(1);
  });

  it('rejects a second registration attempt on an exhausted invite', async () => {
    const { code } = await createInvite();

    await request(app).post('/api/v1/auth/register').send({
      username: `first_${Date.now()}`,
      email: `first_${Date.now()}@example.test`,
      password: 'correct horse battery staple',
      inviteCode: code,
    });

    const secondResponse = await request(app).post('/api/v1/auth/register').send({
      username: `second_${Date.now()}`,
      email: `second_${Date.now()}@example.test`,
      password: 'correct horse battery staple',
      inviteCode: code,
    });

    expect(secondResponse.status).toBe(400);
  });
});
