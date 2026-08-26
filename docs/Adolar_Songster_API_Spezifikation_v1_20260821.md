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
- Spieler-Join bei state=running nur erlaubt, wenn der Nutzer bereits
  irgendwann an diesem Tisch gesessen hat (Rejoin nach Disconnect, FR-045);
  neue Spieler koennen nur bei state=open beitreten

POST /tables/{tableId}/leave
- Verlaesst der Tischadmin den Tisch, startet das 60s-Reconnect-Fenster
  (FR-016); danach automatische Uebergabe an den laengst anwesenden aktiven
  Spieler beim naechsten Join/Leave/Start/Detail-Aufruf fuer diesen Tisch
- Verlaesst ein Spieler waehrend einer laufenden Partie (game.status=active),
  startet ein 90s-Rejoin-Fenster (FR-045). Rejoin per POST .../join
  innerhalb des Fensters: kein Karma-Malus. Kein Rejoin: Karma -5, zusaetzlich
  -1 pro zu diesem Zeitpunkt noch aktivem Mitspieler (FR-044)

POST /tables/{tableId}/start
- Nur aktueller Tischadmin (oder globaler Admin)
- Voraussetzung: Tisch state=open, mindestens 2 aktive Spieler (FR-020)
- Erzeugt table_session und game, setzt Tisch auf state=running

POST /tables/{tableId}/new-game
- Nur aktueller Tischadmin (oder globaler Admin)
- Voraussetzung: Tisch state=finished (vorherige Partie beendet)
- Startet nach Spielende eine neue Partie mit gleicher Spielerzusammensetzung
  (kein Neu-Join noetig, AK-009) und gleichen Tischeinstellungen; mindestens
  2 aktive Spieler weiterhin erforderlich
- Bleibt in derselben Tischsession wie die vorherige Partie (table_session_id
  unveraendert), damit die sessionweite Songpool-Regel (AK-011) weiter gilt
- Response 200: { tableId, tableSessionId, gameId }; 409 falls Tisch noch
  nicht state=finished

## 5. Spiel und Runden

Konkretisierung (Sprint 3, Rundenkern):
- Beim Tischstart (POST /tables/{id}/start) erhaelt jeder aktive Spieler 2
  Start-Jahresbloecke (FR-023), gezogen aus [minSongYear-10,
  max(maxSongYear+10, aktuelles Jahr)] (FR-024). Die beiden gezogenen Jahre
  werden ohne Wiederholung gezogen (FR-023: keine zwei identischen
  Startjahre). Ohne gueltige Songs im Songpool schlaegt der Tischstart fehl
  (400).
- Rundenablauf ist serverautoritativ per Timer: 3s Countdown (status
  "countdown", FR-021) -> 25s Songfenster (status "playing", FR-022) ->
  automatische Auswertung (status "resolved"). Diese Dauern sind ueber
  ROUND_COUNTDOWN_MS/ROUND_SONG_DURATION_MS konfigurierbar (Testzwecke).
- Songjahr wird erst nach Rundenaufloesung offengelegt.
- Guess-Typ "exact_year" (Token-Mechanik) ist erst ab Sprint 4 implementiert.
- WS-Broadcast der Rundenevents (Abschnitt 8) ist noch nicht verdrahtet;
  Clients pollen aktuell GET /games/{gameId}/rounds/{roundId}.

Konkretisierung (Sprint 5, Sieg/Bonusrunde):
- Nach jeder kartenvergebenden Aufloesung (normale Runde, Token-Solo,
  Token-Gegenspieler) wird geprueft, ob ein Spieler die Siegschwelle von 10
  Karten erreicht hat (FR-040). Genau ein Spieler an der Schwelle: Partie
  endet sofort (game.status=finished, winner_user_id gesetzt, Tisch
  state=finished), Score/Karma werden verbucht (FR-042/043).
- Erreichen mehrere Spieler die Schwelle in derselben Runde gleichzeitig,
  bleibt die Partie aktiv (Gleichstand). Der naechste POST .../rounds-Aufruf
  erkennt das automatisch und startet statt einer normalen Runde eine
  Bonusrunde (mode=bonus, Stichsong, FR-041).
- Bonusrunde: nur die gleichauf liegenden Spieler duerfen per POST .../guess
  mit {"type":"exact_year","value":<jahr>} genau einen Exaktjahr-Versuch
  abgeben; Aufloesung am Fensterende (BONUS_WINDOW_MS, Default 10s), gleicher
  50ms-Tie-Break wie beim Token-Claim. Niemand korrekt: Partie bleibt im
  Gleichstand, naechster Stichsong bei erneutem Rundenstart.

GET /games/{gameId}
- Spielstatus (inkl. finished/winnerUserId), Spieler (inkl. aktueller
  Kartenanzahl), Zwischenstand
