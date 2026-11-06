// Voucher provider layer. Swap VOUCHER_BACKEND=supabase once the stub below is implemented.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DATA_DIR } = require('./config');
const FILE = path.join(DATA_DIR, 'vouchers.json');

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } };
const save = (d) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); };
const norm = (c) => String(c || '').trim().toUpperCase();

function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from(crypto.randomBytes(4), (b) => A[b % A.length]).join('');
  return `SYN-${part()}-${part()}`;
}

// A voucher's `devices` array holds every device currently sharing that one package, each as
// { key (MAC or IP), type ('mobile' | 'other'), boundAt }. Legacy single-device records are labelled `primary`
// until upgraded, so device management never mistakes their unknown type for a removable companion. Policy: a SECOND phone can never join a package that
// already has a phone on it; a non-phone (TV, laptop, console) CAN join as a companion, up to MAX_DEVICES total.
// `v.device` is kept in sync as a mirror of devices[0].key purely so anything written against the old
// single-device schema (older data files, admin tooling) still reads a sane value.
const MAX_DEVICES = Math.max(1, parseInt(process.env.MAX_DEVICES_PER_VOUCHER, 10) || 2);
function devicesOf(v) { return v.devices || (v.device ? [{ key: v.device, type: 'primary', boundAt: v.redeemedAt || Date.now() }] : []); }
function summary(code, v) {
  return {
    code, tier: v.tier, minutes: v.minutes, startedAt: v.redeemedAt || null,
    expiresAt: v.expiresAt || null, pausedMs: v.pausedMs || 0,
    lastOutageCreditMs: v.lastOutageCreditMs || 0, lastOutageAt: v.lastOutageAt || null
  };
}

