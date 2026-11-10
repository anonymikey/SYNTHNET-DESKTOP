'use strict';
(function () {
  const $ = (selector, root) => (root || document).querySelector(selector);
  const menu = $('.menu-toggle');
  const mobileNav = $('#mobile-nav');
  if (menu && mobileNav) {
    menu.addEventListener('click', function () {
      const expanded = menu.getAttribute('aria-expanded') === 'true';
      menu.setAttribute('aria-expanded', String(!expanded));
      menu.setAttribute('aria-label', expanded ? 'Open navigation menu' : 'Close navigation menu');
      mobileNav.hidden = expanded;
    });
    mobileNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      menu.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-label', 'Open navigation menu');
      mobileNav.hidden = true;
    }));
  }

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const safeMarkdown = (value) => escapeHtml(String(value || '').slice(0, 6000))
    .replace(/^### (.+)$/gm, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm, '<strong>$1</strong>')
    .replace(/^# (.+)$/gm, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const formatDate = (value) => {
    if (!value) return 'Date not published';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date not published' : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  };
  const status = $('#release-state');
  const history = $('#release-history');
  const download = $('#download-button');
  const releaseLink = $('#release-link');
  const desktopBanner = $('#desktop-update-banner');
  const desktopBannerTitle = $('#desktop-update-title');
  const desktopBannerCopy = $('#desktop-update-copy');
  const desktopBannerLink = $('#desktop-update-link');
  const desktopBannerDismiss = $('#desktop-update-dismiss');
  const desktopQuery = new URLSearchParams(window.location.search);
  const installedDesktopVersion = desktopQuery.get('appVersion');
  const compareVersions = (left, right) => {
    const a = String(left || '').replace(/^v/i, '').split('-')[0].split('.').map((part) => Number(part) || 0);
    const b = String(right || '').replace(/^v/i, '').split('-')[0].split('.').map((part) => Number(part) || 0);
    for (let i = 0; i < 3; i += 1) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); }
    return 0;
  };
  const bannerStorageKey = (version) => `synthnet:desktop-update:${String(version || '').replace(/^v/i, '')}`;
  const hideDesktopBanner = () => { if (desktopBanner) desktopBanner.hidden = true; };
  const renderDesktopUpdateBanner = (release) => {
    if (!desktopBanner || !installedDesktopVersion || !release || !release.version) return hideDesktopBanner();
    const latestVersion = String(release.version).replace(/^v/i, '');
    const key = bannerStorageKey(latestVersion);
    try {
      Object.keys(localStorage).filter((entry) => entry.startsWith('synthnet:desktop-update:') && entry !== key).forEach((entry) => localStorage.removeItem(entry));
      if (compareVersions(latestVersion, installedDesktopVersion) <= 0) { localStorage.removeItem(key); return hideDesktopBanner(); }
      if (localStorage.getItem(key) === 'dismissed') return hideDesktopBanner();
    } catch { /* private browsing can disable localStorage; the banner should still work */ }
    desktopBannerTitle.textContent = `SYNTHNET v${latestVersion} is ready for your desktop.`;
    desktopBannerCopy.textContent = `You are running v${String(installedDesktopVersion).replace(/^v/i, '')}. Open the private release page to update and keep your local data safe.`;
    desktopBannerLink.href = `/release?version=${encodeURIComponent(latestVersion)}&from=desktop-update`;
    desktopBanner.hidden = false;
    if (desktopBannerDismiss) desktopBannerDismiss.onclick = () => { try { localStorage.setItem(key, 'dismissed'); } catch {} hideDesktopBanner(); };
  };
  const setStatus = (text, mode) => { if (status) { status.className = `release-state ${mode || ''}`; status.textContent = text; } };
  const api = (path) => fetch(path, { headers: { accept: 'application/json' } }).then((response) => { if (!response.ok) throw new Error('request failed'); return response.json(); });
  const renderRelease = (release) => {
    if (!release) return;
    const version = release.version ? `v${escapeHtml(release.version)}` : 'Latest release';
    setStatus(`${version} · published ${formatDate(release.publishedAt)}`, 'is-ready');
    if (download) { download.classList.remove('is-disabled'); download.removeAttribute('aria-disabled'); download.href = `/api/download?version=${encodeURIComponent(release.version || release.tag || '')}`; }
    if (releaseLink) { releaseLink.href = `/release?version=${encodeURIComponent(release.version || release.tag || '')}`; releaseLink.removeAttribute('target'); releaseLink.removeAttribute('rel'); releaseLink.textContent = `View ${version} release details →`; releaseLink.setAttribute('aria-label', `View ${version} release details`); }
  };
  const renderHistory = (releases) => {
    if (!history) return;
    if (!Array.isArray(releases) || !releases.length) { history.innerHTML = '<p class="history-loading">No published releases are available yet.</p>'; return; }
    history.innerHTML = releases.map((release) => { const version = release.version ? `v${release.version}` : (release.tag || 'release'); const pageLabel = `View ${version} release details`; const internalUrl = `/release?version=${encodeURIComponent(release.version || release.tag || '')}`; return `<article class="release-item"><div><div class="release-date">${escapeHtml(formatDate(release.publishedAt))}</div><div class="release-tag">${escapeHtml(release.tag || release.version || '')}</div></div><div><h3>${escapeHtml(release.name || 'SYNTHNET release')}</h3><p>${safeMarkdown(release.notes || 'Release notes were not provided.')}</p></div><a class="release-link" href="${internalUrl}" aria-label="${escapeHtml(pageLabel)}">${escapeHtml(pageLabel)} ↗</a></article>`; }).join('');
  };
  Promise.all([api('/api/latest'), api('/api/releases')]).then(([latest, all]) => { renderRelease(latest.release); renderDesktopUpdateBanner(latest.release); renderHistory(all.releases); if (all.stale || latest.stale) setStatus(`${latest.release && latest.release.version ? `v${latest.release.version}` : 'Latest release'} · cached release metadata`, 'is-ready'); }).catch(() => { hideDesktopBanner(); setStatus('Release metadata is temporarily unavailable. Try again later.', 'is-error'); if (history) history.innerHTML = '<p class="history-loading">Release history is temporarily unavailable. The page is still available for browsing.</p>'; });
  const year = $('#year'); if (year) year.textContent = String(new Date().getFullYear());

}());
