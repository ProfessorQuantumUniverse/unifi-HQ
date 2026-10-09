/* Lagezentrum – Login. Nach Erfolg zurück zur ursprünglich aufgerufenen Seite (?next=). */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const raw = new URLSearchParams(location.search).get('next') || '/';
  // nur Pfade auf dieser Seite, keine fremden Adressen (//host, /\host, /<Tab>/host)
  const next = /^\/(?![/\\])[^\x00-\x20\x7f]*$/.test(raw) && !/^\/(login\.html|auth\/)/.test(raw) ? raw : '/';
  const form = $('loginForm'), pw = $('pw'), err = $('err'), btn = $('go');
  const go = () => location.replace(next);

  // Schon angemeldet (oder kein Passwort gesetzt)? Dann gleich weiter.
  fetch('auth/session', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(s => { if (s && s.authenticated) go(); })
    .catch(() => {});

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!pw.value) return;
    err.textContent = '';
    btn.disabled = true; btn.textContent = 'Prüfe …';
    try {
      const r = await fetch('auth/login', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw.value })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { btn.textContent = 'Angemeldet'; go(); return; }
      err.textContent = j.error || `Anmeldung fehlgeschlagen (HTTP ${r.status})`;
      pw.select();
    } catch {
      err.textContent = 'Server nicht erreichbar';
    }
    btn.disabled = false; btn.textContent = 'Anmelden';
  });
})();
