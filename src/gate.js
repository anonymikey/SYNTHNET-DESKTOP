// INTERNET GATE: unpaid hotspot devices get ZERO internet; they can only reach the portal on this laptop.
//
// WinDivert (via koffi) intercepts hotspot-client packets BEFORE Windows ICS forwards them:
//   * DNS (UDP 53, to ANY resolver)   : never forwarded and never answered by ICS. We reply ourselves, every name -> portal IP
//   * DNS over TCP to the laptop      : dropped
//   * TCP 80 to any IP                : rewritten to the portal (hard-coded-IP http probes still land on the portal)
//   * everything else leaving the LAN : DROPPED (https, quic, icmp, games, tunnels...)
// Authenticated devices are excluded in the kernel filter, so their traffic never touches Node (full speed).
// Traffic addressed to the laptop itself (portal on :80, DHCP) is not captured. IPv4 only: ICS does not route IPv6.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFile } = require('child_process');
const sessions = require('./sessions');
const { DATA_DIR } = require('./config');

const ZIP_URL = 'https://github.com/basil00/WinDivert/releases/download/v2.2.2/WinDivert-2.2.2-A.zip';
const DIR = path.join(DATA_DIR, 'windivert');
const DLL = path.join(DIR, 'WinDivert.dll');
const SYS = path.join(DIR, 'WinDivert64.sys');

const state = { active: false, reason: 'Starting…', redirected: 0, dropped: 0, dnsAnswered: 0 };
let fn = null, handle = null, generation = 0, timer = null, started = false;
const nat = new Map(); // "clientIp:clientPort" -> { dst, ts }

const gw = () => process.env.HOTSPOT_IP || '192.168.137.1';
const prefix = () => gw().split('.').slice(0, 3).join('.');
const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ipAt = (b, o) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
const setIp = (b, o, ip) => ip.split('.').forEach((x, i) => { b[o + i] = +x; });
const q = (s) => s.replace(/'/g, "''");

function validDriverFile(file) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size > 4096; } catch { return false; }
}

function ensureDll() {
  return new Promise((resolve, reject) => {
    if (validDriverFile(DLL) && validDriverFile(SYS)) return resolve(DLL);
    fs.mkdirSync(DIR, { recursive: true });
    const stamp = `${process.pid}-${Date.now()}`;
    const stage = path.join(DATA_DIR, `.windivert-stage-${stamp}`);
    const zip = path.join(stage, 'windivert.zip');
    const tmp = path.join(stage, 'expanded');
    const cleanup = `if (Test-Path -LiteralPath '${q(stage)}') { Remove-Item -LiteralPath '${q(stage)}' -Recurse -Force -ErrorAction SilentlyContinue }`;
    const ps = `$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; ` +
      `New-Item -ItemType Directory -Force -Path '${q(stage)}' | Out-Null; ` +
      `$downloaded=$false; for ($i=1; $i -le 3 -and -not $downloaded; $i++) { ` +
      `try { if (Test-Path -LiteralPath '${q(zip)}') { Remove-Item -LiteralPath '${q(zip)}' -Force }; ` +
      `Invoke-WebRequest -UseBasicParsing -Uri '${ZIP_URL}' -OutFile '${q(zip)}'; ` +
      `if ((Get-Item -LiteralPath '${q(zip)}').Length -lt 100000) { throw 'Downloaded archive is incomplete.' }; $downloaded=$true } ` +
      `catch { if ($i -eq 3) { throw }; Start-Sleep -Seconds 2 } }; ` +
      `Expand-Archive -Force -LiteralPath '${q(zip)}' -DestinationPath '${q(tmp)}'; ` +
      `$d=(Get-ChildItem -LiteralPath '${q(tmp)}' -Recurse -File -Filter 'WinDivert64.sys' | Select-Object -First 1).DirectoryName; ` +
      `if (-not $d -or -not (Test-Path -LiteralPath (Join-Path $d 'WinDivert.dll'))) { throw 'The archive does not contain the x64 WinDivert files.' }; ` +
      `New-Item -ItemType Directory -Force -Path '${q(DIR)}' | Out-Null; ` +
      `Copy-Item -LiteralPath (Join-Path $d 'WinDivert.dll') -Destination '${q(DLL)}.new' -Force; ` +
      `Copy-Item -LiteralPath (Join-Path $d 'WinDivert64.sys') -Destination '${q(SYS)}.new' -Force; ` +
      `if ((Get-Item -LiteralPath '${q(DLL)}.new').Length -le 4096 -or (Get-Item -LiteralPath '${q(SYS)}.new').Length -le 4096) { throw 'The extracted x64 driver files are incomplete.' }; ` +
      `Move-Item -LiteralPath '${q(DLL)}.new' -Destination '${q(DLL)}' -Force; Move-Item -LiteralPath '${q(SYS)}.new' -Destination '${q(SYS)}' -Force; ${cleanup}`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { timeout: 180000, windowsHide: true }, (err, _o, stderr) => {
      if (err || !validDriverFile(DLL) || !validDriverFile(SYS)) {
        const detail = String(stderr || (err && err.message) || 'unknown Windows file-operation error').replace(/\s+/g, ' ').trim().slice(0, 220);
        return reject(new Error(
          `Could not install the WinDivert driver (${detail}). Windows Security or antivirus may have quarantined or locked the files. ` +
          `Close other SYNTHNET instances, allow the app through security software, then restart as Administrator. ` +
          `If it still fails, manually place the x64 WinDivert.dll and WinDivert64.sys files in ${DIR}.`));
      }
      resolve(DLL);
    });
  });
}

