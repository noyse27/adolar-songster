# Sicherheits- und Technik-Audit: Adolar Songster

**Adressat:** Claude / nachfolgende Implementierungsinstanz  
**Audit-Datum:** 25.08.2026  
**Projektstand:** `0.3.0-beta`  
**Repository:** `F:\claude\adolar-songster`  
**Audit-Art:** Statische Code-, Konfigurations-, Architektur- und Testanalyse mit lokalen Build-/Lint-/Dependency-Checks  

## 1. Kurzfazit

Der Code besitzt eine erfreulich solide Basis: SQL wird im untersuchten Anwendungscode parametrisiert, Passwörter werden mit Argon2 gehasht, sicherheitsrelevante Spielzustandsänderungen verwenden an mehreren Stellen Transaktionen und Zeilensperren, das Backend-Image läuft als unprivilegierter Benutzer, und die CI enthält Linting, Tests, CodeQL, Trivy und Gitleaks.

In der aktuellen Form ist das System trotzdem **nicht produktionsreif für eine aus dem Internet oder einem nicht vollständig vertrauenswürdigen LAN erreichbare Installation**. Zwei bedingte, aber kritische Übernahmepfade und mehrere hohe Autorisierungs-/Integritätsprobleme müssen vor einem Produktivbetrieb geschlossen werden:

1. Das bekannte Standard-`JWT_SECRET` bleibt ohne Konfiguration aktiv. Weil die Rolle aus dem signierten Token übernommen und nicht gegen die Datenbank geprüft wird, kann ein normaler Benutzer bei bekanntem Standard-Secret einen Admin-Token für die eigene Benutzer-ID erzeugen.
2. Das öffentliche Bootstrap-Endpoint erlaubt auf einer frischen Installation dem ersten erreichenden Client die Admin-Anlage. Es gibt weder ein Setup-Geheimnis noch eine lokale Netz-/Console-Bindung; zudem ist die Konkurrenzsicherung beim Zustand „noch kein Admin vorhanden“ wirkungslos.
3. Private Tischdetails inklusive `joinCode`, Spielzustände und Rundendetails sind lediglich an „eingeloggt“, nicht an Tischmitgliedschaft oder Sichtbarkeit gebunden.
4. Socket.IO erlaubt jedem authentifizierten Socket – sogar einem auf genau einen Tisch beschränkten Display-Token – den Beitritt zu beliebigen Tisch- und Spielräumen.
5. Token-/Buzzer-Aktionen prüfen nicht, ob der Benutzer aktiver Spieler der betreffenden Partie ist. Fremde eingeloggte Benutzer können dadurch laufende Runden stoppen oder manipulieren.
6. Runden-, Bereitschafts-, Rejoin- und Auto-Close-Abläufe hängen an nicht persistenten In-Memory-Timern. Jeder Backend-Neustart kann Partien dauerhaft in einem Zwischenzustand festsetzen.
7. Das Integrationstest-Setup löscht ungeprüft alle Anwendungsdaten aus der über `DATABASE_URL` bezeichneten Datenbank. Eine Fehlkonfiguration beim lokalen Test kann daher eine echte Datenbank leeren.

**Gesamturteil:** Sicherheitsniveau „Beta/private vertrauenswürdige Testumgebung“, nicht „gehärteter Produktivbetrieb“. Vor Freigabe sollten mindestens alle kritischen und hohen Befunde behoben und mit negativen Autorisierungstests abgesichert werden.

## 2. Risikomodell und Einstufung

| Stufe | Bedeutung |
|---|---|
| Kritisch | Konto-/Systemübernahme oder vollständige Privilegieneskalation unter realistischen Fehlkonfigurationen/Deploymentbedingungen |
| Hoch | Fremdzugriff auf geschützte Daten, Manipulation fremder Spiele, dauerhafte Betriebsstörung oder hohes Datenverlustrisiko |
| Mittel | Begrenzte Sicherheitswirkung, wichtige Defense-in-Depth-Lücke, ausnutzbares Race oder erheblicher Betriebs-/Supply-Chain-Mangel |
| Niedrig | Härtung, Wartbarkeit, Dokumentationsdrift oder begrenzte Informations-/Qualitätswirkung |

Die Anwendung wird laut Dokumentation privat und für kleine Gruppen betrieben. Das reduziert die Zahl möglicher Angreifer, ersetzt aber keine Autorisierung: Ein gewöhnlicher eingeloggter Benutzer ist ausdrücklich als potenziell nicht vertrauenswürdig zu behandeln.

## 3. Durchgeführte Prüfungen

### 3.1 Erfolgreiche lokale Checks

- `npm run lint`: erfolgreich für Backend und Frontend.
- `npm run test:unit`: erfolgreich.
  - Backend: 9 Suites, 44 Tests.
  - Frontend: 1 Datei, 1 Test.
- `npm run build`: erfolgreich für Backend und Frontend.
- `npm ls --depth=0`: keine als „invalid“ oder fehlend gemeldeten Top-Level-Abhängigkeiten.
- `npm audit --omit=dev --json`: **0 bekannte Schwachstellen in Produktionsabhängigkeiten**.
- `npm audit --json`: 7 Befunde in der vollständigen, einschließlich Entwicklungsabhängigkeiten betrachteten Installation: 1 kritisch, 3 hoch, 3 mittel.
- Statische Suche nach hart codierten Schlüsseln/Tokenmustern: keine offensichtlichen echten Zugangsdaten gefunden; bekannte Beispiel-Secrets wurden erwartungsgemäß erkannt.

### 3.2 Bewusst nicht ausgeführte Checks

- Die Integrationstests wurden nicht lokal gestartet. `backend/test/integration/globalSetup.js:9-14` führt ohne Zielprüfung ein destruktives `TRUNCATE ... RESTART IDENTITY CASCADE` auf `DATABASE_URL` aus. Ohne eine ausdrücklich bereitgestellte Wegwerf-Datenbank wäre die Ausführung unverantwortlich.
- Kein aktiver Penetrationstest gegen eine laufende Instanz.
- Kein lokaler Container-/Image-Scan; die CI-Konfiguration dafür wurde statisch geprüft.
- Kein Last-, Chaos-, Browser-E2E- oder Wiederanlauftest.

Diese Grenzen bedeuten: Der Bericht ist eine belastbare Code-/Architekturprüfung, aber kein Nachweis, dass keine weiteren Laufzeit- oder Infrastrukturprobleme existieren.

## 4. Kritische Befunde

### K-01 – Bekanntes JWT-Standardgeheimnis ermöglicht bedingte Admin-Eskalation

**Belege**

- `backend/src/middleware/auth.ts:5`: Fallback auf `dev-secret-change-me`.
- `docker-compose.yml:46`: derselbe bekannte Wert ist aktiver Compose-Default.
- `.env.example:1-3`: das Überschreiben wird nur empfohlen, nicht erzwungen.
- `backend/src/middleware/auth.ts:40-51`: Datenbankprüfung umfasst Status und `session_version`, nicht die Rolle; `req.userRole` wird direkt aus dem JWT übernommen.
- `backend/src/middleware/auth.ts:55-60`: Adminprüfung vertraut ausschließlich `req.userRole`.

**Angriffsszenario**

Ein normal eingeloggter Benutzer kennt die eigene UUID und kann die `sessionVersion` aus dem eigenen JWT lesen. Ist das Default-Secret aktiv, signiert er einen neuen HS256-Token mit derselben `sub` und `sessionVersion`, aber `role: "admin"`. `requireAuth` findet einen aktiven Benutzer mit passender Sessionversion und `requireAdmin` akzeptiert die manipulierte Rolle. Damit sind Benutzerverwaltung, Invite-Logs, Adolar-Konfiguration und alle Adminmutationen erreichbar.

**Auswirkung**

Vollständige Privilegieneskalation innerhalb der Anwendung; indirekt zusätzlich Kontrolle über die Adolar-Konfiguration und serverseitige Netzwerkanfragen.

**Empfohlene Behebung**

1. In jedem Nicht-Testbetrieb ohne ausreichend langes, zufälliges `JWT_SECRET` beim Start hart abbrechen; keinen Fallback verwenden.
2. Rolle zusammen mit Status und Sessionversion aus `app_user` laden und ausschließlich die DB-Rolle in `req.userRole` übernehmen.
3. JWT mit festen `algorithms`, `issuer` und `audience` signieren/verifizieren; Access- und Display-Token entweder mit getrennten Keys oder strikt getrennten Audiences absichern.
4. Deployment-Dokumentation um eine Generierungsanweisung ergänzen, z. B. mindestens 32 zufällige Bytes.
5. Regressionstest: Ein gültig signierter Token mit zur DB abweichender Rolle darf keine Adminrechte erhalten.

### K-02 – Öffentlicher Erstsetup-Pfad erlaubt Admin-Übernahme einer frischen Installation

**Belege**

