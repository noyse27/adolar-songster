# Adolar Songster - Benutzerhandbuch

Version: 1.0 (entspricht Release v0.2.0-beta)
Stand: 2026-08-24
Quelle: aus dem aktuellen Code generiert (Frontend `frontend/src/pages/*`,
`frontend/src/game/*`, Backend-Routen `backend/src/routes/*`) - beschreibt
den tatsächlichen Funktionsstand, keine Planung/Wunschliste.

Zielgruppe dieses Dokuments: Grundlage für eine Anleitung/Hilfeseite
(z. B. per `adolar-whatsnew`-Skill generiert), nicht der Endtext selbst.
Enthält alle vorhandenen Bildschirme, Felder und Regeln in der Reihenfolge,
in der sie eine Nutzerin/ein Nutzer durchläuft.

## 1. Was ist Adolar Songster?

Ein privates Musik-Zeitleisten-Ratespiel für kleine Gruppen (2-5 Spieler pro
Tisch, plus Zuschauer). Man hört kurze Song-Ausschnitte und muss sie richtig
chronologisch in die eigene Zeitleiste einsortieren. Wer zuerst 10 korrekte
Karten hat, gewinnt. Zugang ausschließlich per Einladungscode - kein
öffentlicher Registrierungsdienst.

## 2. Registrierung & Anmeldung

- **Registrieren** (`/register`): Benutzername, E-Mail, Passwort und ein
  gültiger **Einladungscode** sind Pflichtfelder. Ein Code kann fest
  vorgegeben sein (z. B. per Einladungslink mit `?invite=CODE`).
  Fehlermeldungen: ungültiger Code, oder Code abgelaufen/deaktiviert/
  aufgebraucht.
- **Anmelden** (`/login`): Benutzername/Passwort.
- Ist noch kein Admin-Konto vorhanden, führt ein **Einrichtungsassistent**
  (`/setup`) beim allerersten Start in 4 Schritten durch: Admin anlegen,
  Musikdaten-Quelle konfigurieren, erste Einladung erzeugen, Testtisch samt
  Funktionstest.

## 3. Startbildschirm (nach Anmeldung)

- Markenschriftzug "Adolar Songster" (Adolar-Wortmarken-Stil).
- Untertitel "Zeitleisten-Ratespiel".
- **Bisher insgesamt gespielte Spiele auf dem Server**: Gesamtzahl aller
  abgeschlossenen Partien (fett), server-weite Statistik.
- Menü: Zur Lobby, Anleitung, Rangliste, Profil, ggf. Einladungen (bei
  Einladungsrecht) bzw. Admin-Bereich (bei Admin-Rolle), Abmelden.

## 4. Lobby (`/lobby`)

- Listet alle **öffentlichen, offenen** Tische mit: Name, aktuelle
  Spieleranzahl/Max., Zuschaueranzahl/Max. (falls Zuschauer erlaubt),
  Alter des Tisches (hh:mm seit Erstellung), Beitreten-Button.
- **Beitreten** versucht zunächst den Beitritt als Spieler. Erfüllt man die
  Mindestanforderungen des Tisches nicht (siehe Abschnitt 5), wird
  automatisch stattdessen als Zuschauer beigetreten (sofern der Tisch
  Zuschauer erlaubt).
- "Neuen Tisch erstellen" führt zu Abschnitt 5.
- Live-Aktualisierung per WebSocket, sobald sich an einem Tisch etwas
  ändert.

## 5. Tisch erstellen (`/tisch/neu`)

Pflichtfelder/Optionen:

- **Tischname** (Pflicht)
- **Sichtbarkeit**: Öffentlich (in der Lobby sichtbar) oder Privat (nur per
  Link/Code beitretbar - für private Tische wird automatisch ein
  Beitrittscode generiert).
- **Max. Spieler**: 2-5.
- **Zuschauer erlauben** (Häkchen) - wenn aktiv: **Max. Zuschauer** 0-50.
- **Zusätzliche Optionen** (Beitrittsvoraussetzungen für Spieler - je eine
  Checkbox, die bei Aktivierung ein Eingabefeld für den Mindestwert
  freigibt; ohne Häkchen gilt **keine** Anforderung für dieses Kriterium):
  - **Karmapunkte min.**
  - **Spielpunkte min.**
  - **Anzahl Spiele min.**
  - Wer eine aktivierte Anforderung nicht erfüllt, kann dem Tisch nur als
    **Zuschauer** beitreten, nicht als Spieler.
