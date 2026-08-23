import { useEffect, useReducer, useRef } from 'react';
import './Playboard.css';
import { PlayerRow } from './PlayerRow';
import { CenterControl } from './CenterControl';
import { ExitModal, HelpModal } from './Modals';
import { SONGS } from './songs';
import { Phase, PlayerState, Song, SLOT_COUNT } from './types';
import { filledCount, findCorrectSlot, freshSlots, isCorrectPlacement, karmaLeavePenalty, placeAt, ranksByPoints } from './gameLogic';

/*
 * Implements docs/Adolar_Songster_Playboard_UI_Spec_v1_20260822.md.
 *
 * The round/timer choreography (ready phase -> countdown -> song -> reveal)
 * is deliberately kept as an imperative "engine" object in a ref rather than
 * spread across many useState calls: the logic is a state machine driven by
 * setTimeout/setInterval callbacks, and threading every field through React
 * state setters would just reintroduce the stale-closure bugs this pattern
 * avoids. `rerender()` is called after every engine mutation that should be
 * reflected on screen. Pure helpers (placement/correctness/ranking) still
 * live in gameLogic.ts and are unit-testable in isolation.
 *
 * TODO(real-time): this file currently drives everything locally (no
 * socket). Wiring to the backend means replacing the local "engine" mutations
 * in toggleReady/placeAtHandler/useToken/etc. with emitted events, and
 * replacing the imperative round transitions with handlers for the
 * corresponding server-pushed state updates.
 */

function initialPlayers(): PlayerState[] {
  return [
    { id: 'you', name: 'Du', you: true, initials: 'DU', slots: freshSlots(), roundStartSlots: null, pendingSlot: null, pendingResult: null, tokenState: 'idle', tokenGuess: null, songsterPoints: 118, karma: 88, ready: false, sittingOut: false },
    { id: 'p2', name: 'Spieler2', you: false, initials: 'S2', slots: freshSlots(), roundStartSlots: null, pendingSlot: null, pendingResult: null, tokenState: 'idle', tokenGuess: null, songsterPoints: 94, karma: 76, ready: false, sittingOut: false },
    { id: 'p3', name: 'Spieler3', you: false, initials: 'S3', slots: freshSlots(), roundStartSlots: null, pendingSlot: null, pendingResult: null, tokenState: 'idle', tokenGuess: null, songsterPoints: 150, karma: 95, ready: false, sittingOut: false },
    { id: 'p4', name: 'Spieler4', you: false, initials: 'S4', slots: freshSlots(), roundStartSlots: null, pendingSlot: null, pendingResult: null, tokenState: 'idle', tokenGuess: null, songsterPoints: 71, karma: 60, ready: false, sittingOut: false },
    { id: 'p5', name: 'Spieler5', you: false, initials: 'S5', slots: freshSlots(), roundStartSlots: null, pendingSlot: null, pendingResult: null, tokenState: 'idle', tokenGuess: null, songsterPoints: 103, karma: 82, ready: false, sittingOut: false },
  ];
}

interface Engine {
  players: PlayerState[];
  phase: Phase;
  phaseLabel: string;
  roundNo: number;
  currentSong: Song | null;
  lastSong: Song | null;
  tokensLeft: number;
  followUpActive: boolean;
  songPool: Song[];
  ringMark: string;
  ringLabel: string;
  frontState: '' | 'pb-counting' | 'pb-playing';
  flipped: boolean;
  progress: number;
  timeLeftLabel: string;
  youGuessValue: string;
  exitOpen: boolean;
  helpOpen: boolean;
}

function makeEngine(): Engine {
  return {
    players: initialPlayers(),
    phase: 'dealing',
    phaseLabel: 'Karten werden verteilt…',
    roundNo: 1,
    currentSong: null,
    lastSong: null,
    tokensLeft: 2,
    followUpActive: false,
    songPool: [...SONGS],
    ringMark: '?',
    ringLabel: 'Bereit?',
    frontState: '',
    flipped: false,
    progress: 0,
    timeLeftLabel: '—',
    youGuessValue: '',
    exitOpen: false,
    helpOpen: false,
  };
}

