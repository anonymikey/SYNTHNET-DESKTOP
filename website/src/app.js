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
  Promise.all([api('/api/latest'), api('/api/releases')]).then(([latest, all]) => { renderRelease(latest.release); renderHistory(all.releases); if (all.stale || latest.stale) setStatus(`${latest.release && latest.release.version ? `v${latest.release.version}` : 'Latest release'} · cached release metadata`, 'is-ready'); }).catch(() => { setStatus('Release metadata is temporarily unavailable. Try again later.', 'is-error'); if (history) history.innerHTML = '<p class="history-loading">Release history is temporarily unavailable. The page is still available for browsing.</p>'; });
  const year = $('#year'); if (year) year.textContent = String(new Date().getFullYear());

  const tour = $('#site-tour');
  const siteTourCard = $('#site-tour-card');
  // Keep the callout above both the dimming layer and the highlighted target.
  if (siteTourCard) { if (siteTourCard.parentElement !== document.body) document.body.appendChild(siteTourCard); siteTourCard.hidden = true; }
  const tourSteps = [
    { target: '#features', title: 'What SYNTHNET controls', text: 'SYNTHNET turns a Windows PC into a local-first paid Wi-Fi control layer for hotspot access, packages, payments and devices.' },
    { target: '#how-it-works', title: 'How the flow works', text: 'A customer joins the hotspot, reaches the local portal, completes a payment or voucher flow, and receives access for the active package.' },
    { target: '#download', title: 'Get the current build', text: 'The download card checks the official release service and links to the current Windows installer and private release details.' },
    { target: '#history', title: 'Read every release', text: 'Release history explains new features, fixes and performance improvements without sending visitors to the source repository.' }
  ];
  let tourIndex = 0;
  let tourActive = false;
  let welcomeTimer = null;
  function showSiteWelcome() {
    const welcome = $('#site-welcome');
    if (!welcome) return;
    clearTimeout(welcomeTimer); welcome.hidden = false; welcome.classList.remove('is-leaving');
    welcomeTimer = setTimeout(() => { welcome.classList.add('is-leaving'); setTimeout(() => { welcome.hidden = true; welcome.classList.remove('is-leaving'); }, 260); }, 5200);
  }
  function finishSiteTour() {
    if (!tour) return;
    tour.hidden = true;
    if (siteTourCard) siteTourCard.hidden = true;
    tourActive = false; document.documentElement.classList.remove('tour-scroll-locked'); document.body.classList.remove('tour-scroll-locked');
    document.querySelectorAll('.site-tour-target').forEach((node) => node.classList.remove('site-tour-target'));
    try { localStorage.setItem('synthnetWebsiteTour.v1', 'done'); } catch {}
    showSiteWelcome();
  }
  function showSiteTourStep(index) {
    tourIndex = Math.max(0, Math.min(index, tourSteps.length - 1));
    const step = tourSteps[tourIndex], target = document.querySelector(step.target);
    document.querySelectorAll('.site-tour-target').forEach((node) => node.classList.remove('site-tour-target'));
    if (target) { target.classList.add('site-tour-target'); alignSiteTourTarget(target); }
    $('#site-tour-step').textContent = `SYNTHNET TOUR · ${tourIndex + 1} OF ${tourSteps.length}`;
    $('#site-tour-title').textContent = step.title; $('#site-tour-text').textContent = step.text;
    $('#site-tour-back').disabled = tourIndex === 0; $('#site-tour-back').classList.toggle('is-disabled', tourIndex === 0);
    $('#site-tour-next').textContent = tourIndex === tourSteps.length - 1 ? 'Finish tour' : 'Next';
    requestAnimationFrame(() => requestAnimationFrame(positionSiteTourCard));
    setTimeout(positionSiteTourCard, 100);
  }
  function alignSiteTourTarget(target) {
    const rect = target.getBoundingClientRect();
    const desiredTop = Math.max(0, window.scrollY + rect.top - Math.max(24, (window.innerHeight - Math.min(rect.height, window.innerHeight)) / 2));
    window.scrollTo({ top: desiredTop, behavior: 'auto' });
  }
  function positionSiteTourCard() {
    const card = $('#site-tour-card'), target = document.querySelector(tourSteps[tourIndex].target);
    if (!card || !target) return;
    const rect = target.getBoundingClientRect(), gap = 18, margin = 16;
    const cardRect = card.getBoundingClientRect();
    const below = rect.bottom + gap + cardRect.height <= window.innerHeight - margin;
    const top = below ? rect.bottom + gap : Math.max(margin, rect.top - cardRect.height - gap);
    const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - cardRect.width / 2), window.innerWidth - cardRect.width - margin);
    const arrowLeft = Math.min(Math.max(22, rect.left + rect.width / 2 - left - 8), cardRect.width - 38);
    card.dataset.placement = below ? 'bottom' : 'top';
    card.style.setProperty('--arrow-left', `${arrowLeft}px`);
    card.style.top = `${top}px`; card.style.left = `${left}px`;
  }
  function startSiteTour() { if (!tour) return; tourActive = true; document.documentElement.classList.add('tour-scroll-locked'); document.body.classList.add('tour-scroll-locked'); tour.hidden = false; if (siteTourCard) siteTourCard.hidden = false; showSiteTourStep(0); }
  document.querySelectorAll('.tour-launch').forEach((button) => button.addEventListener('click', startSiteTour));
  if ($('#site-tour-skip')) $('#site-tour-skip').addEventListener('click', finishSiteTour);
  if ($('#site-tour-back')) $('#site-tour-back').addEventListener('click', () => showSiteTourStep(tourIndex - 1));
  if ($('#site-tour-next')) $('#site-tour-next').addEventListener('click', () => tourIndex === tourSteps.length - 1 ? finishSiteTour() : showSiteTourStep(tourIndex + 1));
  document.addEventListener('keydown', (event) => { if (tourActive && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) event.preventDefault(); if (event.key === 'Escape' && tour && !tour.hidden) finishSiteTour(); });
  ['wheel', 'touchmove'].forEach((type) => document.addEventListener(type, (event) => { if (tourActive && !event.target.closest('.site-tour-card')) event.preventDefault(); }, { passive: false }));
  window.addEventListener('resize', () => { if (tour && !tour.hidden) positionSiteTourCard(); });
  try { if (localStorage.getItem('synthnetWebsiteTour.v1') !== 'done') setTimeout(startSiteTour, 900); } catch { setTimeout(startSiteTour, 900); }
}());
