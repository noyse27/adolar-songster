// FR-036: earliest server-recorded claim wins; claims within 50ms of the
// earliest are considered simultaneous and tie-broken randomly.
export const CLAIM_TIE_BREAK_MS = 50;

export interface Claim {
  id: string;
  claimedAtMs: number;
}

export function resolveClaimWinner(claims: Claim[]): Claim {
  if (claims.length === 0) {
    throw new Error('cannot resolve a winner from an empty claim list');
  }
  const sorted = [...claims].sort((a, b) => a.claimedAtMs - b.claimedAtMs);
  const earliest = sorted[0];
  const tied = sorted.filter((c) => c.claimedAtMs - earliest.claimedAtMs <= CLAIM_TIE_BREAK_MS);
  if (tied.length === 1) {
    return earliest;
  }
  return tied[Math.floor(Math.random() * tied.length)];
}