- **Songquelle**: entweder eine konfigurierte Adolar-Playlist auswählen,
  oder "Lokaler Song-Pool" (Standard, falls Adolar nicht angebunden ist).

Der/die Erstellende wird automatisch als erste(r) Spieler(in) gesetzt.

## 6. Im Tisch (`/tisch/:id`)

- Zeigt Sitzplätze (Spieler/Zuschauer), Bereitschaftsstatus, Beitreten-
  Button für noch nicht Sitzende (mit Hinweis auf evtl. Anforderungen),
  Einladungslink (bei privaten Tischen, für den Tisch-Besitzer sichtbar).
- Jede(r) Spieler(in) markiert sich als **bereit**; sobald alle bereit sind
  und die konfigurierte Spielerzahl erreicht ist, startet die Partie
  automatisch. Der Tisch-Admin kann alternativ manuell früher starten,
  sobald alle aktuell Sitzenden bereit sind.
- **Inaktivitäts-Warnung**: War 59 Minuten lang niemand am Tisch aktiv,
  erscheint eine Warnung mit Countdown und einem Button **"Ich bin noch
  da"**, der den Inaktivitäts-Timer zurücksetzt (siehe Abschnitt 13).
- **Verlassen**: vorzeitiges Verlassen während einer laufenden Partie kann
  Karma kosten (siehe Abschnitt 8), außer man kehrt innerhalb von 90
  Sekunden zurück.

## 7. Das Spiel

- Jede(r) Spieler(in) startet mit **2 Jahreskarten** auf der eigenen
  Zeitleiste.
- Pro Runde läuft ein Song für 25 Sekunden (nach 3 Sekunden Countdown).
  Die eigene Karte wird per Klick an der gewünschten Stelle der Zeitleiste
  platziert (Schiebelogik verschiebt vorhandene Karten zur nächsten freien
  Lücke).
- **Songster-Token**: 2 pro Partie. Buzzern stoppt den Song sofort und gibt
  10 Sekunden, um das **exakte** Erscheinungsjahr zu erraten. Richtig
  geraten: Karte wird direkt korrekt eingeordnet. Falsch geraten: das
  genannte (falsche) Jahr wird allen anderen verraten, die dann ebenfalls
  10 Sekunden für einen Versuch bekommen.
- **Auflösung**: richtige Platzierungen bleiben stehen, falsche werden
  wieder entfernt.
- **Stichrunde (Bonusrunde)**: erreichen mehrere Spieler gleichzeitig 10
  Karten, entscheidet eine Zusatzrunde mit exaktem Jahres-Tipp.
- **Sieg**: wer zuerst 10 korrekt platzierte Karten hat, gewinnt die
  Partie.

## 8. Punkte & Karma

- **Songster-Punkte**: der/die Gewinner(in) einer Partie erhält
  1 + (Anzahl Mitspieler) Punkte.
- **Karma-Punkte**: +5 für jede(n) Spieler(in), die/der ein Match komplett
  zu Ende gespielt hat. Vorzeitiges Verlassen während einer aktiven Partie
  (ohne Rückkehr binnen 90 Sekunden) kostet -5, plus -1 je weiterem noch
  sitzenden Mitspieler.
- **Gespielte Spiele**: wird für jede(n) Spieler(in) hochgezählt, die/der
  in einer abgeschlossenen Partie mindestens eine Runde tatsächlich
  mitgespielt (geraten) hat - nicht nur dabeigesessen ist.

## 9. Rangliste (`/rangliste`)

- Zeigt die **Top 10** nach globaler Rangformel:
  `(Songster-Punkte + Karma-Punkte) / √(gespielte Spiele + 1)`.
  Karma wirkt direkt als Bonus (positiv) oder Malus (negativ); die Wurzel
  dämpft, dass ein Neuling durch eine einzelne gute Partie sofort ganz oben
  landet.
- Ist die eigene Position nicht in den Top 10, wird zusätzlich eine
  separate Zeile mit dem eigenen aktuellen Rang angezeigt.
- Dieselbe Rangzahl erscheint auch im Profil und im Live-Tooltip während
  einer Partie (Hover auf einen Spieler-Avatar).

## 10. Profil (`/profil`)