- `backend/src/routes/setup.ts:73-115`: `/setup/bootstrap` ist unauthentifiziert und verlangt kein einmaliges Setup-Geheimnis.
- `docker-compose.yml:50-51` und `docker-compose.yml:68-69`: Backend und Frontend werden standardmäßig an alle Hostinterfaces veröffentlicht.
- `backend/src/routes/setup.ts:85-87`: `SELECT ... FOR UPDATE` sperrt nur vorhandene Zeilen. Wenn noch kein Admin existiert, wird nichts gesperrt; konkurrierende Bootstrap-Requests können beide fortfahren.
- Das Schema besitzt keine Eindeutigkeitsbedingung „höchstens ein Admin“ (`backend/migrations/1755763200000_initial-schema.js:9-21`).

**Angriffsszenario**

Wird Compose auf einem erreichbaren Host gestartet, kann ein fremder Client vor dem Betreiber `/api/v1/setup/bootstrap` aufrufen und sich zum ersten Admin machen. Zwei parallele Requests können im leeren Zustand außerdem beide einen Admin anlegen. Der Rate-Limiter verhindert das nicht zuverlässig und ist über den direkt veröffentlichten Backend-Port zusätzlich umgehbar (H-04).

**Auswirkung**

Vollständige Kontrolle einer neuen Installation; potenziell mehrere unerwartete Adminaccounts.

**Empfohlene Behebung**

- Bootstrap nur mit einem einmaligen, zufälligen `SETUP_TOKEN` erlauben, der außerhalb der Anwendung ausgeliefert wird, oder als expliziten CLI-Befehl/Console-Schritt implementieren.
- Alternativ das Endpoint bis zum Abschluss ausschließlich an Loopback/administratives Netz binden.
- Konkurrenzschutz mit `pg_advisory_xact_lock`, einer dedizierten Singleton-Setupzeile oder einem anderen Lock implementieren, das auch im leeren Zustand greift.
- Nach erfolgreichem Bootstrap Setup-Token ungültig machen und Endpoint dauerhaft deaktivieren.
- Paralleltest mit zwei Bootstrap-Requests: exakt einer muss 201, der andere 409 liefern.

## 5. Hohe Befunde

### H-01 – Broken Object Level Authorization: private Tischcodes und Spielstände für beliebige Benutzer

**Belege**

- `backend/src/routes/tables.ts:211-223`: `GET /tables/:tableId` prüft nur Login, nicht Mitgliedschaft, Sichtbarkeit oder Join-Code.
- `backend/src/services/tableQueries.ts:65-120`: `loadTableDetail` liefert immer `joinCode`, Sitzplätze, Benutzer-IDs und `latestGameId`.
- `frontend/src/pages/TableRoomPage.tsx:67-84`: Der Client lädt diese Details bereits vor dem Join.
- `backend/src/routes/rounds.ts:37-88`: Game-Metadaten und vollständiger State sind für jeden eingeloggten Benutzer abrufbar.
- `backend/src/routes/rounds.ts:143-205`: Rundendetail bindet `roundId` nicht einmal an den `gameId` aus dem Pfad.
- `backend/test/integration/rounds.test.ts:107-115`: Ein Test ruft Game-Details ausdrücklich mit einem frisch erzeugten, nicht am Tisch sitzenden Benutzer ab und erwartet 200.

**Auswirkung**

Private Tischcodes verlieren ihre Schutzwirkung. Ein Benutzer mit bekannter Tisch-ID kann Code und Teilnehmer sehen, beitreten und anschließend Spielzustände verfolgen. Bekannte Spiel-/Runden-IDs reichen für weitere unautorisierte Lese- oder Manipulationspfade.

**Behebung**

- Zentralen Authorizer einführen, z. B. `requireTableViewer`, `requireActiveSeat`, `requireActivePlayer`.
- Vor einem erfolgreichen Join für private Tische ausschließlich eine minimierte Vorschau ohne `joinCode`, Sitzdetails und `latestGameId` liefern.
- `joinCode` ausschließlich beim Ersteller und gegebenenfalls explizit berechtigten aktiven Mitgliedern ausgeben; idealerweise nie im allgemeinen Table-DTO.
- Jede Game-/Round-Abfrage über `game -> table -> active seat` autorisieren.
- Bei verschachtelten Ressourcen stets `WHERE r.id = $1 AND r.game_id = $2` verwenden.
- Negative Integrationstests für Fremdbenutzer, verlassene Sitze, private Tische und falsche Parent-ID ergänzen.

### H-02 – Socket.IO-Räume besitzen keine objektbezogene Autorisierung

**Belege**

- `backend/src/realtime/socketServer.ts:91-104`: Jeder authentifizierte Socket kann beliebige Lobby-, Tisch- und Spielraum-IDs joinen; es gibt keine DB-Prüfung.
- `backend/src/realtime/socketServer.ts:53-57`: Ein Display-Token wird nur beim Handshake auf seinen `tableId` geprüft.
- Danach kann auch dieser Display-Socket über `table:join-room` oder `game:join-room` fremde IDs abonnieren.
- `backend/src/realtime/broadcast.ts:17-37`: Broadcasts enthalten vollständige Tischdetails bzw. vollständigen Spielzustand.

**Auswirkung**

Umgehung der REST-seitigen Display-Token-Bindung und Datenabfluss aus fremden privaten Tischen/Partien. Der Broadcast kann aktuelle Song-Stream-UUIDs, Timelines, Spielerwerte und nach Auflösung Songmetadaten enthalten.

**Behebung**

- Room-Joins serverseitig autorisieren und Fehler/Acknowledgement zurückgeben.
- Normale Benutzer: aktiven Sitz bzw. explizit erlaubten Lobbyzugriff prüfen.
- Display-Token: ausschließlich `tableRoom(displayTableId)` und Game-Räume zulassen, deren `game.table_id` genau diesem Tisch entspricht; Lobbyzugriff verweigern.
- Clientgesendete IDs niemals allein als Berechtigungsgrundlage verwenden.
- Socket-Integrationstests für fremde Tisch-/Game-ID und Display-Cross-Table-Zugriff ergänzen.

### H-03 – Fremde Benutzer können Token-/Buzzer-Runden manipulieren

**Belege**

- `backend/src/services/roundEngine.ts:507-556`: `claimToken` prüft Status, Sit-out und bisherigen Verbrauch, aber keinen aktiven Spielersitz.
- `backend/src/services/roundEngine.ts:664-776`: `submitTokenGuess` prüft Solo-/Gegnerstatus, aber keine Mitgliedschaft im Spiel.
- `backend/src/services/roundEngine.ts:227-279`: auch normale Positionsguesses besitzen keine aktive Sitzprüfung; sie werden bei der Auflösung für Fremde zwar nicht gewertet, können aber gespeichert werden.
- `backend/src/routes/rounds.ts:208-264`: Die Mutationsrouten prüfen nicht, ob `roundId` zum `gameId` im Pfad gehört.
- `backend/src/services/roundEngine.ts:260-266`: Bereits ein beliebiger Token-Claim sperrt normale Guesses.

**Angriffsszenario**

Ein eingeloggter Nichtteilnehmer kennt oder erlangt eine aktive `roundId` über H-01/H-02. Er claimt einen Token, stoppt damit die normale Runde, gewinnt gegebenenfalls das Claim-Race und kann die Solo-/Gegnerphase auslösen. So kann er fremde Spiele zuverlässig stören. Der Pfad-`gameId` kann dabei auf eine andere Partie zeigen; nur die `roundId` steuert die eigentliche Mutation.

**Behebung**

- Zu Beginn jeder Aktion Round, Game, Table und aktiven `player`-Sitz in derselben Transaktion laden und sperren/prüfen.
- Sit-out-Prüfung nur zusätzlich, nicht als Ersatz für Mitgliedschaft verwenden.
- Parent-Child-Bindung des URL-Pfads prüfen.
- Fremde `timeline_card`/`guess`/`token_usage`-Einträge zusätzlich durch DB-Invarianten oder Trigger verhindern, soweit praktikabel.
- Exploit-Regressionstest: Nichtteilnehmer erhält 403 und verändert weder Roundstatus noch Token-/Guess-Tabellen.

### H-04 – Direkt veröffentlichter Backend-Port macht Proxy-Vertrauen und Rate-Limits umgehbar

**Belege**

- `backend/src/app.ts:21-30`: Anwendung vertraut genau einem Proxy-Hop und damit `X-Forwarded-For`.
- `docker-compose.yml:50-51`: Backend wird gleichzeitig direkt auf Host-Port 4000 veröffentlicht.
- `backend/src/middleware/rateLimit.ts:10-24`: alle Limits sind IP-basiert und nutzen den In-Memory-Standardstore.
- `backend/src/app.ts:33`: CORS ist ohne Origin-Allowlist offen.

**Auswirkung**

