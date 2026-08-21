# Adolar Songster - Integrationskonzept Adolar (Phase 2 Vorbereitung)

Version: 1.0
Stand: 2026-08-21
Status: Konzept, abgestimmt mit Produktverantwortlichem, noch nicht umgesetzt
Betrifft zwei Repos: F:\claude\musicapp (Adolar) und F:\claude\adolar-songster (Songster)

## 1. Zweck

Bevor Phase 2 (lokaler Ordner-Scan, siehe Pflichtenheft Abschnitt 11) begonnen
wird, muss Songster im "Adolar-Modus" vollstaendig funktionieren. Dafuer sind
Aenderungen auf Adolar-Seite noetig: eine eigene, kuratierte Songpool-Quelle
fuer Songster (mehrere waehlbare Playlisten, live-aktualisierend bei neuen
Compilations), eine Sichtbarkeitsabgrenzung gegenueber Adolar Web/Radio/Disco,
und eine Client-Identifikation beim Verbindungsaufbau. Auf Songster-Seite
kommt ein Batch-Lademechanismus fuer die Songpool-Befuellung hinzu.

## 2. Ausgangslage in Adolar (Rechercheergebnis)

- `playlists`-Tabelle (Typ smart/static) waere ein moeglicher Ansatz gewesen,
  hat aber einen Live-Update-Bug: `get_playlist_tracks()` (db.py:2298) wertet
  Smart-Filter nur fuer persoenliche Playlisten (`owner_id IS NOT NULL`) live
  aus; system-eigene (geteilte) Smart-Playlisten wuerden NICHT automatisch
  aktualisieren.
- `radio_stations`-Tabelle (db.py ~467-483) loest ihre Filter dagegen bei
  jedem Abruf live auf (`get_radio_filter_tracks()` -> `_radio_filter_sql()`,
  db.py:1500/1749) - keine Snapshot-Problematik. Filterbaum
  `{"mode":"all"|"any","rules":[...]}` mit Feldern title/artist/album/genre/
  year/decade/playcount/added, verschachtelbar bis Tiefe 4 - deckt
  "Querbeet" (leere Regeln), Genre-Gruppen ("Schwarze Musik" = HipHop ODER
  Soul ODER Funk ODER RnB via mode:"any") und Jahrzehnt-Filter ab.
- Entscheidung: Songster-Playlisten werden als `radio_stations`-Eintraege
  realisiert, nicht als `playlists`-Eintraege. Bestehende, bereits korrekt
  funktionierende Infrastruktur, kein neuer Playlist-Typ noetig.
- `scope` (global/private) ist eine 2-wertige Sichtbarkeitsachse fuer einen
  anderen Zweck (Sender oeffentlich vs. nutzereigen) und wird NICHT fuer die
  Songster-Abgrenzung wiederverwendet, um diese Semantik nicht zu
  ueberladen. Stattdessen: neue Spalte (siehe 3.2).

## 3. Aenderungen in Adolar

### 3.1 Einstellungen: "Songster aktivieren"

Neuer Schalter im Admin-Einstellungsdialog. Verhalten:
- Deaktiviert (Default): jeder Verbindungs-/Login-Versuch eines Clients mit
  `X-Adolar-Product: songster` wird abgelehnt (403). Der Menüeintrag
  "Songster" im User-Dropdown (rechts oben, neben Last.fm/Adolar4U/
  Einstellungen) ist nicht sichtbar.
- Aktiviert: Songster-Verbindungen werden akzeptiert, der Menüeintrag
  "Songster" erscheint im User-Dropdown.

Persistierung: `control.settings`-Tabelle (Key-Value, `db.py:173-176`,
Helfer `get_setting`/`set_setting`, `db.py:2003-2011`), Key
`songster_enabled` ("1"/"0", Default "0") - exakt das Muster, das bereits
fuer den Adolar4U-Global-Toggle verwendet wird (`adolar4u_enabled`,
`adolar/adolar4u/service.py:17-52`). Songster folgt diesem Vorbild 1:1:
- `adolar/songster/service.py`: `get_global_settings()` /
  `update_global_settings()`, analog `adolar4u/service.py`
- `GET/PUT /api/admin/songster/settings` (admin-only, audit-geloggt wie
  bei Adolar4U)
