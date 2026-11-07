// Platform activity log + admin notifications. Every part of the system calls emit(); the admin bell reads it.
//
//   level:    info | success | warning | critical
//   silent:   routine activity is STORED (it shows in the history) but does not ring the bell or count as unread
//   ringAt:   a repeated routine event can start ringing once it has happened N times (e.g. 5 wrong voucher codes)
//   dedupeKey/dedupeMs/dedupeMode: 'merge' (default) bumps a counter on the existing entry instead of adding a new one;
//             'skip' ignores repeats inside the window completely
//
// "Seen" (the bell stops animating) and "read" (the badge count goes down) are tracked separately, on purpose:
// opening the bell panel means you have seen the news; the badge only clears when you read the items.
// This module must stay dependency-light (config only): pay.js, sms.js, server.js and admin.js all require it.
const fs = require('fs'), path = require('path');
const { DATA_DIR, portal } = require('./config');

const FILE = path.join(DATA_DIR, 'notifications.json');
const MAX_ITEMS = 1500, MAX_AGE_MS = 90 * 86400e3;
const LEVELS = ['info', 'success', 'warning', 'critical'];
const CATEGORIES = [
  { id: 'payments', label: 'Payments', icon: '💰' }, { id: 'customers', label: 'Customers', icon: '👤' }, { id: 'outage', label: 'Outages', icon: '📡' },
  { id: 'sms', label: 'SMS', icon: '✉️' }, { id: 'security', label: 'Security', icon: '🛡️' }, { id: 'admin', label: 'Admin changes', icon: '⚙️' }, { id: 'system', label: 'System', icon: '🖥️' }
];
const CAT_IDS = new Set(CATEGORIES.map((c) => c.id));

// Shown once when the app starts on a new version (the "updates" notification).
const WHATS_NEW = {
  '0.0.4': 'In-app Courtney Tech payment setup, official WhatsApp and Telegram update links, a redesigned live status page, and safer update messaging that confirms local operator data is preserved.',
  '0.10.0': 'Add a TV by its MAC address in My devices: TVs that cannot open the sign-in page now connect by themselves, are cut off when the package ends, and switch back on when the customer buys again. Admins can also link a TV from the dashboard.',
  '0.9.0': 'SMS messaging, a time-of-day portal greeting, an animated payment popup with server-side confirmation, phone-number reconnect with an SMS code, a better My devices page, the income, earnings and profit dashboard, and this notification bell.'
};

let db = null, timer = null;
function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = null; }
  if (!db || typeof db !== 'object') db = {};
  db.seq = Number(db.seq) || 0; db.idSeq = Number(db.idSeq) || db.seq; db.seenId = Number(db.seenId) || 0; db.items = Array.isArray(db.items) ? db.items : [];
  db.prefs = { muted: Array.isArray(db.prefs && db.prefs.muted) ? db.prefs.muted.filter((c) => CAT_IDS.has(c)) : [] };
  db.meta = db.meta && typeof db.meta === 'object' ? db.meta : {};
  return db;
}
function flush() {
  clearTimeout(timer); timer = null;
  if (!db) return;
  try { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, FILE); }
  catch (e) { console.error('[events] could not save notifications:', e.message); }
}
function save() { if (!timer) { timer = setTimeout(flush, 400); timer.unref(); } }
process.on('exit', () => { try { if (timer) flush(); } catch { /* nothing more to do */ } });

const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

function emit(e) {
  const d = load();
  const category = CAT_IDS.has(e.category) ? e.category : 'system', level = LEVELS.includes(e.level) ? e.level : 'info';
  if (d.prefs.muted.includes(category)) return null;                         // the admin switched this category off
  const now = Date.now();

  if (e.dedupeKey) {
    const prev = [...d.items].reverse().find((x) => x.key === e.dedupeKey && now - x.ts < (e.dedupeMs || 600000));
    if (prev) {
      if (e.dedupeMode === 'skip') return prev;
      prev.count = (prev.count || 1) + 1; prev.ts = now; prev.rev = ++d.seq;
      if (e.message != null) prev.message = clip(e.message, 400);
      if (e.ringAt) {                                                         // routine repeat that becomes news at N occurrences
        if (prev.count >= e.ringAt && prev.read && !prev.rang) { prev.read = false; prev.rang = true; if (LEVELS.indexOf(level) > LEVELS.indexOf(prev.level)) prev.level = level; }
      } else if (!e.silent && prev.read) prev.read = false;                   // a problem the admin already read is back
      save(); return prev;
    }
  }
  const item = {
    id: ++d.idSeq, rev: ++d.seq, ts: now, category, level, title: clip(e.title, 120) || 'Activity', message: clip(e.message, 400), meta: e.meta && typeof e.meta === 'object' ? e.meta : undefined,
    read: !!e.silent, count: 1, ...(e.dedupeKey ? { key: e.dedupeKey } : {})
  };
  d.items.push(item);
  const cutoff = now - MAX_AGE_MS;
  if (d.items.length > MAX_ITEMS || d.items[0].ts < cutoff) d.items = d.items.filter((x) => x.ts >= cutoff).slice(-MAX_ITEMS);
  save();
  return item;
}

