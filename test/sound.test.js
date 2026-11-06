// "You are connected" sound: the 2-second limit, admin settings, custom upload safety.   Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'synthnet-snd-'));
const PORT = 47000 + Math.floor(Math.random() * 10000), ADMIN = 'test-admin-password-123';
Object.assign(process.env, { SYNTHNET_DATA: DATA, PORT: String(PORT), ADMIN_TOKEN: ADMIN, ADMIN_LOCAL_ONLY: 'true' });
const CS = require('../public/connectsound.js');
let srv;
const call = (p, body, noAuth) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(noAuth ? {} : { 'x-admin-token': ADMIN }) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), body: await r.json().catch(() => ({})) }));
const cfg = async () => (await (await fetch(`http://127.0.0.1:${PORT}/api/config`)).json()).sound;
const wavBytes = (seconds = 0.5) => {                       // a real 8 kHz mono 8-bit WAV
  const n = Math.round(8000 * seconds), b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40); for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(60 * Math.sin(i / 3)); return b;
};
const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
const soundFiles = () => fs.readdirSync(DATA).filter((f) => f.startsWith('connect-sound.'));

before(async () => { srv = await require('../server').start(); });
after(() => { srv.closeAllConnections?.(); srv.close(); });

test('every built-in sound is a real sound and NONE can exceed 2 seconds', () => {
  assert.equal(CS.MAX_SECONDS, 2); assert.equal(CS.PRESETS.length, 10);
  for (const p of CS.PRESETS) {
    const plan = CS.plan(p.id);
    assert.equal(plan.id, p.id); assert.ok(plan.voices.length >= 1, p.id);
    assert.ok(plan.duration > 0.1 && plan.duration <= 2.0, `${p.id} lasts ${plan.duration}s`);
    for (const v of plan.voices) { assert.ok(v.s >= 0 && v.s + v.d <= 2.0 + 1e-9, `${p.id}: a note ends at ${v.s + v.d}`); assert.ok(Number.isFinite(v.f) && v.f > 20 && v.f < 20000, p.id); assert.ok(v.g > 0 && v.g <= 1, p.id); }
  }
  assert.ok(CS.plan('beep').duration <= 0.3, 'the default is a LITTLE beep');
  assert.equal(CS.plan('does-not-exist').id, 'beep', 'unknown names fall back to the beep');
});

test('a note that would run past 2 seconds is clipped, and one that starts too late is dropped', () => {
  const long = CS.fit([{ type: 'sine', f: 440, s: 0, d: 5, g: 0.5 }, { type: 'sine', f: 440, s: 1.5, d: 3, g: 0.5 }, { type: 'sine', f: 440, s: 1.99, d: 1, g: 0.5 }, { type: 'sine', f: 440, s: 4, d: 1, g: 0.5 }]);
  assert.equal(long.duration, 2); assert.equal(long.voices.length, 2, 'the two that start at 1.99 s and 4 s are dropped');
  assert.deepEqual(long.voices.map((v) => +(v.s + v.d).toFixed(3)), [2, 2]);
  assert.ok(CS.PRESETS.every((p) => CS.plan(p.id).duration <= 2.0));
});

test('defaults: sound on, little beep, volume 70, public to customers', async () => {
  assert.deepEqual(await cfg(), { enabled: true, preset: 'beep', volume: 70, customUrl: null });
  const a = await call('/api/admin/sound'); assert.equal(a.status, 200); assert.equal(a.body.sound.preset, 'beep'); assert.equal(a.body.presets.length, 10);
  assert.equal((await call('/api/admin/sound', null, true)).status, 401, 'admin only');
});

