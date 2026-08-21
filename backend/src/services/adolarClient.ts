// Client for Adolar's /api/songster/* surface (see the adolar-songster
// repo's docs/Adolar_Songster_Adolar_Integration_Konzept_v1_20260821.md
// section 3.4 and musicapp's docs/PRODUCT_INTEGRATIONS.md section 5).
//
// Songster contacts Adolar only at table creation and table-session start
// (playlist availability check + batch track fetch) - never during an
// active game, so there is no persistent connection or token refresh to
// manage here (section 4.1).
//
// Auth: a single long-lived Bearer API token (product="songster"), created
// once by an Adolar admin via the Adolar Web "API-Zugriff" settings and
// configured here via ADOLAR_API_TOKEN. This supersedes the concept doc's
// original session-login plan (POST /api/songster/login) - Adolar's actual
// Step 2 implementation used the existing API-token mechanism instead
// (matching Taggster's precedent), which needs no login step at all.

export class AdolarClientError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_CONFIGURED' | 'REQUEST_FAILED' | 'PLAYLIST_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'AdolarClientError';
  }
}

export interface AdolarPlaylist {
  id: number;
  name: string;
  description: string;
}

export interface AdolarTrack {
  id: number;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  duration: number | null;
}

interface AdolarTracksPage {
  total: number;
  limit: number;
  offset: number;
  tracks: AdolarTrack[];
}

function config(): { baseUrl: string; token: string; clientVersion: string } {
  const baseUrl = process.env.ADOLAR_BASE_URL;
  const token = process.env.ADOLAR_API_TOKEN;
  if (!baseUrl || !token) {
    throw new AdolarClientError(
      'ADOLAR_BASE_URL and ADOLAR_API_TOKEN must be configured to use an Adolar-sourced playlist',
      'NOT_CONFIGURED',
    );
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    clientVersion: process.env.ADOLAR_CLIENT_VERSION ?? 'unknown',
  };
}

async function adolarFetch(path: string): Promise<Response> {
  const { baseUrl, token, clientVersion } = config();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Adolar-Client-Version': clientVersion,
      },
    });
  } catch (err) {
    throw new AdolarClientError(
      `failed to reach Adolar at ${baseUrl}: ${(err as Error).message}`,
      'REQUEST_FAILED',
    );
  }
  if (!response.ok) {
    throw new AdolarClientError(
      `Adolar request to ${path} failed with status ${response.status}`,
      'REQUEST_FAILED',
    );
  }
  return response;
}

export async function isPlaylistAvailable(playlistId: number): Promise<boolean> {
  const response = await adolarFetch('/api/songster/playlists');
  const data = (await response.json()) as { playlists: AdolarPlaylist[] };
  return data.playlists.some((playlist) => playlist.id === playlistId);
}

export async function fetchPlaylistTracksPage(
  playlistId: number,
  limit: number,
  offset: number,
): Promise<AdolarTracksPage> {
  const response = await adolarFetch(
    `/api/songster/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`,
  );
  return (await response.json()) as AdolarTracksPage;
}