function buildFilter() {
  const g = gw(), b = prefix(), lo = `${b}.2`, hi = `${b}.254`;
  const authed = sessions.activeIps().filter(isIp);
  const exS = authed.map((ip) => ` and ip.SrcAddr != ${ip}`).join('');
  const exD = authed.map((ip) => ` and ip.DstAddr != ${ip}`).join('');
  const fromClient = `inbound and ip.SrcAddr >= ${lo} and ip.SrcAddr <= ${hi}${exS}`;
  return `ip and (` +
    `(${fromClient} and udp.DstPort == 53 and ip.DstAddr < 224.0.0.0)` +                      // DNS to any resolver -> answered locally
    ` or (${fromClient} and tcp.DstPort == 53 and ip.DstAddr == ${g})` +                      // DNS-over-TCP to us -> dropped
    ` or (${fromClient} and ip.DstAddr != ${g} and (ip.DstAddr < ${b}.0 or ip.DstAddr > ${b}.255) and ip.DstAddr < 224.0.0.0)` + // all else leaving the LAN
    ` or (outbound and tcp.SrcPort == 80 and ip.SrcAddr == ${g} and ip.DstAddr >= ${lo} and ip.DstAddr <= ${hi}${exD}))`;      // portal replies (NAT restore)
}

// Answer a DNS query ourselves: A -> portal IP (TTL 5s), anything else -> empty NOERROR. Reply is sent AS the queried server.
// Domain-agnostic by design: this catches every OS connectivity-check host (connectivitycheck.gstatic.com,
// captive.apple.com, www.msftconnecttest.com, ...) without needing to list them, because EVERY A query gets the portal IP.
function dnsReply(h, pkt, addr, ihl) {
  const dnsOff = ihl + 8;
  if (pkt.length < dnsOff + 17 || (pkt[dnsOff + 2] & 0x80)) { state.dropped++; return; }     // too short, or already a response
  let i = dnsOff + 12; while (i < pkt.length && pkt[i] !== 0) i += pkt[i] + 1;
  const qEnd = i + 5;
  if (qEnd > pkt.length) { state.dropped++; return; }
  const qtype = pkt.readUInt16BE(qEnd - 4), question = pkt.subarray(dnsOff, qEnd), isA = qtype === 1, ans = isA ? 16 : 0;

  const r = Buffer.alloc(28 + question.length + ans);
  question.copy(r, 28);
  r.writeUInt16BE(0x8580, 30);                 // QR + AA (authoritative) + RD + RA
  r.writeUInt16BE(1, 32); r.writeUInt16BE(isA ? 1 : 0, 34); r.writeUInt16BE(0, 36); r.writeUInt16BE(0, 38);
  if (isA) { const a = 28 + question.length; r.writeUInt16BE(0xc00c, a); r.writeUInt16BE(1, a + 2); r.writeUInt16BE(1, a + 4); r.writeUInt32BE(5, a + 6); r.writeUInt16BE(4, a + 10); setIp(r, a + 12, gw()); }
  r.writeUInt16BE(53, 20); r.writeUInt16BE(pkt.readUInt16BE(ihl), 22); r.writeUInt16BE(8 + question.length + ans, 24);   // UDP
  r[0] = 0x45; r.writeUInt16BE(r.length, 2); r.writeUInt16BE(crypto.randomInt(65536), 4); r.writeUInt16BE(0x4000, 6); r[8] = 128; r[9] = 17; // IPv4
  pkt.copy(r, 12, 16, 20); pkt.copy(r, 16, 12, 16);                                                                          // swap src/dst
  const out = Buffer.from(addr); out[10] |= 0x02;                                                                            // inbound -> outbound (Outbound bit)
  fn.sum(r, r.length, out, 0);
  fn.send(h, r, r.length, null, out);
  state.dnsAnswered++;
}

