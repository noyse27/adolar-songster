# Adolar Songster – Spielerkommunikation / What’s-new-Quelle v1

Stand: 2026-08-26

Feature-Branch: `codex/feature-player-communication`

Zweck: Verbindliche Übergabequelle für Entwicklung, Review, Release und eine spätere What’s-new-Erstellung.

## 1. Aktueller Lieferstatus – nicht mit Spielphasen verwechseln

| Lieferabschnitt | Status am 2026-08-26 |
|---|---|
| Produktentscheidung „Variante 1“ | entschieden |
| Lobby-Chat | auf Feature-Branch implementiert |
| Tisch-Chat | auf Feature-Branch implementiert |
| Playboard-Schnellreaktionen | auf Feature-Branch implementiert |
| Anzeige der Reaktionen im Hostmodus | auf Feature-Branch implementiert |
| Adminbereich „Chateinstellungen“ | auf Feature-Branch implementiert |
| Emoticon-Konvertierung und Wortfilter | auf Feature-Branch implementiert |
| Administrierbarer Reaktionskatalog | auf Feature-Branch implementiert |
| Datenbankmigrationen | implementiert und gegen separate Testdatenbank geprüft |
| Unit-/Integrationsprüfung | grün |
| Review/Merge nach `main` | **noch offen** |
| Deployment in die laufende Instanz | **noch offen** |
| Melden, Moderationsoberfläche, manuelles Löschen | **nicht Teil dieser Phase** |
| Sprachchat/WebRTC | **nicht Teil dieser Variante** |

Eine What’s-new-Mitteilung darf das Feature erst nach Merge und Deployment als
„verfügbar“ bezeichnen. Vorher ist die korrekte Formulierung „für das nächste
Update vorbereitet“ oder „auf dem Feature-Branch implementiert“.

## 2. Nutzerfunktion

### 2.1 Lobby-Chat

- Auf `/lobby` befindet sich unter der öffentlichen Tischliste ein Live-Chat.
- Lesen und Schreiben ist nur für angemeldete Konten möglich.
- Der Kanal gilt für die gesamte öffentliche Lobby, nicht für einen einzelnen Tisch.
- Die letzten maximal 50 Nachrichten innerhalb der letzten 30 Minuten werden geladen.
- Enter sendet, Umschalt+Enter erzeugt einen Zeilenumbruch.
- Pro Nachricht sind höchstens 500 Zeichen erlaubt.

### 2.2 Tisch-Chat

- Auf `/tisch/:tableId` erscheint ein separater Chat nach erfolgreichem Beitritt.
- Aktive Spieler und aktive Zuschauer des konkreten Tisches dürfen lesen und schreiben.
- Konten ohne aktiven Sitz erhalten absichtlich `404`, damit ein privater Tisch nicht
  über den Kommunikationsendpunkt bestätigt oder ausgelesen werden kann.
- Der Tisch-Chat wird beim Start der Partie nicht in das Playboard übernommen. Im
  Playboard ersetzen Schnellreaktionen den freien Text, damit Tippen und Diskussionen
  das Musikerkennen nicht dominieren.

### 2.3 Playboard-Schnellreaktionen

- Nur aktive **Spieler** dürfen Reaktionen senden; Zuschauer und Display-Tokens nicht.
- Alle berechtigten Spielraum-Teilnehmer empfangen sie in Echtzeit.
- Eine Reaktion erscheint 3,5 Sekunden als Sprechblase am Avatar.
- Im Hostmodus zeigt das gemeinsame Display die Reaktionen aller Spieler. Das kompakte
  Spielergerät kann weiterhin selbst reagieren.
- Reaktionen werden nicht in PostgreSQL gespeichert.
- Pro Socket ist höchstens eine Reaktion pro Sekunde zulässig.

### 2.4 Administration

- Im Adminbereich öffnet der Abschnitt **Chateinstellungen** eine Oberfläche mit
  getrennten Reitern für **Textchat** und **Playboard-Reaktionen**.
- Die optionale Emoticon-Konvertierung ersetzt serverseitig unter anderem `:)`,
  `:D`, `;)`, `:(` und `<3` durch Unicode-Emojis. Eine Live-Vorschau im
  Adminbereich zeigt das Ergebnis vor dem Speichern.
