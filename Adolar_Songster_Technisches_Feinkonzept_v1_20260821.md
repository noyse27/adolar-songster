# Adolar Songster - Technisches Feinkonzept

Version: 1.0
Stand: 2026-08-21
Bezug: Adolar_Songster_Pflichtenheft_v1_20260821.md

## 1. Zielbild
Dieses Dokument konkretisiert die technische Umsetzung des MVP fuer privaten Betrieb (kleine Gruppen) sowie den vorbereiteten Ausbaupfad fuer lokalen Ordner-Scan.

## 2. Architekturuebersicht

## 2.1 Komponenten
1. Web-Frontend
- Lobby, Tisch, Playboard, Admin-Ansichten
- Realtime-Kommunikation via WebSocket

2. Game-Backend (serverautoritativ)
- Spielregeln, Rundenlogik, Token-Race, Punkte/Karma
- Validierung aller Spielaktionen

3. Adolar Connector
- Songauswahl aus Adolar-Quelle
- Abruf Pflichtmetadaten (Song-ID, Titel, Jahr, Dauer, Stream-Quelle)

4. Persistence Layer
- Nutzer, Invites, Tische, Spiele, Runden, Ereignisse, Scores, Karma

5. Setup/Wizard
- Erstinstallation im Browser
- Admin-Anlage, erster Invite, Testlauf

## 2.2 Deployment (MVP)
- Auslieferung per Docker Compose
- Dienste:
  - frontend
  - backend
  - db (PostgreSQL empfohlen)
  - optional reverse-proxy

## 2.3 Realtime-Prinzip
- Serverzeit ist massgeblich fuer Countdown und Token-Race.
- Client sendet Intent-Events, Server entscheidet und broadcastet Ergebnis.

## 3. Fachliche Kernablaeufe

## 3.1 Registrierung
1. Nutzer sendet Registrierungsdaten + Einladungstoken.
2. Backend prueft Token (gueltig, nicht abgelaufen, nicht deaktiviert).
3. Nutzerkonto wird erzeugt, Token wird konsumiert.

## 3.2 Tischlebenszyklus
1. Tischadmin erstellt Public/Private Tisch.
2. Spieler joinen (Max 5 aktiv), Zuschauer optional (Max 10).
3. Spielstart ab mindestens 2 aktiven Spielern.
4. Bei Admin-Disconnect: 60s Rejoin-Fenster, danach automatische Uebergabe.
5. Nach Spielende kann "Neue Partie" gestartet werden; dabei bleiben Spielerzusammensetzung und Tischeinstellungen erhalten.
6. "Neue Partie" bleibt in derselben Tischsession, damit Song-Wiederholungsregeln sessionweit durchgesetzt werden koennen.

## 3.3 Runde (Standard)
1. Startsignal vom Tischadmin.
2. 3s Countdown.
3. Songstart (25s).
4. Songziehung beruecksichtigt Sperrlisten: keine Wiederholung in derselben Partie; keine Wiederholung in derselben Tischsession bis Playlist erschoepft ist.
5. Platzierungen waehrend Song erlaubt; danach Lock.
6. Auswertung serverseitig inkl. Duplikatjahre-Regel.
7. Kartenvergabe und Event-Protokoll.

## 3.4 Token-Race
1. Spieler kann waehrend Song Token claimen.
2. Schnellster Claim stoppt Song.
3. 10s Solo-Exaktjahr fuer Claim-Gewinner.
4. Bei falscher Eingabe: 10s Fenster fuer Gegenspieler, inkl. Anzeige des falsch geratenen Jahres.
5. Token wird immer verbraucht.

## 4. Datenmodell (konzeptionell)

## 4.1 Entitaeten
1. User
- id, username, email, password_hash, role, karma_points, score_points, created_at, status

2. InviteToken
- id, code, created_by, max_uses, used_count, expires_at, disabled_at

3. Table
- id, owner_user_id, visibility(public/private), join_code, allow_spectators, max_players, max_spectators, state

4. TableSeat
- id, table_id, user_id, seat_type(player/spectator), joined_at, left_at

5. Game
- id, table_id, table_session_id, started_at, ended_at, winner_user_id, status

6. Round
- id, game_id, index_no, song_id, started_at, ended_at, mode(normal/token/bonus), status

7. SongRef
- id, source(adolar/local), source_song_id, title, year, duration_sec, stream_ref, is_valid

