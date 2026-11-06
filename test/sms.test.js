// Integration tests for SMS messaging against a local fake Olympus SMS server (no real SMS is sent).
// Run:  npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'synthnet-sms-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const ADMIN = 'test-admin-password-123';
let mode = 'ok', received = [], mock, srv;

Object.assign(process.env, { SYNTHNET_DATA: DATA, PORT: String(PORT), ADMIN_TOKEN: ADMIN, ADMIN_LOCAL_ONLY: 'true', OLYMPUS_SMS_TOKEN: '1|testtoken1234567890', OLYMPUS_SMS_SENDER_ID: 'TSCONNECT', SMS_TIMEZONE: 'Africa/Nairobi' });

let sms, notify, vouchers;
const api = (p, body, method) => fetch(`http://127.0.0.1:${PORT}/api/admin${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'x-admin-token': ADMIN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 20; i++) { sms._expedite(); await sms._tick(); if (!sms.list({ status: 'queued' }).length) return; await wait(20); } };
const sentTexts = () => received.map((r) => r.body.message);

before(async () => {
  mock = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => raw += c);
    req.on('end', () => {
      if (mode === 'down') return req.socket.destroy();
      if (req.headers.authorization !== 'Bearer 1|testtoken1234567890') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"status":"error","message":"Unauthenticated."}'); }
      if (req.method === 'POST' && req.url === '/api/v3/sms/send') {
        const body = JSON.parse(raw); received.push({ body, headers: req.headers });
        if (mode === 'balance') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"status":"error","message":"Insufficient balance"}'); }
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ status: 'success', data: { uid: 'u' + received.length } }));
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"success","data":[]}');
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.OLYMPUS_SMS_BASE_URL = `http://127.0.0.1:${mock.address().port}/api/v3`;
  sms = require('../src/sms'); notify = require('../src/notify'); vouchers = require('../src/vouchers');
  srv = await require('../server').start();
});
after(() => { srv.closeAllConnections?.(); srv.close(); mock.closeAllConnections?.(); mock.close(); });

test('message length: GSM-7 vs Unicode segments', () => {
  assert.deepEqual(sms.measure('a'.repeat(160)), { encoding: 'GSM-7', length: 160, segments: 1 });
  assert.equal(sms.measure('a'.repeat(161)).segments, 2);
  assert.equal(sms.measure('Don\u2019t').encoding, 'Unicode');          // curly apostrophe forces Unicode
  assert.equal(sms.measure('\u20ac'.repeat(81)).segments, 2);           // euro sign costs 2 GSM units
});

test('default messages are plain ASCII and fit one SMS', () => {
  for (const k of notify.KINDS) {
    const p = notify.preview(notify.DEFAULTS[k].template);
    assert.equal(p.encoding, 'GSM-7', k);
    assert.ok(p.segments <= 2, `${k} is ${p.length} chars`);
  }
});

test('settings reject unknown placeholders and bad reminder times', () => {
  assert.throws(() => notify.saveSettings({ purchase: { template: 'Hi {nmae}' } }), /unknown placeholder/);
  assert.throws(() => notify.saveSettings({ reminder: { leadMinutes: '0, abc' } }), /whole minutes/);
  assert.throws(() => notify.saveSettings({ doNotMessage: ['12345'] }), /valid Kenyan number/);
  const s = notify.saveSettings({ reminder: { leadMinutes: '15, 1440' } });
  assert.deepEqual(s.reminder.leadMinutes, [1440, 15]);
});

test('purchase receipt is sent with code, amount, receipt and expiry', async () => {
  received = [];
  const [code] = await vouchers.create({ tier: '24h', minutes: 1440, count: 1, phone: '254712345678' });
  await vouchers.redeem(code, 'aa-bb-cc-dd-ee-01', 'mobile');
  await notify.purchase({ id: 'pay-1', phone: '254712345678', tier: '24h', amount: 30, receipt: 'UJJ12ABC34', voucher: code });
  await notify.purchase({ id: 'pay-1', phone: '254712345678', tier: '24h', amount: 30, receipt: 'UJJ12ABC34', voucher: code });  // duplicate trigger
  await settle();
  assert.equal(received.length, 1, 'exactly one SMS even if triggered twice');
  const r = received[0];
  assert.equal(r.body.recipient, '254712345678'); assert.equal(r.body.sender_id, 'TSCONNECT'); assert.equal(r.body.type, 'plain');
  assert.match(r.body.message, /KES 30 received \(UJJ12ABC34\)/); assert.match(r.body.message, new RegExp(code)); assert.match(r.body.message, /24 Hours Unlimited active until (today|tomorrow)/);
});

