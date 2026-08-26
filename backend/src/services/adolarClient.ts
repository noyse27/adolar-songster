// Client for Adolar's /api/songster/* surface (see the adolar-songster
// repo's docs/Adolar_Songster_Adolar_Integration_Konzept_v1_20260821.md
// section 3.4 and musicapp's docs/PRODUCT_INTEGRATIONS.md section 5).
//
// Songster contacts Adolar at table creation and table-session start
// (playlist availability check + batch track fetch), plus a daily
// background full-library sync (see adolarSync.ts/scheduler.ts) - never
// during an active game, so there is no persistent connection or token
// refresh to manage here (section 4.1).
//
// Auth: a single long-lived Bearer API token (product="songster"), created
// once by an Adolar admin via the Adolar Web "API-Zugriff" settings and
// configured here via ADOLAR_API_TOKEN. This supersedes the concept doc's
// original session-login plan (POST /api/songster/login) - Adolar's actual
// Step 2 implementation used the existing API-token mechanism instead
// (matching Taggster's precedent), which needs no login step at all.
//
// Config source: the setup wizard's "Musikdaten" step (see setup.ts
// /setup/music-source) writes baseUrl/apiToken into the system_setting
// table via systemSettings.ts. That takes precedence; ADOLAR_BASE_URL /
// ADOLAR_API_TOKEN env vars remain a fallback for headless/Compose-only
// deployments that never touch the wizard.

import { getSetting } from './systemSettings';

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

async function config(): Promise<{ baseUrl: string; token: string; clientVersion: string }> {
  const baseUrl = (await getSetting('adolar.base_url')) ?? process.env.ADOLAR_BASE_URL;
  const token = (await getSetting('adolar.api_token')) ?? process.env.ADOLAR_API_TOKEN;
  if (!baseUrl || !token) {
    throw new AdolarClientError(
      'Adolar is not configured yet - run the setup wizard\'s Musikdaten step (or set ADOLAR_BASE_URL/ADOLAR_API_TOKEN)',
      'NOT_CONFIGURED',
    );
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    clientVersion: process.env.ADOLAR_CLIENT_VERSION ?? 'unknown',
  };
}

// Config-only check (no network call) so table creation/session start
// (tables.ts, tableStart.ts) can tell "Adolar was never configured" apart
// from "configured, but this playlist isn't in the local catalog" without
// making a live request on every table action - see adolarPlaylistCatalog.ts.
export async function isAdolarConfigured(): Promise<boolean> {
  const baseUrl = (await getSetting('adolar.base_url')) ?? process.env.ADOLAR_BASE_URL;
  const token = (await getSetting('adolar.api_token')) ?? process.env.ADOLAR_API_TOKEN;
  return Boolean(baseUrl && token);
}

async function rawAdolarFetch(baseUrl: string, token: string, clientVersion: string, path: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
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

async function adolarFetch(path: string): Promise<Response> {
  const { baseUrl, token, clientVersion } = await config();
  return rawAdolarFetch(baseUrl, token, clientVersion, path);
}

/** Setup-wizard connection test: hits Adolar with credentials that haven't
 * been persisted yet, so a bad token/URL never gets saved. */
export async function testAdolarConnection(
  baseUrl: string,
  apiToken: string,
): Promise<{ ok: true; playlistCount: number } | { ok: false; error: string }> {
  try {
    const response = await rawAdolarFetch(baseUrl, apiToken, process.env.ADOLAR_CLIENT_VERSION ?? 'unknown', '/api/songster/playlists');
    const data = (await response.json()) as { playlists: AdolarPlaylist[] };
    return { ok: true, playlistCount: data.playlists.length };
  } catch (err) {
    if (err instanceof AdolarClientError) return { ok: false, error: err.message };
    return { ok: false, error: (err as Error).message };
  }
}

export async function listPlaylists(): Promise<AdolarPlaylist[]> {
  const response = await adolarFetch('/api/songster/playlists');
  const data = (await response.json()) as { playlists: AdolarPlaylist[] };
  return data.playlists;
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

/** Raw proxy fetch for one track's audio bytes, forwarding a Range header
 * (if present) straight through so scrubbing/seeking still works end to
 * end. Deliberately does NOT throw on a non-2xx response (unlike
 * rawAdolarFetch) - routes/songs.ts needs to tell a 404 (unknown track)
 * apart from a genuine connectivity failure, and just relays the upstream
 * status either way. */
export async function fetchTrackStreamResponse(trackId: number, rangeHeader?: string): Promise<Response> {
  const { baseUrl, token, clientVersion } = await config();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Adolar-Client-Version': clientVersion,
  };
  if (rangeHeader) headers.Range = rangeHeader;
  try {
    return await fetch(`${baseUrl}/api/songster/tracks/${trackId}/stream`, { headers });
  } catch (err) {
    throw new AdolarClientError(`failed to reach Adolar at ${baseUrl}: ${(err as Error).message}`, 'REQUEST_FAILED');
  }
}

/** Pages through an entire playlist rather than a capped first slice -
 * used by both the per-session batch fetch and the daily full-library sync
 * (see adolarSync.ts). A capped fetch previously meant Songster only ever
 * saw a playlist's first ~200 tracks (in Adolar's id order), which starves
 * the decade-spread batch algorithm on any playlist bigger than that. */
export async function fetchAllPlaylistTracks(playlistId: number, pageSize = 100): Promise<AdolarTrack[]> {
  const tracks: AdolarTrack[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPlaylistTracksPage(playlistId, pageSize, offset);
    tracks.push(...page.tracks);
    offset += page.tracks.length;
    if (page.tracks.length === 0 || offset >= page.total) break;
  }
  return tracks;
}