Ein Client kann Nginx umgehen, direkt Port 4000 ansprechen und `X-Forwarded-For` variieren. Damit lassen sich Login-/Bootstrap-/Invite-Guessing-Limits praktisch zurücksetzen. Außerdem werden eventuell am Frontend-Proxy ergänzte TLS- oder Header-Schutzmaßnahmen umgangen.

**Behebung**

- Backend nicht auf einen öffentlichen Hostport publishen; nur im Compose-Netz erreichbar machen. Falls Debugzugriff nötig ist: `127.0.0.1:4000:4000` in ein separates Dev-Override.
- `trust proxy` an konkrete interne Proxyadressen/Subnetze binden und Deploymenttopologie dokumentieren.
- Rate-Limit-Store für Mehrinstanzbetrieb zentralisieren; zusätzlich konto-/endpointbezogene Keys für Login/Bootstrap/Join verwenden.
- CORS auf die tatsächlichen Frontend-Origin(s) begrenzen oder ganz deaktivieren, wenn ausschließlich same-origin genutzt wird.

### H-05 – Spielzustände hängen an nicht persistenten In-Memory-Timern

**Belege**

- `backend/src/services/roundEngine.ts:183-215`: Countdown-, Playing- und Resolve-Übergänge über `setTimeout`.
- `backend/src/services/roundEngine.ts:561-566`, `618-622`, `739-743`: Token-Race- und Tokenfenster ebenfalls nur in-memory.
- `backend/src/services/roundReadyWindow.ts:11-27`: Bereitschaftsfenster nur in einer Prozess-Map.
- `backend/src/services/tableRestart.ts:13-25`: Auto-Close nur in einer Prozess-Map.
- `backend/src/routes/tables.ts:22-42`: Rejoin-/Karmaprüfung nur über `setTimeout`.
- Es gibt beim Start in `backend/src/index.ts` keine Wiederanlauf-Reconciliation.

**Auswirkung**

Backendneustart/Crash/Deploy kann Runden in `countdown`, `playing`, `token_solo` oder `token_others` einfrieren, Readiness-Fenster nie auslösen, frühe Verlassensstrafen verlieren und fertige Tische nie auto-schließen. Mehrere Backendinstanzen würden dieselben Timersysteme inkonsistent oder doppelt ausführen.

**Behebung**

- Fälligkeit (`transition_due_at`) persistent speichern und Übergänge idempotent ausführen.
- Beim Start alle überfälligen und zukünftigen Zustände rekonstruieren.
- Periodischen DB-basierten Sweeper oder eine belastbare Jobqueue verwenden; Übergang stets mit konditionalem `UPDATE ... WHERE status = expected` absichern.
- Neustarttests für jeden Zwischenstatus ergänzen.

### H-06 – Integrationstest-Setup kann eine echte Datenbank vollständig leeren

**Belege**

- `backend/test/integration/globalSetup.js:8-16`: verbindet sich direkt mit `process.env.DATABASE_URL` und truncatet alle Kerntabellen mit `CASCADE`.
- Keine Prüfung auf Host, Datenbankname, explizites `ALLOW_DESTRUCTIVE_TEST_DB` oder temporäres Schema.
- `README.md` fordert für Integrationstests lediglich eine `DATABASE_URL` gegen laufendes PostgreSQL.

**Auswirkung**

Ein Entwickler oder CI-Operator kann durch eine falsch gesetzte URL Produktions-/Stagingdaten vollständig löschen. Das ist kein theoretischer Testfehler, sondern eine unmittelbar destruktive Betriebsgefahr.

**Behebung**

- Tests sollen ihre eigene Wegwerf-DB bzw. einen Testcontainer erstellen und zerstören.
- Zusätzlich hart prüfen: Datenbankname endet z. B. auf `_test`, Host ist freigegeben und ein bewusst gesetzter Safety-Token stimmt.
- Vor `TRUNCATE` aktuelle DB/Host ausgeben, aber keine Credentials.
- README ausdrücklich vor destruktiver Natur warnen.
- Safety-Test: Produktionsähnlicher DB-Name muss vor jeder Mutation abbrechen.

### H-07 – Display-Präsenz kann nach Crash oder bei mehreren Displays dauerhaft falsch sein

**Belege**

- `backend/src/realtime/socketServer.ts:19-33`: Präsenz wird als einzelner nullable Timestamp in `game_table` gespeichert.
- `backend/src/realtime/socketServer.ts:110-114`: ein Connect setzt, jeder Disconnect löscht; die Promises werden ohne `await`/`.catch` gestartet.
- `backend/src/services/gameState.ts:83-85`: jedes nicht-null Feld schaltet alle Playerclients in den Displaymodus.

**Auswirkung**

- Bei zwei Displayverbindungen löscht der Disconnect einer Verbindung den Status trotz weiterhin aktiver zweiter Verbindung.
- Bei Prozessabsturz läuft kein Disconnect-Handler; `display_connected_at` bleibt gesetzt und Playergeräte können dauerhaft stumm/kompakt bleiben.
- DB-/Broadcastfehler können als unhandled Promise Rejections auftreten.

**Behebung**

- Aktive Socketanzahl je Tisch serverseitig zählen und nur beim Übergang 0↔1 persistieren/broadcasten; in Mehrinstanzbetrieb Redis/Adapter oder Presence-Tabelle mit Lease/Heartbeat nutzen.
- Beim Start veraltete Presence-Daten bereinigen.
- Jede asynchrone Eventroutine abfangen und protokollieren.
- Tests für zwei Displays, Disconnect-Reihenfolge und Neustart ergänzen.

## 6. Mittlere Befunde

### M-01 – WebSocket-Authentifizierung weicht von HTTP ab

- `backend/src/realtime/socketServer.ts:73-82` prüft nur Existenz und `session_version`, nicht `status = 'active'`.
- Bereits offene Sockets werden nach neuem Login oder Kontosperrung nicht getrennt.
- Folge: Ein gesperrter Benutzer kann mit einem noch passenden Token neue Socketverbindungen aufbauen bzw. eine bestehende bis zum Disconnect weiterverwenden.
- Fix: gemeinsamen Auth-Service für HTTP und Socket verwenden; Status und DB-Rolle prüfen; bei Session-/Statusänderung User-Room gezielt disconnecten oder bei sensiblen Joins erneut autorisieren.

### M-02 – Display- und Join-Geheimnisse stehen in URLs und Logs

- `frontend/src/App.tsx:38`, `frontend/src/pages/TableRoomPage.tsx:179-183` und `frontend/src/pages/DisplayPage.tsx:40,67,94` transportieren Display-JWTs als Pfadsegment.
- Private Join-Codes stehen als Queryparameter in Links (`frontend/src/pages/TableRoomPage.tsx:238-241`).
- Solche Werte landen in Browserhistorie, Screenshots, Zwischenablage und standardmäßig im Nginx-Accesslog; Displaytoken zusätzlich in API-Pfaden.
- Displaytoken sind 12 Stunden gültig und nicht individuell widerrufbar (`backend/src/services/displayToken.ts:9-20`).
- Fix: einmaligen Pairing-Code gegen kurzlebige Display-Session tauschen; Token danach im Speicher halten, aus URL per `history.replaceState` entfernen; Accesslog redigieren; `Referrer-Policy: no-referrer`; serverseitige Token-ID/Revocation.

### M-03 – Browser-Token in `localStorage`, fehlende Frontend-CSP und kein integriertes HTTPS

- Access-Token wird dauerhaft in `localStorage` gespeichert (`frontend/src/auth/AuthContext.tsx:27-31,66-67`). Jede spätere XSS-/Supply-Chain-Kompromittierung kann ihn lesen.
- `frontend/nginx.conf` setzt keine CSP, HSTS, Referrer-Policy, Permissions-Policy oder `X-Content-Type-Options` für die SPA. Helmet schützt nur API-Antworten.
- `frontend/index.html:7-11` lädt Google Fonts als Drittressource.
- Compose stellt nur HTTP bereit, obwohl Wake Lock laut README HTTPS erfordert.
- Es wurde aktuell kein `dangerouslySetInnerHTML`/`eval`-Pfad gefunden; die Lücke ist daher Defense-in-Depth, nicht der Nachweis einer bestehenden XSS.
- Fix: bevorzugt kurzlebiger Access-Token im Speicher plus HttpOnly/Secure/SameSite-Refreshcookie; alternativ mindestens strikte CSP und Token-Rotation. TLS am vorgesehenen Reverse Proxy verbindlich dokumentieren und testen.

### M-04 – Adolar-Konfiguration eröffnet SSRF-/Secret-/Timeout-Risiken

