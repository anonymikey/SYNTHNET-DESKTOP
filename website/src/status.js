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
  const check = async () => {
    const started = performance.now();
    try {
      const statusResponse = await fetch('/api/status', { cache: 'no-store', headers: { accept: 'application/json' } });
      const statusTime = performance.now() - started;
      set('status-latency', ms(statusTime));
      if (!statusResponse.ok) throw new Error('status endpoint unavailable');
      const releaseStarted = performance.now();
      const releaseResponse = await fetch('/api/latest', { cache: 'no-store', headers: { accept: 'application/json' } });
      set('website-latency', ms(statusTime));
      set('release-state', releaseResponse.ok ? `Available · ${ms(performance.now() - releaseStarted)}` : `Unavailable (${releaseResponse.status})`);
      const good = releaseResponse.ok;
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
