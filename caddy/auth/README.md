Früher legte `./lagezentrum.sh password` hier die Datei `basic_auth.caddy` ab (Browser-Passwortfenster).
Heute gibt es stattdessen einen Login mit eigener Seite; Passwort-Hash und Sitzungs-Schlüssel stehen in der `.env`.

Liegt hier noch eine alte `basic_auth.caddy`, gilt sie zusätzlich zum Login weiter.
`./lagezentrum.sh password` entfernt sie beim Setzen des Login-Passworts.
