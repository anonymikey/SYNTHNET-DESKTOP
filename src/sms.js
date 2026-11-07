// Olympus SMS (https://sms.ots.co.ke/api/v3) client with a persistent outbox.
//
// Why an outbox: this laptop's internet is also the hotspot's uplink, so SMS can fail exactly when an outage is
// happening. Every message is written to sms-log.json first, then delivered by a worker that retries with backoff.
// Nothing here ever blocks a customer from getting online.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DATA_DIR } = require('./config');
const { normPhone, mask } = require('./phone');
const events = require('./events');

const LOG_FILE = path.join(DATA_DIR, 'sms-log.json');
const LOG_CAP = 1000;
const safeProviderMessage = (value) => String(value || '').replace(/(api[-_ ]?(?:key|secret)|authorization|bearer|token)\s*[:=]?\s*[^\s,;]+/ig, '$1=[redacted]').slice(0, 200);
const BACKOFF_MS = [20e3, 60e3, 3 * 60e3, 10 * 60e3, 30 * 60e3, 60 * 60e3];
const MAX_ATTEMPTS = 10;
const CHUNK = 50;                                                  // recipients per API request (broadcasts)

const cfg = () => ({
  base: (process.env.OLYMPUS_SMS_BASE_URL || 'https://sms.ots.co.ke/api/v3').replace(/\/+$/, ''),
  token: (process.env.OLYMPUS_SMS_TOKEN || '').trim(),
  sender: (process.env.OLYMPUS_SMS_SENDER_ID || '').trim()
});
const configured = () => { const c = cfg(); return !!(c.token && c.sender); };

/* ---------------- message length (GSM-7 vs Unicode) ---------------- */
const GSM = new Set('@\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\n\u00d8\u00f8\r\u00c5\u00e5\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e\u00c6\u00e6\u00df\u00c9 !"#\u00a4%&\'()*+,-./0123456789:;<=>?\u00a1ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c4\u00d6\u00d1\u00dc\u00a7\u00bf abcdefghijklmnopqrstuvwxyz\u00e4\u00f6\u00f1\u00fc\u00e0');
const GSM_EXT = new Set('^{}\\[~]|\u20ac');
function measure(text) {
  const chars = [...String(text || '')];
  let gsm = true, units = 0;
  for (const ch of chars) {
    if (GSM.has(ch)) units += 1; else if (GSM_EXT.has(ch)) units += 2; else { gsm = false; break; }
  }
  if (gsm) return { encoding: 'GSM-7', length: units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) };
  const len = chars.reduce((n, c) => n + (c.codePointAt(0) > 0xffff ? 2 : 1), 0);
  return { encoding: 'Unicode', length: len, segments: len === 0 ? 0 : len <= 70 ? 1 : Math.ceil(len / 67) };
}

/* ---------------- Admin notifications for SMS problems ---------------- */
// A short balance or a rejected token silently stops ALL customer messages, so those are critical; everything else is a warning.
function alertFailure(kind, count, r) {
  const err = String(r.error || '');
  const balance = /balance|insufficient|credit|fund/i.test(err), auth = /token|unauthori[sz]ed|unauthenticated|sender/i.test(err);
  const title = balance ? 'SMS balance is too low: customer messages are not sending' : auth ? 'Olympus SMS rejected your token or sender ID' : r.retryable ? 'SMS provider unreachable' : 'An SMS could not be sent';
  try {
    events.emit({ category: 'sms', level: balance || auth ? 'critical' : 'warning', title,
      message: r.retryable && !balance && !auth ? `Messages are waiting and will send automatically when the connection is back. (${err})` : `${kind} message to ${count} recipient(s): ${err}${balance ? ' Top up on the Olympus dashboard, then press Retry in the Message log.' : ''}`,
      dedupeKey: 'smsfail:' + title, dedupeMs: 15 * 60000 });
  } catch (e) { console.error('[events]', e.message); }
}

