# Adolar Songster - Fire-TV Host-App MVP

Version: 1.0
Stand: 2026-08-31

## Ziel

Die Host-App ist ein reines Anzeigegerät für den Hostmodus. Sie hat keine
Spielerfunktionen und keinen normalen Login. Ein eingeloggter Songster-Nutzer
autorisiert die laufende App-Instanz temporär und kann sie danach beim Anlegen
eines privaten Tischs als Hostdisplay auswählen.

## WebView-Route

Der MVP stellt die TV-taugliche Web-Oberfläche unter `/host-app` bereit. Eine
sideloadbare Android-/Fire-TV-App muss im ersten Schritt nur eine Fullscreen
WebView öffnen, diese Route laden und die eingegebene Songster-URL lokal
speichern.

## Ablauf

1. Host-App öffnet `/host-app`.
2. App fragt nach der Songster-URL.
3. Backend erzeugt ein Pairing über `POST /api/v1/host-devices/pairings`.
4. Host-App zeigt einen kurzen Code.
5. Ein eingeloggter Nutzer gibt den Code im Profil ein.
6. Backend bindet das Hostgerät an diesen Nutzer.
7. Host-App pollt weiter und wartet auf eine Tischzuweisung.
8. Im privaten Tischraum kann der Owner ein aktives Hostgerät auswählen.
9. Backend erzeugt einen gerätegebundenen Display-Token und sendet ihn an die
   Host-App.
10. Host-App rendert denselben Displaymodus wie `/display/:token`.

## Sicherheitsregeln

- Nur der autorisierte Nutzer sieht und nutzt seine Hostgeräte.
- Nur der Owner eines privaten Tischs darf ein Hostgerät an diesen Tisch setzen.
- Host-App-Display-Tokens enthalten eine `hostDeviceId`.
- Wird ein Hostgerät im Profil getrennt, werden seine Host-Sockets getrennt und
  der gerätegebundene Display-Token wird serverseitig abgelehnt.
- Schließt die App sauber, sendet sie ein `DELETE` an das Backend.
- Kommt kein Heartbeat mehr, entfernt das Profil das Gerät nach kurzer
  Inaktivität aus der aktiven Liste.

## Native Fire-TV-Schale

Für die APK genügt zunächst eine kleine Kotlin/Android-TV-App:

- Fullscreen Activity
- WebView mit JavaScript, DOM Storage und Audio erlaubt
- TV-D-Pad-Fokus aktiviert
- Wake Lock während aktiver Anzeige
- Start-URL: `/host-app`
- kein App-Store-Flow nötig, Build als signierte APK für Sideload

Die eigentliche Spiellogik bleibt vollständig in der Songster-Web-App.
