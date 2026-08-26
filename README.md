# Adolar Songster

**Version: v0.5.0-beta** - privates Musik-Ratespiel fuer kleine Gruppen. Projektdokumentation siehe
[docs/Adolar_Songster_Masterindex_v1_20260821.md](docs/Adolar_Songster_Masterindex_v1_20260821.md).

## Neu in v0.5.0-beta

- **Lobby-Chat:** angemeldete Nutzer koennen sich bereits vor dem Tischbeitritt
  austauschen. Angezeigt werden maximal 50 Nachrichten aus den letzten 30 Minuten.
- **Tisch-Chat:** eigener Kommunikationskanal fuer aktive Spieler und Zuschauer
  eines Tisches.
- **Playboard-Reaktionen:** kurze, phasenabhaengige Emoji-/Text-Reaktionen statt
  freiem Chat waehrend der Partie. Sie erscheinen am Spieleravatar und auf dem
  gemeinsamen Hostdisplay.
- **Admin-Konfiguration:** Text-Smileys koennen serverseitig in Emojis umgewandelt
  werden. Ein Wortfilter ersetzt konfigurierte Woerter und Phrasen durch `*piep*`.
- **Frei belegbare Reaktionen:** sechs Spielzustaende mit jeweils bis zu acht
  eindeutigen Motiven aus einem kuratierten Katalog, inklusive eigener
  Beschriftung, Sortierung und Live-Aktualisierung geoeffneter Playboards.
- **Rundenstabilitaet:** Auto-bereit startet nur noch den vorgesehenen
  Bereit-Vorgang; Reveal-Timer, letzter Song und Stichrunden-Regelmodale wurden
  gegen konkurrierende Timer abgesichert.

Details zur Spielerkommunikation, API, Sicherheitsentscheidung und den
Restrisiken stehen in
[docs/Adolar_Songster_Spielerkommunikation_Whatsnew_Quelle_v1_20260826.md](docs/Adolar_Songster_Spielerkommunikation_Whatsnew_Quelle_v1_20260826.md).

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
