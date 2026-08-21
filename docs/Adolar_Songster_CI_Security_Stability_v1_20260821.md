# Adolar Songster - CI, Security und Stability Konzept

Version: 1.1
Stand: 2026-08-21
Status: verbindlich fuer Projektstart

Referenz: Die produktuebergreifende Baseline fuer die gesamte Adolar-Familie
steht in `musicapp/docs/INTEGRATION_STANDARDS.md` Abschnitt 7 (Pflicht-
Quality-Gates, Security-Baseline, Stabilitaets-Baseline). Dieses Dokument
uebernimmt diese Baseline nicht mehr wortwoertlich, sondern verweist darauf
und fuehrt nur Songster-spezifische Ergaenzungen (Testpyramide-Inhalte,
CI-Laufstrategie-Details, Metrik-Zielwerte). Bei Aenderung der zentralen
Baseline: dieses Dokument nicht separat nachpflegen, es zieht die
Referenz automatisch nach.

## 1. Ziel
Sicherheit und Stabilitaet sind ab Projektbeginn Teil der Lieferqualitaet und nicht nachgelagert.
Jeder Merge muss automatisierte Qualitaetspruefungen bestehen.

## 2. Pflicht-Quality-Gates (ab Sprint 0)
Entspricht der Familie-Baseline (`INTEGRATION_STANDARDS.md` Abschnitt 7):
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
Uebernommen aus `INTEGRATION_STANDARDS.md` Abschnitt 7 (Punkte 1-4 dort
identisch). Songster-spezifische Ergaenzung:
5. Security-relevante Fehler in Ticket/Issue mit Prioritaet dokumentieren.
6. Aenderungen, die die Adolar-Anbindung betreffen (siehe
   `Adolar_Songster_Adolar_Integration_Konzept_v1_20260821.md`), halten
   sich an das Namensraum-Prinzip aus `INTEGRATION_STANDARDS.md`
   Abschnitt 2 - kein Zugriff auf/Ueberladen von Feldern anderer
   Adolar-Produkte.

## 5. Stabilitaets-Baseline
Uebernommen aus `INTEGRATION_STANDARDS.md` Abschnitt 7 (Regressionstest-
pflicht bei geteilten Routen/Tabellen, reproduzierbare Testdaten,
Healthchecks). Songster-spezifische Ergaenzung:
1. Deterministische Zeitsteuerung in Tests (Mock/Clock) - insbesondere fuer
   Malus-/`last_played_at`-Logik (Integrationskonzept Abschnitt 4.4).

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
4. PRs, die die Adolar-Anbindung aendern, aktualisieren zusaetzlich
   `musicapp/docs/PRODUCT_INTEGRATIONS.md` Abschnitt 5 (Songster) - siehe
   `INTEGRATION_STANDARDS.md` Abschnitt 6 (Aenderungsprozess).