8. TimelineCard
- id, game_id, user_id, year_value, source_round_id, special_type(normal/token_win), placed_position

9. Guess
- id, round_id, user_id, guess_type(position/exact_year), value, submitted_at, is_correct

10. TokenUsage
- id, round_id, user_id, claimed_at, resolved_at, result

11. KarmaLedger
- id, user_id, delta, reason, game_id, created_at

12. ScoreLedger
- id, user_id, delta, reason, game_id, created_at

13. TableSession
- id, table_id, started_at, ended_at, status

14. SessionSongHistory
- id, table_session_id, song_ref_id, first_played_round_id, play_count

## 4.2 Wichtige Constraints
- Aktive Spieler pro Tisch <= 5
- Zuschauer pro Tisch <= 10
- Pro Spieler pro Spiel initial 2 Tokens
- Rejoin ohne Malus nur innerhalb 90 Sekunden
- Pro Partie darf ein Song nur einmal vorkommen.
- Pro Tischsession darf ein Song erst nach kompletter Playlist-Ausschoepfung erneut vorkommen.

## 4.3 Song-Pool-Algorithmus (serverseitig)
1. Erzeuge Kandidatenmenge aus allen gueltigen Songs der aktiven Playlist.
2. Entferne Songs, die in der aktuellen Partie bereits gespielt wurden.
3. Entferne Songs, die in der aktuellen Tischsession bereits gespielt wurden.
4. Falls keine Kandidaten uebrig sind und alle Playlist-Songs in der Tischsession bereits gespielt wurden: Session-Songpool zuruecksetzen.
5. Ziehe zufaellig aus dem dann gueltigen Kandidatenpool.
6. Speichere Song in Partien-Historie und SessionSongHistory.

## 4.4 Datenbankregeln fuer Song-Integritaet
1. Unique Index auf Round(game_id, song_id), damit ein Song pro Partie nicht doppelt vorkommt.
2. Unique Index auf SessionSongHistory(table_session_id, song_ref_id), damit die Sessionhistorie je Song eindeutig ist.
3. Foreign Keys:
- Game.table_session_id -> TableSession.id
- SessionSongHistory.first_played_round_id -> Round.id
4. Transaktionsregel fuer Songziehung:
- Songauswahl, Rundenerzeugung und Historieneintrag in einer Transaktion speichern.
- Bei Race-Condition Konflikt (Unique-Verletzung) erneut ziehen.

## 5. Zustandsmodell (vereinfacht)

Table.state:
- OPEN
- RUNNING
- FINISHED
- CLOSED

Game.status:
- PENDING
- ACTIVE
- FINISHED
- ABORTED

Round.status:
- COUNTDOWN
- PLAYING
- TOKEN_SOLO
- TOKEN_OTHERS
- RESOLVED
- FAILED

## 6. UI-Leitlinien
1. Playboard nach freigegebener Skizzenlogik.
2. Eingabefeld rechts mit zwei Aktionen:
- Gruen/Haken = bestaetigen
- Rot/X = loeschen
3. Countdown immer prominent sichtbar.
4. Token-Buttons schnell erreichbar unten links.

## 7. Branding-Umsetzung
1. Brand-Quelle: https://github.com/noyse27/adolar-brand-images
2. Font-Stack: Orbitron, Orbitron Medium, Orbitron Regular, Segoe UI, sans-serif
3. Farbwerte aus palette/colors.svg und docs/styleguide.md ableiten.
4. Logo/Rakete aus offiziellen Asset-Dateien nutzen.

## 8. Fehlerbehandlung
1. Song ohne gueltiges Jahr: skip + log.
2. Stream-Timeout: Runde abort, 1 Auto-Retry mit neuem Song, danach Fehlerstatus.
3. Verbindungsabbruch: Rejoin-Fenster 90s.

## 9. Sicherheit und Betrieb
1. Passwort-Hashing mit aktuellem Standard (argon2 oder bcrypt).
2. Session-Token mit Ablaufzeit.
3. Rate-Limits auf Auth- und Spielaktionen.
4. Audit-Logs fuer kritische Aktionen (Invite, Sperrung, Admin-Uebergabe).

## 10. Vorbereitung Phase 2 (lokaler Scan)
1. Source-Abstraktion fuer Songs jetzt schon einbauen (adolar/local).
2. SongRef so modellieren, dass lokale Quellen spaeter nahtlos anschliessbar sind.
3. Rollenpruefung fuer Scan-Start vorsehen (vermutlich nur Admin).