- Admin kann eine nahezu beliebige HTTP(S)-Basis-URL konfigurieren (`backend/src/routes/setup.ts:25-68`); serverseitiges `fetch` folgt standardmäßig Redirects.
- Der API-Token wird im Klartext in `system_setting` gespeichert (`backend/src/services/systemSettings.ts:16-22`) und darf über HTTP übertragen werden.
- `backend/src/services/adolarClient.ts:75-96,148-159` verwendet kein Abort-/Connect-/Gesamttimeout.
- Fehlertexte enthalten die Basis-URL und werden teilweise an Adminclients zurückgegeben.
- Fix: URL strikt mit `new URL` validieren, Credentials/Fragmente ablehnen, Redirectpolitik festlegen, Threat Model für erlaubte LAN-/Private-IP-Ziele dokumentieren, Timeouts und Größenlimits setzen, Secret verschlüsselt oder über Secret Store halten, HTTP nur explizit mit Warnung/Policy zulassen.

### M-05 – Öffentlicher Audioproxy kann für Bandbreitenmissbrauch genutzt werden

- `backend/src/routes/songs.ts:17-23` ist bewusst unauthentifiziert.
- Er streamt Upstreamdaten ohne Größen-/Dauerbegrenzung und ohne Abbruchbehandlung bei Clientdisconnect (`:43-69`).
- H-02 liefert fremden Abonnenten die sonst unerratbare Song-UUID.
- Fix: kurzlebigen, spiel-/tischgebundenen signierten Streamtoken verwenden; Range validieren; AbortController an Clientdisconnect koppeln; Concurrency-/Bandbreitenlimit und sinnvolle Cachepolitik ergänzen.

### M-06 – Invite-Monatsquota ist durch Parallelrequests überschreitbar

- `backend/src/routes/invites.ts:54-69` zählt vorhandene Einladungen, `:80-85` legt später außerhalb einer gemeinsamen Transaktion eine neue an.
- Mehrere parallele Requests können denselben Count sehen und gemeinsam über das Limit hinaus schreiben.
- Fix: Benutzerzeile in Transaktion `FOR UPDATE` sperren oder monatlichen Zähler atomar führen; Paralleltest ergänzen.

### M-07 – Password-/Session-/Eingabevalidierung ist nicht durchgängig serverseitig

- Registrierung und Bootstrap erzwingen serverseitig keine Mindestlänge (`backend/src/routes/auth.ts:11-17`, `backend/src/routes/setup.ts:73-79`); die Frontend-`minLength` ist umgehbar.
- Passwortänderung erhöht `session_version` nicht (`backend/src/routes/users.ts:45-68`). Ein gestohlener aktueller Token bleibt nach Kennwortwechsel bis zum Ablauf gültig.
- Username, E-Mail und viele Bodyfelder werden nicht typ-/längenvalidiert; DB-Constraint-Fehler enden häufig als 500.
- Admin-`maxUses` und `expiresInDays` besitzen keine sinnvollen Obergrenzen.
- Fix: zentrale Schemas (z. B. Zod/Valibot/JSON Schema), normalisierte E-Mail/Usernamenregeln, serverseitige Passwortpolicy und maximale Eingabelängen; beim Kennwortwechsel Sessionversion atomar erhöhen und aktuelle/neue Session bewusst definieren.

### M-08 – Mehrere Check-then-act-Races und wirkungslose Locks

- `backend/src/services/tableCleanup.ts:19-26`: stale IDs werden gelesen und später bedingungslos gelöscht; ein zwischenzeitlicher Keep-alive schützt nicht.
- `backend/src/services/tableRestart.ts:36-43` und `:54-75`: Auto-Close und Restart sind nicht gemeinsam transaktional. Ein Rennen kann einen wieder geöffneten Tisch ohne aktive Sitze hinterlassen.
- `backend/src/services/tableHandover.ts:19-54` nutzt `FOR UPDATE`, wird aber aus allen Produktionsaufrufen mit dem autocommit-`pool` statt innerhalb einer expliziten Transaktion aufgerufen (`backend/src/routes/tables.ts:214,235,458,568`). Die Sperre endet damit direkt nach dem SELECT und schützt das nachfolgende UPDATE nicht.
- Fix: konditionale atomare Statements bzw. echte Transaktionen mit demselben Client; Concurrent-Integrationstests.

### M-09 – Vorgeschriebene Audit-Logs fehlen

- Das Feinkonzept fordert Audit-Logs für Invite, Sperrung und Admin-Übergabe (`docs/Adolar_Songster_Technisches_Feinkonzept_v1_20260821.md:187-191`).
- Es gibt keine dedizierte Audit-Log-Tabelle oder strukturierte, unveränderliche Ereignisaufzeichnung. Invite-Datensätze bilden nur einen Teil der Historie ab; Actor, Vorher/Nachher, Request-/Correlation-ID und Adminaktionen fehlen.
- Fix: append-only Auditereignisse innerhalb derselben DB-Transaktion wie die Mutation schreiben; sensible Werte redigieren; Aufbewahrung und Zugriff definieren.

### M-10 – Bekannte Schwachstellen in Entwicklungs-/CI-Abhängigkeiten

`npm audit` meldete am Audit-Tag:

- **kritisch:** `vitest@2.1.9` / [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp) (beliebiges Lesen/Ausführen bei aktivem Vitest-UI-Server; im Projekt wird aktuell `vitest run`, nicht die UI gestartet).
- **hoch:** transitive Vite-Pfadprobleme in der alten Vitest-Kette, u. a. [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff).
- **hoch:** `node-pg-migrate@7.9.1` über verwundbares `glob`-CLI, [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2).

Der Produktionsaudit mit `--omit=dev` ist sauber. Dennoch laufen diese Werkzeuge auf Entwicklerrechnern und in CI. Upgradepfad in einem separaten Branch testen: Vitest 4.x und node-pg-migrate 9.x sind Major-Upgrades. Bis dahin Devserver nur an Loopback binden; `vite.config.ts:8-10` verwendet derzeit `host: true`.

### M-11 – CI-/Supply-Chain-Härtung ist unvollständig

- GitHub Actions und Basisimages sind nur auf bewegliche Tags, nicht Commit-SHA bzw. Digest gepinnt (`.github/workflows/ci.yml:37,40,75,84,96,101,104,118`; Dockerfiles/Compose).
- Globale Workflow-Permissions geben jedem Job `security-events: write` (`.github/workflows/ci.yml:10-12`) statt minimaler Jobrechte.
- Trivy verwendet `ignore-unfixed: true`, wodurch ungefixte kritische/hohe Risiken den Build nicht blockieren.
- Kein expliziter `npm audit`-Gate, keine Dependabot-/Renovate-Konfiguration, kein SBOM-/Provenance-/Signaturnachweis.
- `.gitleaks.toml:6-14` nimmt den gesamten Dokumentationsordner von Secret-Erkennung aus; gerade Integrationsdokumente können versehentlich echte Tokens enthalten.
- Fix: Actions auf SHA, Images auf Digest plus Updateautomation, Permissions pro Job, Docs nicht pauschal allowlisten, SBOM erzeugen, Dependency-Policy definieren.

### M-12 – Architektur ist trotz Zustand im Prozess nicht skalier-/HA-fähig

- Socket.IO ohne Redis-/Cluster-Adapter.
- Rate-Limiter mit Prozessspeicher.
- Timer, Syncstatus und „Sync läuft“-Lock nur im Prozess (`backend/src/services/adolarSync.ts:16-47`).
- Jeder Backendprozess startet tägliche Sync- und Cleanup-Cronjobs (`backend/src/services/scheduler.ts:22-36`).
- Folge bei mehreren Replikas: verteilte Räume funktionieren nicht, Limits vervielfachen sich, Jobs laufen mehrfach, Status widersprechen sich.
- Fix: Solange Single-Instance verbindlich ist, dies technisch/deploymentseitig erzwingen und dokumentieren. Vor Skalierung zentrale Stores/Locks/Jobqueue/Socketadapter einführen.

## 7. Niedrige bzw. technische Befunde

### N-01 – Datenbankverbindung und Shutdown sind kaum gehärtet

`backend/src/db/pool.ts:3-5` setzt nur `connectionString`: keine expliziten Connect-/Idle-/Statement-Timeouts, TLS-Policy, Application-Name oder Poolmetriken. `backend/src/index.ts` besitzt keinen geregelten SIGTERM/SIGINT-Shutdown für HTTP, Sockets, Timer und Pool. Ergänzen, um Hänger und unvollständige Deployments sauber zu behandeln.

### N-02 – Fehler-/Betriebsbeobachtung ist zu schwach

Nur `console.log/error`, keine strukturierten Logs, Request-ID, Metriken oder Error-Tracking. Der Healthcheck prüft DB, aber weder Readiness der Musikquelle noch Job-/Timerstau. `getSetting` verschluckt sämtliche DB-Fehler und behandelt sie wie „nicht gesetzt“ (`backend/src/services/systemSettings.ts:3-13`), wodurch echte Störungen maskiert werden.

### N-03 – Adolar-Sync ist langsam und nicht resumierbar

`backend/src/services/adolarSync.ts:67-80` verarbeitet Tracks seriell mit mindestens zwei DB-Operationen je Track. Bei ~8000 Titeln entstehen viele Tausend Roundtrips. Kein persistenter Fortschritt/Checkpoint; bei Neustart beginnt alles erneut. Batching, Transaktion pro Seite und persistenter Jobstatus sind empfehlenswert.