/* ---------------- LOCAL JSON PROVIDER (default) ---------------- */
const local = {
  init() {
    if (!load()) save(String(process.env.SEED_TEST_VOUCHERS).toLowerCase() === 'true'
      ? { 'TEST-1HOUR': { minutes: 60, tier: 'test' }, 'TEST-1DAY': { minutes: 1440, tier: 'test' } } : {});
  },
  // deviceKey = MAC (preferred) or IP fallback. deviceType = 'mobile' | 'other' (TV, laptop, console, unknown).
  async redeem(code, deviceKey, deviceType = 'other') {
    const db = load() || {}; code = norm(code);
    const v = db[code];
    if (!v) return { ok: false, error: 'Invalid voucher code.' };
    if (v.disabled) return { ok: false, error: 'This voucher has been disabled.' };
    const now = Date.now();
    v.devices = devicesOf(v);

    const already = v.devices.find((d) => d.key === deviceKey);
    if (already) {
      if (v.expiresAt <= now) return { ok: false, error: 'Voucher has expired.' };
      return { ok: true, ...summary(code, v) };
    }
    const placeholder = v.devices.find((d) => d.key === 'phone:' + v.phone && d.type === 'mobile');
    if (placeholder && deviceType === 'mobile' && !v.devices.some((d) => d.type === 'mobile' && d !== placeholder)) {
      placeholder.key = deviceKey;
      placeholder.boundAt = now;
      v.device = v.devices[0].key;
      save(db);
      return { ok: true, ...summary(code, v) };
    }
    if (v.devices.length === 0) {                            // first-ever use: starts the clock
      v.devices.push({ key: deviceKey, type: deviceType, boundAt: now });
      v.device = deviceKey; v.redeemedAt = now; v.expiresAt = now + v.minutes * 60000;
      save(db);
      return { ok: true, ...summary(code, v) };
    }
    if (v.expiresAt <= now) return { ok: false, error: 'Voucher has expired.' };
    if (deviceType === 'mobile') return { ok: false, error: 'This package is already connected on a phone. Each package covers one phone, plus one companion device like a TV or laptop.' };
    if (v.devices.length >= MAX_DEVICES) return { ok: false, error: `Device limit reached for this package (max ${MAX_DEVICES}).` };
    v.devices.push({ key: deviceKey, type: deviceType, boundAt: now });   // companion device joining an active package
    v.device = v.devices[0].key; save(db);
    return { ok: true, ...summary(code, v) };
  },
  // Finds the most relevant redeemed package associated with a buyer's phone number.
  async findByPhone(phone) {
    const db = load() || {}, now = Date.now();
    const hits = Object.entries(db).filter(([, v]) => v.phone === phone && v.redeemedAt);
    if (!hits.length) return null;
    const status = (v) => v.disabled ? 'disabled' : v.expiresAt > now ? 'active' : 'expired';
    const priority = { active: 0, expired: 1, disabled: 2 };
    hits.sort((a, b) => priority[status(a[1])] - priority[status(b[1])] || b[1].expiresAt - a[1].expiresAt);
    const [code, v] = hits[0];
    return { ...summary(code, v), status: status(v) };
  },
  // Phone-number reconnect is only allowed to move the companion-device slot.
  async rebind(code, newDeviceKey, deviceType = 'mobile') {
    const db = load() || {}, v = db[norm(code)];
    if (!v || v.disabled || v.expiresAt <= Date.now() || deviceType !== 'other') return false;
    const devices = devicesOf(v);
    if (devices.some((device) => device.key === newDeviceKey)) return { ok: true, replacedKey: null };
    const companionIndex = devices.findIndex((d, index) => index > 0 && d.type === 'other' && !d.viaMac);   // a TV added by MAC address is never bumped by another device
    const previous = companionIndex >= 0 ? devices[companionIndex] : null;
    v.devices = devices.filter((_, index) => index !== companionIndex);
    if (v.devices.length >= MAX_DEVICES) return false;
    v.devices.push({ key: newDeviceKey, type: deviceType, boundAt: Date.now() });
    v.device = v.devices[0].key; save(db);
    return { ok: true, replacedKey: previous && previous.key !== newDeviceKey ? previous.key : null };
  },
  // Moves the PHONE slot of an active package to a new device (a customer whose phone changed its Wi-Fi MAC address).
  // The previous phone binding is replaced; a companion TV/laptop is left untouched. Callers must have verified the owner.
  async rebindMobile(code, newDeviceKey) {
    const db = load() || {}, v = db[norm(code)];
    if (!v || v.disabled || !v.expiresAt || v.expiresAt <= Date.now()) return false;
    const devices = devicesOf(v);
    if (devices.some((d) => d.key === newDeviceKey)) return { ok: true, replacedKey: null };
    const phoneSlot = devices.findIndex((d, i) => d.type === 'mobile' || (d.type === 'primary' && i === 0));
    const next = { key: newDeviceKey, type: 'mobile', boundAt: Date.now() };
    let replacedKey = null;
    if (phoneSlot >= 0) { replacedKey = devices[phoneSlot].key; devices[phoneSlot] = next; }
    else { if (devices.length >= MAX_DEVICES) return false; devices.unshift(next); }
    v.devices = devices; v.device = devices[0].key; save(db);
    return { ok: true, replacedKey };
  },
  // Lets a device get back online after a server restart without re-entering its code
  async findActiveByDevice(deviceKey) {
    const db = load() || {}, now = Date.now();
    for (const [code, v] of Object.entries(db))
      if (!v.disabled && v.expiresAt > now && devicesOf(v).some((d) => d.key === deviceKey)) return summary(code, v);
    return null;
  },
  async getInfo(code) {
    const v = (load() || {})[norm(code)];
    return v ? summary(norm(code), v) : null;
  },
  async getDevices(code) {
    const normalized = norm(code), v = (load() || {})[normalized];
    if (!v || v.disabled || v.expiresAt <= Date.now()) return null;
    return devicesOf(v).map((device, index) => ({
      key: device.key, type: device.type, isPrimary: index === 0, viaMac: !!device.viaMac, label: device.label || null,
      addedAt: device.boundAt || v.redeemedAt || null
    }));
  },
  // Registers a TV (or console/stick) by its MAC address so it is connected without ever opening the sign-in page.
  // A device can belong to only one ACTIVE package at a time. Counts toward the package's device limit.
  async addTvByMac(code, mac, label) {
    const db = load() || {}, n = norm(code), v = db[n], now = Date.now();
    if (!v || v.disabled || !v.expiresAt || v.expiresAt <= now) return { ok: false, error: 'This package is not active.' };
    const devices = devicesOf(v), here = devices.find((d) => d.key === mac);
    if (here) {
      if (here.type === 'mobile' || here.type === 'primary') return { ok: false, error: "That is the address of the phone on this package. Enter your TV's address instead." };
      here.viaMac = true; if (label) here.label = label;
      v.devices = devices; save(db); return { ok: true, device: here, already: true };
    }
    for (const [c, o] of Object.entries(db))
      if (c !== n && !o.disabled && o.expiresAt > now && devicesOf(o).some((d) => d.key === mac)) return { ok: false, taken: true, error: 'This device is already registered to another active package.' };
    if (devices.length >= MAX_DEVICES) return { ok: false, error: `This package already has ${devices.length} of ${MAX_DEVICES} devices. Remove one first, or ask for a higher device limit.` };
    const device = { key: mac, type: 'other', viaMac: true, boundAt: now, ...(label ? { label } : {}) };
    devices.push(device); v.devices = devices; v.device = devices[0].key; save(db);
    return { ok: true, device };
  },
  // Every TV registered by MAC on a package that is active right now (read by src/tvlink.js).
  async tvTargets() {
    const db = load() || {}, now = Date.now(), best = new Map();
    for (const [code, v] of Object.entries(db)) {
      if (v.disabled || !v.expiresAt || v.expiresAt <= now) continue;
      for (const d of devicesOf(v)) if (d.viaMac && (!best.has(d.key) || best.get(d.key).expiresAt < v.expiresAt)) best.set(d.key, { mac: d.key, code, expiresAt: v.expiresAt, label: d.label || null });
    }
    return [...best.values()];
  },
  // A customer who buys again keeps their registered TVs: copies them from this buyer's earlier packages (same phone number)
  // onto the new package, as long as there is room and the TV is not active on some other package.
  async carryOverTvs(code) {
    const db = load() || {}, n = norm(code), v = db[n], now = Date.now();
    if (!v || !v.phone || !v.expiresAt) return 0;
    const devices = devicesOf(v); let added = 0;
    const earlier = Object.entries(db).filter(([c, o]) => c !== n && o.phone === v.phone).sort((a, b) => (b[1].redeemedAt || 0) - (a[1].redeemedAt || 0));
    for (const [, o] of earlier) for (const d of devicesOf(o)) {
      if (!d.viaMac || devices.length >= MAX_DEVICES || devices.some((x) => x.key === d.key)) continue;
      if (Object.entries(db).some(([c, p]) => c !== n && !p.disabled && p.expiresAt > now && devicesOf(p).some((x) => x.key === d.key))) continue;
      devices.push({ key: d.key, type: 'other', viaMac: true, boundAt: now, ...(d.label ? { label: d.label } : {}) }); added++;
    }
    if (added) { v.devices = devices; v.device = devices[0].key; save(db); }
    return added;
  },
  async removeCompanion(code, deviceKey) {
    const db = load() || {}, normalized = norm(code), v = db[normalized];
    if (!v || v.disabled || v.expiresAt <= Date.now()) return false;
    const devices = devicesOf(v);
    const target = devices.find((device, index) => index > 0 && device.key === deviceKey && device.type === 'other');
    if (!target) return false;
    v.devices = devices.filter((device) => device !== target);
    v.device = v.devices.length ? v.devices[0].key : null;
    save(db);
    return true;
  },
  async snapshotActive(at = Date.now()) {
    return Object.entries(load() || {}).filter(([, v]) => !v.disabled && v.redeemedAt && v.expiresAt > at)
      .map(([code, v]) => ({ code, startedAt: Math.max(at, v.redeemedAt), expiresAt: v.expiresAt }));
  },
  async extendForOutage(id, snapshots, endedAt) {
    const db = load() || {};
    let changed = 0;
    for (const snapshot of snapshots) {
      const v = db[norm(snapshot.code)];
      if (!v || v.disabled || v.lastOutageId === id) continue;
      const creditMs = Math.max(0, endedAt - Math.max(snapshot.startedAt, v.redeemedAt || snapshot.startedAt));
      v.expiresAt += creditMs;
      v.pausedMs = (v.pausedMs || 0) + creditMs;
      v.lastOutageCreditMs = creditMs;
      v.lastOutageAt = endedAt;
      v.lastOutageId = id;
      changed++;
    }
    if (changed) save(db);
    return changed;
  },
  // Vouchers tied to a phone number (bought via STK push, awarded to a number, or SMS'd by the admin). Feeds SMS reminders,
  // outage notices and broadcast audiences. Pass `codes` to limit to specific vouchers.
  async notifyTargets({ codes } = {}) {
    const db = load() || {}, now = Date.now(), want = codes ? new Set(codes.map(norm)) : null;
    return Object.entries(db).filter(([code, v]) => v.phone && (!want || want.has(code))).map(([code, v]) => ({
      code, phone: v.phone, tier: v.tier, minutes: v.minutes, createdAt: v.createdAt || 0, redeemedAt: v.redeemedAt || null,
      expiresAt: v.expiresAt || null, awarded: !!v.awarded, disabled: !!v.disabled,
      active: !v.disabled && !!v.redeemedAt && v.expiresAt > now,
      lastOutageCreditMs: v.lastOutageCreditMs || 0, lastOutageId: v.lastOutageId || null
    }));
  },
  // Redeemed vouchers that could represent a manual (Till) sale: not awarded, not free tests. income.js decides what counts.
  async salesCandidates() {
    return Object.entries(load() || {}).filter(([, v]) => v.redeemedAt && !v.awarded && !v.disabled)
      .map(([code, v]) => ({ code, tier: v.tier, redeemedAt: v.redeemedAt, phone: v.phone || null }));
  },
  // Every redeemed voucher with its expiry (for the "package expired" activity entries).
  async snapshot() {
    return Object.entries(load() || {}).filter(([, v]) => v.redeemedAt && v.expiresAt)
      .map(([code, v]) => ({ code, tier: v.tier, phone: v.phone || null, expiresAt: v.expiresAt, disabled: !!v.disabled }));
  },
  async list(limit = 100) {
    const db = load() || {}, now = Date.now();
    return Object.entries(db).map(([code, v]) => ({
      code, tier: v.tier, minutes: v.minutes, createdAt: v.createdAt || 0, expiresAt: v.expiresAt || null,
      devices: devicesOf(v).map((d) => d.type), awarded: !!v.awarded, note: v.note || null,
      phone: v.phone ? v.phone.slice(0, 5) + '****' + v.phone.slice(-3) : null,
      status: v.disabled ? 'disabled' : !v.redeemedAt ? 'unused' : v.expiresAt > now ? 'active' : 'expired'
    })).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  },
  async disable(code) {
    const db = load() || {}, v = db[norm(code)];
    if (!v) return false; v.disabled = true; save(db); return true;
  },
  async create({ tier, minutes, count, phone, awarded, note }) {
    const db = load() || {}; const made = [];
    for (let i = 0; i < count; i++) {
      const c = genCode();
      db[c] = { tier, minutes, createdAt: Date.now(), ...(phone ? { phone } : {}), ...(awarded ? { awarded: true } : {}), ...(note ? { note: String(note).slice(0, 200) } : {}) };
      made.push(c);
    }
    save(db); return made;
  }
};

