import { Router } from 'express';
import { Readable } from 'stream';
import { pool } from '../db/pool';
import { AdolarClientError, fetchTrackStreamResponse } from '../services/adolarClient';
import { logBetaDebug, storeGameEvent } from '../services/debugLogging';
import { RequestWithId } from '../middleware/requestId';

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
songsRouter.get('/songs/:songRefId/stream', async (req: RequestWithId, res) => {
  const { songRefId } = req.params;
  const startedAt = Date.now();
  const rangeHeader = Array.isArray(req.headers.range) ? req.headers.range[0] : req.headers.range;
  const result = await pool.query(`SELECT source, source_song_id, stream_ref FROM song_ref WHERE id = $1`, [songRefId]);
  if (result.rowCount === 0) {
    logBetaDebug('audio_stream_song_missing', { songRefId, requestId: req.requestId });
    res.status(404).json({ error: 'song not found' });
    return;
  }
  const song = result.rows[0];

  const roundResult = await pool.query(
    `SELECT r.id, r.game_id, r.index_no, g.table_id
     FROM round r
     JOIN game g ON g.id = r.game_id
     WHERE r.song_id = $1
     ORDER BY r.started_at DESC
     LIMIT 1`,
    [songRefId],
  );
  const latestRound = roundResult.rows[0];

  function logStreamOutcome(eventType: string, extra: Record<string, unknown> = {}): void {
    const payload = {
      songRefId,
      source: song.source,
      sourceSongId: song.source_song_id,
      hasRange: Boolean(rangeHeader),
      rangeHeader: rangeHeader ?? null,
      elapsedMs: Date.now() - startedAt,
      requestId: req.requestId,
      ...extra,
    };
    logBetaDebug(eventType, payload);
    void storeGameEvent({
      eventType,
      tableId: latestRound?.table_id ?? null,
      gameId: latestRound?.game_id ?? null,
      roundId: latestRound?.id ?? null,
      roundIndex: latestRound?.index_no ?? null,
      requestId: req.requestId,
      payload,
    });
  }

  if (song.source !== 'adolar') {
    if (!song.stream_ref) {
      logStreamOutcome('audio_stream_local_missing_ref');
      res.status(404).json({ error: 'no playable audio for this song' });
      return;
    }
    logStreamOutcome('audio_stream_local_redirect', { status: 302 });
    res.redirect(302, song.stream_ref);
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetchTrackStreamResponse(Number(song.source_song_id), rangeHeader);
  } catch (err) {
    if (err instanceof AdolarClientError) {
      logStreamOutcome('audio_stream_upstream_error', { code: err.code, message: err.message });
      res.status(502).json({ error: 'stream unavailable' });
      return;
    }
    throw err;
  }

  if (!upstream.ok) {
    logStreamOutcome('audio_stream_upstream_bad_status', { upstreamStatus: upstream.status });
    res.status(upstream.status === 404 ? 404 : 502).json({ error: 'stream unavailable' });
    return;
  }

  res.status(upstream.status);
  ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].forEach((header) => {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  });
  logStreamOutcome('audio_stream_proxy_start', {
    upstreamStatus: upstream.status,
    contentType: upstream.headers.get('content-type'),
    contentLength: upstream.headers.get('content-length'),
    contentRange: upstream.headers.get('content-range'),
  });

  res.on('close', () => {
    logStreamOutcome('audio_stream_response_close', {
      writableEnded: res.writableEnded,
      statusCode: res.statusCode,
    });
  });

  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body as import('stream/web').ReadableStream<Uint8Array>).pipe(res);
});
