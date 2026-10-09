# Lagezentrum

Live-Weltkarte für das Heimnetz: Jede Verbindung über den UniFi Cloud Gateway Max fliegt als
Bogen über einen 3D-Globus. Dazu Live-Ticker, 24-h-Statistik und eine durchsuchbare Historie.

- **Standardansicht:** erlaubte Verbindungen raus (cyan) und rein (grün)
- **Zuschaltbar:** abgewehrte Anklopfer aus dem Internet (rot) und Verkehr zwischen VLANs (lila)
- **Nur im LAN erreichbar und mit Login** (ein Passwort, der Browser bleibt angemeldet), ein einzelner LXC,
  rund 200–250 MB RAM im Betrieb

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
Browser ──HTTP 8080──▶ Caddy ──▶ Dashboard · /ws (live) · /select (Abfragen) · /api (Namen)   nur LAN
                         │  Sitzung gültig? (forward_auth)                       │
                         ▼                                                       │
                API 127.0.0.1:8092 ◀─────────────────────────────────────────────┘
                Login · config/hosts.csv ──SIGHUP──▶ Vector lädt Namen neu
```

| Container | Aufgabe | RAM-Limit |
|---|---|---|
| `collector` | Vector 0.58 mit eingebautem GoFlow2 2.2.7 | 384 MB |
| `victorialogs` | Historie, stark komprimiert | 512 MB |
| `caddy` | Webserver, Zugriffsschutz | 64 MB |
| `api` | Login prüfen, Gerätenamen aus dem Dashboard speichern (Go, ~5 MB) | 32 MB |
| `geoip` | Einmal-Job: lädt DB-IP Lite, wenn nötig | 128 MB |

Alle Container laufen mit schreibgeschütztem Dateisystem, ohne Linux-Capabilities
(Caddy: nur `NET_BIND_SERVICE`) und mit `no-new-privileges`. Vector und GoFlow2 laufen als `nobody`.

**Wie die Richtung bestimmt wird:** NetFlow meldet jede Verbindung doppelt – Anfrage und
Antwort. Die Pipeline ordnet beide derselben Verbindung zu (`leg=req` / `leg=resp`). Live und in
den Zählern erscheint nur die Anfrage; die Antwort zählt beim Datenvolumen mit (sonst fehlen
alle Downloads). Über die WAN-Grenze gilt die lokale Seite als Client, außer ihr Port steht in
`LOCAL_SERVER_PORTS` (z. B. WireGuard 51820) oder ist ein klassischer Server-Port unter 1024.

---

## 1. Proxmox: Storage für die Logs

Einmalig, damit Logs nie auf der System-SSD landen:

0a. Node → Disks: die Platte muss als ungenutzt gelistet sein (sonst *Wipe Disk* – löscht alles darauf).
1. Node → Disks → LVM-Thin → *Create: Thinpool*, Disk wählen, Name `ssd-logs`, *Add Storage* angehakt.

---

## 2. Installieren

### Variante A: alles automatisch (empfohlen)

Auf dem **Proxmox-Host** als root:
**WICHTIG:** Unbedingt VLAN=xx angeben, damit der LXC in einem VLAN mit folgenden Eigenschaften landet:
* Das Gateway VLAN kann VLAN-xx erreichen
* VLAN-xx hat Internetzugriff
* Das Client/Trusted VLAN (Da wo deine Geräte sind) kann auf VLAN-xx zugreifen!

VLAN=xx vor dem Ausführen gegen die echte ID ersetzen; zB VLAN=10

Vom Host:
```bash
apt -y install git
git clone https://github.com/ProfessorQuantumUniverse/unifi-HQ.git /root/unifi-HQ
VLAN=xx /root/unifi-HQ/proxmox/create-lxc.sh
```

Das Skript lädt das aktuelle Debian-Template, legt einen unprivilegierten LXC auf `ssd-logs` an
(2 Kerne, 1536 MB RAM als Obergrenze, 32 GB Festplatte, `nesting` + `keyctl`, Start beim Booten), kopiert
das Projekt hinein und ruft dort `install.sh` auf. Am Ende stehen IP und alle Adressen da.
Platten fasst es nicht an.

Später via Setupskript (empfohlen), oder:
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
| Login-Passwort | fragt `setup` am Ende ab (mindestens 10 Zeichen); landet nur als Hash in der `.env` |

Alles landet in `.env` und lässt sich dort jederzeit ändern (danach `docker compose up -d`).
Gerätenamen trägst du in `config/hosts.csv` ein, eine Zeile pro Gerät: `10.37.10.3,homelable`
(danach `docker compose restart collector`). `setup` richtet außerdem das monatliche
GeoIP-Update per Cron ein. Erneut aufrufen ist gefahrlos: `./lagezentrum.sh setup`.

---

## 3. UniFi einrichten

### A. NetFlow (alle erlaubten Verbindungen)

Einstellungen → CyberSecure → *Traffic Logging*:
- **NetFlow (IPFIX)** an, Collector `<LXC-IP>`, Port `2055`, Version 10 (IPFIX), 
- **Alle Netzwerke** auswählen, sonst fehlen VLANs
- Flow-Protokollierung: *Gesamter Datenverkehr*
- Engine-ID: Automatisch
- Timeout-Rate: 1 min
- Bildwiederholrate: 20
- **Sampling Modus: AUS**
- Sampling-Rate: MUSS ausgegraut sein

Etwaige Performance Warnungen ignorieren/akzeptieren; die Performance bricht damit erst bei 1000+ Geräten spürbar ein.

### B. (Optional) Syslog (für „Abgewehrt“)

Gleiche Seite, *Activity Logging / SIEM-Server*:

- Adresse `<LXC-IP>`, Port `5514`
- Bei den Inhalten mindestens die Sicherheits-Erkennungen anhaken

### C. (Optionales Optional) Regel für die Anklopfer

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

Vom Host:
```bash
pct enter <LXC ID>
./lagezentrum.sh test
```

Schickt einen Test-Flow und eine Test-Syslog-Zeile durch die ganze Kette und prüft, ob sie in
der Historie landen (inkl. GeoIP). Danach:

1. `http://<LXC-IP>:8080/?demo` – erst die Login-Seite, nach der Anmeldung der Globus mit Beispieldaten, ganz ohne UniFi
2. `http://<LXC-IP>:8080` – oben links muss **Live** mit grünem Punkt stehen
3. Echte Flows brauchen nach dem Einschalten im UniFi etwa eine Minute (IPFIX-Templates).

