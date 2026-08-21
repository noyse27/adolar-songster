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

POST /tables/{tableId}/join
- Request:
{
  "joinAs": "player|spectator",
  "joinCode": "string optional"
}

POST /tables/{tableId}/leave

POST /tables/{tableId}/start
- Nur Tischadmin
- Voraussetzung: mindestens 2 aktive Spieler

POST /tables/{tableId}/new-game
- Nur Tischadmin
- Startet nach Spielende eine neue Partie mit gleicher Spielerzusammensetzung und gleichen Tischeinstellungen.
- Bleibt in derselben Tischsession (fuer sessionweite Songpool-Regeln).

## 5. Spiel und Runden

GET /games/{gameId}
- Spielstatus, Spieler, Zwischenstand
- Enthalten: tableSessionId zur Nachvollziehbarkeit von "Neue Partie"-Folgen

POST /games/{gameId}/rounds/{roundId}/guess
- Request:
{
  "type": "position|exact_year",
  "value": "string|number"
}

POST /games/{gameId}/rounds/{roundId}/token-claim
- Claim fuer Token-Race

POST /games/{gameId}/rounds/{roundId}/token-submit
- Exaktjahr durch Token-Gewinner
- Request:
{
  "year": 1993
}

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
