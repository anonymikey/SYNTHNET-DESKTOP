// TVs that cannot open the sign-in page: registered by MAC address, connected at network level, cut off at expiry.   Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'synthnet-tv-'));
const PORT = 48000 + Math.floor(Math.random() * 9000), ADMIN = 'test-admin-password-123';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
Object.assign(process.env, { SYNTHNET_DATA: DATA, PORT: String(PORT), ADMIN_TOKEN: ADMIN, ADMIN_LOCAL_ONLY: 'true', THROTTLE_WINDOW_MS: '1', COURTNEYTECH_API_KEY: 'k', COURTNEYTECH_API_SECRET: 's', COURTNEYTECH_ACCOUNT_ID: '7' });
const TV = 'aa-bb-cc-dd-ee-01', TV2 = 'aa-bb-cc-dd-ee-02', STRANGER = '3c-22-fb-00-00-09';
let srv, courtney, vouchers, sessions, tvlink, neighbors = [], mac;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(150); } return null; };
const call = (p, body, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: opts.method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'user-agent': PHONE_UA, ...(opts.admin ? { 'x-admin-token': ADMIN } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const vfile = () => path.join(DATA, 'vouchers.json');
const edit = (fn) => { const db = JSON.parse(fs.readFileSync(vfile(), 'utf8')); fn(db); fs.writeFileSync(vfile(), JSON.stringify(db)); };
const sync = async () => { await tvlink.syncNow(); };
const onLan = (...list) => { neighbors = list.map(([ip, m]) => ({ ip, mac: m })); };

before(async () => {
  const amounts = new Map();
  courtney = http.createServer((q, r) => { let b = ''; q.on('data', (c) => b += c); q.on('end', () => { r.writeHead(200, { 'content-type': 'application/json' }); const body = b ? JSON.parse(b) : {};
    if (q.url.endsWith('/v2/stkpush')) { const id = 'ws_' + Math.random().toString(36).slice(2); amounts.set(id, body.amount); return r.end(JSON.stringify({ success: true, checkoutRequestId: id, transactionId: 't' })); }
    if (q.url.endsWith('/v2/status')) return r.end(JSON.stringify({ success: true, status: 'completed', amountKes: amounts.get(body.checkout_request_id), mpesaReceipt: 'UJJTV' + Math.floor(Math.random() * 1e6) }));
    r.end('{}'); }); });
  await new Promise((r) => courtney.listen(0, '127.0.0.1', r)); process.env.COURTNEYTECH_BASE_URL = `http://127.0.0.1:${courtney.address().port}`;
  vouchers = require('../src/vouchers'); sessions = require('../src/sessions'); tvlink = require('../src/tvlink'); mac = require('../src/mac');
  tvlink._setNeighbors(async () => neighbors);
  srv = await require('../server').start();
});
after(() => { for (const s of [srv, courtney]) { s.closeAllConnections?.(); s.close(); } });

async function customer(phone, tier = '24h', minutes = 1440) {            // a customer connected on their phone (this machine = 127.0.0.1)
  await call('/api/logout', {});
  const [code] = await vouchers.create({ tier, minutes, count: 1, phone });
  const r = await call('/api/login', { code }); assert.equal(r.body.ok, true, JSON.stringify(r.body));
  return code;
}

test('MAC addresses are parsed in every common format and junk is rejected', () => {
  for (const f of ['AA:BB:CC:DD:EE:01', 'aa-bb-cc-dd-ee-01', 'AABB.CCDD.EE01', 'aabbccddee01', ' aa bb cc dd ee 01 ']) assert.equal(mac.normMac(f).mac, 'aa-bb-cc-dd-ee-01', f);
  for (const bad of ['', null, 'AA:BB:CC', 'GG:BB:CC:DD:EE:01', '00:00:00:00:00:00', 'FF:FF:FF:FF:FF:FF', '01:00:5E:00:00:01', 'AA:BB:CC:DD:EE:01:02', '<script>']) assert.equal(mac.normMac(bad), null, String(bad));
  assert.equal(mac.normMac('DA:A1:19:00:00:01').localAdmin, true, 'private/random addresses are flagged'); assert.equal(mac.normMac('3C:22:FB:00:00:01').localAdmin, false, 'a normal manufacturer address is not');
});

test('customer adds a TV by MAC; it connects by itself and shows as online', async () => {
  const code = await customer('254712600001'); onLan();
  const bad = await call('/api/my-devices/add-tv', { mac: 'nope' }); assert.equal(bad.status, 400); assert.match(bad.body.error, /not a valid MAC/);
  const r = await call('/api/my-devices/add-tv', { mac: 'AA:BB:CC:DD:EE:01', label: 'Living room <b>TV</b>' });
  assert.equal(r.status, 200); assert.equal(r.body.mac, TV); assert.equal(r.body.devices.length, 2);
  const row = r.body.devices.find((d) => d.viaMac); assert.equal(row.label, 'Living room bTV/b', 'angle brackets are stripped from names');
  assert.equal(row.online, false, 'not on the Wi-Fi yet: waiting');
  assert.equal(sessions.isAuthed('192.168.137.50'), false);
  onLan(['192.168.137.50', TV]); await sync();
  assert.equal(sessions.isAuthed('192.168.137.50'), true, 'the TV got internet without opening any page');
  assert.equal(sessions.get('192.168.137.50').code, code);
  const list = await call('/api/my-devices'); const tv = list.body.devices.find((d) => d.viaMac); assert.equal(tv.online, true);
  const clients = await call('/api/admin/clients', null, { admin: true });
  assert.ok(clients.body.clients.some((c) => c.ip === '192.168.137.50' && c.tv && c.authenticated), 'admin sees it as a TV');
});

test('a TV with an unknown MAC, or on a package that is not registered, gets nothing', async () => {
  onLan(['192.168.137.50', TV], ['192.168.137.77', STRANGER]); await sync();
  assert.equal(sessions.isAuthed('192.168.137.77'), false);
});

test('the TV follows its MAC when its IP changes; a different device on the old IP is never let in', async () => {
  onLan(['192.168.137.51', TV]); await sync();
  assert.equal(sessions.isAuthed('192.168.137.51'), true); assert.equal(sessions.isAuthed('192.168.137.50'), false, 'old IP cut off');
  onLan(['192.168.137.51', STRANGER]); await sync();                         // the IP was handed to someone else
  assert.equal(sessions.isAuthed('192.168.137.51'), false, 'a different MAC on that IP gets no access');
  onLan(['192.168.137.52', TV]); await sync(); assert.equal(sessions.isAuthed('192.168.137.52'), true);
});

test('a TV that has been gone for 10 minutes loses its session (a reused IP can never inherit it)', async () => {
  onLan(['192.168.137.52', TV]); await sync(); onLan(); tvlink._ageSeen(11 * 60000); await sync();
  assert.equal(sessions.isAuthed('192.168.137.52'), false);
  onLan(['192.168.137.52', TV]); await sync(); assert.equal(sessions.isAuthed('192.168.137.52'), true, 'and it comes straight back when the TV returns');
});

test('when the package expires the TV is disconnected too', async () => {
  onLan(['192.168.137.52', TV]); await sync(); assert.equal(sessions.isAuthed('192.168.137.52'), true);
  edit((db) => { for (const v of Object.values(db)) if (v.phone === '254712600001') v.expiresAt = Date.now() - 1000; });
  await sync();
  assert.equal(sessions.isAuthed('192.168.137.52'), false, 'TV is cut off with the package');
  assert.deepEqual((await vouchers.tvTargets()).map((t) => t.mac), [], 'nothing to link until a new package exists');
  await sync(); await sync(); assert.equal(sessions.isAuthed('192.168.137.52'), false, 'and it stays off');
});

test('buying again switches the TV back on by itself (voucher with the same phone number)', async () => {
  const [code2] = await vouchers.create({ tier: '24h', minutes: 1440, count: 1, phone: '254712600001' });
  await call('/api/logout', {}); const r = await call('/api/login', { code: code2 }); assert.equal(r.body.ok, true);
  const t = await until(async () => (await vouchers.tvTargets()).find((x) => x.mac === TV));
  assert.ok(t, 'the registered TV was carried over to the new package'); assert.equal(t.code, code2); assert.equal(t.label, 'Living room bTV/b', 'the name is carried over too');
  onLan(['192.168.137.52', TV]); await sync(); assert.equal(sessions.isAuthed('192.168.137.52'), true);
});

test('buying again by M-Pesa also carries the TV over', async () => {
  edit((db) => { for (const v of Object.values(db)) if (v.phone === '254712600001') v.expiresAt = Date.now() - 1000; });
  await sync(); assert.equal(sessions.isAuthed('192.168.137.52'), false); await call('/api/logout', {});
  const start = await call('/api/pay/start', { tier: '24h', phone: '0712600001' }); assert.equal(start.body.ok, true);
  const t = await until(async () => (await vouchers.tvTargets()).find((x) => x.mac === TV), 15000);
  assert.ok(t, 'carried over by the payment flow'); await sync(); assert.equal(sessions.isAuthed('192.168.137.52'), true);
});

test('removing the TV in My devices cuts it off and it is not linked again', async () => {
  await call('/api/logout', {});
  const code = await (async () => (await vouchers.tvTargets()).find((x) => x.mac === TV).code)();
  await call('/api/login', { code });
  const rm = await call('/api/my-devices/remove', { key: TV }); assert.equal(rm.status, 200);
  assert.equal(sessions.isAuthed('192.168.137.52'), false);
  await sync(); assert.equal(sessions.isAuthed('192.168.137.52'), false); assert.deepEqual(await vouchers.tvTargets(), []);
});

test('device limit, duplicates and conflicts are handled with clear messages', async () => {
  const code = await customer('254712600002');
  assert.equal((await call('/api/my-devices/add-tv', { mac: TV2 })).status, 200);
  const third = await call('/api/my-devices/add-tv', { mac: 'AA:BB:CC:DD:EE:03' }); assert.equal(third.status, 409); assert.match(third.body.error, /2 of 2 devices/);
  const again = await call('/api/my-devices/add-tv', { mac: TV2 }); assert.equal(again.status, 200, 'adding the same TV twice is harmless');
  assert.equal((await call('/api/my-devices')).body.devices.length, 2);
  // a second customer cannot register a TV that is on someone else's ACTIVE package
  await customer('254712600003');
  const clash = await call('/api/my-devices/add-tv', { mac: TV2 }); assert.equal(clash.status, 409); assert.match(clash.body.error, /another active package/);
  // ...but once that package has expired, the TV can move
  edit((db) => { db[code].expiresAt = Date.now() - 1000; });
  assert.equal((await call('/api/my-devices/add-tv', { mac: TV2 })).status, 200);
});

test("the phone's own address cannot be registered as a TV", async () => {
  const [code] = await vouchers.create({ tier: '24h', minutes: 1440, count: 1, phone: '254712600099' });
  await vouchers.redeem(code, '3c-22-fb-11-22-33', 'mobile');
  const r = await vouchers.addTvByMac(code, '3c-22-fb-11-22-33');
  assert.equal(r.ok, false); assert.match(r.error, /phone on this package/);
});

test('the TV needs an active package to be added at all', async () => {
  await call('/api/logout', {}); edit((db) => { for (const v of Object.values(db)) v.expiresAt = Math.min(v.expiresAt || 1, Date.now() - 1000); });
  const r = await call('/api/my-devices/add-tv', { mac: 'AA:BB:CC:DD:EE:08' }); assert.equal(r.status, 401); assert.match(r.body.error, /Connect with your package/);
});

test('another device reconnecting by number cannot bump a TV that was pinned by MAC', async () => {
  const code = await customer('254712600004'); assert.equal((await call('/api/my-devices/add-tv', { mac: 'AA:BB:CC:DD:EE:04' })).status, 200);
  const r = await vouchers.rebind(code, 'laptop-mac-1', 'other');
  assert.equal(r, false, 'package is full (phone + TV): the laptop is refused instead of replacing the TV');
  assert.ok((await vouchers.getDevices(code)).some((d) => d.key === 'aa-bb-cc-dd-ee-04'));
});

test('admin can link a TV to a customer by phone number or voucher code', async () => {
  const code = await customer('254712600005'); await call('/api/logout', {});
  const bad = await call('/api/admin/tv', { target: '0712600005', mac: 'zz' }, { admin: true }); assert.equal(bad.status, 400);
  assert.equal((await call('/api/admin/tv', { target: '0799999999', mac: 'AA:BB:CC:DD:EE:05' }, { admin: true })).status, 404);
  const byPhone = await call('/api/admin/tv', { target: '0712600005', mac: 'AA:BB:CC:DD:EE:05', label: 'Kitchen TV' }, { admin: true });
  assert.equal(byPhone.status, 200); assert.equal(byPhone.body.code, code);
  onLan(['192.168.137.60', 'aa-bb-cc-dd-ee-05']); await sync(); assert.equal(sessions.isAuthed('192.168.137.60'), true);
  const code2 = await customer('254712600006'); await call('/api/logout', {});
  assert.equal((await call('/api/admin/tv', { target: code2, mac: 'AA:BB:CC:DD:EE:06' }, { admin: true })).status, 200);
  assert.equal((await call('/api/admin/tv', { target: code2, mac: 'AA:BB:CC:DD:EE:05' }, { admin: true })).status, 409);
  assert.equal((await call('/api/admin/tv', { target: 'x', mac: 'AA:BB:CC:DD:EE:07' }, { admin: true })).status, 400);
  assert.equal((await call('/api/admin/tv', { target: code2, mac: 'AA:BB:CC:DD:EE:07' })).status, 401, 'admin only');
});

test('an admin kick keeps a TV off until the customer registers it again', async () => {
  onLan(['192.168.137.60', 'aa-bb-cc-dd-ee-05']); await sync(); assert.equal(sessions.isAuthed('192.168.137.60'), true);
  sessions.revoke('192.168.137.60'); await sync(); assert.equal(sessions.isAuthed('192.168.137.60'), false, 'kicked, not silently relinked');
  await call('/api/admin/tv', { target: '0712600005', mac: 'AA:BB:CC:DD:EE:05' }, { admin: true }); await sync();
  assert.equal(sessions.isAuthed('192.168.137.60'), true, 'linking it again clears the kick');
});

test('during an outage TVs are not unlinked (clocks are paused) and everything resumes after', async () => {
  const outage = require('../src/outage'); onLan(['192.168.137.60', 'aa-bb-cc-dd-ee-05']); await sync();
  await outage.start(); await sync(); assert.equal(sessions.isAuthed('192.168.137.60'), true);
  await outage.resolve(); await sync(); assert.equal(sessions.isAuthed('192.168.137.60'), true);
});