- Der Wortfilter nimmt bis zu 100 kommaseparierte Wörter oder Phrasen mit je maximal
  40 Zeichen auf. Treffer werden ohne Beachtung der Groß-/Kleinschreibung als
  vollständige Wörter bzw. Phrasen durch `*piep*` ersetzt.
- Für jeden der sechs Spielzustände wählt ein Admin bis zu acht Reaktionen aus einem
  kuratierten Katalog. Ein Motiv darf pro Zustand nur einmal vorkommen; Beschriftungen
  sind frei anpassbar (1–24 Zeichen), Einträge können entfernt und sortiert werden.
- Der Katalog enthält 20 sichere, codeeigene Unicode-Motive einschließlich der
  Sticker-Option **„Elvis tanzt“** (`🕺`). Freie HTML-, URL- oder Bild-Uploads sind
  absichtlich nicht möglich.
- Nach dem Speichern wird die neue Reaktionskonfiguration per Socket.IO live an
  Playboards und Hostdisplays verteilt. Die Wortfilterliste bleibt dabei ausschließlich
  im geschützten Admin-/Serverkontext.

## 3. Spielphasen und Reaktionskatalog

„Phase“ bezeichnet in diesem Abschnitt ausschließlich den aktuellen Spielzustand,
nicht den Lieferstatus aus Abschnitt 1. Frontend und Backend leiten daraus denselben
Kommunikationszustand ab.

| Kommunikationsphase | Abgeleitet aus Spielzustand | Verfügbare Reaktionen |
|---|---|---|
| `waiting` | Noch keine Runde, letzte Runde `resolved` oder Bereit-Fenster | 👋 Hallo, 👍 Stark, 😂 Lustig, 🎯 Guter Tipp, ⚠️ Technikproblem |
| `countdown` | Runde hat Status `countdown` | 👍 Stark, 🤔 Keine Ahnung, ⚠️ Technikproblem |
| `playing` | Runde hat Status `playing` | 👍 Stark, 🤔 Keine Ahnung, ⚠️ Technikproblem |
| `token` | `token_solo` oder `token_others` | 👍 Stark, 🤔 Keine Ahnung, ⚠️ Technikproblem |
| `resolved` | letzte Runde hat Status `resolved` | 👍 Stark, 😂 Lustig, 🎯 Guter Tipp, ⚠️ Technikproblem |
| `finished` | Partie hat Status `finished` | 👍 Stark, 😂 Lustig, 🎯 Guter Tipp, ⚠️ Technikproblem |

Die Tabelle zeigt die ausgelieferten Standardwerte. Maßgeblich ist nach einer
Adminänderung die gespeicherte Konfiguration. Der Server prüft sie bei jedem Ereignis
erneut. Ein manipulierter Client kann daher weder freie Emoji-/HTML-Payloads noch eine
in der aktuellen Phase gesperrte Reaktion verteilen.

## 4. Technische Architektur

### 4.1 Chat: REST schreiben/lesen, Socket.IO verteilen

Chatnachrichten werden über REST validiert und gespeichert. Nach erfolgreichem Insert
verteilt der Server die normalisierte Nachricht über den vorhandenen Lobby- bzw.
Tischraum. Diese Trennung ermöglicht nachvollziehbare Fehlercodes, Verlauf und
serverseitige Berechtigungsprüfungen, ohne den Spielzustand aufzublähen.

REST-Verträge:

| Methode | Pfad | Berechtigung |
|---|---|---|
| `GET` | `/api/v1/communications/lobby/messages` | angemeldet |
| `POST` | `/api/v1/communications/lobby/messages` | angemeldet |
| `GET` | `/api/v1/tables/:tableId/messages` | aktiver Tischsitz |
| `POST` | `/api/v1/tables/:tableId/messages` | aktiver Tischsitz |
| `GET` | `/api/v1/admin/communication-settings` | Admin |
| `PUT` | `/api/v1/admin/communication-settings` | Admin |

POST-Body:

```json
{ "body": "Hallo zusammen!" }
```

Erfolgreiche Antwort und Socket-Event `chat:message` enthalten:

```json
{
  "message": {
    "id": "uuid",
    "scope": "lobby|table",
    "tableId": "uuid|null",
    "senderUserId": "uuid",
    "senderUsername": "Name",
    "body": "Hallo zusammen!",
    "createdAt": "ISO-8601"
  }
}
```

