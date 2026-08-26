import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { getSetting } from '../services/systemSettings';
import { getSyncState, triggerBackgroundSync } from '../services/adolarSync';
import { listCatalogedPlaylists, listPlaylistsForAdmin, updatePlaylistOverrides } from '../services/adolarPlaylistCatalog';
import { ADMIN_INACTIVE_MS } from '../services/tableActivity';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

// Read-only complement to POST /setup/music-source (which the admin page
// reuses to reconfigure) - never returns the token itself.
adminRouter.get('/music-source', async (_req, res) => {
  const baseUrl = await getSetting('adolar.base_url');
  const lastSyncResult = await pool.query(`SELECT MAX(synced_at) AS last_synced_at FROM adolar_playlist_track`);
  res.status(200).json({
    configured: baseUrl !== null,
    baseUrl,
    lastSyncedAt: lastSyncResult.rows[0].last_synced_at,
  });
});

// Manual trigger for the same full-library sync the daily schedule runs
// (see scheduler.ts) - lets an admin make a freshly-created/just-enabled
// Adolar playlist usable right away instead of waiting for the next
// scheduled run. Fire-and-forget: a real playlist can take well over a
// minute to page through, which used to make this handler itself take
// that long too - long enough that nginx's proxy_read_timeout gave the
// admin a 504 ("Sync fehlgeschlagen") while the sync kept running and
// completing fine server-side regardless. The admin page now polls
// GET /adolar-sync/status instead of waiting on this request.
adminRouter.post('/adolar-sync', async (_req, res) => {
  const result = triggerBackgroundSync();
  res.status(202).json(result);
});

adminRouter.get('/adolar-sync/status', async (_req, res) => {
  res.status(200).json(getSyncState());
});

// Backs the admin user-management screen: the mutation endpoints below
// (invite-permission, revoke-invites, reset-invite-quota) all need a
// userId, and this is the only way to discover one.
adminRouter.get('/users', async (_req, res) => {
  const result = await pool.query(
    `SELECT id, username, email, role, status, can_create_invites, karma_points, score_points, created_at
     FROM app_user ORDER BY created_at DESC`,
  );

  res.status(200).json({
    users: result.rows.map((row) => ({
      userId: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.status,
      canCreateInvites: row.can_create_invites,
      karmaPoints: row.karma_points,
      scorePoints: row.score_points,
      createdAt: row.created_at,
    })),
  });
});

// Grant or revoke a user's right to create invites.
adminRouter.post('/users/:userId/invite-permission', async (req, res) => {
  const { userId } = req.params;
  const { canCreateInvites } = req.body ?? {};

  if (typeof canCreateInvites !== 'boolean') {
    res.status(400).json({ error: 'canCreateInvites (boolean) is required' });
    return;
  }

  const result = await pool.query(
    `UPDATE app_user SET can_create_invites = $1 WHERE id = $2 RETURNING id, username, can_create_invites`,
    [canCreateInvites, userId],
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user not found' });
    return;
  }

  res.status(200).json({
    userId: result.rows[0].id,
    username: result.rows[0].username,
    canCreateInvites: result.rows[0].can_create_invites,
  });
});

// Revoke a user's invite right, with optional cascading cleanup:
// - invalidateCreatedInvites: disable every invite the user created
// - deactivateRegisteredUsers: block every account that registered via one
//   of that user's invites
adminRouter.post('/users/:userId/revoke-invites', async (req, res) => {
  const { userId } = req.params;
  const { invalidateCreatedInvites, deactivateRegisteredUsers } = req.body ?? {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `UPDATE app_user SET can_create_invites = FALSE WHERE id = $1 RETURNING id, username`,
      [userId],
    );

    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'user not found' });
      return;
    }

    let invalidatedInviteCount = 0;
    let deactivatedUserCount = 0;

    if (invalidateCreatedInvites) {
      const invalidated = await client.query(
        `UPDATE invite_token
         SET disabled_at = NOW()
         WHERE created_by = $1 AND disabled_at IS NULL
         RETURNING id`,
        [userId],
      );
      invalidatedInviteCount = invalidated.rowCount ?? 0;
    }

    if (deactivateRegisteredUsers) {
      const deactivated = await client.query(
        `UPDATE app_user
         SET status = 'blocked'
         WHERE registered_via_invite_id IN (SELECT id FROM invite_token WHERE created_by = $1)
           AND status = 'active'
         RETURNING id`,
        [userId],
      );
      deactivatedUserCount = deactivated.rowCount ?? 0;
    }

    await client.query('COMMIT');

    res.status(200).json({
      userId: userResult.rows[0].id,
      username: userResult.rows[0].username,
      canCreateInvites: false,
      invalidatedInviteCount,
      deactivatedUserCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Resets a delegated user's monthly invite quota so they can create up to
// the full monthly allowance again, even mid-month.
adminRouter.post('/users/:userId/reset-invite-quota', async (req, res) => {
  const { userId } = req.params;

  const result = await pool.query(
    `UPDATE app_user SET invite_quota_reset_at = NOW() WHERE id = $1 RETURNING id, username, invite_quota_reset_at`,
    [userId],
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'user not found' });
    return;
  }

  res.status(200).json({
    userId: result.rows[0].id,
    username: result.rows[0].username,
    inviteQuotaResetAt: result.rows[0].invite_quota_reset_at,
  });
});

