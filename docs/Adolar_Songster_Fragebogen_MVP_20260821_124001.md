# Adolar Songster - Fragebogen fuer die Umsetzung (Privatbetrieb)

## Zweck
Dieser Fragebogen hilft dir, alle offenen Entscheidungen strukturiert zu klaeren, bevor die Umsetzung startet.
Fokus: kleiner, privater Freundeskreis (kein zentraler Massendienst).

## Bereits festgelegt
- Betrieb als privates Self-Hosting fuer wenige Freunde.
- Zugang via Einladungstoken bleibt erhalten.
- Kein zentraler Betreiber fuer viele Gruppen.
- Lizenzhinweis: Wer das oeffentlich oder in groesserem Stil betreibt, ist selbst fuer Rechte, Lizenzen und rechtliche Pflichten verantwortlich.

---

## Arbeitsanleitung
1. Starte mit allen MUSS-Fragen.
2. Pro Frage genau eine Entscheidung eintragen.
3. Bei Zahlen immer einen konkreten Default-Wert festlegen.
4. Offene Punkte mit Termin und Verantwortlichem markieren.
5. Erst nach Abschluss aller MUSS-Punkte mit der Implementierung beginnen.

Antwortschema je Frage:
- Entscheidung:
- Default-Wert:
- Begruendung:
- Offen bis:
- Verantwortlich:

---

## A) MUSS (Blocker fuer MVP)

### A1 Zugriff und Einladungen
1. Wer darf Einladungstoken erzeugen?
2. Verfallen Tokens automatisch? (nie / nach X Tagen / einmalig)
3. Duerfen Tokens manuell deaktiviert werden?
4. Braucht ihr eine Sperrliste fuer Nutzer?

### A2 Tischregeln
5. Maximale aktive Spieler pro Tisch? (aktuell 5 inkl. Tischadmin)
6. Duerfen Zuschauer beitreten? (nie / public / public+private)
7. Maximalzahl Zuschauer pro Tisch?
8. Was passiert, wenn der Tischadmin den Tisch verlaesst?

### A3 Rundenlogik
9. Songdauer pro Runde (15-45s): fester Wert oder Bereich?
10. Countdown vor Songstart: wie viele Sekunden?
11. Finale Formel fuer die Start-Jahrspanne festlegen.
12. Anzahl Start-Jahresbloecke pro Spieler (min/max oder fix).
13. Wann gilt eine Einsortierung als korrekt?
14. Duerfen Spieler waehrend laufendem Song mehrfach umplatzieren?
15. Wie werden Songs mit identischem Jahr behandelt?

### A4 Token-Mechanik
16. Startanzahl Tokens pro Spieler.
17. Wird ein Token immer verbraucht (auch bei Abbruch/Nicht-Bestaetigung)?
18. Zeitfenster fuer Solo-Exaktjahr nach Token (Sekunden).
19. Zeitfenster fuer Gegenspieler nach falschem Solo-Guess (Sekunden).
20. Tie-Break bei nahezu gleichzeitigem Token-Klick (Serverzeit, Zufall, Replay)?

### A5 Sieg, Punkte, Karma
21. Siegbedingung: 10 korrekte Karten beibehalten?
22. Bonusrunde bei Gleichstand aktiv?
23. Highscore-Formel final.
24. Karma-Regeln final (vollstaendig gespielt / vorzeitig verlassen / Disconnect).
25. Rejoin-Regel bei technischem Disconnect (Kulanzzeit in Sekunden).

### A6 Musikdaten und Verlaesslichkeit
26. Welche Songdaten liefert der Adolar-Server garantiert? (Titel, Jahr, Dauer, Stream-ID)
27. Verhalten bei fehlendem/ungueltigem Songjahr.
28. Verhalten bei Streamfehlern/Timeouts waehrend Runde.

### A7 Setup-Minimum fuer Nicht-Techniker
29. Ziel-Installationsweg festlegen (Docker Compose empfohlen).
30. In wie vielen Schritten soll ein Host starten koennen? (Ziel <= 3 Schritte)
31. Braucht ihr einen Browser-Einrichtungsassistenten? (ja/nein)
32. Braucht ihr einen eingebauten Funktionstest nach Setup? (ja/nein)

---

## B) SOLL (stark empfohlen kurz nach MVP)

1. Public-Lobby-Sichtbarkeit und Filter (z. B. nur offene Tische).
2. Zuschaueranzeige im Tisch (Anzahl + Namensliste ja/nein).
3. Match-Historie pro Spieler (letzte X Spiele).
4. Export/Backup der Datenbank (einfacher Button oder Script).
5. Basis-Monitoring (Healthcheck + Fehlerlog + Neustart-Hinweis).
6. Admin-Seite fuer Invite-Management und Tischuebersicht.

---

## C) KANN (spaeter)

1. Alternative Spielmodi (z. B. Teammodus).
2. Erweiterte Statistik (Trefferquote pro Jahrzehnt).
3. Theming/Branding-Optionen.
4. Replay-Ansicht abgeschlossener Runden.

---

## D) Rechtlicher Hinweistext (fuer UI/README)

Empfohlener Text:
"Diese Software ist fuer den privaten Betrieb in kleinen Gruppen gedacht. Betreiber sind selbst dafuer verantwortlich, dass fuer verwendete Musik alle noetigen Rechte und Lizenzen vorliegen. Bei oeffentlichem oder kommerziellem Betrieb gelten zusaetzliche rechtliche Anforderungen."

Entscheidung:
- Soll dieser Hinweis bei Erstsetup aktiv bestaetigt werden? (ja/nein)

---

## E) Entscheidungsprotokoll (Ausfuellmatrix)

| ID | Thema | Entscheidung | Default-Wert | Offen bis | Verantwortlich | Status |
|---|---|---|---|---|---|---|
| A1-1 | Invite-Erzeuger |  |  |  |  | offen |
| A2-5 | Max Spieler |  |  |  |  | offen |
| A3-11 | Jahrspanne Formel |  |  |  |  | offen |
| A4-20 | Token Tie-Break |  |  |  |  | offen |
| A5-24 | Karma-Regeln |  |  |  |  | offen |
| A6-27 | Fehlendes Songjahr |  |  |  |  | offen |
| A7-29 | Installationsweg |  |  |  |  | offen |

(Hinweis: Zeilen erweitern bis alle MUSS-Punkte erfasst sind.)

---

## F) Definition of Ready (Umsetzung darf starten, wenn alle Punkte erfuellt)

- Alle MUSS-Fragen sind entschieden und dokumentiert.
- Keine Widersprueche zwischen Regeln, Punkte/Karma und Token-Logik.
- Setup-Pfad ist testweise von einer zweiten Person erfolgreich durchgelaufen.
- Lizenzhinweis ist sichtbar dokumentiert (README und/oder UI).
- Mindestens ein Testspiel Ende-zu-Ende erfolgreich absolviert.
