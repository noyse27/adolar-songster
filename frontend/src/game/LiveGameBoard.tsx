import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import '../playboard/Playboard.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError, API_BASE_URL } from '../api';
import { getSocket } from '../realtime/socket';
import {
  fetchGameState,
  setRoundReady,
  setAutoReady,
  submitPositionGuess,
  submitBonusGuess,
  claimToken,
  submitTokenGuess,
  restartTable,
  keepTableAlive,
} from './gameApi';
import { CurrentRoundState, GameState } from './types';
import { buildGameSummaryPdf } from './gameSummaryPdf';
import { embedTimeline, boxIndexToPackedIndex, packedIndexToBoxIndex, SLOT_COUNT } from './timelineSlots';
import { PlayerRow } from '../playboard/PlayerRow';
import { CenterControl } from '../playboard/CenterControl';
import { ExitModal, HelpModal } from '../playboard/Modals';
import { PendingResult, PlayerState, TokenState } from '../playboard/types';
import { karmaLeavePenalty, placeAt } from '../playboard/gameLogic';
import { useWakeLock } from '../hooks/useWakeLock';
import { ReactionBar } from '../components/ReactionBar';
import { communicationPhase, GameReactionEvent, ReactionConfig } from './reactions';
import { keepNewestGameState, orderPlayersForPersonalBoard } from './stateOrdering';
import { describeAudioElement, flushClientDebugEvents, logClientEvent, snapshotClientDebugContext } from '../debugLogging';

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
// Matches the backend's AUTO_READY_GRACE_MS (roundConfig.ts): how long any
// reveal (Auflösung, Stichrunde-Regel) stays on screen before an
// all-auto-ready table is allowed to move on. Auto-ready only automates the
// ready click, never these reveals - see roundReady.ts.
const REVEAL_MS = 5000;

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
  const [revealUntil, setRevealUntil] = useState<number | null>(null);
  // Full snapshot of the last round that resolved, not just its song -
  // GameState.currentRound can already be the *next* round (or gone
  // entirely once the match ends) by the time a reveal needs to render, see
  // the revealUntil effect below.
  const [lastResolvedRound, setLastResolvedRound] = useState<CurrentRoundState | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [tieModalDismissed, setTieModalDismissed] = useState(false);
  const [reactionsByUser, setReactionsByUser] = useState<Record<string, GameReactionEvent>>({});
  const [sendingReaction, setSendingReaction] = useState(false);

  const tokenPhaseStartRef = useRef<{ status: string; at: number } | null>(null);
  const timelineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const ringWrapRef = useRef<HTMLDivElement | null>(null);
  const dealStartedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const reactionTimersRef = useRef<Map<string, number>>(new Map());

  function debugRoundPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      clientKind: 'player',
      userId: auth?.user.id ?? null,
      tableId: state?.tableId ?? null,
      gameId: state?.gameId ?? gameId ?? null,
      roundId: state?.currentRound?.roundId ?? null,
      roundIndex: state?.currentRound?.indexNo ?? null,
      roundStatus: state?.currentRound?.status ?? null,
      displayAnchorPresent: state?.displayAnchorPresent ?? null,
      audioMuted,
      effectiveMuted: state?.displayAnchorPresent ? true : audioMuted,
      ...extra,
    };
  }

  useEffect(() => {
    if (!auth || !gameId) return;
    logClientEvent({
      eventType: 'game_board_mount',
      clientKind: 'player',
      userId: auth.user.id,
      gameId,
      payload: debugRoundPayload(),
    });
    fetchGameState(gameId, auth.accessToken)
      .then((payload) => {
        logClientEvent({
          eventType: 'game_state_initial_loaded',
          clientKind: 'player',
          userId: auth.user.id,
          tableId: payload.tableId,
          gameId: payload.gameId,
          roundId: payload.currentRound?.roundId ?? null,
          roundIndex: payload.currentRound?.indexNo ?? null,
          payload: {
            status: payload.currentRound?.status ?? null,
            mode: payload.currentRound?.mode ?? null,
            playerCount: payload.players.length,
            displayAnchorPresent: payload.displayAnchorPresent,
          },
        });
        setState(payload);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError('Spielstand konnte nicht geladen werden.');
      });

    const socket = getSocket(auth.accessToken);
    const reactionTimers = reactionTimersRef.current;
    socket.emit('game:join-room', gameId);
    // A flaky connection (typical on a phone's WLAN) makes socket.io
    // reconnect automatically, but that reconnect starts a brand-new server
    // session with zero room memberships - the initial join-room emit above
    // only fires once on mount. Without re-joining here, the client keeps
    // looking "connected" while silently receiving no further game:update
    // broadcasts at all, frozen on whatever state it had before the drop.
    // Re-fetching state on top of the rejoin closes the gap for whatever
    // happened while disconnected.
    const onReconnect = () => {
      logClientEvent({
        eventType: 'socket_game_rejoin_after_reconnect',
        clientKind: 'player',
        userId: auth.user.id,
        gameId,
        payload: debugRoundPayload({ socketId: socket.id }),
      });
      socket.emit('game:join-room', gameId);
      fetchGameState(gameId, auth.accessToken)
        .then((payload) => setState((current) => keepNewestGameState(current, payload)))
        .catch(() => undefined);
    };
    socket.on('connect', onReconnect);
    const onUpdate = (payload: GameState) => {
      logClientEvent({
        eventType: 'game_update_received',
        clientKind: 'player',
        userId: auth.user.id,
        tableId: payload.tableId,
        gameId: payload.gameId,
        roundId: payload.currentRound?.roundId ?? null,
        roundIndex: payload.currentRound?.indexNo ?? null,
        payload: {
          status: payload.currentRound?.status ?? null,
          mode: payload.currentRound?.mode ?? null,
          playerCount: payload.players.length,
          displayAnchorPresent: payload.displayAnchorPresent,
        },
      });
      setState((current) => keepNewestGameState(current, payload));
    };
    const onConfigUpdate = (payload: { reactions: ReactionConfig }) => {
      setState((current) => current ? { ...current, reactionConfig: payload.reactions } : current);
    };
    const onReaction = (reaction: GameReactionEvent) => {
      if (reaction.gameId !== gameId) return;
      setReactionsByUser((current) => ({ ...current, [reaction.userId]: reaction }));
      const previousTimer = reactionTimers.get(reaction.userId);
      if (previousTimer) window.clearTimeout(previousTimer);
      const timer = window.setTimeout(() => {
        setReactionsByUser((current) => {
          if (current[reaction.userId]?.sentAt !== reaction.sentAt) return current;
          const next = { ...current };
          delete next[reaction.userId];
          return next;
        });
        reactionTimers.delete(reaction.userId);
      }, 3500);
      reactionTimers.set(reaction.userId, timer);
    };
    socket.on('game:update', onUpdate);
    socket.on('game:reaction', onReaction);
    socket.on('communication:config-updated', onConfigUpdate);
    return () => {
      socket.off('connect', onReconnect);
      socket.off('game:update', onUpdate);
      socket.off('game:reaction', onReaction);
      socket.off('communication:config-updated', onConfigUpdate);
      socket.emit('game:leave-room', gameId);
      for (const timer of reactionTimers.values()) window.clearTimeout(timer);
      reactionTimers.clear();
    };
    // Debug payloads should describe the event at this subscription boundary,
    // not resubscribe sockets on every incidental state/audio change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, gameId]);

  function handleReaction(reactionId: string) {
    if (!auth || !gameId || sendingReaction) return;
    setSendingReaction(true);
    const socket = getSocket(auth.accessToken);
    socket.emit('game:reaction', { gameId, reactionId }, (result: { ok: boolean; error?: string }) => {
      setSendingReaction(false);
      if (!result.ok && result.error !== 'reaction rate limited') setError('Reaktion konnte nicht gesendet werden.');
    });
    window.setTimeout(() => setSendingReaction(false), 1500);
  }

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
    // Same reconnect gap as the game-room effect above: a dropped-and-
    // restored socket needs to rejoin this room explicitly too, or a
    // rematch-to-'open' broadcast that happens during the drop is missed.
    const onReconnect = () => socket.emit('table:join-room', tableId);
    socket.on('connect', onReconnect);
    const onTableUpdate = (payload: { state: string }) => {
      if (payload.state === 'open') navigate(`/tisch/${tableId}`);
    };
    socket.on('table:update', onTableUpdate);
    return () => {
      socket.off('connect', onReconnect);
      socket.off('table:update', onTableUpdate);
      socket.emit('table:leave-room', tableId);
    };
  }, [auth, tableId, navigate]);

  useEffect(() => {
    if (!auth || !tableId || state?.status === 'finished') return;
    const ping = () => {
      keepTableAlive(tableId, auth.accessToken).catch(() => undefined);
    };
    ping();
    const id = window.setInterval(ping, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [auth, tableId, state?.status]);

  // A new round means any local pending placement/guess from the previous
  // one is stale - reset it. Deliberately NOT keyed on the whole `state`
  // object, which changes on every broadcast (including ones triggered by
  // other players), or every incidental update would wipe your own
  // in-progress selection.
  useEffect(() => {
    setPendingLocal(null);
    setGuessInput('');
    setTieModalDismissed(false);
    if (state?.currentRound?.roundId) {
      logClientEvent({
        eventType: 'round_seen',
        clientKind: 'player',
        userId: auth?.user.id ?? null,
        tableId: state.tableId,
        gameId: state.gameId,
        roundId: state.currentRound.roundId,
        roundIndex: state.currentRound.indexNo,
        payload: debugRoundPayload(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.currentRound?.roundId]);

  // Remembers the last resolved round's song - and holds the ring flipped
  // to the reveal face for a fixed 5s once a round resolves, matching the
  // prototype's 5s reveal (Playboard.tsx's enterReveal/commitReveal).
  // Deliberately keyed on wall-clock time (revealUntil) rather than on
  // state.currentRound.status === 'resolved': when every player has "auto
  // bereit" locked in, the round-ready window arms and auto-starts the next
  // round the instant this one resolves (see roundReadyWindow.ts /
  // roundReady.ts's applyAutoReadyOnWindowOpen), so currentRound can already
  // be the *next* round's 'countdown' by the time this broadcast arrives -
  // gating on its status would skip the reveal (and the "Letzter Song" box)
  // almost entirely instead of holding it for 5s.
  const roundStatusForReveal = state?.currentRound?.status;
  const roundIdForReveal = state?.currentRound?.roundId;
  const roundIndexForReveal = state?.currentRound?.indexNo;
  useEffect(() => {
    if (roundStatusForReveal !== 'resolved' || !roundIdForReveal || !state) return;
    const round = state.currentRound!;
    setLastResolvedRound((prev) => (prev?.roundId === roundIdForReveal ? prev : round));
    setRevealUntil((prev) => (prev !== null ? prev : Date.now() + REVEAL_MS));
  }, [roundStatusForReveal, roundIdForReveal, state]);

  // If a delayed or held reveal overlaps with the next round's actual song
  // window, prefer the current round. Otherwise the old placement graphic
  // can reappear while the host/display is already playing the next song.
  useEffect(() => {
    if (revealUntil === null || !lastResolvedRound || roundIndexForReveal == null) return;
    if (roundIndexForReveal <= lastResolvedRound.indexNo) return;
    if (roundStatusForReveal === 'countdown') return;
    setRevealUntil(null);
  }, [revealUntil, lastResolvedRound, roundIndexForReveal, roundStatusForReveal]);

  // Once the 5s reveal window has actually elapsed, clear it so a later
  // round can arm its own - comparing against `now` (below) instead of a
  // setTimeout keyed on roundId, since roundId keeps changing under an
  // auto-ready table well before 5s are up.
  useEffect(() => {
    if (revealUntil === null || now < revealUntil) return;
    setRevealUntil(null);
  }, [revealUntil, now]);

  // A Stichsong (bonus round) is entirely derivable from data the client
  // already has - matchOutcome.ts's checkForWinOrTie logic mirrored here.
  // Computed up here (ahead of the `!state` guard below) so the tie-rule
  // reveal timer effect right after it can depend on it like any other hook.
  const maxCardsForTie = Math.max(0, ...(state?.players.map((p) => p.timeline.length) ?? [0]));
  const tiedLeadersForTie = state?.players.filter((p) => p.timeline.length === maxCardsForTie) ?? [];
  const isTieBreakPending = Boolean(state?.roundReadyPhase) && maxCardsForTie >= SLOT_COUNT && tiedLeadersForTie.length > 1;

  // Holds the Stichrunde rule announcement up for a fixed REVEAL_MS once it
  // first becomes relevant to show (i.e. once the *previous* round's own
  // Auflösung has cleared - revealUntil === null), the same way revealUntil
  // itself holds the Auflösung up: readyPhase (which isTieBreakPending
  // depends on) disappears the instant the round actually starts, and at a
  // fully auto-ready table that can happen just as this modal was about to
  // become visible - see roundReady.ts's AUTO_READY_GRACE_MS, which is
  // sized to the *previous* round's reveal, not to "plus however long this
  // modal needs afterwards". Without its own independent timer here, the
  // modal and the round start race each other and the modal loses.
  const [tieRuleUntil, setTieRuleUntil] = useState<number | null>(null);
  useEffect(() => {
    if (!isTieBreakPending || revealUntil !== null || tieModalDismissed) return;
    setTieRuleUntil((prev) => (prev !== null ? prev : Date.now() + REVEAL_MS));
  }, [isTieBreakPending, revealUntil, tieModalDismissed]);
  useEffect(() => {
    if (tieRuleUntil === null || now < tieRuleUntil) return;
    setTieRuleUntil(null);
  }, [tieRuleUntil, now]);

  // Ticks while any timed phase is on screen, so rings/clocks animate
  // smoothly between the (infrequent) real state updates from the server.
  const roundStatus = state?.currentRound?.status;
  useEffect(() => {
    const active =
      state?.roundReadyPhase?.startedAt ||
      (roundStatus && ['countdown', 'playing'].includes(roundStatus)) ||
      state?.status === 'finished' ||
      revealUntil !== null ||
      tieRuleUntil !== null;
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [state?.roundReadyPhase?.startedAt, roundStatus, state?.status, revealUntil, tieRuleUntil]);

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
      logClientEvent({
        eventType: 'audio_source_cleared',
        clientKind: 'player',
        userId: auth?.user.id ?? null,
        tableId: state?.tableId ?? null,
        gameId,
        roundId,
        roundIndex: state?.currentRound?.indexNo ?? null,
        payload: debugRoundPayload({ audio: describeAudioElement(audio) }),
      });
      return;
    }
    audio.src = `${API_BASE_URL}${songStreamPath}`;
    audio.load();
    logClientEvent({
      eventType: 'audio_load_start',
      clientKind: 'player',
      userId: auth?.user.id ?? null,
      tableId: state?.tableId ?? null,
      gameId,
      roundId,
      roundIndex: state?.currentRound?.indexNo ?? null,
      payload: debugRoundPayload({ songStreamPath, audio: describeAudioElement(audio) }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // Plays exactly while the song window is actually open. A token claim
  // (or the round otherwise moving on) stops it immediately - FR-032 and
  // real Hitster both stop the music the instant someone buzzes in.
  //
  // songPlaybackMs is normally equal to the round's full windowMs, so this
  // timer fires right alongside the status change below and changes
  // nothing. The one exception is the Stichrunde (bonus round): there the
  // guess field stays open for a 10s grace period after the Stichsong
  // itself has already finished playing (songPlaybackMs < windowMs), so
  // the music needs to stop on its own timer instead of waiting for the
  // round status to move on.
  const songPlaybackMs = state?.currentRound?.songPlaybackMs;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (roundStatus === 'playing') {
      audio.currentTime = 0;
      logClientEvent({
        eventType: 'audio_play_attempt',
        clientKind: 'player',
        userId: auth?.user.id ?? null,
        tableId: state?.tableId ?? null,
        gameId,
        roundId,
        roundIndex: state?.currentRound?.indexNo ?? null,
        payload: debugRoundPayload({ songPlaybackMs, audio: describeAudioElement(audio) }),
      });
      audio
        .play()
        .then(() => {
          logClientEvent({
            eventType: 'audio_play_success',
            clientKind: 'player',
            userId: auth?.user.id ?? null,
            tableId: state?.tableId ?? null,
            gameId,
            roundId,
            roundIndex: state?.currentRound?.indexNo ?? null,
            payload: debugRoundPayload({ audio: describeAudioElement(audio) }),
          });
        })
        .catch((err) => {
          setAudioUnavailable(true);
          logClientEvent({
            eventType: 'audio_play_rejected',
            clientKind: 'player',
            userId: auth?.user.id ?? null,
            tableId: state?.tableId ?? null,
            gameId,
            roundId,
            roundIndex: state?.currentRound?.indexNo ?? null,
            payload: snapshotClientDebugContext(debugRoundPayload({ errorName: err.name, errorMessage: err.message, audio: describeAudioElement(audio) })),
          });
          void flushClientDebugEvents(true);
        });
      if (songPlaybackMs != null) {
        const timeoutId = window.setTimeout(() => audio.pause(), songPlaybackMs);
        return () => window.clearTimeout(timeoutId);
      }
    } else {
      if (!audio.paused) {
        logClientEvent({
          eventType: 'audio_pause_for_round_status',
          clientKind: 'player',
          userId: auth?.user.id ?? null,
          tableId: state?.tableId ?? null,
          gameId,
          roundId,
          roundIndex: state?.currentRound?.indexNo ?? null,
          payload: debugRoundPayload({ audio: describeAudioElement(audio) }),
        });
      }
      audio.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundStatus, roundId]);

  // The <audio> element's `muted` prop below keeps the DOM node itself in
  // sync declaratively on every render - this just persists the choice.
  useEffect(() => {
    window.localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, String(audioMuted));
    logClientEvent({
      eventType: 'audio_muted_changed',
      clientKind: 'player',
      userId: auth?.user.id ?? null,
      tableId: state?.tableId ?? null,
      gameId,
      roundId: state?.currentRound?.roundId ?? null,
      roundIndex: state?.currentRound?.indexNo ?? null,
      payload: debugRoundPayload(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioMuted]);

  useEffect(() => {
    const onVisibilityChange = () => {
      logClientEvent({
        eventType: 'document_visibility_changed',
        clientKind: 'player',
        userId: auth?.user.id ?? null,
        tableId: state?.tableId ?? null,
        gameId,
        roundId: state?.currentRound?.roundId ?? null,
        roundIndex: state?.currentRound?.indexNo ?? null,
        payload: debugRoundPayload({ visibilityState: document.visibilityState }),
      });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.user.id, gameId, state?.tableId, state?.currentRound?.roundId, state?.currentRound?.indexNo, audioMuted]);

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

  // Hostmodus (gemeinsames Anzeigegerät): once a shared screen is connected
  // for this table (see gameState.ts's displayAnchorPresent), every
  // player's own device switches to showing only their own row - the shared
  // screen is already showing everyone's board, this device is now purely a
  // controller for tapping your own placements - and mutes itself, since
  // the shared screen is the one playing the song out loud for the room.
  const compact = Boolean(state?.displayAnchorPresent);
  const effectiveMuted = compact ? true : audioMuted;

  useWakeLock(Boolean(state) && state?.status !== 'finished');

  const you = state?.players.find((p) => p.userId === auth?.user.id) ?? null;
  const currentUserAutoReady = Boolean(auth && state?.autoReadyUserIds.includes(auth.user.id));
  const boardPlayers = useMemo(() => {
    if (!state) return [];
    if (compact && you) return [you];
    return orderPlayersForPersonalBoard(state.players, auth?.user.id);
  }, [auth?.user.id, compact, state, you]);
  const maxScore = useMemo(() => Math.max(0, ...(state?.players.map((p) => p.timeline.length) ?? [0])), [state]);
  // Global skill rank (see backend/src/services/rankScore.ts), not a
  // per-table placement in this one match - same number as the profile
  // page and leaderboard, so "Rang" means the same thing everywhere.
  const rankMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of state?.players ?? []) map[p.userId] = p.globalRank;
    return map;
  }, [state]);

  async function handleSetReady(ready: boolean) {
    if (!auth || !gameId) return;
    try {
      await setRoundReady(gameId, auth.accessToken, ready);
      setError(null);
    } catch {
      setError('Bereit-Status konnte nicht gesetzt werden.');
    }
  }

  async function handleToggleAutoReady() {
    if (!auth || !gameId) return;
    const isAutoReady = state?.autoReadyUserIds.includes(auth.user.id) ?? false;
    try {
      await setAutoReady(gameId, auth.accessToken, !isAutoReady);
      setError(null);
    } catch {
      setError('Auto bereit konnte nicht gesetzt werden.');
    }
  }

  function handleTieBreakAcknowledge() {
    setTieModalDismissed(true);
    handleSetReady(true);
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
        // Deliberately not cleared here: a Stichrunde guess is a one-shot
        // exact-year attempt with no other on-screen record of what was
        // typed, so the field keeps showing it - grayed out once
        // exactYearAttemptedUserIds includes you turns guessActive false
        // below - until the round resolves or the roundId-keyed reset
        // effect clears it for the next one.
      } else {
        await submitTokenGuess(gameId, round.roundId, auth.accessToken, year);
        setGuessInput('');
      }
    } catch {
      setError('Jahr konnte nicht übermittelt werden.');
    }
  }

  function handleExportPdf() {
    if (!state) return;
    buildGameSummaryPdf(state).catch(() => setError('PDF konnte nicht erstellt werden.'));
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
  // maxCardsForTie/tiedLeadersForTie/isTieBreakPending are computed above,
  // ahead of the `!state` guard (see the tieRuleUntil effect's comment).
  const tiedLeaders = tiedLeadersForTie;

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
  } else if (revealUntil !== null && now < revealUntil) {
    // Checked before readyPhase (and even before a next round that may
    // already be under way, see the revealUntil effect above) on purpose:
    // the ready window now arms itself automatically the instant a round
    // resolves (see roundReadyWindow.ts), so roundReadyPhase is already
    // non-null here too - without this ordering the ring would flip
    // straight to the "Bereit?" prompt and the reveal would never actually
    // be seen for its full 5s, especially at a fully auto-ready table.
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
      // A Stichrunde's guess window (windowMs) outlasts its own song
      // (songPlaybackMs) by a fixed grace period (BONUS_WINDOW_MS -
      // BONUS_SONG_DURATION_MS, ~10s) - see roundConfig.ts. Once the music
      // has actually stopped, this needs to read as its own "Beeil dich!"
      // countdown ticking the grace period down to zero, not as a
      // continuation of the same song-progress ring counting down the full
      // (song + grace) window - a shared counter across two different
      // phases reads as one long countdown that mysteriously doesn't line
      // up with when the music stopped.
      const hurryUp = round.mode === 'bonus' && elapsed >= round.songPlaybackMs;
      if (hurryUp) {
        const graceMs = Math.max(1, round.windowMs - round.songPlaybackMs);
        const graceElapsed = elapsed - round.songPlaybackMs;
        ringMark = String(Math.ceil(remaining / 1000) || 1);
        ringLabel = 'Beeil dich!';
        progress = clamp01(graceElapsed / graceMs);
        frontState = 'pb-counting';
        deckCaption = `Noch ${Math.ceil(remaining / 1000)}s zum Tippen`;
        phaseLabel = 'Letzte Chance zu tippen';
      } else {
        ringMark = '♪';
        ringLabel = 'läuft';
        progress = clamp01(elapsed / round.windowMs);
        frontState = 'pb-playing';
        deckCaption = `${Math.ceil(remaining / 1000)}s verbleibend`;
        phaseLabel = 'Songfenster offen';
      }
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
              className={`pb-icon-btn pb-auto-ready${currentUserAutoReady ? ' pb-active' : ''}`}
              title={currentUserAutoReady ? 'Auto bereit ausschalten' : 'Auto bereit einschalten'}
              aria-label="Auto bereit ein/aus"
              disabled={!you}
              onClick={handleToggleAutoReady}
            >
              &#8635;
            </button>
            <button
              className="pb-icon-btn"
              title={
                compact
                  ? 'Ton läuft auf dem Anzeigegerät'
                  : audioUnavailable
                    ? 'Kein Ton für diesen Song verfügbar'
                    : audioMuted
                      ? 'Ton einschalten'
                      : 'Ton ausschalten'
              }
              aria-label="Ton ein/aus"
              disabled={compact}
              onClick={() => setAudioMuted((m) => !m)}
            >
              {effectiveMuted ? '🔇' : '🔊'}
            </button>
            <div className="pb-brand-mark">AS</div>
            <div>
              <div className="pb-brand-title">Songster</div>
              <div className="pb-brand-sub">{compact ? 'Anzeigegerät verbunden' : 'Live-Partie'}</div>
            </div>
            <div className="pb-brand-ids" title={`Tisch-ID: ${state.tableId}\nPlaylist-ID: ${state.playlistId}`}>
              <span>Tisch {state.tableId.slice(0, 8)}</span>
              <span>Playlist {state.playlistId.slice(0, 8)}</span>
            </div>
          </div>
          <div className="pb-round-pill">
            <span className="pb-round-dot" />
            &nbsp;Runde <b>{round?.indexNo ?? '—'}</b> &middot; <span>{phaseLabel}</span>
          </div>
        </div>

        <audio
          ref={audioRef}
          preload="auto"
          muted={effectiveMuted}
          onCanPlay={() => {
            const audio = audioRef.current;
            if (!audio) return;
            logClientEvent({
              eventType: 'audio_canplay',
              clientKind: 'player',
              userId: auth?.user.id ?? null,
              tableId: state?.tableId ?? null,
              gameId,
              roundId: state?.currentRound?.roundId ?? null,
              roundIndex: state?.currentRound?.indexNo ?? null,
              payload: debugRoundPayload({ audio: describeAudioElement(audio) }),
            });
          }}
          onWaiting={() => {
            const audio = audioRef.current;
            if (!audio) return;
            logClientEvent({
              eventType: 'audio_waiting',
              clientKind: 'player',
              userId: auth?.user.id ?? null,
              tableId: state?.tableId ?? null,
              gameId,
              roundId: state?.currentRound?.roundId ?? null,
              roundIndex: state?.currentRound?.indexNo ?? null,
              payload: debugRoundPayload({ audio: describeAudioElement(audio) }),
            });
          }}
          onError={() => {
            const audio = audioRef.current;
            setAudioUnavailable(true);
            logClientEvent({
              eventType: 'audio_error',
              clientKind: 'player',
              userId: auth?.user.id ?? null,
              tableId: state?.tableId ?? null,
              gameId,
              roundId: state?.currentRound?.roundId ?? null,
              roundIndex: state?.currentRound?.indexNo ?? null,
              payload: snapshotClientDebugContext(debugRoundPayload({ audio: audio ? describeAudioElement(audio) : null })),
            });
            void flushClientDebugEvents(true);
          }}
        />

        {error && (
          <div className="sh-error" style={{ marginBottom: 4 }}>
            {error}
          </div>
        )}

        <div className="pb-board">
          {boardPlayers.map((p) => {
            const isSelf = p.userId === you?.userId;
            const sittingOut = round?.sitOutUserIds.includes(p.userId) ?? false;

            let slots: (number | null)[];
            let pendingSlot: number | null = null;
            let pendingResult: PendingResult = null;
            if (!dealt) {
              slots = animatedSlots?.[p.userId] ?? nullSlots();
            } else if (revealUntil !== null && now < revealUntil && lastResolvedRound?.mode === 'normal') {
              // Server-truth reveal for *every* player, not just yourself -
              // everyone's guessed position is shown colored red/green for
              // the full reveal window, matching the approved prototype
              // (playboard/PlayerRow.tsx's pendingSlot/pendingResult tile).
              // Gated on revealUntil (see above), not round.status ===
              // 'resolved' directly - an all-auto-ready table can already be
              // several statuses further along by the time this renders.
              const mine = lastResolvedRound.results.find((r) => r.userId === p.userId);
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
              autoReady: state.autoReadyUserIds.includes(p.userId),
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
                onToggleAutoReady={isSelf ? handleToggleAutoReady : undefined}
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
                reaction={reactionsByUser[p.userId]
                  ? { emoji: reactionsByUser[p.userId].symbol, label: reactionsByUser[p.userId].label }
                  : undefined}
              />
            );
          })}
        </div>

        <ReactionBar
          phase={communicationPhase(state)}
          reactions={state.reactionConfig[communicationPhase(state)]}
          sending={sendingReaction}
          onReact={handleReaction}
        />

        <div className="pb-hint">
          {compact && <>Punktestand und Mitspieler siehst du auf dem Anzeigegerät. </>}
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
              revealSong={lastResolvedRound ? { artist: lastResolvedRound.songArtist ?? '', title: lastResolvedRound.songTitle ?? '', year: lastResolvedRound.songYear ?? 0 } : null}
              onClick={canReadyNow ? () => handleSetReady(true) : () => undefined}
              wrapRef={(el) => (ringWrapRef.current = el)}
            />
            <div className="pb-deck-caption">{deckCaption || '30s Bereit-Fenster · 3s Countdown · 25s Songfenster'}</div>
          </div>

          <div className="pb-status-card">
            <div className="pb-status-row">
              <span>Letzter Song</span>
              <b>{lastResolvedRound ? `${lastResolvedRound.songArtist} – ${lastResolvedRound.songTitle} (${lastResolvedRound.songYear})` : '—'}</b>
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

      <div
        // Gated on tieRuleUntil (a fixed-length reveal, see its effect
        // above), not isTieBreakPending directly: readyPhase disappears the
        // instant the round actually starts, which at a fully auto-ready
        // table can happen right as this modal was about to show - without
        // its own independent timer, this and the round start race each
        // other and the modal loses (visible for ~1s or less).
        className={`pb-modal-overlay${tieRuleUntil !== null && now < tieRuleUntil && !tieModalDismissed ? ' pb-open' : ''}`}
        onClick={(e) => e.target === e.currentTarget && handleTieBreakAcknowledge()}
      >
        <div className="pb-modal">
          <h3>🎯 Punktgleichheit! Jetzt Stichrunde</h3>
          <p>
            <b>{tiedLeaders.map((p) => p.username).join(', ')}</b> haben gleichzeitig {SLOT_COUNT} Karten erreicht.
            Es gibt jetzt eine Stichrunde: alle Angetretenen hören denselben Song und tippen das Erscheinungsjahr
            statt eine Position zu platzieren. Nach dem Song bleibt das Eingabefeld noch 10 Sekunden offen. Wer am
            nächsten dran ist, gewinnt die ganze Partie — bei Gleichstand die schnellste Eingabe, ein exaktes Jahr
            gewinnt sofort. Tippt niemand etwas ein, gibt es die nächste Stichrunde mit einem neuen Song.
          </p>
          <div className="pb-modal-actions">
            <button className="pb-modal-btn pb-primary" onClick={handleTieBreakAcknowledge}>
              Verstanden
            </button>
          </div>
        </div>
      </div>

      {revealUntil !== null && now < revealUntil && lastResolvedRound?.mode === 'bonus' && (
        <div className="pb-modal-overlay pb-open">
          <div className="pb-modal">
            <h3>🎯 Stichrunde: Auflösung</h3>
            <p>
              Der Song erschien <b>{lastResolvedRound.songYear}</b>.
            </p>
            {lastResolvedRound.results.some((r) => r.submitted) ? (
              <ol className="pb-winner-standings">
                {[...lastResolvedRound.results]
                  .filter((r) => r.submitted)
                  .sort(
                    (a, b) =>
                      Math.abs((a.guessedYear ?? 0) - (lastResolvedRound.songYear ?? 0)) -
                      Math.abs((b.guessedYear ?? 0) - (lastResolvedRound.songYear ?? 0)),
                  )
                  .map((r) => {
                    const player = state.players.find((p) => p.userId === r.userId);
                    const won = r.userId === state.winnerUserId;
                    return (
                      <li key={r.userId} className={`pb-winner-row${won ? ' pb-winner-you' : ''}`}>
                        <span className="pb-winner-row-name">
                          {player?.username ?? '?'}
                          {won ? ' 👑' : ''}
                        </span>
                        <span className="pb-winner-row-cards">{r.guessedYear ?? '—'}</span>
                      </li>
                    );
                  })}
              </ol>
            ) : (
              <p>Niemand hat getippt — es gibt einen neuen Stichsong.</p>
            )}
          </div>
        </div>
      )}

      {state.status === 'finished' &&
        revealUntil === null &&
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

                <ReactionBar phase="finished" reactions={state.reactionConfig.finished} sending={sendingReaction} onReact={handleReaction} />

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
                  <button className="pb-winner-exit" onClick={handleExportPdf}>
                    📄 Als PDF speichern
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
