# Adolar Songster

Privates Musik-Ratespiel fuer kleine Gruppen. Projektdokumentation siehe
[docs/Adolar_Songster_Masterindex_v1_20260821.md](docs/Adolar_Songster_Masterindex_v1_20260821.md).

## Quickstart (Docker)

```bash
docker compose up --build
```

Startet Postgres, spielt die Migrationen ein und startet Backend (Port 4000)
und Frontend (Port 5173).

- Frontend: http://localhost:5173
- Backend-Health: http://localhost:4000/api/v1/health

### Ersten Admin anlegen

Auf einem frischen System existiert noch kein Account. Einmalig:

```bash
curl -X POST http://localhost:4000/api/v1/setup/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@example.test","password":"..."}'
```

Danach per `POST /api/v1/auth/login` einloggen und mit dem `accessToken`
Invites erzeugen (`POST /api/v1/invites`), damit sich weitere Nutzer
registrieren koennen. Details siehe
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
