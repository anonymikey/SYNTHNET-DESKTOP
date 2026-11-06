// M-Pesa STK Push through Courtney Tech (https://courtneytech.xyz/dev-docs).
//   start   POST /v2/stkpush       (needs numeric payment_account_id; reference <= 12 chars; description <= 13 chars)
//   verify  POST /v2/status        (pending | completed | cancelled | failed)   <- the ONLY thing that can grant internet
// Webhooks are NOT trusted (the docs describe no signature): a callback only triggers a server-to-server /v2/status check.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DATA_DIR, portal } = require('./config');
const vouchers = require('./vouchers');
const sessions = require('./sessions');
const outage = require('./outage');
const notify = require('./notify');
const events = require('./events');
const FILE = path.join(DATA_DIR, 'payments.json');

let db = null;
const load = () => { if (!db) { try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = {}; } } return db; };
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));

const cfg = () => ({
  base: (process.env.COURTNEYTECH_BASE_URL || 'https://courtneytech.xyz/api').replace(/\/+$/, ''),
  key: (process.env.COURTNEYTECH_API_KEY || '').trim(), secret: (process.env.COURTNEYTECH_API_SECRET || '').trim(),
  account: Number(process.env.COURTNEYTECH_ACCOUNT_ID), publicUrl: (process.env.COURTNEYTECH_PUBLIC_URL || '').trim().replace(/\/+$/, '')
});
const enabled = () => { const c = cfg(); return !!(c.key && c.secret && !/^your_/i.test(c.key) && !/^your_/i.test(c.secret) && Number.isInteger(c.account) && c.account > 0); };

const { normPhone, mask } = require('./phone');
const tierName = (id) => ((portal().tiers || []).find((t) => t.id === id) || {}).name || id;
const ev = (e) => { try { events.emit({ category: 'payments', ...e }); } catch (err) { console.error('[events]', err.message); } };

async function api(method, p, body) {
  const c = cfg();
  const r = await fetch(c.base + p, {
    method, headers: { 'X-API-Key': c.key, 'X-API-Secret': c.secret, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000)
  });
  return { http: r.status, body: await r.json().catch(() => ({})) };
}

/* Webhook URL is derived from ADMIN_TOKEN so only a callback we asked for is even looked at */
const webhookKey = () => crypto.createHmac('sha256', process.env.ADMIN_TOKEN || 'synthnet').update('courtneytech-webhook').digest('hex').slice(0, 24);
function webhookKeyOk(k) { const a = Buffer.from(String(k || '')), b = Buffer.from(webhookKey()); return a.length === b.length && crypto.timingSafeEqual(a, b); }

