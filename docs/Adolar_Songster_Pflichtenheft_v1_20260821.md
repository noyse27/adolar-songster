# Adolar Songster - Pflichtenheft (MVP + Ausbaupfad)

Version: 1.0
Stand: 2026-08-21
Status: freigegeben zur Umsetzung

## 1. Ziel und Zweck
Dieses Pflichtenheft beschreibt die verbindliche Umsetzung von Adolar Songster fuer den privaten Betrieb in kleinen Freundesgruppen.
Es dient als uebertragbare Arbeitsgrundlage fuer die Entwicklung auf einem anderen PC.

## 2. Systemkontext
- Betriebsmodell: privates Self-Hosting
- Zielgruppe: kleine geschlossene Gruppen
- Zugang: nur registrierte Nutzer mit Einladungstoken
- Musikquelle MVP: angebundener Adolar-Webserver
- Nicht-Ziel: zentraler Plattformbetrieb fuer viele, oeffentlicher Massenbetrieb

## 3. Rechtlicher Rahmen
- Das System ist fuer privaten Betrieb vorgesehen.
- Betreiber sind selbst fuer Musikrechte und Lizenzen verantwortlich.
- Bei oeffentlichem oder kommerziellem Betrieb gelten zusaetzliche rechtliche Anforderungen.
- Im Erstsetup muss ein Lizenzhinweis aktiv bestaetigt werden.

## 4. Rollen und Rechte
- SongsterAdmin: globale Administration, Invite-Steuerung
- Nutzer: Teilnahme an Lobby und Spielen
- Tischadmin: erstellt Tisch, startet Runden, verwaltet Tischoptionen
- Spieler: aktive Spielteilnahme
- Zuschauer: passives Mitverfolgen (wenn am Tisch erlaubt)

## 5. Funktionale Anforderungen (MVP)

### 5.1 Registrierung, Login, Einladungen
FR-001: Registrierung nur mit gueltigem Einladungstoken.
FR-002: Invitation-Erzeugung nur durch Admin oder explizit freigeschaltete Nutzer.
FR-003: Maximal 5 aktive Tokens pro berechtigtem Nutzer.
FR-004: Tokens verfallen nach 14 Tagen oder nach einmaliger Nutzung.
FR-005: Tokens koennen manuell sofort deaktiviert werden.
FR-006: Minimale Sperrliste: gesperrte Nutzer duerfen sich nicht einloggen und nicht neu registrieren.

### 5.2 Lobby und Tischverwaltung
FR-010: Tischtypen: Public und Private.
FR-011: Private Tische nur mit Tischcode beitretbar.
FR-012: Public Tische in Lobbyliste sichtbar.
FR-013: Maximal 5 aktive Spieler pro Tisch (inkl. Tischadmin).
FR-014: Zuschauer sind optional pro Tisch aktivierbar (Public und Private).
FR-015: Maximal 10 Zuschauer pro Tisch.
FR-016: Verlaesst Tischadmin den Tisch, gilt 60 Sekunden Reconnect-Fenster; danach automatische Admin-Uebergabe an laengst anwesenden aktiven Spieler.
FR-017: Nach Abschluss einer Partie kann am selben Tisch per "Neue Partie" direkt ein neues Spiel mit gleicher Spielerzusammensetzung und denselben Tischeinstellungen gestartet werden.

### 5.3 Spielstart und Rundensteuerung
FR-020: Spielstart erst ab mindestens 2 aktiven Spielern.
FR-021: Rundenstart mit 3 Sekunden Countdown.
FR-022: Songdauer pro Runde: 25 Sekunden (fix).
FR-023: Start-Jahresbloecke pro Spieler: 2 (fix). Die gezogenen Jahre muessen sich voneinander unterscheiden - zwei identische Startjahre sind nicht zulaessig.
FR-024: Jahrspanne fuer Startbloecke:
- Untergrenze = minSongYear - 10
- Obergrenze = max(maxSongYear + 10, aktuelles Jahr)
FR-025: Spieler duerfen waehrend des Songfensters mehrfach umplatzieren; nach Countdown-Ende werden Eingaben gesperrt.
FR-026: Einsortierung gilt als korrekt, wenn die relative Position zwischen Nachbarkarten stimmt.
FR-027: Songs mit identischem Jahr sind erlaubt; Einsortierung in gueltigem Gleichjahresbereich ist korrekt.

