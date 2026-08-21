# Adolar Songster - API-Spezifikation (MVP)

Version: 1.0
Stand: 2026-08-21

## 1. API-Grundlagen
- Stil: REST fuer Ressourcen, WebSocket fuer Realtime-Events
- Basis-Pfad: /api/v1
- Auth: Bearer Token (JWT oder gleichwertig)
- Zeitformat: ISO-8601 UTC

## 2. Auth und Nutzer

POST /auth/register
- Zweck: Registrierung mit Einladungstoken
- Request:
{
  "username": "string",
  "email": "string",
  "password": "string",
  "inviteCode": "string"
}
- Response 201:
{
  "userId": "uuid",
  "username": "string"
}

POST /auth/login
- Request:
{
  "usernameOrEmail": "string",
  "password": "string"
}
- Response 200:
{
  "accessToken": "string",
  "expiresIn": 3600,
  "user": { "id": "uuid", "username": "string", "role": "user|admin" }
}

GET /users/me
- Response: Profil inkl. score und karma

## 3. Invite-Management

Konkretisierung (Sprint 1, ergaenzt die urspruengliche Spezifikation):
- Admin: unbegrenzte Invite-Erzeugung, kann anderen Nutzern das Recht zur
  Invite-Erzeugung erteilen/entziehen.
- Freigeschalteter Nutzer (can_create_invites): maximal 3 Invites pro
  Kalendermonat. Zaehlfenster kann durch Admin vorzeitig zurueckgesetzt werden.
- Default je Invite (falls nicht angegeben): maxUses=1, expiresInDays=14
  (FR-004).

POST /invites
- Berechtigung: admin oder freigeschalteter Nutzer
- Request:
{
  "maxUses": 1,
  "expiresInDays": 14
}
- Response 429 bei ausgeschoepftem Monatslimit, 403 ohne Berechtigung

GET /invites
- Listet eigene Invites; Admin sieht alle Invites

POST /invites/{inviteId}/disable
- Deaktiviert eigenes Invite sofort; Admin kann jedes Invite deaktivieren

POST /admin/users/{userId}/invite-permission
- Nur Admin
- Request: { "canCreateInvites": true|false }
- Erteilt oder entzieht das Recht zur Invite-Erzeugung

POST /admin/users/{userId}/revoke-invites
- Nur Admin
- Request:
{
  "invalidateCreatedInvites": true,
  "deactivateRegisteredUsers": true
}
- Entzieht das Invite-Recht; optional werden alle vom Nutzer erzeugten
  Invites deaktiviert und/oder alle darueber registrierten Nutzer gesperrt

POST /admin/users/{userId}/reset-invite-quota
- Nur Admin
- Setzt das Monatslimit des Nutzers sofort zurueck

GET /admin/invites/log
- Nur Admin
- Liefert je Invite: Ersteller (Username), Code, Status, und alle darueber
  registrierten Nutzer (Username)

POST /setup/bootstrap
- Legt den ersten Admin-Account an; nur nutzbar solange noch kein Admin
  existiert (danach 409)

## 4. Lobby und Tische

POST /tables
- Request:
{
  "name": "Freitagsrunde",
  "visibility": "public|private",
  "allowSpectators": true,
  "maxPlayers": 5,
  "maxSpectators": 10
}
- Response mit tableId und ggf. joinCode

GET /tables/lobby
- Liefert offene Public-Tische

GET /tables/{tableId}
- Tischdetails inkl. aktueller Besetzung; wertet bei Aufruf das
  Admin-Uebergabe-Zeitfenster aus (siehe unten)

POST /tables/{tableId}/join
- Request:
{
  "joinAs": "player|spectator",
  "joinCode": "string optional"
}
- Spieler-Join nur wenn state=open; Zuschauer-Join auch waehrend state=running
- Response 409 TABLE_FULL / TABLE_NOT_JOINABLE, 403 TABLE_JOIN_CODE_INVALID
- Erneuter Join des Tischadmins innerhalb des Reconnect-Fensters storniert die
  laufende Admin-Uebergabe (FR-016)