Bei mehr als 12 Nachrichten eines Absenders innerhalb einer Minute antwortet der
Server mit `429`, Fehlercode `CHAT_RATE_LIMITED` und `Retry-After`.

### 4.2 Reaktionen: ausschließlich Socket.IO

Client → Server:

```text
game:reaction { gameId, reactionId }
```

Bestätigung:

```text
{ ok: true }
{ ok: false, error: "..." }
```

Server → berechtigter Spielraum:

```json
{
  "gameId": "uuid",
  "userId": "uuid",
  "username": "Name",
  "reactionId": "Katalog-ID",
  "phase": "waiting|countdown|playing|token|resolved|finished",
  "symbol": "👍",
  "label": "Stark",
  "kind": "emoji|sticker",
  "sentAt": "ISO-8601"
}
```

Der Server prüft dabei Spielzugehörigkeit, Sitztyp `player`, Reaktionskatalog,
Spielphase und Cooldown. Ein Display-Token besitzt keine Nutzeridentität und kann
deshalb nur empfangen.

Nach einem erfolgreichen Admin-Update verteilt der Server zusätzlich:

```text
communication:config-updated { reactions }
```

Der aktuelle Reaktionskatalog ist außerdem Teil des regulären Spielzustands, damit
neu verbundene oder neu geladene Clients ohne separates Adminrecht konsistent starten.

## 5. Datenmodell und Aufbewahrung

Migrationen:

- `backend/migrations/1757664000000_player-communication.js`
- `backend/migrations/1757750400000_communication-admin-settings.js`

Die Tabelle `chat_message` enthält Kanaltyp, optionale Tisch-ID, Absender, Text,
Zeitstempel und ein vorbereitetes `deleted_at`. Constraints erzwingen:

- nur `lobby` oder `table` als Scope;
- Tisch-ID genau dann, wenn Scope `table` ist;
- Textlänge 1–500 nach Trimmen;
- automatische Löschung von Tischchat bei Löschung des Tisches.

Ein Job löscht alle fünf Minuten Nachrichten, die älter als 30 Minuten sind. Die
Leseabfrage blendet abgelaufene Nachrichten unabhängig vom Job bereits aus.

Die Tabelle `playboard_reaction` speichert Phase, Katalog-ID, Beschriftung und
Sortierreihenfolge. Datenbank-Constraints sichern sechs gültige Phasen, maximal acht
Positionen sowie eindeutige Motive und Positionen pro Phase. Die beiden Textchatwerte
werden unter `communication.chat.*` in `system_setting` gehalten. Das Speichern aller
Kommunikationseinstellungen erfolgt in einer gemeinsamen Transaktion.

## 6. Sicherheits- und Datenschutzentscheidungen

- React rendert Nachrichten als Text, nicht als HTML. Eingesendetes Markup wird
  deshalb nicht ausgeführt.
- Tischberechtigungen werden bei jedem Lese- und Schreibzugriff neu aus der DB geladen.
- Reaktionsberechtigungen werden bei jedem Socket-Ereignis neu geprüft; bloßer Besitz
  einer `gameId` genügt nicht.
- Wortfilter und Emoticon-Konvertierung erfolgen vor dem Speichern serverseitig und
  können daher nicht durch einen veränderten Browser umgangen werden.
- Reaktionsmotive stammen ausschließlich aus dem kuratierten Serverkatalog; ein
  Admin-Request kann keine beliebigen Symbole, URLs oder Markup einschleusen.
- Chatdaten sind kurzlebig; Reaktionen sind vollständig flüchtig.
- Die globale API-Begrenzung bleibt aktiv, zusätzlich gilt das Absenderlimit im Chat.
- Noch nicht umgesetzt sind Nutzerblockierung, Melden, Moderationsansicht und manuelles
  Soft-Delete. Diese Punkte dürfen in Releasekommunikation nicht als vorhanden gelten.

## 7. Geänderte Codebereiche