- `GET /api/songster/status` (fuer jeden eingeloggten Nutzer lesbar) liefert
  `{ enabled: bool }`, steuert clientseitig die Sichtbarkeit des
  Menüeintrags (`app.js`, analog `btn-adolar4u`-Handling bei Zeile 5112)
- Jede `/api/songster/*`-Route prueft `get_global_settings()["enabled"]`
  serverseitig (403 wenn deaktiviert) - Last.fm-Muster (rein clientseitig,
  kein globaler Schalter) ist hier NICHT das Vorbild, Adolar4U schon.

**Geklaert (Ruecksprache Produktverantwortlicher, 2026-08-21):**
- Songster-Sender sind in der normalen Adolar-Radio-/Disco-Ansicht NICHT
  nutzbar (WHERE songster_enabled=0 in list_radio_stations() fuer diese
  Ansichten, siehe 3.2).
- Kein Auto-Freischalt-Zwischenzustand: `songster_enabled` ist bei jedem
  neu erstellten Sender immer 0, unabhaengig vom Erstellungsweg (auch ueber
  den neuen "Songster Playlists"-Dialog). Freischalten ist immer ein
  separater, expliziter Schritt ueber den Play-Button.

### 3.2 Datenmodell-Erweiterung `radio_stations`

Neue Spalte, nach dem etablierten Muster (`jingle_enabled` wurde seinerzeit
per ALTER TABLE ergaenzt, db.py:513):

```sql
ALTER TABLE radio_stations ADD COLUMN songster_enabled INTEGER NOT NULL DEFAULT 0;
```

`songster_enabled = 1` markiert einen Sender als fuer Songster freigegeben.
Kein neuer scope-Wert, keine Ueberladung der bestehenden Sichtbarkeitsachse.

Sichtbarkeitsregeln:
- **Geklaert**: Songster-Sender sind in der normalen Adolar-Ansicht
  (Web/Radio/Disco) nicht nutzbar. `list_radio_stations()` bekommt fuer
  diese Aufrufer einen WHERE-Zusatz `AND songster_enabled = 0`; der neue
  Songster-Endpoint (3.4) fragt umgekehrt `WHERE songster_enabled = 1`.

### 3.3 Songster-Playlist-Verwaltung (UI)

Neuer Dialog "Songster Playlists", erreichbar ueber den neuen Menüeintrag.
Wiederverwendung der bestehenden Radio-Sender-Editor-Komponenten
(Regel-Builder "Normale Regeln"/"Smarte Eingabe", ALLES/EINES-DER-FOLGENDEN-
Gruppen) - keine neue Filter-UI.

Abweichungen vom bestehenden Radio-Sender-Dialog:
- Leerer Dialog beim ersten Aufruf (keine vorbefuellten Eintraege wie
  Adolar Radio/Adolar4U - das waren nur Beispiele in der Konzeptphase). Nur
  "+ Neue Playlist erstellen" und "Schliessen".
- Liste zeigt alle Sender, die ueber diesen Dialog erstellt wurden
  (unabhaengig vom `songster_enabled`-Status - sonst waeren frisch
  angelegte, noch nicht freigeschaltete Sender nirgends sichtbar/
  editierbar). Abgrenzung von "normalen" Radio-Sendern erfolgt ueber ein
  Herkunfts-Flag oder eine eigene Sicht (Detail bei Umsetzung).
- **Geklaert**: kein Auto-Freischalt-Zwischenzustand. `songster_enabled`
  ist bei Erstellung immer 0. Freischalten ist immer ein separater,
  expliziter Klick auf den Freischalt-Button.
- Je Zeile: Play-Icon wird zum Freischalt-Button (toggelt
  `songster_enabled`), Zahnrad bleibt Bearbeiten, Papierkorb bleibt Loeschen.
  Kein separates Checkbox-Element.
- Jingle-bezogene Elemente komplett entfernt: kein Jingle-Indikator-Icon in
  der Zeile, keine Jingle-Felder im Erstellen/Bearbeiten-Dialog
  (jingle_path/jingle_every_tracks/jingle_enabled werden fuer
  Songster-Sender schlicht nicht gesetzt/angezeigt).
