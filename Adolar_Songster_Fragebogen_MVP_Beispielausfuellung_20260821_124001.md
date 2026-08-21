# Adolar Songster - Fragebogen (Beispielausfuellung fuer privaten Freundeskreis)

## Hinweis
Diese Datei enthaelt Vorschlagswerte fuer einen typischen Betrieb mit Freunden.
Alle Angaben sind Defaults und koennen angepasst werden.

## Rahmen
- Privat gehostet fuer kleine Gruppe.
- Einladungstoken als Zugangsschutz.
- Kein zentraler Plattformbetrieb.
- Lizenzverantwortung liegt beim jeweiligen Betreiber.

---

## A) MUSS - Beispielentscheidungen

### A1 Zugriff und Einladungen
1. Wer darf Einladungstoken erzeugen?
- Entscheidung: Nur Admin und vom Admin freigeschaltete Nutzer.
- Default-Wert: max. 5 aktive Tokens pro Nutzer.
- Begruendung: Missbrauchsschutz bei gleichzeitig einfacher Einladung.
- Status: fest

2. Verfallen Tokens automatisch?
- Entscheidung: Ja.
- Default-Wert: 14 Tage oder nach einmaliger Nutzung.
- Begruendung: Alte Links verlieren Risiko.
- Status: fest

3. Duerfen Tokens manuell deaktiviert werden?
- Entscheidung: Ja.
- Default-Wert: sofort ungueltig.
- Begruendung: Schnelle Reaktion bei Fehlversand.
- Status: fest

4. Sperrliste fuer Nutzer?
- Entscheidung: Ja (minimal).
- Default-Wert: Nutzer kann nicht einloggen und nicht neu registrieren (E-Mail-Block).
- Begruendung: Basis-Moderation ausreichend.
- Status: fest

### A2 Tischregeln
5. Maximale aktive Spieler pro Tisch?
- Entscheidung: 5 inklusive Tischadmin.
- Default-Wert: 1 Admin + 4 Spieler.
- Begruendung: Uebersichtlich und fair bei Realtime.
- Status: fest

6. Zuschauer erlaubt?
- Entscheidung: Ja, optional pro Tisch.
- Default-Wert: Public und Private, vom Tischadmin schaltbar.
- Begruendung: Flexibel fuer Spielabende.
- Status: fest

7. Maximalzahl Zuschauer pro Tisch?
- Entscheidung: Begrenzt.
- Default-Wert: 10.
- Begruendung: Vermeidet unnoetige Last.
- Status: fest

8. Tischadmin verlaesst Tisch - was passiert?
- Entscheidung: Adminrolle geht an laengst anwesenden aktiven Spieler.
- Default-Wert: 60 Sekunden Reconnect-Fenster, danach Uebergabe.
- Begruendung: Spiel muss weiterlaufen.
- Status: fest

### A3 Rundenlogik
9. Songdauer pro Runde?
- Entscheidung: Fester Wert.
- Default-Wert: 25 Sekunden.
- Begruendung: Gleichmaessige Rundenlaenge.
- Status: fest

10. Countdown vor Songstart?
- Entscheidung: Ja.
- Default-Wert: 3 Sekunden.
- Begruendung: Erwartbares Timing.
- Status: fest

11. Finale Formel fuer Start-Jahrspanne?
- Entscheidung: Untergrenze = minSongYear - 10, Obergrenze = max(maxSongYear + 10, aktuelles Jahr).
- Default-Wert: so wie oben.
- Begruendung: Robust bei alten und neuen Playlists.
- Status: fest

12. Anzahl Start-Jahresbloecke pro Spieler?
- Entscheidung: Fix.
- Default-Wert: 2.
- Begruendung: Schnell rein, nicht ueberladen.
- Status: fest

13. Wann ist Einsortierung korrekt?
- Entscheidung: Relative Position zwischen Nachbarkarten muss stimmen.
- Default-Wert: Bei Gleichjahr ist gleiche Region erlaubt.
- Begruendung: Spielprinzip bleibt intuitiv.
- Status: fest

14. Mehrfach umplatzieren waehrend Song erlaubt?
- Entscheidung: Ja.
- Default-Wert: Bis Countdown-Ende, danach Lock.
- Begruendung: Erhoeht Spielspass und Dynamik.
- Status: fest

15. Songs mit identischem Jahr?
- Entscheidung: Duplikate erlaubt.
- Default-Wert: Karte gilt als korrekt, wenn in gueltigem Gleichjahresbereich.
- Begruendung: Realistisch bei Musikdaten.
- Status: fest

