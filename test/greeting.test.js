// Tests for the portal greeting: Nairobi time logic, validation, admin API, public config.   Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'synthnet-gr-'));
const PORT = 41000 + Math.floor(Math.random() * 15000), ADMIN = 'test-admin-password-123';
Object.assign(process.env, { SYNTHNET_DATA: DATA, PORT: String(PORT), ADMIN_TOKEN: ADMIN, ADMIN_LOCAL_ONLY: 'true' });
const G = require('../public/greeting.js');
let srv;
const api = (p, body) => fetch(`http://127.0.0.1:${PORT}/api/admin${p}`, { method: body ? 'POST' : 'GET', headers: { 'x-admin-token': ADMIN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));

before(async () => { srv = await require('../server').start(); });
after(() => { srv.closeAllConnections?.(); srv.close(); });

const utc = (iso) => Date.parse(iso);
const periods = () => require('../src/greeting').DEFAULTS.periods;
const nameAt = (iso) => G.resolve(periods(), G.eat(utc(iso)).hour).id;

test('time is Nairobi (UTC+3), independent of the machine time zone', () => {
  assert.equal(G.eat(utc('2026-10-19T20:59:00Z')).hour, 23);
  assert.equal(G.eat(utc('2026-10-19T21:00:00Z')).hour, 0);            // midnight EAT is 21:00 UTC
  assert.equal(G.eat(utc('2026-10-19T21:00:00Z')).weekday, 'Tuesday'); // and already the next weekday
  assert.equal(G.clockText(utc('2026-10-19T15:45:00Z')), 'Mon 19 Oct \u00b7 6:45 PM EAT');
  assert.equal(G.clockText(utc('2026-10-19T09:05:00Z')), 'Mon 19 Oct \u00b7 12:05 PM EAT');
  assert.equal(G.clockText(utc('2026-10-19T21:30:00Z')), 'Tue 20 Oct \u00b7 12:30 AM EAT');
});

test('greeting changes exactly at the default boundaries (05, 12, 17, 21 EAT)', () => {
  // Times below are UTC; Nairobi = UTC + 3.
  const cases = { '01:59': 'night', '02:00': 'morning', '08:59': 'morning', '09:00': 'afternoon', '13:59': 'afternoon', '14:00': 'evening', '17:59': 'evening', '18:00': 'night', '20:59': 'night', '21:00': 'night' };
  for (const [utcTime, want] of Object.entries(cases)) assert.equal(nameAt(`2026-10-19T${utcTime}:00Z`), want, utcTime + 'Z');
});

test('custom start hours work, including wrap past midnight', () => {
  const p = [{ id: 'a', start: 6 }, { id: 'b', start: 18 }];
  assert.equal(G.resolve(p, 3).id, 'b'); assert.equal(G.resolve(p, 6).id, 'a'); assert.equal(G.resolve(p, 17).id, 'a'); assert.equal(G.resolve(p, 23).id, 'b');
  assert.equal(G.resolve([], 5), null);
});

test('placeholders fill in; nothing is interpreted as HTML', () => {
  assert.equal(G.fill('Happy {day} from {brand}! {nope}', { day: 'Monday', brand: 'T.S CONNECT' }), 'Happy Monday from T.S CONNECT!');
});

test('defaults are public, complete, and include Swahili greetings', async () => {
  const cfg = await (await fetch(`http://127.0.0.1:${PORT}/api/config`)).json();
  assert.equal(cfg.greeting.enabled, true); assert.equal(cfg.greeting.periods.length, 4);
  assert.ok(Math.abs(cfg.greeting.serverNow - Date.now()) < 5000);
  assert.deepEqual(cfg.greeting.periods.map((p) => p.title), ['Good morning', 'Good afternoon', 'Good evening', 'Good night']);
  assert.match(cfg.greeting.periods[0].subtitle, /Habari za asubuhi/);
});

test('admin can edit wording, colours, times; changes reach the portal config', async () => {
  const r = await api('/greeting', { periods: [{ id: 'morning', title: 'Rise and shine, {brand}!', subtitle: 'Happy {day}', accent: 'violet', emoji: '\ud83d\udc4b', start: 4 }] });
  assert.equal(r.status, 200);
  const cfg = await (await fetch(`http://127.0.0.1:${PORT}/api/config`)).json();
  const m = cfg.greeting.periods.find((p) => p.id === 'morning');
  assert.deepEqual([m.title, m.accent, m.start, m.emoji], ['Rise and shine, {brand}!', 'violet', 4, '\ud83d\udc4b']);
  assert.equal(cfg.greeting.periods.find((p) => p.id === 'night').title, 'Good night', 'other periods untouched');
  assert.ok(JSON.parse(fs.readFileSync(path.join(DATA, 'portal.json'), 'utf8')).greeting, 'persisted in portal.json');
});

test('admin can disable the greeting and turn it back on', async () => {
  await api('/greeting', { enabled: false });
  assert.equal((await (await fetch(`http://127.0.0.1:${PORT}/api/config`)).json()).greeting.enabled, false);
  assert.equal(G.render({ setAttribute() {}, removeAttribute() {}, replaceChildren() {} }, { enabled: false }, {}), false);
  await api('/greeting', { enabled: true });
  assert.equal((await (await fetch(`http://127.0.0.1:${PORT}/api/config`)).json()).greeting.enabled, true);
});

test('validation rejects bad input with clear messages', async () => {
  const bad = async (periods, re) => { const r = await api('/greeting', { periods }); assert.equal(r.status, 400); assert.match(r.body.error, re); };
  await bad([{ id: 'morning', title: 'Hi {nmae}' }], /unknown placeholder/);
  await bad([{ id: 'morning', title: '   ' }], /cannot be empty/);
  await bad([{ id: 'morning', title: 'x'.repeat(41) }], /too long/);
  await bad([{ id: 'morning', accent: 'neon' }], /unknown colour/);
  await bad([{ id: 'morning', start: 25 }], /0 to 23/);
  await bad([{ id: 'brunch', title: 'Hi' }], /Unknown greeting period/);
  await bad([{ id: 'morning', start: 12 }], /different start hour/);      // clashes with afternoon
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/admin/greeting`)).status, 401, 'token required');
});

test('reset restores the attractive defaults', async () => {
  const r = await api('/greeting/reset', {});
  assert.equal(r.body.greeting.periods[0].title, 'Good morning'); assert.equal(r.body.greeting.periods[0].start, 5);
});
