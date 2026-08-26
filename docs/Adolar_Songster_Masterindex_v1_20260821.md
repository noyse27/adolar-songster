# Adolar Songster - Masterindex Dokumentation

Version: 1.0
Stand: 2026-08-21
Ablagepfad: \\192.168.0.112\download\adolar-songster

## 1. Zweck
Diese Datei ist der zentrale Einstiegspunkt fuer das gesamte Projektpaket.
Sie verweist auf alle relevanten Dokumente, die fuer Umsetzung, Uebergabe und Abnahme benoetigt werden.

## 2. Empfohlene Lesereihenfolge
1. Adolar_Songster_Pflichtenheft_v1_20260821.md
2. Adolar_Songster_Technisches_Feinkonzept_v1_20260821.md
3. Adolar_Songster_API_Spezifikation_v1_20260821.md
4. Adolar_Songster_DB_Schema_MVP_v1_20260821.sql
5. Adolar_Songster_CI_Security_Stability_v1_20260821.md
6. Adolar_Songster_GitHubActions_CI_Template_v1_20260821.yml
7. Adolar_Songster_Implementierungsplan_Sprints_v1_20260821.md
8. Adolar_Songster_Uebergabe_Quickstart_v1_20260821.md
9. Adolar_Songster_Fragebogen_MVP_Beispielausfuellung_20260821_124001.md
10. Adolar_Songster_Fragebogen_MVP_20260821_124001.md

## 3. Dokumente und Inhalt

## 3.1 Kernanforderungen
- Datei: Adolar_Songster_Pflichtenheft_v1_20260821.md
- Inhalt: Verbindliche Anforderungen (FR, UX, BR, NFR), Abnahmekriterien, Projektgrenzen, Ausbaupfad.
- Verwendung: Verbindliche Grundlage fuer Scope, Umsetzung und Abnahme.

## 3.2 Technisches Design
- Datei: Adolar_Songster_Technisches_Feinkonzept_v1_20260821.md
- Inhalt: Architektur, Komponenten, Datenmodell, Zustandsmodell, Fehler- und Sicherheitskonzept.
- Verwendung: Technische Leitlinie fuer Backend/Frontend/Infra.

## 3.3 Schnittstellen
- Datei: Adolar_Songster_API_Spezifikation_v1_20260821.md
- Inhalt: REST-Endpunkte, WebSocket-Events, Payloads, Fehlercodes, Fachregeln.
- Verwendung: Vertrag zwischen Frontend und Backend.

## 3.4 Datenbankschema
- Datei: Adolar_Songster_DB_Schema_MVP_v1_20260821.sql
- Inhalt: Startfaehiges PostgreSQL-Basisschema inkl. Indizes/Constraints fuer Neue-Partie- und Songpool-Regeln.
- Verwendung: Ausgangspunkt fuer initiale Migrationen, auch wenn noch kein Code existiert.

## 3.5 CI, Security und Stabilitaet
- Datei: Adolar_Songster_CI_Security_Stability_v1_20260821.md
- Inhalt: Verbindliche Quality-Gates, Teststrategie und Security-Baseline ab Sprint 0.
- Verwendung: Sicherheits- und Stabilitaetsrahmen fuer alle Merges und Releases.

## 3.6 CI-Workflow Vorlage
- Datei: Adolar_Songster_GitHubActions_CI_Template_v1_20260821.yml
- Inhalt: GitHub-Actions-Template mit Lint, Tests, Security-Scans, CodeQL und Image-Scan.
- Verwendung: Direkt als Startpunkt fuer .github/workflows/ci.yml.

## 3.7 Umsetzungstaktung
- Datei: Adolar_Songster_Implementierungsplan_Sprints_v1_20260821.md
- Inhalt: Sprint 0-6, Ziele, Lieferobjekte, Akzeptanz, Risiken.
- Verwendung: Projektsteuerung und Fortschrittskontrolle.

## 3.8 Externe Teamuebergabe
- Datei: Adolar_Songster_Uebergabe_Quickstart_v1_20260821.md
- Inhalt: Kickoff-Ablauf, DoD, Abnahmeprotokoll.
- Verwendung: Onboarding fuer Team auf anderem PC.

## 3.9 Entscheidungsgrundlage (final)
- Datei: Adolar_Songster_Fragebogen_MVP_Beispielausfuellung_20260821_124001.md
- Inhalt: Finalisierte Produktentscheidungen inklusive UI- und Brandingvorgaben.
- Verwendung: Nachvollziehbarkeit der getroffenen Entscheidungen.

## 3.10 Entscheidungsgrundlage (leer)
- Datei: Adolar_Songster_Fragebogen_MVP_20260821_124001.md
- Inhalt: Urspruenglicher Fragebogen ohne Ausfuellung.
- Verwendung: Vorlage fuer spaetere Varianten/Projekte.

## 3.11 Adolar-Integration (Phase-2-Vorbereitung)
- Datei: Adolar_Songster_Adolar_Integration_Konzept_v1_20260821.md
- Inhalt: Aenderungen am Adolar-Repo (F:\claude\musicapp) fuer Songster-
  Playlisten, Sichtbarkeitsabgrenzung, Client-Identifikation; Songster-
  seitiger Batch-Lademechanismus mit Diversitaets- und Malusregeln.