async function start({ tier: tierId, phone, ip, mac, deviceType }) {
  if (!enabled()) return { ok: false, message: 'Online payment is not set up yet. Please use the manual steps below.' };
  const tier = portal().tiers.find((t) => t.id === tierId);
  if (!tier) return { ok: false, message: 'Unknown package.' };
  const msisdn = normPhone(phone);
  if (!msisdn) return { ok: false, message: 'Enter a valid Safaricom number, e.g. 0712345678.' };
  const open = Object.values(load()).find((r) => r.status === 'pending' && r.ip === ip && Date.now() - r.createdAt < 90000);
  if (open) return { ok: true, id: open.id, resumed: true };          // don't double-prompt the same phone

  const c = cfg();
  const rec = { id: crypto.randomUUID(), ref: 'SN' + crypto.randomBytes(5).toString('hex').toUpperCase(), tier: tier.id, minutes: tier.minutes,
    amount: tier.priceKsh, phone: msisdn, ip, mac, key: mac || ip, deviceType: deviceType === 'other' ? 'other' : 'mobile', status: 'pending', createdAt: Date.now(), lastQuery: Date.now() };
  const body = { payment_account_id: c.account, phone: msisdn, amount: tier.priceKsh, reference: rec.ref, description: 'SYNTHNET WiFi' };
  if (c.publicUrl.startsWith('https://')) body.callback_url = `${c.publicUrl}/api/callbacks/courtneytech?k=${webhookKey()}`;

  let res;
  try { res = await api('POST', '/v2/stkpush', body); }
  catch {
    ev({ level: 'warning', title: 'M-Pesa service unreachable', message: 'A customer tried to pay but the payment provider could not be reached. Check the laptop\'s internet.', dedupeKey: 'pay-unreachable', dedupeMs: 15 * 60000 });
    return { ok: false, message: 'Payment service unreachable. Try again shortly.' };
  }
  const d = res.body || {};
  rec.checkoutId = d.checkoutRequestId || d.checkout_request_id;
  rec.transactionId = d.transactionId || d.transaction_id;
  if (res.http >= 400 || d.success !== true || !rec.checkoutId) {
    rec.status = 'failed'; rec.message = `HTTP ${res.http}: ${d.message || 'no checkout id'}`.slice(0, 200);
    load()[rec.id] = rec; save();
    console.error('[pay] STK push rejected:', rec.message);          // 401 = bad key/secret, 402 = wallet needs top-up for the fee
    ev({ level: res.http === 401 || res.http === 402 ? 'critical' : 'warning', title: 'M-Pesa request rejected by the provider', message: rec.message + (res.http === 402 ? ' (top up your Courtney Tech wallet)' : res.http === 401 ? ' (check the API key and secret)' : ''), dedupeKey: 'pay-rejected', dedupeMs: 15 * 60000 });
    return { ok: false, message: res.http === 400 ? (d.message || 'Check your number and try again.') : 'Online payment is temporarily unavailable. Please pay manually or contact support.' };
  }
  load()[rec.id] = rec; save();
  ev({ level: 'info', silent: true, title: 'M-Pesa request sent', message: `${mask(rec.phone)} · ${tierName(rec.tier)} · KSh ${rec.amount}`, dedupeKey: 'payreq:' + rec.id, dedupeMode: 'skip' });
  watch(rec.id);
  return { ok: true, id: rec.id, ref: rec.ref, amount: rec.amount, tier: rec.tier };
}

/* Server-side watcher. The customer's browser is NOT needed to finish a payment: on many phones the sign-in popup closes
   (or the page is suspended) the moment the M-Pesa PIN prompt appears, and a purely browser-driven check would leave a paid
   customer offline. So every pending payment is re-checked here every ~5.5 s (Courtney Tech asks for >= 5 s between checks)
   until it settles, fails or times out. settle() activates the buyer's IP/device, so internet turns on by itself. */
function timeoutRec(rec) {
  rec.status = 'timeout'; rec.message = 'No response from M-Pesa. If money was deducted, contact support.'; save();
  ev({ level: 'warning', title: 'Payment timed out', message: `${mask(rec.phone)} · ${tierName(rec.tier)} · KSh ${rec.amount} · ${rec.ref}. No answer from M-Pesa; if the customer says money was deducted, check your M-Pesa statement.`, dedupeKey: 'paytimeout:' + rec.id, dedupeMode: 'skip' });
}
const WATCH_EVERY = 5500, PENDING_MAX = 150000;
const watching = new Set();
function watch(id) {
  if (watching.has(id)) return;
  watching.add(id);
  const step = async () => {
    const rec = load()[id];
    if (!rec || rec.status !== 'pending') { watching.delete(id); return; }
    if (Date.now() - rec.lastQuery >= 5000) { try { await verify(rec); } catch { /* transient: try again next round */ } }
    if (rec.status === 'pending' && Date.now() - rec.createdAt > PENDING_MAX) timeoutRec(rec);
    if (rec.status !== 'pending') { watching.delete(id); return; }
    setTimeout(step, WATCH_EVERY).unref();
  };
  setTimeout(step, 5200).unref();
}
// After an app restart, keep watching payments that were still waiting for the customer's PIN.
function resume() { for (const r of Object.values(load())) if (r.status === 'pending' && Date.now() - r.createdAt < 10 * 60000) watch(r.id); }

