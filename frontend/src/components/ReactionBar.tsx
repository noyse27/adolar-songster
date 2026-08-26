import { CommunicationPhase, REACTIONS, ReactionId } from '../game/reactions';

interface ReactionBarProps {
  phase: CommunicationPhase;
  sending: boolean;
  onReact: (reactionId: ReactionId) => void;
}

const PHASE_HINT: Record<CommunicationPhase, string> = {
  waiting: 'Zwischen den Runden',
  countdown: 'Countdown – kurz und ruhig',
  active: 'Song läuft – nur dezente Reaktionen',
  finished: 'Partie beendet',
};

export function ReactionBar({ phase, sending, onReact }: ReactionBarProps) {
  const available = REACTIONS.filter((reaction) => reaction.phases.includes(phase));
  return (
    <div className="pb-reaction-bar" aria-label="Schnellreaktionen">
      <span className="pb-reaction-hint">{PHASE_HINT[phase]}</span>
      <div className="pb-reaction-actions">
        {available.map((reaction) => (
          <button
            key={reaction.id}
            type="button"
            className="pb-reaction-btn"
            disabled={sending}
            title={reaction.label}
            aria-label={reaction.label}
            onClick={() => onReact(reaction.id)}
          >
            <span aria-hidden="true">{reaction.emoji}</span>
            <small>{reaction.label}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