// RFC 793 reset for a blocked TCP attempt (mainly the HTTPS connectivity probe on :443). A silent drop makes the
// phone wait out a long connect timeout, which races against the HTTP probe's 302 and makes captive-portal
// detection inconsistent across reconnects; a fast RST makes the phone fail that probe immediately every time.
// Only ever called for a pure SYN (see isSyn below), so per RFC 793 the correct reset is RST+ACK with ack = their seq+1.
function tcpReset(h, pkt, addr, ihl) {
  if (pkt.length < ihl + 20) { state.dropped++; return; }
  const srcPort = pkt.readUInt16BE(ihl), dstPort = pkt.readUInt16BE(ihl + 2), seq = pkt.readUInt32BE(ihl + 4);
  const r = Buffer.alloc(40);                                 // 20-byte IPv4 header + 20-byte TCP header, no payload
  r[0] = 0x45; r.writeUInt16BE(40, 2); r.writeUInt16BE(crypto.randomInt(65536), 4); r.writeUInt16BE(0x4000, 6); r[8] = 64; r[9] = 6;
  pkt.copy(r, 12, 16, 20); pkt.copy(r, 16, 12, 16);            // swap src/dst IP
  r.writeUInt16BE(dstPort, 20); r.writeUInt16BE(srcPort, 22);  // swap ports
  r.writeUInt32BE(seq + 1, 28); r[32] = 5 << 4; r[33] = 0x14;  // ack = their seq+1; RST+ACK; data offset = 5 words
  const out = Buffer.from(addr); out[10] |= 0x02;              // flip inbound -> outbound for re-injection
  fn.sum(r, r.length, out, 0);
  fn.send(h, r, r.length, null, out);
  state.dropped++;
}
const isSyn = (pkt, ihl) => pkt.length >= ihl + 14 && (pkt[ihl + 13] & 0x17) === 0x02; // SYN set, ACK/RST/FIN clear

function onPacket(h, pkt, addr) {
  if (pkt.length < 24 || (pkt[0] >> 4) !== 4) { state.dropped++; return; }
  const ihl = (pkt[0] & 15) * 4, proto = pkt[9];
  const src = ipAt(pkt, 12), dst = ipAt(pkt, 16);
  const send = () => fn.send(h, pkt, pkt.length, null, addr);

  if (src === gw()) {                                         // portal reply (:80) to a client
    if (proto === 6) {
      const e = nat.get(dst + ':' + pkt.readUInt16BE(ihl + 2));
      if (e) { setIp(pkt, 12, e.dst); e.ts = Date.now(); fn.sum(pkt, pkt.length, addr, 0); }
    }
    return send();
  }
  if (proto === 17 && pkt.length >= ihl + 8 && pkt.readUInt16BE(ihl + 2) === 53) return dnsReply(h, pkt, addr, ihl);
  if (proto === 6 && pkt.length >= ihl + 4 && pkt.readUInt16BE(ihl + 2) === 80 && dst !== gw()) {   // http to any IP -> portal
    nat.set(src + ':' + pkt.readUInt16BE(ihl), { dst, ts: Date.now() });
    setIp(pkt, 16, gw()); fn.sum(pkt, pkt.length, addr, 0);
    state.redirected++;
    return send();
  }
  if (proto === 6 && isSyn(pkt, ihl)) return tcpReset(h, pkt, addr, ihl);   // HTTPS (and any other TCP) probe: fail fast
  state.dropped++;                                            // UDP/ICMP/etc: no internet until paid
}