POST /tables/{tableId}/leave
- Verlaesst der Tischadmin den Tisch, startet das 60s-Reconnect-Fenster
  (FR-016); danach automatische Uebergabe an den laengst anwesenden aktiven
  Spieler beim naechsten Join/Leave/Start/Detail-Aufruf fuer diesen Tisch

POST /tables/{tableId}/start
- Nur aktueller Tischadmin (oder globaler Admin)
- Voraussetzung: Tisch state=open, mindestens 2 aktive Spieler (FR-020)
- Erzeugt table_session und game, setzt Tisch auf state=running

POST /tables/{tableId}/new-game
- Nur Tischadmin
- Startet nach Spielende eine neue Partie mit gleicher Spielerzusammensetzung und gleichen Tischeinstellungen.
- Bleibt in derselben Tischsession (fuer sessionweite Songpool-Regeln).

## 5. Spiel und Runden

Konkretisierung (Sprint 3, Rundenkern):
- Beim Tischstart (POST /tables/{id}/start) erhaelt jeder aktive Spieler 2
  Start-Jahresbloecke (FR-023), gezogen aus [minSongYear-10,
  max(maxSongYear+10, aktuelles Jahr)] (FR-024). Ohne gueltige Songs im
  Songpool schlaegt der Tischstart fehl (400).
- Rundenablauf ist serverautoritativ per Timer: 3s Countdown (status
  "countdown", FR-021) -> 25s Songfenster (status "playing", FR-022) ->
  automatische Auswertung (status "resolved"). Diese Dauern sind ueber
  ROUND_COUNTDOWN_MS/ROUND_SONG_DURATION_MS konfigurierbar (Testzwecke).
- Songjahr wird erst nach Rundenaufloesung offengelegt.
- Guess-Typ "exact_year" (Token-Mechanik) ist erst ab Sprint 4 implementiert.
- WS-Broadcast der Rundenevents (Abschnitt 8) ist noch nicht verdrahtet;
  Clients pollen aktuell GET /games/{gameId}/rounds/{roundId}.

GET /games/{gameId}
- Spielstatus, Spieler (inkl. aktueller Kartenanzahl), Zwischenstand
- Enthalten: tableSessionId zur Nachvollziehbarkeit von "Neue Partie"-Folgen

POST /games/{gameId}/rounds
- Nur aktueller Tischadmin (oder globaler Admin)
- Zieht naechsten Song aus dem Songpool (Feinkonzept 4.3) und startet die
  Runde (status=countdown)
- Response 409 ROUND_ALREADY_ACTIVE / GAME_NOT_ACTIVE / NO_SONGS_AVAILABLE

GET /games/{gameId}/rounds/{roundId}
- Rundenstatus; songYear und results (je Spieler: geratener Index,
  correct) erst sichtbar nach status=resolved

POST /games/{gameId}/rounds/{roundId}/guess
- Nur waehrend status=playing (sonst 409 ROUND_LOCKED), mehrfache
  Einsendung ueberschreibt vorherige (FR-025)
- Request:
{
  "type": "position|exact_year",
  "value": "string|number"
}
- "position": value = Einfuegeindex (0..Timelinelaenge) in die eigene
  Timeline; korrekt wenn die relative Position zu den Nachbarkarten stimmt
  (FR-026/027)

Konkretisierung Token-Mechanik (Sprint 4):
- Jeder Claim verbraucht sofort einen der 2 Tokens des Spielers (FR-031),
  unabhaengig davon ob er das Race gewinnt (result "race_lost" bei
  Verlust, "solo_correct"/"solo_wrong"/"solo_timeout" beim Gewinner).
- Nach dem ersten Claim sammelt der Server 150ms lang weitere Claims
  (Grace-Fenster) und ermittelt danach den Gewinner: fruehester
  Server-Zeitstempel gewinnt; liegen mehrere Claims innerhalb von 50ms,
  entscheidet Zufall (FR-036). Ab dem ersten Claim ist die Runde fuer
  normale Positions-Guesses gesperrt (Song gilt als gestoppt, FR-032).
- Solo-Fenster 10s (FR-033): korrekt -> token_win-Karte, Runde sofort
  resolved. Falsch -> 10s Gegenspielerfenster (FR-034); Zeitueberschreitung
  ohne Eingabe -> Runde resolved ohne Karte, kein Gegenspielerfenster.
