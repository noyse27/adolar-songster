# Adolar Songster – Playboard UI-Spezifikation v1 (2026-08-22)

Status: **eingefroren** als Referenz für die Implementierung und für andere
Agents/Entwickler, die an angrenzenden Screens (Lobby, Zuschauermodus,
Popup-Fenster-Handling) arbeiten. Basiert auf der interaktiven
Skizzenvorlage ([songster_playboard.png](songster_playboard.png)) und dem
im Chat erarbeiteten, iterativ verfeinerten HTML/JS-Prototyp. Deckt UX-001
bis UX-005 sowie die relevanten Funktionsanforderungen aus dem
[Pflichtenheft](Adolar_Songster_Pflichtenheft_v1_20260821.md) ab (FR-020 bis
FR-036, FR-040 bis FR-044).

Ein lauffähiger Klick-Prototyp existiert als privates Claude-Artifact
(Referenz für Reviewer, nicht Teil des Repos). Diese Datei ist die
verbindliche schriftliche Spezifikation; bei Widersprüchen zwischen einem
späteren Prototyp-Stand und diesem Dokument gilt dieses Dokument.

## 1. Layout-Grundraster

```
┌───────────────────────────────────────────────────────────────────┐
│ [Exit] [?]  AS  Songster              Runde N · Phase-Label        │  Topbar
├───────────────────────────────────────────────────────────────────┤
│ [Avatar] Name/Punkte │ Zeitleiste (10 Kästchen) │ Jahr │ ✓ ✗       │  Zeile "Du"
│ [Avatar] Name/Punkte │ Zeitleiste (10 Kästchen) │ Jahr │           │  Zeile Mitspieler ×4
│ ...                                                                │
├───────────────────────────────────────────────────────────────────┤
│              Hinweistext (kontextabhängig)                        │
├───────────────────────────────────────────────────────────────────┤
│ [Token][Token]     [Bereit-/Countdown-/Auflösungs-Ring]  [Status]  │  Steuerdeck
└───────────────────────────────────────────────────────────────────┘
```

Entspricht UX-001 (Spieler links, Zeitkarten mittig, Eingabe/Interaktion
rechts) und UX-003 (zentrale Steuerfläche unten mit Start/Fragezeichen und
Countdown).

Markenfarben/-schrift ausschließlich aus `frontend/src/styles/brand.css`
(Orbitron für Displays, Manrope o.ä. serifenlose Grotesk für Fließtext/UI,
Violett/Cyan/Lavendel auf Navy). Keine weiteren Markenfarben einführen.

## 2. Spielerzeile

Zwei Varianten, gleiche Grundstruktur (4 Grid-Spalten: Player-Block /
Zeitleiste / Jahr-Feld / Aktionen):

| Element | Eigene Zeile ("Du") | Mitspieler-Zeile |
|---|---|---|
| Kachelgröße Zeitleiste | groß (~68×76) | klein (~46×52) |
| Bestätigen/Verwerfen (✓/✗) | vorhanden | **nicht vorhanden** |
| Jahr-Eingabefeld | vorhanden, teils aktiv | vorhanden, **immer sichtbar**, meist inaktiv |
| Klickbare Zeitleisten-Felder | ja | nein (nur Anzeige) |

Eigene Zeile ist optisch hervorgehoben (hellerer Panel-Hintergrund,
größerer Avatar, größere Schrift) – deutlich mehr Gewicht als
Mitspieler-Zeilen, wie in der Skizze durch die Position "Du" oben
angedeutet.

### 2.1 Avatar / Spieler-Icon

- Rundes/abgerundetes Icon mit Initialen.
- **Ready-Badge**: kleiner Kreis unten rechts am Avatar, grau (nicht
  bereit) oder grün mit Haken (bereit). Sichtbar für alle Spieler, klickbar
  nur in Phasen `idle`/`waiting` (siehe Abschnitt 5).
- **Tooltip bei Hover**: drei Zeilen, in dieser Reihenfolge:
  1. Songster-Punkte (kumulierter Score, FR-042)
  2. Karma-Punkte (FR-043/FR-044)
  3. aktueller Ranglistenplatz (`#N`, absteigend nach Songster-Punkten)
- **Krone** neben dem Namen für den/die aktuell führenden Spieler
  (höchste Anzahl befüllter Zeitleisten-Slots > Startkartenzahl).

### 2.2 Zeitleiste – 10-Slot-Modell

