import { isPlacementCorrect, TimelineEntry } from '../../src/services/timeline';

describe('isPlacementCorrect (FR-026/FR-027)', () => {
  const timeline: TimelineEntry[] = [
    { yearValue: 1980 },
    { yearValue: 1995 },
    { yearValue: 2010 },
  ];

  it('accepts a year correctly placed before the first card', () => {
    expect(isPlacementCorrect(timeline, 0, 1970)).toBe(true);
  });

  it('rejects a year that belongs before the first card but was placed later', () => {
    expect(isPlacementCorrect(timeline, 1, 1970)).toBe(false);
  });

  it('accepts a year correctly placed between two neighbors', () => {
    expect(isPlacementCorrect(timeline, 1, 1990)).toBe(true);
  });

  it('rejects a year placed between the wrong neighbors', () => {
    expect(isPlacementCorrect(timeline, 2, 1990)).toBe(false);
  });

  it('accepts a year correctly placed after the last card', () => {
    expect(isPlacementCorrect(timeline, 3, 2020)).toBe(true);
  });

  it('rejects a year placed after the last card when it belongs earlier', () => {
    expect(isPlacementCorrect(timeline, 3, 1990)).toBe(false);
  });

  it('treats an equal-year boundary as correct on both sides (FR-027)', () => {
    expect(isPlacementCorrect(timeline, 1, 1980)).toBe(true);
    expect(isPlacementCorrect(timeline, 2, 1995)).toBe(true);
  });

  it('accepts any index on an empty timeline', () => {
    expect(isPlacementCorrect([], 0, 2000)).toBe(true);
  });
});
