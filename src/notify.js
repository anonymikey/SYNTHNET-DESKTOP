// Customer messaging: decides WHAT to send and to WHOM; src/sms.js decides HOW (queue, retry, Olympus API).
// Every automatic message can be switched off, and every wording edited, from the admin dashboard.
// This module must not require pay.js or outage.js (they require it).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DATA_DIR, portal } = require('./config');
const vouchers = require('./vouchers');
const sms = require('./sms');
const { normPhone } = require('./phone');

const SETTINGS_FILE = path.join(DATA_DIR, 'sms-settings.json');
const STATE_FILE = path.join(DATA_DIR, 'sms-state.json');
const TZ = process.env.SMS_TIMEZONE || 'Africa/Nairobi';
const MAX_TEXT = 480;                                              // 3 GSM segments; longer gets expensive fast

// ASCII only on purpose: one curly quote or dash switches the whole SMS to Unicode (70 chars/segment instead of 160).
const DEFAULTS = {
  enabled: true,
  doNotMessage: [],
  purchase:    { enabled: true,  template: '{brand}: KES {amount} received ({receipt}). {package} active until {expires}. Code: {code}. Help: {support}' },
  voucher:     { enabled: true,  template: '{brand}: your {package} voucher code is {code}. Join the Wi-Fi and enter it to get online. Help: {support}' },
  award:       { enabled: true,  template: '{brand}: you have been given {package} free! Code: {code}, valid until {expires}. Join the Wi-Fi and enter it. Help: {support}' },
  reminder:    { enabled: true,  template: '{brand}: your {package} ends in {left} ({expires}). Renew from the Wi-Fi login page to stay online. Help: {support}', leadMinutes: [1440, 15], minPriceKsh: 20 },
  expired:     { enabled: false, template: '{brand}: your {package} has ended. Join the Wi-Fi and pick a package to get back online. Help: {support}' },
  outageStart: { enabled: true,  template: '{brand}: we have a service interruption. Your package time is paused and will be added back once we are restored. Sorry!' },
  outageEnd:   { enabled: true,  template: '{brand}: service is back. {credit} was added to your package, now valid until {expires}. Thanks for waiting.' }
};
const KINDS = ['purchase', 'voucher', 'award', 'reminder', 'expired', 'outageStart', 'outageEnd'];
const PLACEHOLDERS = ['brand', 'support', 'package', 'code', 'expires', 'amount', 'receipt', 'left', 'credit'];
const LABELS = {
  purchase: 'Payment receipt (after a successful M-Pesa purchase)',
  voucher: 'Voucher code (when you SMS a code from Generate vouchers)',
  award: 'Free time awarded (Award free time, by phone number)',
  reminder: 'Expiry reminder',
  expired: 'Package ended',
  outageStart: 'Outage started',
  outageEnd: 'Service restored (with credited time)'
};
const SAMPLE = { brand: 'SYNTHNET Demo', support: '0700000000', package: '24 Hours Unlimited', code: 'SYN-ABCD-2345', expires: 'today 6:45 PM', amount: '30', receipt: 'UJJ12ABC34', left: '15 min', credit: '1h 20m' };

