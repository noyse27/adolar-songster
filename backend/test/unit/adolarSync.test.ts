const ORIGINAL_ENV = { ...process.env };

function freshSync() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../src/services/adolarSync') as typeof import('../../src/services/adolarSync');
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 200));
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

// Adolar not configured => listPlaylists() rejects with NOT_CONFIGURED,
// which syncAllAdolarPlaylists() catches and resolves to zero counts
// without ever touching the DB pool - lets these run as true unit tests.
describe('adolarSync background sync state (see routes/admin.ts docstring for why this is fire-and-forget)', () => {
  beforeEach(() => {
    delete process.env.ADOLAR_BASE_URL;
    delete process.env.ADOLAR_API_TOKEN;
  });

  it('starts idle', () => {
    const { getSyncState } = freshSync();
    expect(getSyncState()).toEqual({ status: 'idle' });
  });

  it('transitions running -> completed and reports the result', async () => {
    const { triggerBackgroundSync, getSyncState } = freshSync();

    const { started } = triggerBackgroundSync();
    expect(started).toBe(true);
    expect(getSyncState().status).toBe('running');

    await flushMicrotasks();

    const state = getSyncState();
    expect(state).toMatchObject({ status: 'completed', result: { playlistCount: 0, trackCount: 0 } });
  });

  it('refuses to start a second sync while one is already running', async () => {
    const { triggerBackgroundSync } = freshSync();

    expect(triggerBackgroundSync()).toEqual({ started: true });
    expect(triggerBackgroundSync()).toEqual({ started: false });

    await flushMicrotasks();
  });
});