- Gegenspielerfenster: jeder Gegenspieler (ausser dem urspruenglichen
  Claimer) hat genau einen Versuch. Aufgeloest wird erst am Fensterende
  (nicht beim ersten Treffer), damit alle Gegner eine faire Chance haben;
  bei mehreren korrekten Treffern entscheidet derselbe Tie-Break wie beim
  Claim-Race.

POST /games/{gameId}/rounds/{roundId}/token-claim
- Response 202 { accepted: true, graceMs }
- Response 409 TOKEN_NOT_AVAILABLE (kein Claim-Fenster offen) /
  TOKEN_ALREADY_USED (bereits fuer diese Runde geclaimt oder Kontingent
  dieses Spiels erschoepft)

POST /games/{gameId}/rounds/{roundId}/token-submit
- Waehrend status=token_solo: nur der aktuelle Claim-Gewinner
- Waehrend status=token_others: jeder aktive Spieler ausser dem
  urspruenglichen Claimer, genau ein Versuch
- Request:
{
  "year": 1993
}
- Response 200 { correct: boolean }

GET /games/{gameId}/rounds/{roundId} liefert zusaetzlich:
- mode ("normal"|"token")
- tokenSoloUserId: aktueller/urspruenglicher Claim-Gewinner (waehrend und
  nach der Token-Phase)
- tokenWrongGuessYear: das falsch geratene Jahr des Claim-Gewinners,
  sichtbar sobald status=token_others (FR-035)

## 5a. Songpool-Administration (Uebergangsloesung)

Der reale Adolar-Connector ist noch nicht angebunden. Bis dahin pflegt ein
Admin den Songpool manuell:

POST /admin/songs
- Nur Admin
- Request: { "title": "string", "year": 1993, "durationSec": 180, "streamRef": "string optional", "source": "local|adolar" }

GET /admin/songs
- Nur Admin
- Listet alle Songs im Pool

## 6. Scores und Karma

GET /leaderboard
- Liefert Highscore-Ranking

GET /users/{userId}/karma-ledger
- Verlauf der Karma-Buchungen

## 7. Setup und Health

POST /setup/bootstrap
- Erstsetup (Admin anlegen)

POST /setup/self-test
- Fuehrt Funktionstest aus (Healthcheck + Testsong + Simulationsrunde)

GET /health
- Basis-Gesundheitsstatus

## 8. WebSocket-Events

Namespace: /ws

Client -> Server:
- table.join
- table.leave
- round.guess.submit
- round.token.claim
- round.token.submit

Server -> Client:
- table.updated
- game.started
- round.countdown.started
- round.song.started
- round.song.stopped
- round.token.claimed
- round.token.solo.started
- round.token.others.started
- round.guess.locked
- round.resolved
- game.finished
- admin.handover

## 9. Fehlercodes (Auszug)
- AUTH_INVALID_CREDENTIALS
- AUTH_INVITE_REQUIRED
- AUTH_INVITE_EXPIRED
- AUTH_INVITE_DISABLED
- TABLE_FULL
- TABLE_JOIN_CODE_INVALID
- TABLE_NOT_JOINABLE
- ROUND_LOCKED
- TOKEN_NOT_AVAILABLE
- TOKEN_ALREADY_USED
- SONG_METADATA_INVALID
- STREAM_TIMEOUT
- SONG_POOL_RESET

## 10. Fachregeln (serverseitig durchsetzen)
1. Countdown 3s, Songdauer 25s.
2. Pro Spieler 2 Tokens pro Spiel.
3. Token immer verbraucht.
4. Falsches Solo-Exaktjahr wird Gegenspielern angezeigt.
5. Exaktjahr-Fenster jeweils 10s.
6. Tie-Break Token-Race: Serverzeit, bei <=50ms Gleichstand Zufall.
7. Ein Song darf pro Partie nur einmal gespielt werden.
8. Ueber mehrere "Neue Partie"-Laeufe derselben Tischsession sind Wiederholungen erst nach kompletter Playlist-Ausschoepfung erlaubt; danach erfolgt Songpool-Reset.