/* ---------------- settings ---------------- */
function settings() {
  let saved = {}; try { saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
  const out = { enabled: saved.enabled !== false, doNotMessage: Array.isArray(saved.doNotMessage) ? saved.doNotMessage : [] };
  for (const k of KINDS) out[k] = { ...DEFAULTS[k], ...(saved[k] || {}) };
  return out;
}

function cleanTemplate(t, label) {
  const text = String(t || '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  if (!text) throw new Error(`${label}: the message cannot be empty.`);
  if (text.length > MAX_TEXT) throw new Error(`${label}: too long (max ${MAX_TEXT} characters).`);
  const bad = [...text.matchAll(/\{(\w*)\}/g)].map((m) => m[1]).filter((n) => !PLACEHOLDERS.includes(n));
  if (bad.length) throw new Error(`${label}: unknown placeholder {${bad[0]}}. Allowed: ${PLACEHOLDERS.map((p) => '{' + p + '}').join(' ')}`);
  return text;
}
// Accepts numbers separated by commas, semicolons or new lines. Spaces INSIDE a number ("0711 000 111") are fine, and
// a line of space-separated numbers ("0712345678 0723456789") is split too.
function parseNumbers(input) {
  const raw = Array.isArray(input) ? input.map(String) : String(input || '').split(/[,;\r\n]+/);
  const good = [], bad = [];
  for (const token of raw.map((x) => x.trim()).filter(Boolean)) {
    const n = normPhone(token);
    if (n) { good.push(n); continue; }
    const parts = token.split(/\s+/).map(normPhone);
    if (parts.length > 1 && parts.every(Boolean)) good.push(...parts); else bad.push(token);
  }
  return { numbers: [...new Set(good)], invalid: bad };
}

function saveSettings(patch) {
  const cur = settings(), next = { ...cur };
  if (patch.enabled != null) next.enabled = !!patch.enabled;
  for (const k of KINDS) {
    const p = patch[k]; if (!p) continue;
    next[k] = { ...cur[k] };
    if (p.enabled != null) next[k].enabled = !!p.enabled;
    if (p.template != null) next[k].template = cleanTemplate(p.template, LABELS[k]);
    if (k === 'reminder') {
      if (p.leadMinutes != null) {
        const leads = [...new Set((Array.isArray(p.leadMinutes) ? p.leadMinutes : String(p.leadMinutes).split(/[\s,;]+/)).filter((x) => String(x).trim() !== '').map(Number))];
        if (leads.some((n) => !Number.isInteger(n) || n < 1 || n > 10080)) throw new Error('Reminder times must be whole minutes between 1 and 10080.');
        if (leads.length > 4) throw new Error('Use at most 4 reminder times.');
        next.reminder.leadMinutes = leads.sort((a, b) => b - a);
      }
      if (p.minPriceKsh != null) {
        const n = Number(p.minPriceKsh);
        if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error('Minimum package price must be a whole number of KSh (0 or more).');
        next.reminder.minPriceKsh = n;
      }
    }
  }
  if (patch.doNotMessage != null) {
    const { numbers, invalid } = parseNumbers(patch.doNotMessage);
    if (invalid.length) throw new Error(`Not a valid Kenyan number: ${invalid[0]}`);
    next.doNotMessage = numbers;
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return settings();
}

/* ---------------- formatting ---------------- */
const dayKey = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
function when(ms) {
  if (!ms) return 'when you connect';
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(ms);
  const k = dayKey(ms), now = Date.now();
  if (k === dayKey(now)) return `today ${time}`;
  if (k === dayKey(now + 86400000)) return `tomorrow ${time}`;
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(ms).replace(',', '');
  return `${d} ${time}`;
}
function span(ms) {
  const m = Math.max(1, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return mm ? `${h}h ${mm}m` : `${h}h`;
  return `${m} min`;
}
function render(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])))
    .replace(/\s*\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,!])/g, '$1').trim();
}
function baseVars() { const p = portal(); return { brand: p.brand?.name || 'WiFi', support: p.payment?.supportPhone || '' }; }
const tierOf = (id) => (portal().tiers || []).find((t) => t.id === id);
const packageName = (id) => tierOf(id)?.name || id || 'package';

function varsFor({ tier, code, expiresAt, amount, receipt, leftMs, creditMs }) {
  return { ...baseVars(), package: packageName(tier), code: code || '', expires: when(expiresAt), amount: amount ?? '', receipt: receipt || '',
    left: leftMs != null ? span(leftMs) : '', credit: creditMs != null ? span(creditMs) : '' };
}
function preview(template) {
  const text = render(template, SAMPLE); return { text, ...sms.measure(text) };
}

/* ---------------- gating ---------------- */
let warned = false;
function can(kind) {
  if (!sms.configured()) { if (!warned) { warned = true; console.log('[sms] Olympus SMS is not set up yet: customer messages are skipped.'); } return false; }
  const s = settings();
  return s.enabled && s[kind].enabled;
}
const optedOut = () => new Set(settings().doNotMessage);

/* ---------------- event messages ---------------- */
async function purchase(rec) {
  if (!can('purchase')) return null;
  const info = rec.voucher ? await vouchers.getInfo(rec.voucher) : null;
  const expiresAt = (info && info.expiresAt) || Date.now() + (rec.minutes || 0) * 60000;   // clock starts at purchase; never print a blank expiry
  const text = render(settings().purchase.template, varsFor({ tier: rec.tier, code: rec.voucher, expiresAt, amount: rec.amount, receipt: rec.receipt }));
  return sms.enqueue({ kind: 'purchase', to: [rec.phone], text, dedupeKey: 'purchase:' + rec.id, validUntil: Date.now() + 6 * 3600e3 });
}