### N-04 – Dokumentation ist teilweise veraltet oder widersprüchlich

- API-Spezifikation bezeichnet WebSocket-Broadcasts als noch nicht verdrahtet und listet andere Eventnamen/Namespace (`docs/...API_Spezifikation...md:164-171,308-331`).
- Feinkonzept fordert Stream-Timeout, Retry und Fehlerstatus (`...Technisches_Feinkonzept...md:182-185`), die aktuelle Streamingroute implementiert das nicht.
- README beschreibt CI zutreffend grob, verschweigt aber das destruktive Integrationstest-Setup und die klare Trennung „nur Entwicklung“ vs. Produktion bei Compose-Defaults.

### N-05 – Teststrategie erfüllt die eigene Baseline nicht vollständig

- Nur ein Frontend-Unit-Test; `frontend/package.json:12` meldet „no frontend integration tests yet“ dennoch erfolgreich.
- Keine E2E-/Browser-/Socket-Integrationstests, obwohl die interne Baseline Wizard-Setup und komplettes Testspiel nennt.
- Kein Coverage-Gate trotz dokumentiertem Ziel ≥80 %.
- Jest nutzt `forceExit: true` (`backend/jest.config.js:8-12`) und kann dadurch echte offene Handles verdecken.
- Besonders fehlen negative Access-Control-Tests für H-01 bis H-03 sowie Restart-/Concurrencytests für H-05/H-07/M-08.

### N-06 – Hard-Delete nach einer Stunde braucht klare Daten-/Backup-Policy

`backend/src/services/tableCleanup.ts:9-26` löscht inaktive Tische samt Spielen/Runden/Guesses kaskadierend. Das ist bewusst implementiert, aber „für Performance“ allein ist keine Datenaufbewahrungsstrategie. Dokumentieren: welche Daten absichtlich verloren gehen, welche Audit-/Statistikdaten erhalten bleiben, Backup-/Restore-Verfahren, RPO/RTO und Datenschutz-/Löschkonzept.

### N-07 – Leaderboard und Rangberechnung berücksichtigen gesperrte Konten

`backend/src/routes/leaderboard.ts:8-14` und die Rang-CTEs filtern nicht auf `status = 'active'`. Gesperrte Benutzer bleiben sichtbar und beeinflussen Rangpositionen. Produktentscheidung treffen und konsistent implementieren.

## 8. Deployment- und Konfigurationsbefunde

### D-01 – Datenbank mit bekanntem Passwort am Host veröffentlicht

`docker-compose.yml:5-16` verwendet `songster/songster` und veröffentlicht PostgreSQL standardmäßig auf allen Interfaces an Port 15432. Das Mapping ist laut Kommentar nur zum Debuggen nötig. In der Basis-Compose-Datei entfernen oder auf `127.0.0.1` begrenzen und ausschließlich über Dev-Override aktivieren. Für echte Installationen zufälliges DB-Passwort/Secret und Firewall einsetzen.

### D-02 – Kein produktionsfähiger TLS-Einstiegspunkt

Frontend läuft auf Port 5173/HTTP, Backend auf 4000/HTTP. Es gibt keine mitgelieferte TLS-, HSTS- oder sichere Proxy-Konfiguration. Wenn ein externer Reverse Proxy vorgesehen ist, muss dies als zwingende Produktionsvoraussetzung einschließlich Header-/WebSocketkonfiguration, vertrauenswürdiger Proxy-IP und Zertifikatsbetrieb beschrieben werden.

### D-03 – Gute Containerbasis, aber reproduzierbare Digests fehlen

Positiv: Multi-Stage-Build, `npm ci`, Lockfile, Devdependencies nicht im Backend-Runtimeimage, Backend `USER node`. Offen: mutable Tags (`node:22-alpine`, `nginx:1.27-alpine`, `postgres:16-alpine`), Frontendimage ohne eigenen Healthcheck, kein Read-only-Root-FS/Capability-Drop/Resource-Limit in Compose.

## 9. Positivbefunde

- Keine offensichtliche SQL-Injection im untersuchten Code: dynamische Werte werden als Queryparameter übergeben; die wenigen SQL-Fragmente wie `RANK_SCORE_SQL` sind statische Konstanten.
- Argon2-Passworthashing (`backend/src/routes/auth.ts`, `setup.ts`, `users.ts`).
- JWT-Ablaufzeit von einer Stunde und Sessionversion zur Einzelsessionkontrolle.
- Invitecodes werden mit `crypto.randomBytes(16)` erzeugt; private Tischcodes mit `crypto.randomBytes(4)`.
- Registrierung sperrt die Invitezeile in einer Transaktion und verhindert parallele Mehrfachverwendung desselben Codes.
- Mehrere Round-Operationen verwenden `FOR UPDATE` und transaktionale Statusprüfungen gegen Deadline-Races.
- Generische Fehlerantwort verhindert Stacktrace-Ausgabe an Clients.
- Helmet ist am API-Backend aktiv.
- Produktionsabhängigkeiten waren laut `npm audit --omit=dev` zum Auditzeitpunkt frei von bekannten Advisories.
- Backend-Runtimecontainer läuft als `node`, nicht root.
- CI enthält Lint, Unit-/Integrationstest, Build, CodeQL, Secret-, Filesystem- und Imagescan.
- Keine offensichtlichen echten Zugangsdaten im versionierten Code gefunden; `.env`-Dateien werden ignoriert.

## 10. Spielmechanische Einordnung und störungsarme Reparatur

### 10.1 Leitprinzip: Berechtigungen folgen dem Sitz- und Rundenstatus

Die Reparatur darf nicht pauschal „nur Eigentümer“ oder „nur Admin“ vor alle Spielendpoints setzen. Das würde funktionierende Mechaniken zerstören: Zuschauer dürfen laufenden Partien zusehen, jeder aktive Spieler muss selbst raten und einen Token claimen können, und laut Hostmodus darf jeder aktuell Sitzende ein Anzeigegerät verbinden. Stattdessen sollte die Berechtigung aus der fachlichen Rolle am konkreten Tisch abgeleitet werden.

| Akteur | Lobby / Vorschau | Voller Tisch- und Spielstand | Spielaktionen | Administrative Spielaktionen |
|---|---|---|---|---|
| Nicht angemeldet | Setupstatus/Health, sonst nichts | nein | nein | Bootstrap nur mit einmaligem Setupnachweis |
| Angemeldet, kein Sitz | öffentliche Lobby und reduzierte Tischvorschau | nein | nur Joinversuch | nein |
| Aktiver Zuschauer | ja | eigener Tisch, read-only | keine Ready-/Guess-/Tokenaktion | Displaylink wie bisher nur, wenn dies als „jeder Sitzende“ beibehalten wird |
| Aktiver Spieler | ja | eigener Tisch und eigene Partie | Ready, Position Guess, Token Claim/Submit | nein |
| Aktueller Tischeigentümer | wie aktiver Spieler | eigener Tisch und eigene Partie | wie aktiver Spieler | Start, neue Partie und die bereits vorgesehenen Eigentümeraktionen |
| Globaler Admin ohne Sitz | administrative Übersicht | nur wenn explizit als Supportfunktion vorgesehen | **keine** Guess-/Tokenrechte allein wegen Adminrolle | vorhandene Admin-/Start-Overrides gemäß Produktentscheidung |
| Displaytoken | keine Lobby | nur der gebundene Tisch und dessen aktuelle Partie | keine Mutationen | keine |

Diese Matrix erhält die vorhandene Spielmechanik, trennt aber klar „darf zusehen“, „darf mitspielen“ und „darf administrieren“.

### 10.2 Zuordnung der Findings zu konkreten Spielphasen

