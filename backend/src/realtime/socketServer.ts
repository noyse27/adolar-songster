import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth';
import { pool } from '../db/pool';
import { setIO, tableRoom, lobbyRoom, gameRoom } from './io';

interface AuthedSocketData {
  userId: string;
  userRole: string;
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
    let payload: { sub: string; role: string; sessionVersion: number };
    try {
      payload = jwt.verify(token, JWT_SECRET) as { sub: string; role: string; sessionVersion: number };
    } catch {
      next(new Error('invalid or expired token'));
      return;
    }

    // Mirrors middleware/auth.ts's requireAuth: a token superseded by a
    // newer login elsewhere (single-active-session) should fail a fresh
    // handshake the same way an expired token would - this only stops a
    // *new* connection/reconnect from a stale token though, it doesn't
    // reach into an already-open socket from the old session.
    pool
      .query(`SELECT session_version FROM app_user WHERE id = $1`, [payload.sub])
      .then((result) => {
        if (result.rowCount === 0 || result.rows[0].session_version !== payload.sessionVersion) {
          next(new Error('invalid or expired token'));
          return;
        }
        (socket.data as AuthedSocketData).userId = payload.sub;
        (socket.data as AuthedSocketData).userRole = payload.role;
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
  });

  setIO(io);
  return io;
}