- Zeigt Benutzername, E-Mail, Songster-Punkte, Karma-Punkte, gespielte
  Spiele, aktuellen Rang, Rolle (Admin/Mitglied).
- Passwort ändern (aktuelles + neues Passwort, min. 8 Zeichen).

## 11. Einladungen (`/einladungen`, für Nutzer mit Einladungsrecht)

- Erstellt Einladungscodes mit Ablaufdatum (Standard 14 Tage).
- **Delegierte (nicht-Admin) Nutzer**: maximal 3 Einladungscodes pro
  Kalendermonat; die maximale Nutzungszahl pro Code ist bei ihnen fest auf
  1 gesetzt (nicht editierbar) - verhindert, dass ein einzelner Code die
  Monatsquote aushebelt.
- **Admins**: keine Monatsquote, und die Nutzungszahl pro Code ist frei
  wählbar.
- Bestehende Einladungen können deaktiviert werden.

## 12. Siegerbildschirm & PDF-Export

Nach Spielende: Anzeige von Sieger(in), Endstand aller Spieler (Rang,
Kartenanzahl), Countdown bis zum automatischen Tisch-Schließen (60
Sekunden, falls niemand neu startet), Buttons "Nochmal spielen" und **"Als
PDF speichern"**.

Der PDF-Export enthält:

- Kopf "Adolar Songster", Datum ("Spiel vom ..."), Anzahl gespielter Runden
- Spielerliste: Name (Rang), Songster-Punkte / Karmapunkte / gespielte
  Spiele
- Sieger-Zeile
- Für jede(n) Spieler(in): Initialienkästchen + die eigene Zeitleiste mit
  allen Jahreskarten

## 13. Automatisches Aufräumen inaktiver Tische

- Ein Tisch, an dem 60 Minuten lang keine Interaktion (Beitritt, Verlassen,
  Bereit-Status, Start, Zug/Guess, "Ich bin noch da") stattfand, wird
  automatisch gelöscht - aus Performancegründen, **ohne** Verlassen-Malus
  und **ohne** Anrechnung als gespieltes Spiel für die Beteiligten.
- 1 Minute vor dem Löschen erscheint im Tisch eine Warnung mit Button
  "Ich bin noch da", der den Timer zurücksetzt.

## 14. Admin-Bereich (`/admin`, nur Rolle "Admin")

- **Musikquelle**: Adolar-Server-Adresse/Token konfigurieren, Sync-Status
  ("zuletzt synchronisiert"), manueller Sync-Anstoß (läuft asynchron im
  Hintergrund, kein Blockieren der Oberfläche).
- **Einladungen**: wie Abschnitt 11, hier für alle Nutzer einsehbar/
  verwaltbar.
- **Song-Pool**: Suche über Titel/Interpret (statt kompletter Listenabruf),
  zeigt Titel/Interpret/Jahr/Quelle/Status. Jahr ist inline korrigierbar
  (Klick auf den Wert) - eine manuelle Korrektur wird beim nächsten
  Adolar-Sync nicht mehr überschrieben.
- **Tische**: Übersicht aller Tische (Name, Besitzer, Sichtbarkeit, Status,
  Spieler-/Zuschauerzahl) mit "inaktiv"-Kennzeichnung ab 30 Minuten ohne
  Interaktion (rein informativ, deutlich vor der 60-Minuten-Löschschwelle
  aus Abschnitt 13).
- **Nutzer**: Einladungsrecht erteilen/entziehen, Einladungen widerrufen.

## 15. Fußzeile (auf jeder Seite)

> Software: Adolar Songster © `<aktuelles Jahr>` PolzeSoft (polze.net).
> Haftungsausschluss: Sämtliche auf dieser Plattform bereitgestellten
> Musikinhalte unterliegen der ausschließlichen Verantwortung des
> Instanzbetreibers. PolzeSoft stellt lediglich die Software bereit und
> steht in keiner rechtlichen oder inhaltlichen Verbindung zu den
> gehosteten Medien.

## 16. Versionsstand

Beta (v0.2.0-beta). Kernspiel vollständig getestet (115 Backend-Tests,
CI inkl. CodeQL/Docker-Image-Scan), noch nicht produktionsgehärtet für
große Nutzergruppen. Änderungsverlauf siehe GitHub Releases
(https://github.com/noyse27/adolar-songster/releases).