### 5.4 Token-Mechanik
FR-030: Jeder Spieler erhaelt 2 Tokens pro Spiel.
FR-031: Token ist in jedem Fall verbraucht, auch bei nicht bestaetigter Eingabe.
FR-032: Schnellster Token-Klick stoppt Songwiedergabe.
FR-033: Token-Spieler erhaelt 10 Sekunden fuer Exaktjahr-Eingabe.
FR-034: Bei falschem Solo-Guess erhalten Gegenspieler 10 Sekunden fuer Exaktjahr-Versuch.
FR-035: Das falsch geratene Jahr des Token-Spielers wird den Gegenspielern angezeigt.
FR-036: Tie-Break bei Token-Klicks: Serverzeit gewinnt; bei Gleichstand innerhalb 50 ms entscheidet Zufall.

### 5.5 Sieg, Punkte, Karma
FR-040: Siegbedingung: 10 korrekte Karten.
FR-041: Bei Gleichstand nach letzter Runde: Bonusrunde mit Stichsong, schnellste korrekte Exaktjahreingabe gewinnt.
FR-042: Highscoreformel Gewinner = 1 Siegpunkt + 1 Punkt pro Gegner.
FR-043: Karma komplett gespieltes Match = +5.
FR-044: Vorzeitiges Verlassen = -5, zusaetzlich -1 pro weiterem Spieler am Tisch.
FR-045: Technischer Disconnect: Rejoin innerhalb 90 Sekunden ohne Karma-Malus.

### 5.6 Musikquelle und Fehlerfaelle
FR-050: Pflichtmetadaten pro Song: Song-ID, Titel, Jahr, Stream-Quelle, Dauer.
FR-051: Fehlt gueltiges Songjahr, wird Song uebersprungen und geloggt.
FR-052: Bei Streamfehler/Timeout wird Runde abgebrochen, ein Auto-Retry mit neuem Song versucht, danach Fehlermeldung.
FR-053: Ein in einer Partie bereits gespielter Song darf innerhalb derselben Partie nicht erneut gespielt werden.
FR-054: In derselben Tischsession (mehrere "Neue Partie"-Laeufe ohne Sessionwechsel) darf ein Song erst dann erneut gespielt werden, wenn alle verfuegbaren Songs der Playlist mindestens einmal gespielt wurden; danach wird der Songpool fuer diese Tischsession zurueckgesetzt.

### 5.7 Setup und Betriebsfaehigkeit
FR-060: Ziel-Installation ueber Docker Compose.
FR-061: Ziel-Onboarding in 3 Schritten:
- .env konfigurieren
- compose starten
- Browser-Wizard durchlaufen
FR-062: Browser-Einrichtungsassistent mit Admin-Anlage, erster Einladung, Testtisch.
FR-063: Integrierter Funktionstest nach Setup (Healthcheck + Testsong + Simulationsrunde).

## 6. UI-/UX-Anforderungen (MVP)
UX-001: Playboard gemaess Skizzenlogik: Spieler links, Zeitkarten mittig, Eingabe/Interaktion rechts.
UX-002: Rechts am Eingabefeld zwei klare Aktionen:
- Gruen = bestaetigen (Haken)
- Rot = Feldinhalt loeschen (X)
UX-003: Zentrale Steuerflaeche unten mit Start/Fragezeichen und sichtbarem Countdown.
UX-004: Songster-Tokens als schnell erreichbare Buttons unten links.
UX-005: Hohe Lesbarkeit und schnelle Interaktion waehrend laufendem Countdown.

## 7. Branding-Anforderungen
BR-001: Schriftarten und Farben soweit moeglich aus adolar-brand-images verwenden.
BR-002: Bevorzugter Font-Stack:
- Orbitron
- Orbitron Medium
- Orbitron Regular
- Segoe UI
- sans-serif
BR-003: Farbwerte aus den offiziellen Brand-Assets ableiten (palette/styleguide).
BR-004: Logos/Raketenassets ausschliesslich aus offizieller Brand-Quelle.
BR-005: Verbindliche Quelle: https://github.com/noyse27/adolar-brand-images

