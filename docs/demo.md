# Demomodus

Adolar Songster kann als isolierte, öffentlich zugängliche Demo-Instanz
betrieben werden - zum Ausprobieren, ohne dass irgendwo echte
Zugangsdaten, echte Songs oder dauerhafte Nutzerdaten entstehen.

## Was der Demomodus macht

- Die Datenbank wird periodisch (Standard: stündlich) vollständig
  zurückgesetzt: alle Accounts, Tische, Spiele, Runden, Chatnachrichten,
  Host-Device-Pairings und der Songpool werden gelöscht und neu befüllt
  mit:
  - einem festen Demo-Admin-Account,
  - einem Demo-Spieler (`demo-anna`), der bereits einen offenen,
    öffentlichen Demo-Tisch eröffnet hat und dort schon sitzt und bereit
    ist - ein Besucher kann direkt beitreten, selbst auf "bereit" klicken
    und das Spiel startet sofort, ganz ohne eigenen Tisch anlegen zu
    müssen,
  - einem stehenden Einladungscode, mit dem sich Besucher selbst
    registrieren können,
  - einer synthetischen Song-Bibliothek (16 erfundene Titel, über sieben
    Jahrzehnte verteilt), damit sofort eine spielbare Partie möglich ist.
- Ein sichtbares Banner im Frontend weist auf den Demomodus hin und zeigt
  den Einladungscode sowie die Admin-Zugangsdaten - beides ist bewusst kein
  Geheimnis, da die Instanz ohnehin nur Testdaten enthält und sich selbst
  zurücksetzt.
- Ein `X-Robots-Tag: noindex, nofollow`-Header verhindert, dass die
  Demo-Instanz in Suchmaschinen auftaucht.
- Ein paar destruktive Admin-Aktionen sind gesperrt (Einladungsrechte
  entziehen, Kommunikationseinstellungen ändern, Tische löschen, Songs
  hinzufügen) - siehe `backend/src/middleware/demoBlock.ts`. Alles andere
  (Registrieren, Spielen, Tische anlegen, Chat, Rangliste, Admin-Ansicht)
  funktioniert normal.
- Der Songpool besteht aus 16 synthetisch erzeugten Platzhaltertiteln
  (reiner Sinuston pro Titel, mit ID3-Metadaten), erzeugt vom
  `demo-songs`-Compose-Service beim ersten Start. Es werden keine echten
  Musikdateien verwendet, mitgeliefert oder von einer echten Adolar-Instanz
  bezogen - das wäre sowohl ein Urheberrechtsproblem als auch unnötig für
  eine öffentliche Demo. Die Songs laufen über den bereits bestehenden
  `source='local'`-Mechanismus (siehe `POST /admin/songs`,
  `routes/songs.ts`s Stream-Redirect) - keine Adolar-Anbindung nötig, die
  Felder `ADOLAR_BASE_URL`/`ADOLAR_API_TOKEN` bleiben in der Demo bewusst
  leer.

## Zum Testen

1. Mit dem Einladungscode selbst registrieren (oder direkt als
   `demo-admin` anmelden) und in der Lobby den offenen "Demo-Tisch"
   beitreten.
2. Auf "bereit" klicken - `demo-anna`, die Tischbesitzerin, ist bereits
   bereit, also startet die erste Runde sofort.
3. Für eine zweite Runde muss auch `demo-anna` wieder auf "bereit"
   klicken (die Runden-Bereit-Markierung gilt jeweils nur für die
   laufende Partie) - dafür in einem zweiten Tab/Browser mit `demo-anna`
   / `<DEMO_ADMIN_PASSWORD>` anmelden, oder dort den "Auto bereit"-
   Schalter einmal aktivieren, dann läuft die Partie von allein weiter.