- Enthalten: tableSessionId zur Nachvollziehbarkeit von "Neue Partie"-Folgen

POST /games/{gameId}/rounds
- Nur aktueller Tischadmin (oder globaler Admin)
- Zieht naechsten Song aus dem Songpool (Feinkonzept 4.3) und startet die
  Runde (status=countdown); mode=bonus bei bestehendem Gleichstand (FR-041),
  sonst mode=normal
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

GET /games/{gameId}/rounds/{roundId} liefert zusaetzlich die Felder mode
("normal" oder "token"), tokenSoloUserId (der Claim-Gewinner, waehrend und
nach der Token-Phase gesetzt) und tokenWrongGuessYear (das falsch geratene
Jahr des Claim-Gewinners, sichtbar sobald status=token_others, FR-035).

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

Highscoreformel (FR-042): Gewinner erhaelt 1 Siegpunkt + 1 Punkt pro
Gegner (bei n aktiven Spielern also n Punkte). Karma (FR-043/044):
komplett gespieltes Match +5 fuer jeden noch aktiven Spieler; vorzeitiges
Verlassen einer laufenden Partie -5, zusaetzlich -1 pro zu diesem
Zeitpunkt noch aktivem Mitspieler, sofern kein Rejoin innerhalb 90s
(FR-045).

GET /leaderboard
- Liefert bis zu 100 Nutzer sortiert nach scorePoints, dann karmaPoints

GET /users/{userId}/karma-ledger
- Verlauf der Karma-Buchungen (reason: match_completed | early_leave)

## 7. Setup und Health

GET /setup/status
- Oeffentlich, keine Seiteneffekte
- Response: { adminExists: boolean } - steuert im Browser-Wizard (FR-062),
  ob Schritt 1 (Admin anlegen) angezeigt wird

POST /setup/bootstrap
- Erstsetup (Admin anlegen); nur nutzbar solange kein Admin existiert (409
  danach)

POST /setup/self-test
- Nur Admin
- FR-063: Funktionstest ohne Seiteneffekte auf echte Tische/Spiele -
  prueft Datenbankverbindung, ob der Songpool mindestens einen gueltigen
  Song enthaelt, und die Kern-Rundenlogik (Platzierungsauswertung) anhand
  synthetischer Daten
- Response 200 { healthy: true, checks: {...} } wenn alles gruen, sonst 503
  mit gleicher Struktur (checks zeigt, was fehlt, z. B. leerer Songpool vor
  Anbindung des Adolar-Connectors)

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
# Ergänzung 2026-08-26: Spielerkommunikation

Die verbindliche Detailquelle einschließlich Lieferstatus und Phasenmatrix ist
`Adolar_Songster_Spielerkommunikation_Whatsnew_Quelle_v1_20260826.md`.

## Kommunikations-REST

- `GET|POST /communications/lobby/messages`: angemeldeter Lobby-Kanal.
- `GET|POST /tables/{tableId}/messages`: nur mit aktivem Spieler- oder
  Zuschauersitz am Tisch.
- POST-Body `{ "body": string }`, getrimmt 1–500 Zeichen.
- Verlauf: maximal 50 Nachrichten, höchstens 30 Minuten alt.
- Absenderlimit: 12 Nachrichten/Minute; bei Überschreitung `429
  CHAT_RATE_LIMITED`.
- Vor dem Speichern wendet der Server die Admin-Konfiguration an: vollständige
  Wort-/Phrasentreffer werden durch `*piep*` ersetzt und bekannte Emoticons werden
  optional in Unicode-Emojis konvertiert.
- `GET /admin/communication-settings`: liefert Admins `textChat`, die sechs
  Reaktionslisten, den kuratierten Katalog und die Standardbelegung.
- `PUT /admin/communication-settings`: ersetzt die Textchat- und
  Reaktionseinstellungen atomar. Pro Phase sind höchstens acht unterschiedliche
  Katalog-IDs mit Beschriftungen von 1–24 Zeichen zulässig.

## Kommunikations-WebSocket

- `chat:message`: Server-Broadcast einer gespeicherten Nachricht in den
  Lobby- oder Tischraum.
- `game:reaction`: bidirektionaler Eventname. Client sendet `{ gameId,
  reactionId }`; Server prüft aktiven Spielersitz, Phasenkatalog und
  1-Sekunden-Cooldown und sendet das normalisierte Ereignis einschließlich
  `phase`, `symbol`, `label` und `kind` in den Spielraum.
- Kommunikationsphasen: `waiting`, `countdown`, `playing`, `token`,
  `resolved`, `finished`.
- `communication:config-updated`: Server verteilt nach einem Admin-Update die
  öffentlichen Reaktionslisten an alle verbundenen Clients. Gesperrte Wörter sind
  nicht Teil dieses Ereignisses.
- Display-Tokens und Zuschauer können Reaktionen empfangen, aber nicht senden.