export function Playboard() {
  const engine = useRef(makeEngine()).current;
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const rerender = () => bump();

  const timers = useRef<{ countdown?: number; song?: number; reveal?: number; waiting?: number; token?: number }>({});
  const timelineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const ringWrapRef = useRef<HTMLDivElement | null>(null);
  const dealStartedRef = useRef(false);

  function updatePlayer(id: string, patch: Partial<PlayerState>) {
    engine.players = engine.players.map((p) => (p.id === id ? { ...p, ...patch } : p));
  }

  function clearTimers() {
    Object.values(timers.current).forEach((t) => t && (window.clearTimeout(t), window.clearInterval(t)));
    timers.current = {};
  }

  useEffect(() => {
    // Guarded by a ref (not cleanup-cancelled) so React 18 StrictMode's
    // dev-only double-invoke of effects doesn't cancel the deal timer on
    // its simulated unmount before the real mount can use it.
    if (dealStartedRef.current) return;
    dealStartedRef.current = true;
    window.setTimeout(() => dealCards(), 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTimers(), []);

  /* ---------- readiness phase ---------- */

  function toggleReady(id: string) {
    if (engine.phase !== 'idle' && engine.phase !== 'waiting') return;
    const p = engine.players.find((x) => x.id === id);
    if (!p) return;
    updatePlayer(id, { ready: !p.ready });
    if (engine.phase === 'idle') {
      const justReadied = engine.players.find((x) => x.id === id)?.ready;
      if (justReadied) enterWaiting();
      else rerender();
      return;
    }
    checkAllReady();
  }

  function enterWaiting() {
    engine.phase = 'waiting';
    engine.frontState = 'pb-counting';
    engine.phaseLabel = 'Warte auf Mitspieler';
    engine.ringLabel = 'Warte…';
    let secs = 30;
    engine.ringMark = String(secs);
    engine.progress = 0;
    rerender();
    timers.current.waiting = window.setInterval(() => {
      secs -= 1;
      engine.progress = (30 - secs) / 30;
      if (secs <= 0) {
        window.clearInterval(timers.current.waiting);
        engine.players = engine.players.map((p) => (p.ready ? p : { ...p, sittingOut: true }));
        startCountdown();
      } else {
        engine.ringMark = String(secs);
        rerender();
      }
    }, 1000);
  }

  function checkAllReady() {
    if (engine.phase !== 'waiting') {
      rerender();
      return;
    }
    if (engine.players.every((p) => p.ready)) {
      window.clearInterval(timers.current.waiting);
      startCountdown();
    } else {
      rerender();
    }
  }

  /* ---------- countdown / song / reveal ---------- */

  function startCountdown() {
    clearTimers();
    engine.phase = 'countdown';
    engine.frontState = 'pb-counting';
    engine.phaseLabel = 'Countdown läuft';
    engine.players = engine.players.map((p) => ({ ...p, pendingSlot: null, pendingResult: null, tokenState: 'idle', tokenGuess: null }));
    engine.followUpActive = false;
    let n = 3;
    engine.ringMark = String(n);
    engine.ringLabel = 'los geht’s';
    engine.progress = 0;
    rerender();
    timers.current.countdown = window.setInterval(() => {
      n -= 1;
      engine.progress = (3 - n) / 3;
      if (n <= 0) {
        window.clearInterval(timers.current.countdown);
        startSong();
      } else {
        engine.ringMark = String(n);
        rerender();
      }
    }, 1000);
  }

  function startSong() {
    engine.phase = 'playing';
    engine.frontState = 'pb-playing';
    engine.ringMark = '♪';
    engine.ringLabel = 'läuft';
    engine.phaseLabel = 'Songfenster offen';
    if (!engine.songPool.length) engine.songPool = [...SONGS];
    const idx = Math.floor(Math.random() * engine.songPool.length);
    engine.currentSong = engine.songPool.splice(idx, 1)[0];
    engine.players = engine.players.map((p) => ({ ...p, roundStartSlots: p.slots.slice() }));
    let t = 25;
    engine.timeLeftLabel = `${t}s`;
    engine.progress = 0;
    rerender();
    timers.current.song = window.setInterval(() => {
      t -= 1;
      engine.timeLeftLabel = `${Math.max(t, 0)}s`;
      engine.progress = (25 - t) / 25;
      if (t <= 0) {
        window.clearInterval(timers.current.song);
        enterReveal();
      } else {
        rerender();
      }
    }, 1000);
  }

  function enterReveal() {
    if (engine.phase === 'reveal') return;
    window.clearInterval(timers.current.song);
    clearTimers();
    engine.phase = 'reveal';
    engine.flipped = true;
    engine.phaseLabel = 'Auflösung';
    engine.timeLeftLabel = '—';

    engine.players = engine.players.map((p) => {
      if (p.pendingSlot === null || !p.roundStartSlots) return p;
      const ok = isCorrectPlacement(p.slots, p.pendingSlot, engine.currentSong!.year);
      return { ...p, pendingResult: ok ? 'good' : 'bad' };
    });
    rerender();

    timers.current.reveal = window.setTimeout(commitReveal, 5000);
  }

  function commitReveal() {
    const song = engine.currentSong!;
    engine.players = engine.players.map((p) => {
      let slots = p.slots;
      const pendingSlot = p.pendingSlot;
      if (pendingSlot !== null) {
        if (p.pendingResult === 'good') {
          slots = p.slots.slice();
          slots[pendingSlot] = song.year;
        } else if (p.roundStartSlots) {
          slots = p.roundStartSlots.slice();
        }
      }
      return { ...p, slots, pendingSlot: null, pendingResult: null, tokenState: 'idle', tokenGuess: null, ready: false, sittingOut: false };
    });
    engine.lastSong = song;
    engine.followUpActive = false;
    engine.flipped = false;
    engine.frontState = '';
    engine.ringMark = '?';
    engine.ringLabel = 'Bereit?';
    engine.phaseLabel = 'Runde beendet – als bereit melden für die nächste';
    engine.progress = 0;
    engine.phase = 'idle';
    engine.roundNo += 1;
    rerender();
  }

  /* ---------- placement ---------- */

  function placeAtHandler(desiredIndex: number) {
    if (engine.phase !== 'playing') return;
    const you = engine.players[0];
    if (you.sittingOut || !you.roundStartSlots) return;
    const result = placeAt(you.roundStartSlots, desiredIndex);
    if (!result) return; // Zeitleiste voll
    updatePlayer('you', { slots: result.slots, pendingSlot: result.landingIndex });
    rerender();
  }

  function onConfirm() {
    // Placement already committed to pendingSlot on click; confirm just
    // acknowledges per UX-002 (bestätigen). Nothing further to persist here.
  }

  function onClear() {
    const you = engine.players[0];
    if (you.roundStartSlots) updatePlayer('you', { slots: you.roundStartSlots.slice(), pendingSlot: null });
    else updatePlayer('you', { pendingSlot: null });
    rerender();
  }

  /* ---------- token + exact-year guess ---------- */

  function spendToken() {
    if (engine.phase !== 'playing' || engine.tokensLeft <= 0) return;
    const you = engine.players[0];
    if (you.sittingOut) return;
    engine.tokensLeft -= 1;
    window.clearInterval(timers.current.song);
    updatePlayer('you', { tokenState: 'entering' });
    engine.phaseLabel = 'Du hast gebuzzert – Jahr eingeben (10s)';
    engine.youGuessValue = '';
    rerender();
    timers.current.token = window.setTimeout(() => {
      const cur = engine.players[0];
      if (cur.tokenState === 'entering') {
        updatePlayer('you', { tokenState: 'wrong', tokenGuess: null });
        enterReveal();
      }
    }, 10000);
  }

  function submitYouGuess() {
    const year = parseInt(engine.youGuessValue, 10);
    if (!year || !engine.currentSong) return;
    window.clearInterval(timers.current.song);
    const you = engine.players[0];
    if (year === engine.currentSong.year) {
      const slot = you.roundStartSlots ? findCorrectSlot(you.roundStartSlots, year) : null;
      updatePlayer('you', { pendingSlot: slot });
      engine.phaseLabel = 'Jahr richtig erraten!';
    } else {
      updatePlayer('you', { tokenState: 'wrong', tokenGuess: year });
      engine.phaseLabel = 'Leider falsch geraten.';
    }
    engine.followUpActive = false;
    rerender();
    enterReveal();
  }

  /* ---------- exit / help ---------- */

  function openExit() {
    engine.exitOpen = true;
    rerender();
  }
  function closeExit() {
    engine.exitOpen = false;
    rerender();
  }
  function confirmExit() {
    engine.exitOpen = false;
    engine.phaseLabel = `Tisch verlassen (Prototyp) – ${karmaLeavePenalty(engine.players.length)} Karma`;
    rerender();
    // TODO(real-time): emit leave-table event, navigate back to lobby.
  }
  function openHelp() {
    engine.helpOpen = true;
    rerender();
  }
  function closeHelp() {
    engine.helpOpen = false;
    rerender();
  }

  /* ---------- initial deal animation ---------- */

  function dealCards() {
    engine.phaseLabel = 'Karten werden verteilt…';
    engine.players = engine.players.map((p) => ({ ...p, slots: new Array(SLOT_COUNT).fill(null) }));
    rerender();

    const centerRect = ringWrapRef.current?.getBoundingClientRect();
    if (!centerRect) {
      engine.phase = 'idle';
      engine.phaseLabel = 'Bereit für Runde 1';
      engine.players = engine.players.map((p) => ({ ...p, slots: freshSlots() }));
      rerender();
      return;
    }
    const cx = centerRect.left + centerRect.width / 2 - 34;
    const cy = centerRect.top + centerRect.height / 2 - 38;

    const STARTER_SLOTS = [4, 5];
    const STARTER_YEARS = [1986, 2004];

    let delay = 0;
    engine.players.forEach((p) => {
      STARTER_SLOTS.forEach((slotIdx, ci) => {
        const year = STARTER_YEARS[ci];
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
            const timelineEl = timelineRefs.current.get(p.id);
            const targetBox = timelineEl?.children[slotIdx] as HTMLElement | undefined;
            const rect = targetBox?.getBoundingClientRect() ?? centerRect;
            const tx = rect.left + rect.width / 2 - 34 - cx;
            const ty = rect.top + rect.height / 2 - 38 - cy;
            ghost.style.transform = `translate(${tx}px, ${ty}px) scale(${p.you ? 0.95 : 0.65}) rotate(${(Math.random() * 30 - 15).toFixed(0)}deg)`;
            ghost.style.opacity = '0';
          });
          window.setTimeout(() => {
            updatePlayer(p.id, {
              slots: (() => {
                const s = engine.players.find((x) => x.id === p.id)!.slots.slice();
                s[slotIdx] = year;
                return s;
              })(),
            });
            rerender();
            ghost.remove();
          }, 560);
        }, myDelay);
      });
    });

    window.setTimeout(() => {
      engine.phase = 'idle';
      engine.phaseLabel = 'Bereit für Runde 1';
      rerender();
    }, delay + 700);
  }

  /* ---------- derived / render ---------- */

  const maxScore = Math.max(...engine.players.map(filledCount));
  const rankMap = ranksByPoints(engine.players);
  const canReady = engine.phase === 'idle' || engine.phase === 'waiting';
  const currentSongYear = engine.currentSong?.year ?? null;

  return (
    <div className="playboard">
      <div className="pb-app">
        <div className="pb-topbar">
          <div className="pb-brand">
            <button className="pb-icon-btn pb-exit" title="Tisch verlassen" aria-label="Tisch verlassen" onClick={openExit}>
              &#10005;
            </button>
            <button className="pb-icon-btn" title="Kurzanleitung" aria-label="Kurzanleitung" onClick={openHelp}>
              ?
            </button>
            <div className="pb-brand-mark">AS</div>
            <div>
              <div className="pb-brand-title">Songster</div>
              <div className="pb-brand-sub">Zeitleisten-Ratespiel</div>
            </div>
          </div>
          <div className="pb-round-pill">
            <span className="pb-round-dot" />
            &nbsp;Runde <b>{engine.roundNo}</b> &middot; <span>{engine.phaseLabel}</span>
          </div>
        </div>

        <div className="pb-board">
          {engine.players.map((p) => (
            <PlayerRow
              key={p.id}
              player={p}
              isLeader={filledCount(p) === maxScore}
              rank={rankMap[p.id]}
              canReady={canReady}
              onToggleReady={() => toggleReady(p.id)}
              onGapClick={p.you ? placeAtHandler : undefined}
              onHandleClick={p.you ? placeAtHandler : undefined}
              onConfirm={p.you ? onConfirm : undefined}
              onClear={p.you ? onClear : undefined}
              currentSongYear={currentSongYear}
              guessValue={engine.youGuessValue}
              guessActive={p.you ? p.tokenState === 'entering' || engine.followUpActive : false}
              guessWrongValue={p.tokenState === 'wrong' ? p.tokenGuess : null}
              onGuessChange={p.you ? (v) => { engine.youGuessValue = v; rerender(); } : undefined}
              onGuessSubmit={p.you ? submitYouGuess : undefined}
              timelineRef={(el) => {
                if (el) timelineRefs.current.set(p.id, el);
              }}
            />
          ))}
        </div>

        <div className="pb-hint">
          Klick auf eine <b>Lücke</b> in deiner Zeitleiste, um die Einfügeposition zu wählen &mdash; dann mit <b>&#10003;</b>{' '}
          bestätigen oder mit einem Songster-Token buzzern.
        </div>

        <div className="pb-deck">
          <div className="pb-tokens">
            <button className="pb-token-btn" title="Deine Songster Token" disabled={engine.tokensLeft <= 0} onClick={spendToken}>
              <span className="pb-token-glyph">S</span>
            </button>
            <button className="pb-token-btn" title="Deine Songster Token" disabled={engine.tokensLeft <= 0} onClick={spendToken}>
              <span className="pb-token-glyph">S</span>
            </button>
          </div>

          <div className="pb-center-control">
            <CenterControl
              ringMark={engine.ringMark}
              ringLabel={engine.ringLabel}
              progress={engine.progress}
              frontState={engine.frontState}
              flipped={engine.flipped}
              revealSong={engine.lastSong}
              onClick={() => toggleReady('you')}
              wrapRef={(el) => (ringWrapRef.current = el)}
            />
            <div className="pb-deck-caption">30s Bereit-Fenster &middot; 3s Countdown &middot; 25s Songfenster</div>
          </div>

          <div className="pb-status-card">
            <div className="pb-status-row">
              <span>Letzter Song</span>
              <b>{engine.lastSong ? `${engine.lastSong.artist} – ${engine.lastSong.title} (${engine.lastSong.year})` : '—'}</b>
            </div>
            <div className="pb-status-row">
              <span>Verbleibend</span>
              <b>{engine.timeLeftLabel}</b>
            </div>
            <div className="pb-status-row">
              <span>Deine Token</span>
              <b>{engine.tokensLeft}</b>
            </div>
          </div>
        </div>
      </div>

      <ExitModal open={engine.exitOpen} karmaPenalty={karmaLeavePenalty(engine.players.length)} onCancel={closeExit} onConfirm={confirmExit} />
      <HelpModal open={engine.helpOpen} onClose={closeHelp} />
    </div>
  );
}