| Spielphase / Mechanik | Betroffene Befunde | Heutiges Fehlverhalten | Störungsarme Zielwirkung |
|---|---|---|---|
| Erstinstallation | K-01, K-02 | Fremder Admin oder Adminfälschung möglich | Setup wird außerhalb einer Partie einmalig abgesichert; keine Änderung am Spielablauf |
| Lobby / privater Tisch | H-01, H-04, M-02 | Vor dem Join werden Code, Sitze und Game-ID offengelegt | Vor dem Join nur sichere Vorschau; der vorhandene Link-/Code-Join bleibt erhalten |
| Zuschauerbeitritt | H-01, H-02 | Entweder zu viel Zugriff oder bei grober Sperre Gefahr, Zuschauer auszusperren | Aktiver Zuschauer darf weiterhin in laufende erlaubte Partien und erhält ausschließlich read-only State |
| Tischbereitschaft / Spielstart | H-02, H-05, M-08 | fremde Raumabos; Ready-Fenster friert bei Neustart ein | Sitzgebundene Subscription; Ready bleibt gleich, Recovery öffnet bei Bedarf ein faires neues Fenster |
| Normale 3s/25s-Runde | H-01, H-02, H-03, H-05 | Fremde sehen State/Stream oder schreiben Guess; Restart friert/verkürzt Runde | Nur aktive Spieler schreiben; Zuschauer/Display lesen; normale Timings bleiben unverändert |
| Songster-Token / Buzzer | H-03, H-05 | Nichtspieler kann Claim-Race gewinnen und Runde stoppen; Timerverlust friert Tokenphase ein | Aktive, nicht aussetzende Spieler bleiben exakt wie bisher berechtigt; Infrastrukturabbruch wertet niemanden und verbraucht keinen Token |
| Hostmodus | H-02, H-07, M-02 | Display A kann fremde Räume abonnieren; Phantom-Display schaltet Handys stumm | Display bleibt one-click und read-only, ist aber tischgebunden; Lease/Connection-Count verhindert falsches Stummschalten |
| Rejoin / Early Leave | H-05, M-08 | Neustart verliert Strafprüfung; Rennen mit Restart/Cleanup | Rejoinfrist bleibt 90s; Serverausfall wird nicht dem Spieler angelastet; Deadline wird persistent und atomar verarbeitet |
| Matchende / Rematch | H-05, M-08 | Auto-Close verloren oder Rennen räumt wieder geöffneten Tisch leer | 60s-Anzeige bleibt identisch; konditionale DB-Transition verhindert inkonsistente Sitze |
| Audio / Adolar | M-04, M-05, N-03 | Hänger oder Streamfehler können Runde blockieren; öffentlicher Proxy missbrauchbar | Signierte Audio-URL funktioniert weiter im `<audio>`-Element; Streamfehler erzeugt eine faire, ungewertete Ersatzrunde |
| Login während Partie | K-01, M-01, M-03, M-07 | alter Socket bleibt aktiv; Tokenrotation kann Spieler überraschend treffen | Neue Session übernimmt wie vorgesehen; alter Client erhält verständliches `session:revoked`, neuer Client reconnectet automatisch |

### 10.3 Privattisch reparieren, ohne Einladungs- und Zuschauerfluss zu brechen

**Problembezug:** H-01, H-02 und M-02.

Der aktuelle Client braucht vor dem Join einige Informationen, um Name, Kapazität, Anforderungen und Joinbuttons anzuzeigen. Er braucht dafür aber weder den echten `joinCode` noch Sitzlisten oder `latestGameId`.

**Empfohlenes kompatibles Modell**

1. Neues bzw. minimiertes `GET /tables/:tableId/preview`:
   - erlaubt für eingeloggte Benutzer mit bekannter ID;
   - liefert nur `tableId`, Name, Sichtbarkeit, Status, Kapazitäten, `allowSpectators` und Spieleranforderungen;
   - liefert niemals Join-Code, Sitze, Eigentümer-ID oder Game-ID.
2. `POST /tables/:tableId/join` bleibt der fachliche Gatekeeper:
   - privater Tisch verlangt weiterhin den Code aus Link/Formular;
   - Spieler neu nur bei `open`;
   - bekannte Spieler dürfen gemäß bestehender Rejoin-Regel bei `running` zurückkehren;
   - Zuschauer dürfen bei `running` beitreten, wenn erlaubt und Kapazität vorhanden.
3. Erst nach erfolgreichem Join liefert `GET /tables/:tableId` den vollen Tischzustand.
4. Den `joinCode` selbst nur an den Eigentümer ausgeben. Andere Sitzende benötigen ihn nicht zum Spielen; falls gemeinsames Einladen fachlich gewollt ist, dafür eine explizite „Einladungslink erzeugen“-Aktion mit eigener Berechtigung verwenden.
5. Private Links funktionieren weiterhin als `/tisch/:id?code=...`; der Client übernimmt den Code nur ins Joinformular und entfernt ihn danach mit `history.replaceState` aus der sichtbaren URL.

**Wichtig für den Frontendfluss**

`TableRoomPage` subscribed momentan bereits vor dem Join auf `table:join-room`. Nach Einführung der Socketautorisierung würde dieser erste Versuch korrekt abgewiesen, aber nach erfolgreichem REST-Join nicht automatisch wiederholt, weil sich die Effect-Abhängigkeiten nicht ändern. Deshalb:

- vor dem Join keine private Table-Room-Subscription, sondern Preview laden;
- nach erfolgreichem Join oder sobald `mySeat` vorhanden ist, Subscription mit Acknowledgement starten;
- bei `table:room-denied` auf Preview/Joinformular bleiben statt einen generischen Netzwerkfehler anzuzeigen.

So bleiben QR-Link, manueller Code, öffentlicher Join, Zuschauerbeitritt und Midgame-Rejoin erhalten.

### 10.4 REST- und Socketautorisierung entlang derselben Spielregeln

**Problembezug:** H-01, H-02, M-01.

Claude sollte keine getrennten, leicht driftenden Regeln in jeder Route implementieren. Empfohlen sind gemeinsame Abfragen/Services:

- `loadActiveSeat(tableId, userId)` → `player | spectator | null`;
- `authorizeGameViewer(gameId, userId)` → aktiver Spieler/Zuschauer desselben Tisches;
- `authorizeRoundPlayer(gameId, roundId, userId)` → Round gehört zum Game, Game zum Tisch, aktiver `player`-Sitz vorhanden, Benutzer sitzt nicht aus;
- `authorizeDisplayGame(displayTableId, gameId)` → Game gehört genau zum Displaytisch.

Socket-Joins verwenden dieselben Services und bestätigen Erfolg oder Ablehnung per Ack. Die Berechtigung muss beim Join geprüft werden; bei sensiblen Reconnects zusätzlich erneut. Ein Benutzer, der den Tisch explizit verlässt oder gesperrt wird, wird aus den zugehörigen Rooms entfernt.

**Keine Beeinträchtigung der Realtime-Erfahrung**

- Nach erfolgreicher Autorisierung bleibt der bestehende Full-State-Broadcast erhalten; bei maximal fünf Spielern ist dafür keine komplizierte per-user Payload nötig.
- Zuschauer erhalten dieselben sichtbaren Reveal-/Timeline-Daten, aber keine Mutationserlaubnis.
- Display erhält weiterhin den vollständigen gemeinsamen Spielstand und Audio, jedoch nur für seinen Tisch.
- Lobbyupdates bleiben für eingeloggte Clients möglich, enthalten aber ausschließlich öffentliche offene Tische.

### 10.5 Token-/Buzzermechanik fair absichern

**Problembezug:** H-03 und H-05.

Die fachliche Berechtigungsprüfung muss innerhalb derselben Transaktion wie Claim oder Guess erfolgen, damit ein paralleles Leave/Rejoin keinen Zwischenzustand erzeugt.

**Für `claimToken`**

1. Round `FOR UPDATE` anhand **beider** IDs laden: `round.id = roundId AND round.game_id = gameId`.
2. Game und Tisch bestimmen.
3. Aktiven `player`-Sitz des Benutzers prüfen; Zuschauer und Globaladmins ohne Sitz erhalten 403.
4. `round_sitout` prüfen.
5. Tokenbestand und vorhandene Claims prüfen.
6. Erst dann `token_usage` schreiben und Broadcast auslösen.

**Für `submitTokenGuess`**

- In `token_solo` muss der Benutzer aktiver Spieler und Gewinner des ungelösten Claims sein.
- In `token_others` muss er aktiver, nicht aussetzender Gegenspieler und nicht der Solo-Claimant sein.
- Ein inzwischen explizit ausgetretener Benutzer darf nicht weiter antworten; ein reiner Socketdisconnect ohne `leave` soll dagegen keine Strafe/Aussperrung verursachen.

**Für normale Position Guesses**

- dieselbe aktive Spielerprüfung;
- mehrere Einsendungen dürfen entsprechend bestehender Spezifikation weiterhin möglich sein, wobei die letzte vor Deadline zählt;
- Fremdversuche enden ohne DB-Schreibzugriff und ohne Broadcast.

Diese Änderung beeinflusst keinen legitimen Claim und verändert weder 150-ms-Race noch Solo-/Gegnerfenster. Sie entfernt nur Akteure, die fachlich nie teilnehmen durften.

### 10.6 Persistente Deadlines mit unveränderten Normal-Timings

**Problembezug:** H-05, H-07, M-08 und M-12.

Um die reaktionsschnelle aktuelle Implementierung zu erhalten, ist ein **hybrides Modell** empfehlenswert:

- bestehende `setTimeout`-Aufrufe dürfen als Latenzoptimierung im Normalbetrieb bleiben;
- die Datenbank ist aber die Quelle der Wahrheit und speichert pro Zustand `phase_started_at`, `transition_due_at` und erwarteten Status;
- ein kurzer periodischer Reconciler sowie der Startup-Reconciler führen fällige Übergänge idempotent nach;
- jedes Update lautet sinngemäß `UPDATE ... WHERE id = ? AND status = expected AND transition_due_at <= NOW()`;
- nur der Prozess, der erfolgreich aktualisiert, wertet/broadcastet.

