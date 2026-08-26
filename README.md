# Adolar Songster

**Status: Beta** - privates Musik-Ratespiel fuer kleine Gruppen. Projektdokumentation siehe
[docs/Adolar_Songster_Masterindex_v1_20260821.md](docs/Adolar_Songster_Masterindex_v1_20260821.md).

## Neu in dieser Beta (seit v0.3.0-beta)

- **Songster-Playlists-Menue**: eigener Menuepunkt zur Playlistadministration im Spielclient
- **Stichrunde ueberarbeitet**: bei Gleichstand gewinnt jetzt die naeheste Jahresschaetzung statt eines exakten Treffers
- Playlist-scoped Song-Pool-Suche im Admin-Bereich, plus lokaler (Adolar-unabhaengiger) Playlist-Katalog
- Neuer "Auto bereit"-Toggle pro Runde im Bereit-Fenster
- Lobby-Tischliste: Spieler- oder Zuschauer-Beitritt direkt waehlbar
- Anzeigegeraet-/Startkarten-Fixes, Playlist-Tracking, ueberarbeitetes PDF-Branding; 24h-Uhrzeit im Datum der Spielzusammenfassung
- Fix: Avatar-Doppelklick startete versehentlich eine Runde mit haengendem Fehler
- Fix: weisser Text auf weissem Grund in der Song-Pool-Playlist-Auswahl
- Sicherheits-Haertung: Autorisierungsluecken aus dem Audit vom 25.08.2026 geschlossen (Phase 0 + 1), CVE-Patch im Docker-Basisimage

## Quickstart (Docker)

```bash
cp .env.example .env
# JWT_SECRET eintragen, z. B.:
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up --build
```

Startet Postgres (nur auf localhost erreichbar), spielt die Migrationen ein
und startet Backend und Frontend (Port 5173). Das Backend ist absichtlich
nicht direkt vom Host aus erreichbar - Frontend/nginx ist der einzige
Eintrittspunkt und proxied `/api` und `/socket.io` intern.

- Frontend: http://localhost:5173

### Einrichtung (3-Schritte-Onboarding, FR-061/062)

1. `.env` mit einem echten `JWT_SECRET` anlegen (siehe oben) - ohne startet
   das Backend absichtlich nicht (K-01: kein unsicherer Default mehr)
2. `docker compose up --build`
3. Im Browser http://localhost:5173 oeffnen - der Einrichtungsassistent
   fuehrt auf einem frischen System durch Admin-Anlage, erste Einladung,
   Testtisch und einen abschliessenden Funktionstest (FR-063). Fuer die
   Admin-Anlage wird ein einmaliges Setup-Token abgefragt, das beim ersten
   Start in den Backend-Logs steht (`docker compose logs backend`, Zeile
   "SETUP TOKEN") - das verhindert, dass ein fremder Client im selben
   Netzwerk sich vor dem Betreiber selbst zum Admin macht (K-02). Dort steht
   auch ein fertiger Link mit vorausgefuelltem Token zum direkten Anklicken
   (Host bei Bedarf per `FRONTEND_URL` in `.env` anpassen, falls der
   Assistent von einem anderen Geraet im Netzwerk geoeffnet wird). Existiert
   bereits ein Admin, zeigt der Assistent das direkt an.

Danach per `POST /api/v1/auth/login` einloggen und mit dem `accessToken`
weitere Invites erzeugen (`POST /api/v1/invites`). API-Details siehe
[docs/Adolar_Songster_API_Spezifikation_v1_20260821.md](docs/Adolar_Songster_API_Spezifikation_v1_20260821.md).

## Lokale Entwicklung ohne Docker

Voraussetzung: Node.js 22, laufende PostgreSQL-Instanz.

```bash
npm install
cp backend/.env.example backend/.env   # DATABASE_URL ggf. anpassen
echo "JWT_SECRET=$(openssl rand -hex 32)" >> backend/.env   # erforderlich, siehe K-01
npm run --workspace backend migrate:up
npm run --workspace backend dev        # Backend auf Port 4000
npm run --workspace frontend dev       # Frontend auf Port 5173
```

## Struktur

- `backend/` - Node.js/Express/TypeScript API, PostgreSQL-Migrationen (node-pg-migrate)
- `frontend/` - Vite/React/TypeScript Web-Client
- `docs/` - Verbindliche Projektdokumentation (Pflichtenheft, Feinkonzept, API-Spec, ...)
- `.github/workflows/ci.yml` - CI: Lint, Unit-/Integrationstests, Build, Dependency-/Secret-Scan, CodeQL, Image-Scan

## Tests

```bash
npm run lint
npm run test:unit
npm run test:integration   # benoetigt DATABASE_URL gegen eine laufende Postgres-Instanz;
                            # ACHTUNG: leert diese Datenbank komplett (TRUNCATE aller
                            # Kerntabellen). Nur gegen eine Wegwerf-DB verwenden - siehe
                            # backend/test/integration/globalSetup.js
npm run build
```
