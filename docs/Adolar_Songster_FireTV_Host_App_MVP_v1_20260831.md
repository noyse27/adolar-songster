# Adolar Songster - Browser-/Fire-TV-Host MVP

Version: 1.0
Stand: 2026-08-31

## Ziel

Der Host ist ein reines Anzeigegerät für den Hostmodus. Er kann als Browser-Tab
auf iPad/Tablet/Laptop oder über die sideloadbare Fire-TV/Android-WebView-App
laufen. Er hat keine Spielerfunktionen und keinen normalen Login. Ein
eingeloggter Songster-Nutzer autorisiert die laufende Host-Instanz temporär und
kann sie danach beim Anlegen eines privaten Tischs als Hostdisplay auswählen.

## Host-Routen

Der browserfreundliche Einstieg liegt unter `/host`. Die Android-/Fire-TV-App
lädt weiterhin `/host-app`; beide Routen verwenden denselben Hostmodus und
erzeugen sofort ein Pairing auf der aktuellen Songster-Instanz.

## Ablauf

1. Hostgerät öffnet `/host` im Browser oder `/host-app` in der Android-App.
2. Backend erzeugt ein Pairing über `POST /api/v1/host-devices/pairings`.
3. Hostgerät zeigt QR-Code und Kurzcode.
4. Ein Nutzer scannt den QR-Code. Falls nötig, meldet Songster ihn zuerst an
   und führt danach zur Bestätigungsseite zurück.
5. Der Nutzer bestätigt das Hostgerät.
6. Backend bindet das Hostgerät an diesen Nutzer.
7. Hostgerät pollt weiter und wartet auf eine Tischzuweisung.
8. Im privaten Tischraum kann der Owner ein aktives Hostgerät auswählen.
9. Backend erzeugt einen gerätegebundenen Display-Token und sendet ihn an die
   Host-App.
10. Hostgerät rendert denselben Displaymodus wie `/display/:token`.

## Sicherheitsregeln

- Nur der autorisierte Nutzer sieht und nutzt seine Hostgeräte.
- Nur der Owner eines privaten Tischs darf ein Hostgerät an diesen Tisch setzen.
- Host-App-Display-Tokens enthalten eine `hostDeviceId`.
- Wird ein Hostgerät im Profil getrennt, werden seine Host-Sockets getrennt und
  der gerätegebundene Display-Token wird serverseitig abgelehnt.
- Schließt die App oder der Browser-Host sauber, sendet er ein `DELETE` an das
  Backend.
- Kommt kein Heartbeat mehr, entfernt das Profil das Gerät nach kurzer
  Inaktivität aus der aktiven Liste.

## Native Fire-TV-Schale

Für die APK genügt zunächst eine kleine Android-TV-App:

- Fullscreen Activity
- WebView mit JavaScript, DOM Storage und Audio erlaubt
- TV-D-Pad-Fokus aktiviert
- Wake Lock während aktiver Anzeige
- Start-URL: `/host-app`
- kein App-Store-Flow nötig, Build als signierte APK für Sideload

Die eigentliche Spiellogik bleibt vollständig in der Songster-Web-App.