- Jede Spielerzeile hat **fest 10 Kästchen** (unabhängig vom Spielstand).
- Zu Rundenbeginn (Deal) erhält **jeder Spieler identische zwei
  Startjahre** (Fairness – keine unterschiedlich leichten Startbedingungen)
  an denselben zwei mittigen Slot-Indizes (Slot 5/6 von 10), symmetrisch
  mit je vier leeren Feldern links und rechts.
- Sieg bei 10/10 befüllten Slots = FR-040 ("10 korrekte Karten").
- Leere Slots sind reguläre, gleich große Kästchen (kein dünner Strich) –
  siehe UX-Feedback: "die leeren Kästchen hätte ich schon gerne wieder".
- **Korrektheitsprüfung** (FR-026/FR-027): ein Slot-Index ist eine gültige
  Position für ein Jahr, wenn es ≥ dem nächsten befüllten Nachbarn links und
  ≤ dem nächsten befüllten Nachbarn rechts ist (nächster befüllter Nachbar =
  erster Non-Empty-Slot beim Durchsuchen in die jeweilige Richtung, egal wie
  viele leere Slots dazwischenliegen).

### 2.3 Schiebe-/Einfüge-Logik ("Karte zwischen zwei Karten legen")

Problem: irgendwann sind zwei benachbarte Slots beide befüllt, aber der
Spieler will logisch *zwischen* diesen beiden Karten einfügen.

Lösung: zwischen zwei direkt benachbarten befüllten Kästchen erscheint bei
Hover (nur eigene Zeile) ein schmaler `+`-Steg. Klick darauf:

1. Ausgangszustand ist immer der Stand zu Rundenbeginn
   (`roundStartSlots`-Snapshot, vor jeder eigenen Auswahl in dieser Runde).
2. Vom Einfügepunkt aus wird der **nächstgelegene freie Slot** gesucht,
   bevorzugt in Richtung mit kürzerer Distanz (links oder rechts).
3. Alle Karten zwischen Einfügepunkt und diesem freien Slot rücken um
   einen Index auf, wodurch am Einfügepunkt eine Lücke entsteht.
4. Die neue (verdeckte) Karte wird provisorisch in diese Lücke gelegt.

Wird die Runde als falsch aufgelöst, wird die komplette Zeile aus dem
`roundStartSlots`-Snapshot wiederhergestellt (siehe 2.4) – die Schiebung
ist dann so, als wäre sie nie passiert. Wird erneut eine andere Position
gewählt (auch mehrfach, FR-025 erlaubt Umplatzieren), wird ebenfalls immer
zuerst der Snapshot restauriert, bevor neu geschoben wird.

### 2.4 Rundenauflösung (Reveal)

- Während der 5s-Auflösungsanzeige (siehe 3.3) werden **alle** gesetzten,
  bis dahin verdeckten Kärtchen aller Spieler an ihrer gewählten Position
  sichtbar: **grün** = korrekt, **rot** = falsch.
- Nach den 5s:
  - grüne Kärtchen bleiben stehen und wechseln in die reguläre
    Kachel-Optik (Violett-Verlauf) – dauerhaft im 10-Slot-Array übernommen.
  - rote Kärtchen verschwinden; die komplette Zeile springt exakt auf den
    `roundStartSlots`-Zustand vor der Runde zurück (keine
    Teil-Verschiebung bleibt sichtbar).
- Kein Spieler sieht die Positionswahl der anderen **vor** der Auflösung
  (Anti-Spoiler, gilt später auch für den Zuschauermodus, siehe Abschnitt 8).

## 3. Zentrale Steuerfläche (Ring)

Ersetzt das simple "?"-Quadrat der Skizze durch einen großzügigen,
kreisförmigen Fortschritts-Ring, in den die zentrale Karte **passgenau**
eingepasst ist (minimaler Abstand zwischen Ringlinie und Karten-Kreis,
beide Elemente deutlich größer als in der ursprünglichen Skizze).

Die Karte ist eine 3D-Flip-Karte (`rotateY`) mit Vorder-/Rückseite.

### 3.1 Zustände Vorderseite

| Phase | Anzeige | Ring |
|---|---|---|
| `idle` | "?" / Label "Bereit?" | leer |
| `waiting` (Bereit-Fenster) | Countdown-Zahl (30 → 0) / Label "Warte…" | füllt sich über 30s |
| `countdown` | Countdown-Zahl (3 → 1) / Label "los geht's" | füllt sich über 3s |
| `playing` | Noten-Symbol / Label "läuft" | füllt sich über die 25s Songdauer |