`demo-anna` ist nur eine vorab in der Datenbank angelegte Zeile, niemand
ist dauerhaft in ihrem Namen eingeloggt - `table_seat.ready` (das
Tisch-Bereit-Flag, das den automatischen Spielstart auslöst) lässt sich
beim Reset vorab setzen, das separate, pro-Partie geltende "Auto bereit"
(`round_ready_pref`) dagegen nicht, weil es erst nach dem ersten
Rundenstart eine Partie-ID gibt, an die es gebunden werden kann.

## Aktivierung

Rein über die Umgebungsvariable `DEMO_MODE=true`
(`backend/src/config/demoMode.ts`), gesetzt für eine komplett separate
Compose-Installation - **niemals** gegen eine bestehende, echte Datenbank.

```bash
cp .env.demo.example .env.demo
# JWT_SECRET in .env.demo setzen (openssl rand -hex 32)

docker compose -p adolar-songster-demo --env-file .env.demo -f docker-compose.demo.yml up -d --build
```

`docker-compose.demo.yml` ist bewusst eine eigenständige Compose-Datei,
kein Override der normalen `docker-compose.yml` - sie hat eigene
Standard-Ports (Frontend `5176`, Postgres `15434`, siehe
`.env.demo.example`), ein eigenes DB-Volume (durch den Compose-Projektnamen
`adolar-songster-demo` automatisch von der echten Installation getrennt)
und einen zusätzlichen `demo-songs`-Service, der die Platzhalter-Songs
erzeugt, bevor Backend und Frontend starten. Eine echte
Adolar-Songster-Installation und eine Demo-Installation können so parallel
auf demselben Host laufen, ohne sich in die Quere zu kommen.

### Konfigurierbare Werte (`.env.demo`)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `JWT_SECRET` | *(erforderlich)* | wie bei der echten Installation |
| `DEMO_RESET_MINUTES` | `60` | Reset-Intervall in Minuten, geklemmt auf 5-1440 |
| `DEMO_ADMIN_USERNAME` / `_EMAIL` / `_PASSWORD` | `demo-admin` / `demo-admin@example.invalid` / `songster-demo` | fester Admin-Login, auf dem Banner sichtbar |
| `DEMO_INVITE_CODE` | `demo` | stehender Einladungscode für Selbstregistrierung |
| `FRONTEND_HOST_PORT` / `DB_HOST_PORT` | `5176` / `15434` | Host-Ports, kollisionsfrei zur echten Installation (`5173`/`15432`) |
| `DEMO_SONG_SECONDS` | `25` | Länge der generierten Platzhalter-Songs |

## Sicherheitsmechanismus

`backend/src/services/demoReset.ts`s `assertDemoSafeToManage()` läuft bei
jedem Start, wenn `DEMO_MODE=true` gesetzt ist:

- Findet sie einen `system_setting`-Eintrag `demo_managed`, ist die
  Datenbank bereits als Demo-Instanz markiert - der periodische Reset läuft
  normal weiter.
- Ist die Datenbank leer (kein einziger Account), wird sie einmalig
  befüllt und der Marker gesetzt.
- Enthält die Datenbank bereits Accounts, aber **keinen** Marker, verweigert
  das Backend den Start mit einem Fehler. Das verhindert, dass ein
  Konfigurationsfehler (z. B. eine versehentlich wiederverwendete
  `DATABASE_URL`) eine echte, befüllte Installation stillschweigend
  periodisch leerräumt.

## Tests

- `backend/test/unit/demoMode.test.ts`: Env-Var-Parsing (Aktivierung,
  Clamping von `DEMO_RESET_MINUTES`).
- `backend/test/integration/demoReset.test.ts`: Erstbefüllung (inkl.
  Song-Bibliothek), Idempotenz, Verweigerung bei fremden Daten ohne
  Marker, Reset erzeugt die Song-Bibliothek jedes Mal neu.
- `backend/test/integration/demoBlock.test.ts`: gesperrte vs. weiterhin
  erlaubte Admin-Routen, öffentlicher `/api/v1/demo/status`-Endpunkt.

```bash
npm run test:unit --workspace backend
DATABASE_URL=postgres://songster:songster@localhost:5432/adolar_songster npm run test:integration --workspace backend
```
