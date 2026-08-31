import { pool } from '../db/pool';

export interface AdolarPlaylistCatalogEntry {
  id: number;
  name: string;
  description: string | null;
  isDefaultPlaylist: boolean;
}

// Local mirror of Adolar's playlist list (see the adolar-playlist-catalog
// migration), kept current by syncAllAdolarPlaylists - the only place that
// still calls Adolar's /api/songster/playlists live. Table creation,
// session start, and the admin/table-creation playlist dropdowns all read
// this instead of hitting Adolar on every request; a playlist added or
// removed on the Adolar side only shows up here after the next sync.
// name is display_name (the admin override, see playlist-display-override
// migration) when set, falling back to the raw Adolar name - every caller
// that shows a playlist name to a player gets the override for free this
// way, without needing to know the override exists.
export async function listCatalogedPlaylists(): Promise<AdolarPlaylistCatalogEntry[]> {
  const result = await pool.query(
    `SELECT id, COALESCE(display_name, name) AS name, description, is_default_playlist
     FROM adolar_playlist
     ORDER BY is_default_playlist DESC, LOWER(COALESCE(display_name, name)) ASC, id ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isDefaultPlaylist: row.is_default_playlist,
  }));
}

export async function isPlaylistCataloged(playlistId: number): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM adolar_playlist WHERE id = $1`, [playlistId]);
  return (result.rowCount ?? 0) > 0;
}

export interface PlaylistBrowseEntry {
  id: number;
  name: string;
  description: string | null;
  isDefaultPlaylist: boolean;
}

// Feeds the "Songster PlayLists" lobby dialog - effective display name plus
// the admin-set description (never the raw Adolar description, which is
// sync-owned and not meant for players).
export async function listPlaylistsForBrowsing(): Promise<PlaylistBrowseEntry[]> {
  const result = await pool.query(
    `SELECT id, COALESCE(display_name, name) AS name, admin_description AS description, is_default_playlist
     FROM adolar_playlist
     ORDER BY is_default_playlist DESC, LOWER(COALESCE(display_name, name)) ASC, id ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isDefaultPlaylist: row.is_default_playlist,
  }));
}

export interface AdolarPlaylistAdminEntry {
  id: number;
  name: string;
  displayName: string | null;
  adminDescription: string | null;
  isDefaultPlaylist: boolean;
}

// Feeds the admin "Playlistadministration" dropdown - raw Adolar name plus
// whatever override is currently set, so the form can show both.
export async function listPlaylistsForAdmin(): Promise<AdolarPlaylistAdminEntry[]> {
  const result = await pool.query(
    `SELECT id, name, display_name, admin_description, is_default_playlist
     FROM adolar_playlist
     ORDER BY is_default_playlist DESC, LOWER(COALESCE(display_name, name)) ASC, id ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    adminDescription: row.admin_description,
    isDefaultPlaylist: row.is_default_playlist,
  }));
}

export async function updatePlaylistOverrides(
  playlistId: number,
  displayName: string | null,
  adminDescription: string | null,
  isDefaultPlaylist: boolean,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isDefaultPlaylist) {
      await client.query(`UPDATE adolar_playlist SET is_default_playlist = FALSE WHERE is_default_playlist IS TRUE AND id <> $1`, [
        playlistId,
      ]);
    }
    const result = await client.query(
      `UPDATE adolar_playlist
       SET display_name = $2, admin_description = $3, is_default_playlist = $4
       WHERE id = $1`,
      [playlistId, displayName, adminDescription, isDefaultPlaylist],
    );
    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
