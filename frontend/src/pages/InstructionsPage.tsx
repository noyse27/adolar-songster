import { Link } from 'react-router-dom';
import './pages.css';

export function InstructionsPage() {
  return (
    <div className="app-shell">
      <div className="sh-card sh-rules">
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Anleitung</h2>
        <ol>
          <li>
            Jede*r startet mit <b>2 Jahreskarten</b> auf der eigenen Zeitleiste.
          </li>
          <li>
            Pro Runde läuft ein <b>Song</b> für 25 Sekunden. Platziere dein Kärtchen so in deiner Zeitleiste, dass es
            chronologisch zwischen die Nachbarkarten passt.
          </li>
          <li>
            Zwei <b>Songster-Token</b> pro Spiel lassen dich den Song stoppen und das exakte Jahr raten &mdash; richtig
            liegst du sofort korrekt, falsch verrät dein Jahr allen anderen und die bekommen selbst 10 Sekunden Zeit.
          </li>
          <li>
            Nach jedem Song wird aufgelöst: richtige Platzierungen bleiben stehen, falsche verschwinden wieder.
          </li>
          <li>
            Wer zuerst <b>10 korrekte Karten</b> auf der Zeitleiste hat, gewinnt die Partie.
          </li>
          <li>
            Karma-Punkte spiegeln faires Verhalten wider &mdash; ein komplett gespieltes Match gibt Pluspunkte, vorzeitiges
            Verlassen kostet welche und erschwert später die Tisch-/Mitspielersuche.
          </li>
        </ol>
      </div>
    </div>
  );
}
