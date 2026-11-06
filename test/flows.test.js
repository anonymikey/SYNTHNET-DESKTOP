// Customer-journey tests: server-side payment completion, phone-number reconnect (with SMS code), My devices,
// and the SMS automation lifecycle. Uses fake Courtney Tech (M-Pesa) and fake Olympus SMS servers.   Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'synthnet-flow-'));
const PORT = 42000 + Math.floor(Math.random() * 15000), ADMIN = 'test-admin-password-123', TOKEN = '1|testtoken1234567890';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const LAPTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
let sent = [], olympus, courtney, srv, vouchers, sms, notify;
let smsMode = 'ok';

Object.assign(process.env, { SYNTHNET_DATA: DATA, PORT: String(PORT), ADMIN_TOKEN: ADMIN, ADMIN_LOCAL_ONLY: 'true', OLYMPUS_SMS_TOKEN: TOKEN, OLYMPUS_SMS_SENDER_ID: 'TSCONNECT', SMS_TIMEZONE: 'Africa/Nairobi',
  THROTTLE_WINDOW_MS: '1', COURTNEYTECH_API_KEY: 'k', COURTNEYTECH_API_SECRET: 's', COURTNEYTECH_ACCOUNT_ID: '7' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(150); } return null; };
const call = (p, body, ua, method) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'user-agent': ua || PHONE_UA, 'x-admin-token': ADMIN }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
const vfile = () => path.join(DATA, 'vouchers.json');
const vdb = () => JSON.parse(fs.readFileSync(vfile(), 'utf8'));
const lastOtp = () => { const m = [...sent].reverse().find((x) => /reconnect code is (\d{6})/.test(x.message)); return m && /(\d{6})/.exec(m.message)[1]; };
const settle = async () => { for (let i = 0; i < 20; i++) { sms._expedite(); await sms._tick(); if (!sms.list({ status: 'queued' }).length) return; await wait(20); } };

