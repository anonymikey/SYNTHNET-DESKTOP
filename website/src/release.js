'use strict';
(function () {
  const root = document.querySelector('#release-detail');
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const safeMarkdown = (value) => escapeHtml(String(value || 'Release notes were not provided.').slice(0, 12000))
    .replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
  const date = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Date not published' : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(d); };
  const params = new URLSearchParams(location.search); const wanted = (params.get('version') || params.get('tag') || '').replace(/^v/i, '').toLowerCase();
  const api = (path) => fetch(path, { headers: { accept: 'application/json' } }).then((r) => { if (!r.ok) throw new Error('request failed'); return r.json(); });
  const render = (payload) => {
    const releases = Array.isArray(payload.releases) ? payload.releases : [];
    const release = releases.find((item) => String(item.version || '').toLowerCase() === wanted || String(item.tag || '').toLowerCase() === (params.get('tag') || '').toLowerCase()) || releases[0];
    if (!release) { root.innerHTML = '<div class="release-empty"><p class="eyebrow">RELEASE ARCHIVE</p><h1>No published release yet.</h1><p>Published release details will appear here when a build is available.</p><a class="button button-primary" href="/">Return home</a></div>'; return; }
    const version = `v${escapeHtml(release.version || release.tag || '')}`;
    const previous = releases.slice(releases.indexOf(release) + 1);
    root.innerHTML = `<div class="release-detail-head"><div><p class="eyebrow">SYNTHNET RELEASE</p><h1>${version}<br><em>${escapeHtml(release.name || 'Desktop release')}</em></h1><p class="release-meta">Published ${escapeHtml(date(release.publishedAt))}</p></div><div class="release-detail-actions"><a class="button button-primary" href="/api/download?version=${encodeURIComponent(release.version || release.tag || '')}">Download this release ↗</a><a class="text-link" href="/#history">Back to all releases ↓</a></div></div><article class="release-notes"><p class="eyebrow">WHAT'S INCLUDED</p><div class="release-notes-copy"><p>${safeMarkdown(release.notes || 'Release notes were not provided.')}</p></div></article>${previous.length ? `<section class="release-earlier"><p class="eyebrow">EARLIER RELEASES</p><h2>See what came before.</h2><div class="release-mini-list">${previous.map((item) => `<a class="release-mini" href="/release?version=${encodeURIComponent(item.version || item.tag || '')}"><span><strong>v${escapeHtml(item.version || item.tag || '')}</strong><small>${escapeHtml(item.name || 'SYNTHNET release')}</small></span><span>View details ↗</span></a>`).join('')}</div></section>` : ''}`;
  };
  api('/api/releases').then(render).catch(() => { root.innerHTML = '<div class="release-empty"><p class="eyebrow">RELEASE ARCHIVE</p><h1>Release details are temporarily unavailable.</h1><p>Return to the website and try again shortly.</p><a class="button button-primary" href="/">Return home</a></div>'; });
  const year = document.querySelector('#year'); if (year) year.textContent = String(new Date().getFullYear());
}());
