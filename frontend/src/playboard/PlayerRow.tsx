import { SLOT_COUNT, STARTER_YEARS, PlayerState } from './types';

interface PlayerRowProps {
  player: PlayerState;
  isLeader: boolean;
  rank: number;
  canReady: boolean;
  onToggleReady: () => void;
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
}

export function PlayerRow({
  player: p,
  isLeader,
  rank,
  canReady,
  onToggleReady,
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
}: PlayerRowProps) {
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
        <div className={`pb-avatar-wrap${canReady ? '' : ' pb-static'}`} onClick={canReady ? onToggleReady : undefined}>
          <div className="pb-avatar">{p.initials}</div>
          <div className={`pb-ready-badge${p.ready ? ' pb-ready' : ''}`}>{p.ready ? '✓' : ''}</div>
          <div className="pb-tooltip">
            Songster-Punkte: <b>{p.songsterPoints}</b>
            <br />
            Karma-Punkte: <b>{p.karma}</b>
            <br />
            Rang: <b>#{rank}</b>
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
          type="number"
          placeholder="&mdash;"
          readOnly={!p.you}
          disabled={!guessActive}
          value={guessWrongValue != null ? guessWrongValue : guessActive ? guessValue : ''}
          onChange={p.you && onGuessChange ? (e) => onGuessChange(e.target.value) : undefined}
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
          <button className="pb-act-btn pb-act-confirm" onClick={onConfirm} disabled={p.pendingSlot === null}>
            &#10003;
          </button>
          <button className="pb-act-btn pb-act-clear" onClick={onClear} disabled={p.pendingSlot === null}>
            &#10005;
          </button>
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}