---

## Bedienung

| | |
|---|---|
| **⚙ Einstellungen** | *Gleichmäßig abspielen* (Standard an): Das Gateway schickt Flows gebündelt alle paar Sekunden. Das Dashboard puffert sie und spielt sie im echten Takt ab – mit ein paar Sekunden Versatz, den es selbst misst. Außerdem Bögen kräftig/dezent und Bögen pro Sekunde. Ganz unten: *Abmelden* (nur dieser Browser). |
| **Filter-Chips** | Raus / Rein (an), Abgewehrt / Intern (aus), DNS (aus). Die Auswahl merkt sich der Browser. |
| **Ticker** | Pro Verbindung Upload ↑, Download ↓ und Dauer. Beim Überfahren: ✎ Namen vergeben, Dossier zu Gerät, Land, Firma oder IP. Klick zoomt zum Ort; Doppelklick öffnet den Verlauf dieser IP. Oben: Verbindungen und Datenmenge pro Minute. |
| **Linke Spalte** | 24-h-Zähler mit Datenvolumen, Anzahl Ziele/Firmen/Länder/Geräte, Stundengrafik (Klick auf den Titel schaltet zwischen Verbindungen und Datenmenge um), Top-Ziele, Länder, Dienste, größte und längste Verbindungen, Geräte. Länder, Firmen und Geräte öffnen ihr Dossier, der Rest den Verlauf. |
| **Globus** | Länder sind nach Verkehr der letzten 24 h eingefärbt (abschaltbar). Klick auf ein Land oder einen Hotspot-Punkt öffnet das Länder-Dossier. |
| **Dossier** | Für ein Land, ein Gerät, eine Firma oder eine einzelne IP: Kennzahlen (Verbindungen, Datenmenge, IPs, Geräte, erster/letzter Kontakt, Abgewehrt), Zeitachse, Top-Listen und alle Verbindungspaare **Quelle → Ziel** mit Dienst, Anzahl und Datenmenge. Zeitraum 1 h bis 30 Tage. Klick auf ein Paar öffnet die Einzelverbindungen. |
| **Länder** | Alle Länder als sortierbare Tabelle (Verbindungen, Daten, Geräte, IPs, Abgewehrt) – Klick öffnet das Dossier. |
| **Geräte** | Alle Adressen mit Verkehr, Namen vergeben oder löschen (✎), auch für externe IPs (*+ Name für IP*, z. B. dein VPS). Namen gelten sofort im Dashboard, für alle neuen Einträge der Historie, und die Suche nach einem Namen findet auch ältere Einträge dieser IP. |
| **Erstkontakt** | Meldung oben, wenn ein Gerät ein Land oder eine Firma zum ersten Mal seit 30 Tagen kontaktiert (abschaltbar; startet, sobald es einen Tag Historie gibt). |
| **Verlauf** (Taste `/`) | Volltextsuche über IP, Gerät, Land, Stadt, Provider – oder direkt LogsQL. |

