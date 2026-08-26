import { apiFetch } from '../api';
import { GameState } from './types';

export function fetchGameState(gameId: string, token: string): Promise<GameState> {
  return apiFetch<GameState>(`/games/${gameId}/state`, { token });
}

export function setRoundReady(gameId: string, token: string, ready = true): Promise<{ accepted: true }> {
  return apiFetch(`/games/${gameId}/ready`, { method: 'POST', body: { ready }, token });
}

export function setAutoReady(gameId: string, token: string, autoReady: boolean): Promise<{ accepted: true }> {
  return apiFetch(`/games/${gameId}/ready/auto`, { method: 'POST', body: { autoReady }, token });
}

export function submitPositionGuess(gameId: string, roundId: string, token: string, index: number): Promise<{ accepted: true }> {
  return apiFetch(`/games/${gameId}/rounds/${roundId}/guess`, {
    method: 'POST',
    body: { type: 'position', value: index },
    token,
  });
}

export function submitBonusGuess(gameId: string, roundId: string, token: string, year: number): Promise<{ correct: boolean }> {
  return apiFetch(`/games/${gameId}/rounds/${roundId}/guess`, {
    method: 'POST',
    body: { type: 'exact_year', value: year },
    token,
  });
}

export function claimToken(gameId: string, roundId: string, token: string): Promise<{ accepted: true; graceMs: number }> {
  return apiFetch(`/games/${gameId}/rounds/${roundId}/token-claim`, { method: 'POST', token });
}

export function restartTable(tableId: string, token: string): Promise<{ tableId: string }> {
  return apiFetch(`/tables/${tableId}/restart`, { method: 'POST', token });
}

export function submitTokenGuess(gameId: string, roundId: string, token: string, year: number): Promise<{ correct: boolean }> {
  return apiFetch(`/games/${gameId}/rounds/${roundId}/token-submit`, { method: 'POST', body: { year }, token });
}