### 3.2 Bereit-Phase (ersetzt reinen "Start"-Klick)

Kernänderung gegenüber der ursprünglichen Skizze: **jeder Spieler muss
sich bereit melden**, bevor eine Runde beginnt – ein einzelner
"Start"-Klick einer Person reicht nicht mehr.

- Klick auf den Ring (in `idle`/`waiting`) oder auf das eigene
  Avatar-Icon setzt `ready = true` für den eigenen Spieler.
- Erste Bereit-Meldung eines beliebigen Spielers wechselt die Phase von
  `idle` zu `waiting` und startet das 30s-Fenster.
- Sind währenddessen alle Spieler bereit, startet die Runde sofort
  (kein Warten auf die vollen 30s).
- Läuft das 30s-Fenster ab, ohne dass alle bereit sind: alle bis dahin
  nicht bereiten Spieler **setzen diese Runde aus** (Zeile abgedunkelt,
  keine Zeitleisten-/Token-Interaktion möglich), die Runde startet trotzdem
  automatisch für die restlichen Spieler.
- Nach jeder Rundenauflösung werden `ready` und "setzt aus" für alle
  Spieler zurückgesetzt.

### 3.3 Zustand Rückseite (Auflösung)

Nach Songende (Timer 0, korrekter/falscher Exaktjahr-Guess oder Ablauf der
Token-Nachzieh-Chance) flippt die Karte zur Rückseite:

```
Song war
<Artist>
<Jahr, groß, fett>
<Tracktitel>
```

Bleibt 5s stehen (parallel zur Kärtchen-Auflösung, siehe 2.4), flippt dann
automatisch zurück zur Vorderseite (`idle`, Label "Bereit?").

## 4. Status-Panel (rechts neben dem Ring)

Drei Zeilen: **Letzter Song** (Artist – Titel (Jahr), erst nach Auflösung
befüllt, kein Live-Titel während `playing` – sonst Spoiler), **Verbleibend**
(Sekunden im aktuellen Songfenster), **Deine Token** (verbleibende Anzahl,
FR-030).

## 5. Songster-Token (FR-030 bis FR-036)

- Zwei Token pro Spiel und Spieler, dargestellt als **Jetons**: runder
  Chip mit gekerbtem Rand (Violett/Weiß-Segmente), kursives "S"-Monogramm
  mittig. Tooltip "Deine Songster Token" (keine sichtbare Unterschrift
  mehr unter dem Chip).
- Klick pausiert den Song (`songTimer` stoppt), aktiviert das eigene
  Jahr-Eingabefeld für 10s (FR-033).
- Richtiges Exaktjahr: Karte wird an der korrekten Position vorbelegt,
  Runde geht sofort in Auflösung.
- Falsches Exaktjahr: eigenes Feld zeigt den falsch geratenen Wert
  orange (auch für alle anderen Spieler sichtbar, FR-035); Gegenspieler
  bekommen ihrerseits ein 10s-Fenster für einen eigenen Exaktjahr-Versuch
  (FR-034) – deren Jahr-Feld wird währenddessen aktiv.

## 6. Jahr-Eingabefeld (pro Zeile, immer vorhanden)

Drei visuelle Zustände:

1. **Inaktiv** (Standard): grau, nicht editierbar, Platzhalter "—".
2. **Aktiv**: violett/cyan umrandet, editierbar – nur während eigenem
   Token-Einsatz, eigener Nachzieh-Chance nach fremdem Fehlversuch, oder
   künftig in der Stichrunde (FR-041).
3. **Ergebnis (falsch)**: orange, schreibgeschützt, zeigt das falsch
   geratene Jahr – bleibt bis Rundenende sichtbar.

Label über dem Feld: **"Jahr"** (nicht "Exaktjahr" – zu sperrig für die
kompakte UI).

## 7. Kopfzeile: Exit & Kurzanleitung

- **Exit-Button** (✕) oben links neben dem Logo. Öffnet einen
  Bestätigungsdialog:
  - Text nennt den **exakten Karma-Abzug** nach FR-044
    (`-5 - 1×(Anzahl weiterer Spieler am Tisch)`), berechnet aus der
    aktuellen Tischgröße.
  - Hinweis, dass niedriges Karma später die Suche nach offenen Tischen/
    Mitspielern erschwert.
  - Aktionen: "Abbrechen" / "Trotzdem verlassen".