async function award({ phone, code, tier }) {
  if (!can('award')) return null;
  const info = await vouchers.getInfo(code);
  const text = render(settings().award.template, varsFor({ tier, code, expiresAt: info && info.expiresAt }));
  return sms.enqueue({ kind: 'award', to: [phone], text, dedupeKey: 'award:' + code, validUntil: Date.now() + 24 * 3600e3 });
}

async function voucherCode({ phone, code, tier }) {
  if (!can('voucher')) return null;
  const text = render(settings().voucher.template, varsFor({ tier, code }));
  return sms.enqueue({ kind: 'voucher', to: [phone], text, dedupeKey: 'voucher:' + code, validUntil: Date.now() + 24 * 3600e3 });
}

async function outageStarted() {
  if (!can('outageStart')) return { queued: 0 };
  const phones = [...new Set((await vouchers.notifyTargets()).filter((t) => t.active).map((t) => t.phone))];
  const text = render(settings().outageStart.template, baseVars());
  let queued = 0;
  for (let i = 0; i < phones.length; i += sms.CHUNK)
    if (sms.enqueue({ kind: 'outage_start', to: phones.slice(i, i + sms.CHUNK), text, validUntil: Date.now() + 3 * 3600e3 })) queued += Math.min(sms.CHUNK, phones.length - i);
  return { queued };
}

async function outageEnded({ id, codes }) {
  // If the "outage started" notice never left the laptop (no internet), it is stale now: drop it.
  sms.cancelPending('outage_start', 'Service was restored before this could be sent.');
  if (!can('outageEnd')) return { queued: 0 };
  const credited = (await vouchers.notifyTargets({ codes })).filter((t) => t.active && t.lastOutageId === id && t.lastOutageCreditMs > 0);
  const best = new Map();                                          // one message per phone (their longest-credited package)
  for (const t of credited) { const b = best.get(t.phone); if (!b || t.expiresAt > b.expiresAt) best.set(t.phone, t); }
  let queued = 0;
  for (const t of best.values()) {
    const text = render(settings().outageEnd.template, varsFor({ tier: t.tier, code: t.code, expiresAt: t.expiresAt, creditMs: t.lastOutageCreditMs }));
    if (sms.enqueue({ kind: 'outage_end', to: [t.phone], text, dedupeKey: `outage_end:${id}:${t.phone}`, validUntil: Date.now() + 12 * 3600e3 })) queued++;
  }
  return { queued };
}

/* ---------------- expiry reminders ---------------- */
let state = null;
const loadState = () => { if (!state) { try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { state = {}; } state.reminded ||= {}; state.expired ||= {}; } return state; };
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { console.error('[sms] could not save state:', e.message); } };

async function sweep(isPaused) {
  if (!sms.configured()) return;
  if (isPaused && isPaused()) return;                              // package clocks are frozen during an outage
  const s = settings();
  if (!s.enabled || (!s.reminder.enabled && !s.expired.enabled)) return;
  const now = Date.now(), st = loadState(), targets = await vouchers.notifyTargets();
  const activeByPhone = new Map();
  for (const t of targets) if (t.active) activeByPhone.set(t.phone, Math.max(activeByPhone.get(t.phone) || 0, t.expiresAt));
  let dirty = false;

  for (const t of targets) {
    if (!t.redeemedAt || t.disabled || !t.expiresAt) continue;
    const price = tierOf(t.tier)?.priceKsh ?? 0;
    const renewed = (activeByPhone.get(t.phone) || 0) > t.expiresAt;   // already bought the next package: do not nag

    if (s.reminder.enabled && t.active && price >= s.reminder.minPriceKsh) {
      const left = t.expiresAt - now, sent = (st.reminded[t.code] ||= []);
      const length = t.minutes || (t.expiresAt - t.redeemedAt) / 60000;          // legacy vouchers may lack `minutes`
      const leads = s.reminder.leadMinutes.filter((l) => l <= length / 2);   // a 1-hour package never gets a "1 day left" message
      const crossed = leads.filter((l) => left <= l * 60000 && !sent.includes(l));
      if (crossed.length) {
        sent.push(...crossed); dirty = true;
        if (!renewed && !optedOutFor(t.phone)) {
          const text = render(s.reminder.template, varsFor({ tier: t.tier, code: t.code, expiresAt: t.expiresAt, leftMs: left }));
          sms.enqueue({ kind: 'reminder', to: [t.phone], text, dedupeKey: `reminder:${t.code}:${Math.min(...crossed)}`, validUntil: t.expiresAt });
        }
      }
    }
    if (s.expired.enabled && !t.active && now - t.expiresAt < 10 * 60000 && !st.expired[t.code]) {
      st.expired[t.code] = now; dirty = true;
      if (!renewed && !(activeByPhone.get(t.phone) > now) && !optedOutFor(t.phone))
        sms.enqueue({ kind: 'expired', to: [t.phone], text: render(s.expired.template, varsFor({ tier: t.tier, code: t.code, expiresAt: t.expiresAt })), dedupeKey: 'expired:' + t.code, validUntil: now + 3600e3 });
    }
  }
  const known = new Set(targets.map((t) => t.code));                // forget vouchers that no longer exist
  for (const bag of [st.reminded, st.expired]) for (const code of Object.keys(bag)) if (!known.has(code)) { delete bag[code]; dirty = true; }
  if (dirty) saveState();
}
function optedOutFor(phone) { return optedOut().has(phone); }