/* ---------------- HTTP ---------------- */
async function call(method, p, body) {
  const c = cfg();
  const r = await fetch(c.base + p, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const raw = await r.text();
  let json = {}; try { json = raw ? JSON.parse(raw) : {}; } catch { json = { message: raw.slice(0, 200) }; }
  return { http: r.status, json };
}

// Result: { ok } | { ok:false, retryable, error }. Network problems, 408, 429 and 5xx are retryable; everything else
// (bad token, unapproved sender ID, insufficient balance...) is reported to the admin instead of hammering the API.
async function rawSend({ recipients, text, scheduleTime }) {
  if (!configured()) return { ok: false, retryable: false, error: 'SMS is not set up (token or sender ID missing).' };
  const body = { recipient: recipients.join(','), sender_id: cfg().sender, type: 'plain', message: text };
  if (scheduleTime) body.schedule_time = scheduleTime;
  let res;
  try { res = await call('POST', '/sms/send', body); }
  catch (e) { return { ok: false, retryable: true, error: 'Could not reach Olympus SMS (' + (e.cause?.code || e.name || e.message) + ').' }; }
  const { http, json } = res;
  if (http < 400 && json.status === 'success') {
    const d = Array.isArray(json.data) ? json.data[0] : json.data;
    return { ok: true, providerRef: d && typeof d === 'object' ? String(d.uid || d.id || '') : '' };
  }
  const message = safeProviderMessage(json.message || json.error || `HTTP ${http}`);
  return { ok: false, retryable: http === 408 || http === 429 || http >= 500, error: message };
}

// Hashed SMS (Safaricom masked MSISDN, e.g. from M-Pesa Pay Bill callbacks). Transactional, one recipient per call.
// Not used by the STK-push flow (we already know the real number); kept for a future Pay Bill integration.
async function sendHashed({ recipient, format = 'hashed', text }) {
  if (!configured()) return { ok: false, error: 'SMS is not set up.' };
  const { http, json } = await call('POST', '/sms/send-hashed', { recipient, recipient_format: format, sender_id: cfg().sender, message: text });
  return { ok: http === 202 && json.status === 'success', queueUid: json.data?.queue_uid, error: json.message };
}

// Cheap authenticated read: proves the token works without sending (or paying for) a message.
async function testConnection() {
  if (!cfg().token) return { ok: false, error: 'No API token saved yet.' };
  try {
    const { http, json } = await call('GET', '/sms');
    if (http === 401 || http === 403) return { ok: false, error: 'Olympus rejected the token. Regenerate it on the Developers page and save it again.' };
    if (http >= 400 || json.status === 'error') return { ok: false, error: String(json.message || `HTTP ${http}`) };
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Could not reach Olympus SMS (' + (e.cause?.code || e.message) + ').' }; }
}

/* ---------------- Persistent outbox / log ---------------- */
let log = null;
const load = () => { if (!log) { try { log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch { log = []; } } return log; };
const save = () => { if (log.length > LOG_CAP) log = log.slice(-LOG_CAP); try { fs.writeFileSync(LOG_FILE, JSON.stringify(log)); } catch (e) { console.error('[sms] could not save log:', e.message); } };

// entry: { kind, to:[254...], text, dedupeKey?, validUntil?, scheduleTime?, batch? }
function enqueue(entry) {
  const db = load();
  if (entry.dedupeKey && db.some((e) => e.dedupeKey === entry.dedupeKey && !['failed', 'cancelled'].includes(e.status))) return null;
  const to = [...new Set((entry.to || []).map(normPhone).filter(Boolean))];
  if (!to.length || !entry.text) return null;
  const m = measure(entry.text);
  const rec = {
    id: crypto.randomUUID(), kind: entry.kind, to, text: entry.text, segments: m.segments, encoding: m.encoding,
    status: 'queued', attempts: 0, createdAt: Date.now(), nextAttemptAt: Date.now(),
    ...(entry.dedupeKey ? { dedupeKey: entry.dedupeKey } : {}), ...(entry.validUntil ? { validUntil: entry.validUntil } : {}),
    ...(entry.scheduleTime ? { scheduleTime: entry.scheduleTime } : {}), ...(entry.batch ? { batch: entry.batch } : {})
  };
  db.push(rec); save();
  setImmediate(tick);
  return rec;
}

let running = null;
function tick() {
  if (running) return running;                                     // callers await the pass already in progress
  running = (async () => {
    const now = Date.now();
    const due = load().filter((e) => e.status === 'queued' && e.nextAttemptAt <= now).slice(0, 20);
    for (const e of due) {
      if (e.status !== 'queued') continue;                         // cancelled while an earlier message was being sent
      if (e.validUntil && Date.now() > e.validUntil) { e.status = 'cancelled'; e.error = 'No longer relevant by the time it could be sent.'; save(); continue; }
      e.attempts++;
      const r = await rawSend({ recipients: e.to, text: e.text, scheduleTime: e.scheduleTime });
      if (e.status !== 'queued') continue;                         // cancelled mid-flight: keep the cancellation
      if (r.ok) { e.status = 'sent'; e.sentAt = Date.now(); e.providerRef = r.providerRef || ''; delete e.error; }
      else {
        e.error = r.error;
        if (r.retryable && e.attempts < MAX_ATTEMPTS) e.nextAttemptAt = Date.now() + BACKOFF_MS[Math.min(e.attempts - 1, BACKOFF_MS.length - 1)];
        else e.status = 'failed';
        console.error(`[sms] ${e.kind} -> ${e.to.length} recipient(s): ${r.error}${e.status === 'queued' ? ' (will retry)' : ''}`);
        if (e.status === 'failed' || e.attempts === 1) alertFailure(e.kind, e.to.length, r);   // retries of the same problem are merged by the dedupe key
      }
      save();
    }
  })().finally(() => { running = null; });
  return running;
}
let timer = null;
function startWorker() { if (!timer) { timer = setInterval(() => tick().catch(() => {}), 10000); timer.unref(); } tick().catch(() => {}); }

// Immediate send for time-critical messages (e.g. one-time codes): the caller needs the real answer now, and a code that
// arrives minutes later is useless. Still recorded in the log, with `logText` standing in for the secret text.
async function sendNow({ kind, to, text, logText }) {
  const phones = [...new Set((to || []).map(normPhone).filter(Boolean))];
  if (!phones.length) return { ok: false, error: 'No valid number.' };
  const r = await rawSend({ recipients: phones, text }), m = measure(text), now = Date.now();
  if (!r.ok) alertFailure(kind, phones.length, r);
  load().push({ id: crypto.randomUUID(), kind, to: phones, text: logText || text, segments: m.segments, encoding: m.encoding, status: r.ok ? 'sent' : 'failed', attempts: 1, createdAt: now, ...(r.ok ? { sentAt: now } : { error: r.error }), noRetry: true });
  save();
  return r;
}

const find = (id) => load().find((e) => e.id === id);
function retry(id) { const e = find(id); if (!e || e.noRetry || !['failed', 'cancelled'].includes(e.status)) return false; Object.assign(e, { status: 'queued', attempts: 0, nextAttemptAt: Date.now() }); delete e.validUntil; save(); setImmediate(tick); return true; }
function cancel(id) { const e = find(id); if (!e || e.status !== 'queued') return false; e.status = 'cancelled'; e.error = 'Cancelled by admin.'; save(); return true; }
function cancelPending(kind, reason) { let n = 0; for (const e of load()) if (e.kind === kind && e.status === 'queued') { e.status = 'cancelled'; e.error = reason || 'Cancelled.'; n++; } if (n) save(); return n; }

function list({ limit = 100, status } = {}) {
  return load().filter((e) => !status || e.status === status).slice(-limit).reverse().map((e) => ({
    id: e.id, kind: e.kind, status: e.status, createdAt: e.createdAt, sentAt: e.sentAt || null, attempts: e.attempts, error: e.error || '',
    retryable: !e.noRetry, recipients: e.to.length, to: e.to.length === 1 ? mask(e.to[0]) : `${e.to.length} recipients`, text: e.text, segments: e.segments, scheduleTime: e.scheduleTime || null
  }));
}
// Accepted messages as { t, units } (recipients x segments): the basis for the dashboard's SMS cost.
const sentUnits = () => load().filter((e) => e.status === 'sent' && e.sentAt).map((e) => ({ t: e.sentAt, units: e.to.length * (e.segments || 1) }));
function stats() {
  const day = Date.now() - 86400000, db = load();
  return {
    queued: db.filter((e) => e.status === 'queued').length,
    sent24h: db.filter((e) => e.status === 'sent' && e.sentAt > day).reduce((n, e) => n + e.to.length * e.segments, 0),
    failed24h: db.filter((e) => e.status === 'failed' && e.createdAt > day).length
  };
}

module.exports = { sentUnits, sendNow, configured, cfg, measure, rawSend, sendHashed, testConnection, enqueue, startWorker, retry, cancel, cancelPending, list, stats, CHUNK, _tick: tick, _expedite: () => { for (const e of load()) if (e.status === 'queued') e.nextAttemptAt = 0; }, _reset: () => { log = null; } };
