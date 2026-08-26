import { pool } from '../db/pool';

export type ChatScope = 'lobby' | 'table';
export type CommunicationPhase = 'waiting' | 'countdown' | 'active' | 'finished';
export type ReactionId = 'hello' | 'like' | 'laugh' | 'think' | 'target' | 'technical';

export interface ChatMessage {
  id: string;
  scope: ChatScope;
  tableId: string | null;
  senderUserId: string;
  senderUsername: string;
  body: string;
  createdAt: string;
}

export const CHAT_MAX_LENGTH = 500;
export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_RETENTION_MINUTES = 30;
export const CHAT_RATE_LIMIT_PER_MINUTE = 12;

const REACTIONS_BY_PHASE: Record<CommunicationPhase, ReadonlySet<ReactionId>> = {
  waiting: new Set(['hello', 'like', 'laugh', 'target', 'technical']),
  countdown: new Set(['like', 'think', 'technical']),
  active: new Set(['like', 'think', 'technical']),
  finished: new Set(['like', 'laugh', 'target', 'technical']),
};

function mapMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    scope: row.scope as ChatScope,
    tableId: (row.table_id as string | null) ?? null,
    senderUserId: row.sender_user_id as string,
    senderUsername: row.sender_username as string,
    body: row.body as string,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

export function normalizeChatBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (body.length === 0 || body.length > CHAT_MAX_LENGTH) return null;
  return body;
}

export async function listChatMessages(scope: ChatScope, tableId: string | null): Promise<ChatMessage[]> {
  const result = await pool.query(
    `SELECT * FROM (
       SELECT m.id, m.scope, m.table_id, m.sender_user_id, u.username AS sender_username,
              m.body, m.created_at
       FROM chat_message m
       JOIN app_user u ON u.id = m.sender_user_id
       WHERE m.scope = $1
         AND m.table_id IS NOT DISTINCT FROM $2::uuid
         AND m.deleted_at IS NULL
         AND m.created_at >= NOW() - ($3 * INTERVAL '1 minute')
       ORDER BY m.created_at DESC
       LIMIT $4
     ) recent
     ORDER BY created_at ASC`,
    [scope, tableId, CHAT_RETENTION_MINUTES, CHAT_HISTORY_LIMIT],
  );
  return result.rows.map(mapMessage);
}

export async function createChatMessage(
  scope: ChatScope,
  tableId: string | null,
  senderUserId: string,
  body: string,
): Promise<{ ok: true; message: ChatMessage } | { ok: false; retryAfterSeconds: number }> {
  const recentResult = await pool.query(
    `SELECT COUNT(*)::int AS count,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
              MIN(created_at) + INTERVAL '1 minute' - NOW()
            ))))::int AS retry_after_seconds
     FROM chat_message
     WHERE sender_user_id = $1 AND created_at >= NOW() - INTERVAL '1 minute'`,
    [senderUserId],
  );
  if (recentResult.rows[0].count >= CHAT_RATE_LIMIT_PER_MINUTE) {
    return { ok: false, retryAfterSeconds: recentResult.rows[0].retry_after_seconds ?? 60 };
  }

  const result = await pool.query(
    `WITH inserted AS (
       INSERT INTO chat_message (scope, table_id, sender_user_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *
     )
     SELECT i.id, i.scope, i.table_id, i.sender_user_id, u.username AS sender_username,
            i.body, i.created_at
     FROM inserted i
     JOIN app_user u ON u.id = i.sender_user_id`,
    [scope, tableId, senderUserId, body],
  );
  return { ok: true, message: mapMessage(result.rows[0]) };
}

export async function deleteExpiredChatMessages(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM chat_message
     WHERE created_at < NOW() - ($1 * INTERVAL '1 minute')`,
    [CHAT_RETENTION_MINUTES],
  );
  return result.rowCount ?? 0;
}

export function isReactionId(value: unknown): value is ReactionId {
  return typeof value === 'string' && ['hello', 'like', 'laugh', 'think', 'target', 'technical'].includes(value);
}

export function isReactionAllowed(reactionId: ReactionId, phase: CommunicationPhase): boolean {
  return REACTIONS_BY_PHASE[phase].has(reactionId);
}

export async function loadCommunicationPhase(gameId: string): Promise<CommunicationPhase | null> {
  const result = await pool.query(
    `SELECT g.status AS game_status,
            (SELECT r.status FROM round r WHERE r.game_id = g.id ORDER BY r.index_no DESC LIMIT 1) AS round_status
     FROM game g
     WHERE g.id = $1`,
    [gameId],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.game_status === 'finished') return 'finished';
  if (row.round_status === 'countdown') return 'countdown';
  if (['playing', 'token_solo', 'token_others'].includes(row.round_status)) return 'active';
  return 'waiting';
}
