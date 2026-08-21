const ORIGINAL_ENV = { ...process.env };

function freshClient() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../src/services/adolarClient') as typeof import('../../src/services/adolarClient');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

describe('adolarClient (Adolar_Songster_Adolar_Integration_Konzept section 3.4)', () => {
  it('throws NOT_CONFIGURED when ADOLAR_BASE_URL or ADOLAR_API_TOKEN is missing', async () => {
    delete process.env.ADOLAR_BASE_URL;
    delete process.env.ADOLAR_API_TOKEN;
    const { isPlaylistAvailable, AdolarClientError } = freshClient();

    await expect(isPlaylistAvailable(1)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    await expect(isPlaylistAvailable(1)).rejects.toBeInstanceOf(AdolarClientError);
  });

  it('sends the Bearer token and X-Adolar-Client-Version header', async () => {
    process.env.ADOLAR_BASE_URL = 'http://adolar.example';
    process.env.ADOLAR_API_TOKEN = 'test-token';
    process.env.ADOLAR_CLIENT_VERSION = '9.9.9';
    const { isPlaylistAvailable } = freshClient();

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ playlists: [{ id: 1, name: 'Querbeet', description: '' }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await isPlaylistAvailable(1);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://adolar.example/api/songster/playlists',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-token',
          'X-Adolar-Client-Version': '9.9.9',
        },
      }),
    );
  });

  it('isPlaylistAvailable returns true only if the id is in the playlists list', async () => {
    process.env.ADOLAR_BASE_URL = 'http://adolar.example';
    process.env.ADOLAR_API_TOKEN = 'test-token';
    const { isPlaylistAvailable } = freshClient();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ playlists: [{ id: 7, name: 'X', description: '' }] }),
    }) as unknown as typeof fetch;

    await expect(isPlaylistAvailable(7)).resolves.toBe(true);
    await expect(isPlaylistAvailable(8)).resolves.toBe(false);
  });

  it('throws REQUEST_FAILED on a non-2xx response', async () => {
    process.env.ADOLAR_BASE_URL = 'http://adolar.example';
    process.env.ADOLAR_API_TOKEN = 'test-token';
    const { isPlaylistAvailable } = freshClient();

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch;

    await expect(isPlaylistAvailable(1)).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
  });

  it('throws REQUEST_FAILED when the network call itself rejects', async () => {
    process.env.ADOLAR_BASE_URL = 'http://adolar.example';
    process.env.ADOLAR_API_TOKEN = 'test-token';
    const { isPlaylistAvailable } = freshClient();

    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    await expect(isPlaylistAvailable(1)).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
  });

  it('fetchPlaylistTracksPage requests the given limit/offset and returns the parsed page', async () => {
    process.env.ADOLAR_BASE_URL = 'http://adolar.example';
    process.env.ADOLAR_API_TOKEN = 'test-token';
    const { fetchPlaylistTracksPage } = freshClient();

    const page = { total: 3, limit: 50, offset: 0, tracks: [{ id: 1, title: 'T', artist: 'A', album: null, genre: null, year: 1999, duration: 200 }] };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => page });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchPlaylistTracksPage(42, 50, 0);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://adolar.example/api/songster/playlists/42/tracks?limit=50&offset=0',
      expect.anything(),
    );
    expect(result).toEqual(page);
  });
});
