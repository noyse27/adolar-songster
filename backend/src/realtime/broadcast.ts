import { getIO, lobbyRoom, tableRoom, gameRoom } from './io';
import { fetchLobbyTables, loadTableDetail } from '../services/tableQueries';
import { loadGameState } from '../services/gameState';
import { BONUS_WINDOW_MS, COUNTDOWN_MS, SONG_DURATION_MS } from '../services/roundConfig';
import { ChatMessage } from '../services/communication';

/** Re-broadcasts the whole public/open table list. Table counts are small
 * (private-group scale, see FR-013), so a full refetch+broadcast on every
 * lobby-relevant mutation is simpler and safer than diffing individual
 * rows client-side. */
export async function broadcastLobby(): Promise<void> {
  const io = getIO();
  if (!io) return; // no live socket server (e.g. unit tests via supertest)
  const tables = await fetchLobbyTables();
  io.to(lobbyRoom()).emit('lobby:tables', { tables });
}

/** Re-broadcasts one table's detail (seats, state, latest game) to
 * everyone currently viewing that table's room. */
export async function broadcastTable(tableId: string): Promise<void> {
  const io = getIO();
  if (!io) return;
  const detail = await loadTableDetail(tableId);
  if (!detail) return;
  io.to(tableRoom(tableId)).emit('table:update', detail);
}

/** Re-broadcasts full game state (players, timelines, current round) to
 * everyone in that game's room. Called after every round-lifecycle
 * transition in roundEngine.ts, including the ones that fire from a
 * setTimeout rather than a request (e.g. countdown -> playing), which
 * otherwise have no way to tell a connected client anything changed. */
export async function broadcastGame(gameId: string): Promise<void> {
  const io = getIO();
  if (!io) return;
  const state = await loadGameState(gameId, COUNTDOWN_MS, SONG_DURATION_MS, BONUS_WINDOW_MS);
  if (!state) return;
  io.to(gameRoom(gameId)).emit('game:update', state);
}

/** Chat is persisted through REST, then fanned out through the same rooms
 * clients already authorize and subscribe to for lobby/table updates. */
export function emitChatMessage(message: ChatMessage): void {
  const io = getIO();
  if (!io) return;
  const room = message.scope === 'lobby' ? lobbyRoom() : tableRoom(message.tableId as string);
  io.to(room).emit('chat:message', message);
}
