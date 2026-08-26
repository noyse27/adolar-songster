import { pool } from '../db/pool';

export interface AdolarPlaylistCatalogEntry {
  id: number;
  name: string;
  description: string | null;
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
    `SELECT id, COALESCE(display_name, name) AS name, description
     FROM adolar_playlist ORDER BY COALESCE(display_name, name)`,
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, description: row.description }));
}

export async function isPlaylistCataloged(playlistId: number): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM adolar_playlist WHERE id = $1`, [playlistId]);
  return (result.rowCount ?? 0) > 0;
}

export interface PlaylistBrowseEntry {
  id: number;
  name: string;
  description: string | null;
}

// Feeds the "Songster PlayLists" lobby dialog - effective display name plus
// the admin-set description (never the raw Adolar description, which is
// sync-owned and not meant for players).
export async function listPlaylistsForBrowsing(): Promise<PlaylistBrowseEntry[]> {
  const result = await pool.query(
    `SELECT id, COALESCE(display_name, name) AS name, admin_description AS description
     FROM adolar_playlist ORDER BY COALESCE(display_name, name)`,
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, description: row.description }));
}

export interface AdolarPlaylistAdminEntry {
  id: number;
  name: string;
  displayName: string | null;
  adminDescription: string | null;
}

// Feeds the admin "Playlistadministration" dropdown - raw Adolar name plus
// whatever override is currently set, so the form can show both.
export async function listPlaylistsForAdmin(): Promise<AdolarPlaylistAdminEntry[]> {
  const result = await pool.query(
    `SELECT id, name, display_name, admin_description FROM adolar_playlist ORDER BY name`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    adminDescription: row.admin_description,
  }));
}

export async function updatePlaylistOverrides(
  playlistId: number,
  displayName: string | null,
  adminDescription: string | null,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE adolar_playlist SET display_name = $2, admin_description = $3 WHERE id = $1`,
    [playlistId, displayName, adminDescription],
  );
  return (result.rowCount ?? 0) > 0;
}
