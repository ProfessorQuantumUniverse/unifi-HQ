#!/bin/sh
# Lädt die kostenlosen DB-IP-Lite-Datenbanken (Stadt + ASN, CC BY 4.0) nach /geoip.
# Läuft im Container "geoip" (Alpine/BusyBox):
#   - bei jedem "docker compose up": nur wenn eine Datei fehlt oder älter als GEOIP_MAX_AGE_DAYS ist
#   - monatlich per "./lagezentrum.sh geoip" (erzwingt das Update)
set -eu
DIR=/geoip
MAX_AGE_DAYS="${GEOIP_MAX_AGE_DAYS:-32}"
BASE=https://download.db-ip.com/free
umask 022

fresh() {
  [ -s "$DIR/$1.mmdb" ] || return 1
  [ "$MAX_AGE_DAYS" -gt 0 ] || return 1
  [ -z "$(find "$DIR/$1.mmdb" -mtime +"$MAX_AGE_DAYS" 2>/dev/null)" ]
}

# aktueller und vorheriger Monat (DB-IP veröffentlicht am Monatsanfang)
this_month=$(date -u +%Y-%m)
y=$(date -u +%Y); m=$(date -u +%m); m=${m#0}
if [ "$m" -eq 1 ]; then prev="$((y - 1))-12"; else prev=$(printf '%d-%02d' "$y" $((m - 1))); fi

fetch() {
  name=$1
  if fresh "$name"; then echo "geoip: $name ist aktuell"; return 0; fi
  for month in "$this_month" "$prev"; do
    url="$BASE/$name-$month.mmdb.gz"
    if wget -q -T 60 -O "$DIR/.$name.gz" "$url" && gunzip -c "$DIR/.$name.gz" > "$DIR/.$name.tmp" && [ -s "$DIR/.$name.tmp" ]; then
      chmod 644 "$DIR/.$name.tmp"
      mv -f "$DIR/.$name.tmp" "$DIR/$name.mmdb"
      rm -f "$DIR/.$name.gz"
      echo "geoip: $name ($month) geladen"
      return 0
    fi
    rm -f "$DIR/.$name.gz" "$DIR/.$name.tmp"
  done
  if [ -s "$DIR/$name.mmdb" ]; then
    echo "geoip: WARNUNG – $name konnte nicht aktualisiert werden, nutze vorhandene Datei" >&2
    return 0
  fi
  echo "geoip: FEHLER – $name konnte nicht geladen werden (Internetzugang des LXC prüfen)" >&2
  return 1
}

fetch dbip-city-lite
fetch dbip-asn-lite