Beispiele für die Suche:

```
MacBook                              Wortsuche
r_country:CN                         ein Feld
dir:blocked dport:22                 mehrere Felder
r_org:"Google LLC" local_name:iPhone
dport:443 | stats by (local_name) sum(bytes) bytes     eigene Auswertung mit Pipes
```

Felder: `dir` (out/in/blocked/internal), `leg`, `proto`, `local_ip`, `local_name`, `remote_ip`,
`remote_name`, `sport`, `dport`, `bytes`, `packets`, `duration_ms`, `rule`, `r_country`, `r_country_name`,
`r_city`, `r_org`, `r_asn`, `in_if`, `out_if`. Für Profi-Auswertungen gibt es die VictoriaLogs-Oberfläche unter
`http://<LXC-IP>:8080/select/vmui/`.

URL-Optionen: `?demo` (Beispieldaten), `?lite` (für schwache Geräte wie einen Pi-Kiosk: ohne
Relief und Sternenhimmel, weniger Bögen).

---

## Was UniFi exportiert (und was nicht)

Ubiquiti dokumentiert nicht genau, welche Verbindungen per NetFlow/IPFIX rausgehen. Stand der Beobachtung:

- **„Rein“ bleibt bei dir leer, und das ist richtig.** Rein gibt es nur, wenn von außen etwas bei dir
  erreichbar ist (Portfreigabe). Der Cloudflare-Tunnel baut seine Verbindung von innen nach außen auf –
  er erscheint als „raus“ zu Cloudflare (Port 7844).
- **Verkehr zum Gateway selbst** (DNS an `10.37.x.1`, der WireGuard-Server des UCG) taucht in den Exporten
  bisher nicht auf. Damit fehlen auch eingehende VPN-Verbindungen.
- **VPN-Clients** stecken in einem eigenen Netz, das in der NetFlow-Auswahl nicht wählbar ist – ihr
  Verkehr wird nicht exportiert.
- **Zwischen VLANs:** noch offen. Test zu Hause: von einem Gerät ein Gerät in einem anderen VLAN anpingen,
  danach Filter „Intern“ einschalten. Zur Diagnose speichert die Pipeline die Interface-Nummern:
  `_time:24h kind:flow | stats by (in_if, out_if, dir) count()` im Verlauf zeigt, über welche Wege
  das Gateway überhaupt exportiert.
- Einige Firmware-Versionen hatten Fehler beim Export (Berichte zu Network 9.3.45 und 9.4.17 in der
  Ubiquiti-Community). Wenn plötzlich weniger kommt: Firmware-Version prüfen.

---

## Betrieb

**Update auf eine neue Version** – bei Installation über `create-lxc.sh` (Variante A) auf dem Proxmox-Host:

```bash
cd /root/unifi-HQ && git pull
./proxmox/update-lxc.sh            # findet den CT mit Hostname "lagezentrum", sonst: ./proxmox/update-lxc.sh <CTID>
```

Das kopiert den neuen Stand in den Container, baut neu und macht den Selbsttest. `.env`,
`hosts.csv`, GeoIP-Daten, Passwort und Historie bleiben unangetastet. Bei Variante B (Git im
Container): `cd /opt/lagezentrum && git pull && docker compose up -d --build && docker compose restart collector caddy`.

**Erstes Update auf die Version mit Login:** Bis ein Passwort gesetzt ist, bleibt das Dashboard
wie bisher offen (das Update-Skript weist darauf hin). Einmal im Container setzen:

```bash
pct enter <LXC ID>
cd /opt/lagezentrum && ./lagezentrum.sh password
```

Ein altes Basic Auth (Browser-Passwortfenster aus früheren Versionen) entfernt `password` dabei automatisch.

### Login

Das Dashboard fragt einmal nach dem Passwort und merkt sich die Anmeldung in einem Cookie. Das
gilt 400 Tage (mehr erlauben Browser nicht) und verlängert sich bei jeder Nutzung von selbst –
ein Kiosk oder ein Browser, der das Dashboard regelmäßig öffnet, bleibt also praktisch dauerhaft angemeldet.

```bash
./lagezentrum.sh password          # Passwort setzen oder ändern (meldet alle Browser ab)
./lagezentrum.sh password logout   # alle Browser abmelden, Passwort bleibt
./lagezentrum.sh password off      # Login ausschalten – jeder im LAN sieht das Dashboard
```

