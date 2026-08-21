import { resolveClaimWinner } from '../../src/services/tokenRace';

describe('resolveClaimWinner (FR-036)', () => {
  it('throws when there are no claims', () => {
    expect(() => resolveClaimWinner([])).toThrow();
  });

  it('picks the single claim outright', () => {
    const winner = resolveClaimWinner([{ id: 'a', claimedAtMs: 1000 }]);
    expect(winner.id).toBe('a');
  });

  it('picks the strictly earliest claim when claims are more than 50ms apart', () => {
    const winner = resolveClaimWinner([
      { id: 'a', claimedAtMs: 1000 },
      { id: 'b', claimedAtMs: 1100 },
      { id: 'c', claimedAtMs: 900 },
    ]);
    expect(winner.id).toBe('c');
  });

  it('never picks a claim outside the 50ms tie-break window of the earliest', () => {
    for (let i = 0; i < 30; i += 1) {
      const winner = resolveClaimWinner([
        { id: 'earliest', claimedAtMs: 1000 },
        { id: 'tied', claimedAtMs: 1040 },
        { id: 'too-late', claimedAtMs: 1100 },
      ]);
      expect(['earliest', 'tied']).toContain(winner.id);
    }
  });

  it('can pick any claim within the 50ms tie-break window, not just the earliest', () => {
    const winners = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const winner = resolveClaimWinner([
        { id: 'a', claimedAtMs: 1000 },
        { id: 'b', claimedAtMs: 1020 },
        { id: 'c', claimedAtMs: 1050 },
      ]);
      winners.add(winner.id);
    }
    expect(winners.size).toBeGreaterThan(1);
  });
});