- **Fragezeichen-Button** daneben öffnet eine kurze, listenartige
  Kurzanleitung (keine ausführliche Spielregel-Seite) zu allen
  interaktiven Playboard-Elementen: Bereit-Kreis, Spieler-Icon/Tooltip,
  leere Kästchen, Einfüge-Steg, ✓/✗, Token, Jahr-Feld.

## 8. Offene Punkte für Folge-Iterationen

- **Zuschauermodus**: noch nicht spezifiziert. Zentrale Frage:
  Cheating-Schutz, wenn Zuschauer *mehr* sehen als Spieler (z. B. verdeckte
  gegnerische Kärtchen vor der Auflösung, echtes Songjahr während
  `playing`) und das Ergebnis an einen Spieler durchstechen könnten
  (Stream-Sniping-Problem). Playboard-UI für Zuschauer muss dieselben
  Verdeckungsregeln wie für Mitspieler einhalten (siehe 2.4) – keine
  Sonderrechte. Layout/Platzierung des Zuschauer-Panels ist offen.
- **Separates Fenster**: das Playboard soll sich beim Rundenstart in
  einem eigenen Browser-Fenster/Tab öffnen (`window.open`), losgelöst von
  Lobby/Tischansicht. Kommunikation zwischen Lobby-Fenster und
  Playboard-Fenster (Auth-Kontext, Socket-Verbindung, Fenster-Schließen bei
  Spielende) ist technisch noch zu klären.
- Bot-/Simulationslogik existiert nur im Klick-Prototyp zu Testzwecken und
  ist **nicht** Teil der Produktanforderung (es gibt keine Bot-Spieler).
- **Gemeinsames Wiedergabegerät ("Host-Modus")**: aktuell spielt jedes
  Spielergerät den Song lokal im eigenen Browser ab (mit Stumm-Schalter,
  standardmäßig stumm bis der Nutzer aktiv den Ton einschaltet). Für Tische
  in einem gemeinsamen Raum wäre ein Host-Modus sinnvoll, bei dem nur ein
  ausgewähltes Gerät (z. B. Laptop/TV am Tisch) tatsächlich hörbar
  abspielt und alle anderen automatisch stumm bleiben – verhindert
  Echo/Zeitversatz durch mehrere gleichzeitig abspielende Handys. Bewusst
  zurückgestellt, siehe Musikwiedergabe-Implementierung (LiveGameBoard.tsx,
  routes/songs.ts).

## 9. Zustandsmaschine (Referenz für Implementierung)

```
dealing → idle ⇄ waiting → countdown → playing → reveal → idle (naechste Runde)
```

- `dealing`: einmalig beim Erstbetreten des Tischs (Karten-Deal-Animation
  vom Zentrum zu allen Zeitleisten).
- `idle`: niemand bereit / wartet auf erste Bereit-Meldung.
- `waiting`: mind. eine Bereit-Meldung liegt vor, 30s-Fenster läuft.
- `countdown`: alle (bzw. alle bereiten) Spieler bereit, 3s bis Songstart.
- `playing`: 25s-Songfenster, Platzierung/Schieben/Token möglich.
- `reveal`: 5s Auflösung (Ring-Rückseite + grün/rot-Feedback je Zeile).

## 10. Ergänzung 2026-08-26: phasenabhängige Schnellreaktionen

Diese Ergänzung gehört zum Feature-Branch
`codex/feature-player-communication`; der Merge ist zum Stand 2026-08-26
noch offen, das lokale Dev-Docker-Deployment ist erfolgt. Die vollständige
Phasenmatrix und technische Quelle
steht in
`Adolar_Songster_Spielerkommunikation_Whatsnew_Quelle_v1_20260826.md`.

- Freier Tischchat wird während der Partie nicht im Playboard fortgeführt.
- Aktive Spieler erhalten eine kompakte Reaktionsleiste unter den
  Spielerzeilen. Während Song/Countdown wird die Auswahl auf dezente
  Reaktionen begrenzt.
- Die sechs Kommunikationsphasen sind `waiting`, `countdown`, `playing`,
  `token`, `resolved` und `finished`. Ihre Belegung wird im Adminbereich
  konfiguriert; pro Phase sind maximal acht eindeutige Katalogmotive möglich.
- Änderungen an der Reaktionsbelegung werden live an bereits geöffnete
  Playboards und Hostdisplays verteilt.
- Empfangene Reaktionen erscheinen 3,5 Sekunden als Blase am Avatar.
- Der Hostbildschirm zeigt alle Blasen, sendet aber selbst keine Reaktionen.
- Die Funktion verändert weder Rundenstatus noch Timer oder Audio.
