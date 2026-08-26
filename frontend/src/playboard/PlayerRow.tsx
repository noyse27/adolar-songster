import { useEffect, useRef } from 'react';
import { SLOT_COUNT, STARTER_YEARS, PlayerState } from './types';

// Browsers fire click, click, dblclick for a double-click gesture - they
// don't suppress the two intervening clicks. Wiring onToggleReady straight
// to onClick meant the *first* click of a double-click could already mark
// the last remaining player ready and start the round server-side, so the
// second click then hit a game no longer accepting a ready-toggle and
// errored out (see LiveGameBoard's handleSetReady). Debouncing the click
// lets a genuine double-click be recognized before either action fires.
const DOUBLE_CLICK_MS = 280;

interface PlayerRowProps {
  player: PlayerState;
  isLeader: boolean;
  rank: number;
  canReady: boolean;
  onToggleReady: () => void;
  onToggleAutoReady?: () => void;
  onGapClick?: (index: number) => void;
  onHandleClick?: (index: number) => void;
  onConfirm?: () => void;
  onClear?: () => void;
  currentSongYear: number | null;
  guessValue: string;
  guessActive: boolean;
  guessWrongValue: number | null;
  onGuessChange?: (value: string) => void;
  onGuessSubmit?: () => void;
  timelineRef?: (el: HTMLDivElement | null) => void;
  reaction?: { emoji: string; label: string };
}

