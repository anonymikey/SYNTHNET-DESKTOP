const express = require('express');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const sessions = require('./sessions');
const vouchers = require('./vouchers');
const hotspot = require('./hotspot');
const gate = require('./gate');
const pay = require('./pay');
const guard = require('./guard');
const outage = require('./outage');
const notify = require('./notify');
const smsAdmin = require('./smsAdmin');
const greeting = require('./greeting');
const income = require('./income');
const finance = require('./finance');
const reconnect = require('./reconnect');
const events = require('./events');
const audit = require('./audit');
const sound = require('./sound');
const { normMac } = require('./mac');
const { normPhone } = require('./phone');
const { portal, savePortal, resolveTheme, DATA_DIR } = require('./config');
const { TEMPLATES, IDS, WEEKDAY_NAMES } = require('./themes');
const themeImages = require('./themeImages');
const { setEnv } = require('./envfile');

const router = express.Router();
const PLACEHOLDER = 'change-me-please';
const UI = path.join(__dirname, '..', 'admin-ui');
const isMac = (s) => /^[0-9a-f]{2}(-[0-9a-f]{2}){5}$/i.test(s || '');

function localAddresses() {
  const set = new Set(['127.0.0.1', '::1']);
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) set.add(i.address);
  return set;
}

/* Host-only by default (tenants on the hotspot get 403) */
router.use(['/admin', '/api/admin'], (req, res, next) => {
  const localOnly = String(process.env.ADMIN_LOCAL_ONLY || 'true').toLowerCase() !== 'false';
  // A tunnel (cloudflared/ngrok) reaches us from 127.0.0.1 but adds proxy headers: never treat that as the laptop.
  const proxied = !!(req.get('x-forwarded-for') || req.get('cf-connecting-ip') || req.get('x-real-ip'));
  if (localOnly && (proxied || !localAddresses().has(sessions.normIp(req.socket.remoteAddress))))
    return res.status(403).type('text').send('Admin is only available from the host laptop.');
  next();
});

router.get('/admin', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(UI, 'index.html')));
router.get('/admin/admin.js', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(UI, 'admin.js')));
router.get('/admin/greeting.js', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(UI, 'greeting.js')));
router.get('/admin/insights.js', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(UI, 'insights.js')));
router.get('/admin/sms.js', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(UI, 'sms.js')));

