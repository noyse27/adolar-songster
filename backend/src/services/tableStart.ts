import { pool } from '../db/pool';
import { computeYearRange, generateStartBlocks } from './timeline';
import { isAdolarConfigured } from './adolarClient';
import { isPlaylistCataloged } from './adolarPlaylistCatalog';
import { loadAdolarBatch } from './adolarBatch';
import { RoundEngineError } from './errors';

export type TableStartOutcome =
  | { ok: true; tableSessionId: string; gameId: string }
  | { ok: false; status: number; code: string; message: string };

/**
 * Shared by the table-admin's manual POST /tables/:id/start and the
 * automatic start triggered from POST /tables/:id/ready once every seated
 * player is ready (see tables.ts). Both require the same preconditions -
 * table still open, >=2 active players, everyone seated ready - the only
 * difference is *who* is allowed to call this early (only the admin, via
 * the route's own auth check) vs. the automatic path, which only ever
 * fires once the readiness condition is already satisfied for everyone.
 */
export async function startTableGame(tableId: string): Promise<TableStartOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tableResult = await client.query(
      `SELECT id, name, state, source_playlist_id FROM game_table WHERE id = $1 FOR UPDATE`,
      [tableId],
    );
    if (tableResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, code: 'TABLE_NOT_FOUND', message: 'table not found' };
    }
    const table = tableResult.rows[0];
    if (table.state !== 'open') {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, code: 'TABLE_NOT_OPEN', message: 'table is not open' };
    }

    const seatsResult = await client.query(
      `SELECT user_id, ready FROM table_seat
       WHERE table_id = $1 AND seat_type = 'player' AND left_at IS NULL`,
      [tableId],
    );
    const activePlayerIds: string[] = seatsResult.rows.map((row) => row.user_id);
    if (activePlayerIds.length < 2) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        code: 'NOT_ENOUGH_PLAYERS',
        message: 'at least 2 active players are required to start',
      };
    }
    if (seatsResult.rows.some((row) => !row.ready)) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        code: 'NOT_ALL_PLAYERS_READY',
        message: 'not every seated player has marked themselves ready yet',
      };
    }

    // Section 4.3: the fixed 50-song batch is drawn once, here, at session
    // start - re-checking availability rather than trusting the check done
    // at table creation, since the playlist could have been deactivated on
    // the Adolar side in the meantime. Both checks are local-only (the
    // adolar_playlist catalog, kept current by syncAllAdolarPlaylists) -
    // Adolar itself is only ever contacted live during that sync and for
    // actual track streaming, never on this request path. That means a
    // playlist removed on the Adolar side is only caught here once the next
    // sync has run and dropped it from the catalog, not the instant it
    // disappears upstream.
    let adolarBatchSongRefIds: string[] | null = null;
    if (table.source_playlist_id !== null) {
      if (!(await isAdolarConfigured())) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          status: 502,
          code: 'NOT_CONFIGURED',
          message: 'Adolar is not configured',
        };
      }
      const available = await isPlaylistCataloged(table.source_playlist_id);
      if (!available) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          status: 409,
          code: 'ADOLAR_PLAYLIST_UNAVAILABLE',
          message: 'the selected Adolar playlist is no longer available',
        };
      }
      try {
        adolarBatchSongRefIds = await loadAdolarBatch(client, table.source_playlist_id);
      } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof RoundEngineError) {
          return { ok: false, status: 409, code: err.code, message: err.message };
        }
        throw err;
      }
    }

    const sessionResult = await client.query(
      `INSERT INTO table_session (table_id) VALUES ($1) RETURNING id`,
      [tableId],
    );
    const tableSessionId = sessionResult.rows[0].id;

    if (adolarBatchSongRefIds) {
      for (const songRefId of adolarBatchSongRefIds) {
        await client.query(
          `INSERT INTO table_session_song_pool (table_session_id, song_ref_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [tableSessionId, songRefId],
        );
      }
    }

    const range = await computeYearRange(client, tableSessionId);
    if (!range) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        code: 'SONG_METADATA_INVALID',
        message: 'no valid songs in the playlist yet',
      };
    }

    const gameResult = await client.query(
      `INSERT INTO game (table_id, table_session_id, status, started_at)
       VALUES ($1, $2, 'active', NOW())
       RETURNING id`,
      [tableId, tableSessionId],
    );
    await generateStartBlocks(client, gameResult.rows[0].id, activePlayerIds, tableSessionId);
    await client.query(`UPDATE game_table SET state = 'running' WHERE id = $1`, [tableId]);

    // Playlist-Tracking (Fehleranalyse): eine eigene, nicht erratbare
    // Playlist-ID pro Partie, denormalisiert von game_table/game losgeloest
    // (siehe Migration game-playlist-tracking) - ueberlebt deren Hard-Delete
    // nach ~1h Inaktivitaet und wird erst nach 1 Woche automatisch geloescht
    // (siehe playlistCleanup.ts).
    await client.query(
      `INSERT INTO game_playlist (table_id, table_name, game_id) VALUES ($1, $2, $3)`,
      [tableId, table.name, gameResult.rows[0].id],
    );

    await client.query('COMMIT');
    return { ok: true, tableSessionId, gameId: gameResult.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
