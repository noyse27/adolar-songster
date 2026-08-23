import { Router } from 'express';
import { Readable } from 'stream';
import { pool } from '../db/pool';
import { AdolarClientError, fetchTrackStreamResponse } from '../services/adolarClient';

export const songsRouter = Router();

// Proxies audio playback for a song_ref through Songster's own backend, so
// the browser only ever talks to Songster's origin - no CORS/mixed-content
// issues from linking straight to a LAN Adolar instance, and Adolar's
// Bearer API token (which must stay server-side) never reaches the client.
// See adolarClient.ts's fetchTrackStreamResponse and musicapp's
// GET /api/songster/tracks/:id/stream. 'local' (admin-seeded) songs use
// their stream_ref URL directly instead, if one was set when they were
// added via POST /admin/songs.
//
// Deliberately NOT behind requireAuth: a plain <audio src> can't attach an
// Authorization header, and adding a signed short-lived stream token was
// judged not worth the complexity for a private, invite-only game - the
// URL only carries an unguessable song_ref UUID (never title/artist/year),
// same exposure as Adolar's own equally-unauthenticated /api/stream/<id>
// that this proxies through to.
songsRouter.get('/songs/:songRefId/stream', async (req, res) => {
  const { songRefId } = req.params;
  const result = await pool.query(`SELECT source, source_song_id, stream_ref FROM song_ref WHERE id = $1`, [
    songRefId,
  ]);
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'song not found' });
    return;
  }
  const song = result.rows[0];

  if (song.source !== 'adolar') {
    if (!song.stream_ref) {
      res.status(404).json({ error: 'no playable audio for this song' });
      return;
    }
    res.redirect(302, song.stream_ref);
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetchTrackStreamResponse(Number(song.source_song_id), req.headers.range);
  } catch (err) {
    if (err instanceof AdolarClientError) {
      res.status(502).json({ error: 'stream unavailable' });
      return;
    }
    throw err;
  }

  if (!upstream.ok) {
    res.status(upstream.status === 404 ? 404 : 502).json({ error: 'stream unavailable' });
    return;
  }

  res.status(upstream.status);
  ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].forEach((header) => {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  });

  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body as import('stream/web').ReadableStream<Uint8Array>).pipe(res);
});
