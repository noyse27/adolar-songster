import { GameState } from './types';

export type CommunicationPhase = 'waiting' | 'countdown' | 'active' | 'finished';
export type ReactionId = 'hello' | 'like' | 'laugh' | 'think' | 'target' | 'technical';

export interface ReactionDefinition {
  id: ReactionId;
  emoji: string;
  label: string;
  phases: CommunicationPhase[];
}

export interface GameReactionEvent {
  gameId: string;
  userId: string;
  username: string;
  reactionId: ReactionId;
  phase: CommunicationPhase;
  sentAt: string;
}

export const REACTIONS: ReactionDefinition[] = [
  { id: 'hello', emoji: '👋', label: 'Hallo', phases: ['waiting'] },
  { id: 'like', emoji: '👍', label: 'Stark', phases: ['waiting', 'countdown', 'active', 'finished'] },
  { id: 'laugh', emoji: '😂', label: 'Lustig', phases: ['waiting', 'finished'] },
  { id: 'think', emoji: '🤔', label: 'Keine Ahnung', phases: ['countdown', 'active'] },
  { id: 'target', emoji: '🎯', label: 'Guter Tipp', phases: ['waiting', 'finished'] },
  { id: 'technical', emoji: '⚠️', label: 'Technikproblem', phases: ['waiting', 'countdown', 'active', 'finished'] },
];

export function communicationPhase(state: GameState): CommunicationPhase {
  if (state.status === 'finished') return 'finished';
  const status = state.currentRound?.status;
  if (status === 'countdown') return 'countdown';
  if (status === 'playing' || status === 'token_solo' || status === 'token_others') return 'active';
  return 'waiting';
}

export function reactionDefinition(reactionId: ReactionId): ReactionDefinition | undefined {
  return REACTIONS.find((reaction) => reaction.id === reactionId);
}