export function PlayerRow({
  player: p,
  isLeader,
  rank,
  canReady,
  onToggleReady,
  onToggleAutoReady,
  onGapClick,
  onHandleClick,
  onConfirm,
  onClear,
  currentSongYear,
  guessValue,
  guessActive,
  guessWrongValue,
  onGuessChange,
  onGuessSubmit,
  timelineRef,
  reaction,
}: PlayerRowProps) {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  function handleAvatarClick() {
    if (!canReady) return;
    if (clickTimer.current) {
      // Second click within the window - this is a double-click.
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onToggleAutoReady?.();
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onToggleReady();
    }, DOUBLE_CLICK_MS);
  }

  const score = p.slots.filter((v) => v != null).length;
  const rowClasses = [
    'pb-row',
    p.you ? 'pb-you' : '',
    p.tokenState === 'entering' ? 'pb-buzzed' : '',
    p.sittingOut ? 'pb-sitting-out' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const boxes: JSX.Element[] = [];

  // Centering N cards in SLOT_COUNT boxes (see timelineSlots.ts's
  // embedTimeline) splits the leftover empty slots unevenly once fewer
  // than 2 remain - the single last empty slot always ends up on the
  // right, so at 9/10 filled there is no ordinary gap box left on the
  // left to click "insert before everything". Same fix as the interior
  // insert-handles below, just anchored at the boundary instead of
  // between two filled slots.
  if (p.you && p.slots[0] != null) {
    boxes.push(
      <div
        key="edge-start"
        className="pb-insert-handle pb-insert-handle-edge"
        title="Karte hier einschieben"
        onClick={onHandleClick ? () => onHandleClick(0) : undefined}
      >
        <span className="pb-gap-plus">+</span>
      </div>,
    );
  }

  for (let i = 0; i < SLOT_COUNT; i++) {
    const val = p.slots[i];
    if (p.pendingSlot === i) {
      const cls = p.pendingResult === 'good' ? 'pb-tile pb-reveal-good' : p.pendingResult === 'bad' ? 'pb-tile pb-reveal-bad' : 'pb-tile pb-pending';
      const label = p.pendingResult ? (currentSongYear ?? '') : '?';
      boxes.push(
        <div key={i} className={cls}>
          {label}
        </div>,
      );
    } else if (val != null) {
      boxes.push(
        <div key={i} className="pb-tile pb-filled">
          {val}
        </div>,
      );
    } else {
      boxes.push(
        <div
          key={i}
          className="pb-gap"
          onClick={p.you && onGapClick ? () => onGapClick(i) : undefined}
        >
          <span className="pb-gap-plus">+</span>
        </div>,
      );
    }

    if (p.you && i < SLOT_COUNT - 1 && p.slots[i] != null && p.slots[i + 1] != null) {
      const targetIndex = i + 1;
      boxes.push(
        <div
          key={`h${i}`}
          className="pb-insert-handle"
          title="Karte hier einschieben"
          onClick={onHandleClick ? () => onHandleClick(targetIndex) : undefined}
        >
          <span className="pb-gap-plus">+</span>
        </div>,
      );
    }
  }

  const inputClasses = ['pb-guess-input'];
  if (guessActive) inputClasses.push('pb-active');
  if (guessWrongValue != null) inputClasses.push('pb-wrong');

  return (
    <div className={rowClasses}>
      <div className="pb-player">
        {reaction && (
          <div className="pb-reaction-bubble" role="status" aria-label={`${p.name}: ${reaction.label}`}>
            <span aria-hidden="true">{reaction.emoji}</span>
            <small>{reaction.label}</small>
          </div>
        )}
        <div
          className={`pb-avatar-wrap${canReady ? '' : ' pb-static'}`}
          onClick={canReady ? handleAvatarClick : undefined}
          title={canReady ? 'Klick: bereit. Doppelklick: Auto bereit (für diese Partie gelockt).' : undefined}
        >
          <div className="pb-avatar">{p.initials}</div>
          <div className={`pb-ready-badge${p.autoReady ? ' pb-ready-locked' : p.ready ? ' pb-ready' : ''}`}>
            {p.autoReady ? '🔒' : p.ready ? '✓' : ''}
          </div>
          <div className="pb-tooltip">
            Songster-Punkte: <b>{p.songsterPoints}</b>
            <br />
            Karma-Punkte: <b>{p.karma}</b>
            <br />
            Rang: <b>#{rank}</b>
            {p.autoReady && (
              <>
                <br />
                Auto bereit: <b>an</b>
              </>
            )}
          </div>
        </div>
        <div className="pb-player-meta">
          <div className="pb-player-name">
            {p.name}
            {isLeader && score > STARTER_YEARS.length && (
              <span className="pb-crown" title="Führung">
                &#128081;
              </span>
            )}
          </div>
          <div className="pb-player-score">
            {score}/{SLOT_COUNT}
            <span className="pb-score-track">
              <span className="pb-score-fill" style={{ width: `${score * 10}%` }} />
            </span>
          </div>
        </div>
      </div>

      <div className="pb-timeline" ref={timelineRef}>
        {boxes}
      </div>

      <div className="pb-guessfield">
        <label>Jahr</label>
        <input
          className={inputClasses.join(' ')}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="&mdash;"
          readOnly={!p.you}
          disabled={!guessActive}
          // Gated on p.you, not guessActive: a submitted-but-not-yet-resolved
          // Stichrunde guess turns guessActive false (see
          // exactYearAttemptedUserIds in LiveGameBoard) well before the
          // round resolves, but the value you typed should stay visible
          // (just grayed out via the disabled attribute below) instead of
          // vanishing the instant it's submitted - there's no other on-
          // screen record of what you guessed until the reveal.
          value={guessWrongValue != null ? guessWrongValue : p.you ? guessValue : ''}
          onChange={
            p.you && onGuessChange ? (e) => onGuessChange(e.target.value.replace(/\D/g, '').slice(0, 4)) : undefined
          }
          onKeyDown={
            p.you && onGuessSubmit
              ? (e) => {
                  if (e.key === 'Enter') onGuessSubmit();
                }
              : undefined
          }
        />
      </div>

      {p.you ? (
        <div className="pb-actions">
          <button
            className="pb-act-btn pb-act-confirm"
            onClick={guessActive ? onGuessSubmit : onConfirm}
            disabled={guessActive ? !guessValue : p.pendingSlot === null}
          >
            &#10003;
          </button>
          <button
            className="pb-act-btn pb-act-clear"
            onClick={guessActive ? () => onGuessChange?.('') : onClear}
            disabled={guessActive ? !guessValue : p.pendingSlot === null}
          >
            &#10005;
          </button>
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}
