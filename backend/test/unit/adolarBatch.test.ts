import { BatchCandidate, selectBatch } from '../../src/services/adolarBatch';

function candidate(overrides: Partial<BatchCandidate>): BatchCandidate {
  return {
    songRefId: `id_${Math.random()}`,
    artist: 'Artist',
    yearValue: 1990,
    lastPlayedAt: null,
    ...overrides,
  };
}

describe('selectBatch (Adolar_Songster_Adolar_Integration_Konzept section 4.3)', () => {
  it('prefers never-played (last_played_at NULL) songs over previously-played ones', () => {
    const neverPlayed = candidate({ songRefId: 'never', artist: 'A', lastPlayedAt: null });
    const playedRecently = candidate({ songRefId: 'recent', artist: 'B', lastPlayedAt: '2026-08-20T00:00:00Z' });
    const playedLongAgo = candidate({ songRefId: 'longago', artist: 'C', lastPlayedAt: '2020-01-01T00:00:00Z' });

    // All three land in the same decade bucket, so the round-robin picks
    // in malus order: never-played, then longest-ago, then most-recent.
    const selected = selectBatch([playedRecently, neverPlayed, playedLongAgo]);

    expect(selected.map((c) => c.songRefId)).toEqual(['never', 'longago', 'recent']);
  });

  it('never picks two songs by the same artist into one batch', () => {
    const candidates = [
      candidate({ songRefId: 'a1', artist: 'Same Artist', yearValue: 1980 }),
      candidate({ songRefId: 'a2', artist: 'Same Artist', yearValue: 1990 }),
      candidate({ songRefId: 'b1', artist: 'Other Artist', yearValue: 2000 }),
    ];

    const selected = selectBatch(candidates);

    const artists = selected.map((c) => c.artist);
    expect(new Set(artists).size).toBe(artists.length);
    // The second "Same Artist" song is skipped entirely rather than
    // substituting a duplicate - only 2 of the 3 candidates qualify.
    expect(selected).toHaveLength(2);
  });

  it('spreads picks across decades via round-robin instead of draining one bucket first', () => {
    const candidates = [
      candidate({ songRefId: '70s-1', artist: 'Artist 70s 1', yearValue: 1975 }),
      candidate({ songRefId: '70s-2', artist: 'Artist 70s 2', yearValue: 1978 }),
      candidate({ songRefId: '90s-1', artist: 'Artist 90s 1', yearValue: 1992 }),
      candidate({ songRefId: '90s-2', artist: 'Artist 90s 2', yearValue: 1995 }),
    ];

    const selected = selectBatch(candidates);

    // Round-robin alternates buckets each pass, so with two candidates per
    // bucket the first two picks are one from each decade, not both 70s.
    const firstTwoDecades = selected.slice(0, 2).map((c) => Math.floor(c.yearValue / 10) * 10);
    expect(new Set(firstTwoDecades)).toEqual(new Set([1970, 1990]));
  });

  it('caps the batch at 50 even with more eligible candidates', () => {
    const candidates = Array.from({ length: 80 }, (_, i) =>
      candidate({ songRefId: `s${i}`, artist: `Artist ${i}`, yearValue: 1950 + (i % 70) }),
    );

    const selected = selectBatch(candidates);

    expect(selected).toHaveLength(50);
  });

  it('returns fewer than 50 when the eligible pool (after the one-artist rule) is smaller', () => {
    const candidates = [
      candidate({ songRefId: 'x1', artist: 'Solo Artist', yearValue: 2000 }),
      candidate({ songRefId: 'x2', artist: 'Solo Artist', yearValue: 2010 }),
    ];

    const selected = selectBatch(candidates);

    expect(selected).toHaveLength(1);
  });
});