| Bereich | Wesentliche Dateien |
|---|---|
| Migration/Datenmodell | `backend/migrations/1757664000000_player-communication.js`, `backend/migrations/1757750400000_communication-admin-settings.js` |
| Chat-/Phasen-/Konfigurationslogik | `backend/src/services/communication.ts` |
| REST | `backend/src/routes/communications.ts`, `backend/src/routes/admin.ts`, `backend/src/app.ts` |
| Echtzeit | `backend/src/realtime/socketServer.ts`, `backend/src/realtime/broadcast.ts` |
| Aufräumjob | `backend/src/services/scheduler.ts`, `backend/src/index.ts` |
| Chat UI | `frontend/src/components/ChatPanel.tsx`, `frontend/src/pages/LobbyPage.tsx`, `frontend/src/pages/TableRoomPage.tsx` |
| Reaktions-UI | `frontend/src/components/ReactionBar.tsx`, `frontend/src/game/reactions.ts`, `frontend/src/game/LiveGameBoard.tsx` |
| Hostmodus | `frontend/src/pages/DisplayPage.tsx` |
| Admin UI | `frontend/src/pages/CommunicationSettingsSection.tsx`, `frontend/src/pages/AdminPage.tsx` |
| Gestaltung | `frontend/src/pages/pages.css`, `frontend/src/playboard/Playboard.css` |

## 8. Prüfung und Abnahme

Am 2026-08-26 ausgeführt:

- Backend- und Frontend-Lint: erfolgreich, keine Warnungen nach Bereinigung.
- Backend-Unit-Tests: 51/51 erfolgreich.
- Frontend-Unit-Tests: 3/3 erfolgreich.
- Backend-Integrationstests: 106/106 erfolgreich auf separater Testdatenbank.
- Produktionsbuild beider Workspaces: erfolgreich.
- Migration von leerer Datenbank bis einschließlich Spielerkommunikation: erfolgreich.

Feature-spezifisch geprüft werden unter anderem:

- leere und überlange Nachrichten;
- Lobby-Verlauf und 30-Minuten-Grenze;
- Zugriff durch Tischspieler/Zuschauer und Ablehnung fremder Konten;
- Reaktionskatalog und Spielphasen;
- Adminberechtigung, Speichern und erneutes Laden der Kommunikationseinstellungen;
- serverseitiger Wortfilter und Emoticon-Konvertierung;
- Socket-Broadcast an Spielraum;
- Ablehnung von Zuschauerreaktionen;
- Socket-Cooldown.

Vor Merge sollte zusätzlich ein manueller Mehrgeräte-Smoke-Test erfolgen: zwei
Browserkonten plus optionales Hostdisplay, jeweils Desktop und Smartphone-Breite.

## 9. Restrisiken und Folgephase

| Risiko | Stand/Maßnahme |
|---|---|
| Belästigung im globalen Lobby-Chat | Zeichen-/Ratenlimit vorhanden; Melden/Blockieren bleibt Folgephase |
| Gleichzeitige POSTs umgehen eventuell kurz das Absenderlimit | zusätzlich globale API-Grenze; bei größerer Nutzerzahl atomaren Limiter ergänzen |
| Unpassender Wortfiltertreffer | Filter arbeitet nur auf vollständigen Wörtern/Phrasen; Admin sollte die Liste vor Freigabe mit Beispielen prüfen |
| Reaktionskonfiguration wird parallel geändert | atomare Datenbanktransaktion; Oberfläche kennzeichnet ungespeicherte Änderungen, besitzt aber bewusst noch keine Versionskonfliktanzeige |
| Frontend-/Backend-Phasenmatrix driftet auseinander | sechs gemeinsame Bezeichner und Tests vorhanden; Backend bleibt die Autorität beim Senden |
| Reaktionen verdecken kleine Displays | kurze Dauer und responsive Buttons; manueller Mobiltest vor Merge empfohlen |
| Bestehende Instanz kennt `chat_message` noch nicht | Deployment muss Migration vor Backendstart ausführen |

## 10. Freigegebener What’s-new-Kerntext nach Deployment

> Neu in Songster: In der Lobby und am Tisch könnt ihr euch jetzt per Live-Chat
> abstimmen. Während einer Partie bleibt das Playboard bewusst ruhig: Statt eines
> Textchats stehen je nach Spielphase kurze, vom Admin konfigurierbare Reaktionen bereit.
> Optional wandelt Songster bekannte Text-Smileys in Emojis um und ersetzt Wörter aus
> dem serverweiten Wortfilter. Reaktionen erscheinen direkt
> am Spieleravatar und auch auf dem gemeinsamen Hostdisplay. Chatnachrichten werden
> automatisch nach 30 Minuten entfernt.

Nicht erwähnen, solange nicht separat umgesetzt: Sprachchat, Direktnachrichten,
Nutzerblockierung, Meldesystem oder dauerhafte Chatarchive.
