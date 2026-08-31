# Adolar Songster

**Version: v0.5.1-beta** - privates Musik-Ratespiel fuer kleine Gruppen. Projektdokumentation siehe
[docs/Adolar_Songster_Masterindex_v1_20260821.md](docs/Adolar_Songster_Masterindex_v1_20260821.md).

## Neu in v0.5.1-beta

- **Browser-/Host-App-Modus:** ein Hostbildschirm kann jetzt ueber `/host`
  im Browser oder ueber die Android-/Fire-TV-Host-App gestartet werden.
- **QR-Autorisierung fuer Hostgeraete:** der Host zeigt QR-Code und Kurzcode;
  ein angemeldeter Songster-Nutzer bestaetigt das Geraet und kann es danach
  privaten Tischen als Anzeigegeraet zuweisen.
- **iPad-/Tablet-tauglicher Host:** fuer iPad, Laptop und normale Tablets wird
  keine native App benoetigt; der Browser-Host nutzt dieselbe Mechanik wie die
  Host-App.
- **Profil-Trennung:** autorisierte Hostgeraete koennen im Profil getrennt
  werden. Geschlossene oder getrennte Hostgeraete verlieren sofort ihre
  Berechtigung.
- **Playboard-Feinschliff:** Auto-bereit hat einen sichtbaren Repeat-Schalter
  neben dem Lautsprecher, Doppeltipp auf das eigene Icon ist robuster, Android-
  Textauswahl im Spielbereich wird unterdrueckt.
- **Sync-Stabilitaet:** verspaetete Spielstand-Updates werden im Client und
  Hostdisplay ignoriert, damit alte Aufloesungen nicht ueber einer neuen Runde
  stehen bleiben.
- **Playlist-Reihenfolge:** eine Playlist kann als Standardplaylist markiert
  werden. Sie erscheint zuerst, danach folgen weitere Playlists alphabetisch;
  lokale Playlist-Auswahl bleibt am Ende.

Hostmodus-Anleitung:
[docs/Adolar_Songster_Hostmodus_Anleitung_v1_20260825.md](docs/Adolar_Songster_Hostmodus_Anleitung_v1_20260825.md).

Technisches Host-App-/Browser-Konzept:
[docs/Adolar_Songster_FireTV_Host_App_MVP_v1_20260831.md](docs/Adolar_Songster_FireTV_Host_App_MVP_v1_20260831.md).

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