Damit bleiben 3s Countdown, 25s Songfenster, 150ms Claim-Race und 10s Tokenfenster im störungsfreien Betrieb exakt erhalten. Timerverlust ist nur noch ein verzögerter, aber nicht verlorener Trigger.

### 10.7 Faire Recovery-Regeln bei Serverneustart

Ein blindes „alle überfälligen Runden sofort auswerten“ wäre technisch konsistent, spielerisch aber unfair: Während des Ausfalls konnten Clients weder den Song vollständig hören noch antworten. Deshalb sind explizite Recovery-Regeln nötig.

| Zustand beim Ausfall | Empfohlene Recovery | Fairnessbegründung |
|---|---|---|
| `countdown` | vollen 3s-Countdown nach Reconnect erneut starten | niemand verpasst den Songstart |
| `playing` normal/bonus | Runde als `failed/system_interrupted` ohne Wertung schließen, Song in dieser Session verbraucht lassen, neues Ready-Fenster öffnen | bereits teilweise gehörten Song nicht wiederverwenden; niemand verliert eine Chance/Karte |
| `token_solo` / `token_others` | Runde ungewertet abbrechen; Infrastruktur-bedingte Claims als `system_refund` markieren und beim Tokenbestand nicht zählen | Serverausfall verbraucht keinen knappen Spielertoken |
| Readiness-Fenster | vorhandene Ready-Markierungen behalten, Deadline nach Wiederanlauf auf ein volles Fenster setzen | Spieler werden nicht wegen Ausfall als sit-out markiert |
| fertiges Match / Auto-Close | Restzeit aus `match_ended_at` berechnen; ist sie abgelaufen, konditional schließen | Gewinneranzeige/Rematch bleiben konsistent |
| Early-Leave-Frist | Ausfallzeit nicht als für den Spieler nutzbare Rejoinzeit werten; Deadline um erkannte Downtime verlängern | Infrastrukturfehler erzeugt keinen Karmaabzug |

Hierfür sollte `round.status = failed` im API-/Frontendtyp tatsächlich unterstützt und eine verständliche Meldung angezeigt werden: „Runde wegen Serverunterbrechung ohne Wertung wiederholt.“ Das ist die kleinste unvermeidbare Unterbrechung und schützt die Spielgerechtigkeit besser als eine automatische Wertung.

### 10.8 Hostmodus ohne Phantom-Stummschaltung

**Problembezug:** H-02, H-07 und M-02.

Der Hostmodus soll weiterhin mit einem Link/QR und ohne Benutzerlogin funktionieren. Empfohlen:

1. Displaytoken enthält eindeutige `jti`, `aud=display`, `tableId` und kurze Pairing-Gültigkeit.
2. Nach Pairing erhält das Display eine widerrufbare Display-Session; der lange Token verschwindet aus URL und Logs.
3. Presence wird nicht als einzelnes Boolean/Timestamp gesetzt, sondern aus aktiven Display-Sessions/Leases abgeleitet.
4. Mehrere Displays sind entweder explizit erlaubt und werden gezählt oder beim zweiten Pairing bewusst ersetzt.
5. Display sendet Heartbeat/Lease-Refresh; nach z. B. 10–15 Sekunden ohne Refresh gilt es als weg. Ein kurzer Disconnect-Debounce verhindert flackerndes Mute/Unmute.
6. Display darf nur eigenen Table-Room und zugehörigen Game-Room abonnieren.

Für Spieler bleibt die sichtbare Mechanik gleich: Sobald mindestens ein gültiges Display aktiv ist, wechseln Handys in Kompakt-/Mute-Modus. Fällt das Display wirklich aus, werden sie nach kurzer Grace automatisch wieder voll nutzbar.

### 10.9 Rate-Limits so härten, dass gemeinsames WLAN keine Partie drosselt

**Problembezug:** H-04.

Alle Teilnehmer sitzen typischerweise hinter derselben öffentlichen IP. Strenge globale IP-Limits auf Spielaktionen können daher legitimen Spielbetrieb treffen. Empfohlen ist eine geteilte Policy:

- unauthentifiziert: IP-basiert und streng für Login, Register und Bootstrap;
- authentifiziert: primär `userId` plus Endpoint, optional zusätzlich grobes IP-Gesamtlimit;
- Join-Code-Versuche: Benutzer + Tisch + IP, mit steigender Verzögerung;
- Ready/Guess/Token: semantische Einmal-/Statusprüfungen sind wichtiger als ein niedriges IP-Limit; ausreichend hohe per-user Burstgrenze;
- Audio: pro gültiger Display-/Game-Session eine kleine Zahl paralleler Streams, Rangeanforderungen erlaubt;
- Socket-Room-Joins: kleine per-socket Rate, ohne normale State-Broadcasts zu begrenzen.

So werden Brute Force und Missbrauch gebremst, ohne fünf Handys plus Display im selben WLAN in einen gemeinsamen 120-Requests-Bucket zu zwingen.

### 10.10 Audiostream absichern und Streamfehler spielerisch behandeln

**Problembezug:** M-04, M-05 und die im Feinkonzept geforderte Streamfehlerbehandlung.

Ein `<audio>`-Element kann keinen normalen Bearerheader setzen. Die bestehende URL-basierte Wiedergabe muss deshalb nicht aufgegeben werden. `songStreamPath` kann stattdessen eine kurzlebige Signatur enthalten, gebunden an:

- Song-ID;
- Game-/Round-ID;
- Table-/Display-Session;
- Ablauf kurz nach Ende des Songfensters;
- optional zulässige HTTP-Methode.

Bei Upstreamtimeout oder nicht abspielbarem Stream:

1. aktuellen Roundstatus atomar auf `failed/stream_error` setzen;
2. keine Guesses werten, keine Karte und keinen Karma-/Tokennachteil vergeben;
3. problematischen Song für die aktuelle Session überspringen bzw. temporär quarantänen;
4. allen Clients verständlichen Status broadcasten;
5. neues Ready-Fenster und danach Ersatzsong starten.

Damit bleibt der Spielabend im Fluss, statt 25 Sekunden zu hängen oder eine technisch verursachte Niederlage zu werten.

### 10.11 Sessionwechsel während einer Partie verständlich gestalten

**Problembezug:** M-01, M-03 und M-07.

Die gewünschte Single-Active-Session bleibt erhalten. Bei neuem Login oder Kennwortwechsel:

- Sessionversion atomar erhöhen;
- alte Sockets über einen usergebundenen Room mit `session:revoked` informieren und disconnecten;
- alter Client zeigt „Dieses Konto wurde auf einem anderen Gerät angemeldet“ statt „Backend nicht erreichbar“;
- neuer Client lädt Tisch/Game-State neu und joint nach Authorisierung die Rooms;
- der aktive Sitz bleibt DB-seitig bestehen, sodass der Gerätewechsel nicht als `leave` oder Early Leave zählt.

Für eine spätere Umstellung weg von `localStorage` bietet ein same-origin HttpOnly-Refreshcookie mit kurzem Access-Token im Speicher den besten Reload-/Reconnectkomfort. CSRF-Schutz ist dann für cookie-authentifizierte Mutationen mitzudenken.

### 10.12 Atomare Cleanup-, Rejoin- und Rematch-Übergänge

**Problembezug:** M-08.

- Cleanup direkt als konditionales `DELETE ... WHERE last_activity_at <= cutoff RETURNING id`; ein zwischenzeitlicher Keep-alive verhindert dadurch sicher die Löschung.
- Auto-Close in Transaktion: Tischzeile sperren und Sitze nur schließen, wenn Zustand weiterhin `finished` und `match_ended_at` weiterhin zur erwarteten Partie gehört.
- Restart in derselben Transaktion: `finished -> open`, Timer-/Deadlineversion ungültig machen und Readyflags zurücksetzen.
- Handover ausschließlich mit explizitem DB-Client innerhalb `BEGIN/COMMIT`; Eigentümer und Kandidat danach gemeinsam aktualisieren.
- Early-Leave als persistente, widerrufbare Deadline speichern; erfolgreicher Rejoin storniert sie atomar.

Die UI-Zeiten 60s/90s ändern sich nicht. Es wird lediglich verhindert, dass zwei gleichzeitige legitime Aktionen einen Tisch leeren oder den falschen Eigentümer bestimmen.

### 10.13 Änderungen ohne unnötigen Spielausfall ausrollen

Empfohlene Deploymentreihenfolge:

