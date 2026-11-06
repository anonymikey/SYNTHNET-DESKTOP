require('dotenv').config();
const express = require('express');
const path = require('path');
const sessions = require('./src/sessions');
const vouchers = require('./src/vouchers');
const pay = require('./src/pay');
const { classify } = require('./src/deviceType');
const { portal, resolveTheme, DATA_DIR } = require('./src/config');
const themeImages = require('./src/themeImages');
const adminRouter = require('./src/admin');
const outage = require('./src/outage');
const notify = require('./src/notify');
const sms = require('./src/sms');
const greeting = require('./src/greeting');
const reconnect = require('./src/reconnect');
const events = require('./src/events');
const sound = require('./src/sound');
const tvlink = require('./src/tvlink');
const { normMac } = require('./src/mac');

const PORT = +process.env.PORT || 80;
const HOTSPOT_IP = process.env.HOTSPOT_IP || '192.168.137.1';
const PORTAL_URL = `http://${HOTSPOT_IP}${PORT === 80 ? '' : ':' + PORT}`;

const app = express();
app.disable('x-powered-by');
// 3mb (not 10kb) because the admin theme editor uploads a background image as base64 JSON (base64 inflates size
// by ~1/3, so a 2MB image needs ~2.7MB of JSON); every other route's body is a handful of bytes regardless, so
// this only affects how much a request COULD send, not normal traffic.
app.use(express.json({ limit: '3mb' }));

const ipOf = (req) => sessions.normIp(req.socket.remoteAddress);
const isPortalHost = (req) => [HOTSPOT_IP, 'localhost', '127.0.0.1'].includes(req.hostname);

/* OS connectivity probes: trigger the "Sign in to Wi-Fi" popup */
const okHtml = (res) => res.type('html').send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
function noCache(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return res;
}

const probes = {
  '/generate_204': (res) => res.status(204).end(), '/gen_204': (res) => res.status(204).end(),
  '/hotspot-detect.html': okHtml, '/library/test/success.html': okHtml,
  '/connecttest.txt': (res) => res.type('text').send('Microsoft Connect Test'),
  '/ncsi.txt': (res) => res.type('text').send('Microsoft NCSI'),
  '/canonical.html': (res) => res.type('html').send('<meta http-equiv="refresh" content="0;url=about:blank">')
};
app.use(async (req, res, next) => {
  const p = probes[req.path.replace(/\/+$/, '').toLowerCase()];
  if (!p) return next();
  try {
    const session = await restoreSession(ipOf(req));
    if (session) return p(res);
    return noCache(res).redirect(302, `${PORTAL_URL}/login`);
  } catch (e) {
    console.error('[auth] Could not restore session for connectivity probe:', e.message);
    return noCache(res).redirect(302, `${PORTAL_URL}/login`);
  }
});

app.get(['/', '/login', '/my-devices'], async (req, res) => {
  let session = null;
  try {
    session = await restoreSession(ipOf(req));
  } catch (e) {
    console.error('[auth] Could not restore session for portal page:', e.message);
  }
  if (!isPortalHost(req) && !session) return noCache(res).redirect(302, `${PORTAL_URL}/login`);
  noCache(res).sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));

/* ---- Portal API ---- */
app.get('/api/config', (_req, res) => {
  const p = portal();
  res.json({ brand: p.brand, payment: p.payment, tiers: p.tiers, payments: { enabled: pay.enabled() },
    greeting: greeting.publicConfig(), sound: sound.publicConfig(), reconnect: { phones: reconnect.effective() },
    sms: { receipts: sms.configured() && notify.settings().enabled && notify.settings().purchase.enabled }, theme: { ...resolveTheme(p), animations: p.theme?.animations !== false }, portalUrl: `${PORTAL_URL}/login` });
});

