import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/db/pool';
import { syncAllAdolarPlaylists } from '../../src/services/adolarSync';
import { authHeader, createUserDirect, markSeatReadyDirect, uniqueSuffix } from '../helpers/testUtils';

// adolar_playlist isn't in globalSetup's TRUNCATE list (it has no FK back
// to song_ref, so CASCADE doesn't reach it) - this file is the only one
// that writes to it, but its own tests still need a clean slate between
// them since availability now hinges on catalog rows left over from an
// earlier test in this file, not a live Adolar call.
async function clearPlaylistCatalog() {
  await pool.query(`TRUNCATE TABLE adolar_playlist`);
}

const app = createApp();

const ADOLAR_PLAYLIST_ID = 42;

interface FakeAdolarTrack {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  year: number;
  duration: number;
}

function fakeTracks(count: number): FakeAdolarTrack[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 100000 + i,
    title: `Adolar Track ${i}_${uniqueSuffix()}`,
    artist: `Adolar Artist ${i}`,
    album: null,
    genre: null,
    year: 1960 + (i % 60),
    duration: 180,
  }));
}

// Mocks the two /api/songster/* endpoints the Songster backend calls
// (see adolarClient.ts): the playlist-availability list and paginated
// track fetches. `tracks` is served back in pages of `limit` starting at
// `offset`, mirroring Adolar's actual route (routes/songster.py).
function mockAdolar(opts: { playlistIds?: number[]; tracks?: FakeAdolarTrack[] } = {}): jest.Mock {
  const playlistIds = opts.playlistIds ?? [ADOLAR_PLAYLIST_ID];
  const tracks = opts.tracks ?? fakeTracks(60);
  const fetchMock = jest.fn(async (url: string) => {
    if (url.endsWith('/api/songster/playlists')) {
      return {
        ok: true,
        json: async () => ({
          playlists: playlistIds.map((id) => ({ id, name: `Playlist ${id}`, description: '' })),
        }),
      };
    }
    const match = url.match(/\/api\/songster\/playlists\/(\d+)\/tracks\?limit=(\d+)&offset=(\d+)/);
    if (match) {
      const limit = Number(match[2]);
      const offset = Number(match[3]);
      return {
        ok: true,
        json: async () => ({
          total: tracks.length,
          limit,
          offset,
          tracks: tracks.slice(offset, offset + limit),
        }),
      };
    }
    throw new Error(`unexpected Adolar URL in test: ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function createTwoPlayerTableWithPlaylist(sourcePlaylistId: number | null) {
  const owner = await createUserDirect({});
  const other = await createUserDirect({});

  const tableResponse = await request(app)
    .post('/api/v1/tables')
    .set(authHeader(owner.id, 'user'))
    .send({ name: `AdolarTable_${uniqueSuffix()}`, visibility: 'public', sourcePlaylistId });
  return { owner, other, tableResponse };
}

describe('Adolar integration (Adolar_Songster_Adolar_Integration_Konzept section 4)', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.ADOLAR_BASE_URL = 'http://adolar.example';
    process.env.ADOLAR_API_TOKEN = 'test-token';
    process.env.ADOLAR_CLIENT_VERSION = '0.1.0-test';
    await clearPlaylistCatalog();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects table creation with an unavailable sourcePlaylistId', async () => {
    // Availability is checked against the local catalog now (see
    // adolarPlaylistCatalog.ts), not a live Adolar call - an id that was
    // never synced is simply not there, same end result as before.
    const owner = await createUserDirect({});

    const response = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public', sourcePlaylistId: ADOLAR_PLAYLIST_ID });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('ADOLAR_PLAYLIST_UNAVAILABLE');
  });

  it('rejects table creation when Adolar is not configured', async () => {
    delete process.env.ADOLAR_BASE_URL;
    delete process.env.ADOLAR_API_TOKEN;
    const owner = await createUserDirect({});

    const response = await request(app)
      .post('/api/v1/tables')
      .set(authHeader(owner.id, 'user'))
      .send({ name: `Table_${uniqueSuffix()}`, visibility: 'public', sourcePlaylistId: ADOLAR_PLAYLIST_ID });

    expect(response.status).toBe(502);
    expect(response.body.error).toBe('NOT_CONFIGURED');
  });

  it('creates a table with an available sourcePlaylistId', async () => {
    mockAdolar();
    // Table creation checks the local catalog, so the playlist has to be
    // synced first - a live-only mock is no longer enough by itself.
    await syncAllAdolarPlaylists();
    const { tableResponse } = await createTwoPlayerTableWithPlaylist(ADOLAR_PLAYLIST_ID);

    expect(tableResponse.status).toBe(201);
    expect(tableResponse.body.sourcePlaylistId).toBe(ADOLAR_PLAYLIST_ID);
  });

  it('draws a scoped 50-song batch at session start and confines round selection to it', async () => {
    mockAdolar();
    await syncAllAdolarPlaylists();
    const { owner, other, tableResponse } = await createTwoPlayerTableWithPlaylist(ADOLAR_PLAYLIST_ID);
    const tableId = tableResponse.body.tableId;

    await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(other.id, 'user'))
      .send({ joinAs: 'player' });

    // song_ref is shared across every integration test file; other suites'
    // local songs must not leak into this Adolar-sourced session's pool.
    await pool.query(`UPDATE song_ref SET is_valid = FALSE`);

    // Session start no longer talks to Adolar live (see adolarBatch.ts) -
    // it reads whatever the daily/manual sync already upserted, so a test
    // (like a real admin) has to run that sync at least once first.
    await syncAllAdolarPlaylists();

    await markSeatReadyDirect(tableId, owner.id);
    await markSeatReadyDirect(tableId, other.id);

    const startResponse = await request(app)
      .post(`/api/v1/tables/${tableId}/start`)
      .set(authHeader(owner.id, 'user'));

    expect(startResponse.status).toBe(200);
    const tableSessionId = startResponse.body.tableSessionId;

    const poolRows = await pool.query(
      `SELECT song_ref_id FROM table_session_song_pool WHERE table_session_id = $1`,
      [tableSessionId],
    );
    expect(poolRows.rowCount).toBeGreaterThan(0);
    expect(poolRows.rowCount).toBeLessThanOrEqual(50);

    const adolarSongRefRows = await pool.query(
      `SELECT id FROM song_ref WHERE source = 'adolar'`,
    );
    expect(adolarSongRefRows.rowCount).toBeGreaterThan(0);

    const roundResponse = await request(app)
      .post(`/api/v1/games/${startResponse.body.gameId}/rounds`)
      .set(authHeader(owner.id, 'user'));

    expect(roundResponse.status).toBe(201);

    const scopedIds = new Set(poolRows.rows.map((row) => row.song_ref_id));
    const roundResult = await pool.query(
      `SELECT song_id, (SELECT last_played_at FROM song_ref WHERE id = song_id) AS last_played_at
       FROM round WHERE game_id = $1`,
      [startResponse.body.gameId],
    );
    expect(roundResult.rowCount).toBe(1);
    // Malus bookkeeping (section 4.4): the actually-selected song gets its
    // last_played_at stamped, independent of Adolar's own play_count.
    expect(roundResult.rows[0].last_played_at).not.toBeNull();
    expect(scopedIds.has(roundResult.rows[0].song_id)).toBe(true);
  });

  it('rejects starting the table if the playlist became unavailable since creation', async () => {
    mockAdolar();
    await syncAllAdolarPlaylists();
    const { owner, other, tableResponse } = await createTwoPlayerTableWithPlaylist(ADOLAR_PLAYLIST_ID);
    const tableId = tableResponse.body.tableId;

    await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(other.id, 'user'))
      .send({ joinAs: 'player' });

    // Simulate the playlist being disabled/deleted on the Adolar side
    // between table creation and session start - and, since availability is
    // local-only now (see adolarPlaylistCatalog.ts), a sync actually
    // running before the next check is what applies that removal locally;
    // an admin/scheduled sync would do the same in production.
    mockAdolar({ playlistIds: [] });
    await syncAllAdolarPlaylists();

    await markSeatReadyDirect(tableId, owner.id);
    await markSeatReadyDirect(tableId, other.id);

    const startResponse = await request(app)
      .post(`/api/v1/tables/${tableId}/start`)
      .set(authHeader(owner.id, 'user'));

    expect(startResponse.status).toBe(409);
    expect(startResponse.body.error).toBe('ADOLAR_PLAYLIST_UNAVAILABLE');

    const tableState = await pool.query(`SELECT state FROM game_table WHERE id = $1`, [tableId]);
    expect(tableState.rows[0].state).toBe('open');
    const sessions = await pool.query(`SELECT id FROM table_session WHERE table_id = $1`, [tableId]);
    expect(sessions.rowCount).toBe(0);
  });

  it('local-admin-maintained-songs fallback (no sourcePlaylistId) is unaffected', async () => {
    const { owner, other, tableResponse } = await createTwoPlayerTableWithPlaylist(null);
    expect(tableResponse.body.sourcePlaylistId).toBeNull();
    const tableId = tableResponse.body.tableId;

    await request(app)
      .post(`/api/v1/tables/${tableId}/join`)
      .set(authHeader(other.id, 'user'))
      .send({ joinAs: 'player' });

    await pool.query(`UPDATE song_ref SET is_valid = FALSE`);
    await pool.query(
      `INSERT INTO song_ref (source, source_song_id, title, year_value, duration_sec)
       VALUES ('local', $1, $2, 1990, 180)`,
      [`local_${uniqueSuffix()}`, `Local Song ${uniqueSuffix()}`],
    );

    await markSeatReadyDirect(tableId, owner.id);
    await markSeatReadyDirect(tableId, other.id);

    const startResponse = await request(app)
      .post(`/api/v1/tables/${tableId}/start`)
      .set(authHeader(owner.id, 'user'));

    expect(startResponse.status).toBe(200);

    const poolRows = await pool.query(
      `SELECT 1 FROM table_session_song_pool WHERE table_session_id = $1`,
      [startResponse.body.tableSessionId],
    );
    // No scoped pool for a local-admin-songs table - candidate selection
    // keeps drawing from the entire song_ref library, as before.
    expect(poolRows.rowCount).toBe(0);
  });
});