/* Ask Courtney Tech what really happened. Only a "completed" answer for OUR checkout id (and our amount) grants access. */
async function verify(rec) {
  if (rec.status === 'success' || !rec.checkoutId) return rec;
  rec.lastQuery = Date.now();
  const { body: d } = await api('POST', '/v2/status', { checkout_request_id: rec.checkoutId });
  if (!d || d.success === false) return rec;                          // transient: keep pending
  const st = String(d.status || '').toLowerCase();
  if (st === 'completed') {
    if (d.amountKes != null && Number(d.amountKes) !== rec.amount) { rec.status = 'failed'; rec.message = `Amount mismatch (paid ${d.amountKes}, expected ${rec.amount})`; save();
      ev({ level: 'critical', title: 'Payment amount mismatch', message: `${mask(rec.phone)} paid KSh ${d.amountKes} for a KSh ${rec.amount} package (${rec.ref}). Access was NOT granted. Check M-Pesa and refund or fix manually.`, dedupeKey: 'mismatch:' + rec.id, dedupeMode: 'skip' });
      return rec; }
    return settle(rec, d);
  }
  if (st === 'cancelled' || st === 'failed') {
    rec.status = st; rec.message = d.resultDesc || (st === 'cancelled' ? 'Payment cancelled.' : 'Payment failed.'); save();
    ev(st === 'cancelled' ? { level: 'info', silent: true, title: 'Payment cancelled by customer', message: `${mask(rec.phone)} · ${tierName(rec.tier)} · KSh ${rec.amount}`, dedupeKey: 'paycancel:' + rec.id, dedupeMode: 'skip' }
      : { level: 'warning', title: 'Payment failed', message: `${mask(rec.phone)} · ${tierName(rec.tier)} · KSh ${rec.amount} · ${rec.message}`, dedupeKey: 'payfail:' + rec.id, dedupeMode: 'skip' });
  }
  return rec;
}

const inflight = new Map();
function settle(rec, d) {
  if (rec.status === 'success') return Promise.resolve(rec);
  if (inflight.has(rec.id)) return inflight.get(rec.id);              // webhook + poll racing: only one voucher
  const p = (async () => {
    const [code] = await vouchers.create({ tier: rec.tier, minutes: rec.minutes, count: 1, phone: rec.phone });
    rec.voucher = code; rec.receipt = d.mpesaReceipt || null; rec.transactionId = rec.transactionId || d.transactionId;
    rec.paidAt = Date.now(); rec.status = 'success'; save();
    const returning = Object.values(load()).some((r) => r.id !== rec.id && r.status === 'success' && r.phone === rec.phone);
    ev({ level: 'success', title: `Payment received: KSh ${rec.amount}`, message: `${tierName(rec.tier)} · ${mask(rec.phone)} · ${rec.receipt || 'no receipt'} · ${returning ? 'returning' : 'NEW'} customer`, meta: { amount: rec.amount, receipt: rec.receipt, tier: rec.tier, newCustomer: !returning }, dedupeKey: 'paid:' + rec.id, dedupeMode: 'skip' });
    await activate(rec, rec.ip, rec.deviceType || 'mobile');           // whitelist the buyer's IP immediately
    notify.purchase(rec).catch((e) => console.error('[sms] purchase message not queued:', e.message));   // receipt; never blocks access
    return rec;
  })().finally(() => inflight.delete(rec.id));
  inflight.set(rec.id, p); return p;
}