1. Negative Securitytests und additive DB-Spalten/Tabellen deployen; bestehende Clients bleiben zunächst kompatibel.
2. Backend unterstützt parallel Previewendpoint, Socket-Acks und alte Leseform, gibt im alten Pfad aber bereits keinen `joinCode` an Fremde aus.
3. Frontend auf Preview-vor-Join und Subscription-nach-Join umstellen.
4. Nach Verteilung des Frontends alte unautorisierte Pfade vollständig schließen.
5. Persistente Deadlines zunächst als Shadow/Reconciliation-Daten schreiben, dann Timer-Recovery aktivieren.
6. Display-Pairing und Presence hinter Featureflag testen; danach alten 12h-URL-Tokenpfad entfernen.
7. JWT-/DB-Secretrotation in einem angekündigten kurzen Wartungsfenster zwischen Partien durchführen. Weil das bekannte Default-JWT-Secret als kompromittiert gelten muss, darf es nicht noch eine Stunde als „alter Schlüssel“ akzeptiert werden; eine einmalige Neuanmeldung ist hier der notwendige Sicherheitskompromiss.

Vor jedem Deployment kann das Backend aktive `running`-Tische prüfen. Nicht dringende Schema-/Dependency-Updates werden verschoben, bis keine Partie läuft. Kritische Securityfixes dürfen dagegen nicht aus Rücksicht auf eine laufende kompromittierbare Installation aufgeschoben werden; dann greift die faire `system_interrupted`-Recovery statt einer stillen Wertung.

## 11. Priorisierter Maßnahmenplan für Claude

### Phase 0 – Sofort, vor jedem Produktivbetrieb

1. **JWT hart machen:** Default entfernen, Startvalidierung, DB-Rolle statt Tokenrolle, feste JWT-Claims/Algorithmen, getrennte Token-Audiences.
2. **Netzfläche schließen:** Backend- und DB-Hostports aus Basis-Compose entfernen; Nginx als einzigen Eintrittspunkt; Proxytrust konkretisieren.
3. **Bootstrap absichern:** einmaliges Setup-Secret/CLI und leerzustandssicherer DB-Lock.
4. **Autorisierungsmodell zentralisieren:** Table-/Game-/Round-Authorizer bauen und auf alle REST-/Socketpfade anwenden.
5. **Token-Mechanik reparieren:** aktive Spielermitgliedschaft und Parent-Child-ID-Bindung transaktional prüfen.
6. **Test-DB-Sicherung:** destruktives Global-Setup nur gegen nachweisliche Wegwerf-DB.

### Phase 1 – Vor Beta-Freigabe außerhalb eines vollständig vertrauenswürdigen LAN

7. Persistente, idempotente Deadline-/Jobverarbeitung plus Startup-Reconciliation.
8. Display-Presence robust gegen Mehrfachverbindungen und Crash machen.
9. Display-/Join-Tokens aus dauerhaften URLs/Logs entfernen; Widerruf/Rotation ergänzen.
10. HTTP-/Socket-Sessioninvalidierung angleichen; Passwortwechsel widerruft Tokens.
11. Adolar-Timeouts, URL-/Redirectpolicy und Secretbehandlung härten.
12. Statische Frontend-Securityheader, HTTPS-Betriebsprofil und restriktive CORS-Policy ergänzen.
13. Dev-/CI-Abhängigkeiten upgraden.

### Phase 2 – Stabilität, Nachweisbarkeit und Wartung

14. Transaktions-/Cleanup-/Restart-Races beseitigen.
15. Auditlog, strukturierte Logs, Metriken, Request-IDs und Alerting einführen.
16. E2E-, Socket-, Restart-, Concurrency- und negative Autorisierungstests; Coverage-Gate.
17. CI-Actions/Images pinnen, Permissions minimieren, SBOM/Updateautomation einrichten.
18. Backup/Restore, Datenaufbewahrung, Single-Instance-Grenze bzw. HA-Architektur dokumentieren und testen.
19. Spezifikation und Benutzer-/Betriebsdokumentation an tatsächliche Implementierung angleichen.

## 12. Verbindliche Akzeptanzkriterien für die erste Reparaturrunde

Claude sollte eine Reparaturrunde erst als abgeschlossen melden, wenn mindestens folgende automatisierte Nachweise existieren:

1. Backend startet mit `NODE_ENV=production` ohne gesetztes starkes JWT-Secret nicht.
2. Tokenrolle ungleich DB-Rolle führt nicht zu erweiterten Rechten.
3. Zwei parallele Bootstrap-Requests können zusammen höchstens einen Admin anlegen; ohne Setup-Autorisierung sind beide verboten.
4. Fremdbenutzer erhalten für private Table-/Game-/Round-Details 403/404 und niemals den `joinCode`.
5. Displaytoken von Tisch A kann weder REST- noch Socketdaten von Tisch B lesen.
6. Nichtspieler kann weder Guess noch Token-Claim/-Submit einer fremden Runde ausführen; DB und Roundstatus bleiben unverändert.
7. `roundId` aus Game A zusammen mit `gameId` aus Game B wird abgelehnt.
8. Gesperrter oder durch neue Anmeldung supersedierter Benutzer kann keine neue Socketverbindung nutzen; bestehende Verbindung wird definiert beendet oder vor jeder Subscription erneut abgewiesen.
9. Backendneustart während jedes zeitkritischen Roundstatus führt nach Wiederanlauf automatisch zum korrekten Folgezustand.
10. Zwei Displays plus Disconnect eines Displays halten Presence korrekt; Prozessneustart hinterlässt keinen Phantom-Anchor.
11. Integrationstest-Setup verweigert jede nicht ausdrücklich als Testziel validierte Datenbank vor dem ersten `TRUNCATE`.
12. `npm run lint`, Unit-, Integration-, neue Security-/Concurrencytests und `npm run build` sind grün; `npm audit --omit=dev` bleibt ohne Befund und die vollständige Auditliste ist auf eine begründete Policy reduziert.

### 12.1 Spielmechanische Nichtregression

Zusätzlich zu den Security-Negativtests müssen folgende legitime Abläufe als Integration-/E2E-Test grün bleiben:

1. Öffentlichen Tisch ansehen, als Spieler beitreten, ready setzen und automatisch bzw. durch Eigentümer starten.
2. Privaten Einladungslink öffnen, bei Bedarf Login durchlaufen, mit dem enthaltenen Code beitreten und den Code danach aus der URL entfernen.
3. Erlaubter Zuschauer kann einem offenen oder laufenden Tisch gemäß aktueller Regel beitreten, erhält Live-State/Reveals, kann aber keine Spielaktion absenden.
4. Normale Runde behält 3s Countdown, 25s Songfenster, letzte gültige Positionseinsendung und identische Kartenwertung.
5. Tokenmechanik behält zwei Tokens pro aktivem Spieler, 150ms Claim-Race, Solo- und Gegenspielerfenster sowie bisherigen Tie-Break; ausschließlich Nichtteilnehmer werden ausgeschlossen.
6. Spieler, der für eine Runde nicht ready war, bleibt nur für diese Runde sit-out und kann an der nächsten wieder teilnehmen.
7. Display kann weiterhin ohne App-Login gekoppelt werden, spielt Audio, schaltet aktive Spielergeräte kompakt/stumm und gibt sie nach echtem Displayverlust wieder frei.
8. Technischer Geräte-/Sessionwechsel lässt den Tischsitz bestehen; kein Early-Leave-Abzug allein durch Socketdisconnect oder Neuanmeldung.
9. Rejoin innerhalb 90s verhindert weiterhin den Malus; nach echter Frist wird genau einmal gebucht.
10. Rematch innerhalb 60s öffnet denselben Tisch mit denselben Sitzenden und zurückgesetzten Readyflags; Auto-Close räumt nur weiterhin fertige, nicht neu gestartete Tische auf.
11. Serverrestart während einer aktiven Phase folgt den Regeln aus 10.7: keine technisch verursachte Wertung, kein verlorener Token und ein verständlicher Recovery-Broadcast.
12. Streamfehler führt zu genau einer ungewerteten Ersatzrunde und blockiert weder Tisch noch nachfolgende Songs.

## 13. Empfohlene Umsetzungsstruktur

Für eine risikoarme Bearbeitung nicht alle Änderungen in einen großen Commit mischen. Empfohlene Reihenfolge:

1. Securitytests schreiben, die K-01/K-02/H-01/H-02/H-03 reproduzieren.
2. Gemeinsame Auth-/Authorization-Helfer und DB-Abfragen implementieren.
3. Deploymentdefaults/Secrets/Proxytrust korrigieren.
4. Timer-/Presence-Reconciliation separat umbauen und mit Fake Clock + Neustartszenarien testen.
5. Testdatenbank-Safety und CI-/Dependency-Upgrades getrennt durchführen.
6. Dokumentation und Betriebsrunbook zuletzt an die verifizierte Implementierung angleichen.

So bleiben Securityfixes reviewbar und ein Spiellogikfehler kann nicht zwischen großen Infrastrukturänderungen verschwinden.

---

**Audit-Hinweis:** Es wurden außer diesem Bericht keine Anwendungsdateien verändert. Die vorbestehenden, nicht versionierten Dateien unter `screens/` wurden nicht angefasst.