async function loop(h, gen) {
  const buf = Buffer.alloc(65600), addr = Buffer.alloc(80), len = [0];
  let bad = 0;
  while (gen === generation) {
    const ok = await new Promise((res) => fn.recv.async(h, buf, buf.length, len, addr, (err, r) => res(!err && r)));
    if (gen !== generation) break;
    if (!ok) { if (++bad > 100) { state.active = false; state.reason = 'Packet capture stopped unexpectedly.'; break; } await sleep(20); continue; }
    bad = 0;
    try { onPacket(h, Buffer.from(buf.subarray(0, len[0])), addr); } catch (e) { console.error('[gate]', e.message); }
  }
}

function reopen() {
  const filter = buildFilter();
  const h = fn.open(filter, 0, 0, 0);
  const hv = BigInt(h);
  if (hv === -1n || hv === 0n) {
    state.active = false;
    state.reason = 'WinDivertOpen failed (run as Administrator; antivirus may be blocking the driver). Filter: ' + filter;
    return false;
  }
  const old = handle; handle = h; const gen = ++generation;
  if (old !== null) fn.close(old);
  state.active = true; state.reason = '';
  loop(h, gen);
  return true;
}

async function start() {
  if (String(process.env.GATE_ENABLED || 'true').toLowerCase() === 'false') { state.reason = 'Disabled (GATE_ENABLED=false)'; return state; }
  if (process.platform !== 'win32') { state.reason = 'Windows only'; return state; }
  try {
    const dll = await ensureDll();
    const koffi = require('koffi');
    const lib = koffi.load(dll);
    fn = {
      open: lib.func('intptr_t WinDivertOpen(const char *filter, int layer, int16_t priority, uint64_t flags)'),
      recv: lib.func('int WinDivertRecv(intptr_t h, void *pkt, uint32_t len, _Out_ uint32_t *recvLen, void *addr)'),
      send: lib.func('int WinDivertSend(intptr_t h, void *pkt, uint32_t len, _Out_ uint32_t *sendLen, void *addr)'),
      close: lib.func('int WinDivertClose(intptr_t h)'),
      sum: lib.func('int WinDivertHelperCalcChecksums(void *pkt, uint32_t len, void *addr, uint64_t flags)')
    };
    started = true;
    sessions.onChange(() => { clearTimeout(timer); timer = setTimeout(() => { if (started) { try { reopen(); } catch (e) { state.reason = e.message; } } }, 100); });
    setInterval(() => { const t = Date.now() - 120000; for (const [k, v] of nat) if (v.ts < t) nat.delete(k); }, 30000).unref();
    reopen();
    if (state.active) { try { require('./events').emit({ category: 'system', level: 'info', silent: true, title: 'Internet gate is active', message: 'Unpaid devices see only the portal.', dedupeKey: 'gate-up', dedupeMs: 3600000, dedupeMode: 'skip' }); } catch { /* notifications are optional */ } }
  } catch (e) {
    state.active = false; state.reason = e.message; console.error('[gate] not active:', e.message);
    try { require('./events').emit({ category: 'system', level: 'critical', title: 'Internet gate is NOT active', message: `Unpaid devices are not being blocked: ${e.message}`, dedupeKey: 'gate-down', dedupeMs: 3600000 }); } catch { /* notifications are optional */ }
  }
  return state;
}

async function stop() {
  started = false; generation++; clearTimeout(timer);
  if (fn && handle !== null) { try { fn.close(handle); } catch {} }
  handle = null; state.active = false; state.reason = 'Stopped';
}

const status = () => ({ ...state, authed: sessions.activeIps().length });
module.exports = { start, stop, status, _t: { buildFilter, onPacket, setFn: (f) => { fn = f; }, nat } };