/* Admin-uploaded background image, if any (set via the dashboard's theme editor). */
app.get('/theme-bg', (req, res) => {
  const p = portal();
  if (!p.theme?.customBackground || !p.theme?.customExt) return res.status(404).end();
  noCache(res).sendFile(path.join(DATA_DIR, 'theme-bg' + p.theme.customExt), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});
app.get('/theme-library/:filename', (req, res) => {
  const image = themeImages.imagePath(req.params.filename);
  if (!image) return res.status(404).end();
  noCache(res).sendFile(image, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});
/* Admin-uploaded logo, if any (set via the dashboard's portal-content editor). */
app.get('/brand-logo', (req, res) => {
  const p = portal();
  if (!p.brand?.logoUrl || !p.brand?.logoExt) return res.status(404).end();
  noCache(res).sendFile(path.join(DATA_DIR, 'brand-logo' + p.brand.logoExt), (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

/* The admin's custom "connected" sound, if any (public so customers' phones can fetch it before they are online). */
app.get('/connect-sound', (_req, res) => {
  const f = sound.filePath();
  if (!f) return res.status(404).end();
  noCache(res).type(f.mime).sendFile(f.file, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

const attempts = new Map();
const THROTTLE_MS = Number(process.env.THROTTLE_WINDOW_MS) || 60000;          // tests shrink this; production uses one minute
function throttled(key, max) {
  const now = Date.now(); let a = attempts.get(key);
  if (!a || a.reset < now) a = { n: 0, reset: now + THROTTLE_MS };
  a.n++; attempts.set(key, a); return a.n > max;
}

// Never let a notification problem break a customer request.
const ev = (e) => { try { events.emit(e); } catch (err) { console.error('[events]', err.message); } };
const tierLabel = (id) => ((portal().tiers || []).find((t) => t.id === id) || {}).name || id;

async function grant(ip, mac, code, deviceType) {
  const before = await vouchers.getInfo(code).catch(() => null);
  const r = await vouchers.redeem(code, mac || ip, deviceType);
  if (!r.ok) ev({ category: 'security', level: 'warning', silent: true, ringAt: 5, title: 'Wrong voucher code entered', message: `From ${ip}: ${String(r.error || 'invalid code').replace(/[.\s]+$/, '')}. Repeated attempts may be someone guessing codes.`, dedupeKey: 'badcode:' + ip, dedupeMs: 10 * 60000 });
  if (r.ok) {
    const first = before && !before.startedAt;
    if (first) vouchers.carryOverTvs(r.code).then((n) => { if (n) tvlink.syncNow(); }).catch(() => {});   // a returning customer keeps their registered TVs
    const who = `${deviceType === 'mobile' ? 'phone' : 'laptop/TV'} (${ip})`;
    ev(first ? { category: 'customers', level: 'success', title: 'Voucher redeemed', message: `${tierLabel(r.tier)} · ${r.code} · ${who}`, dedupeKey: 'redeem:' + r.code, dedupeMode: 'skip' }
      : { category: 'customers', level: 'info', silent: true, title: 'Customer connected with voucher', message: `${tierLabel(r.tier)} · ${r.code} · ${who}`, dedupeKey: 'login:' + r.code + ':' + (mac || ip), dedupeMs: 30 * 60000, dedupeMode: 'skip' });
    await outage.trackVoucher(r.code);
    sessions.set(ip, { key: mac || ip, code: r.code, expiresAt: r.expiresAt });
    sessions.clearRevoked(mac || ip);
    console.log(`[auth] ${ip} (${mac || 'no-mac'}, ${deviceType}) -> ${r.code}`);
  }
  return r;
}

app.get('/api/status', async (req, res) => {
  const ip = ipOf(req);
  try {
    const s = await restoreSession(ip);
    const voucher = s ? await vouchers.getInfo(s.code) : null;
    res.json({
      authenticated: !!s,
      expiresAt: s ? sessions.effectiveExpiresAt(ip) : null,
      voucher,
      outage: outage.status()
    });
  } catch (e) {
    console.error('[auth] Could not check or restore device session:', e.message);
    res.status(503).json({ authenticated: false, error: 'Could not check your package right now. Please retry.' });
  }
});

app.post('/api/login', async (req, res) => {
  const ip = ipOf(req);
  if (throttled('login:' + ip, 5)) return res.status(429).json({ ok: false, error: 'Too many attempts. Wait a minute.' });
  const code = req.body && req.body.code;
  if (!code || typeof code !== 'string') return res.status(400).json({ ok: false, error: 'Enter a voucher code.' });
  try {
    const r = await grant(ip, await sessions.getMac(ip), code, classify(req.get('user-agent')));
    if (!r.ok) return res.status(401).json(r);
    res.json({ ok: true, ...r, expiresAt: sessions.effectiveExpiresAt(ip), voucher: await vouchers.getInfo(r.code), outage: outage.status() });
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: 'Server error.' }); }
});

async function restoreSession(ip) {
  if (sessions.isAuthed(ip)) return sessions.get(ip);
  const key = (await sessions.getMac(ip)) || ip;
  const found = await vouchers.findActiveByDevice(key);
  if (!found || sessions.isRevoked(key)) return null;
  sessions.set(ip, { key, ...found });
  ev({ category: 'customers', level: 'info', silent: true, title: 'Device reconnected automatically', message: `${tierLabel(found.tier)} · ${found.code} · ${ip}`, dedupeKey: 'auto:' + key, dedupeMs: 60 * 60000, dedupeMode: 'skip' });
  return sessions.get(ip);
}

// Adds "this device" and "TV is online right now" to the device list shown in My devices.
const decorateDevices = (devices, session) => (devices || []).map((d) => ({ ...d, isCurrent: d.key === session.key, ...(d.viaMac ? { online: tvlink.info(d.key).online } : {}) }));

app.get('/api/my-devices', async (req, res) => {
  try {
    const ip = ipOf(req), session = await restoreSession(ip);
    if (!session) return res.status(401).json({ ok: false, error: 'Connect with your voucher first to manage its devices.' });
    const devices = await vouchers.getDevices(session.code);
    if (!devices) return res.status(404).json({ ok: false, error: 'This package is no longer active.' });
    const info = await vouchers.getInfo(session.code);
    res.json({ ok: true, code: session.code, tier: info && info.tier, tierName: ((portal().tiers || []).find((t) => t.id === (info && info.tier)) || {}).name || null, devices: decorateDevices(devices, session),
      maxDevices: Math.max(1, parseInt(process.env.MAX_DEVICES_PER_VOUCHER, 10) || 2), expiresAt: sessions.effectiveExpiresAt(ip) });
  } catch (e) {
    console.error('[devices] Could not load devices:', e.message);
    res.status(500).json({ ok: false, error: 'Could not load your devices. Please try again.' });
  }
});

app.post('/api/my-devices/add', async (req, res) => {
  const ip = ipOf(req);
  if (throttled('login:' + ip, 5)) return res.status(429).json({ ok: false, error: 'Too many attempts. Wait a minute.' });
  if (classify(req.get('user-agent')) === 'mobile')
    return res.status(403).json({ ok: false, error: 'Only a laptop or TV can be added as the companion device. A second phone needs its own package.' });
  const code = req.body && req.body.code;
  if (!code || typeof code !== 'string') return res.status(400).json({ ok: false, error: 'Enter the voucher code for your active package.' });
  try {
    const voucher = await vouchers.getInfo(code);
    if (!voucher || !voucher.startedAt || voucher.expiresAt <= Date.now())
      return res.status(409).json({ ok: false, error: 'Use the voucher for a package that is already active on your phone.' });
    const key = (await sessions.getMac(ip)) || ip;
    const result = await vouchers.redeem(code, key, 'other');
    if (!result.ok) return res.status(409).json({ ok: false, error: result.error });
    await outage.trackVoucher(result.code);
    sessions.set(ip, { key, code: result.code, expiresAt: result.expiresAt });
    sessions.clearRevoked(key);
    ev({ category: 'customers', level: 'info', silent: true, title: 'TV or laptop added to a package', message: `${result.code} · ${ip}`, dedupeKey: 'compadd:' + result.code + ':' + key, dedupeMs: 60 * 60000, dedupeMode: 'skip' });
    const devices = await vouchers.getDevices(result.code);
    res.json({ ok: true, code: result.code, devices, expiresAt: sessions.effectiveExpiresAt(ip), voucher: await vouchers.getInfo(result.code), outage: outage.status() });
  } catch (e) {
    console.error('[devices] Could not add companion:', e.message);
    res.status(500).json({ ok: false, error: 'Could not add this device. Please try again.' });
  }
});

/* Register a TV (or console/stick) by MAC address: for devices that cannot open the sign-in page. */
app.post('/api/my-devices/add-tv', async (req, res) => {
  const ip = ipOf(req);
  if (throttled('addtv:' + ip, 8)) return res.status(429).json({ ok: false, error: 'Too many attempts. Wait a minute.' });
  try {
    const session = await restoreSession(ip);
    if (!session) return res.status(401).json({ ok: false, error: 'Connect with your package first, then add your TV.' });
    const m = normMac(req.body && req.body.mac);
    if (!m) return res.status(400).json({ ok: false, error: "That is not a valid MAC address. It has 12 letters and digits, like AA:BB:CC:DD:EE:FF. Find it in your TV's network settings." });
    const label = String((req.body && req.body.label) || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 30);
    const r = await vouchers.addTvByMac(session.code, m.mac, label);
    if (!r.ok) return res.status(409).json({ ok: false, error: r.error });
    sessions.clearRevoked(m.mac);
    tvlink.syncNow();                                            // do not make the customer wait for the next 4-second round
    ev({ category: 'customers', level: 'info', silent: true, title: 'TV registered by MAC address', message: `${label || m.mac} · ${session.code}`, dedupeKey: 'tvadd:' + session.code + ':' + m.mac, dedupeMs: 60 * 60000, dedupeMode: 'skip' });
    const devices = await vouchers.getDevices(session.code);
    res.json({ ok: true, mac: m.mac, localAdmin: m.localAdmin, devices: decorateDevices(devices, session), maxDevices: Math.max(1, parseInt(process.env.MAX_DEVICES_PER_VOUCHER, 10) || 2) });
  } catch (e) {
    console.error('[devices] Could not add TV:', e.message);
    res.status(500).json({ ok: false, error: 'Could not add this TV. Please try again.' });
  }
});

app.post('/api/my-devices/remove', async (req, res) => {
  try {
    const ip = ipOf(req), session = await restoreSession(ip);
    if (!session) return res.status(401).json({ ok: false, error: 'Connect with your voucher first to manage its devices.' });
    const key = req.body && req.body.key;
    if (typeof key !== 'string' || !key || key.length > 64)
      return res.status(400).json({ ok: false, error: 'Select a companion device to remove.' });
    const removed = await vouchers.removeCompanion(session.code, key);
    if (!removed) return res.status(404).json({ ok: false, error: 'That companion device is no longer on this package.' });
    for (const [clientIp, clientSession] of sessions.all())
      if (clientSession.code === session.code && clientSession.key === key) sessions.remove(clientIp);
    ev({ category: 'customers', level: 'info', silent: true, title: 'TV or laptop removed from a package', message: `${session.code} · ${ip}` });
    const devices = await vouchers.getDevices(session.code);
    res.json({ ok: true, devices });
  } catch (e) {
    console.error('[devices] Could not remove companion:', e.message);
    res.status(500).json({ ok: false, error: 'Could not remove this device. Please try again.' });
  }
});

/* In-portal M-Pesa purchase (Courtney Tech STK Push) */
app.post('/api/pay/start', async (req, res) => {
  const ip = ipOf(req);
  if (throttled('pay:' + ip, 4)) return res.status(429).json({ ok: false, message: 'Too many attempts. Wait a minute.' });
  const { tier, phone } = req.body || {};
  const r = await pay.start({ tier, phone, ip, mac: await sessions.getMac(ip), deviceType: classify(req.get('user-agent')) });
  res.status(r.ok ? 200 : 400).json(r);
});
app.get('/api/pay/status', async (req, res) => {
  const ip = ipOf(req);
  res.json(await pay.poll(String(req.query.id || ''), ip, await sessions.getMac(ip), classify(req.get('user-agent'))));
});

/* Courtney Tech webhook. Open endpoint by design, but it grants NOTHING by itself: it only makes us re-check our own
   pending payment with /v2/status (server-to-server, with the API secret). Forged posts from the hotspot are harmless. */
app.post('/api/callbacks/courtneytech', (req, res) => {
  res.sendStatus(200);                                                  // reply fast (they require < 5 s)
  if (!pay.webhookKeyOk(req.query.k)) return;
  pay.onCallback(req.body).then((r) => { if (r.matched) console.log('[pay] webhook verified ->', r.status); })
    .catch((e) => console.error('[pay] webhook error:', e.message));
});

app.post('/api/logout', (req, res) => {
  const ip = ipOf(req), s = sessions.get(ip);
  if (s) ev({ category: 'customers', level: 'info', silent: true, title: 'Customer logged out', message: `${s.code} · ${ip}`, dedupeKey: 'logout:' + ip, dedupeMs: 10 * 60000, dedupeMode: 'skip' });
  sessions.remove(ip); res.json({ ok: true });
});

/* Reconnect a still-valid package by the M-Pesa number that paid for it.
   - Laptop / TV: relinks the companion slot by number (unchanged).
   - Phone: replaces the phone slot (e.g. after the phone's Wi-Fi MAC address changed). Proves ownership with an SMS code
     sent to that number unless the admin chose number-only (see src/reconnect.js).
   Flow for phones: POST {phone} -> { needCode:true } and an SMS -> POST {phone, code} -> linked. */
app.post('/api/reconnect', async (req, res) => {
  const ip = ipOf(req);
  if (throttled('reconnect:' + ip, 8)) return res.status(429).json({ ok: false, message: 'Too many attempts. Wait a minute.' });
  const isMobile = classify(req.get('user-agent')) === 'mobile', mode = reconnect.effective();
  if (isMobile && mode === 'off')
    return res.status(403).json({ ok: false, message: 'Phone-number reconnect is for a laptop or TV companion only. Use the voucher code on a phone.' });
  const body = req.body || {}, msisdn = pay._normPhone(body.phone);
  if (!msisdn) return res.status(400).json({ ok: false, message: 'Enter a valid Safaricom number, e.g. 0712345678.' });
  try {
    const hit = await vouchers.findByPhone(msisdn);
    if (!hit) return res.status(404).json({ ok: false, message: 'No package was found for this phone number.' });
    if (hit.status === 'expired')
      return res.status(410).json({ ok: false, message: 'The package for this phone number has expired.' });
    if (hit.status === 'disabled')
      return res.status(403).json({ ok: false, message: 'This package has been disabled. Please contact support.' });

    const key = (await sessions.getMac(ip)) || ip;
    let rebound;
    if (isMobile) {
      const bound = ((await vouchers.getDevices(hit.code)) || []).some((d) => d.key === key);   // already one of its devices: nothing to prove
      if (!bound && mode === 'sms') {
        if (!sms.configured()) return res.status(503).json({ ok: false, message: 'SMS verification is not available right now. Please use your voucher code or contact support.' });
        if (!body.code) {
          const sent = await reconnect.sendCode(msisdn);
          if (!sent.ok) return res.status(sent.wait ? 429 : 503).json({ ok: false, message: sent.message, ...(sent.wait ? { needCode: true, wait: sent.wait } : {}) });
          ev({ category: 'customers', level: 'info', silent: true, title: 'Reconnect code sent', message: `${sent.masked} · ${hit.code}`, dedupeKey: 'otp:' + msisdn, dedupeMs: 60000, dedupeMode: 'skip' });
          return res.json({ ok: false, needCode: true, masked: sent.masked, resendIn: sent.resendIn, message: `We sent a 6-digit code to ${sent.masked}. Enter it below.` });
        }
        const check = reconnect.checkCode(msisdn, body.code);
        if (!check.ok) ev({ category: 'security', level: 'warning', silent: true, ringAt: 5, title: 'Wrong reconnect codes entered', message: `For ${reconnect.maskLocal(msisdn)} from ${ip}. Repeated attempts may mean someone is trying to take over a package.`, dedupeKey: 'badotp:' + msisdn, dedupeMs: 15 * 60000 });
        if (!check.ok) return res.status(401).json({ ok: false, needCode: true, expired: !!check.expired, message: check.message });
      }
      rebound = await vouchers.rebindMobile(hit.code, key);
    } else {
      rebound = await vouchers.rebind(hit.code, key, 'other');
    }
    if (!rebound || !rebound.ok)
      return res.status(409).json({ ok: false, message: 'This package cannot be linked to another device. Check its device limit or contact support.' });
    if (rebound.replacedKey) {
      for (const [clientIp, session] of sessions.all())
        if (session.code === hit.code && session.key === rebound.replacedKey) sessions.remove(clientIp);
    }
    await outage.trackVoucher(hit.code);
    sessions.set(ip, { key, code: hit.code, expiresAt: hit.expiresAt });
    sessions.clearRevoked(key);
    console.log(`[reconnect] ${ip} (${key}, ${isMobile ? 'phone' : 'laptop/tv'}) relinked to ${hit.code} by phone number`);
    ev({ category: 'customers', level: 'success', title: 'Customer reconnected by phone number', message: `${tierLabel(hit.tier)} · ${reconnect.maskLocal(msisdn)} · ${isMobile ? 'phone' : 'laptop/TV'} · ${hit.code}`, dedupeKey: 'reconn:' + hit.code + ':' + key, dedupeMs: 30 * 60000, dedupeMode: 'skip' });
    res.json({
      ok: true,
      message: isMobile ? 'Welcome back! Your phone is connected to your package.' : 'Your laptop or TV has been successfully linked to your package.',
      ...hit,
      expiresAt: sessions.effectiveExpiresAt(ip),
      voucher: await vouchers.getInfo(hit.code),
      outage: outage.status()
    });
  } catch (e) {
    console.error('[reconnect] Could not link package:', e.message);
    res.status(500).json({ ok: false, message: 'Could not reconnect right now. Please try again.' });
  }
});

app.use(adminRouter); // /admin + /api/admin (host-only, token protected)

/* Wildcard interceptor: anything else from an unauthenticated client -> portal */
app.use((req, res) => {
  if (sessions.isAuthed(ipOf(req))) return res.status(404).type('text').send('Not found');
  noCache(res);
  if (isPortalHost(req)) return res.redirect(302, '/login');
  res.redirect(302, `${PORTAL_URL}/login`);
});

// Last resort for a route that threw: tell the admin (once per kind of error per 10 minutes) and answer like Express would.
app.use((err, req, res, _next) => {
  console.error('[server] unhandled error:', err && err.stack || err);
  ev({ category: 'system', level: 'critical', title: 'Something went wrong on the server', message: `${req.method} ${String(req.path).slice(0, 60)}: ${(err && err.message) || err}`, dedupeKey: 'server-error:' + ((err && err.message) || '').slice(0, 60), dedupeMs: 10 * 60000 });
  if (res.headersSent) return;
  res.status(500).type('text').send('Server error');
});

function start() {
  return new Promise((resolve, reject) => {
    const tok = process.env.ADMIN_TOKEN || '';
    if (tok.length < 8 || tok === 'change-me-please') console.warn('[admin] ADMIN_TOKEN missing/placeholder: admin API disabled until set in .env');
    const srv = app.listen(PORT, '0.0.0.0', () => {
      const version = require('./package.json').version;
      events.start({ vouchers, isPaused: () => outage.status().active, version });   // update notice + package-expiry activity
      ev({ category: 'system', level: 'info', silent: true, title: 'Platform started', message: `v${version} · M-Pesa ${pay.enabled() ? 'on' : 'off'} · SMS ${sms.configured() ? 'on' : 'off'}` });
      if (!pay.enabled()) ev({ category: 'system', level: 'warning', title: 'M-Pesa checkout is not set up', message: 'Customers see the manual payment steps only. Add your Courtney Tech keys in the settings file to take payments in the portal.', dedupeKey: 'pay-off', dedupeMs: 7 * 864e5, dedupeMode: 'skip' });
      tvlink.start({ paused: () => outage.status().active });      // connects registered TVs by MAC address
      pay.resume();                                                // keep watching payments that were mid-PIN at restart
      notify.start({ isPaused: () => outage.status().active });   // SMS outbox worker + expiry-reminder sweep
      console.log(`\nSYNTHNET portal -> ${PORTAL_URL}/login`);
      console.log(`Admin dashboard -> http://localhost${PORT === 80 ? '' : ':' + PORT}/admin  (host laptop only)`);
      console.log(`Voucher backend: ${process.env.VOUCHER_BACKEND || 'local'}  |  M-Pesa STK: ${pay.enabled() ? 'ON' : 'off (manual instructions)'}  |  SMS: ${sms.configured() ? 'ON' : 'off (set token + sender ID in Admin)'}\n`);
      resolve(srv);
    });
    srv.on('error', reject);
  });
}

module.exports = { start, PORT, PORTAL_URL };
if (require.main === module) {   // start.bat / npm start: portal + internet gate (the desktop app does this itself)
  start().then(() => require('./src/gate').start()).then(async (g) => {
    const gate = require('./src/gate'), guard = require('./src/guard'), hotspot = require('./src/hotspot');
    if (g.active) console.log('[gate] ACTIVE: unpaid devices see only the portal');
    else {
      console.error('[gate] OFF: ' + g.reason);
      if (guard.required()) { console.error('[guard] GATE_REQUIRED=true: stopping the hotspot so nobody gets free internet.'); await hotspot.run('stop'); }
    }
    guard.start(gate, hotspot);
  }).catch((e) => { console.error('Cannot start:', e.message); process.exit(1); });
}
process.on('uncaughtException', (e) => console.error('[fatal-ish]', e));