- Scope-Auswahl (Global/Privat) im Erstellen-Dialog entfernt - neu erstellte
  Songster-Sender sind immer `scope='global'` (fuer alle Adolar-Admins
  sichtbar/verwaltbar), `songster_enabled` startet bei 0.

### 3.4 Neue API fuer den Songster-Client

Separate Routen, bestehende `/api/playlists*`, `/api/radio/*` bleiben
unveraendert (kein Risiko fuer bestehende Clients):

```
POST /api/songster/login
- Analog zu /api/radio/login (auth.py:112), erfordert "Songster aktivieren"
- Request-Header: X-Adolar-Product: songster
- Request-Body ergaenzt um Client-Version, z. B. { "clientVersion": "0.1.0" }
  (neues Feld/Header, da aktuell keine Versions-Erfassung existiert -
  generisch nuetzliche Ergaenzung fuer alle Produkte, nicht songster-
  spezifisch; neue Spalte auf connection_log)
- Response 403 wenn "Songster aktivieren" deaktiviert ist

GET /api/songster/playlists
- Nur mit gueltiger Songster-Session
- Liefert alle Sender mit songster_enabled=1: { id, name, description }

GET /api/songster/playlists/{id}/tracks?page=1&per_page=50
- Wiederverwendung des bestehenden page/per_page-Musters aus /api/search
  (catalog.py:56, db.py:871-879), bislang nicht auf Playlisten/Sender
  angewendet
- Liefert schlanke Datensaetze: { id, title, artist, year, duration }
  (alles bereits native Spalten auf tracks, keine Schemaaenderung noetig)
- Filter wird bei jedem Aufruf live ausgewertet (siehe 2.) - neue
  Compilations erscheinen ohne Zusatzaufwand

GET /api/songster/playlists/{id}/status
- Prueft ob eine zuvor gewaehlte Playlist noch existiert und
  songster_enabled=1 ist (kann in der Zwischenzeit deaktiviert worden
  sein) - wird von Songster bei Tischerstellung aufgerufen (siehe 4.2)
```

**Geklaert (Rate-Limits, Schaetzung)**: Songster kontaktiert Adolar laut
Produktverantwortlichem NUR bei Tischerstellung (Playlist-Auswahl +
Verfuegbarkeitspruefung + Batch-Abruf), nicht laufend waehrend einer Partie
(siehe 4.1 - kein Dauerverbindungsmanagement). Bei 5-10 gleichzeitigen
Tischen ergibt sich im Worst Case (alle Tische fast zeitgleich erstellt) ein
kurzer Burst von grob 5 Requests je Tischerstellung (Status-Check + 3-4
Seiten Track-Abruf) = ca. 50 Requests in wenigen Sekunden. Empfehlung,
analog zum bereits in Songster etablierten Muster (apiLimiter/authLimiter,
Sprint 1):
- `/api/songster/*` generell: 60 Requests/Minute pro Songster-Client
- `/api/songster/login`: enger, 10 Requests/Minute (Login ist selten -
  nur bei Tischerstellung, kein Dauerbetrieb)

## 4. Aenderungen in Songster

### 4.1 Verbindungsaufbau

**Geklaert**: Songster kontaktiert Adolar ausschliesslich bei
Tischerstellung (Playlist-Auswahl inkl. Verfuegbarkeitspruefung, danach
Batch-Abruf) - keine Dauerverbindung, kein laufendes Token-Refresh waehrend
einer Partie. Vereinfacht die Umsetzung erheblich: kein Hintergrundprozess,
kein Session-Management ueber die Tischsession hinaus.

Neue Backend-Konfiguration (ENV): `ADOLAR_BASE_URL`, `ADOLAR_CLIENT_VERSION`
(= package.json-Version). Login gegen `/api/songster/login` bedarfsweise
(lazy, bei der ersten Playlist-Auswahl nach Songster-Start), Token
serverseitig kurzlebig cachen; kein periodisches Refresh noetig, da nur
punktuell genutzt.

### 4.2 Playlist-Auswahl bei Tischerstellung

