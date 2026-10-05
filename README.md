# Lagezentrum

Live-Weltkarte für das Heimnetz: Jede Verbindung über den UniFi Cloud Gateway Max fliegt als
Bogen über einen 3D-Globus. Dazu Live-Ticker, 24-h-Statistik und eine durchsuchbare Historie.

- **Standardansicht:** erlaubte Verbindungen raus (cyan) und rein (grün)
- **Zuschaltbar:** abgewehrte Anklopfer aus dem Internet (rot) und Verkehr zwischen VLANs (lila)
- **Nur im LAN erreichbar**, ein einzelner LXC, rund 200–250 MB RAM im Betrieb

---

## Inhalt

1. [Aufbau](#aufbau)
2. [Proxmox: Storage](#1-proxmox-storage-für-die-spare-ssd)
3. [Installieren](#2-installieren)
4. [UniFi einrichten](#3-unifi-einrichten)
5. [Testen](#4-testen)
6. [Bedienung](#bedienung)
7. [Betrieb](#betrieb)
8. [Sicherheit](#sicherheit)
9. [Ressourcen](#ressourcen)
10. [Fehlersuche](#fehlersuche)
11. [Dateien](#dateien)

---

## Aufbau

```
UCG Max ──IPFIX  UDP 2055──▶ GoFlow2 ─┐  (Kindprozess von Vector, kein Docker-Socket)
UCG Max ──Syslog UDP 5514──▶ Vector ◀─┘
                               │  Richtung erkennen · Antworten zuordnen · GeoIP/ASN · Gerätenamen
                               ├──▶ VictoriaLogs   127.0.0.1:9428   Historie (90 Tage / 20 GiB)
                               └──▶ WebSocket      127.0.0.1:8090   Live-Stream
Browser ──HTTP 8080──▶ Caddy ──▶ Dashboard · /ws (live) · /select (Abfragen)   nur LAN
```

| Container | Aufgabe | RAM-Limit |
|---|---|---|
| `collector` | Vector 0.58 mit eingebautem GoFlow2 2.2.7 | 384 MB |
| `victorialogs` | Historie, stark komprimiert | 512 MB |
| `caddy` | Webserver, Zugriffsschutz | 64 MB |
| `geoip` | Einmal-Job: lädt DB-IP Lite, wenn nötig | 128 MB |

Alle Container laufen mit schreibgeschütztem Dateisystem, ohne Linux-Capabilities
(Caddy: nur `NET_BIND_SERVICE`) und mit `no-new-privileges`. Vector und GoFlow2 laufen als `nobody`.

**Wie die Richtung bestimmt wird:** NetFlow meldet jede Verbindung doppelt – Anfrage und
Antwort. Die Pipeline ordnet beide derselben Verbindung zu (`leg=req` / `leg=resp`). Live und in
den Zählern erscheint nur die Anfrage; die Antwort zählt beim Datenvolumen mit (sonst fehlen
alle Downloads). Über die WAN-Grenze gilt die lokale Seite als Client, außer ihr Port steht in
`LOCAL_SERVER_PORTS` (z. B. WireGuard 51820) oder ist ein klassischer Server-Port unter 1024.

---

## 1. Proxmox: Storage für die Spare-SSD

Einmalig, damit Logs nie auf der System-SSD landen:

1. Node → Disks: die Platte muss als ungenutzt gelistet sein (sonst *Wipe Disk* – löscht alles darauf).
2. Node → Disks → LVM-Thin → *Create: Thinpool*, Disk wählen, Name `ssd-logs`, *Add Storage* angehakt.

---

## 2. Installieren

### Variante A: alles automatisch (empfohlen)

Auf dem **Proxmox-Host** als root:

```bash
apt -y install git
git clone https://github.com/ProfessorQuantumUniverse/unifi-HQ.git /root/unifi-HQ
/root/unifi-HQ/proxmox/create-lxc.sh
```

Das Skript lädt das aktuelle Debian-Template, legt einen unprivilegierten LXC auf `ssd-logs` an
(2 Kerne, 1536 MB RAM als Obergrenze, 32 GB, `nesting` + `keyctl`, Start beim Booten), kopiert
das Projekt hinein und ruft dort `install.sh` auf. Am Ende stehen IP und alle Adressen da.
Platten fasst es nicht an.

Anpassen per Umgebungsvariablen, z. B. feste IP im VLAN 10 und Gateway-IP vorgeben:

```bash
IP=10.37.10.50/24 GW=10.37.10.1 VLAN=10 ALLOWED_SENDERS=10.37.10.1 HOME_LABEL=Frankfurt \
  /root/unifi-HQ/proxmox/create-lxc.sh
```

Weitere Optionen: `CTID`, `STORAGE`, `DISK`, `CORES`, `RAM`, `SWAP`, `BRIDGE`, `CT_HOSTNAME` – siehe Kopf des Skripts.

### Variante B: LXC selbst anlegen, dann installieren

1. *Create CT*: Debian 13, *Unprivileged* an, Disk auf `ssd-logs` (32 GB), 2 Kerne, 1536 MB RAM, 512 MB Swap.
2. Container → Options → Features → `nesting` und `keyctl` an, starten.
3. In der Konsole des Containers:

   ```bash
   apt update && apt -y install git
   git clone https://github.com/ProfessorQuantumUniverse/unifi-HQ.git /opt/lagezentrum
   /opt/lagezentrum/install.sh
   ```

`install.sh` installiert die nötigen Pakete und Docker, richtet alles ein, fragt ein paar Werte
ab (Vorschläge mit Enter übernehmen) und macht zum Schluss einen Selbsttest. Ist das Repo
öffentlich, geht es auch ohne Klonen:
`curl -fsSL https://raw.githubusercontent.com/ProfessorQuantumUniverse/unifi-HQ/main/install.sh | bash`.
Bei einem privaten Repo klonst du mit Token (`https://<token>@github.com/…`) – oder nimmst
Variante A, die das Projekt vom Host in den Container kopiert.

### Was das Setup abfragt bzw. anlegt

| Wert | Bedeutung |
|---|---|
| `WAN_IP` | öffentliche IPv4, wird automatisch ermittelt |
| `ALLOWED_SENDERS` | IP des Gateways, das NetFlow/Syslog schickt (Vorschlag: Default-Gateway des LXC) |
| `GATEWAY_NAME`, `HOME_LABEL`, `HOME_LAT`, `HOME_LON` | Name und Standort auf dem Globus |
| `LOCAL_EXTRA_NETS` | dein IPv6-Präfix, z. B. `2003:ab:cd00::/56` – sonst erscheinen eigene Geräte mit IPv6 als „Fremde“ |
| `LOCAL_SERVER_PORTS` | von außen erreichbare Ports (Portfreigaben, VPN-Server), Standard `51820` |

Alles landet in `.env` und lässt sich dort jederzeit ändern (danach `docker compose up -d`).
Gerätenamen trägst du in `config/hosts.csv` ein, eine Zeile pro Gerät: `10.37.10.3,homelable`
(danach `docker compose restart collector`). `setup` richtet außerdem das monatliche
GeoIP-Update per Cron ein. Erneut aufrufen ist gefahrlos: `./lagezentrum.sh setup`.

---

## 3. UniFi einrichten

### A. NetFlow (alle erlaubten Verbindungen)

Einstellungen → *Traffic Logging* (je nach Version unter *System* oder *CyberSecure*):

- **NetFlow (IPFIX)** an, Collector `<LXC-IP>`, Port `2055`, Version 10 (IPFIX)
- **Alle Netzwerke** auswählen, sonst fehlen VLANs
- Flow-Protokollierung: *Gesamter Datenverkehr*

### B. Syslog (für „Abgewehrt“)

Gleiche Seite, *Activity Logging / SIEM-Server*:

- Adresse `<LXC-IP>`, Port `5514`
- Bei den Inhalten mindestens die Sicherheits-Erkennungen anhaken

### C. Optionale Regel für die Anklopfer

Ohne diese Regel prallen Scanner stumm an der eingebauten Default-Regel ab und der rote Filter
bleibt leer. Die Regel ändert nichts am Verhalten der Firewall – sie blockt, was ohnehin
geblockt wird, und schreibt es ins Syslog. Policy Engine → Zone-Based Firewall → *Create Policy*:

| Feld | Wert |
|---|---|
| Name | `Anklopfer loggen` |
| Source Zone | External |
| Destination Zone | Gateway |
| Action | Block |
| Protocol | TCP |
| Connection State | nur *New* |
| Syslog Logging | an |

Optional dieselbe Regel noch einmal mit Destination Zone *Internal*. DHCP, IPv6 und WireGuard laufen
über UDP/ICMP, Antworten auf deine Verbindungen sind *Established* – die Regel kann nichts
kaputtmachen. Zurück mit einem Klick auf *Deaktivieren*.

Syslog-Logging nur auf **Block**-Regeln einschalten. Logs von Erlauben-Regeln werden zwar am
Regelnamen (`-A-`, „allow“, „accept“) erkannt und verworfen, sicherer ist es aber, sie gar nicht
erst zu schicken.

**Region Blocking (CN/RU):** Ob UniFi die Treffer der Region-Sperre selbst ins Syslog schreibt,
hängt von der Firmware ab. Tut es das nicht, greift die Sperre vor deiner Regel und CN/RU fehlen
bei den roten Bögen. Alles andere funktioniert trotzdem.

---

## 4. Testen

```bash
./lagezentrum.sh test
```

Schickt einen Test-Flow und eine Test-Syslog-Zeile durch die ganze Kette und prüft, ob sie in
der Historie landen (inkl. GeoIP). Danach:

1. `http://<LXC-IP>:8080/?demo` – Globus mit Beispieldaten, ganz ohne UniFi
2. `http://<LXC-IP>:8080` – oben links muss **Live** mit grünem Punkt stehen
3. Echte Flows brauchen nach dem Einschalten im UniFi etwa eine Minute (IPFIX-Templates).

---

## Bedienung

| | |
|---|---|
| **Filter-Chips** | Raus / Rein (an), Abgewehrt / Intern (aus), DNS (aus). Die Auswahl merkt sich der Browser. |
| **Ticker** | Klick zoomt zum Ort; Doppelklick öffnet den Verlauf dieser IP. |
| **Linke Spalte** | 24-h-Zähler mit Datenvolumen, Verbindungen pro Stunde, Top-Ziele, Länder, Geräte. Jeder Eintrag öffnet den passenden Verlauf. |
| **Verlauf** (Taste `/`) | Volltextsuche über IP, Gerät, Land, Stadt, Provider – oder direkt LogsQL. |
| **Punkte auf dem Globus** | Hotspots der letzten 15 Minuten; Klick öffnet den Verlauf des Landes. |

Beispiele für die Suche:

```
MacBook                              Wortsuche
r_country:CN                         ein Feld
dir:blocked dport:22                 mehrere Felder
r_org:"Google LLC" local_name:iPhone
dport:443 | stats by (local_name) sum(bytes) bytes     eigene Auswertung mit Pipes
```

Felder: `dir` (out/in/blocked/internal), `leg`, `proto`, `local_ip`, `local_name`, `remote_ip`,
`remote_name`, `sport`, `dport`, `bytes`, `packets`, `rule`, `r_country`, `r_country_name`,
`r_city`, `r_org`, `r_asn`. Für Profi-Auswertungen gibt es die VictoriaLogs-Oberfläche unter
`http://<LXC-IP>:8080/select/vmui/`.

URL-Optionen: `?demo` (Beispieldaten), `?lite` (für schwache Geräte wie einen Pi-Kiosk: ohne
Relief und Sternenhimmel, weniger Bögen).

---

## Betrieb

```bash
./lagezentrum.sh status      # Container, RAM, Plattenplatz, Ereignisse der letzten Stunde
./lagezentrum.sh update      # neue Images ziehen und neu starten
./lagezentrum.sh geoip       # GeoIP sofort aktualisieren (läuft sonst am 3. jedes Monats)
./lagezentrum.sh logs        # Logs verfolgen
```

- **Aufbewahrung:** `RETENTION` und `MAX_DISK` in der `.env` – was zuerst erreicht ist, gilt.
- **WAN-IP geändert:** `.env` anpassen, `docker compose up -d`. Bis dahin werden Flows ohne
  erkennbar lokale Seite trotzdem als „raus“ gewertet.
- **Versionen** sind festgenagelt (Vector 0.58.0, GoFlow2 v2.2.7, VictoriaLogs v1.53.0, Caddy 2.11).
  Hochziehen: Versionen in `docker-compose.yml` bzw. `collector/Dockerfile` ändern, dann `update`.
  Achtung: `netsampler/goflow2:latest` zeigt auf die alte Version 1.x mit anderem JSON-Format.
- **Backup:** Configs liegen im Git (`.env` und `config/hosts.csv` sind bewusst ausgenommen –
  die sichern). Die Historie ist entbehrlich.

---

## Sicherheit

- **Nur LAN:** Caddy beantwortet nur Clients aus `ALLOWED_CLIENTS` (Standard: private Bereiche
  10/8, 172.16/12, 192.168/16, fd00::/8, Loopback). Alle anderen bekommen die Verbindung gekappt.
- **Kein Tunnel:** Anfragen mit `Cf-Connecting-Ip`-Header (Cloudflare Tunnel) werden abgewiesen –
  auch wenn `cloudflared` selbst im LAN steht. Das Dashboard bitte nicht in den Tunnel hängen:
  `/select` liefert sonst jedem deine kompletten Verbindungsdaten.
- **Absenderprüfung:** NetFlow und Syslog werden nur von privaten Adressen angenommen; mit
  `ALLOWED_SENDERS` nur vom Gateway selbst.
- **Interne Dienste** (VictoriaLogs, Live-Stream, GoFlow2-Metriken) hören nur auf `127.0.0.1`.
  Über Caddy ist von VictoriaLogs nur der lesende Teil `/select` erreichbar.
- **Kein Docker-Socket**, keine externen CDNs: globe.gl, Texturen und Schriften liegen in
  `web/vendor/`. Der Browser lädt nichts von Dritten (strikte Content-Security-Policy).
- **Passwort (optional):** `./lagezentrum.sh password` setzt Basic Auth für Dashboard, Live-Stream
  und Historie; `./lagezentrum.sh password off` entfernt sie wieder.

---

## Ressourcen

Gemessen im Test mit synthetischem IPFIX:

| Last | CPU (Anteil eines Kerns) | RAM gesamt |
|---|---|---|
| Leerlauf | < 0,1 % | ~180 MB |
| 100 Flows/s (aktiver Haushalt) | ~3 % Vector + ~2 % GoFlow2 | ~230 MB |
| 500 Flows/s | ~15 % Vector + ~9 % GoFlow2 | ~230 MB |

Kein Flow ging verloren; fällt VictoriaLogs kurz aus, puffert Vector und liefert nach.
Platten-Schreiblast: nur VictoriaLogs (komprimiert, Flush alle 30 s) und rotierende Docker-Logs
(max. 10 MB pro Container). Der GeoIP-Bestand braucht ~140 MB RAM im Collector, weil die
Datenbank für schnelle Abfragen im Speicher liegt. Das Rendern des Globus passiert im Browser,
nicht auf dem Server; im Hintergrund-Tab pausiert es.

---

## Fehlersuche

| Symptom | Ursache | Lösung |
|---|---|---|
| Status *Getrennt* | Collector läuft nicht | `docker compose ps`, `docker compose logs collector`; fehlt GeoIP: `./lagezentrum.sh geoip` |
| *Live · seit 2 min keine Daten* | NetFlow kommt nicht an | Collector-IP/Port im UniFi prüfen; `apt -y install tcpdump && tcpdump -ni eth0 udp port 2055` |
| NetFlow kommt an, aber nichts erscheint | Absender nicht erlaubt | `ALLOWED_SENDERS` muss die IP sein, von der das Gateway sendet (siehe tcpdump) |
| Keine roten Bögen | Filter „Abgewehrt“ aus, Syslog fehlt oder Regel ohne Logging | Chip einschalten; `./lagezentrum.sh test`; Regel aus Schritt 3 C prüfen |
| CN/RU fehlen bei den roten Bögen | Region Blocking greift vor der Regel | siehe Hinweis in 3 C |
| Viele „rein“ von der eigenen IP | `WAN_IP` veraltet | `.env` anpassen, `docker compose up -d` |
| Eigene Geräte als Ausland | IPv6-Präfix fehlt | `LOCAL_EXTRA_NETS` setzen |
| Statistik zeigt *Historie nicht erreichbar* | VictoriaLogs down | `docker compose logs victorialogs` |
| Dashboard aus dem LAN nicht erreichbar | Client nicht in `ALLOWED_CLIENTS` | z. B. Tailscale (100.64/10) oder öffentliche IPv6 ergänzen |
| Globus ruckelt auf dem Kiosk-Pi | GPU zu schwach | `?lite` an die URL hängen |

Erlaubte Regeln werden am Namen erkannt (`-A-`, „allow“, „accept“). Taucht in deinen Logs ein
anderes Muster auf, ist das eine Zeile im `blocked`-Transform in `collector/vector.yaml`.

---

## Dateien

```
docker-compose.yml        Container, Härtung, RAM-Limits, Log-Rotation
.env.example              Vorlage für .env (setup kopiert sie)
install.sh                Installation im LXC: Pakete, Docker, Projekt, Setup, Selbsttest
proxmox/create-lxc.sh     auf dem Proxmox-Host: LXC anlegen und install.sh darin starten
lagezentrum.sh            setup · test · status · geoip · password · update · logs
collector/Dockerfile      Vector + GoFlow2 in einem Image
collector/vector.yaml     Pipeline: Klassifizierung, Syslog-Parser, GeoIP, Senken
config/hosts.example.csv  Vorlage für Gerätenamen
caddy/Caddyfile           Webserver, LAN-Sperre, Sicherheits-Header
caddy/auth/               hier landet die optionale Basic-Auth
scripts/geoip-update.sh   GeoIP-Download (läuft im geoip-Container)
web/                      Dashboard (index.html, app.js, app.css) + vendor/ (globe.gl, Texturen, Schriften)
geoip/                    heruntergeladene Datenbanken (nicht im Git)
```

IP-Geolokation: [DB-IP.com](https://db-ip.com) Lite, CC BY 4.0. globe.gl: MIT. IBM Plex: SIL OFL 1.1.