/* ---------------- SUPABASE PROVIDER (STUB) ----------------
 Suggested table `vouchers`: code text PK, tier text, minutes int, redeemed_at timestamptz,
 devices jsonb (array of {key, type, boundAt}), device text (mirror of devices[0].key), expires_at timestamptz,
 phone text, awarded boolean, disabled boolean.
 npm i @supabase/supabase-js, then:
   const { createClient } = require('@supabase/supabase-js');
   const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
 redeem():  select by code -> apply the same rules as the local provider -> update row.
 Use an atomic update (`.is('redeemed_at', null)`) to avoid double-redeem races.
*/
const supabase = {
  init() {},
  async redeem() { throw new Error('Supabase provider not implemented yet'); },
  async findActiveByDevice() { return null; },
  async create() { throw new Error('Supabase provider not implemented yet'); },
  async list() { return []; },
  async notifyTargets() { return []; },
  async salesCandidates() { return []; },
  async snapshot() { return []; },
  async disable() { throw new Error('Supabase provider not implemented yet'); },
  async findByPhone() { return null; },
  async rebind() { throw new Error('Supabase provider not implemented yet'); },
  async rebindMobile() { throw new Error('Supabase provider not implemented yet'); },
  async getInfo() { return null; },
  async getDevices() { throw new Error('Device management is not supported by the Supabase provider.'); },
  async removeCompanion() { throw new Error('Device management is not supported by the Supabase provider.'); },
  async addTvByMac() { return { ok: false, error: 'Not supported by this voucher backend.' }; },
  async tvTargets() { return []; },
  async carryOverTvs() { return 0; },
  async snapshotActive() { throw new Error('Outage compensation is not supported by the Supabase provider.'); },
  async extendForOutage() { throw new Error('Outage compensation is not supported by the Supabase provider.'); }
};

const provider = process.env.VOUCHER_BACKEND === 'supabase' ? supabase : local;
provider.init();
module.exports = provider;
