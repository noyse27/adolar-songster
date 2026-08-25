# Adolar Songster

**Status: Beta** - privates Musik-Ratespiel fuer kleine Gruppen. Projektdokumentation siehe
[docs/Adolar_Songster_Masterindex_v1_20260821.md](docs/Adolar_Songster_Masterindex_v1_20260821.md).

## Neu in dieser Beta (seit v0.2.0-beta)

- **Hostmodus**: ein gemeinsames Anzeigegeraet (Tablet/Fernseher/Laptop) zeigt das volle Playboard und spielt den Song fuer alle hoerbar ab, waehrend jedes Handy nur die eigene Zeitleiste zeigt und stumm bleibt. Laeuft ueber einen eigenen Anzeige-Token statt eines Logins (kollidiert nicht mit Single-Active-Session), inkl. QR-Code-Beitritt direkt vom grossen Bildschirm
- Wach-Halten des Bildschirms waehrend einer laufenden Partie (Screen Wake Lock, erfordert HTTPS)
- Persistenter "gespielte Spiele auf dem Server"-Zaehler - ueberlebt jetzt das automatische Aufraeumen inaktiver Tische (vorher gingen abgeschlossene Partien nach 60 Minuten wieder aus der Statistik verloren)
- Nginx liefert `index.html` nicht mehr gecacht aus - Handys bekamen nach einem Redeploy sonst teils tagelang die alte Version
- Playboard-Layout-Fixes fuer schmale/quer gedrehte Handy-Bildschirme, inkl. eines Android-Bugs, bei dem Antippen von UI-Text die Woerterbuch-Einblendung ausloeste

## Quickstart (Docker)

```bash
docker compose up --build
```

Startet Postgres, spielt die Migrationen ein und startet Backend (Port 4000)
und Frontend (Port 5173).

- Frontend: http://localhost:5173
- Backend-Health: http://localhost:4000/api/v1/health

### Einrichtung (3-Schritte-Onboarding, FR-061/062)

1. `.env`/`backend/.env.example` bei Bedarf anpassen (z. B. `JWT_SECRET`)
2. `docker compose up --build`
3. Im Browser http://localhost:5173 oeffnen - der Einrichtungsassistent
   fuehrt auf einem frischen System durch Admin-Anlage, erste Einladung,
   Testtisch und einen abschliessenden Funktionstest (FR-063). Existiert
   bereits ein Admin, zeigt der Assistent das direkt an.

Danach per `POST /api/v1/auth/login` einloggen und mit dem `accessToken`
weitere Invites erzeugen (`POST /api/v1/invites`). API-Details siehe
[docs/Adolar_Songster_API_Spezifikation_v1_20260821.md](docs/Adolar_Songster_API_Spezifikation_v1_20260821.md).

## Lokale Entwicklung ohne Docker

Voraussetzung: Node.js 22, laufende PostgreSQL-Instanz.

```bash
npm install
cp backend/.env.example backend/.env   # DATABASE_URL ggf. anpassen
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
npm run test:integration   # benoetigt DATABASE_URL gegen eine laufende Postgres-Instanz
npm run build
```
