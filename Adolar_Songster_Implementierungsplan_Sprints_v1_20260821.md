# Adolar Songster - Implementierungsplan (Sprints)

Version: 1.0
Stand: 2026-08-21

## 1. Planungsannahmen
- Teamgroesse: 1-3 Entwickler
- Fokus: MVP zuerst, Phase 2 vorbereitet
- Sprintlaenge: 1 Woche

## 2. Sprint 0 - Setup und Architekturgrundlage
Ziele:
1. Repo-Struktur anlegen (frontend, backend, infra, docs)
2. Docker Compose Grundsetup
3. DB-Migration-Framework
4. Auth-Grundgeruest
5. GitHub Actions CI mit Quality Gates ab Tag 1

Lieferobjekte:
- startbares Compose-Setup
- CI-Basischeck (lint/test)
- Initialschema fuer User, Invites, Tables
- CI-Workflow mit Lint, Unit, Build, Security-Scan
- Branch-Protection-Empfehlung (Merge nur bei gruenen Checks)

Akzeptanz:
- frisches System startet lokal mit einem Befehl
- Health-Endpunkt verfuegbar
- Pull Request ohne gruene CI-Checks kann nicht freigegeben werden

## 3. Sprint 1 - Auth, Invite, Lobby
Ziele:
1. Registrierung mit Invite-Validierung
2. Login, Session-Handling
3. Invite erzeugen/deaktivieren/ablaufen
4. Lobbyliste und Tischerstellung

Akzeptanz:
- Registrierung ohne Invite abgelehnt
- Invite-Ablauf und Deaktivierung funktionieren
- Public-Tische sichtbar

## 4. Sprint 2 - Tischregeln und Spielstart
Ziele:
1. Join/Leave fuer Spieler und Zuschauer
2. Kapazitaetsregeln (5 Spieler, 10 Zuschauer)
3. Admin-Handover mit 60s Rejoin-Fenster
4. Spielstartbedingungen

Akzeptanz:
- Voller Tisch blockiert weitere Spieler
- Admin-Uebergabe funktioniert reproduzierbar

## 5. Sprint 3 - Rundenkern
Ziele:
1. Countdown (3s) + Songstart (25s)
2. Guess-Inputs waehrend Songfenster
3. Guess-Lock nach Ende
4. Serverseitige Auswertung relativer Position

Akzeptanz:
- Runde laeuft deterministisch durch
- Korrekte/inkorrekte Kartenvergabe stimmt

## 6. Sprint 4 - Token-Mechanik
Ziele:
1. Token-Claim-Race
2. Solo-Exaktjahr (10s)
3. Gegenspielerfenster (10s) bei falschem Solo-Guess
4. Anzeige des falsch geratenen Jahres fuer Gegenspieler
5. Regressionstests fuer Token-Race und Song-Wiederholungsregeln

Akzeptanz:
- Token-Tie-Break nach Serverzeit + 50ms-Regel + Zufall
- Token wird immer verbraucht

## 7. Sprint 5 - Punkte, Karma, Abschlusslogik
Ziele:
1. Siegbedingung 10 Karten
2. Bonusrunde bei Gleichstand
3. Highscoreberechnung
4. Karma- und Rejoin-Regeln

Akzeptanz:
- FR-040 bis FR-045 aus Pflichtenheft voll abgedeckt

## 8. Sprint 6 - Setup-Wizard, Branding, Hardening
Ziele:
1. Browser-Wizard fuer Erstsetup
2. Self-Test nach Setup
3. Branding-Integration (Font/Farben/Logos)
4. Fehlerbehandlung Songdaten/Timeout
5. Security-Hardening und Stabilitaetsnachweis (Smoke + Regression + Scan)

Akzeptanz:
- 3-Schritte-Onboarding laeuft auf neuem System
- AK-001 bis AK-008 insgesamt bestanden
- AK-009 bis AK-014 insgesamt bestanden

## 9. Phase 2 - Lokaler Ordner-Scan
Reihenfolge:
1. Source-Abstraktion finalisieren
2. Scan-Service (manuell + optional periodisch)
3. Formate mp3/m4a/flac
4. Duplikaterkennung Hash/Pfad
5. Adminrechte fuer Scan

## 10. Risiken und Gegenmassnahmen
1. Song-Metadatenqualitaet schwankt
- Gegenmassnahme: harte Pflichtfelder + Skip-Logik

2. Realtime-Race-Conditions
- Gegenmassnahme: serverautoritative Zeit, idempotente Events

3. Setup-Huerden auf Fremdsystem
- Gegenmassnahme: Wizard + Self-Test + klare README
