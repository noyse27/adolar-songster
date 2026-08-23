import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import '../playboard/Playboard.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError, API_BASE_URL } from '../api';
import { getSocket } from '../realtime/socket';
import { fetchGameState, setRoundReady, submitPositionGuess, submitBonusGuess, claimToken, submitTokenGuess, restartTable } from './gameApi';
import { GameState } from './types';
import { embedTimeline, boxIndexToPackedIndex, packedIndexToBoxIndex, SLOT_COUNT } from './timelineSlots';
import { PlayerRow } from '../playboard/PlayerRow';
import { CenterControl } from '../playboard/CenterControl';
import { ExitModal, HelpModal } from '../playboard/Modals';
import { PendingResult, PlayerState, TokenState } from '../playboard/types';
import { karmaLeavePenalty, placeAt, ranksByPoints } from '../playboard/gameLogic';

/*
 * Real-data counterpart of playboard/Playboard.tsx - reuses that prototype's
 * own components (PlayerRow/CenterControl/Modals) and pure helpers
 * (gameLogic.ts) so the "scharfer Tisch" matches the approved prototype
 * exactly (fixed 10-box timeline, deal animation, pending "?" tile before
 * reveal, avatar ready-toggle/tooltip, exit/help modals) instead of
 * re-implementing a visually different variant. Only the round/ready
 * choreography is driven by the server's broadcast GameState instead of a
 * local timer engine - see gameApi.ts / realtime/socket.ts.
 */

const TOKEN_WINDOW_MS = 10000; // display-only estimate; the server is authoritative on the actual timeout.
const AUDIO_MUTED_STORAGE_KEY = 'adolar-songster:audio-muted';

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function nullSlots(): (number | null)[] {
  return new Array(SLOT_COUNT).fill(null);
}

