import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth';
import { verifyDisplayToken } from '../services/displayToken';
import { pool } from '../db/pool';
import { setIO, tableRoom, lobbyRoom, gameRoom } from './io';
import { broadcastGame } from './broadcast';

interface AuthedSocketData {
  userId: string;
  userRole: string;
}

interface DisplaySocketData {
  displayTableId: string;
}

async function setDisplayConnected(tableId: string, connected: boolean): Promise<void> {
  await pool.query(`UPDATE game_table SET display_connected_at = $1 WHERE id = $2`, [
    connected ? new Date() : null,
    tableId,
  ]);

  // The flag only matters to clients already looking at a live game (see
  // LiveGameBoard's compact-mode branch) - table-room-only viewers don't
  // need it, so re-broadcasting the table's current game is enough.
  const gameResult = await pool.query(
    `SELECT id FROM game WHERE table_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [tableId],
  );
  const gameId = gameResult.rows[0]?.id as string | undefined;
  if (gameId) await broadcastGame(gameId);
}

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('missing auth token'));
      return;
    }

    // Hostmodus (gemeinsames Anzeigegerät): a display-token socket is
    // deliberately not an app_user session at all (see displayToken.ts) -
    // verify it on its own terms and skip the app_user/session_version
    // lookup below entirely, so it can never collide with (or be knocked
    // out by) a real player's login on their own phone.
    const display = verifyDisplayToken(token);
    if (display) {
      (socket.data as DisplaySocketData).displayTableId = display.tableId;
      next();
      return;
    }

    let payload: { sub: string; sessionVersion: number };
    try {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string; sessionVersion: number };
    } catch {
      next(new Error('invalid or expired token'));
      return;
    }

    // Mirrors middleware/auth.ts's requireAuth: a token superseded by a
    // newer login elsewhere (single-active-session) should fail a fresh
    // handshake the same way an expired token would - this only stops a
    // *new* connection/reconnect from a stale token though, it doesn't
    // reach into an already-open socket from the old session. The role is
    // loaded from the DB rather than trusted from the token payload, same
    // reasoning as requireAuth.
    pool
      .query(`SELECT session_version, role FROM app_user WHERE id = $1`, [payload.sub])
      .then((result) => {
        if (result.rowCount === 0 || result.rows[0].session_version !== payload.sessionVersion) {
          next(new Error('invalid or expired token'));
          return;
        }
        (socket.data as AuthedSocketData).userId = payload.sub;
        (socket.data as AuthedSocketData).userRole = result.rows[0].role;
        next();
      })
      .catch(() => next(new Error('invalid or expired token')));
  });

  io.on('connection', (socket: Socket) => {
    // Lobby list and per-table detail are opt-in subscriptions rather than
    // every client always receiving both - a client deep in a game
    // shouldn't also get every public lobby table update.
    socket.on('lobby:join', () => socket.join(lobbyRoom()));
    socket.on('lobby:leave', () => socket.leave(lobbyRoom()));
    socket.on('table:join-room', (tableId: unknown) => {
      if (typeof tableId === 'string') socket.join(tableRoom(tableId));
    });
    socket.on('table:leave-room', (tableId: unknown) => {
      if (typeof tableId === 'string') socket.leave(tableRoom(tableId));
    });
    socket.on('game:join-room', (gameId: unknown) => {
      if (typeof gameId === 'string') socket.join(gameRoom(gameId));
    });
    socket.on('game:leave-room', (gameId: unknown) => {
      if (typeof gameId === 'string') socket.leave(gameRoom(gameId));
    });

    // Hostmodus: a display socket's mere presence is the whole signal
    // (see gameState.ts's displayAnchorPresent) - no seat, no room-join
    // needed to track it, just flip the table's flag for as long as this
    // one connection lives.
    const displayTableId = (socket.data as Partial<DisplaySocketData>).displayTableId;
    if (displayTableId) {
      setDisplayConnected(displayTableId, true);
      socket.on('disconnect', () => setDisplayConnected(displayTableId, false));
    }
  });

  setIO(io);
  return io;
}
