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

Persistierung: neuer Eintrag in der bestehenden Settings-/Config-Tabelle
(Adolar-Recherche noch offen: exakter Mechanismus fuer globale Booleans in
Adolar; vermutlich analog zu bestehenden Feature-Flags dort).

### 3.2 Datenmodell-Erweiterung `radio_stations`

Neue Spalte, nach dem etablierten Muster (`jingle_enabled` wurde seinerzeit
per ALTER TABLE ergaenzt, db.py:513):

```sql
ALTER TABLE radio_stations ADD COLUMN songster_enabled INTEGER NOT NULL DEFAULT 0;
```

`songster_enabled = 1` markiert einen Sender als fuer Songster freigegeben.
Kein neuer scope-Wert, keine Ueberladung der bestehenden Sichtbarkeitsachse.

Sichtbarkeitsregeln (neu zu ergaenzen an den bestehenden Stellen):
- `list_radio_stations()` (normale Radio-/Disco-Ansicht): weiterhin wie
  bisher, zusaetzlich implizit ohne Aenderung - Songster-Sender sind normale
  Sender und wuerden dort weiter auftauchen, AUSSER sie werden explizit
  ausgeblendet. Offene Entscheidung (siehe Abschnitt 5): sollen
  songster_enabled-Sender in der normalen Radio-Liste unsichtbar sein, oder
  duerfen sie dort parallel auch normal genutzt werden? Nutzeraussage "sollen
  nicht im Adolar oder Adolar Radio zur Verfuegung stehen" spricht fuer
  Ausblenden - Vorschlag: `list_radio_stations()` bekommt einen Parameter/
  WHERE-Zusatz `AND songster_enabled = 0`, der neue Songster-Endpoint
  (3.4) fragt umgekehrt `WHERE songster_enabled = 1`.

### 3.3 Songster-Playlist-Verwaltung (UI)

Neuer Dialog "Songster Playlists", erreichbar ueber den neuen Menüeintrag.
Wiederverwendung der bestehenden Radio-Sender-Editor-Komponenten
(Regel-Builder "Normale Regeln"/"Smarte Eingabe", ALLES/EINES-DER-FOLGENDEN-
Gruppen) - keine neue Filter-UI.

Abweichungen vom bestehenden Radio-Sender-Dialog:
- Leerer Dialog beim ersten Aufruf (keine vorbefuellten Eintraege wie
  Adolar Radio/Adolar4U - das waren nur Beispiele in der Konzeptphase). Nur
  "+ Neue Playlist erstellen" und "Schliessen".
- Liste zeigt ausschliesslich Sender mit `songster_enabled = 1` ODER neu
  erstellte (noch nicht freigeschaltete) Songster-Kandidaten - zu klaeren,
  ob "neu erstellen" direkt freischaltet oder ein Zwischenzustand existiert
  (siehe 5).
- Je Zeile: Play-Icon wird zum Freischalt-Button (toggelt
  `songster_enabled`), Zahnrad bleibt Bearbeiten, Papierkorb bleibt Loeschen.
  Kein separates Checkbox-Element.
- Jingle-bezogene Elemente komplett entfernt: kein Jingle-Indikator-Icon in
  der Zeile, keine Jingle-Felder im Erstellen/Bearbeiten-Dialog
  (jingle_path/jingle_every_tracks/jingle_enabled werden fuer
  Songster-Sender schlicht nicht gesetzt/angezeigt).
- Scope-Auswahl (Global/Privat) im Erstellen-Dialog entfernt - neu erstellte
  Songster-Sender sind immer `scope='global'` (fuer alle Adolar-Admins
  sichtbar/verwaltbar) und zusaetzlich `songster_enabled` (Default je nach
  Klaerung 5).

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
```

## 4. Aenderungen in Songster

### 4.1 Verbindungsaufbau

Neue Backend-Konfiguration (ENV): `ADOLAR_BASE_URL`, `ADOLAR_CLIENT_VERSION`
(= package.json-Version). Login gegen `/api/songster/login` beim Start bzw.
bei Bedarf, Token serverseitig cachen/erneuern.

### 4.2 Playlist-Auswahl bei Tischerstellung

`POST /tables` bekommt ein optionales Feld `sourcePlaylistId` (Adolar-
Sender-ID). Ohne Angabe: Fallback auf lokal per Admin gepflegte Songs
(`/admin/songs`, wie bisher) - erlaubt schrittweise Migration, bricht nichts
Bestehendes.

### 4.3 Batch-Lademechanismus (50er-Fenster)

Bei Tischsession-Start (sobald `sourcePlaylistId` gesetzt ist):
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

## 5. Offene Punkte (vor Umsetzung zu klaeren)

1. Sollen `songster_enabled=1`-Sender in der normalen Radio-Senderliste
   (Adolar Web/Radio/Disco) komplett verschwinden, oder dort weiter parallel
   nutzbar bleiben (nur zusaetzlich fuer Songster freigegeben)?
2. Gibt es einen Zwischenzustand "Songster-Sender erstellt, aber noch nicht
   freigeschaltet" (songster_enabled=0 direkt nach Erstellung, muss explizit
   ueber den Freischalt-Button aktiviert werden), oder wird beim Erstellen
   ueber den Songster-Dialog sofort songster_enabled=1 gesetzt?
3. Persistenzmechanismus fuer globale Boolean-Einstellungen in Adolar
   (welche Tabelle/welches Muster) - noch nicht recherchiert.
4. Rate-Limits/Quoten fuer den neuen `/api/songster/*`-Client analog zu
   bestehenden Clients?

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