before(async () => {
  olympus = http.createServer((q, r) => { let b = ''; q.on('data', (c) => b += c); q.on('end', () => {
    if (smsMode === 'down') return q.socket.destroy();
    if (q.method === 'POST') sent.push(JSON.parse(b));
    r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"status":"success","data":{"uid":"u1"}}'); }); });
  const amounts = new Map();
  courtney = http.createServer((q, r) => { let b = ''; q.on('data', (c) => b += c); q.on('end', () => { r.writeHead(200, { 'content-type': 'application/json' }); const body = b ? JSON.parse(b) : {};
    if (q.url.endsWith('/v2/stkpush')) { const id = 'ws_CO_' + Math.random().toString(36).slice(2); amounts.set(id, body.amount); return r.end(JSON.stringify({ success: true, checkoutRequestId: id, transactionId: 't-1' })); }
    if (q.url.endsWith('/v2/status')) return r.end(JSON.stringify({ success: true, status: 'completed', amountKes: amounts.get(body.checkout_request_id), mpesaReceipt: 'UJJWATCH' + Math.floor(Math.random() * 1e6) }));
    r.end('{}'); }); });
  await new Promise((r) => olympus.listen(0, '127.0.0.1', r)); await new Promise((r) => courtney.listen(0, '127.0.0.1', r));
  process.env.OLYMPUS_SMS_BASE_URL = `http://127.0.0.1:${olympus.address().port}/api/v3`;
  process.env.COURTNEYTECH_BASE_URL = `http://127.0.0.1:${courtney.address().port}`;
  sms = require('../src/sms'); notify = require('../src/notify'); vouchers = require('../src/vouchers');
  srv = await require('../server').start();
});
after(() => { for (const s of [srv, olympus, courtney]) { s.closeAllConnections?.(); s.close(); } });

/* ---------- payments ---------- */
test('payment completes on the server even if the browser never polls again (popup closed after the PIN prompt)', async () => {
  sent = [];
  const start = await call('/api/pay/start', { tier: '24h', phone: '0712999001' }, LAPTOP_UA);
  assert.equal(start.body.ok, true);
  // No /api/pay/status calls at all from here: only the server-side watcher can finish this.
  const v = await until(() => Object.entries(vdb()).find(([, x]) => x.phone === '254712999001' && x.redeemedAt), 12000);
  assert.ok(v, 'voucher was activated without any browser polling');
  assert.equal(v[1].devices[0].type, 'other', 'a laptop buyer is recorded as a laptop, not a phone');
  const status = await call('/api/status');
  assert.equal(status.body.authenticated, true, 'buyer is online');
  await settle();
  const receipt = sent.find((m) => /UJJWATCH/.test(m.message));
  assert.ok(receipt && receipt.recipient === '254712999001' && receipt.message.includes(v[0]), 'SMS receipt with the voucher code was sent');
});

test('a phone buyer is recorded as a phone and sees fast status updates', async () => {
  const start = await call('/api/pay/start', { tier: '1h', phone: '0712999002' }, PHONE_UA);
  assert.equal(start.body.ok, true); assert.ok(start.body.id);
  const v = await until(() => Object.entries(vdb()).find(([, x]) => x.phone === '254712999002' && x.redeemedAt), 12000);
  assert.ok(v); assert.equal(v[1].devices[0].type, 'mobile');
  const poll = await call('/api/pay/status?id=' + start.body.id);
  assert.equal(poll.body.status, 'success'); assert.match(poll.body.receipt, /^UJJWATCH/);
});

/* ---------- reconnect by phone number ---------- */
async function newPackage(phone, tier = '24h', minutes = 1440) {
  const [code] = await vouchers.create({ tier, minutes, count: 1, phone });
  await vouchers.redeem(code, 'old-phone-mac', 'mobile');
  await vouchers.redeem(code, 'tv-mac', 'other');
  return code;
}
const setMode = (phones) => call('/api/admin/reconnect', { phones });

test('phone reconnect: SMS code is required, wrong code is rejected, right code relinks the phone and keeps the TV', async () => {
  const reconnect = require('../src/reconnect'); reconnect._reset();
  await setMode('auto'); sent = [];
  const code = await newPackage('254712000111');
  const first = await call('/api/reconnect', { phone: '0712000111' });
  assert.equal(first.status, 200); assert.equal(first.body.needCode, true); assert.match(first.body.masked, /^0712 \*\*\* 111$/);
  assert.ok(lastOtp(), 'a 6-digit code was texted'); assert.equal(sent.at(-1).recipient, '254712000111');
  assert.ok(sent.at(-1).message.length <= 160, 'one SMS segment');
  assert.ok(!sms.list().some((m) => m.kind === 'otp' && /\d{6}/.test(m.text)), 'the code is not stored in the admin message log');

  const early = await call('/api/reconnect', { phone: '0712000111' });                         // immediate resend is throttled
  assert.equal(early.status, 429); assert.ok(early.body.wait > 0);
  const wrong = await call('/api/reconnect', { phone: '0712000111', code: '000000' === lastOtp() ? '111111' : '000000' });
  assert.equal(wrong.status, 401); assert.match(wrong.body.message, /not right/);
  const before = vdb()[code].devices.map((d) => d.key);
  assert.deepEqual(before, ['old-phone-mac', 'tv-mac']);

  const ok = await call('/api/reconnect', { phone: '0712000111', code: lastOtp() });
  assert.equal(ok.status, 200); assert.equal(ok.body.ok, true); assert.match(ok.body.message, /phone is connected/);
  const after = vdb()[code].devices;
  assert.equal(after.length, 2); assert.equal(after[0].type, 'mobile'); assert.notEqual(after[0].key, 'old-phone-mac'); assert.equal(after[1].key, 'tv-mac', 'companion TV untouched');
  assert.equal((await call('/api/status')).body.authenticated, true);

  const reuse = await call('/api/reconnect', { phone: '0712000111', code: lastOtp() });       // device is bound now: no code needed
  assert.equal(reuse.status, 200);
});

test('reconnect code is single-use and expires after too many wrong tries', async () => {
  const reconnect = require('../src/reconnect'); reconnect._reset(); sent = [];
  await newPackage('254712000222');
  await call('/api/reconnect', { phone: '0712000222' });
  const real = lastOtp(); let last;
  for (let i = 0; i < 6; i++) last = await call('/api/reconnect', { phone: '0712000222', code: real === '123456' ? '654321' : '123456' });
  assert.equal(last.status, 401);
  assert.match(last.body.message, /Too many wrong attempts|expired/);
  const dead = await call('/api/reconnect', { phone: '0712000222', code: real });
  assert.equal(dead.status, 401, 'the right code no longer works after lock-out');
});

test('reconnect modes: number-only, off, strict SMS without SMS, and laptop companions unchanged', async () => {
  const reconnect = require('../src/reconnect'); reconnect._reset();
  const code = await newPackage('254712000333');
  await setMode('number');
  let r = await call('/api/reconnect', { phone: '0712000333' });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true, 'number-only mode relinks immediately');

  await setMode('off');
  r = await call('/api/reconnect', { phone: '0712000333' }, PHONE_UA);
  assert.equal(r.status, 403); assert.match(r.body.message, /voucher code/);
  r = await call('/api/reconnect', { phone: '0712000333' }, LAPTOP_UA);
  assert.equal(r.status, 200, 'laptop/TV reconnect by number still works when phones are off');
  assert.equal(vdb()[code].devices.filter((d) => d.type === 'other').length >= 1, true);

  await setMode('sms'); const keep = process.env.OLYMPUS_SMS_TOKEN; process.env.OLYMPUS_SMS_TOKEN = '';
  await newPackage('254712000444');
  r = await call('/api/reconnect', { phone: '0712000444' }, PHONE_UA);
  assert.equal(r.status, 503, 'strict mode never silently downgrades to number-only');
  await setMode('auto');
  r = await call('/api/reconnect', { phone: '0712000444' }, PHONE_UA);
  assert.equal(r.status, 200, 'auto mode falls back to number-only when SMS is not set up');
  process.env.OLYMPUS_SMS_TOKEN = keep; await setMode('auto');
});

test('reconnect errors: unknown number, expired package, bad input', async () => {
  await setMode('number');
  assert.equal((await call('/api/reconnect', { phone: '0799000000' })).status, 404);
  assert.equal((await call('/api/reconnect', { phone: 'abc' })).status, 400);
  const code = await newPackage('254712000555'); const db = vdb(); db[code].expiresAt = Date.now() - 1000; fs.writeFileSync(vfile(), JSON.stringify(db));
  const r = await call('/api/reconnect', { phone: '0712000555' });
  assert.equal(r.status, 410); assert.match(r.body.message, /expired/);
  await setMode('auto');
});

test('failed SMS send for the code is reported, not swallowed', async () => {
  const reconnect = require('../src/reconnect'); reconnect._reset(); await setMode('auto');
  await newPackage('254712000666'); smsMode = 'down';
  const r = await call('/api/reconnect', { phone: '0712000666' });
  smsMode = 'ok';
  assert.equal(r.status, 503); assert.match(r.body.message, /could not send/i);
  const again = await call('/api/reconnect', { phone: '0712000666' });
  assert.equal(again.status, 200, 'a failed send does not lock the customer out');
});

/* ---------- My devices ---------- */
test('My devices shows the package, marks this device, hides nothing it should show, and removes companions', async () => {
  const reconnect = require('../src/reconnect'); reconnect._reset(); await setMode('number');
  const code = await newPackage('254712000777');
  await call('/api/reconnect', { phone: '0712000777' }, PHONE_UA);               // relink this phone
  const d = await call('/api/my-devices');
  assert.equal(d.status, 200); assert.equal(d.body.code, code); assert.equal(d.body.tier, '24h'); assert.equal(d.body.maxDevices, 2);
  assert.equal(d.body.devices.filter((x) => x.isCurrent).length, 1); assert.equal(d.body.devices.find((x) => x.isCurrent).type, 'mobile');
  const tv = d.body.devices.find((x) => x.type === 'other');
  assert.ok(tv && !tv.isPrimary);
  const rm = await call('/api/my-devices/remove', { key: tv.key });
  assert.equal(rm.status, 200);
  assert.equal((await call('/api/my-devices')).body.devices.length, 1);
  await setMode('auto');
});

/* ---------- SMS automation lifecycle ---------- */
test('lifecycle: receipt -> reminders -> ended notice, each exactly once, and the outbox survives a restart', async () => {
  notify.saveSettings({ expired: { enabled: true }, reminder: { leadMinutes: '1440, 15', minPriceKsh: 0 } });
  sms._reset(); fs.rmSync(path.join(DATA, 'sms-log.json'), { force: true }); fs.rmSync(path.join(DATA, 'sms-state.json'), { force: true }); sent = [];
  const [code] = await vouchers.create({ tier: '7d', minutes: 10080, count: 1, phone: '254722123456' });
  await vouchers.redeem(code, 'life-mac', 'mobile');
  const set = (msLeft) => { const db = vdb(); db[code].expiresAt = Date.now() + msLeft; fs.writeFileSync(vfile(), JSON.stringify(db)); };
  const sweep = async () => { await notify.sweep(); await settle(); };
  const texts = () => sent.filter((m) => m.recipient === '254722123456').map((m) => m.message);

  await notify.purchase({ id: 'life-1', phone: '254722123456', tier: '7d', amount: 100, receipt: 'UJJLIFE1', voucher: code, minutes: 10080 }); await settle();
  assert.equal(texts().length, 1); assert.match(texts()[0], /KES 100 received \(UJJLIFE1\)/);

  set(5 * 86400e3); await sweep(); assert.equal(texts().length, 1, 'nothing 5 days out');
  set(23 * 3600e3); await sweep(); assert.equal(texts().length, 2, 'one-day reminder'); assert.match(texts()[1], /ends in 23h/);
  await sweep(); assert.equal(texts().length, 2, 'not repeated');
  set(14 * 60e3); await sweep(); assert.equal(texts().length, 3, '15-minute reminder'); assert.match(texts()[2], /ends in 14 min/);

  // simulate an app restart mid-way: queue + de-dupe state come back from disk
  sms._reset(); await sweep(); assert.equal(texts().length, 3, 'no duplicates after restart');

  set(-60e3); await sweep(); assert.equal(texts().length, 4, 'ended notice'); assert.match(texts()[3], /has ended/);
  await sweep(); assert.equal(texts().length, 4);
  notify.saveSettings({ expired: { enabled: false } });
});

test('messages queued while the internet is down are delivered after a restart once it returns', async () => {
  sent = []; smsMode = 'down';
  await notify.voucherCode({ phone: '254733555111', code: 'SYN-QUEUE-0001', tier: '1h' });
  await sms._tick(); assert.equal(sms.list({ status: 'queued' }).length >= 1, true);
  sms._reset();                                                                    // "restart": queue reloads from sms-log.json
  assert.equal(sms.list({ status: 'queued' }).some((m) => m.kind === 'voucher'), true, 'still queued after restart');
  smsMode = 'ok'; await settle();
  assert.ok(sent.some((m) => /SYN-QUEUE-0001/.test(m.message)));
});