## 8. Nicht-funktionale Anforderungen
NFR-001: Realtime-Events serverautoritativ (keine clientseitige Endentscheidung).
NFR-002: Zeitbasis fuer Token-Race und Countdown ist die Serverzeit.
NFR-003: Basis-Schutz gegen Missbrauch: Event-Validierung und Rate-Limits.
NFR-004: Logging fuer Fehlerfaelle bei Songdaten, Stream und Rejoin.
NFR-005: Backupfaehigkeit fuer Nutzerdaten/Spielstaende (mindestens taeglich empfohlen).
NFR-006: CI-Pipeline ist ab Sprint 0 verpflichtend und blockiert Merges bei fehlgeschlagenen Checks.
NFR-007: Pflichtchecks in CI: Linting, Unit-Tests, Integrations-Tests, Build und Basis-Security-Scans.
NFR-008: Dependency- und Container-Image-Scans muessen automatisiert laufen; kritische Findings blockieren Release-Artefakte.
NFR-009: Testabdeckung fuer Kernlogik (Game/Token/Songpool-Regeln) muss kontinuierlich gemessen und als Metrik in CI veroeffentlicht werden.
NFR-010: Jede Aenderung an Spielregeln benoetigt mindestens einen automatisierten Regressionstest.

## 9. Abnahmekriterien (MVP)
AK-001: Registrierung ohne gueltiges Token nicht moeglich.
AK-002: Tisch mit 5 aktiven Spielern blockiert weitere aktive Joins.
AK-003: Rundenablauf mit 3s Countdown und 25s Songzeit reproduzierbar.
AK-004: Token-Race entscheidet stabil nach Serverzeit-Regel.
AK-005: Bei falschem Token-Solo-Guess wird das falsche Jahr sichtbar und Gegenspielerfenster startet 10s.
AK-006: Sieg-/Karma-Berechnung entspricht FR-040 bis FR-045.
AK-007: Setup auf sauberem System laeuft per 3-Schritte-Prozess inkl. Wizard und Funktionstest.
AK-008: Branding-Grundlagen (Font/Logo/Farbquelle) sind im UI nachweisbar eingebunden.
AK-009: "Neue Partie" startet am gleichen Tisch mit gleicher Gruppe und gleichen Einstellungen ohne Neu-Join.
AK-010: In einer Partie treten keine Song-Wiederholungen auf.
AK-011: Ueber mehrere "Neue Partie"-Laeufe derselben Tischsession treten erst nach vollstaendiger Ausschoepfung der Playlist Wiederholungen auf.
AK-012: CI laeuft bei Pull Requests automatisch und beinhaltet mindestens Lint, Unit, Integration, Build und Security-Check.
AK-013: Ein absichtlich eingebauter Regelverstoss-Test (Song-Wiederholung) schlaegt in CI fehl und verhindert Merge.
AK-014: Release-Artefakte werden nur erzeugt, wenn alle Quality Gates erfolgreich sind.

## 10. Projektgrenzen und Annahmen
- Kein Multi-Tenant-SaaS.
- Keine Verantwortung fuer zentrale Lizenzverwaltung.
- Betrieb fuer kleine Gruppen, nicht fuer hochskalierte oeffentliche Last.

## 11. Ausbaupfad nach MVP (Phase 2 festgelegt)
EP-001: Lokale Musikordner konfigurierbar machen.
EP-002: Lokalen Scan implementieren (manuell, optional periodisch).
EP-003: Unterstuetzte Formate initial: mp3, m4a, flac.
EP-004: Duplikaterkennung ueber Hash oder Pfad.
EP-005: Songs ohne gueltiges Jahr als unvollstaendig markieren und fuer Wertung sperren.
EP-006: Songquelle im Spiel umschaltbar: Adolar oder lokaler Katalog.
EP-007: Sicherheitsregel: nur freigegebene Basisordner scannen.

## 12. Offene Punkte fuer Phase 2
- Vorrang bei Metadatenkonflikt: ID3-Tag oder Dateiname.
- Behandlung fehlender Coverbilder.
- Lautstaerke-Normalisierung lokaler Dateien.
- Ob lokaler Scan nur durch Admin ausloesbar ist.

## 13. Uebergabepaket fuer anderen PC
Minimal mitgeben:
1. Dieses Pflichtenheft.
2. Finaler Fragebogen mit Entscheidungen.
3. Playboard-Skizze (PNG).
4. Kurzbriefing mit Zielsystem (Windows/Linux), geplanter Docker-Version und Zugangsdatenkonzept.

Empfohlener Uebergabeablauf:
1. Dokumente in ein gemeinsames Projektverzeichnis kopieren.
2. Kickoff mit Durchgang aller FR-, UX-, BR- und AK-Nummern.
3. Umsetzung strikt entlang der nummerierten Anforderungen.
4. Abnahme anhand Kapitel 9 dokumentieren.
