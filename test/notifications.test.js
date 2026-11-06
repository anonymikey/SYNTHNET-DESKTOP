// Notification bell backend: event log semantics + everything that must be recorded.   Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'synthnet-ntf-'));
const PORT = 43000 + Math.floor(Math.random() * 15000), ADMIN = 'test-admin-password-123', TOKEN = '1|testtoken1234567890';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
let payMode = 'ok', smsMode = 'ok', srv, olympus, courtney, events, vouchers, sms;

Object.assign(process.env, { SYNTHNET_DATA: DATA, PORT: String(PORT), ADMIN_TOKEN: ADMIN, ADMIN_LOCAL_ONLY: 'true', THROTTLE_WINDOW_MS: '1', OLYMPUS_SMS_TOKEN: TOKEN, OLYMPUS_SMS_SENDER_ID: 'TSCONNECT',
  COURTNEYTECH_API_KEY: 'k', COURTNEYTECH_API_SECRET: 's', COURTNEYTECH_ACCOUNT_ID: '7' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(150); } return null; };
const call = (p, body, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: opts.method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'user-agent': PHONE_UA, ...(opts.noAuth ? {} : { 'x-admin-token': opts.token || ADMIN }) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const feed = async (q = '') => (await call('/api/admin/notifications?limit=200' + q)).body;
const titles = async () => (await feed()).items.map((x) => x.title);
const find = async (re) => (await feed()).items.find((x) => re.test(x.title));
const vfile = () => path.join(DATA, 'vouchers.json');

before(async () => {
  olympus = http.createServer((q, r) => { let b = ''; q.on('data', (c) => b += c); q.on('end', () => {
    if (smsMode === 'down') return q.socket.destroy();
    if (smsMode === 'balance') { r.writeHead(400, { 'content-type': 'application/json' }); return r.end('{"status":"error","message":"Insufficient balance"}'); }
    r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"status":"success","data":{"uid":"u1"}}'); }); });
  const amounts = new Map();
  courtney = http.createServer((q, r) => { let b = ''; q.on('data', (c) => b += c); q.on('end', () => { r.writeHead(200, { 'content-type': 'application/json' }); const body = b ? JSON.parse(b) : {};
    if (q.url.endsWith('/v2/stkpush')) { const id = 'ws_' + Math.random().toString(36).slice(2); amounts.set(id, body.amount); return r.end(JSON.stringify({ success: true, checkoutRequestId: id, transactionId: 't' })); }
    if (q.url.endsWith('/v2/status')) {
      if (payMode === 'cancel') return r.end(JSON.stringify({ success: true, status: 'cancelled', resultDesc: 'Request cancelled by user' }));
      return r.end(JSON.stringify({ success: true, status: 'completed', amountKes: payMode === 'mismatch' ? 1 : amounts.get(body.checkout_request_id), mpesaReceipt: 'UJJNOTIF' + Math.floor(Math.random() * 1e6) })); }
    r.end('{}'); }); });
  await new Promise((r) => olympus.listen(0, '127.0.0.1', r)); await new Promise((r) => courtney.listen(0, '127.0.0.1', r));
  process.env.OLYMPUS_SMS_BASE_URL = `http://127.0.0.1:${olympus.address().port}/api/v3`; process.env.COURTNEYTECH_BASE_URL = `http://127.0.0.1:${courtney.address().port}`;
  events = require('../src/events'); vouchers = require('../src/vouchers'); sms = require('../src/sms');
  srv = await require('../server').start();
});
after(() => { for (const s of [srv, olympus, courtney]) { s.closeAllConnections?.(); s.close(); } });

/* ---------------- the log itself ---------------- */
test('unread, seen and silent activity are tracked separately', () => {
  events.clear({ scope: 'all' });
  events.emit({ category: 'payments', level: 'success', title: 'Payment received: KSh 30' });
  events.emit({ category: 'customers', silent: true, title: 'Customer logged out' });
  let c = events.counts();
  assert.equal(c.unread, 1, 'silent activity does not count as unread'); assert.equal(c.unseen, 1, 'the bell rings'); assert.equal(c.total, 2, 'but it is recorded');
  events.markSeen(); c = events.counts();
  assert.equal(c.unseen, 0, 'opening the panel calms the bell'); assert.equal(c.unread, 1, 'but the badge stays until the item is read');
  events.emit({ category: 'sms', level: 'critical', title: 'SMS balance is too low' });
  c = events.counts(); assert.equal(c.unseen, 1, 'a NEW notification rings again'); assert.equal(c.unread, 2); assert.equal(c.topLevel, 'critical'); assert.deepEqual(c.byCategory, { payments: 1, sms: 1 });
  const first = events.list({ unread: true }).items.find((x) => x.category === 'payments');
  assert.equal(events.markRead({ ids: [first.id] }), 1); assert.equal(events.counts().unread, 1);
  assert.equal(events.markRead({ all: true, category: 'sms' }), 1); assert.equal(events.counts().unread, 0);
});

test('repeats are merged; a problem the admin already read comes back as news', () => {
  events.clear({ scope: 'all' });
  const a = events.emit({ category: 'sms', level: 'warning', title: 'SMS provider unreachable', dedupeKey: 'k1' });
  const b = events.emit({ category: 'sms', level: 'warning', title: 'SMS provider unreachable', dedupeKey: 'k1' });
  assert.equal(a.id, b.id); assert.equal(b.count, 2); assert.equal(events.counts().total, 1);
  events.markRead({ all: true }); assert.equal(events.counts().unread, 0);
  events.emit({ category: 'sms', level: 'warning', title: 'SMS provider unreachable', dedupeKey: 'k1' });
  assert.equal(events.counts().unread, 1, 'back as unread'); assert.equal(events.list().items[0].count, 3);
  events.emit({ category: 'admin', silent: true, title: 'Admin panel opened', dedupeKey: 'open', dedupeMode: 'skip' });
  events.emit({ category: 'admin', silent: true, title: 'Admin panel opened', dedupeKey: 'open', dedupeMode: 'skip' });
  assert.equal(events.list().items.filter((x) => x.title === 'Admin panel opened').length, 1, 'skip mode never duplicates');
});

test('routine events start ringing once they repeat enough (ringAt)', () => {
  events.clear({ scope: 'all' }); events.markSeen();
  for (let i = 1; i <= 4; i++) { events.emit({ category: 'security', level: 'warning', silent: true, ringAt: 5, title: 'Wrong voucher code entered', dedupeKey: 'g' }); assert.equal(events.counts().unread, 0, 'try ' + i); }
  events.emit({ category: 'security', level: 'warning', silent: true, ringAt: 5, title: 'Wrong voucher code entered', dedupeKey: 'g' });
  const c = events.counts(); assert.equal(c.unread, 1); assert.equal(c.unseen, 1); assert.equal(events.list().items[0].count, 5);
});

test('muted categories are not recorded; the log survives a restart', () => {
  events.clear({ scope: 'all' });
  events.setMuted(['outage']); assert.equal(events.emit({ category: 'outage', title: 'Outage recorded' }), null);
  assert.throws(() => events.setMuted(['nonsense']), /Unknown/);
  events.setMuted([]);
  events.emit({ category: 'payments', level: 'success', title: 'Payment received: KSh 5' }); events.flush();
  events._reset();                                                       // "restart": reload from notifications.json
  const l = events.list().items; assert.equal(l.length, 1); assert.equal(l[0].title, 'Payment received: KSh 5');
  assert.equal(events.counts().unread, 1);
});

test('update notice: first run welcomes, a new version announces itself once', () => {
  events.clear({ scope: 'all' }); events._reset();
  const file = path.join(DATA, 'notifications.json'); const d = JSON.parse(fs.readFileSync(file, 'utf8')); d.meta = { lastVersion: '0.8.0' }; fs.writeFileSync(file, JSON.stringify(d)); events._reset();
  events.start({ version: '0.9.0' });
  const n = events.list().items.find((x) => /updated to v0\.9\.0/.test(x.title));
  assert.ok(n); assert.match(n.message, /from v0\.8\.0/); assert.match(n.message, /notification bell/);
  events._reset(); events.start({ version: '0.9.0' });
  assert.equal(events.list().items.filter((x) => /updated to/.test(x.title)).length, 1, 'not repeated on the next start');
});

/* ---------------- what the platform records ---------------- */
test('the bell API needs the admin token', async () => {
  assert.equal((await call('/api/admin/notifications', null, { noAuth: true })).status, 401);
  assert.equal((await call('/api/admin/notifications/poll?since=0')).status, 200);
});

test('payments: success rings with new/returning customer; the M-Pesa request and cancellations are quiet', async () => {
  events.clear({ scope: 'all' }); payMode = 'ok';
  const s1 = await call('/api/pay/start', { tier: '24h', phone: '0712777001' }); assert.equal(s1.body.ok, true);
  const first = await until(async () => find(/Payment received/)); assert.ok(first, 'payment notification appeared (server-side, no browser polling)');
  assert.equal(first.level, 'success'); assert.equal(first.read, false); assert.match(first.title, /KSh 30/); assert.match(first.message, /24 Hours Unlimited.*UJJNOTIF.*NEW customer/);
  assert.ok(!first.message.includes('254712777001'), 'phone numbers are masked');
  const req = await find(/M-Pesa request sent/); assert.ok(req && req.read, 'the STK request is recorded but silent');
  await wait(300);
  await call('/api/logout', {});
  const s2 = await call('/api/pay/start', { tier: '24h', phone: '0712777001' }); assert.equal(s2.body.ok, true);
  const again = await until(async () => (await feed()).items.find((x) => /Payment received/.test(x.title) && /returning customer/.test(x.message)));
  assert.ok(again, 'same number again is a returning customer');
});

test('payments: a cancelled request is quiet, an amount mismatch is critical', async () => {
  await call('/api/logout', {}); payMode = 'cancel'; events.markRead({ all: true });
  await call('/api/pay/start', { tier: '1h', phone: '0712777002' });
  const cancelled = await until(async () => find(/cancelled by customer/)); assert.ok(cancelled); assert.equal(cancelled.read, true);
  payMode = 'mismatch';
  await call('/api/pay/start', { tier: '1h', phone: '0712777003' });
  const bad = await until(async () => find(/amount mismatch/i)); assert.ok(bad); assert.equal(bad.level, 'critical'); assert.equal(bad.read, false); assert.match(bad.message, /NOT granted/);
  payMode = 'ok';
});

test('customers: first voucher use rings, later logins are quiet, repeated wrong codes escalate', async () => {
  events.markRead({ all: true });
  const [code] = await vouchers.create({ tier: '3h', minutes: 180, count: 1 });
  const login = await call('/api/login', { code }); assert.equal(login.body.ok, true);
  const redeemed = await find(/Voucher redeemed/); assert.ok(redeemed); assert.equal(redeemed.level, 'success'); assert.equal(redeemed.read, false); assert.ok(redeemed.message.includes(code));
  await call('/api/logout', {}); await call('/api/login', { code });
  assert.equal((await feed()).items.filter((x) => /Voucher redeemed/.test(x.title)).length, 1, 'only the first use is news');
  assert.ok(await find(/Customer connected with voucher/));
  await call('/api/logout', {}); events.markRead({ all: true });
  for (let i = 0; i < 4; i++) await call('/api/login', { code: 'SYN-WRNG-000' + i });
  const quiet = await find(/Wrong voucher code/); assert.equal(quiet.read, true, 'a few typos stay quiet');
  await call('/api/login', { code: 'SYN-WRNG-0009' });
  const loud = await find(/Wrong voucher code/); assert.equal(loud.read, false); assert.equal(loud.count, 5); assert.equal(loud.category, 'security');
});

test('every admin change is logged quietly, with no secrets', async () => {
  events.markRead({ all: true }); const unreadBefore = events.counts().unread;
  await call('/api/admin/vouchers', { tier: '1h', count: 3 });
  await call('/api/admin/finance', { dailyCostKsh: 100 });
  await call('/api/admin/finance/expense', { date: '2026-10-20', label: 'Router repair', amountKsh: 500 });
  await call('/api/admin/greeting', { enabled: true });
  await call('/api/admin/reconnect', { phones: 'auto' });
  await call('/api/admin/sms/credentials', { token: '9|newsecrettoken-abcdefg', senderId: 'TSCONNECT' });
  await call('/api/admin/sms/credentials', { token: TOKEN, senderId: 'TSCONNECT' });
  const t = await titles();
  for (const re of [/Generated 3 vouchers/, /Cost settings updated/, /Expense added/, /Portal greeting updated/, /Reconnect mode changed/, /SMS connection details saved/]) assert.ok(t.some((x) => re.test(x)), String(re));
  assert.equal(events.counts().unread, unreadBefore, 'your own changes never ring the bell');
  assert.ok(!JSON.stringify(await feed()).includes('newsecrettoken'), 'tokens are never recorded');
  await call('/api/admin/greeting', { periods: [{ id: 'morning', start: 99 }] });
  assert.ok(!(await titles()).some((x) => /Portal greeting updated/.test(x) && false), 'rejected changes are not logged as done');
  const before = (await feed()).items.filter((x) => /Portal greeting updated/.test(x.title)).reduce((n, x) => n + x.count, 0);
  assert.equal(before, 1, 'a rejected change (400) was not logged');
});

test('outage start and restore are recorded', async () => {
  await call('/api/admin/outage', { action: 'start', notify: false });
  assert.ok(await find(/Outage recorded/));
  await call('/api/admin/outage', { action: 'resolve', notify: false });
  const back = await find(/Service restored/); assert.ok(back); assert.equal(back.category, 'outage');
});

test('security: admin sign-in is logged, repeated wrong tokens ring', async () => {
  events.markRead({ all: true });
  assert.ok(await find(/Admin panel opened/));
  for (let i = 0; i < 2; i++) await call('/api/admin/notifications', null, { token: 'wrong-token-' + i });
  assert.equal((await find(/Wrong admin token/)).read, true, 'one or two typos stay quiet');
  await call('/api/admin/notifications', null, { token: 'wrong-token-3' });
  const loud = await find(/Wrong admin token/); assert.equal(loud.read, false); assert.equal(loud.count, 3);
});

test('SMS problems: empty balance is critical, a connection problem is a warning, OTP failures count too', async () => {
  events.markRead({ all: true }); smsMode = 'balance';
  await vouchers.create({ tier: '1h', minutes: 60, count: 1 });
  await require('../src/notify').voucherCode({ phone: '254733000111', code: 'SYN-TEST-0001', tier: '1h' }); await sms._tick();
  const bal = await find(/SMS balance is too low/); assert.ok(bal); assert.equal(bal.level, 'critical'); assert.equal(bal.read, false); assert.match(bal.message, /Top up/);
  smsMode = 'down'; sms._reset();
  await require('../src/notify').voucherCode({ phone: '254733000222', code: 'SYN-TEST-0002', tier: '1h' }); await sms._tick();
  const down = await find(/SMS provider unreachable/); assert.ok(down); assert.equal(down.level, 'warning');
  smsMode = 'ok';
});

test('reconnect by phone number is recorded; its wrong codes escalate', async () => {
  events.markRead({ all: true }); await call('/api/logout', {});
  const [code] = await vouchers.create({ tier: '24h', minutes: 1440, count: 1, phone: '254712888999' });
  await vouchers.redeem(code, 'old-phone-mac', 'mobile');
  const first = await call('/api/reconnect', { phone: '0712888999' }); assert.equal(first.body.needCode, true);
  assert.ok(await find(/Reconnect code sent/));
  for (let i = 0; i < 5; i++) await call('/api/reconnect', { phone: '0712888999', code: '00000' + i });
  const w = await find(/Wrong reconnect codes/); assert.ok(w); assert.equal(w.read, false); assert.ok(!w.message.includes('254712888999'));
});

test('package expiry is recorded quietly', async () => {
  const [code] = await vouchers.create({ tier: '1h', minutes: 60, count: 1, phone: '254712999111' });
  await vouchers.redeem(code, 'exp-mac', 'mobile');
  const db = JSON.parse(fs.readFileSync(vfile(), 'utf8')); db[code].expiresAt = Date.now() + 700; fs.writeFileSync(vfile(), JSON.stringify(db));
  await wait(900); await events._sweep();
  const x = await find(/Package expired/); assert.ok(x); assert.equal(x.read, true); assert.ok(x.message.includes(code));
  const n = (await feed()).items.filter((i) => /Package expired/.test(i.title)).length; await events._sweep();
  assert.equal((await feed()).items.filter((i) => /Package expired/.test(i.title)).length, n, 'not repeated');
});

test('read / seen / clear / mute through the API', async () => {
  await call('/api/admin/notifications/read', { all: true });
  events.emit({ category: 'system', level: 'critical', title: 'Something went wrong on the server' });
  let p = (await call('/api/admin/notifications/poll?since=0')).body; assert.ok(p.counts.unread >= 1 && p.counts.unseen >= 1);
  assert.equal((await call('/api/admin/notifications/seen', {})).body.counts.unseen, 0);
  const id = (await feed('&unread=1')).items[0].id;
  assert.equal((await call('/api/admin/notifications/read', { ids: [id] })).body.marked, 1);
  const only = (await feed('&category=payments')).items; assert.ok(only.length && only.every((x) => x.category === 'payments'));
  const since = (await call('/api/admin/notifications/poll?since=' + (await feed()).counts.latestRev)).body; assert.equal(since.items.length, 0, 'poll returns only what is new');
  assert.equal((await call('/api/admin/notifications/prefs', { muted: ['outage'] })).body.prefs.muted[0], 'outage');
  const outageRows = async () => (await feed()).items.filter((x) => x.category === 'outage').length, had = await outageRows();
  await call('/api/admin/outage', { action: 'start', notify: false }); await call('/api/admin/outage', { action: 'resolve', notify: false });
  assert.equal(await outageRows(), had, 'a muted category is not recorded');
  await call('/api/admin/notifications/prefs', { muted: [] });
  assert.equal((await call('/api/admin/notifications/prefs', { muted: ['bogus'] })).status, 400);
  const cleared = (await call('/api/admin/notifications/clear', { scope: 'read' })).body; assert.ok(cleared.removed > 0);
  // (the "Admin panel opened" entry is re-created by this very request, which is correct)
  assert.equal((await feed()).items.filter((x) => !/Admin panel opened/.test(x.title)).every((x) => !x.read), true, 'only unread items are left');
});