test('failed delivery is retried, and permanent errors are not', async () => {
  received = []; mode = 'down';
  await notify.voucherCode({ phone: '254722000001', code: 'SYN-TEST-0001', tier: '1h' });
  await sms._tick();
  let row = sms.list().find((m) => m.kind === 'voucher');
  assert.equal(row.status, 'queued'); assert.match(row.error, /Could not reach/);
  mode = 'ok'; await settle();
  row = sms.list().find((m) => m.kind === 'voucher');
  assert.equal(row.status, 'sent'); assert.equal(received.length, 1);

  mode = 'balance';
  await notify.voucherCode({ phone: '254722000002', code: 'SYN-TEST-0002', tier: '1h' });
  await sms._tick();
  row = sms.list().find((m) => m.to.includes('****') && m.status === 'failed');
  assert.ok(row, 'insufficient balance is reported, not retried forever'); assert.match(row.error, /Insufficient balance/);
  mode = 'ok';
  assert.ok(sms.retry(row.id)); await settle();
  assert.equal(sms.list().filter((m) => m.status === 'failed').length, 0);
});

test('expiry reminder: once per window, skips cheap packages and renewed customers', async () => {
  received = []; sms._reset(); fs.rmSync(path.join(DATA, 'sms-log.json'), { force: true });
  const vfile = path.join(DATA, 'vouchers.json'), now = Date.now();
  const make = async (tier, minutes, phone, leftMin) => {
    const [code] = await vouchers.create({ tier, minutes, count: 1, phone });
    await vouchers.redeem(code, 'k-' + code, 'mobile');
    const db = JSON.parse(fs.readFileSync(vfile, 'utf8')); db[code].expiresAt = now + leftMin * 60000; fs.writeFileSync(vfile, JSON.stringify(db)); return code;
  };
  await make('24h', 1440, '254733000001', 10);        // eligible: 24h package, 10 min left
  await make('1h', 60, '254733000002', 10);           // 1h package costs KSh 5: below minimum price
  await make('24h', 1440, '254733000003', 10);        // has renewed...
  await make('7d', 10080, '254733000003', 9000);      // ...with a longer package: no nagging
  await make('24h', 1440, '254733000004', 600);       // 10 hours left: not yet in the window
  await notify.sweep(); await settle();
  await notify.sweep(); await settle();                // second sweep must not repeat
  const texts = sentTexts();
  assert.equal(texts.length, 1, JSON.stringify(texts));
  assert.equal(received[0].body.recipient, '254733000001');
  assert.match(texts[0], /ends in 10 min/);
});

test('reminders are paused while an outage is recorded', async () => {
  received = [];
  const [code] = await vouchers.create({ tier: '24h', minutes: 1440, count: 1, phone: '254733000009' });
  await vouchers.redeem(code, 'k-paused', 'mobile');
  const vfile = path.join(DATA, 'vouchers.json'), db = JSON.parse(fs.readFileSync(vfile, 'utf8')); db[code].expiresAt = Date.now() + 5 * 60000; fs.writeFileSync(vfile, JSON.stringify(db));
  await notify.sweep(() => true); await settle();
  assert.equal(received.length, 0);
});

test('outage: start notice to active customers, restored notice with credited time', async () => {
  received = []; sms._reset(); fs.rmSync(path.join(DATA, 'sms-log.json'), { force: true });
  const v = JSON.parse(fs.readFileSync(path.join(DATA, 'vouchers.json'), 'utf8'));
  const activeWithPhone = new Set(Object.values(v).filter((x) => x.phone && x.redeemedAt && x.expiresAt > Date.now()).map((x) => x.phone));
  let r = await api('/outage', { action: 'start', notify: false });
  assert.equal(r.status, 200); await settle(); assert.equal(received.length, 0, 'admin can start an outage silently');
  r = await api('/outage', { action: 'resolve', notify: false }); assert.equal(r.status, 200);

  r = await api('/outage', { action: 'start' });
  assert.equal(r.body.sms.queued, activeWithPhone.size); await settle();
  assert.ok(received.length >= 1); assert.match(sentTexts()[0], /service interruption/);
  const recipients = received.flatMap((x) => x.body.recipient.split(','));
  assert.equal(new Set(recipients).size, activeWithPhone.size, 'each customer is messaged once');

  await wait(1200);
  received = [];
  r = await api('/outage', { action: 'resolve' });
  assert.equal(r.status, 200); assert.ok(r.body.sms.queued >= 1); await settle();
  assert.match(sentTexts()[0], /service is back\. \d+ (min|h)/);
});

