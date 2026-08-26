import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth';
import { verifyDisplayToken } from '../services/displayToken';
import { pool } from '../db/pool';
import { setIO, tableRoom, lobbyRoom, gameRoom } from './io';
import { broadcastGame } from './broadcast';
import { loadActiveSeat, authorizeDisplayGame, authorizeGameViewer } from '../services/tableAuthorization';
import { isReactionAllowed, isReactionId, loadCommunicationPhase } from '../services/communication';

type RoomJoinAck = (result: { ok: boolean; error?: string }) => void;
type ReactionAck = (result: { ok: boolean; error?: string }) => void;

const REACTION_COOLDOWN_MS = 1000;

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

  // H-02: a table/game room broadcasts that table's full detail / full game
  // state (joinCode, seats, timelines, ...) to everyone in it, so joining
  // one is exactly as sensitive as GET /tables/:tableId or GET
  // /games/:gameId now are - same rule, same source of truth: an active
  // seat at the table for a normal user, or the display's own bound
  // tableId for a display socket. Neither ever trusts the client-supplied
  // id alone.
  async function canJoinTableRoom(socket: Socket, tableId: string): Promise<boolean> {
    const displayTableId = (socket.data as Partial<DisplaySocketData>).displayTableId;
    if (displayTableId) return displayTableId === tableId;

    const userId = (socket.data as Partial<AuthedSocketData>).userId;
    if (!userId) return false;
    return (await loadActiveSeat(tableId, userId)) !== null;
  }

  async function canJoinGameRoom(socket: Socket, gameId: string): Promise<boolean> {
    const displayTableId = (socket.data as Partial<DisplaySocketData>).displayTableId;
    if (displayTableId) return authorizeDisplayGame(displayTableId, gameId);

    const userId = (socket.data as Partial<AuthedSocketData>).userId;
    if (!userId) return false;
    const gameResult = await pool.query(`SELECT table_id FROM game WHERE id = $1`, [gameId]);
    const tableId = gameResult.rows[0]?.table_id as string | undefined;
    if (!tableId) return false;
    return (await loadActiveSeat(tableId, userId)) !== null;
  }

  io.on('connection', (socket: Socket) => {
    let lastReactionAt = 0;
    // Lobby list and per-table detail are opt-in subscriptions rather than
    // every client always receiving both - a client deep in a game
    // shouldn't also get every public lobby table update. The lobby room
    // itself only ever broadcasts public/open tables (see broadcast.ts), so
    // it stays open to any authenticated socket.
    socket.on('lobby:join', () => socket.join(lobbyRoom()));
    socket.on('lobby:leave', () => socket.leave(lobbyRoom()));
    socket.on('table:join-room', (tableId: unknown, ack?: RoomJoinAck) => {
      if (typeof tableId !== 'string') {
        ack?.({ ok: false, error: 'invalid tableId' });
        return;
      }
      canJoinTableRoom(socket, tableId)
        .then((allowed) => {
          if (!allowed) {
            ack?.({ ok: false, error: 'forbidden' });
            return;
          }
          socket.join(tableRoom(tableId));
          ack?.({ ok: true });
        })
        .catch(() => ack?.({ ok: false, error: 'internal error' }));
    });
    socket.on('table:leave-room', (tableId: unknown) => {
      if (typeof tableId === 'string') socket.leave(tableRoom(tableId));
    });
    socket.on('game:join-room', (gameId: unknown, ack?: RoomJoinAck) => {
      if (typeof gameId !== 'string') {
        ack?.({ ok: false, error: 'invalid gameId' });
        return;
      }
      canJoinGameRoom(socket, gameId)
        .then((allowed) => {
          if (!allowed) {
            ack?.({ ok: false, error: 'forbidden' });
            return;
          }
          socket.join(gameRoom(gameId));
          ack?.({ ok: true });
        })
        .catch(() => ack?.({ ok: false, error: 'internal error' }));
    });
    socket.on('game:leave-room', (gameId: unknown) => {
      if (typeof gameId === 'string') socket.leave(gameRoom(gameId));
    });

    // Reactions are deliberately ephemeral: validate sender, current game
    // phase and a per-connection cooldown, then broadcast only to the
    // authorized game room. A display token can receive these events after
    // joining the room, but never has a userId and therefore cannot send.
    socket.on('game:reaction', (payload: unknown, ack?: ReactionAck) => {
      (async () => {
        if (!payload || typeof payload !== 'object') {
          ack?.({ ok: false, error: 'invalid payload' });
          return;
        }
        const { gameId, reactionId } = payload as { gameId?: unknown; reactionId?: unknown };
        if (typeof gameId !== 'string' || !isReactionId(reactionId)) {
          ack?.({ ok: false, error: 'invalid payload' });
          return;
        }

        const userId = (socket.data as Partial<AuthedSocketData>).userId;
        if (!userId) {
          ack?.({ ok: false, error: 'forbidden' });
          return;
        }
        const access = await authorizeGameViewer(gameId, userId);
        if (!access || access.seatType !== 'player') {
          ack?.({ ok: false, error: 'forbidden' });
          return;
        }

        const now = Date.now();
        if (now - lastReactionAt < REACTION_COOLDOWN_MS) {
          ack?.({ ok: false, error: 'reaction rate limited' });
          return;
        }
        const phase = await loadCommunicationPhase(gameId);
        if (!phase || !isReactionAllowed(reactionId, phase)) {
          ack?.({ ok: false, error: 'reaction not available in this phase' });
          return;
        }

        const userResult = await pool.query(`SELECT username FROM app_user WHERE id = $1`, [userId]);
        const username = userResult.rows[0]?.username as string | undefined;
        if (!username) {
          ack?.({ ok: false, error: 'forbidden' });
          return;
        }

        lastReactionAt = now;
        io.to(gameRoom(gameId)).emit('game:reaction', {
          gameId,
          userId,
          username,
          reactionId,
          phase,
          sentAt: new Date(now).toISOString(),
        });
        ack?.({ ok: true });
      })().catch(() => ack?.({ ok: false, error: 'internal error' }));
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
