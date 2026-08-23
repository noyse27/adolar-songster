import { PlayerState, SLOT_COUNT, STARTER_SLOTS, STARTER_YEARS } from './types';

export function freshSlots(): (number | null)[] {
  const slots = new Array<number | null>(SLOT_COUNT).fill(null);
  STARTER_SLOTS.forEach((slotIdx, i) => {
    slots[slotIdx] = STARTER_YEARS[i];
  });
  return slots;
}

/** Nearest filled neighbour to the left/right of `idx`, searching outward. */
export function neighbors(slots: (number | null)[], idx: number): [number | undefined, number | undefined] {
  let left: number | undefined;
  for (let i = idx - 1; i >= 0; i--) {
    if (slots[i] != null) {
      left = slots[i] as number;
      break;
    }
  }
  let right: number | undefined;
  for (let i = idx + 1; i < slots.length; i++) {
    if (slots[i] != null) {
      right = slots[i] as number;
      break;
    }
  }
  return [left, right];
}

/** FR-026/FR-027: correct iff year sits between the nearest filled neighbours. */
export function isCorrectPlacement(slots: (number | null)[], idx: number, year: number): boolean {
  const [left, right] = neighbors(slots, idx);
  if (left !== undefined && year < left) return false;
  if (right !== undefined && year > right) return false;
  return true;
}

export function filledCount(p: Pick<PlayerState, 'slots'>): number {
  return p.slots.filter((v) => v != null).length;
}

/** FR-044: leaving mid-game costs -5, and -1 per additional player at the table. */
export function karmaLeavePenalty(playerCount: number): number {
  return -(5 + (playerCount - 1));
}

export function ranksByPoints(players: Pick<PlayerState, 'id' | 'songsterPoints'>[]): Record<string, number> {
  const order = [...players].sort((a, b) => b.songsterPoints - a.songsterPoints);
  const map: Record<string, number> = {};
  order.forEach((p, i) => {
    map[p.id] = i + 1;
  });
  return map;
}

export interface PlacementResult {
  slots: (number | null)[];
  landingIndex: number;
}

/**
 * Places a (still-hidden) card so it ends up immediately before whatever
 * currently occupies `desiredIndex`. If that slot is already taken (the
 * player wants to insert *between* two adjacent cards), shifts cards toward
 * the nearer free slot to open up room. See UI spec 2.3 ("Schiebelogik").
 * Returns null if the timeline has no free slot at all (full row).
 */
export function placeAt(baseSlots: (number | null)[], desiredIndex: number): PlacementResult | null {
  const slots = baseSlots.slice();

  if (slots[desiredIndex] == null) {
    return { slots, landingIndex: desiredIndex };
  }

  let rightEmpty: number | null = null;
  for (let k = desiredIndex; k < SLOT_COUNT; k++) {
    if (slots[k] == null) {
      rightEmpty = k;
      break;
    }
  }
  let leftEmpty: number | null = null;
  for (let k = desiredIndex - 1; k >= 0; k--) {
    if (slots[k] == null) {
      leftEmpty = k;
      break;
    }
  }

  const rightDist = rightEmpty != null ? rightEmpty - desiredIndex : Infinity;
  const leftDist = leftEmpty != null ? desiredIndex - 1 - leftEmpty : Infinity;
  if (rightEmpty == null && leftEmpty == null) return null;

  if (rightDist <= leftDist && rightEmpty != null) {
    for (let k = rightEmpty; k > desiredIndex; k--) slots[k] = slots[k - 1];
    slots[desiredIndex] = null;
    return { slots, landingIndex: desiredIndex };
  }

  for (let k = leftEmpty as number; k < desiredIndex - 1; k++) slots[k] = slots[k + 1];
  slots[desiredIndex - 1] = null;
  return { slots, landingIndex: desiredIndex - 1 };
}

/** First slot (if any) where `year` would be a correct placement. */
export function findCorrectSlot(slots: (number | null)[], year: number): number | null {
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (slots[i] == null && isCorrectPlacement(slots, i, year)) return i;
  }
  return null;
}
