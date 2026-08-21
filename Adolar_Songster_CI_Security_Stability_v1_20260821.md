# Adolar Songster - CI, Security und Stability Konzept

Version: 1.0
Stand: 2026-08-21
Status: verbindlich fuer Projektstart

## 1. Ziel
Sicherheit und Stabilitaet sind ab Projektbeginn Teil der Lieferqualitaet und nicht nachgelagert.
Jeder Merge muss automatisierte Qualitaetspruefungen bestehen.

## 2. Pflicht-Quality-Gates (ab Sprint 0)
1. Linting (Frontend + Backend)
2. Unit-Tests
3. Integrations-Tests (API + DB)
4. Build-Check
5. Security-Checks:
- Dependency Vulnerability Scan
- Secret Scan
- Optional Container Scan bei Docker-Images

Merge-Regel:
- Kein Merge in main ohne gruene Pflicht-Gates.

## 3. Testpyramide
1. Unit-Tests fuer Kernregeln
- Token-Verbrauch
- Song-Wiederholungsregeln (Partie/Session)
- Punkte- und Karma-Logik

2. Integrations-Tests
- Registrierung mit Invite
- Tischjoin-Grenzen
- Neue-Partie-Fluss
- Songpool-Reset nach kompletter Playlist-Ausschoepfung

3. Smoke-/E2E-Tests
- Wizard-Setup
- Ein komplettes Testspiel

## 4. Security-Baseline
1. Secret Management nur ueber CI-Secrets/Umgebungsvariablen.
2. Keine Secrets im Repository (automatischer Secret-Scan).
3. Dependency Updates regelmaessig (z. B. Dependabot/Renovate).
4. Kritische Schwachstellen blockieren Releases.
5. Security-relevante Fehler in Ticket/Issue mit Prioritaet dokumentieren.

## 5. Stabilitaets-Baseline
1. Regressionstestpflicht bei jeder Regelanpassung.
2. Reproduzierbare Testdaten fuer Kernflows.
3. Deterministische Zeitsteuerung in Tests (Mock/Clock).
4. Healthchecks fuer Backend und DB.

## 6. CI-Laufstrategie
1. Pull Request Pipeline
- Schnell, blockierend
- Lint + Unit + Integration + Security light

2. Main Pipeline
- Vollstaendig, blockierend
- Build + Security komplett + optional Container Scan

3. Nightly Pipeline
- Erweiterte Regression, ggf. Last-/Stabilitaetschecks

## 7. Mindest-Metriken
1. Testabdeckung Kernlogik: Ziel >= 80 Prozent.
2. Flaky-Tests: Ziel 0; instabile Tests sofort reparieren oder quarantainen.
3. Mean Time to Fix fuer rote Builds als Teamkennzahl fuehren.

## 8. Verantwortlichkeiten
1. Jeder PR-Ersteller stellt gruene Pipeline sicher.
2. Reviewer pruefen zusaetzlich Regeltests bei Spiellogik-Aenderungen.
3. Maintainer halten Branch-Protection und CI-Definition aktuell.