const fails = new Map();
function tokenOk(given) {
  const a = Buffer.from(String(given || '')), b = Buffer.from(process.env.ADMIN_TOKEN || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
router.use('/api/admin', (req, res, next) => {
  const tok = process.env.ADMIN_TOKEN || '';
  if (tok.length < 8 || tok === PLACEHOLDER)
    return res.status(503).json({ error: 'Set a strong ADMIN_TOKEN (8+ characters) in .env, then restart.' });
  const ip = sessions.normIp(req.socket.remoteAddress), now = Date.now();
  let f = fails.get(ip); if (!f || f.reset < now) f = { n: 0, reset: now + 60000 };
  if (f.n >= 10) {
    events.emit({ category: 'security', level: 'critical', title: 'Admin sign-in locked after 10 wrong tokens', message: `From ${ip}. It unlocks after a minute. If this was not you, change ADMIN_TOKEN.`, dedupeKey: 'adminlock:' + ip, dedupeMs: 5 * 60000, dedupeMode: 'skip' });
    return res.status(429).json({ error: 'Too many bad tokens. Wait a minute.' });
  }
  if (!tokenOk(req.get('x-admin-token'))) {
    f.n++; fails.set(ip, f);
    events.emit({ category: 'security', level: 'warning', silent: true, ringAt: 3, title: 'Wrong admin token entered', message: `From ${ip}. If this was not you, change ADMIN_TOKEN.`, dedupeKey: 'adminfail:' + ip, dedupeMs: 10 * 60000 });
    return res.status(401).json({ error: 'Invalid admin token.' });
  }
  events.emit({ category: 'security', level: 'info', silent: true, title: 'Admin panel opened', message: `From ${ip}`, dedupeKey: 'adminopen', dedupeMs: 30 * 60000, dedupeMode: 'skip' });
  next();
});

// Every successful admin change becomes an activity entry (src/audit.js).
router.use('/api/admin', (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => { try { audit.record(req, res, body); } catch (e) { console.error('[audit]', e.message); } return json(body); };
  next();
});

router.use('/api/admin/sms', smsAdmin);

router.post('/api/admin/security/admin-token', (req, res) => {
  const nextToken = req.body && req.body.newToken;
  if (typeof nextToken !== 'string' || nextToken.trim() !== nextToken || !/^[\x20-\x7E]{12,128}$/.test(nextToken) || /["\\]/.test(nextToken))
    return res.status(400).json({ error: 'Use 12–128 characters. Quotes, backslashes, and leading/trailing spaces are not allowed.' });

  const envFile = process.env.SYNTHNET_DATA
    ? path.join(DATA_DIR, '.env')
    : path.resolve(process.cwd(), '.env');
  try {
    const contents = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    const line = `ADMIN_TOKEN="${nextToken}"`;
    const setting = /^[ \t]*ADMIN_TOKEN[ \t]*=.*$/m;
    const updated = setting.test(contents)
      ? contents.replace(setting, line)
      : `${contents}${contents && !contents.endsWith('\n') ? '\n' : ''}${line}\n`;
    fs.writeFileSync(envFile, updated);
    process.env.ADMIN_TOKEN = nextToken;
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin] Could not save admin password:', e.message);
    res.status(500).json({ error: 'Could not save the new password. Check the settings file permissions and try again.' });
  }
});

router.post('/api/admin/pay/credentials', (req, res) => {
  const body = req.body || {};
  const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const secret = typeof body.apiSecret === 'string' ? body.apiSecret.trim() : '';
  const account = typeof body.accountId === 'string' ? body.accountId.trim() : String(body.accountId || '').trim();
  if (!key || !secret || !/^\d+$/.test(account) || Number(account) < 1 || Number(account) > Number.MAX_SAFE_INTEGER)
    return res.status(400).json({ error: 'Enter the Courtney Tech API key, API secret, and a positive numeric payment account ID.' });
  if ([key, secret, account].some((value) => /["\\\r\n]/.test(value) || !/^[\x20-\x7E]+$/.test(value)))
    return res.status(400).json({ error: 'Credentials contain unsupported characters. Paste the values exactly as provided by Courtney Tech.' });
  try {
    setEnv('COURTNEYTECH_API_KEY', key);
    setEnv('COURTNEYTECH_API_SECRET', secret);
    setEnv('COURTNEYTECH_ACCOUNT_ID', account);
    res.json({ ok: true, enabled: pay.enabled(), message: 'Courtney Tech credentials saved locally. Test the connection below.' });
  } catch (e) {
    console.error('[admin] Could not save Courtney Tech credentials:', e.message);
    res.status(500).json({ error: 'Could not save the credentials. Check the local settings file permissions and try again.' });
  }
});

router.get('/api/admin/clients', async (_req, res) => {
  const gwIp = process.env.HOTSPOT_IP || '192.168.137.1';
  const prefix = gwIp.split('.').slice(0, 3).join('.') + '.';
  const now = Date.now(), rows = new Map();
  for (const [ip, s] of sessions.all()) {
    if (!sessions.isAuthed(ip)) continue;
    rows.set(ip, { ip, mac: isMac(s.key) ? s.key : null, authenticated: true, code: s.code, expiresAt: sessions.effectiveExpiresAt(ip), ...(s.tv ? { tv: true, label: s.label || null } : {}) });
  }
  for (const n of await sessions.neighbors(prefix, gwIp)) {
    const r = rows.get(n.ip);
    if (r) r.mac = r.mac || n.mac; else rows.set(n.ip, { ip: n.ip, mac: n.mac, authenticated: false });
  }
  const last = (ip) => +ip.split('.').pop();
  const clients = [...rows.values()].sort((a, b) => (b.authenticated - a.authenticated) || (last(a.ip) - last(b.ip)));
  res.json({ clients, now, gate: gate.status(), outage: outage.status() });
});

router.post('/api/admin/revoke', async (req, res) => {
  const { ip, banVoucher } = req.body || {};
  if (typeof ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return res.status(400).json({ error: 'Bad IP.' });
  const s = sessions.get(ip);
  if (!s) return res.status(404).json({ error: 'No active session for that IP.' });
  sessions.revoke(ip);
  if (banVoucher && s.code) await vouchers.disable(s.code);
  console.log(`[admin] revoked ${ip}${banVoucher ? ' + banned ' + s.code : ''}`);
  res.json({ ok: true });
});

router.get('/api/admin/vouchers', async (_req, res) => res.json({ vouchers: await vouchers.list(100) }));
router.post('/api/admin/vouchers', async (req, res) => {
  const tier = portal().tiers.find((t) => t.id === (req.body || {}).tier);
  if (!tier) return res.status(400).json({ error: 'Unknown tier.' });
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 1, 1), 200);
  // Optional: SMS a single code straight to the buyer (manual Till flow). Tying the phone to the voucher also enables
  // expiry reminders and the number-based Reconnect for their laptop/TV.
  const rawPhone = String(req.body.phone || '').trim(), phone = rawPhone ? pay._normPhone(rawPhone) : null;
  if (rawPhone && !phone) return res.status(400).json({ error: 'That is not a valid Safaricom number (e.g. 0712345678).' });
  if (phone && count !== 1) return res.status(400).json({ error: 'To SMS a code, generate exactly 1 voucher.' });
  try {
    const codes = await vouchers.create({ tier: tier.id, minutes: tier.minutes, count, ...(phone ? { phone } : {}) });
    let smsQueued = false;
    if (phone) smsQueued = !!(await notify.voucherCode({ phone, code: codes[0], tier: tier.id }).catch((e) => { console.error('[sms] voucher message not queued:', e.message); return null; }));
    res.json({ tier: tier.id, codes, smsQueued });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Award free time to a specific tenant. target is either an IP from the Clients list (activates that device right
// now) or an M-Pesa number (the tenant claims it with the voucher code on a phone, or the number-only Reconnect
// box on a laptop/TV — its clock starts immediately). deviceType lets the admin award a
// companion device (TV/laptop) directly without it occupying the "mobile" slot.
const isIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s || '');
router.post('/api/admin/award', async (req, res) => {
  const { target, deviceType, note } = req.body || {};
  const tier = portal().tiers.find((t) => t.id === (req.body || {}).tier);
  if (!tier) return res.status(400).json({ error: 'Unknown tier.' });
  const type = deviceType === 'mobile' ? 'mobile' : 'other';
  const trimmed = String(target || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'Enter a device IP (from Clients) or an M-Pesa number.' });

  try {
    if (isIPv4(trimmed)) {
      const key = (await sessions.getMac(trimmed)) || trimmed;
      const [code] = await vouchers.create({ tier: tier.id, minutes: tier.minutes, count: 1, awarded: true, ...(note ? { note } : {}) });
      const r = await vouchers.redeem(code, key, type);
      if (!r.ok) return res.status(409).json({ error: r.error });
      await outage.trackVoucher(code);
      sessions.set(trimmed, { key, code: r.code, expiresAt: r.expiresAt });
      sessions.clearRevoked(key);
      console.log(`[admin] awarded ${tier.id} to ${trimmed} (${key}) -> ${code}, activated immediately`);
      return res.json({ ok: true, code, expiresAt: sessions.effectiveExpiresAt(trimmed), activated: true });
    }
    const phone = pay._normPhone(trimmed);
    if (!phone) return res.status(400).json({ error: 'That doesn\u2019t look like an IP or a valid phone number (e.g. 0712345678).' });
    const [code] = await vouchers.create({ tier: tier.id, minutes: tier.minutes, count: 1, phone, awarded: true, ...(note ? { note } : {}) });
    const r = await vouchers.redeem(code, 'phone:' + phone, type);   // starts the clock now; placeholder key never matches a real device
    if (!r.ok) return res.status(409).json({ error: r.error });
    await outage.trackVoucher(code);
    console.log(`[admin] awarded ${tier.id} to ${phone} -> ${code} (clock started; phone uses voucher code, companion may use number reconnect)`);
    const smsQueued = !!(await notify.award({ phone, code, tier: tier.id }).catch((e) => { console.error('[sms] award message not queued:', e.message); return null; }));
    res.json({ ok: true, code, expiresAt: r.expiresAt, activated: false, smsQueued });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/admin/payments', (_req, res) => res.json({ enabled: pay.enabled(), payments: pay.list(50) }));
router.get('/api/admin/pay/accounts', async (_req, res) => {
  try { res.json({ accounts: await pay.accounts() }); } catch (e) { res.status(502).json({ error: e.message }); }
});

router.get('/api/admin/hotspot', async (_req, res) => res.json({ ...(await hotspot.run('status')), defaults: hotspot.defaults() }));
router.post('/api/admin/hotspot', async (req, res) => {
  const { action, ssid, password } = req.body || {};
  if (!['apply', 'start', 'stop'].includes(action)) return res.status(400).json({ error: 'Bad action.' });
  const g = gate.status();
  if ((action === 'start' || action === 'apply') && guard.required() && !g.active)
    return res.status(409).json({ ok: false, message: 'Hotspot NOT started: the internet gate is not active, so unpaid devices would get free internet. ' + g.reason, defaults: hotspot.defaults() });
  console.log(`[admin] hotspot ${action}`);
  res.json({ ...(await hotspot.run(action, { ssid, password })), defaults: hotspot.defaults() });
});

router.get('/api/admin/outage', (_req, res) => res.json(outage.status()));
router.post('/api/admin/outage', async (req, res) => {
  const action = (req.body || {}).action;
  if (!['start', 'resolve'].includes(action)) return res.status(400).json({ error: 'Choose start or resolve.' });
  const wantSms = (req.body || {}).notify !== false;                 // the dashboard checkbox; default on
  const trySms = (fn) => wantSms ? fn().catch((e) => { console.error('[sms] outage message not queued:', e.message); return { queued: 0 }; }) : Promise.resolve({ queued: 0, skipped: true });
  try {
    if (action === 'start') { const st = await outage.start(); return res.json({ ...st, sms: await trySms(() => notify.outageStarted()) }); }
    const done = await outage.resolve();
    return res.json({ ...done, sms: await trySms(() => notify.outageEnded({ id: done.id, codes: done.codes })) });
  } catch (e) {
    const status = /already active|no active outage|update is already in progress/i.test(e.message) ? 409 : 500;
    console.error('[admin] outage action failed:', e.message);
    res.status(status).json({ error: e.message });
  }
});

/* ---------------- Portal content: brand, logo, payment details, prices ---------------- */
router.get('/api/admin/portal', (_req, res) => res.json({ portal: portal(), templates: TEMPLATES }));

const TIER_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
router.post('/api/admin/portal', (req, res) => {
  const { brand, payment, tiers } = req.body || {};
  const patch = {};
  if (brand) {
    if (brand.name != null && !String(brand.name).trim()) return res.status(400).json({ error: 'Brand name cannot be empty.' });
    patch.brand = {
      ...(brand.name != null ? { name: String(brand.name).trim().slice(0, 60) } : {}),
      ...(brand.tagline != null ? { tagline: String(brand.tagline).trim().slice(0, 120) } : {})
    };
  }
  if (payment) {
    patch.payment = {
      ...(payment.method != null ? { method: String(payment.method).trim().slice(0, 40) } : {}),
      ...(payment.till != null ? { till: String(payment.till).trim().slice(0, 20) } : {}),
      ...(payment.accountName != null ? { accountName: String(payment.accountName).trim().slice(0, 60) } : {}),
      ...(payment.supportPhone != null ? { supportPhone: String(payment.supportPhone).trim().slice(0, 20) } : {}),
      ...(Array.isArray(payment.instructions) ? { instructions: payment.instructions.map((s) => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, 10) } : {})
    };
  }
  if (tiers) {
    if (!Array.isArray(tiers) || !tiers.length) return res.status(400).json({ error: 'At least one package is required.' });
    const ids = new Set();
    for (const t of tiers) {
      if (!TIER_ID.test(t.id || '')) return res.status(400).json({ error: `Bad package id "${t.id}" (letters/numbers/_/- only).` });
      if (ids.has(t.id)) return res.status(400).json({ error: `Duplicate package id "${t.id}".` });
      ids.add(t.id);
      if (!String(t.name || '').trim()) return res.status(400).json({ error: `Package "${t.id}" needs a name.` });
      if (!(Number(t.priceKsh) > 0)) return res.status(400).json({ error: `Package "${t.id}" needs a price above 0.` });
      if (!(Number.isInteger(Number(t.minutes)) && Number(t.minutes) > 0)) return res.status(400).json({ error: `Package "${t.id}" needs a whole-number duration in minutes above 0.` });
    }
    patch.tiers = tiers.map((t) => ({
      id: t.id, name: String(t.name).trim().slice(0, 60), priceKsh: Math.round(Number(t.priceKsh)), minutes: Math.round(Number(t.minutes)),
      ...(t.note ? { note: String(t.note).trim().slice(0, 60) } : {}), ...(t.badge ? { badge: String(t.badge).trim().slice(0, 20) } : {}),
      ...(t.dataCapGB ? { dataCapGB: Math.round(Number(t.dataCapGB)) } : {})
    }));
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to save.' });
  res.json({ ok: true, portal: savePortal(patch) });
});

function decodeDataUrl(dataUrl, maxBytes) {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim());
  if (!m) return { error: 'Upload a PNG, JPG or WEBP image.' };
  const ext = (m[1] === 'jpeg' ? 'jpg' : m[1]);
  let buf; try { buf = Buffer.from(m[2], 'base64'); } catch { return { error: 'Could not decode that image.' }; }
  if (!buf.length) return { error: 'That file is empty.' };
  if (buf.length > maxBytes) return { error: `Image is too large (max ${(maxBytes / 1e6).toFixed(1)} MB).` };
  return { ext, buf };
}

router.post('/api/admin/logo', (req, res) => {
  const d = decodeDataUrl((req.body || {}).dataUrl, 1.5 * 1024 * 1024);
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    fs.writeFileSync(path.join(DATA_DIR, 'brand-logo.' + d.ext), d.buf);
    const cur = portal();
    const version = (cur.brand?.logoVersion || 0) + 1;
    const next = savePortal({ brand: { logoUrl: '/brand-logo?v=' + version, logoExt: '.' + d.ext, logoVersion: version } });
    res.json({ ok: true, logoUrl: next.brand.logoUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/api/admin/logo/clear', (_req, res) => res.json({ ok: true, portal: savePortal({ brand: { logoUrl: null } }) }));

/* ---------------- Link a TV to a customer's package by MAC address (support tool) ---------------- */
router.post('/api/admin/tv', async (req, res) => {
  try {
    const { target, mac, label } = req.body || {}, m = normMac(mac);
    if (!m) return res.status(400).json({ error: 'That is not a valid MAC address (12 letters/digits, e.g. AA:BB:CC:DD:EE:FF).' });
    let code = null; const phone = normPhone(target);
    if (phone) { const hit = await vouchers.findByPhone(phone); if (!hit || hit.status !== 'active') return res.status(404).json({ error: 'That number has no active package.' }); code = hit.code; }
    else if (/^[A-Za-z0-9-]{6,32}$/.test(String(target || ''))) { const info = await vouchers.getInfo(target); if (!info || !info.startedAt || info.expiresAt <= Date.now()) return res.status(404).json({ error: 'That voucher is not an active package.' }); code = info.code; }
    else return res.status(400).json({ error: 'Enter the customer\'s phone number or their voucher code.' });
    const r = await vouchers.addTvByMac(code, m.mac, String(label || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 30));
    if (!r.ok) return res.status(409).json({ error: r.error });
    sessions.clearRevoked(m.mac); require('./tvlink').syncNow();
    res.json({ ok: true, code, mac: m.mac });
  } catch (e) { console.error('[admin] link TV failed:', e.message); res.status(500).json({ error: 'Could not link that TV.' }); }
});

/* ---------------- "You are connected" sound ---------------- */
const soundTry = (res, fn) => { try { res.json({ ok: true, sound: fn() }); } catch (e) { res.status(400).json({ error: e.message }); } };
router.get('/api/admin/sound', (_req, res) => res.json({ sound: sound.get(), presets: sound.PRESETS, maxUploadKb: sound.MAX_UPLOAD / 1024 }));
router.post('/api/admin/sound', (req, res) => soundTry(res, () => sound.save(req.body || {})));
router.post('/api/admin/sound/upload', (req, res) => soundTry(res, () => sound.setCustom((req.body || {}).dataUrl, (req.body || {}).name)));
router.post('/api/admin/sound/clear', (_req, res) => soundTry(res, () => sound.clearCustom()));
router.get('/admin/tv.js', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(UI, 'tv.js')));
router.get('/admin/sound.js', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(UI, 'sound.js')));

/* ---------------- Notification bell ---------------- */
const nOverview = () => ({ counts: events.counts(), prefs: events.prefs(), categories: events.CATEGORIES });
router.get('/api/admin/notifications', (req, res) => res.json({ ...events.list({ limit: req.query.limit, beforeRev: +req.query.before || 0, category: req.query.category, unread: req.query.unread === '1' }), ...nOverview() }));
router.get('/api/admin/notifications/poll', (req, res) => res.json({ counts: events.counts(), ...events.list({ limit: 30, sinceRev: +req.query.since || 0 }) }));
router.post('/api/admin/notifications/read', (req, res) => { const b = req.body || {}; res.json({ ok: true, marked: events.markRead({ ids: b.ids, all: !!b.all, category: b.category }), counts: events.counts() }); });
router.post('/api/admin/notifications/seen', (_req, res) => { events.markSeen(); res.json({ ok: true, counts: events.counts() }); });
router.post('/api/admin/notifications/clear', (req, res) => res.json({ ok: true, removed: events.clear({ scope: (req.body || {}).scope === 'all' ? 'all' : 'read' }), counts: events.counts() }));
router.post('/api/admin/notifications/prefs', (req, res) => { try { events.setMuted((req.body || {}).muted); res.json({ ok: true, ...nOverview() }); } catch (e) { res.status(400).json({ error: e.message }); } });
router.get('/admin/notifications.js', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(UI, 'notifications.js')));

/* ---------------- Business overview: daily income + growth (Nairobi days) ---------------- */
router.get('/api/admin/income', async (req, res) => {
  try { res.json(await income.report({ days: req.query.days, includeManual: req.query.manual === '1', date: req.query.date })); }
  catch (e) { console.error('[income]', e); res.status(500).json({ error: 'Could not build the income report.' }); }
});

/* ---------------- Cost settings behind the profit figures ---------------- */
const finTry = (res, fn) => { try { res.json({ ok: true, finance: fn() }); } catch (e) { res.status(400).json({ error: e.message }); } };
router.get('/api/admin/finance', (_req, res) => res.json({ finance: finance.get() }));
router.post('/api/admin/finance', (req, res) => finTry(res, () => finance.setRates(req.body || {})));
router.post('/api/admin/finance/expense', (req, res) => finTry(res, () => finance.addExpense(req.body || {})));
router.delete('/api/admin/finance/expense/:id', (req, res) => finTry(res, () => finance.removeExpense(req.params.id)));

/* ---------------- Reconnect by phone number (how a purchased phone gets back online) ---------------- */
router.get('/api/admin/reconnect', (_req, res) => res.json({ phones: reconnect.setting(), effective: reconnect.effective(), modes: reconnect.MODES, smsConfigured: require('./sms').configured() }));
router.post('/api/admin/reconnect', (req, res) => {
  const m = (req.body || {}).phones;
  if (!reconnect.MODES.includes(m)) return res.status(400).json({ error: 'Choose one of: ' + reconnect.MODES.join(', ') });
  require('./config').savePortal({ reconnect: { phones: m } });
  res.json({ ok: true, phones: reconnect.setting(), effective: reconnect.effective() });
});

/* ---------------- Portal greeting (Good morning / afternoon / evening / night, Nairobi time) ---------------- */
router.get('/api/admin/greeting', (_req, res) => res.json({ greeting: greeting.get(), defaults: greeting.DEFAULTS, accents: greeting.ACCENTS, placeholders: greeting.PLACEHOLDERS, serverNow: Date.now() }));
router.post('/api/admin/greeting', (req, res) => {
  try { res.json({ ok: true, greeting: greeting.save(req.body || {}) }); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/api/admin/greeting/reset', (_req, res) => res.json({ ok: true, greeting: greeting.reset() }));

/* ---------------- Theme / background ---------------- */
router.get('/api/admin/theme', (_req, res) => {
  const p = portal();
  const images = themeImages.list();
  res.json({
    theme: p.theme, resolved: resolveTheme(p), templates: TEMPLATES,
    images: images.map((filename) => ({ filename, url: themeImages.url(filename) })),
    imageFolder: themeImages.IMAGE_DIR,
    today: themeImages.dayKey()
  });
});

router.post('/api/admin/theme', (req, res) => {
  const { mode, manualTemplate, weekday, holidays, animations, imageRotationEnabled, imageOverrideFile } = req.body || {};
  const patch = {};
  if (mode != null) { if (!['manual', 'auto'].includes(mode)) return res.status(400).json({ error: 'mode must be "manual" or "auto".' }); patch.mode = mode; }
  if (manualTemplate != null) { if (!IDS.has(manualTemplate)) return res.status(400).json({ error: `Unknown template "${manualTemplate}".` }); patch.manualTemplate = manualTemplate; }
  if (animations != null) patch.animations = !!animations;
  if (imageRotationEnabled != null) {
    if (typeof imageRotationEnabled !== 'boolean') return res.status(400).json({ error: 'imageRotationEnabled must be true or false.' });
    patch.imageRotationEnabled = imageRotationEnabled;
  }
  if (imageOverrideFile != null) {
    if (typeof imageOverrideFile !== 'string') return res.status(400).json({ error: 'Choose a valid image file or Auto.' });
    if (imageOverrideFile) {
      if (!themeImages.list().includes(imageOverrideFile)) return res.status(400).json({ error: 'That background image is not in the image folder.' });
      patch.imageOverrideDate = themeImages.dayKey();
      patch.imageOverrideFile = imageOverrideFile;
    } else {
      patch.imageOverrideDate = null;
      patch.imageOverrideFile = null;
    }
  }
  if (weekday != null) {
    const out = {};
    for (const [day, tmpl] of Object.entries(weekday)) {
      if (!WEEKDAY_NAMES.includes(day)) return res.status(400).json({ error: `Unknown weekday "${day}".` });
      if (!IDS.has(tmpl)) return res.status(400).json({ error: `Unknown template "${tmpl}" for ${day}.` });
      out[day] = tmpl;
    }
    patch.weekday = out;
  }
  if (holidays != null) {
    if (!Array.isArray(holidays)) return res.status(400).json({ error: 'holidays must be a list.' });
    const out = [];
    for (const h of holidays) {
      if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(h.date || '')) return res.status(400).json({ error: `Bad date "${h.date}" (use MM-DD).` });
      if (!IDS.has(h.template)) return res.status(400).json({ error: `Unknown template "${h.template}" for ${h.date}.` });
      out.push({ date: h.date, name: String(h.name || '').trim().slice(0, 60) || h.date, template: h.template });
    }
    patch.holidays = out;
  }
  const saved = savePortal({ theme: patch });
  res.json({ ok: true, theme: saved.theme, resolved: resolveTheme(saved), today: themeImages.dayKey() });
});

router.post('/api/admin/theme/background', (req, res) => {
  const d = decodeDataUrl((req.body || {}).dataUrl, 2 * 1024 * 1024);
  if (d.error) return res.status(400).json({ error: d.error });
  try {
    fs.writeFileSync(path.join(DATA_DIR, 'theme-bg.' + d.ext), d.buf);
    const cur = portal();
    const version = (cur.theme?.bgVersion || 0) + 1;
    const saved = savePortal({ theme: { customBackground: true, customExt: '.' + d.ext, bgVersion: version } });
    res.json({ ok: true, resolved: resolveTheme(saved) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/api/admin/theme/background/clear', (_req, res) => {
  const saved = savePortal({ theme: { customBackground: false } });
  res.json({ ok: true, resolved: resolveTheme(saved) });
});

module.exports = router;
