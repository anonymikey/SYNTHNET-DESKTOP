'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const set = (id, value) => { const node = $(id); if (node) node.textContent = value; };
  const pill = (id, text, mode) => { const node = $(id); if (node) { node.textContent = text; node.className = `status-pill ${mode}`; } };
  const ms = (value) => `${Math.max(0, Math.round(value))} ms`;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  set('app-version', params.get('appVersion') ? `v${esc(params.get('appVersion'))}` : 'Opened from website');
  set('app-platform', params.get('platform') ? esc(params.get('platform')) : 'Not provided');
  set('app-arch', params.get('arch') ? esc(params.get('arch')) : 'Not provided');
  if (params.get('appVersion')) pill('app-pill', 'CONNECTED', 'is-good');
  set('connection-type', connection ? `${connection.effectiveType || 'available'}${connection.downlink ? ` · ${connection.downlink} Mbps` : ''}` : 'Browser did not provide details');
  const navigation = performance.getEntriesByType('navigation')[0];
  if (navigation) { set('page-load', ms(navigation.loadEventEnd || performance.now())); set('dom-ready', ms(navigation.domContentLoadedEventEnd || performance.now())); pill('browser-pill', 'MEASURED', 'is-good'); }
  const date = (value) => { if (!value) return 'Time not provided'; const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Time not provided' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
  function renderIncidents(list) {
    const box = $('incident-list'), active = (list || []).filter((x) => x.status !== 'resolved');
    pill('incident-pill', active.length ? `${active.length} ACTIVE INCIDENT${active.length === 1 ? '' : 'S'}` : 'NO ACTIVE INCIDENTS', active.length ? 'is-warn' : 'is-good');
    if (!box) return;
    if (!list || !list.length) { box.innerHTML = '<div class="incident-empty"><span class="incident-empty-icon">✓</span><div><strong>No incidents reported</strong><p>All SYNTHNET services are operating normally.</p></div></div>'; return; }
    box.innerHTML = list.map((incident) => `<article class="incident ${incident.status === 'resolved' ? 'is-resolved' : 'is-active'}"><div class="incident-marker" aria-hidden="true"></div><div class="incident-body"><div class="incident-top"><h3>${esc(incident.title)}</h3><span class="status-pill ${incident.status === 'resolved' ? 'is-good' : 'is-warn'}">${esc(String(incident.status || 'investigating').toUpperCase())}</span></div><p class="incident-meta">${esc(incident.impact || 'minor')} impact · started ${esc(date(incident.startedAt))}${incident.resolvedAt ? ` · resolved ${esc(date(incident.resolvedAt))}` : ''}</p>${(incident.updates || []).slice().reverse().map((u) => `<div class="incident-update"><strong>${esc(u.status || 'Update')}</strong><span>${esc(date(u.createdAt))}</span><p>${esc(u.message)}</p></div>`).join('')}</div></article>`).join('');
  }
  function renderUptime(uptime) {
    if (!uptime) return;
    const box = $('uptime-metrics'); if (!box) return;
    box.innerHTML = `<div><strong>${esc(uptime.website || '—')}</strong><span>Website · ${esc(uptime.period || 'rolling period')}</span></div><div><strong>${esc(uptime.platformApi || '—')}</strong><span>Platform API · ${esc(uptime.period || 'rolling period')}</span></div>`;
  }
  const check = async () => {
    const started = performance.now();
    try {
      const statusResponse = await fetch('/api/status', { cache: 'no-store', headers: { accept: 'application/json' } });
      const statusTime = performance.now() - started;
      set('status-latency', ms(statusTime));
      if (!statusResponse.ok) throw new Error('status endpoint unavailable');
      const statusData = await statusResponse.json(); renderIncidents(statusData.incidents); renderUptime(statusData.uptime);
      const releaseStarted = performance.now();
      const releaseResponse = await fetch('/api/latest', { cache: 'no-store', headers: { accept: 'application/json' } });
      set('website-latency', ms(statusTime));
      set('release-state', releaseResponse.ok ? `Available · ${ms(performance.now() - releaseStarted)}` : `Unavailable (${releaseResponse.status})`);
      const good = releaseResponse.ok && statusData.status === 'operational';
      pill('platform-pill', good ? 'OPERATIONAL' : 'DEGRADED', good ? 'is-good' : 'is-warn');
      const overall = $('overall');
      if (overall) overall.innerHTML = `<span class="overall-dot ${good ? 'is-good' : 'is-warn'}"></span><strong>${good ? 'All public checks operational' : 'Some checks need attention'}</strong><small>Last checked just now</small>`;
      set('checked-at', `Last checked ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`);
    } catch (error) {
      set('website-latency', 'Unavailable'); set('status-latency', 'Unavailable'); set('release-state', 'Unavailable'); pill('platform-pill', 'DEGRADED', 'is-warn');
      const overall = $('overall'); if (overall) overall.innerHTML = '<span class="overall-dot is-warn"></span><strong>Some public checks need attention</strong><small>Try refreshing shortly</small>';
      set('checked-at', 'Check could not complete');
    }
  };
  $('refresh-status')?.addEventListener('click', check); check(); setInterval(check, 60000);
  set('year', new Date().getFullYear());
}());