### A4 Token-Mechanik
16. Startanzahl Tokens pro Spieler?
- Entscheidung: Ja.
- Default-Wert: 2 pro Spiel.
- Begruendung: Spannungsbogen ohne Spam.
- Status: fest

17. Token immer verbrauchen?
- Entscheidung: Ja.
- Default-Wert: auch bei Nicht-Bestaetigung.
- Begruendung: Klar und manipulationsarm.
- Status: fest

18. Solo-Exaktjahr-Zeitfenster?
- Entscheidung: Ja.
- Default-Wert: 10 Sekunden.
- Begruendung: passend zum Konzept.
- Status: fest

19. Gegenspieler-Zeitfenster nach falschem Solo-Guess?
- Entscheidung: Ja.
- Default-Wert: 10 Sekunden.
- Begruendung: fairer Ausgleich.
- Status: fest

19b. Vorteil fuer Gegenspieler nach falschem Solo-Guess?
- Entscheidung: Ja.
- Default-Wert: Anzeige des falsch geratenen Jahres.
- Begruendung: Token-Spam-Schutz.
- Status: fest.

20. Tie-Break bei gleichzeitigen Token-Klicks?
- Entscheidung: Serverzeit gewinnt.
- Default-Wert: 50ms Toleranz, bei Gleichstand Zufall.
- Begruendung: technisch eindeutig.
- Status: fest

### A5 Sieg, Punkte, Karma
21. Siegbedingung 10 korrekte Karten?
- Entscheidung: Ja.
- Default-Wert: 10.
- Begruendung: etablierter Spielrhythmus.
- Status: fest

22. Bonusrunde bei Gleichstand?
- Entscheidung: Ja.
- Default-Wert: ein Stichsong, schnellste korrekte Exaktjahreingabe gewinnt.
- Begruendung: eindeutiges Matchende.
- Status: fest

23. Highscore-Formel?
- Entscheidung: beibehalten.
- Default-Wert: 1 Siegpunkt + 1 pro Gegner.
- Begruendung: belohnt groessere Tische.
- Status: fest

24. Karma-Regeln?
- Entscheidung: beibehalten mit Disconnect-Kulanz.
- Default-Wert: +5 komplett, -5 bei vorzeitigem Leave, zusaetzlich -1 pro weiterem Spieler.
- Begruendung: motiviert zum Durchspielen.
- Status: fest

25. Rejoin bei technischem Disconnect?
- Entscheidung: Ja.
- Default-Wert: 90 Sekunden Rejoin ohne Karma-Malus.
- Begruendung: faire Behandlung bei WLAN-Problemen.
- Status: fest

### A6 Musikdaten und Verlaesslichkeit
26. Garantierte Songdaten?
- Entscheidung: Pflichtfelder definieren.
- Default-Wert: Song-ID, Titel, Jahr, Stream-Quelle, Dauer.
- Begruendung: ohne Jahr keine Wertung.
- Status: fest

27. Fehlendes Songjahr?
- Entscheidung: Song ueberspringen.
- Default-Wert: naechster Zufallssong + Logeintrag.
- Begruendung: verhindert unfaire Runden.
- Status: fest

28. Streamfehler/Timeout waehrend Runde?
- Entscheidung: Runde abort + Replay mit neuem Song.
- Default-Wert: max. 1 Auto-Retry, danach Fehlermeldung.
- Begruendung: klare Fehlerbehandlung.
- Status: fest

### A7 Setup fuer Nicht-Techniker
29. Installationsweg?
- Entscheidung: Docker Compose.
- Default-Wert: ein Ordner, ein compose, ein start script.
- Begruendung: niedrigste Einstiegshuerde.
- Status: fest

30. Zielschritte fuer Start?
- Entscheidung: 3 Schritte.
- Default-Wert: .env fuellen, compose up, Browser-Wizard.
- Begruendung: realistisch fuer Freunde.
- Status: fest

31. Browser-Einrichtungsassistent?
- Entscheidung: Ja.
- Default-Wert: Admin anlegen, ersten Invite erzeugen, Testtisch starten.
- Begruendung: weniger Doku-Aufwand.
- Status: fest

32. Eingebauter Funktionstest nach Setup?
- Entscheidung: Ja.
- Default-Wert: Healthcheck + Testsong + Simulationsrunde.
- Begruendung: schneller Go/No-Go.
- Status: fest

---

## B) SOLL - Beispielentscheidungen
1. Public-Lobby-Filter: nur offene Tische anzeigen.
2. Zuschaueranzeige: Anzahl sichtbar, Namen optional.
3. Match-Historie: letzte 20 Spiele pro Nutzer.
4. Backup: taegliches JSON/DB-Backup per Script.
5. Monitoring: Healthcheck-Endpunkt und rotierende Logs.
6. Admin-Seite: Invite-Management und laufende Tische.