// Admin log view: every invite with its creator and everyone who registered
// through it.
adminRouter.get('/invites/log', async (_req, res) => {
  const result = await pool.query(
    `SELECT
        it.id AS invite_id,
        it.code,
        creator.username AS creator_username,
        it.disabled_at,
        it.expires_at,
        it.max_uses,
        it.used_count,
        COALESCE(
          json_agg(registered.username) FILTER (WHERE registered.username IS NOT NULL),
          '[]'
        ) AS registered_usernames
     FROM invite_token it
     JOIN app_user creator ON creator.id = it.created_by
     LEFT JOIN app_user registered ON registered.registered_via_invite_id = it.id
     GROUP BY it.id, creator.username
     ORDER BY it.created_at DESC`,
  );

  res.status(200).json({
    entries: result.rows.map((row) => ({
      inviteId: row.invite_id,
      code: row.code,
      creatorUsername: row.creator_username,
      disabledAt: row.disabled_at,
      expiresAt: row.expires_at,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      registeredUsernames: row.registered_usernames,
    })),
  });
});

// Minimal song-pool administration. The real Adolar connector (fetching
// songs from the configured Adolar server) is out of scope for this
// sprint; until it exists, an admin can seed song_ref rows directly so the
// round engine has a playlist to draw from.
adminRouter.post('/songs', async (req, res) => {
  const { title, year, durationSec, streamRef, source = 'local' } = req.body ?? {};

  if (!title || !Number.isInteger(year) || year < 1900 || year > 2100) {
    res.status(400).json({ error: 'title and a valid year (1900-2100) are required' });
    return;
  }
  if (!['adolar', 'local'].includes(source)) {
    res.status(400).json({ error: 'source must be adolar or local' });
    return;
  }

  const sourceSongId = crypto.randomUUID();
  const result = await pool.query(
    `INSERT INTO song_ref (source, source_song_id, title, year_value, duration_sec, stream_ref)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, year_value, duration_sec`,
    [source, sourceSongId, title, year, durationSec ?? null, streamRef ?? null],
  );

  res.status(201).json({
    songId: result.rows[0].id,
    title: result.rows[0].title,
    year: result.rows[0].year_value,
    durationSec: result.rows[0].duration_sec,
  });
});

// Feeds the playlist dropdown in the admin Song-Pool search (AdminPage.tsx's
// SongsSection). Reads the local catalog (kept current by
// syncAllAdolarPlaylists) instead of calling Adolar live - see
// adolarPlaylistCatalog.ts. Track counts come from the locally synced pool
// too, since that's what GET /songs below actually searches.
adminRouter.get('/adolar-playlists', async (_req, res) => {
  const playlists = await listCatalogedPlaylists();

  const counts = await pool.query(
    `SELECT playlist_id, COUNT(*)::int AS track_count FROM adolar_playlist_track GROUP BY playlist_id`,
  );
  const countByPlaylist = new Map<number, number>(counts.rows.map((row) => [row.playlist_id, row.track_count]));

  res.status(200).json({
    playlists: playlists.map((p) => ({
      playlistId: p.id,
      name: p.name,
      trackCount: countByPlaylist.get(p.id) ?? 0,
    })),
  });
});

// Playlistadministration: lets an admin set a display name (shown to
// players instead of the raw Adolar name everywhere - table creation,
// Song-Pool, the "Songster PlayLists" lobby dialog) and a description
// (shown only in that lobby dialog) per playlist. Both live in their own
// columns on adolar_playlist so syncAllAdolarPlaylists never overwrites
// them - see the playlist-display-override migration.
adminRouter.get('/playlist-catalog', async (_req, res) => {
  const playlists = await listPlaylistsForAdmin();
  res.status(200).json({ playlists });
});