Geschützt ist alles: Dashboard, Live-Stream (`/ws`), Historie (`/select`, auch die VictoriaLogs-Oberfläche),
Namens-API und `config.json`. Ohne Anmeldung landen Seitenaufrufe auf `/login.html`, alles andere
bekommt `401`. Frei erreichbar sind nur die Login-Seite selbst und `/vendor/` (globe.gl, Texturen,
Schriften – keine Daten). Interne Dienste wie VictoriaLogs und der Live-Stream hören weiterhin nur
auf `127.0.0.1`; der Selbsttest und der Collector sprechen sie direkt an, ohne Login.

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
- **Namens-API:** Über `/api/names` kann jeder, der das Dashboard öffnen darf, Namen setzen – also
  nur angemeldete Clients aus dem LAN. Die API prüft IP und Namen, nimmt nur
  JSON von derselben Seite an (Schutz gegen fremde Webseiten im selben Browser) und schreibt nur
  `config/hosts.csv`. Sie läuft ohne Rechte außer dem Senden des Neuladen-Signals an Vector.
- **Login:** `./lagezentrum.sh password` (siehe [Login](#login)). Caddy fragt vor jeder Anfrage die
  API, ob die Sitzung gültig ist (`forward_auth`). Das Passwort liegt nur als PBKDF2-Hash
  (600 000 Runden, SHA-256) in der `.env`; das Sitzungs-Cookie ist mit `AUTH_SECRET` signiert (HMAC-SHA256),
  `HttpOnly` und `SameSite=Lax`. Ein neues Passwort oder `password logout` macht alle alten Cookies
  ungültig. Gegen Durchprobieren: Jeder Fehlversuch kostet eine Sekunde, nach 5 Fehlversuchen ist
  die Adresse 1 Minute gesperrt, danach jeweils doppelt so lange (höchstens 15 Minuten).
  Das Cookie ist nicht `Secure`, weil das Dashboard im LAN über einfaches HTTP läuft – wer den
  LAN-Verkehr mitlesen kann, kann auch das Cookie mitlesen. Für ein Heimnetz ist das vertretbar;
  Gäste und IoT-Geräte gehören ohnehin in ein eigenes VLAN.

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
| Passwort vergessen | – | `./lagezentrum.sh password` setzt ein neues |
| Login meldet *Zu viele Fehlversuche* | Sperre nach 5 Fehlversuchen | abwarten (höchstens 15 min) oder `docker compose restart api` |
| Überall *502* | API läuft nicht, ohne sie lässt Caddy niemanden durch | `docker compose ps`, `docker compose logs api` |
| Login klappt, danach wieder die Login-Seite | Browser blockiert Cookies für die LXC-IP | Cookies für `http://<LXC-IP>:8080` erlauben |

Erlaubte Regeln werden am Namen erkannt (`-A-`, „allow“, „accept“). Taucht in deinen Logs ein
anderes Muster auf, ist das eine Zeile im `blocked`-Transform in `collector/vector.yaml`.

---

## Dateien

```
docker-compose.yml        Container, Härtung, RAM-Limits, Log-Rotation
.env.example              Vorlage für .env (setup kopiert sie)
install.sh                Installation im LXC: Pakete, Docker, Projekt, Setup, Selbsttest
proxmox/create-lxc.sh     auf dem Proxmox-Host: LXC anlegen und install.sh darin starten
proxmox/update-lxc.sh     auf dem Proxmox-Host: neuen Stand in den LXC kopieren und neu starten
lagezentrum.sh            setup · test · status · geoip · password (Login) · update · logs
collector/Dockerfile      Vector + GoFlow2 in einem Image
collector/vector.yaml     Pipeline: Klassifizierung, Syslog-Parser, GeoIP, Senken
config/hosts.example.csv  Vorlage für Gerätenamen
caddy/Caddyfile           Webserver, LAN-Sperre, Sicherheits-Header
caddy/auth/               nur noch für ein altes Basic Auth früherer Versionen
scripts/geoip-update.sh   GeoIP-Download (läuft im geoip-Container)
api/                      Login + Namens-API (Go, nur Standardbibliothek)
web/                      Dashboard (index.html, app.js, app.css), Login-Seite (login.*) + vendor/ (globe.gl, Texturen, Schriften)
geoip/                    heruntergeladene Datenbanken (nicht im Git)
```

IP-Geolokation: [DB-IP.com](https://db-ip.com) Lite, CC BY 4.0. globe.gl: MIT. IBM Plex: SIL OFL 1.1.
Flaggen: Twemoji Country Flags (Code MIT, Grafiken [Twemoji](https://github.com/twitter/twemoji) CC BY 4.0) –
damit erscheinen Flaggen auch unter Windows. Ländergrenzen: [Natural Earth](https://www.naturalearthdata.com), gemeinfrei.