function start({ isPaused } = {}) {
  sms.startWorker();
  const run = () => sweep(isPaused).catch((e) => console.error('[sms] reminder sweep failed:', e.message));
  const t = setInterval(run, 30000); t.unref();
  setTimeout(run, 5000).unref();
}

/* ---------------- admin broadcasts ---------------- */
async function customers() {
  const map = new Map();
  const touch = (phone) => { if (!map.has(phone)) map.set(phone, { phone, lastActivity: 0, purchases: 0, spentKsh: 0, active: false, activeUntil: 0 }); return map.get(phone); };
  for (const r of require('./pay').successes()) { const c = touch(r.phone); c.purchases++; c.spentKsh += r.amount || 0; c.lastActivity = Math.max(c.lastActivity, r.paidAt || r.createdAt || 0); }
  for (const t of await vouchers.notifyTargets()) {
    if (!normPhone(t.phone)) continue;
    const c = touch(t.phone); c.lastActivity = Math.max(c.lastActivity, t.redeemedAt || t.createdAt || 0);
    if (t.active) { c.active = true; c.activeUntil = Math.max(c.activeUntil, t.expiresAt); }
  }
  return [...map.values()];
}

// audience: all | active | lapsed | custom.  days: only people seen in the last N days (0 = no limit).
async function audience({ audience: kind = 'all', numbers = '', days = 0 }) {
  const dnm = optedOut();
  let list, invalid = [];
  if (kind === 'custom') { const p = parseNumbers(numbers); list = p.numbers.map((phone) => ({ phone })); invalid = p.invalid; }
  else {
    const since = Number(days) > 0 ? Date.now() - Number(days) * 86400000 : 0;
    list = (await customers()).filter((c) => (kind === 'active' ? c.active : kind === 'lapsed' ? !c.active : true) && c.lastActivity >= since);
  }
  const phones = list.map((c) => c.phone).filter((p) => !dnm.has(p));
  return { phones, excluded: list.length - phones.length, invalid };
}

function validateSchedule(input) {
  if (!input) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(input));
  if (!m) throw new Error('Schedule time must look like 2026-10-25 07:30.');
  if (new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() < Date.now() - 60000) throw new Error('That schedule time is in the past.');
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

async function broadcast({ audience: kind, numbers, days, message, scheduleTime }) {
  if (!sms.configured()) throw new Error('SMS is not set up yet. Save your Olympus API token and sender ID first.');
  const text = render(String(message || ''), baseVars());
  if (!text) throw new Error('Write a message first.');
  if (text.length > MAX_TEXT) throw new Error(`Message is too long (max ${MAX_TEXT} characters).`);
  const schedule = validateSchedule(scheduleTime);
  const { phones, excluded, invalid } = await audience({ audience: kind, numbers, days });
  if (invalid.length) throw new Error(`Not a valid Kenyan number: ${invalid[0]}`);
  if (!phones.length) throw new Error('No recipients match that audience.');
  if (phones.length > 2000) throw new Error('Too many recipients for one broadcast (max 2000). Narrow the audience.');
  const batch = crypto.randomUUID();
  for (let i = 0; i < phones.length; i += sms.CHUNK)
    sms.enqueue({ kind: 'broadcast', to: phones.slice(i, i + sms.CHUNK), text, batch, ...(schedule ? { scheduleTime: schedule } : { validUntil: Date.now() + 48 * 3600e3 }) });
  const m = sms.measure(text);
  return { queued: phones.length, excluded, segments: m.segments, units: m.segments * phones.length, scheduled: schedule };
}

module.exports = { settings, saveSettings, preview, render, DEFAULTS, KINDS, LABELS, PLACEHOLDERS, purchase, award, voucherCode, outageStarted, outageEnded, sweep, start, audience, broadcast, customers, parseNumbers };
