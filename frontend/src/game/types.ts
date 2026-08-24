// Mirrors backend/src/services/gameState.ts exactly - keep in sync.

export interface GamePlayerState {
  userId: string;
  username: string;
  timeline: number[];
  tokensRemaining: number;
  scorePoints: number;
  karmaPoints: number;
  gamesPlayed: number;
  globalRank: number;
}

export type RoundStatus = 'countdown' | 'playing' | 'token_solo' | 'token_others' | 'resolved';
export type RoundMode = 'normal' | 'token' | 'bonus';

export interface CurrentRoundState {
  roundId: string;
  indexNo: number;
  mode: RoundMode;
  status: RoundStatus;
  startedAt: string;
  countdownMs: number;
  windowMs: number;
  tokenClaimantUserId: string | null;
  tokenWrongGuessYear: number | null;
  exactYearAttemptedUserIds: string[];
  sitOutUserIds: string[];
  songStreamPath: string | null;
  songTitle: string | null;
  songArtist: string | null;
  songYear: number | null;
  results: { userId: string; submitted: boolean; correct: boolean; guessedIndex: number | null }[];
}

export interface RoundReadyPhase {
  startedAt: string | null;
  windowMs: number;
  readyUserIds: string[];
}

export interface GameState {
  gameId: string;
  tableId: string;
  status: string;
  winnerUserId: string | null;
  matchEndedAt: string | null;
  matchCloseWindowMs: number;
  players: GamePlayerState[];
  currentRound: CurrentRoundState | null;
  roundReadyPhase: RoundReadyPhase | null;
}