---

## C) KANN - Beispielideen
1. Teammodus 2v2.
2. Statistik je Jahrzehnt.
3. Custom Themes.
4. Replay vergangener Runden.

---

## D) Rechtlicher Hinweistext (Vorschlag)
"Diese Software ist fuer den privaten Betrieb in kleinen Gruppen gedacht. Betreiber sind selbst dafuer verantwortlich, dass fuer verwendete Musik alle noetigen Rechte und Lizenzen vorliegen. Bei oeffentlichem oder kommerziellem Betrieb gelten zusaetzliche rechtliche Anforderungen."

- Entscheidungsvorschlag: Hinweis bei Erstsetup aktiv bestaetigen = Ja.

---

## E) Schnell-Check vor Implementierung
- [ ] Alle MUSS-Punkte bestaetigt oder angepasst
- [ ] Keine widerspruechlichen Regeln
- [ ] Setup von zweiter Person testweise durchlaufbar
- [ ] Lizenzhinweis in README und Setup sichtbar
- [ ] Ein komplettes Testspiel Ende-zu-Ende erfolgreich

---

## F) Naechste Ausbaustufe nach MVP (fest)

### F1 Prioritaet nach erfolgreicher Adolar-Integration
1. Lokale Musikordner konfigurierbar machen und automatisch scannen.
2. Gefundene Songs mit Metadaten (mindestens Titel, Jahr, Dateipfad) in die Songquelle aufnehmen.
3. Songauswahl im Spiel optional zwischen Adolar-Quelle und lokalem Katalog umschaltbar machen.

Status:
- Entscheidung: fest
- Reihenfolge: nach stabilem MVP-Betrieb mit Adolar

### F2 Technische Leitplanken fuer lokalen Ordner-Scan
1. Unterstuetzte Formate fuer MVP+1 festlegen (Vorschlag: mp3, m4a, flac).
2. Scan-Modus festlegen: manuell per Button und optional periodisch (z. B. alle 6h).
3. Duplikat-Regel: gleicher Dateihash oder gleicher Pfad wird nicht doppelt importiert.
4. Fehler-Regel: Dateien ohne gueltiges Jahr werden als unvollstaendig markiert und nicht fuer Wertungsrunden genutzt.
5. Sicherheit: nur freigegebene Basisordner scannen, keine beliebigen absoluten Pfade durch Spieler.

### F3 UI-Leitbild aus Playboard-Skizze (Arbeitsbasis)
1. Spielerzeilen links mit Namen, mittig Zeitkarten, rechts Eingabefeld mit zwei Aktionen: Gruen = bestaetigen (mit Haken-Symbol), Rot = Feldinhalt loeschen (mit X-Symbol).
2. Zentrale Steuerflaeche unten mit Start/Fragezeichen und sichtbarem Countdown-Block.
3. Songster-Tokens unten links als klar erkennbare, schnell klickbare Aktionsbuttons.
4. Fokus auf hohe Lesbarkeit und schnelle Interaktion waehrend des Song-Countdowns.

### F5 Branding-Vorgabe aus adolar-brand-images (fest)
1. Schriftart fuer UI und Brand-Naehe soweit moeglich aus dem Brand-Repo verwenden.
2. Bevorzugte Font-Family laut Repository: Orbitron mit Fallbacks.
3. Farbwerte und Akzentfarben aus den Brand-Assets uebernehmen (insbesondere Palette-Dateien).
4. Logos und Raketen-Assets nur aus der offiziellen Brand-Quelle nutzen.

Verbindliche Quellen:
- https://github.com/noyse27/adolar-brand-images
- docs/styleguide.md
- palette/colors.svg
- web/adolar-rocket.css
- logo/adolar-logo.svg
- logo/adolar-logo-dark.svg

Default fuer Umsetzung:
- Font-Stack: "Orbitron", "Orbitron Medium", "Orbitron Regular", "Segoe UI", sans-serif
- Wenn konkrete Hex-Werte im UI gebraucht werden, immer aus palette/colors.svg oder styleguide ableiten.
- Status: fest

### F4 Offene Punkte fuer Ausbaustufe (spaeter beantworten)
1. Welche Metadatenquelle hat Vorrang bei Konflikten: ID3-Tag oder Dateiname?
2. Duerfen lokale Songs ohne Album-Cover angezeigt werden?
3. Wie wird mit variabler Lautstaerke lokaler Dateien umgegangen (Normalisierung ja/nein)?
4. Soll der lokale Scan nur durch Admin ausloesbar sein?