adminRouter.put('/playlist-catalog/:playlistId', async (req, res) => {
  const playlistId = Number(req.params.playlistId);
  if (!Number.isInteger(playlistId)) {
    res.status(400).json({ error: 'invalid playlist id' });
    return;
  }
  const displayNameRaw = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  const adminDescriptionRaw = typeof req.body?.adminDescription === 'string' ? req.body.adminDescription.trim() : '';
  const ok = await updatePlaylistOverrides(playlistId, displayNameRaw || null, adminDescriptionRaw || null);
  if (!ok) {
    res.status(404).json({ error: 'playlist not found' });
    return;
  }
  res.status(200).json({ ok: true });
});

// ?q= scopes the search to the backend instead of the admin page fetching
// every song_ref row (a real library is ~8000 tracks) just to filter/slice
// it client-side - see AdminPage.tsx's SongsSection. ?playlistId= further
// scopes to one Adolar playlist via adolar_playlist_track; without it, no
// query returns the 20 most recently added songs, and a query without a
// playlist searches the whole pool (used by the Playlist-Suche section's
// InlineTrackCorrection, which has no playlist context of its own).
adminRouter.get('/songs', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const playlistIdRaw = typeof req.query.playlistId === 'string' ? req.query.playlistId.trim() : '';
  const playlistId = playlistIdRaw ? Number(playlistIdRaw) : null;
  const limit = q ? 50 : 20;

  let result;
  if (playlistId !== null) {
    result = q
      ? await pool.query(
          `SELECT sr.id, sr.source, sr.title, sr.artist, sr.year_value, sr.duration_sec, sr.is_valid, sr.year_override
           FROM song_ref sr
           JOIN adolar_playlist_track apt ON apt.song_ref_id = sr.id
           WHERE apt.playlist_id = $1 AND (sr.title ILIKE $2 OR sr.artist ILIKE $2)
           ORDER BY sr.title LIMIT $3`,
          [playlistId, `%${q}%`, limit],
        )
      : await pool.query(
          `SELECT sr.id, sr.source, sr.title, sr.artist, sr.year_value, sr.duration_sec, sr.is_valid, sr.year_override
           FROM song_ref sr
           JOIN adolar_playlist_track apt ON apt.song_ref_id = sr.id
           WHERE apt.playlist_id = $1
           ORDER BY sr.title LIMIT $2`,
          [playlistId, limit],
        );
  } else {
    result = q
      ? await pool.query(
          `SELECT id, source, title, artist, year_value, duration_sec, is_valid, year_override
           FROM song_ref WHERE title ILIKE $1 OR artist ILIKE $1
           ORDER BY title LIMIT $2`,
          [`%${q}%`, limit],
        )
      : await pool.query(
          `SELECT id, source, title, artist, year_value, duration_sec, is_valid, year_override
           FROM song_ref ORDER BY created_at DESC LIMIT $1`,
          [limit],
        );
  }

  res.status(200).json({
    songs: result.rows.map((row) => ({
      songId: row.id,
      source: row.source,
      title: row.title,
      artist: row.artist,
      year: row.year_value,
      durationSec: row.duration_sec,
      isValid: row.is_valid,
      yearOverride: row.year_override,
    })),
  });
});

// Manual year correction (see the Song-Pool search dialog in AdminPage.tsx)
// for a song whose year is still wrong despite the Adolar original_year
// fix - sets year_override so the next Adolar sync leaves it alone
// (upsertSongRefTrack in adolarBatch.ts respects this flag).
adminRouter.put('/songs/:songId/year', async (req, res) => {
  const { songId } = req.params;
  const { year } = req.body ?? {};
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    res.status(400).json({ error: 'year must be an integer between 1900 and 2100' });
    return;
  }
  const result = await pool.query(
    `UPDATE song_ref SET year_value = $1, year_override = TRUE WHERE id = $2
     RETURNING id, title, artist, year_value, year_override`,
    [year, songId],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'song not found' });
    return;
  }
  res.status(200).json({
    songId: result.rows[0].id,
    title: result.rows[0].title,
    artist: result.rows[0].artist,
    year: result.rows[0].year_value,
    yearOverride: result.rows[0].year_override,
  });
});