test('stale "outage started" notices are cancelled when service returns before they could be sent', async () => {
  received = []; mode = 'down';
  await api('/outage', { action: 'start' }); await sms._tick();
  assert.ok(sms.list({ status: 'queued' }).some((m) => m.kind === 'outage_start'));
  mode = 'ok';
  await api('/outage', { action: 'resolve', notify: false });
  await notify.outageEnded({ id: 'x', codes: [] });
  await settle();
  assert.ok(!sentTexts().some((t) => /service interruption/.test(t)), 'stale outage notice must not go out after restoration');
});

test('broadcast: audiences, opt-outs, chunking, schedule pass-through', async () => {
  received = []; sms._reset(); fs.rmSync(path.join(DATA, 'sms-log.json'), { force: true });
  notify.saveSettings({ doNotMessage: ['0733000001'] });
  const all = await api('/sms/audience', { audience: 'all', message: 'Offer! 24h for KES 30. Help: {support}' });
  assert.equal(all.status, 200); assert.ok(all.body.count >= 3); assert.equal(all.body.excluded, 1);
  const custom = await api('/sms/audience', { audience: 'custom', numbers: '0711 000 111, +254722000222\n0711000111, 123' });
  assert.equal(custom.body.count, 2); assert.deepEqual(custom.body.invalid, ['123']);

  const numbers = Array.from({ length: 120 }, (_, i) => '07' + String(10000000 + i));
  const sent = await api('/sms/broadcast', { audience: 'custom', numbers: numbers.join(','), message: 'Weekend offer: 24 Hours for KES 30. Help: {support}', scheduleTime: '2999-01-02T07:30' });
  assert.equal(sent.status, 200); assert.equal(sent.body.queued, 120); await settle();
  assert.equal(received.length, 3, '120 recipients -> 3 requests of <= 50');
  assert.ok(received.every((x) => x.body.schedule_time === '2999-01-02 07:30'));
  assert.ok(received.every((x) => x.body.message.includes('Help: 0700000000')));
  assert.equal(received.flatMap((x) => x.body.recipient.split(',')).length, 120);

  assert.equal((await api('/sms/broadcast', { audience: 'custom', numbers: '0711000111', message: 'x', scheduleTime: '2001-01-01T00:00' })).status, 400);
  assert.equal((await api('/sms/broadcast', { audience: 'custom', numbers: '', message: 'x' })).status, 400);
  notify.saveSettings({ doNotMessage: [] });
});

test('admin API: credentials are saved to .env, never echoed back; protected by token', async () => {
  const noTok = await fetch(`http://127.0.0.1:${PORT}/api/admin/sms/status`);
  assert.equal(noTok.status, 401);
  const r = await api('/sms/credentials', { token: '9|newtoken-abcdefghij', senderId: 'MYWIFI' });
  assert.equal(r.status, 200); assert.equal(r.body.senderId, 'MYWIFI');
  assert.ok(!JSON.stringify(r.body).includes('newtoken-abcdefghij'), 'token must not be returned');
  const env = fs.readFileSync(path.join(DATA, '.env'), 'utf8');
  assert.match(env, /OLYMPUS_SMS_TOKEN="9\|newtoken-abcdefghij"/); assert.match(env, /OLYMPUS_SMS_SENDER_ID="MYWIFI"/);
  assert.equal((await api('/sms/credentials', { token: 'bad"token-123456' })).status, 400);
  await api('/sms/credentials', { token: '1|testtoken1234567890', senderId: 'TSCONNECT' });
  assert.equal((await api('/sms/test-connection', {})).body.ok, true);
});

test('voucher generator can SMS a code to a buyer; award by phone sends the code', async () => {
  received = [];
  const g = await api('/vouchers', { tier: '1h', count: 1, phone: '0744111222' });
  assert.equal(g.status, 200); assert.equal(g.body.smsQueued, true); await settle();
  assert.match(sentTexts()[0], new RegExp(g.body.codes[0]));
  assert.equal((await api('/vouchers', { tier: '1h', count: 5, phone: '0744111222' })).status, 400);
  received = [];
  const a = await api('/award', { tier: '3h', target: '0755333444', deviceType: 'mobile' });
  assert.equal(a.status, 200); assert.equal(a.body.smsQueued, true); await settle();
  assert.match(sentTexts()[0], /given 3 Hours Unlimited free/);
});

test('nothing is sent (and nothing breaks) when SMS is not configured', async () => {
  const keep = process.env.OLYMPUS_SMS_TOKEN; process.env.OLYMPUS_SMS_TOKEN = ''; received = [];
  assert.equal(await notify.purchase({ id: 'p9', phone: '254712345678', tier: '1h', amount: 5, voucher: 'SYN-X' }), null);
  await assert.rejects(notify.broadcast({ audience: 'custom', numbers: '0711000111', message: 'hi' }), /not set up/);
  process.env.OLYMPUS_SMS_TOKEN = keep; assert.equal(received.length, 0);
});
