/* Lagezentrum – Dashboard
 * Live-Stream:  /ws          (Vector websocket_server, ein JSON-Objekt pro Nachricht)
 * Historie:     /select/...  (VictoriaLogs, LogsQL)
 * Einstellungen: /config.json (aus der .env, über Caddy)
 * Demo ohne Backend: ?demo
 */
(() => {
  'use strict';

  // ---------- Einstellungen ----------
  const CONFIG = {
    home: { lat: 50.11, lng: 8.68, label: 'Zuhause' },
    gateway: '',
    wsUrl: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws',
    vlUrl: 'select/logsql/query',
    arcsPerSecond: 10,        // mehr landet in Ticker und Zählern, aber nicht als Bogen
    flightMs: 1700,
    tickerMax: 80,
    statsEveryMs: 60000,
    spotsMax: 400,
    historyLimit: 500,
    textures: 'vendor/'
  };
  const COLORS = { out: '#7fd4ff', in: '#5fe0a0', blocked: '#ff4d5e', internal: '#b39cff' };
  const VERB = { out: 'raus', in: 'rein', blocked: 'abgewehrt', internal: 'intern' };
  const PORTS = { 20:'FTP-Daten', 21:'FTP', 22:'SSH', 23:'Telnet', 25:'SMTP', 53:'DNS', 67:'DHCP', 69:'TFTP', 80:'HTTP', 81:'HTTP-Alt',
    88:'Kerberos', 110:'POP3', 111:'RPC', 119:'NNTP', 123:'NTP', 135:'MS-RPC', 137:'NetBIOS', 138:'NetBIOS', 139:'NetBIOS', 143:'IMAP',
    161:'SNMP', 179:'BGP', 389:'LDAP', 443:'HTTPS', 445:'SMB', 465:'SMTPS', 500:'IKE', 502:'Modbus', 514:'Syslog', 515:'LPD',
    554:'RTSP', 587:'SMTP', 623:'IPMI', 631:'IPP', 636:'LDAPS', 853:'DNS über TLS', 873:'rsync', 993:'IMAPS', 995:'POP3S',
    1080:'SOCKS', 1194:'OpenVPN', 1433:'MSSQL', 1521:'Oracle', 1723:'PPTP', 1883:'MQTT', 1900:'UPnP', 2049:'NFS', 2222:'SSH-Alt',
    2323:'Telnet', 2375:'Docker', 2376:'Docker', 3000:'Grafana', 3128:'Proxy', 3306:'MySQL', 3389:'RDP', 3478:'STUN', 4500:'IPsec',
    5000:'UPnP/Synology', 5060:'SIP', 5222:'XMPP', 5353:'mDNS', 5432:'PostgreSQL', 5555:'ADB', 5683:'CoAP', 5900:'VNC', 5985:'WinRM',
    6379:'Redis', 6443:'Kubernetes', 7547:'TR-069', 7844:'Cloudflare Tunnel', 8000:'HTTP-Alt', 8006:'Proxmox', 8080:'HTTP-Alt',
    8081:'HTTP-Alt', 8088:'HTTP-Alt', 8123:'Home Assistant', 8291:'MikroTik', 8443:'HTTPS-Alt', 8883:'MQTT/TLS', 8888:'HTTP-Alt',
    9000:'HTTP-Alt', 9090:'Prometheus', 9100:'Drucker', 9200:'Elasticsearch', 10000:'Webmin', 11211:'Memcached', 25565:'Minecraft',
    27017:'MongoDB', 37777:'Dahua', 49152:'UPnP', 51820:'WireGuard' };

  const params = new URLSearchParams(location.search);
  // ?lite: für schwache Anzeigegeräte (Pi-Kiosk) – ohne Relief, Sterne und mit weniger Bögen
  const lite = params.has('lite');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nf = new Intl.NumberFormat('de-DE');
  const regionNames = (() => { try { return new Intl.DisplayNames(['de'], { type: 'region' }); } catch { return null; } })();
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const flag = cc => (typeof cc === 'string' && /^[A-Za-z]{2}$/.test(cc)) ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 127397 + c.charCodeAt(0))) : '·';
  const country = (cc, fallback) => { if (cc && regionNames) { try { return regionNames.of(String(cc).toUpperCase()); } catch {} } return fallback || cc || ''; };
  const portName = p => { p = +p || 0; return p === 0 ? '–' : PORTS[p] ? `${PORTS[p]} (${p})` : `Port ${p}`; };
  const fmtBytes = b => { b = +b || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0; while (b >= 1024 && i < 5) { b /= 1024; i++; } return (i ? b.toFixed(b < 10 ? 1 : 0).replace('.', ',') : b) + ' ' + u[i]; };
  const fmtNum = n => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' Mio' : nf.format(n); };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('lz.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lz.' + k, JSON.stringify(v)); } catch {} }
  };
  const lq = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';   // LogsQL-Zeichenkette
  const fmtDur = ms => { ms = +ms || 0; if (!ms) return ''; if (ms < 1000) return '<1 s'; const s = Math.round(ms / 1000);
    if (s < 60) return s + ' s'; const m = Math.floor(s / 60); if (m < 60) return m + ' min ' + (s % 60 ? (s % 60) + ' s' : '');
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };

  // Benutzer-Einstellungen (Zahnrad oben rechts), pro Browser gespeichert
  const DEFAULT_SETTINGS = { smooth: true, arcStyle: 'strong', arcRate: 10 };
  const settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
  if (lite) settings.arcRate = Math.min(settings.arcRate, 4);

  // ---------- Filter ----------
  const DEFAULT_FILTERS = { out: true, in: true, blocked: false, internal: false, dns: false };
  const isDemo = params.has('demo') || location.protocol === 'file:';
  const filters = Object.assign({}, DEFAULT_FILTERS, isDemo ? { blocked: true, internal: true } : store.get('filters', {}));
  for (const k of Object.keys(filters)) if (!(k in DEFAULT_FILTERS)) delete filters[k];

  function applyFilters() {
    document.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(!!filters[b.dataset.f])));
    document.querySelectorAll('[data-needs]').forEach(s => { s.hidden = !filters[s.dataset.needs]; });
    document.querySelectorAll('.total').forEach(t => { t.hidden = (t.dataset.k === 'blocked' || t.dataset.k === 'internal') && !filters[t.dataset.k]; });
    renderSpark();
    refreshPoints();
  }
  document.querySelectorAll('.chip').forEach(btn => btn.addEventListener('click', () => {
    const f = btn.dataset.f; filters[f] = !filters[f];
    if (!isDemo) store.set('filters', filters);
    applyFilters();
  }));
  const isDns = e => e.dport === 53 || e.dport === 853 || e.dport === 5353;
  const visible = e => filters[e.dir] === true && (filters.dns || !isDns(e));

  // ---------- Globus ----------
  const globeEl = $('globe');
  let world = null;
  const arcs = [], rings = [];
  const spots = new Map();
  let dirty = true;

  function initGlobe() {
    if (typeof Globe !== 'function') {
      showHint('Die 3D-Bibliothek konnte nicht geladen werden (vendor/globe.gl.min.js).');
      return;
    }
    try {
      world = new Globe(globeEl, { animateIn: !reduceMotion, rendererConfig: { antialias: !lite, powerPreference: 'low-power' } });
    } catch {
      world = Globe({ animateIn: !reduceMotion })(globeEl);
    }
    const H = CONFIG.home;
    world
      .backgroundColor('#071224')
      .globeImageUrl(CONFIG.textures + 'earth-night.jpg')
      .showAtmosphere(true).atmosphereColor('#3d7bd9').atmosphereAltitude(0.16)
      .arcStartLat(d => d.sLat).arcStartLng(d => d.sLng).arcEndLat(d => d.eLat).arcEndLng(d => d.eLng)
      .arcColor(d => d.color).arcStroke(d => d.stroke).arcAltitudeAutoScale(0.38)
      .arcDashLength(d => d.dash).arcDashGap(d => d.gap).arcDashInitialGap(1).arcDashAnimateTime(CONFIG.flightMs)
      .arcsTransitionDuration(0)
      .ringColor(d => t => rgba(d.color, Math.max(0, 1 - t)))
      .ringMaxRadius(d => d.max).ringPropagationSpeed(d => d.speed).ringRepeatPeriod(d => d.period)
      .pointLat(d => d.lat).pointLng(d => d.lng).pointColor(d => rgba(COLORS[d.dir], 0.85))
      .pointAltitude(0.004).pointRadius(d => 0.12 + Math.min(0.55, Math.log10(d.count + 1) * 0.22))
      .pointsTransitionDuration(0)
      .pointLabel(d => {
        const box = el('div');
        box.textContent = `${flag(d.cc)} ${d.place} · ${nf.format(d.count)}× ${VERB[d.dir]}` + (d.org ? ` · ${d.org}` : '');
        return box.outerHTML;   // globe.gl erwartet HTML – Inhalt ist hier bereits escaped
      })
      .onPointClick(d => openHistory(d.cc ? `r_country:${d.cc}` : '', d.dir))
      .labelsData([H]).labelLat(d => d.lat).labelLng(d => d.lng).labelText(d => d.label)
      .labelColor(() => '#dbe6f3').labelSize(0.55).labelDotRadius(0.28).labelAltitude(0.006)
      .pointOfView({ lat: Math.max(-60, Math.min(60, H.lat - 12)), lng: H.lng + 4, altitude: 2.3 }, 0);

    if (!lite) world.backgroundImageUrl(CONFIG.textures + 'night-sky.png').bumpImageUrl(CONFIG.textures + 'earth-topology.png');
    try { world.renderer().setPixelRatio(lite ? 1 : Math.min(devicePixelRatio || 1, 2)); } catch {}
    rings.push({ lat: H.lat, lng: H.lng, color: '#7fd4ff', max: 2.5, speed: 1, period: 2600 });

    const controls = world.controls();
    controls.autoRotate = !reduceMotion; controls.autoRotateSpeed = 0.3;
    controls.addEventListener('start', () => pauseRotation());

    const resize = () => { world.width(globeEl.clientWidth).height(globeEl.clientHeight); };
    addEventListener('resize', resize); resize();

    // Unsichtbarer Tab: nichts rendern
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) world.pauseAnimation(); else world.resumeAnimation();
    });
  }

  let resumeTimer;
  function pauseRotation(ms = 15000) {
    if (!world) return;
    const c = world.controls(); c.autoRotate = false; clearTimeout(resumeTimer);
    if (!reduceMotion) resumeTimer = setTimeout(() => { c.autoRotate = true; }, ms);
  }
  function focusOn(lat, lng) {
    if (!world || lat == null || lng == null) return;
    pauseRotation(30000);
    world.pointOfView({ lat: +lat, lng: +lng, altitude: 1.5 }, 1200);
  }

  // Bögen begrenzen: Token-Bucket + gleiche Gegenstelle höchstens alle 3 s
  let tokens = settings.arcRate;
  setInterval(() => { tokens = Math.min(settings.arcRate, tokens + settings.arcRate / 10); }, 100);
  const recentArc = new Map();

  function emitArc(e) {
    if (!world || document.hidden || e.r_lat == null || e.r_lon == null || tokens < 1) return;
    const key = e.dir + '|' + e.remote_ip, now = Date.now();
    if (now - (recentArc.get(key) || 0) < 3000) return;
    recentArc.set(key, now);
    if (recentArc.size > 2000) recentArc.clear();
    tokens -= 1;
    const H = CONFIG.home;
    const towardHome = e.dir === 'in' || (e.dir === 'blocked' && e.bdir !== 'out');
    const remote = { lat: +e.r_lat, lng: +e.r_lon };
    const s = towardHome ? remote : H, t = towardHome ? H : remote;
    const color = COLORS[e.dir];
    const strong = settings.arcStyle === 'strong';
    // Dicke nach Datenmenge: 1 KB dünn, 100 MB dick
    const vol = (e.bytes || 0) + (e.down || 0);
    const size = Math.min(1, Math.max(0, (Math.log10(vol + 1) - 3) / 5));
    const stroke = strong ? (e.dir === 'blocked' ? 0.9 : 0.5 + size * 1.3) : (e.dir === 'blocked' ? 0.55 : 0.38);
    const arc = { sLat: s.lat, sLng: s.lng, eLat: t.lat, eLng: t.lng, stroke,
      color: strong ? [rgba(color, 0.35), color] : [rgba(color, 0.05), color],
      dash: strong ? 0.6 : 0.4, gap: strong ? 1.4 : 2 };
    arcs.push(arc); dirty = true;
    setTimeout(() => {
      const ring = { lat: t.lat, lng: t.lng, color, max: (e.dir === 'blocked' ? 3.2 : 1.8) * (strong ? 1.4 + size : 1), speed: 2.4, period: 99999 };
      rings.push(ring); dirty = true;
      setTimeout(() => { const i = rings.indexOf(ring); if (i >= 0) rings.splice(i, 1); dirty = true; }, 1400);
    }, CONFIG.flightMs);
    setTimeout(() => { const i = arcs.indexOf(arc); if (i >= 0) arcs.splice(i, 1); dirty = true; }, CONFIG.flightMs * 2);
  }

  function addSpot(e) {
    if (e.r_lat == null || e.r_lon == null) return;
    const key = `${(+e.r_lat).toFixed(1)},${(+e.r_lon).toFixed(1)}|${e.dir}`;
    let s = spots.get(key);
    if (!s) {
      s = { lat: +e.r_lat, lng: +e.r_lon, dir: e.dir, count: 0, cc: e.r_country, org: e.r_org,
            place: e.r_city || country(e.r_country, e.r_country_name) || '?' };
      spots.set(key, s);
    }
    s.count++; s.last = Date.now();
  }
  function refreshPoints() {
    if (!world) return;
    const cutoff = Date.now() - 15 * 60 * 1000;
    for (const [k, s] of spots) if (s.last < cutoff) spots.delete(k);
    const list = [...spots.values()].filter(s => filters[s.dir]).sort((a, b) => b.count - a.count).slice(0, CONFIG.spotsMax);
    world.pointsData(list);
  }

  setInterval(() => {
    if (!dirty || !world) return; dirty = false;
    world.arcsData(arcs.slice()); world.ringsData(rings.slice());
  }, 120);
  setInterval(refreshPoints, 2000);

  // ---------- Ticker ----------
  const queue = [];
  const stamps = [];
  const internalSeen = new Map();
  const ticker = $('ticker');
  let lastEventAt = 0;

  function makeItem(e) {
    const li = el('li', 'fresh'); li.dataset.dir = e.dir; li.tabIndex = 0;
    const time = el('time', null, new Date(e.ts).toLocaleTimeString('de-DE'));
    const body = el('div');
    const where = el('div', 'where');
    const what = el('div', 'what');
    const verb = el('span', 'verb', VERB[e.dir] + ' ');
    const local = e.local_name || e.local_ip;
    if (e.dir === 'internal') {
      where.append(verb, `${local} → ${e.remote_name || e.remote_ip}`);
      what.textContent = [portName(e.dport), e.proto].filter(Boolean).join(' · ');
    } else {
      const place = [e.r_city, country(e.r_country, e.r_country_name)].filter(Boolean).join(', ') || 'unbekannter Ort';
      where.append(verb, `${flag(e.r_country)} ${place}`);
      const parts = [e.remote_ip, portName(e.dport), e.r_org];
      if (e.dir !== 'blocked') parts.push(local);
      what.textContent = parts.filter(Boolean).join(' · ');
    }
    li.title = e.rule ? `Regel: ${e.rule}` : '';
    const meta = el('div', 'meta');
    e.metaEl = meta; renderMeta(e);
    body.append(where, what, meta);
    li.append(time, body);
    const go = () => { if (e.dir === 'internal') openHistory(`local_ip:${lq(e.local_ip)} remote_ip:${lq(e.remote_ip)}`, 'internal'); else focusOn(e.r_lat, e.r_lon); };
    li.addEventListener('click', go);
    li.addEventListener('dblclick', () => openHistory(`remote_ip:${lq(e.remote_ip)}`, ''));
    li.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
    return li;
  }

  function renderMeta(e) {
    if (!e.metaEl) return;
    const parts = [];
    if (e.dir !== 'blocked') {
      parts.push(`↑ ${fmtBytes(e.bytes)}`);
      if (e.down) parts.push(`↓ ${fmtBytes(e.down)}`);
    }
    if (e.duration_ms) parts.push(fmtDur(e.duration_ms));
    if (e.proto) parts.push(e.proto);
    e.metaEl.textContent = parts.join(' · ');
  }

  setInterval(() => {
    if (!queue.length || document.hidden) { if (queue.length > 200) queue.splice(0, queue.length - 20); return; }
    const batch = queue.splice(0, queue.length).slice(-12);
    for (const e of batch) ticker.prepend(makeItem(e));
    while (ticker.children.length > CONFIG.tickerMax) ticker.lastChild.remove();
  }, 250);

  setInterval(() => {
    const cutoff = Date.now() - 60000;
    while (stamps.length && stamps[0] < cutoff) stamps.shift();
    while (byteStamps.length && byteStamps[0][0] < cutoff) byteStamps.shift();
    const perMin = byteStamps.reduce((a, b) => a + b[1], 0);
    $('rate').textContent = `· ${nf.format(stamps.length)} pro Minute · ${fmtBytes(perMin)}/min`;
    $('clock').textContent = new Date().toLocaleTimeString('de-DE');
    if (ws && ws.readyState === 1) {
      const quiet = Date.now() - lastEventAt > 120000;
      setStatus(quiet ? 'idle' : 'live', quiet ? 'Live · seit 2 min keine Daten' : 'Live');
    }
  }, 1000);

  function renderInternal() {
    if (!filters.internal) return;
    const ul = $('internal');
    const rows = [...internalSeen.values()].sort((a, b) => b.last - a.last).slice(0, 8);
    if (!rows.length) { ul.replaceChildren(el('li', 'empty', 'Noch nichts gesehen')); return; }
    ul.replaceChildren(...rows.map(r => {
      const li = el('li');
      li.append(el('span', null, `${r.from} → ${r.to} · ${portName(r.port)}`), el('span', null, `${nf.format(r.count)}×`));
      return li;
    }));
  }
  setInterval(renderInternal, 2000);

  // Eingang: Antwort-Bytes der passenden Anfrage zuordnen, dann (geglättet) abspielen
  const byteStamps = [];
  const conns = new Map();                       // Schlüssel -> Anfrage (letzte ~2 min)
  const connKey = e => `${e.local_ip}|${e.remote_ip}|${e.sport}|${e.dport}|${e.proto}`;
  const pending = [];                            // Puffer für gleichmäßiges Abspielen
  let pendingSorted = true;
  const lags = [];
  let playDelay = 10000;                         // Startwert, passt sich nach den ersten Paketen an

  function ingest(e) {
    if (!e || !COLORS[e.dir]) return;
    e.ts = e.timestamp ? Date.parse(e.timestamp) : Date.now();
    if (!isFinite(e.ts)) e.ts = Date.now();
    e.dport = +e.dport || 0; e.sport = +e.sport || 0;
    e.bytes = +e.bytes || 0; e.duration_ms = +e.duration_ms || 0;
    const now = Date.now();
    lastEventAt = now;
    byteStamps.push([now, e.bytes]);
    const key = connKey(e);
    if (e.leg === 'resp') {
      const r = conns.get(key);
      if (r) { r.down = (r.down || 0) + e.bytes; r.duration_ms = Math.max(r.duration_ms, e.duration_ms); renderMeta(r); }
      return;
    }
    e.seen = now;
    conns.set(key, e);
    if (conns.size > 4000) for (const [k, v] of conns) { if (now - v.seen > 120000 || conns.size > 3000) conns.delete(k); else break; }
    if (!settings.smooth) { play(e); return; }
    lags.push(now - e.ts); if (lags.length > 300) lags.shift();
    pending.push(e); pendingSorted = false;
    if (pending.length > 5000) pending.splice(0, pending.length - 5000).forEach(play);
  }

  // Versatz = 90 % der beobachteten Verzögerung + Reserve; so landet jedes Ereignis
  // zu seinem echten Zeitpunkt (Ende der Verbindung) + konstantem Versatz auf dem Globus.
  setInterval(() => {
    if (!lags.length) return;
    const sorted = lags.slice().sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    playDelay = Math.max(1000, Math.min(60000, p90 + 800));
    const info = $('delayInfo'); if (info) info.textContent = settings.smooth ? `Versatz zurzeit ${Math.round(playDelay / 1000)} s` : '';
  }, 2000);

  setInterval(() => {
    if (!pending.length) return;
    if (!pendingSorted) { pending.sort((a, b) => a.ts - b.ts); pendingSorted = true; }
    const now = Date.now();
    while (pending.length && pending[0].ts + playDelay <= now) play(pending.shift());
  }, 50);

  function flushPending() { if (!pendingSorted) pending.sort((a, b) => a.ts - b.ts); pending.splice(0).forEach(play); pendingSorted = true; }

  function play(e) {
    if (e.dir === 'internal') {
      const k = `${e.local_ip}>${e.remote_ip}:${e.dport}`;
      const r = internalSeen.get(k) || { from: e.local_name || e.local_ip, to: e.remote_name || e.remote_ip, port: e.dport, count: 0 };
      r.count++; r.last = Date.now(); internalSeen.set(k, r);
      if (internalSeen.size > 500) { const oldest = [...internalSeen.entries()].sort((a, b) => a[1].last - b[1].last).slice(0, 250); oldest.forEach(([k2]) => internalSeen.delete(k2)); }
    } else {
      addSpot(e);
    }
    if (!visible(e)) return;
    stamps.push(Date.now());
    queue.push(e);
    if (e.dir !== 'internal') emitArc(e);
  }
  const handle = ingest;

  // ---------- Statistiken aus VictoriaLogs ----------
  async function vl(q, limit) {
    const body = new URLSearchParams({ query: q });
    if (limit) body.set('limit', String(limit));
    const r = await fetch(CONFIG.vlUrl, { method: 'POST', body, cache: 'no-store' });
    if (!r.ok) {
      const text = (await r.text()).trim().split('\n').slice(-1)[0] || '';
      throw new Error(`VictoriaLogs ${r.status}${text ? ': ' + text.slice(0, 300) : ''}`);
    }
    return (await r.text()).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  function renderBars(ul, rows, label, value, fmt, query, emptyText = 'Noch keine Daten') {
    fmt = fmt || (v => nf.format(v));
    if (!rows.length) { ul.replaceChildren(el('li', 'empty', emptyText)); return; }
    const max = Math.max(...rows.map(r => +r[value] || 0)) || 1;
    ul.replaceChildren(...rows.map(r => {
      const li = el('li');
      const name = el('span', null, label(r)); name.title = name.textContent;
      const fill = el('i'); fill.style.width = ((+r[value] || 0) / max * 100) + '%';
      const bar = el('span', 'bar'); bar.append(fill);
      li.append(name, el('em', null, fmt(+r[value] || 0)), bar);
      if (query) { const q = query(r); if (q) { li.dataset.q = q[0]; li.dataset.dir = q[1] || ''; li.tabIndex = 0; } }
      return li;
    }));
  }
  document.addEventListener('click', ev => {
    const li = ev.target.closest('.bars li[data-q], .total[data-q]');
    if (!li) return;
    if (li.classList.contains('total')) openHistory('', li.dataset.k);
    else openHistory(li.dataset.q, li.dataset.dir);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.bars li[data-q]')) ev.target.click();
  });

  let hours = { out: [], in: [], blocked: [], internal: [] };
  let hoursBytes = { out: [], in: [], blocked: [], internal: [] };
  let sparkMode = store.get('sparkMode', 'hits');
  function renderSpark() {
    const src = sparkMode === 'bytes' ? hoursBytes : hours;
    const fmt = sparkMode === 'bytes' ? fmtBytes : (v => nf.format(v));
    $('sparkTitle').textContent = sparkMode === 'bytes' ? 'Datenmenge pro Stunde' : 'Verbindungen pro Stunde';
    const dirs = ['out', 'in', 'blocked', 'internal'].filter(d => filters[d] && !(sparkMode === 'bytes' && d === 'blocked'));
    const sums = new Array(24).fill(0);
    dirs.forEach(d => (src[d] || []).forEach((v, i) => { sums[i] += v || 0; }));
    const max = Math.max(1, ...sums);
    $('spark').replaceChildren(...sums.map((sum, i) => {
      const col = el('div', 'col');
      col.title = `${23 - i ? '−' + (23 - i) + ' h' : 'aktuelle Stunde'}: ` + dirs.map(d => `${VERB[d]} ${fmt((src[d] || [])[i] || 0)}`).join(', ');
      dirs.forEach(d => {
        const v = (src[d] || [])[i] || 0;
        if (!v) return;
        const seg = el('i'); seg.style.height = (v / max * 100) + '%'; seg.style.background = COLORS[d];
        col.append(seg);
      });
      return col;
    }));
  }

  function renderTotals(t) {
    for (const k of ['blocked', 'out', 'in', 'internal']) {
      $('t-' + k).textContent = fmtNum(t[k]?.hits || 0);
      const v = $('v-' + k); if (v) v.textContent = t[k]?.bytes ? '· ' + fmtBytes(t[k].bytes) : '';
    }
  }

  const statsState = $('statsState');
  async function loadStats() {
    if (document.hidden) return;
    try {
      const T = '_time:24h';
      const jobs = {
        totals: vl(`${T} | stats by (dir) count() if (leg:req) as hits, sum(bytes) as bytes`),
        hours: vl(`${T} | stats by (_time:1h, dir) count() if (leg:req) as hits, sum(bytes) as bytes`),
        uniq: vl(`${T} (dir:out or dir:"in") | stats count_uniq(remote_ip) as r, count_uniq(r_country) as c, count_uniq(local_ip) as l, count_uniq(r_org) as o`),
        services: vl(`${T} dir:out leg:req | stats by (dport, proto) count() as v | sort by (v desc) | limit 6`),
        biggest: vl(`${T} dir:out | stats by (local_ip, local_name, r_org, remote_ip) sum(bytes) as v | sort by (v desc) | limit 6`),
        longest: vl(`${T} dir:out leg:req duration_ms:>0 | stats by (local_ip, local_name, r_org, remote_ip) sum(duration_ms) as v | sort by (v desc) | limit 6`),
        orgs: vl(`${T} dir:out r_org:* | stats by (r_org) sum(bytes) as v | sort by (v desc) | limit 6`),
        cOut: vl(`${T} dir:out leg:req r_country:* | stats by (r_country, r_country_name) count() as v | sort by (v desc) | limit 6`),
        devices: vl(`${T} (dir:out or dir:"in") | stats by (local_ip, local_name) sum(bytes) as v | sort by (v desc) | limit 6`),
        inbound: vl(`${T} dir:"in" leg:req | stats by (dport, proto) count() as v | sort by (v desc) | limit 6`)
      };
      if (filters.blocked) {
        jobs.cBlk = vl(`${T} dir:blocked | stats by (r_country, r_country_name) count() as v | sort by (v desc) | limit 6`);
        jobs.ports = vl(`${T} dir:blocked | stats by (dport) count() as v | sort by (v desc) | limit 6`);
      }
      if (filters.internal) {
        jobs.internal = vl(`${T} dir:internal leg:req | stats by (local_ip, local_name, remote_ip, remote_name, dport) count() as v | sort by (v desc) | limit 8`);
      }
      const keys = Object.keys(jobs);
      const res = Object.fromEntries((await Promise.all(Object.values(jobs))).map((v, i) => [keys[i], v]));

      const t = {}; res.totals.forEach(r => { t[r.dir] = { hits: +r.hits, bytes: +r.bytes }; }); renderTotals(t);
      const hourStart = Math.floor(Date.now() / 3600000) * 3600000;
      hours = { out: new Array(24).fill(0), in: new Array(24).fill(0), blocked: new Array(24).fill(0), internal: new Array(24).fill(0) };
      hoursBytes = { out: new Array(24).fill(0), in: new Array(24).fill(0), blocked: new Array(24).fill(0), internal: new Array(24).fill(0) };
      res.hours.forEach(r => { const idx = 23 - Math.round((hourStart - Date.parse(r._time)) / 3600000);
        if (hours[r.dir] && idx >= 0 && idx < 24) { hours[r.dir][idx] += +r.hits || 0; hoursBytes[r.dir][idx] += +r.bytes || 0; } });
      const u = res.uniq[0] || {};
      $('uniq').textContent = `${fmtNum(u.r)} Ziele · ${fmtNum(u.o)} Firmen · ${fmtNum(u.c)} Länder · ${fmtNum(u.l)} Geräte`;
      renderSpark();

      renderBars($('topOrgs'), res.orgs, r => r.r_org, 'v', fmtBytes, r => [`r_org:${lq(r.r_org)}`, 'out']);
      renderBars($('topCountriesOut'), res.cOut, r => `${flag(r.r_country)} ${country(r.r_country, r.r_country_name) || 'unbekannt'}`, 'v', null, r => [`r_country:${lq(r.r_country)}`, 'out']);
      renderBars($('topDevices'), res.devices, r => r.local_name || r.local_ip, 'v', fmtBytes, r => [`local_ip:${lq(r.local_ip)}`, '']);
      renderBars($('topServices'), res.services, r => `${portName(+r.dport)} ${r.proto || ''}`, 'v', null, r => [`dport:${+r.dport || 0}`, 'out']);
      const pair = r => `${r.local_name || r.local_ip} → ${r.r_org || r.remote_ip}`;
      renderBars($('topBiggest'), res.biggest, pair, 'v', fmtBytes, r => [`local_ip:${lq(r.local_ip)} remote_ip:${lq(r.remote_ip)}`, 'out']);
      renderBars($('topLongest'), res.longest, pair, 'v', fmtDur, r => [`local_ip:${lq(r.local_ip)} remote_ip:${lq(r.remote_ip)}`, 'out']);
      renderBars($('topIn'), res.inbound, r => `${portName(+r.dport)} ${r.proto || ''}`, 'v', null, r => [`dport:${+r.dport || 0}`, 'in'], 'Nichts – gut so');
      if (res.cBlk) renderBars($('topCountries'), res.cBlk, r => `${flag(r.r_country)} ${country(r.r_country, r.r_country_name) || 'unbekannt'}`, 'v', null, r => r.r_country ? [`r_country:${lq(r.r_country)}`, 'blocked'] : null);
      if (res.ports) renderBars($('topPorts'), res.ports, r => portName(+r.dport), 'v', null, r => [`dport:${+r.dport || 0}`, 'blocked']);
      if (res.internal) renderBars($('topInternal'), res.internal, r => `${r.local_name || r.local_ip} → ${r.remote_name || r.remote_ip} · ${portName(+r.dport)}`, 'v', null,
        r => [`local_ip:${lq(r.local_ip)} remote_ip:${lq(r.remote_ip)} dport:${+r.dport || 0}`, 'internal']);
      statsState.textContent = '';
    } catch (err) {
      console.warn('Statistik nicht geladen:', err);
      statsState.textContent = '· Historie nicht erreichbar';
    }
  }

  // ---------- Verlauf ----------
  const drawer = $('history'), qInput = $('q'), rangeSel = $('range'), dirSel = $('dirSel'), info = $('resultInfo');
  const tbody = document.querySelector('#results tbody');
  let lastFocus = null;

  function openHistory(query, dir) {
    lastFocus = document.activeElement;
    drawer.hidden = false;
    if (query != null) qInput.value = query;
    if (dir != null) dirSel.value = dir;
    qInput.focus();
    if (query != null || dir != null) runSearch();
  }
  function closeHistory() { drawer.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  $('openHistory').addEventListener('click', () => openHistory());
  $('closeHistory').addEventListener('click', closeHistory);
  drawer.addEventListener('click', ev => { if (ev.target === drawer) closeHistory(); });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !drawer.hidden) closeHistory();
    else if (ev.key === '/' && drawer.hidden && !/input|select|textarea/i.test(ev.target.tagName)) { ev.preventDefault(); openHistory(); }
  });
  $('searchForm').addEventListener('submit', ev => { ev.preventDefault(); runSearch(); });

  const FIELDS = ['_msg', '_time', '_stream', 'kind', 'dir', 'bdir', 'leg', 'proto', 'local_ip', 'local_name', 'remote_ip', 'remote_name',
    'sport', 'dport', 'bytes', 'packets', 'rule', 'r_country', 'r_country_name', 'r_city', 'r_org', 'r_asn', 'r_lat', 'r_lon'];
  const FIELD_RE = new RegExp(`(^|[\\s(!-])(${FIELDS.join('|')}):`);

  function buildQuery() {
    const text = qInput.value.trim();
    const parts = [`_time:${rangeSel.value}`];
    if (dirSel.value) parts.push(`dir:${lq(dirSel.value)}`);
    parts.push('-leg:resp');
    let advanced = false;
    if (text) {
      // LogsQL direkt, wenn es danach aussieht (feld:wert, Pipes, Klammern); sonst Wortsuche
      advanced = FIELD_RE.test(text) || /[|()]|\b(AND|OR|NOT)\b/.test(text);
      if (advanced) parts.push(`(${text.replace(/\|.*$/s, '').trim() || '*'})`);
      else for (const w of text.split(/\s+/)) parts.push(lq(w));
    }
    const pipe = advanced && text.includes('|') ? ' | ' + text.slice(text.indexOf('|') + 1).trim() : '';
    return parts.join(' ') + (pipe || ` | sort by (_time desc) | limit ${CONFIG.historyLimit}`);
  }

  let searchSeq = 0;
  async function runSearch() {
    const q = buildQuery();
    const seq = ++searchSeq;
    info.classList.remove('err');
    info.textContent = 'Suche …';
    try {
      const rows = isDemo ? demoSearch() : await vl(q, CONFIG.historyLimit);
      if (seq !== searchSeq) return;
      renderResults(rows);
      info.replaceChildren(
        `${nf.format(rows.length)} Treffer` + (rows.length >= CONFIG.historyLimit ? ` (die neuesten ${CONFIG.historyLimit})` : '') + ' · Abfrage: ',
        el('code', null, q)
      );
      $('vmuiLink').href = 'select/vmui/#/?query=' + encodeURIComponent(q);
    } catch (err) {
      if (seq !== searchSeq) return;
      info.classList.add('err');
      info.textContent = String(err.message || err);
      tbody.replaceChildren();
    }
  }

  function renderResults(rows) {
    tbody.replaceChildren(...rows.map(r => {
      const tr = el('tr');
      const ts = r._time ? new Date(r._time) : null;
      const tdTime = el('td', 'mono', ts ? ts.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
      const tdDir = el('td', null, VERB[r.dir] || r.dir || ''); tdDir.dataset.dir = r.dir || '';
      const tdLocal = el('td'); tdLocal.append(r.local_name || r.local_ip || '');
      if (r.local_name) tdLocal.append(' ', el('small', null, r.local_ip));
      const tdRemote = el('td'); tdRemote.append(r.remote_name || r.remote_ip || '');
      if (r.r_org) tdRemote.append(' ', el('small', null, r.r_org));
      const place = r.dir === 'internal' ? '' : `${flag(r.r_country)} ${[r.r_city, country(r.r_country, r.r_country_name)].filter(Boolean).join(', ')}`;
      const tdPlace = el('td', null, place);
      const tdSvc = el('td', 'mono', `${portName(r.dport)}${r.proto ? ' ' + r.proto : ''}`);
      if (r.rule) tdSvc.title = `Regel: ${r.rule}`;
      const tdBytes = el('td', 'num', r.dir === 'blocked' ? '' : fmtBytes(r.bytes));
      const tdDur = el('td', 'num', fmtDur(r.duration_ms));
      tr.append(tdTime, tdDir, tdLocal, tdRemote, tdPlace, tdSvc, tdBytes, tdDur);
      tr.addEventListener('click', () => { if (r.r_lat != null) { closeHistory(); focusOn(r.r_lat, r.r_lon); } });
      return tr;
    }));
  }

  // ---------- Live-Verbindung ----------
  const statusEl = $('status'), statusText = $('statusText'), hint = $('hint');
  const setStatus = (state, text) => { if (statusEl.dataset.state !== state || statusText.textContent !== text) { statusEl.dataset.state = state; statusText.textContent = text; } };
  function showHint(text, withDemo) {
    hint.hidden = false; hint.replaceChildren(text);
    if (withDemo) { const b = el('button', null, 'Demo starten'); b.addEventListener('click', startDemo); hint.append(b); }
  }
  let ws = null, fails = 0, demoTimer = null, reconnectTimer = null;

  function connect() {
    clearTimeout(reconnectTimer);
    setStatus('connecting', 'Verbinde …');
    try { ws = new WebSocket(CONFIG.wsUrl); } catch { return scheduleReconnect(); }
    ws.onopen = () => { fails = 0; hint.hidden = true; lastEventAt = Date.now(); setStatus('live', 'Live'); };
    ws.onmessage = m => { try { handle(JSON.parse(m.data)); } catch {} };
    ws.onclose = () => { ws = null; if (!demoTimer) scheduleReconnect(); };
    ws.onerror = () => { try { ws && ws.close(); } catch {} };
  }
  function scheduleReconnect() {
    fails++;
    const wait = Math.min(30, 2 ** Math.min(fails, 5));
    setStatus('down', `Getrennt · neuer Versuch in ${wait} s`);
    if (fails >= 3) showHint('Kein Live-Stream unter /ws. Läuft der Collector? (docker compose ps)', true);
    reconnectTimer = setTimeout(() => { if (!demoTimer) connect(); }, wait * 1000);
  }

  // ---------- Demo-Modus ----------
  const SRC_BLOCK = [
    ['CN','Peking',39.9,116.4,'China Telecom',9], ['CN','Shanghai',31.2,121.5,'China Unicom',7],
    ['CN','Guangzhou',23.1,113.3,'Tencent Cloud',5], ['RU','Moskau',55.75,37.6,'Selectel',6],
    ['RU','Sankt Petersburg',59.9,30.3,'Rostelecom',3], ['US','Ashburn',39.0,-77.5,'Amazon AWS',6],
    ['US','San Jose',37.3,-121.9,'Censys',4], ['US','Chicago',41.9,-87.6,'Shodan',3],
    ['NL','Amsterdam',52.37,4.9,'DigitalOcean',5], ['BG','Sofia',42.7,23.3,'Neterra',3],
    ['BR','São Paulo',-23.5,-46.6,'Vivo',3], ['IN','Mumbai',19.1,72.9,'Reliance Jio',3],
    ['VN','Hanoi',21.0,105.8,'VNPT',2], ['KR','Seoul',37.6,127.0,'KT Corp',2],
    ['IR','Teheran',35.7,51.4,'TCI',2], ['SG','Singapur',1.35,103.8,'Alibaba Cloud',2],
    ['DE','Falkenstein',50.5,12.4,'Hetzner',3], ['PR','San Juan',18.47,-66.1,'Liberty',1]
  ];
  const DST_OUT = [
    ['US','Mountain View',37.4,-122.1,'Google LLC',8,443], ['NL','Amsterdam',52.37,4.9,'Netflix',4,443],
    ['US','Cupertino',37.3,-122.0,'Apple Inc.',5,443], ['IE','Dublin',53.35,-6.26,'Microsoft',4,443],
    ['SE','Stockholm',59.33,18.07,'Spotify',3,443], ['US','San Francisco',37.77,-122.42,'GitHub',3,443],
    ['US','Ashburn',39.0,-77.5,'Ubiquiti Cloud',2,443], ['US','Boardman',45.8,-119.7,'Nabu Casa',2,443],
    ['DE','Falkenstein',50.5,12.4,'Hetzner',2,443], ['DE','Frankfurt am Main',50.11,8.68,'Cloudflare',5,7844],
    ['JP','Tokio',35.68,139.7,'Nintendo',1,443], ['US','Mountain View',37.4,-122.1,'Google LLC',3,53]
  ];
  const LOCALS = ['homelable', 'Homeassistant-PI', 'MacBook', 'iPhone', 'QuantumGateway (WAN)'];
  const SCAN_PORTS = [[22,10],[23,5],[3389,6],[80,4],[443,3],[445,4],[8080,3],[5900,2],[1433,2],[7547,2],[6379,1],[8291,1],[2323,2]];
  const INTERNAL = [['Homeassistant-PI','homelable',8006],['MacBook','homelable',8006],['iPhone','Homeassistant-PI',8123],['Homeassistant-PI','homelable',1883]];
  const pickW = (list, wi) => { const sum = list.reduce((s, x) => s + x[wi], 0); let r = Math.random() * sum;
    for (const x of list) { r -= x[wi]; if (r <= 0) return x; } return list[0]; };
  const rndIp = () => [1 + Math.random() * 222, Math.random() * 255, Math.random() * 255, 1 + Math.random() * 253].map(Math.floor).join('.');
  const jitter = v => v + (Math.random() - .5) * 1.5;
  const demo = { totals: { blocked: { hits: 18342 }, out: { hits: 96210, bytes: 48e9 }, in: { hits: 12, bytes: 3e6 }, internal: { hits: 40118, bytes: 9e9 } },
    cBlk: new Map(), ports: new Map(), orgs: new Map(), cOut: new Map(), devices: new Map(), services: new Map(),
    biggest: new Map(), longest: new Map(), log: [] };

  function demoEvent() {
    const roll = Math.random();
    const add = (m, k, field, v, base) => { const r = m.get(k) || Object.assign({ v: 0 }, base); r.v += v; m.set(k, r); };
    const remember = e => { demo.log.unshift(Object.assign({ _time: new Date().toISOString() }, e)); if (demo.log.length > 300) demo.log.pop(); };
    if (roll < 0.30) {
      const s = pickW(SRC_BLOCK, 5), p = pickW(SCAN_PORTS, 1)[0];
      const n = Math.random() < 0.06 ? 8 : 1;               // ab und zu ein Port-Scan in Serie
      const ip = rndIp();
      for (let i = 0; i < n; i++) setTimeout(() => {
        const port = n > 1 ? pickW(SCAN_PORTS, 1)[0] : p;
        const e = { kind: 'blocked', dir: 'blocked', bdir: 'in', leg: 'req', proto: 'TCP', dport: port, remote_ip: ip,
          local_ip: '217.230.40.237', local_name: 'QuantumGateway (WAN)', r_country: s[0], r_city: s[1],
          r_lat: jitter(s[2]), r_lon: jitter(s[3]), r_org: s[4], rule: 'Anklopfer loggen' };
        handle(e); remember(e);
        demo.totals.blocked.hits++; add(demo.cBlk, s[0], 'v', 1, { r_country: s[0] }); add(demo.ports, port, 'v', 1, { dport: port });
        hours.blocked[23]++;
      }, i * 90);
    } else if (roll < 0.86) {
      const d = pickW(DST_OUT, 5), bytes = Math.floor(Math.random() * 2e6), dev = LOCALS[Math.floor(Math.random() * LOCALS.length)];
      const e = { kind: 'flow', dir: 'out', leg: 'req', proto: d[6] === 53 ? 'UDP' : 'TCP', dport: d[6], remote_ip: rndIp(),
        local_ip: '10.37.10.' + (2 + LOCALS.indexOf(dev)), local_name: dev, sport: 40000 + Math.floor(Math.random() * 20000),
        r_country: d[0], r_city: d[1], r_lat: d[2], r_lon: d[3], r_org: d[4], bytes: Math.floor(bytes / 20),
        duration_ms: Math.floor(Math.random() ** 3 * 600000) };
      e.down = Math.random() < 0.15 ? bytes * 60 : bytes;
      handle(e); remember(e);
      demo.totals.out.hits++; demo.totals.out.bytes += bytes * 6; hours.out[23]++; hoursBytes.out[23] += bytes * 6;
      add(demo.services, d[6], 'v', 1, { dport: d[6], proto: e.proto });
      add(demo.biggest, dev + d[4], 'v', e.down + e.bytes, { local_name: dev, r_org: d[4] });
      add(demo.longest, dev + d[4], 'v', e.duration_ms, { local_name: dev, r_org: d[4] });
      add(demo.orgs, d[4], 'v', bytes * 6, { r_org: d[4] }); add(demo.cOut, d[0], 'v', 1, { r_country: d[0] });
      add(demo.devices, dev, 'v', bytes * 6, { local_name: dev, local_ip: e.local_ip });
    } else if (roll < 0.995) {
      const [a, b, port] = INTERNAL[Math.floor(Math.random() * INTERNAL.length)];
      const e = { kind: 'flow', dir: 'internal', leg: 'req', proto: 'TCP', dport: port, local_ip: '10.37.20.' + (a.length % 9 + 2), local_name: a, remote_ip: '10.37.10.' + (b.length % 9 + 2), remote_name: b, bytes: 40000 };
      handle(e); remember(e);
      demo.totals.internal.hits++; hours.internal[23]++;
    } else {
      const e = { kind: 'flow', dir: 'in', leg: 'req', proto: 'UDP', dport: 51820, remote_ip: rndIp(), local_ip: '217.230.40.237',
        local_name: 'QuantumGateway (WAN)', r_country: 'IT', r_city: 'Mailand', r_lat: 45.46, r_lon: 9.19, r_org: 'Vodafone Italia', bytes: 90000 };
      handle(e); remember(e);
      demo.totals.in.hits++; hours.in[23]++;
    }
  }
  function demoStats() {
    renderTotals(demo.totals);
    const top = m => [...m.values()].sort((a, b) => b.v - a.v).slice(0, 6);
    renderBars($('topCountries'), top(demo.cBlk), r => `${flag(r.r_country)} ${country(r.r_country)}`, 'v', null, r => [`r_country:${r.r_country}`, 'blocked']);
    renderBars($('topPorts'), top(demo.ports), r => portName(+r.dport), 'v', null, r => [`dport:${r.dport}`, 'blocked']);
    renderBars($('topOrgs'), top(demo.orgs), r => r.r_org, 'v', fmtBytes, r => [`r_org:${lq(r.r_org)}`, 'out']);
    renderBars($('topCountriesOut'), top(demo.cOut), r => `${flag(r.r_country)} ${country(r.r_country)}`, 'v', null, r => [`r_country:${r.r_country}`, 'out']);
    renderBars($('topDevices'), top(demo.devices), r => r.local_name, 'v', fmtBytes, r => [`local_ip:${lq(r.local_ip)}`, '']);
    renderBars($('topServices'), top(demo.services), r => `${portName(r.dport)} ${r.proto}`, 'v');
    renderBars($('topBiggest'), top(demo.biggest), r => `${r.local_name} → ${r.r_org}`, 'v', fmtBytes);
    renderBars($('topLongest'), top(demo.longest), r => `${r.local_name} → ${r.r_org}`, 'v', fmtDur);
    $('uniq').textContent = `${nf.format(demo.orgs.size * 37)} Ziele · ${demo.orgs.size} Firmen · ${demo.cOut.size} Länder · ${LOCALS.length} Geräte`;
    renderBars($('topIn'), [{ dport: 51820, proto: 'UDP', v: demo.totals.in.hits }], r => `${portName(r.dport)} ${r.proto}`, 'v', null, () => ['dport:51820', 'in']);
    renderBars($('topInternal'), INTERNAL.map(([a, b, p], i) => ({ a, b, p, v: 4000 - i * 700 })), r => `${r.a} → ${r.b} · ${portName(r.p)}`, 'v');
    renderSpark();
  }
  function demoSearch() {
    // Einfache Nachbildung der Suche über die zuletzt erzeugten Demo-Ereignisse
    const words = qInput.value.toLowerCase().split(/\s+/).filter(Boolean).map(w => w.replace(/^[a-z_]+:/, '').replace(/"/g, ''));
    return demo.log.filter(e => (!dirSel.value || e.dir === dirSel.value) &&
      words.every(w => JSON.stringify(e).toLowerCase().includes(w)));
  }
  function startDemo() {
    if (demoTimer) return;
    clearTimeout(reconnectTimer);
    try { ws && ws.close(); } catch {}
    hint.hidden = true; setStatus('demo', 'Demo mit Beispieldaten');
    for (const d of Object.keys(hours)) {
      hours[d] = Array.from({ length: 24 }, () => Math.floor((d === 'out' ? 900 : d === 'blocked' ? 500 : d === 'internal' ? 600 : 1) * (0.5 + Math.random())));
      hoursBytes[d] = hours[d].map(v => d === 'blocked' ? 0 : v * (2e5 + Math.random() * 3e6));
    }
    const tick = () => { demoEvent(); demoTimer = setTimeout(tick, 120 + Math.random() * 380); };
    tick(); setInterval(demoStats, 2000); demoStats();
  }

  // ---------- Einstellungen ----------
  const setBox = $('settings');
  function syncSettingsUi() {
    $('optSmooth').checked = settings.smooth;
    $('optStyle').value = settings.arcStyle;
    $('optRate').value = settings.arcRate; $('optRateVal').textContent = settings.arcRate;
  }
  $('openSettings').addEventListener('click', ev => { ev.stopPropagation(); setBox.hidden = !setBox.hidden; syncSettingsUi(); });
  document.addEventListener('click', ev => { if (!setBox.hidden && !setBox.contains(ev.target)) setBox.hidden = true; });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') setBox.hidden = true; });
  const saveSettings = () => store.set('settings', settings);
  $('optSmooth').addEventListener('change', ev => { settings.smooth = ev.target.checked; if (!settings.smooth) flushPending(); saveSettings(); });
  $('optStyle').addEventListener('change', ev => { settings.arcStyle = ev.target.value; saveSettings(); });
  $('optRate').addEventListener('input', ev => { settings.arcRate = +ev.target.value; $('optRateVal').textContent = settings.arcRate; saveSettings(); });
  $('sparkTitle').addEventListener('click', () => { sparkMode = sparkMode === 'bytes' ? 'hits' : 'bytes'; store.set('sparkMode', sparkMode); renderSpark(); });

  // ---------- Start ----------
  async function loadConfig() {
    if (isDemo) return;
    try {
      const r = await fetch('config.json', { cache: 'no-store' });
      if (!r.ok) return;
      const c = await r.json();
      if (c.home && isFinite(+c.home.lat) && isFinite(+c.home.lng)) CONFIG.home = { lat: +c.home.lat, lng: +c.home.lng, label: String(c.home.label || 'Zuhause') };
      if (c.gateway) CONFIG.gateway = String(c.gateway);
    } catch {}
  }

  loadConfig().then(() => {
    if (isDemo) { CONFIG.home = { lat: 50.11, lng: 8.68, label: 'Frankfurt' }; CONFIG.gateway = 'QuantumGateway'; }
    $('gwName').textContent = CONFIG.gateway;
    document.title = 'Lagezentrum' + (CONFIG.gateway ? ' · ' + CONFIG.gateway : '');
    initGlobe();
    applyFilters();
    if (isDemo) {
      startDemo();
    } else {
      connect();
      loadStats();
      setInterval(loadStats, CONFIG.statsEveryMs);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStats(); });
      // Filter für Abgewehrt/Intern einschalten lädt deren Statistik sofort nach
      document.querySelectorAll('.chip[data-f="blocked"], .chip[data-f="internal"]').forEach(b => b.addEventListener('click', () => { if (filters[b.dataset.f]) loadStats(); }));
    }
  });
})();
