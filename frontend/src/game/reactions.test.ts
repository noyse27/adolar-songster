import { describe, expect, it } from 'vitest';
import { communicationPhase, REACTIONS } from './reactions';
import { GameState } from './types';

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'game',
    tableId: 'table',
    playlistId: 'playlist',
    status: 'active',
    winnerUserId: null,
    matchEndedAt: null,
    matchCloseWindowMs: 30_000,
    players: [],
    currentRound: null,
    roundReadyPhase: null,
    autoReadyUserIds: [],
    displayAnchorPresent: false,
    ...overrides,
  };
}

describe('Playboard reactions', () => {
  it('derives waiting and finished phases from game state', () => {
    expect(communicationPhase(state())).toBe('waiting');
    expect(communicationPhase(state({ status: 'finished' }))).toBe('finished');
  });

  it('offers quiet choices while a song is active', () => {
    const activeIds = REACTIONS.filter((reaction) => reaction.phases.includes('active')).map((reaction) => reaction.id);
    expect(activeIds).toEqual(['like', 'think', 'technical']);
    expect(activeIds).not.toContain('laugh');
    expect(activeIds).not.toContain('hello');
  });
});
