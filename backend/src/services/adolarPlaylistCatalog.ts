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
export async function listCatalogedPlaylists(): Promise<AdolarPlaylistCatalogEntry[]> {
  const result = await pool.query(`SELECT id, name, description FROM adolar_playlist ORDER BY name`);
  return result.rows.map((row) => ({ id: row.id, name: row.name, description: row.description }));
}

export async function isPlaylistCataloged(playlistId: number): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM adolar_playlist WHERE id = $1`, [playlistId]);
  return (result.rowCount ?? 0) > 0;
}
