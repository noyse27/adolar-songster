// Shared by roundEngine.ts (which schedules the actual transitions) and
// gameState.ts/broadcast.ts (which need the same numbers to tell clients
// how long a countdown/window lasts, without a circular import between
// roundEngine and the realtime broadcaster it calls into).

// FR-021/022: fixed in production; overridable via env so integration
// tests can run a full countdown -> song -> resolve cycle in milliseconds
// instead of real 3s + 25s, keeping the suite fast and deterministic.
export const COUNTDOWN_MS = Number(process.env.ROUND_COUNTDOWN_MS ?? 3000);
export const SONG_DURATION_MS = Number(process.env.ROUND_SONG_DURATION_MS ?? 25000);

// FR-030: 2 tokens per player per game. FR-036: near-simultaneous claims
// are collected for a short grace window before the fastest (or, within
// 50ms, a random one of the tied) claim is declared the winner. FR-033/034:
// 10s each for the winner's solo attempt and, on a wrong guess, the
// opponents' attempt.
export const TOKENS_PER_PLAYER = 2;
export const TOKEN_CLAIM_GRACE_MS = Number(process.env.TOKEN_CLAIM_GRACE_MS ?? 150);
export const TOKEN_SOLO_WINDOW_MS = Number(process.env.TOKEN_SOLO_WINDOW_MS ?? 10000);
export const TOKEN_OTHERS_WINDOW_MS = Number(process.env.TOKEN_OTHERS_WINDOW_MS ?? 10000);

// FR-041: a Stichsong bonus round for players tied at the winning card
// count. The Stichsong plays for BONUS_SONG_DURATION_MS (same as a normal
// round), then the guess field stays open for an extra grace period so the
// full guess window (BONUS_WINDOW_MS) outlasts the music itself. An exact
// year guess wins immediately (it can never be beaten); otherwise, once the
// window closes, whoever's guess is numerically closest to the real year
// wins - ties broken by whoever submitted first (resolveClaimWinner).
export const BONUS_SONG_DURATION_MS = Number(process.env.BONUS_SONG_DURATION_MS ?? 25000);
export const BONUS_WINDOW_MS = Number(process.env.BONUS_WINDOW_MS ?? 35000);

// Per-round readiness window (roundReady.ts): every round after the game's
// first (table_seat.ready gates that one) opens with this same ready
// window before auto-starting.
export const ROUND_READY_WINDOW_MS = Number(process.env.ROUND_READY_WINDOW_MS ?? 30000);
