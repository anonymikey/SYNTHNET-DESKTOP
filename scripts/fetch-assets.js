// Unauthenticated clients have NO internet, so the portal must not rely on a CDN.
// This downloads the Tailwind CDN script once (on the host, which has internet) and serves it locally.
const fs = require('fs'), path = require('path');
(async () => {
  try {
    const res = await fetch('https://cdn.tailwindcss.com/3.4.17');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const dir = path.join(__dirname, '..', 'public', 'vendor');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tailwind.js'), await res.text());
    console.log('[assets] Tailwind cached locally.');
  } catch (e) {
    console.warn('[assets] Could not cache Tailwind (' + e.message + '). Portal will try the CDN instead.');
  }
})();