// Every table, admin-visible regardless of visibility/state - flags
// anything untouched for ADMIN_INACTIVE_MS as "inactive" well before the
// much longer INACTIVITY_DELETE_MS auto-delete threshold actually kicks in
// (see tableCleanup.ts), purely so an admin can see what's about to be
// swept without waiting for it to actually happen.
adminRouter.get('/tables', async (_req, res) => {
  const result = await pool.query(
    `SELECT
        t.id, t.name, t.visibility, t.state, t.created_at, t.last_activity_at,
        u.username AS owner_username,
        COUNT(*) FILTER (WHERE s.seat_type = 'player' AND s.left_at IS NULL) AS active_players,
        COUNT(*) FILTER (WHERE s.seat_type = 'spectator' AND s.left_at IS NULL) AS active_spectators,
        (t.last_activity_at <= NOW() - ($1 || ' milliseconds')::interval) AS inactive
     FROM game_table t
     JOIN app_user u ON u.id = t.owner_user_id
     LEFT JOIN table_seat s ON s.table_id = t.id
     GROUP BY t.id, u.username
     ORDER BY t.created_at DESC`,
    [ADMIN_INACTIVE_MS],
  );

  res.status(200).json({
    tables: result.rows.map((row) => ({
      tableId: row.id,
      name: row.name,
      visibility: row.visibility,
      state: row.state,
      ownerUsername: row.owner_username,
      activePlayers: Number(row.active_players),
      activeSpectators: Number(row.active_spectators),
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      inactive: row.inactive,
    })),
  });
});

// Playlist-Tracking (Fehleranalyse): Nachschlagen einer gespielten Playlist
// per Playlist-ID. game_table/game koennen zu diesem Zeitpunkt schon hart
// geloescht sein (siehe tableCleanup.ts) - table_id/table_name sind deshalb
// als Snapshot in game_playlist selbst gespeichert, kein JOIN noetig.
adminRouter.get('/playlists/:playlistId', async (req, res) => {
  const { playlistId } = req.params;

  const playlistResult = await pool.query(
    `SELECT id, table_id, table_name, game_id, created_at, expires_at
     FROM game_playlist WHERE id = $1`,
    [playlistId],
  );
  if (playlistResult.rowCount === 0) {
    res.status(404).json({ error: 'playlist not found' });
    return;
  }
  const playlist = playlistResult.rows[0];

  const tracksResult = await pool.query(
    `SELECT id, position, song_ref_id, title, artist, year_value
     FROM game_playlist_track WHERE playlist_id = $1 ORDER BY position ASC`,
    [playlistId],
  );

  res.status(200).json({
    playlistId: playlist.id,
    tableId: playlist.table_id,
    tableName: playlist.table_name,
    gameId: playlist.game_id,
    createdAt: playlist.created_at,
    expiresAt: playlist.expires_at,
    tracks: tracksResult.rows.map((row) => ({
      trackId: row.id,
      position: row.position,
      songId: row.song_ref_id,
      title: row.title,
      artist: row.artist,
      year: row.year_value,
    })),
  });
});

// Korrektur eines falsch erkannten Tracks in einer gespeicherten Playlist -
// verweist auf einen anderen song_ref (ausgewaehlt ueber die bestehende
// Song-Suche, GET /admin/songs) und uebernimmt dessen title/artist/year als
// neuen Snapshot.
adminRouter.put('/playlists/:playlistId/tracks/:trackId', async (req, res) => {
  const { playlistId, trackId } = req.params;
  const { songId } = req.body ?? {};
  if (typeof songId !== 'string') {
    res.status(400).json({ error: 'songId is required' });
    return;
  }

  const songResult = await pool.query(
    `SELECT id, title, artist, year_value FROM song_ref WHERE id = $1`,
    [songId],
  );
  if (songResult.rowCount === 0) {
    res.status(404).json({ error: 'song not found' });
    return;
  }
  const song = songResult.rows[0];

  const result = await pool.query(
    `UPDATE game_playlist_track
     SET song_ref_id = $1, title = $2, artist = $3, year_value = $4
     WHERE id = $5 AND playlist_id = $6
     RETURNING id, position, song_ref_id, title, artist, year_value`,
    [song.id, song.title, song.artist, song.year_value, trackId, playlistId],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'playlist track not found' });
    return;
  }

  res.status(200).json({
    trackId: result.rows[0].id,
    position: result.rows[0].position,
    songId: result.rows[0].song_ref_id,
    title: result.rows[0].title,
    artist: result.rows[0].artist,
    year: result.rows[0].year_value,
  });
});
