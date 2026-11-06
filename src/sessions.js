const { execFile } = require('child_process');
const sessions = new Map(); // ip -> { key, code, expiresAt }
const listeners = [];
const emit = () => listeners.forEach((fn) => { try { fn(); } catch {} });
const onChange = (fn) => listeners.push(fn);
let outageStartedAt = null;
const paused = new Map(); // ip -> { session, startedAt }

const normIp = (ip = '') => ip.replace(/^::ffff:/, '');

function isAuthed(ip) {
  const k = normIp(ip), s = sessions.get(k);
  if (!s) return false;
  const pause = paused.get(k);
  if (pause && pause.session === s) return true;
  if (s.expiresAt <= Date.now()) { sessions.delete(k); emit(); return false; }
  return true;
}
const get = (ip) => sessions.get(normIp(ip));
const set = (ip, data) => {
  const k = normIp(ip);
  sessions.set(k, data);
  if (outageStartedAt != null && data.expiresAt > Date.now())
    paused.set(k, { session: data, startedAt: Math.max(outageStartedAt, Date.now()) });
  emit();
};
const remove = (ip) => {
  const k = normIp(ip), r = sessions.delete(k);
  paused.delete(k);
  if (r) emit();
  return r;
};
const activeIps = () => [...sessions.keys()].filter(isAuthed);
function effectiveExpiresAt(ip) {
  const k = normIp(ip), s = sessions.get(k), pause = paused.get(k);
  return s && pause && pause.session === s ? s.expiresAt + Date.now() - pause.startedAt : s?.expiresAt;
}
function pauseForOutage(startedAt) {
  outageStartedAt = startedAt;
  paused.clear();
  for (const [ip, s] of sessions) if (s.expiresAt > startedAt) paused.set(ip, { session: s, startedAt });
}
function resumeAfterOutage(endedAt, expiries = {}) {
  for (const [ip, pause] of paused) {
    if (sessions.get(ip) !== pause.session) continue;
    pause.session.expiresAt = Math.max(
      pause.session.expiresAt + Math.max(0, endedAt - pause.startedAt),
      expiries[pause.session.code] || 0
    );
  }
  paused.clear();
  outageStartedAt = null;
  emit();
}

function getMac(ip) {
  return new Promise((resolve) => {
    execFile('arp', ['-a', normIp(ip)], { timeout: 2000 }, (err, out) => {
      if (err) return resolve(null);
      const m = String(out).match(/([0-9a-f]{2}-){5}[0-9a-f]{2}/i);
      resolve(m ? m[0].toLowerCase() : null);
    });
  });
}

setInterval(() => {
  let changed = false;
  for (const [ip, s] of sessions) {
    const pause = paused.get(ip);
    if (s.expiresAt <= Date.now() && !(pause && pause.session === s)) { sessions.delete(ip); changed = true; }
  }
  if (changed) emit();
}, 5000).unref();   // faster sweep so an expired package's internet cuts off sooner (gate rebuilds its filter on every emit)

// Revoked device keys can't be silently restored from their still-valid voucher
const revoked = new Set();
function revoke(ip) { const s = get(ip); remove(ip); if (s) revoked.add(s.key); return !!s; }
const isRevoked = (key) => revoked.has(key);
const clearRevoked = (key) => revoked.delete(key);

// Devices recently seen on the hotspot subnet (Windows ARP cache)
function neighbors(prefix, gatewayIp) {
  return new Promise((resolve) => {
    execFile('arp', ['-a'], { timeout: 3000 }, (err, out) => {
      if (err) return resolve([]);
      const re = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+\w+/gim, found = [];
      let m;
      while ((m = re.exec(String(out)))) {
        const mac = m[2].toLowerCase();
        if (m[1].startsWith(prefix) && m[1] !== gatewayIp && !m[1].endsWith('.255') && mac !== 'ff-ff-ff-ff-ff-ff' && !mac.startsWith('01-00-5e'))
          found.push({ ip: m[1], mac });
      }
      resolve(found);
    });
  });
}

module.exports = { isAuthed, get, set, remove, getMac, normIp, all: () => sessions, activeIps, effectiveExpiresAt, pauseForOutage, resumeAfterOutage, onChange, revoke, isRevoked, clearRevoked, neighbors };
