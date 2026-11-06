const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const vouchers = require('./vouchers');
const sessions = require('./sessions');

const FILE = path.join(DATA_DIR, 'outage.json');
let state = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { active: null };
let transitionInProgress = false;

function save() {
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

function status() {
  return state.active
    ? { active: true, startedAt: state.active.startedAt }
    : { active: false };
}

async function start() {
  if (transitionInProgress) throw new Error('An outage update is already in progress.');
  if (state.active) throw new Error('An outage is already active.');
  transitionInProgress = true;
  try {
    const startedAt = Date.now();
    const active = {
      id: crypto.randomUUID(),
      startedAt,
      vouchers: await vouchers.snapshotActive(startedAt)
    };
    state.active = active;
    try { save(); }
    catch (e) { state.active = null; throw e; }
    sessions.pauseForOutage(startedAt);
    return status();
  } finally { transitionInProgress = false; }
}

async function trackVoucher(code) {
  if (!state.active) return;
  if (transitionInProgress) throw new Error('Outage status is changing; retry the voucher activation.');
  const info = await vouchers.getInfo(code);
  if (!info || !info.startedAt || info.expiresAt <= Date.now()) return;
  const vouchersInOutage = state.active.vouchers;
  const index = vouchersInOutage.findIndex((v) => v.code === info.code);
  const snapshot = { code: info.code, startedAt: Math.max(state.active.startedAt, info.startedAt), expiresAt: info.expiresAt };
  if (index === -1) vouchersInOutage.push(snapshot);
  else vouchersInOutage[index] = snapshot;
  save();
}

async function resolve() {
  if (transitionInProgress) throw new Error('An outage update is already in progress.');
  if (!state.active) throw new Error('There is no active outage to resolve.');
  transitionInProgress = true;
  const active = state.active;
  try {
    const endedAt = Date.now();
    const packagesCredited = await vouchers.extendForOutage(active.id, active.vouchers, endedAt);
    const expiries = {};
    for (const snapshot of active.vouchers) {
      const info = await vouchers.getInfo(snapshot.code);
      if (info && info.expiresAt) expiries[info.code] = info.expiresAt;
    }
    state.active = null;
    try { save(); }
    catch (e) { state.active = active; throw e; }
    sessions.resumeAfterOutage(endedAt, expiries);
    return { active: false, endedAt, durationMs: Math.max(0, endedAt - active.startedAt), packagesCredited, id: active.id, codes: active.vouchers.map((v) => v.code) };
  } finally {
    transitionInProgress = false;
  }
}

if (state.active) sessions.pauseForOutage(state.active.startedAt);

module.exports = { status, start, resolve, trackVoucher };