const view = (x) => ({ id: x.id, rev: x.rev, ts: x.ts, category: x.category, level: x.level, title: x.title, message: x.message, meta: x.meta || null, read: !!x.read, count: x.count || 1 });
function counts() {
  const d = load(), unread = d.items.filter((x) => !x.read), byCategory = {};
  for (const x of unread) byCategory[x.category] = (byCategory[x.category] || 0) + 1;
  const unseen = unread.filter((x) => x.rev > d.seenId);
  return { unread: unread.length, unseen: unseen.length, latestRev: d.seq, seenRev: d.seenId, byCategory, total: d.items.length,
    topLevel: unread.reduce((top, x) => (LEVELS.indexOf(x.level) > LEVELS.indexOf(top) ? x.level : top), 'info') };
}
function list({ limit = 50, beforeRev = 0, sinceRev = 0, category, unread } = {}) {
  const d = load(); limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  let items = [...d.items].sort((a, b) => b.rev - a.rev);                    // newest first (a merged repeat moves to the top)
  if (sinceRev) items = items.filter((x) => x.rev > sinceRev);
  if (beforeRev) items = items.filter((x) => x.rev < beforeRev);
  if (category && CAT_IDS.has(category)) items = items.filter((x) => x.category === category);
  if (unread) items = items.filter((x) => !x.read);
  return { items: items.slice(0, limit).map(view), hasMore: items.length > limit };
}
function markRead({ ids, all, category } = {}) {
  const d = load(); let n = 0; const want = Array.isArray(ids) ? new Set(ids.map(Number)) : null;
  for (const x of d.items) if (!x.read && (all ? (!category || x.category === category) : want && want.has(x.id))) { x.read = true; n++; }
  if (n) save(); return n;
}
function markSeen() { const d = load(); if (d.seenId !== d.seq) { d.seenId = d.seq; save(); } return d.seenId; }
function clear({ scope = 'read' } = {}) {
  const d = load(), before = d.items.length;
  d.items = scope === 'all' ? [] : d.items.filter((x) => !x.read);
  if (scope === 'all') d.seenId = d.seq;
  save(); return before - d.items.length;
}
const prefs = () => ({ muted: [...load().prefs.muted] });
function setMuted(muted) {
  if (!Array.isArray(muted) || muted.some((c) => !CAT_IDS.has(c))) throw new Error('Unknown notification category.');
  load().prefs.muted = [...new Set(muted)]; save(); return prefs();
}

/* ---------- helpers other modules use ---------- */
const money = (n) => 'KSh ' + Math.round(Number(n) || 0).toLocaleString('en-KE');

/* ---------- watchers: version update notice + package-expiry sweep ---------- */
let watchTimer = null, sweepFn = null;
function start({ vouchers, isPaused, version } = {}) {
  const d = load();
  if (version && d.meta.lastVersion !== version) {
    const first = !d.meta.lastVersion;
    emit({ category: 'system', level: 'success', title: first ? `Welcome to SYNTHNET v${version}` : `Platform updated to v${version}`,
      message: (first ? 'Notifications are on: payments, customers, outages, SMS, security and admin changes appear here. ' : `Updated from v${d.meta.lastVersion}. `) + (WHATS_NEW[version] ? 'New: ' + WHATS_NEW[version] : '') });
    d.meta.lastVersion = version; save();
  }
  if (!d.meta.expirySweepAt) { d.meta.expirySweepAt = Date.now(); save(); }
  if (!vouchers || watchTimer) return;
  const run = sweepFn = async () => {
    try {
      if (isPaused && isPaused()) return;                                   // package clocks are frozen during an outage
      const now = Date.now(), from = d.meta.expirySweepAt, names = new Map((portal().tiers || []).map((t) => [t.id, t.name]));
      for (const v of await vouchers.snapshot()) {
        if (v.disabled || !v.expiresAt || v.expiresAt <= from || v.expiresAt > now) continue;
        emit({ category: 'customers', level: 'info', silent: true, title: 'Package expired', message: `${names.get(v.tier) || v.tier}${v.phone ? ' · ' + v.phone : ''} · ${v.code}`, dedupeKey: 'expired:' + v.code, dedupeMs: 864e5, dedupeMode: 'skip' });
      }
      d.meta.expirySweepAt = now; save();
    } catch (e) { console.error('[events] expiry sweep failed:', e.message); }
  };
  watchTimer = setInterval(run, 30000); watchTimer.unref();
}

module.exports = { emit, list, counts, markRead, markSeen, clear, prefs, setMuted, start, money, CATEGORIES, LEVELS, flush, _sweep: () => sweepFn && sweepFn(), _reset: () => { clearTimeout(timer); timer = null; db = null; if (watchTimer) { clearInterval(watchTimer); watchTimer = null; } } };
