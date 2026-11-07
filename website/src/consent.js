'use strict';
(function () {
  const KEY = 'synthnet-cookie-consent-v1';
  const existing = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  if (existing) return;
  const banner = document.createElement('aside');
  banner.className = 'cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Privacy and cookie notice');
  banner.innerHTML = '<div><strong>Your privacy, kept simple.</strong><p>SYNTHNET uses only an essential local preference to remember this choice. We do not use advertising cookies, analytics trackers, or third-party marketing pixels.</p><a href="/policy">Read the privacy policy</a></div><button type="button" class="button button-primary">Understood</button>';
  const close = () => { try { localStorage.setItem(KEY, 'essential-only'); } catch {} banner.remove(); };
  banner.querySelector('button').addEventListener('click', close);
  document.body.appendChild(banner);
}());
