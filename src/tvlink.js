// Connects TVs (and other devices that cannot open the sign-in page) by their MAC address.
//
// A customer registers the TV's MAC in My devices. Every few seconds this module looks at who is on the hotspot (the ARP
// table), and for each registered TV whose package is ACTIVE it gives the TV's current IP a session, which opens the internet
// gate for it. The moment the package ends, the TV is no longer a target: its session is removed and the gate cuts it off,
// exactly like a phone. It stays off until the customer buys another package (their registered TVs are carried over to the
// new package, see vouchers.carryOverTvs) or registers it again.
//
// Safety rules:
//   - only MAC addresses saved on an active package are ever linked
//   - if the IP a TV used is now taken by a DIFFERENT device, the TV's session is dropped immediately (leases change)
//   - a TV that has not been seen for 10 minutes loses its session, so a reused IP can never inherit its access
//   - during a recorded outage nothing is removed (package clocks are paused), links are only added
const sessions = require('./sessions');
const vouchers = require('./vouchers');
const outage = require('./outage');
const events = require('./events');

const SEEN_TIMEOUT = 10 * 60000;
const gw = () => process.env.HOTSPOT_IP || '192.168.137.1';
const prefix = () => gw().split('.').slice(0, 3).join('.') + '.';

let getNeighbors = () => sessions.neighbors(prefix(), gw());      // [{ ip, mac }]; replaced in tests
const seen = new Map();                                           // mac -> { ip, at }
let timer = null, running = null, isPaused = () => false;

async function run() {
  const now = Date.now(), targets = await vouchers.tvTargets(), wanted = new Map(targets.map((t) => [t.mac, t]));
  const neighbors = await getNeighbors(), ipOfMac = new Map(), macOfIp = new Map();
  for (const n of neighbors) { macOfIp.set(n.ip, n.mac); if (!ipOfMac.has(n.mac) || sessions.get(n.ip)?.key === n.mac) ipOfMac.set(n.mac, n.ip); }

  // 1) link every registered TV that is on the network right now
  for (const [mac, t] of wanted) {
    const ip = ipOfMac.get(mac);
    if (!ip || sessions.isRevoked(mac)) continue;
    const prev = seen.get(mac);
    if (prev && prev.ip !== ip && sessions.get(prev.ip)?.key === mac) sessions.remove(prev.ip);   // the TV moved to a new IP
    seen.set(mac, { ip, at: now });
    const cur = sessions.get(ip);
    if (!cur || cur.key !== mac || cur.code !== t.code) {
      await outage.trackVoucher(t.code);
      sessions.set(ip, { key: mac, code: t.code, expiresAt: t.expiresAt, tv: true, label: t.label });
      try { events.emit({ category: 'customers', level: 'info', silent: true, title: 'TV connected by MAC address', message: `${t.label || mac} · ${t.code} · ${ip}`, dedupeKey: 'tvlink:' + mac, dedupeMs: 30 * 60000, dedupeMode: 'skip' }); } catch { /* optional */ }
    } else if (t.expiresAt > cur.expiresAt) cur.expiresAt = t.expiresAt;
  }
  if (isPaused()) return;

  // 2) unlink: package ended / TV removed, the IP now belongs to another device, or the TV has been gone for a while
  for (const [ip, s] of [...sessions.all()]) {
    if (!s.tv) continue;
    const owner = macOfIp.get(ip), s2 = seen.get(s.key);
    if (!wanted.has(s.key) || (owner && owner !== s.key) || (s2 && now - s2.at > SEEN_TIMEOUT && owner !== s.key)) { sessions.remove(ip); seen.delete(s.key); }
  }
  for (const [mac, v] of seen) if (!wanted.has(mac) || now - v.at > SEEN_TIMEOUT * 3) seen.delete(mac);
}

// Overlapping runs share one result, so a burst of "sync now" calls never stacks up.
const syncNow = () => (running = running || run().catch((e) => console.error('[tvlink]', e.message)).finally(() => { running = null; }));
function start({ paused } = {}) {
  if (paused) isPaused = paused;
  if (timer) return;
  timer = setInterval(syncNow, 4000); timer.unref();
  setTimeout(syncNow, 1500).unref();
}
// For My devices: is this TV on the network and connected right now?
function info(mac) {
  const v = seen.get(mac), s = v && sessions.get(v.ip);
  return { online: !!(s && s.key === mac && sessions.isAuthed(v.ip)), ip: v ? v.ip : null, lastSeen: v ? v.at : null };
}

module.exports = { start, syncNow, info, _setNeighbors: (fn) => { getNeighbors = fn; }, _ageSeen: (ms) => { for (const v of seen.values()) v.at -= ms; }, _reset: () => { seen.clear(); } };