- Verwendung: Voraussetzung fuer Phase 2 (lokaler Ordner-Scan) - muss vor
  Phase 2 abgeschlossen sein, da Songster im Adolar-Modus erst vollstaendig
  funktionieren soll.

## 3.12 Benutzerhandbuch (Beta)
- Datei: Adolar_Songster_Benutzerhandbuch_v1_20260824.md
- Inhalt: Aus dem aktuellen Code abgeleitete, vollständige Beschreibung
  aller Bildschirme/Funktionen aus Nutzersicht (Registrierung, Lobby,
  Tisch erstellen, Spielablauf, Punkte/Karma, Rangliste, Admin-Bereich,
  Inaktivitäts-Aufräumung, PDF-Export, Fußzeile).
- Verwendung: Ausgangsdokument für eine generierte Anleitung/Hilfeseite
  (z. B. per adolar-whatsnew-Skill), nicht selbst die Endnutzer-Hilfeseite.

## 3.13 Hostmodus-Anleitung (Einsteiger)
- Datei: Adolar_Songster_Hostmodus_Anleitung_v1_20260825.md
- Inhalt: Bereits im fertigen Endnutzer-Ton geschriebene Schritt-für-
  Schritt-Anleitung für den Hostmodus (gemeinsamer Bildschirm + eigenes
  Handy pro Spieler), inklusive Registrierung mit Einladungscode - nicht
  aus dem Code abgeleitet wie das Benutzerhandbuch, sondern die
  Endtext-Quelle selbst.
- Verwendung: Direkt verwendbare Textquelle für den adolar-whatsnew-Skill
  bzw. zum unveränderten Weitergeben an neue Spieler.

## 3.14 Spielerkommunikation / What’s-new-Quelle
- Datei: Adolar_Songster_Spielerkommunikation_Whatsnew_Quelle_v1_20260826.md
- Inhalt: Lieferstatus, Nutzerverhalten, sechsstufige Spielphasenmatrix,
  Admin-Konfiguration für Textchat/Wortfilter/Reaktionen, REST-/Socket-Verträge,
  Datenschutz, Tests, Restrisiken und freigegebener Kerntext für Lobby-/Tischchat
  und Playboard-Schnellreaktionen.
- Verwendung: Verbindliche Quelle für Review, Deployment und spätere
  What’s-new-Erstellung. Abschnitt 1 trennt ausdrücklich „implementiert auf
  Feature-Branch“ von „gemergt/deployed“.

## 4. Bildmaterial
- songster_home.png
- songster_playboard.png

Verwendung:
- Visuelle Referenz fuer Layout und Interaktionsfuehrung.
- Grundlage fuer UI-Abgleich im Sprint 6.

## 5. Verbindliche Projektregeln (Kurzfassung)
1. Privatbetrieb fuer kleine Gruppen, kein zentraler Massendienst.
2. Einladungstoken verpflichtend fuer Registrierung.
3. Musiklizenz-Verantwortung liegt beim Betreiber.
4. Branding (Schrift/Farben/Assets) aus adolar-brand-images soweit moeglich uebernehmen.
5. Nach MVP: Ausbauphase mit lokalem Ordner-Scan.

## 6. Abnahme-Startpunkt
Fuer die formale Abnahme immer mit folgendem Dokument beginnen:
- Adolar_Songster_Pflichtenheft_v1_20260821.md

Danach pruefen:
1. AK-001 bis AK-014 vollstaendig erfuellt
2. Setup in 3 Schritten auf neuem System durchfuehrbar
3. Branding und UI-Leitbild sichtbar umgesetzt

## 7. Aenderungsprotokoll
- v1.0: Initialer Masterindex erstellt.
- 2026-08-21: Adolar-Integrationskonzept ergaenzt (Abschnitt 3.11).
- 2026-08-21: Adolar-Integration Schritt 4 umgesetzt (Songster-seitiger
  Adolar-Client, Batch-Algorithmus, `sourcePlaylistId`-Integration in
  Tischerstellung/-start) - siehe Abschnitt 6 im Integrationskonzept-Dokument.
- 2026-08-24: Benutzerhandbuch (Abschnitt 3.12) ergaenzt - erste
  vollstaendige Nutzersicht-Dokumentation, generiert nach Release
  v0.2.0-beta.
- 2026-08-25: Hostmodus-Anleitung fuer Einsteiger ergaenzt (Abschnitt
  3.13) - fertige Endnutzer-Anleitung zum Hostmodus-Feature.
- 2026-08-26: Spielerkommunikations-/What’s-new-Quelle ergänzt (Abschnitt
  3.14) - Lobby-/Tischchat und phasenabhängige Playboard-Reaktionen auf
  `codex/feature-player-communication` dokumentiert; Merge/Deployment offen.
- 2026-08-26: Adminbereich „Chateinstellungen“, serverseitige
  Emoticon-/Wortfilterlogik und frei belegbare Reaktionen für sechs Spielzustände
  in Abschnitt 3.14 nachdokumentiert.