export function LiveGameBoard() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const { gameId } = useParams<{ gameId: string }>();

  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pendingLocal, setPendingLocal] = useState<{
    slots: (number | null)[];
    landingIndex: number;
    desiredIndex: number;
    base: (number | null)[];
  } | null>(null);
  const [guessInput, setGuessInput] = useState('');
  const [exitOpen, setExitOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dealt, setDealt] = useState(false);
  const [animatedSlots, setAnimatedSlots] = useState<Record<string, (number | null)[]> | null>(null);
  const [audioMuted, setAudioMuted] = useState(() => window.localStorage.getItem(AUDIO_MUTED_STORAGE_KEY) !== 'false');
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [revealExpired, setRevealExpired] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const tokenPhaseStartRef = useRef<{ status: string; at: number } | null>(null);
  const timelineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const ringWrapRef = useRef<HTMLDivElement | null>(null);
  const dealStartedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!auth || !gameId) return;
    fetchGameState(gameId, auth.accessToken)
      .then(setState)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError('Spielstand konnte nicht geladen werden.');
      });

    const socket = getSocket(auth.accessToken);
    socket.emit('game:join-room', gameId);
    const onUpdate = (payload: GameState) => setState(payload);
    socket.on('game:update', onUpdate);
    return () => {
      socket.off('game:update', onUpdate);
      socket.emit('game:leave-room', gameId);
    };
  }, [auth, gameId]);

  // Once a rematch resets the table back to 'open' (see the winner
  // screen's "Nochmal spielen"), this GameState object itself never
  // changes again - the new game doesn't exist until someone starts it -
  // so everyone here needs the table's own broadcast to know to head back
  // to the ready-up flow instead of staring at a stale finished screen.
  const tableId = state?.tableId;
  useEffect(() => {
    if (!auth || !tableId) return;
    const socket = getSocket(auth.accessToken);
    socket.emit('table:join-room', tableId);
    const onTableUpdate = (payload: { state: string }) => {
      if (payload.state === 'open') navigate(`/tisch/${tableId}`);
    };
    socket.on('table:update', onTableUpdate);
    return () => {
      socket.off('table:update', onTableUpdate);
      socket.emit('table:leave-room', tableId);
    };
  }, [auth, tableId, navigate]);

  // A new round means any local pending placement/guess from the previous
  // one is stale - reset it. Deliberately NOT keyed on the whole `state`
  // object, which changes on every broadcast (including ones triggered by
  // other players), or every incidental update would wipe your own
  // in-progress selection.
  useEffect(() => {
    setPendingLocal(null);
    setGuessInput('');
    setRevealExpired(false);
  }, [state?.currentRound?.roundId]);

  // Holds the ring flipped to the reveal face for a few seconds once a
  // round resolves, matching the prototype's 5s reveal (Playboard.tsx's
  // enterReveal/commitReveal) - without this, the ring would flip straight
  // to the "Bereit?" ready-prompt face the instant it resolves, since the
  // round-ready window now arms itself automatically at that exact moment
  // (see roundReadyWindow.ts) and roundReadyPhase becomes non-null too.
  const roundStatusForReveal = state?.currentRound?.status;
  const roundIdForReveal = state?.currentRound?.roundId;
  useEffect(() => {
    if (roundStatusForReveal !== 'resolved') return;
    const id = window.setTimeout(() => setRevealExpired(true), 5000);
    return () => window.clearTimeout(id);
  }, [roundStatusForReveal, roundIdForReveal]);

  // Ticks while any timed phase is on screen, so rings/clocks animate
  // smoothly between the (infrequent) real state updates from the server.
  const roundStatus = state?.currentRound?.status;
  useEffect(() => {
    const active =
      state?.roundReadyPhase?.startedAt ||
      (roundStatus && ['countdown', 'playing'].includes(roundStatus)) ||
      state?.status === 'finished';
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [state?.roundReadyPhase?.startedAt, roundStatus, state?.status]);

  // The winner screen's own auto-close countdown - navigates everyone back
  // to the lobby if nobody rematches within the server's window (mirrors
  // tableRestart.ts's server-side eviction, which fires around the same
  // real time off the same matchEndedAt timestamp).
  useEffect(() => {
    if (state?.status !== 'finished' || !state.matchEndedAt) return;
    const deadline = new Date(state.matchEndedAt).getTime() + state.matchCloseWindowMs;
    if (Date.now() >= deadline) {
      navigate('/lobby');
    }
  }, [state?.status, state?.matchEndedAt, state?.matchCloseWindowMs, now, navigate]);

  // Audio: preload as soon as a round - and therefore its stream path -
  // is known, i.e. already during 'countdown' (see gameState.ts's
  // songStreamPath comment), so the file is likely buffered by the time
  // 'playing' starts and .play() can fire right away. Keyed on roundId,
  // not the path string, so a re-broadcast mid-round from another
  // player's action never restarts a load already in flight.
  const roundId = state?.currentRound?.roundId;
  const songStreamPath = state?.currentRound?.songStreamPath;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioUnavailable(false);
    if (!songStreamPath) {
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    audio.src = `${API_BASE_URL}${songStreamPath}`;
    audio.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // Plays exactly while the song window is actually open. A token claim
  // (or the round otherwise moving on) stops it immediately - FR-032 and
  // real Hitster both stop the music the instant someone buzzes in.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (roundStatus === 'playing') {
      audio.currentTime = 0;
      audio.play().catch(() => setAudioUnavailable(true));
    } else {
      audio.pause();
    }
  }, [roundStatus, roundId]);

  // The <audio> element's `muted` prop below keeps the DOM node itself in
  // sync declaratively on every render - this just persists the choice.
  useEffect(() => {
    window.localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, String(audioMuted));
  }, [audioMuted]);

  // Best-effort local clock for the token_solo/token_others windows - the
  // server enforces the real timeout, this is display-only since GameState
  // doesn't carry a per-phase start timestamp for those (only the round's
  // original countdown-start time).
  useEffect(() => {
    const status = state?.currentRound?.status;
    if (status === 'token_solo' || status === 'token_others') {
      if (tokenPhaseStartRef.current?.status !== status) {
        tokenPhaseStartRef.current = { status, at: Date.now() };
      }
      const id = window.setInterval(() => setNow(Date.now()), 200);
      return () => window.clearInterval(id);
    }
    tokenPhaseStartRef.current = null;
  }, [state?.currentRound?.status]);

  // Initial deal animation - mirrors playboard/Playboard.tsx's dealCards(),
  // but flies the players' *real* two starting cards in from the center
  // instead of a hardcoded pair. Only plays once, and only for a genuinely
  // fresh game (nobody has played a round yet, everyone still has exactly
  // their starting 2 cards) - a page refresh mid-game skips straight to the
  // real board.
  useEffect(() => {
    if (!state || dealStartedRef.current) return;
    dealStartedRef.current = true;

    const freshStart = !state.currentRound && state.players.every((p) => p.timeline.length === 2);
    if (!freshStart) {
      setDealt(true);
      return;
    }

    const initial = state;
    window.setTimeout(() => dealCards(initial), 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function dealCards(initial: GameState) {
    const initialMap: Record<string, (number | null)[]> = {};
    initial.players.forEach((p) => {
      initialMap[p.userId] = nullSlots();
    });
    setAnimatedSlots(initialMap);

    const centerRect = ringWrapRef.current?.getBoundingClientRect();
    if (!centerRect) {
      setAnimatedSlots(null);
      setDealt(true);
      return;
    }
    const cx = centerRect.left + centerRect.width / 2 - 34;
    const cy = centerRect.top + centerRect.height / 2 - 38;
    const STARTER_SLOTS = [4, 5];

    let delay = 0;
    initial.players.forEach((p) => {
      const isSelf = p.userId === auth?.user.id;
      STARTER_SLOTS.forEach((slotIdx, ci) => {
        const year = p.timeline[ci];
        const myDelay = delay;
        delay += 260;
        window.setTimeout(() => {
          const ghost = document.createElement('div');
          ghost.className = 'pb-deal-ghost';
          ghost.textContent = String(year);
          ghost.style.left = `${cx}px`;
          ghost.style.top = `${cy}px`;
          document.body.appendChild(ghost);
          requestAnimationFrame(() => {
            const timelineEl = timelineRefs.current.get(p.userId);
            const targetBox = timelineEl?.children[slotIdx] as HTMLElement | undefined;
            const rect = targetBox?.getBoundingClientRect() ?? centerRect;
            const tx = rect.left + rect.width / 2 - 34 - cx;
            const ty = rect.top + rect.height / 2 - 38 - cy;
            ghost.style.transform = `translate(${tx}px, ${ty}px) scale(${isSelf ? 0.95 : 0.65}) rotate(${(Math.random() * 30 - 15).toFixed(0)}deg)`;
            ghost.style.opacity = '0';
          });
          window.setTimeout(() => {
            setAnimatedSlots((prev) => {
              if (!prev) return prev;
              const s = (prev[p.userId] ?? nullSlots()).slice();
              s[slotIdx] = year;
              return { ...prev, [p.userId]: s };
            });
            ghost.remove();
          }, 560);
        }, myDelay);
      });
    });

    window.setTimeout(() => {
      setDealt(true);
      setAnimatedSlots(null);
    }, delay + 700);
  }

  // Randomized once, not on every 200ms tick - only the fall animation
  // itself needs to keep moving, the pieces' own colors/positions don't.
  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: Math.round(Math.random() * 100),
        delay: (Math.random() * 2.4).toFixed(2),
        duration: (2.6 + Math.random() * 1.8).toFixed(2),
        color: ['var(--adolar-cyan)', 'var(--adolar-violet)', 'var(--adolar-lavender)', 'var(--adolar-yellow)', 'var(--adolar-orange)'][
          i % 5
        ],
      })),
    [],
  );

  const you = state?.players.find((p) => p.userId === auth?.user.id) ?? null;
  const maxScore = useMemo(() => Math.max(0, ...(state?.players.map((p) => p.timeline.length) ?? [0])), [state]);
  const rankMap = useMemo(
    () => ranksByPoints(state?.players.map((p) => ({ id: p.userId, songsterPoints: p.scorePoints })) ?? []),
    [state],
  );

  async function handleSetReady(ready: boolean) {
    if (!auth || !gameId) return;
    try {
      await setRoundReady(gameId, auth.accessToken, ready);
    } catch {
      setError('Bereit-Status konnte nicht gesetzt werden.');
    }
  }

  async function handlePlaceClick(desiredIndex: number) {
    if (!canPlaceGuess || !you || !auth || !gameId || !state?.currentRound) return;
    const base = embedTimeline(you.timeline);
    const result = placeAt(base, desiredIndex);
    if (!result) return; // timeline full
    // Keep the raw clicked box (against the *unshifted* base) alongside
    // the shifted preview - the packed index submitted to the server must
    // come from `desiredIndex`/`base`, not from `landingIndex`, which
    // direction placeAt shifted in is a display choice only (see
    // timelineSlots.ts's boxIndexToPackedIndex comment).
    setPendingLocal({ slots: result.slots, landingIndex: result.landingIndex, desiredIndex, base });

    // Submit immediately, not just on the later Confirm click - a 25s
    // countdown is no place to rely on players noticing a second required
    // step, and re-clicking a different gap simply resubmits (the server
    // keeps whichever guess was submitted last), so this stays exactly as
    // correctable as the two-step version was.
    const packedIndex = boxIndexToPackedIndex(desiredIndex, base);
    try {
      await submitPositionGuess(gameId, state.currentRound.roundId, auth.accessToken, packedIndex);
    } catch {
      setError('Platzierung konnte nicht übermittelt werden.');
    }
  }

  function handleClear() {
    setPendingLocal(null);
  }

  // Placement is already submitted on click (see handlePlaceClick above) -
  // Confirm is a harmless resend for the rare case that request failed
  // silently, matching the prototype's own "already committed on click"
  // design (playboard/Playboard.tsx's onConfirm).
  async function handleConfirm() {
    if (!auth || !gameId || !state?.currentRound || !you || pendingLocal === null) return;
    const packedIndex = boxIndexToPackedIndex(pendingLocal.desiredIndex, pendingLocal.base);
    try {
      await submitPositionGuess(gameId, state.currentRound.roundId, auth.accessToken, packedIndex);
    } catch {
      setError('Platzierung konnte nicht übermittelt werden.');
    }
  }

  async function handleClaimToken() {
    if (!auth || !gameId || !state?.currentRound) return;
    try {
      await claimToken(gameId, state.currentRound.roundId, auth.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? String(err.body ?? 'Token fehlgeschlagen.') : 'Token fehlgeschlagen.');
    }
  }

  async function handleSubmitYearGuess() {
    if (!auth || !gameId || !state?.currentRound) return;
    const year = parseInt(guessInput, 10);
    if (!year) return;
    const round = state.currentRound;
    try {
      if (round.mode === 'bonus') {
        await submitBonusGuess(gameId, round.roundId, auth.accessToken, year);
      } else {
        await submitTokenGuess(gameId, round.roundId, auth.accessToken, year);
      }
      setGuessInput('');
    } catch {
      setError('Jahr konnte nicht übermittelt werden.');
    }
  }

  async function handleRestart() {
    if (!auth || !state || restarting) return;
    setRestarting(true);
    try {
      await restartTable(state.tableId, auth.accessToken);
      // No local navigation here - the table:update broadcast (see the
      // table-room subscription effect above) sends everyone to
      // /tisch/:tableId once the server confirms the reset to 'open'.
    } catch {
      setError('Tisch konnte nicht neu gestartet werden.');
      setRestarting(false);
    }
  }

  async function confirmExit() {
    if (!auth || !state || leaving) return;
    setLeaving(true);
    setExitOpen(false);
    try {
      await apiFetch(`/tables/${state.tableId}/leave`, { method: 'POST', token: auth.accessToken });
      navigate('/lobby');
    } catch (err) {
      // A 404 here means the seat was already marked left (e.g. a fast
      // double-click firing this twice) - from the user's perspective
      // they're already gone, so still send them to the lobby instead of
      // stranding them on the game screen with just an error line.
      if (err instanceof ApiError && err.status === 404) {
        navigate('/lobby');
      } else {
        setError('Tisch konnte nicht verlassen werden.');
        setLeaving(false);
      }
    }
  }

  if (!auth) {
    return (
      <div className="playboard">
        <div className="pb-app">
          <p>
            Bitte zuerst <Link to="/login">anmelden</Link>.
          </p>
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="playboard">
        <div className="pb-app">
          <p>Diese Partie gibt es nicht (mehr).</p>
          <Link to="/lobby">Zurück zur Lobby</Link>
        </div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="playboard">
        <div className="pb-app">
          <p>Lade…</p>
        </div>
      </div>
    );
  }

  const round = state.currentRound;
  const readyPhase = state.roundReadyPhase;

  // ---------- center ring content ----------
  let ringMark = '?';
  let ringLabel = 'Bereit?';
  let progress = 0;
  let frontState: '' | 'pb-counting' | 'pb-playing' = '';
  let flipped = false;
  let deckCaption = '';
  let phaseLabel = 'Bereit für nächste Runde';

  if (!dealt) {
    phaseLabel = 'Karten werden verteilt…';
  } else if (round?.status === 'resolved' && !revealExpired) {
    // Checked before readyPhase on purpose: the ready window now arms
    // itself automatically the instant a round resolves (see
    // roundReadyWindow.ts), so roundReadyPhase is already non-null here
    // too - without this ordering the ring would flip straight to the
    // "Bereit?" prompt and the reveal would never actually be seen.
    flipped = true;
    phaseLabel = 'Auflösung';
    if (readyPhase) {
      deckCaption = `${readyPhase.readyUserIds.length}/${state.players.length} bereit`;
    }
  } else if (readyPhase) {
    const iAmReady = you ? readyPhase.readyUserIds.includes(you.userId) : false;
    const readyCount = readyPhase.readyUserIds.length;
    const total = state.players.length;
    if (readyPhase.startedAt) {
      const remaining = Math.max(0, readyPhase.windowMs - (now - new Date(readyPhase.startedAt).getTime()));
      ringMark = String(Math.ceil(remaining / 1000));
      progress = clamp01(1 - remaining / readyPhase.windowMs);
      ringLabel = 'Warte…';
      frontState = 'pb-counting';
      phaseLabel = 'Warte auf Mitspieler';
    } else {
      ringMark = iAmReady ? '✓' : '?';
      ringLabel = 'Bereit?';
    }
    deckCaption = `${readyCount}/${total} bereit`;
  } else if (round) {
    if (round.status === 'countdown') {
      const elapsed = now - new Date(round.startedAt).getTime();
      const remaining = Math.max(0, round.countdownMs - elapsed);
      ringMark = String(Math.ceil(remaining / 1000) || 1);
      ringLabel = 'los geht’s';
      progress = clamp01(elapsed / round.countdownMs);
      frontState = 'pb-counting';
      phaseLabel = 'Countdown läuft';
    } else if (round.status === 'playing') {
      const elapsed = now - new Date(round.startedAt).getTime() - round.countdownMs;
      const remaining = Math.max(0, round.windowMs - elapsed);
      ringMark = '♪';
      ringLabel = 'läuft';
      progress = clamp01(elapsed / round.windowMs);
      frontState = 'pb-playing';
      deckCaption = `${Math.ceil(remaining / 1000)}s verbleibend`;
      phaseLabel = 'Songfenster offen';
    } else if (round.status === 'token_solo' || round.status === 'token_others') {
      ringMark = '!!';
      ringLabel = round.status === 'token_solo' ? 'Solo-Versuch' : 'Deine Chance';
      const startedAt = tokenPhaseStartRef.current?.at ?? now;
      progress = clamp01((now - startedAt) / TOKEN_WINDOW_MS);
      phaseLabel = round.status === 'token_solo' ? 'Songster-Buzzer aktiv' : 'Zweite Chance offen';
    }
  }

  const canReadyNow = dealt && Boolean(readyPhase);
  const iAmSittingOut = round ? round.sitOutUserIds.includes(you?.userId ?? '') : false;
  const canPlaceGuess = Boolean(dealt && round && round.status === 'playing' && round.mode === 'normal' && !iAmSittingOut);
  const canUseToken =
    Boolean(dealt && round && round.status === 'playing' && round.mode === 'normal' && !iAmSittingOut && (you?.tokensRemaining ?? 0) > 0);

  let guessFieldActive = false;
  let guessWrongValue: number | null = null;
  if (round) {
    if (round.mode === 'bonus' && round.status === 'playing' && you && !round.exactYearAttemptedUserIds.includes(you.userId)) {
      guessFieldActive = true;
    }
    if (round.mode === 'token') {
      if (round.status === 'token_solo' && round.tokenClaimantUserId === you?.userId) guessFieldActive = true;
      if (
        round.status === 'token_others' &&
        you &&
        round.tokenClaimantUserId !== you.userId &&
        !round.exactYearAttemptedUserIds.includes(you.userId)
      ) {
        guessFieldActive = true;
      }
      if (round.tokenWrongGuessYear !== null && round.tokenClaimantUserId) guessWrongValue = round.tokenWrongGuessYear;
    }
  }

  return (
    <div className="playboard">
      <div className="pb-app">
        <div className="pb-topbar">
          <div className="pb-brand">
            <button className="pb-icon-btn pb-exit" title="Tisch verlassen" aria-label="Tisch verlassen" onClick={() => (state.status === 'finished' ? navigate('/lobby') : setExitOpen(true))}>
              &#10005;
            </button>
            <button className="pb-icon-btn" title="Kurzanleitung" aria-label="Kurzanleitung" onClick={() => setHelpOpen(true)}>
              ?
            </button>
            <button
              className="pb-icon-btn"
              title={audioUnavailable ? 'Kein Ton für diesen Song verfügbar' : audioMuted ? 'Ton einschalten' : 'Ton ausschalten'}
              aria-label="Ton ein/aus"
              onClick={() => setAudioMuted((m) => !m)}
            >
              {audioMuted ? '🔇' : '🔊'}
            </button>
            <div className="pb-brand-mark">AS</div>
            <div>
              <div className="pb-brand-title">Songster</div>
              <div className="pb-brand-sub">Live-Partie</div>
            </div>
          </div>
          <div className="pb-round-pill">
            <span className="pb-round-dot" />
            &nbsp;Runde <b>{round?.indexNo ?? '—'}</b> &middot; <span>{phaseLabel}</span>
          </div>
        </div>

        <audio ref={audioRef} preload="auto" muted={audioMuted} onError={() => setAudioUnavailable(true)} />

        {error && (
          <div className="sh-error" style={{ marginBottom: 4 }}>
            {error}
          </div>
        )}

        <div className="pb-board">
          {state.players.map((p) => {
            const isSelf = p.userId === you?.userId;
            const sittingOut = round?.sitOutUserIds.includes(p.userId) ?? false;

            let slots: (number | null)[];
            let pendingSlot: number | null = null;
            let pendingResult: PendingResult = null;
            if (!dealt) {
              slots = animatedSlots?.[p.userId] ?? nullSlots();
            } else if (round?.status === 'resolved' && round.mode === 'normal') {
              // Server-truth reveal for *every* player, not just yourself -
              // everyone's guessed position is shown colored red/green for
              // the few seconds the round stays 'resolved', matching the
              // approved prototype (playboard/PlayerRow.tsx's
              // pendingSlot/pendingResult tile).
              const mine = round.results.find((r) => r.userId === p.userId);
              if (mine?.submitted && mine.guessedIndex !== null) {
                if (mine.correct) {
                  // The card is already inserted into p.timeline at exactly
                  // this packed index (see insertCardAndReindex) - no local
                  // shifting needed, just point at where it landed.
                  slots = embedTimeline(p.timeline);
                  pendingSlot = packedIndexToBoxIndex(mine.guessedIndex, p.timeline.length);
                } else {
                  // Nothing was inserted - open a preview slot at the
                  // attempted position, same shifting the prototype uses
                  // while a guess is still pending.
                  const base = embedTimeline(p.timeline);
                  const desiredBox = packedIndexToBoxIndex(mine.guessedIndex, p.timeline.length);
                  const result = placeAt(base, desiredBox);
                  slots = result ? result.slots : base;
                  pendingSlot = result ? result.landingIndex : null;
                }
                pendingResult = mine.correct ? 'good' : 'bad';
              } else {
                slots = embedTimeline(p.timeline);
              }
            } else if (isSelf && pendingLocal) {
              slots = pendingLocal.slots;
              pendingSlot = pendingLocal.landingIndex;
            } else {
              slots = embedTimeline(p.timeline);
            }

            const isClaimant = round?.tokenClaimantUserId === p.userId;
            const fieldActiveForThisPlayer = isSelf && guessFieldActive;
            const wrongForThisPlayer = isClaimant ? guessWrongValue : null;
            let tokenState: TokenState = 'idle';
            if (wrongForThisPlayer !== null) tokenState = 'wrong';
            else if ((round?.status === 'token_solo' && isClaimant) || fieldActiveForThisPlayer) tokenState = 'entering';

            const playerState: PlayerState = {
              id: p.userId,
              name: p.username,
              you: isSelf,
              initials: p.username.slice(0, 2).toUpperCase(),
              slots,
              roundStartSlots: null,
              pendingSlot,
              pendingResult,
              tokenState,
              tokenGuess: wrongForThisPlayer,
              songsterPoints: p.scorePoints,
              karma: p.karmaPoints,
              ready: readyPhase?.readyUserIds.includes(p.userId) ?? false,
              sittingOut,
            };

            return (
              <PlayerRow
                key={p.userId}
                player={playerState}
                isLeader={p.timeline.length === maxScore && maxScore > 0}
                rank={rankMap[p.userId]}
                canReady={dealt && isSelf && canReadyNow}
                onToggleReady={() => handleSetReady(!(readyPhase?.readyUserIds.includes(p.userId) ?? false))}
                onGapClick={isSelf ? handlePlaceClick : undefined}
                onHandleClick={isSelf ? handlePlaceClick : undefined}
                onConfirm={isSelf ? handleConfirm : undefined}
                onClear={isSelf ? handleClear : undefined}
                currentSongYear={round?.songYear ?? null}
                guessValue={guessInput}
                guessActive={fieldActiveForThisPlayer}
                guessWrongValue={wrongForThisPlayer}
                onGuessChange={isSelf ? setGuessInput : undefined}
                onGuessSubmit={isSelf ? handleSubmitYearGuess : undefined}
                timelineRef={(el) => {
                  if (el) timelineRefs.current.set(p.userId, el);
                }}
              />
            );
          })}
        </div>

        <div className="pb-hint">
          {round?.status === 'playing' && round.mode === 'normal' && !iAmSittingOut && (
            <>
              Klick auf eine <b>Lücke</b> in deiner Zeitleiste, um deine Karte dort zu platzieren &mdash; oder buzzere mit
              einem Songster-Token.
            </>
          )}
          {iAmSittingOut && round?.status !== 'resolved' && <>Du setzt diese Runde aus — nächste Runde bist du wieder dabei.</>}
          {!round && dealt && !readyPhase?.startedAt && <>Klick auf den Ring oder dein Bild, wenn du bereit für die nächste Runde bist.</>}
        </div>

        <div className="pb-deck">
          <div className="pb-tokens">
            <button className="pb-token-btn" title="Songster-Token" disabled={!canUseToken} onClick={handleClaimToken}>
              <span className="pb-token-glyph">S</span>
            </button>
            <button className="pb-token-btn" title="Songster-Token" disabled={!canUseToken} onClick={handleClaimToken}>
              <span className="pb-token-glyph">S</span>
            </button>
          </div>

          <div className="pb-center-control">
            <CenterControl
              ringMark={ringMark}
              ringLabel={ringLabel}
              progress={progress}
              frontState={frontState}
              flipped={flipped}
              revealSong={round?.status === 'resolved' ? { artist: round.songArtist ?? '', title: round.songTitle ?? '', year: round.songYear ?? 0 } : null}
              onClick={canReadyNow ? () => handleSetReady(true) : () => undefined}
              wrapRef={(el) => (ringWrapRef.current = el)}
            />
            <div className="pb-deck-caption">{deckCaption || '30s Bereit-Fenster · 3s Countdown · 25s Songfenster'}</div>
          </div>

          <div className="pb-status-card">
            <div className="pb-status-row">
              <span>Letzter Song</span>
              <b>{round?.status === 'resolved' ? `${round.songArtist} – ${round.songTitle} (${round.songYear})` : '—'}</b>
            </div>
            <div className="pb-status-row">
              <span>Deine Token</span>
              <b>{you?.tokensRemaining ?? '—'}</b>
            </div>
            <div className="pb-status-row">
              <span>Karten</span>
              <b>{you?.timeline.length ?? 0}/{SLOT_COUNT}</b>
            </div>
          </div>
        </div>
      </div>

      <ExitModal open={exitOpen} karmaPenalty={karmaLeavePenalty(state.players.length)} onCancel={() => setExitOpen(false)} onConfirm={confirmExit} />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {state.status === 'finished' &&
        (() => {
          const winner = state.players.find((p) => p.userId === state.winnerUserId);
          const standings = [...state.players].sort((a, b) => b.timeline.length - a.timeline.length);
          const deadline = state.matchEndedAt ? new Date(state.matchEndedAt).getTime() + state.matchCloseWindowMs : null;
          const remainingS = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

          return (
            <div className="pb-winner-overlay">
              <div className="pb-confetti" aria-hidden="true">
                {confettiPieces.map((p, i) => (
                  <span
                    key={i}
                    className="pb-confetto"
                    style={{
                      left: `${p.left}%`,
                      background: p.color,
                      animationDuration: `${p.duration}s`,
                      animationDelay: `${p.delay}s`,
                    }}
                  />
                ))}
              </div>
              <div className="pb-winner-card">
                <span className="pb-winner-crown" role="img" aria-label="Krone">
                  &#128081;
                </span>
                <div className="pb-winner-eyebrow">Partie beendet</div>
                <div className="pb-winner-name">{winner?.username ?? 'Unentschieden'} gewinnt!</div>
                <div className="pb-winner-sub">Erste:r mit 10 richtig platzierten Karten.</div>

                <ol className="pb-winner-standings">
                  {standings.map((p, i) => (
                    <li key={p.userId} className={`pb-winner-row${p.userId === you?.userId ? ' pb-winner-you' : ''}`}>
                      <span className="pb-winner-rank">#{i + 1}</span>
                      <span className="pb-winner-row-name">
                        {p.username}
                        {p.userId === state.winnerUserId ? ' 👑' : ''}
                      </span>
                      <span className="pb-winner-row-cards">{p.timeline.length}/10</span>
                    </li>
                  ))}
                </ol>

                <div className="pb-winner-actions">
                  <button className="pb-winner-restart" onClick={handleRestart} disabled={restarting}>
                    {restarting ? 'Startet neu…' : '🔁 Nochmal spielen'}
                  </button>
                  {remainingS !== null && (
                    <div className="pb-winner-countdown">
                      Tisch schließt in <b>{remainingS}s</b>, falls niemand neu startet
                    </div>
                  )}
                  <button className="pb-winner-exit" onClick={() => navigate('/lobby')}>
                    Jetzt zur Lobby
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