test('admin can choose a sound, set the volume, and switch it off', async () => {
  let r = await call('/api/admin/sound', { preset: 'chime', volume: 45 }); assert.equal(r.status, 200);
  assert.deepEqual(await cfg(), { enabled: true, preset: 'chime', volume: 45, customUrl: null });
  r = await call('/api/admin/sound', { enabled: false }); assert.equal((await cfg()).enabled, false);
  assert.equal((await cfg()).preset, 'chime', 'switching off keeps the choice');
  await call('/api/admin/sound', { enabled: true });
  for (const [body, re] of [[{ preset: 'kazoo' }, /Unknown sound/], [{ volume: 3 }, /5 to 100/], [{ volume: 101 }, /5 to 100/], [{ volume: 'loud' }, /5 to 100/], [{ preset: 'custom' }, /Upload your own/]]) {
    const bad = await call('/api/admin/sound', body); assert.equal(bad.status, 400, JSON.stringify(body)); assert.match(bad.body.error, re);
  }
  assert.equal((await cfg()).preset, 'chime', 'rejected changes change nothing');
});

test('custom sound: upload, serve to customers, replace, remove', async () => {
  const wav = wavBytes();
  let r = await call('/api/admin/sound/upload', { dataUrl: dataUrl('audio/wav', wav), name: 'My welcome<script>' });
  assert.equal(r.status, 200); assert.equal(r.body.sound.preset, 'custom'); assert.equal(r.body.sound.customName, 'My welcomescript');
  const c = await cfg(); assert.equal(c.preset, 'custom'); assert.match(c.customUrl, /^\/connect-sound\?v=1$/);
  const file = await fetch(`http://127.0.0.1:${PORT}${c.customUrl}`);                    // customers are not logged in: must be public
  assert.equal(file.status, 200); assert.match(file.headers.get('content-type'), /audio\/wav/); assert.deepEqual(Buffer.from(await file.arrayBuffer()), wav);
  // replacing with another format leaves exactly one file
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200, 1)]);
  r = await call('/api/admin/sound/upload', { dataUrl: dataUrl('audio/mpeg', mp3), name: 'beep2' }); assert.equal(r.status, 200);
  assert.deepEqual(soundFiles(), ['connect-sound.mp3']); assert.equal((await cfg()).customUrl, '/connect-sound?v=2');
  // remove
  r = await call('/api/admin/sound/clear', {}); assert.equal(r.status, 200);
  assert.deepEqual(await cfg(), { enabled: true, preset: 'beep', volume: 45, customUrl: null }); assert.deepEqual(soundFiles(), []);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/connect-sound`)).status, 404);
});

test('uploads are validated: type, real audio content, size', async () => {
  const bad = async (url, re) => { const r = await call('/api/admin/sound/upload', { dataUrl: url }); assert.equal(r.status, 400); assert.match(r.body.error, re); };
  await bad(dataUrl('image/png', Buffer.from('89504e470d0a1a0a', 'hex')), /MP3, WAV, OGG or M4A/);
  await bad(dataUrl('audio/wav', Buffer.from('<script>alert(1)</script>')), /real audio/);                     // renamed non-audio
  await bad(dataUrl('audio/mpeg', Buffer.alloc(0)), /empty|MP3, WAV/);
  await bad(dataUrl('audio/wav', wavBytes(60)), /too big/);                                                    // a 60 s clip is ~480 KB
  await bad('not a data url', /MP3, WAV, OGG or M4A/);
  assert.deepEqual(soundFiles(), [], 'nothing was stored');
  assert.equal((await cfg()).customUrl, null);
});

test('sound changes appear in the activity log without ringing the bell', async () => {
  const events = require('../src/events'), before = events.counts().unread;
  await call('/api/admin/sound', { preset: 'bell' }); await call('/api/admin/sound/upload', { dataUrl: dataUrl('audio/wav', wavBytes()), name: 'x' }); await call('/api/admin/sound/clear', {});
  const titles = events.list({ limit: 100 }).items.map((x) => x.title);
  for (const re of [/Connection sound changed/, /Custom connection sound uploaded/, /Custom connection sound removed/]) assert.ok(titles.some((t) => re.test(t)), String(re));
  assert.equal(events.counts().unread, before);
});