`POST /tables` bekommt ein optionales Feld `sourcePlaylistId` (Adolar-
Sender-ID). Ablauf bei Angabe: `GET /api/songster/playlists/{id}/status`
pruefen (noch aktiv? siehe 3.4) - bei Nichtverfuegbarkeit klarer Fehler an
den Tischadmin statt spaeterem Fehlschlag beim Rundenstart. Ohne Angabe:
Fallback auf lokal per Admin gepflegte Songs (`/admin/songs`, wie bisher) -
erlaubt schrittweise Migration, bricht nichts Bestehendes.

### 4.3 Batch-Lademechanismus (50er-Fenster)

Bei Tischsession-Start (sobald `sourcePlaylistId` gesetzt und verfuegbar
ist):
1. Kandidaten von `GET /api/songster/playlists/{id}/tracks` seitenweise
   holen (page/per_page=50), bis genug Kandidaten fuer die Auswahl vorliegen
   (z. B. 3-4 Seiten als Rohmaterial, konfigurierbar).
2. Kandidaten nach `song_ref.last_played_at ASC NULLS FIRST` sortieren (neue
   Spalte auf song_ref, siehe 4.4) - das ist der Malus.
3. In Jahrzehnt-Buckets einteilen, Round-Robin ueber die Buckets: aus jedem
   Bucket den am laengsten nicht gespielten Song eines noch nicht
   verwendeten Interpreten waehlen, bis 50 erreicht oder Kandidaten
   erschoepft.
4. Ergebnis als `song_ref`-Zeilen fuer diese Tischsession anlegen/
   aktualisieren (`source='adolar'`, `source_song_id` = Adolar-Track-Id).

### 4.4 Malus / Wiederholungsvermeidung ueber Sessions hinweg

Neue Spalte `song_ref.last_played_at TIMESTAMPTZ`, aktualisiert bei jeder
tatsaechlichen Songauswahl in `selectSongForGame()` (songPool.ts). Rein
lokal in Songster gefuehrt, keine Kopplung an Adolars eigenen `play_count`
(der zaehlt alle Adolar-Wiedergaben, nicht songster-spezifisch).

### 4.5 Zusammenspiel mit bestehenden Partie-/Tischsessionregeln

Der 50er-Batch wird einmal pro Tischsession gezogen (fix, kein Nachladen
waehrend der Session) und bildet die "aktive Playlist" im Sinne von
Feinkonzept 4.3. Bestehende Regeln (kein Wiederholen innerhalb einer Partie;
Session-Reset erst nach vollstaendiger Ausschoepfung) greifen unveraendert
auf dieser kleineren Menge - Reset-Zyklen werden dadurch bewusst haeufiger,
was fuer einen Spieleabend angemessen ist.

## 5. Entscheidungen (Ruecksprache Produktverantwortlicher, 2026-08-21)

Alle vier zuvor offenen Punkte sind geklaert (Details jeweils inline in
Abschnitt 3/4 vermerkt):
1. Songster-Sender sind in Adolar Web/Radio/Disco nicht nutzbar (3.2).
2. Kein Auto-Freischalt-Zwischenzustand; immer manuelles Freischalten (3.1).
3. Persistenz ueber `control.settings` + Adolar4U-Muster (3.1).
4. Rate-Limit-Schaetzung: 60/min generell, 10/min fuer Login (3.4).

## 6. Vorgeschlagene Umsetzungsreihenfolge

1. Adolar: Migration (`songster_enabled`-Spalte, `connection_log`-
   Erweiterung um Client-Version), Settings-Flag "Songster aktivieren".
2. Adolar: `/api/songster/*`-Routen (Login, Playlist-Liste, paginierte
   Tracks), Sichtbarkeitsfilter in `list_radio_stations()`.
3. Adolar: UI - Menüeintrag, "Songster Playlists"-Dialog (Wiederverwendung
   Radio-Sender-Editor minus Jingle/Scope-Auswahl), Freischalt-Button.
4. Songster: Adolar-Client (Login, paginiertes Abrufen), Batch-Algorithmus
   (4.3), `song_ref.last_played_at`-Migration, Integration in
   Tischerstellung (`sourcePlaylistId`).
5. End-to-End-Test: Adolar-Sender anlegen, in Songster Tisch mit dieser
   Playlist erstellen, mehrere Partien/Neue-Partie-Laeufe spielen, Song-
   Wiederholungsregeln und Malus-Verhalten verifizieren.