// deviceType defaults to 'mobile': the buyer is almost always paying from their own phone, and a webhook-triggered
// activation (no request/User-Agent available) has no way to know otherwise. When the portal's own poll calls this
// with a real classified type, that's used instead — see poll() below.
async function activate(rec, ip = rec.ip, deviceType = 'mobile') {
  try {
    const r = await vouchers.redeem(rec.voucher, rec.key, deviceType);
    if (!r.ok) return r;
    await outage.trackVoucher(rec.voucher);
    sessions.set(ip, { key: rec.key, code: rec.voucher, expiresAt: r.expiresAt });   // -> gate filter excludes this IP within ~100 ms
    sessions.clearRevoked(rec.key);
    // A returning buyer keeps the TVs they registered by MAC address: link them to this new package.
    vouchers.carryOverTvs(rec.voucher).then((n) => { if (n) require('./tvlink').syncNow(); }).catch(() => {});
    console.log(`[pay] ${ip} unlocked: ${rec.tier} (${rec.ref}${rec.receipt ? ', ' + rec.receipt : ''})`);
    return { ok: true, ...r, expiresAt: sessions.effectiveExpiresAt(ip), voucher: await vouchers.getInfo(rec.voucher), outage: outage.status() };
  } catch (e) {
    console.error('[pay] activate failed:', e.message);
    ev({ level: 'critical', title: 'Customer paid but internet was not unlocked', message: `${mask(rec.phone)} · ${rec.ref} · ${e.message}. Use Award free time or generate a voucher for them.`, dedupeKey: 'activate-fail:' + rec.id, dedupeMode: 'skip' });
    return { ok: false, error: 'Activation failed.' };
  }
}

/* Portal polling (works with no public URL). Courtney Tech asks for >= 5 s between status checks. */
async function poll(id, ip, mac, deviceType) {
  const rec = load()[id];
  if (!rec || !(rec.ip === ip || (mac && rec.mac === mac))) return { status: 'unknown', message: 'Payment not found.' };
  if (rec.status === 'pending' && Date.now() - rec.lastQuery >= 5000) {
    try { await verify(rec); } catch {}
    if (rec.status === 'pending' && Date.now() - rec.createdAt > PENDING_MAX) timeoutRec(rec);
  }
  if (rec.status === 'success') {
    const a = await activate(rec, ip, deviceType);
    return a.ok ? { status: 'success', receipt: rec.receipt || '', ...a } : { status: 'failed', message: a.error || 'Could not activate.' };
  }
  return { status: rec.status, message: rec.message, elapsedMs: Date.now() - rec.createdAt };
}

/* Webhook handler. NEVER trusts the body: it only finds OUR pending payment and re-verifies it with /v2/status. */
async function onCallback(payload) {
  const d = payload && typeof payload === 'object' ? { ...payload, ...(payload.data && typeof payload.data === 'object' ? payload.data : {}) } : {};
  const tid = d.transactionId || d.transaction_id, cid = d.checkoutRequestId || d.checkout_request_id;
  const recs = Object.values(load());
  let rec = recs.find((r) => (tid && r.transactionId === tid) || (cid && r.checkoutId === cid));
  if (!rec && d.phone && d.amountKes != null) {
    const ph = normPhone(d.phone);
    rec = recs.filter((r) => ['pending', 'timeout'].includes(r.status) && r.phone === ph && r.amount === Number(d.amountKes)).sort((a, b) => b.createdAt - a.createdAt)[0];
  }
  if (!rec) return { matched: false };
  if (Date.now() - (rec.lastQuery || 0) >= 3000) await verify(rec);
  return { matched: true, status: rec.status };
}

const list = (limit = 50) => Object.values(load()).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
  .map((r) => ({ id: r.id, ref: r.ref, tier: r.tier, amount: r.amount, status: r.status, createdAt: r.createdAt, message: r.message || '', receipt: r.receipt || '',
    phone: mask(r.phone) }));

const successes = () => Object.values(load()).filter((r) => r.status === 'success');

async function accounts() {
  const { http, body } = await api('GET', '/v2/accounts');
  if (http >= 400 || body.success === false) throw new Error(body.message || `Courtney Tech answered HTTP ${http}`);
  return (body.accounts || []).map((a) => ({ id: a.payment_account_id, type: a.type, name: a.displayName || a.businessName, primary: !!a.isPrimary }));
}

module.exports = { enabled, successes, start, poll, resume, onCallback, list, accounts, webhookKeyOk, _normPhone: normPhone, _t: { load } };
