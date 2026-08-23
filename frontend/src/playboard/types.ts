export type Phase = 'dealing' | 'idle' | 'waiting' | 'countdown' | 'playing' | 'reveal';

export type PendingResult = 'good' | 'bad' | null;
export type TokenState = 'idle' | 'entering' | 'wrong';

export interface Song {
  artist: string;
  title: string;
  year: number;
}

export interface PlayerState {
  id: string;
  name: string;
  you: boolean;
  initials: string;
  /** Fixed 10-slot timeline; null = empty. See Playboard UI spec section 2.2. */
  slots: (number | null)[];
  /** Snapshot of `slots` taken at the start of the current song window, used to
   *  undo shifts/placements when a round resolves incorrectly (spec 2.3/2.4). */
  roundStartSlots: (number | null)[] | null;
  pendingSlot: number | null;
  pendingResult: PendingResult;
  tokenState: TokenState;
  tokenGuess: number | null;
  songsterPoints: number;
  karma: number;
  ready: boolean;
  sittingOut: boolean;
}

export const SLOT_COUNT = 10;
export const STARTER_YEARS: [number, number] = [1986, 2004];
export const STARTER_SLOTS: [number, number] = [4, 5];
