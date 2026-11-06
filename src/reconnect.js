// Reconnecting a PURCHASED package by M-Pesa number.
//
// Why: a customer who paid by STK push never saw a voucher code. If their phone later shows up with a different Wi-Fi MAC
// address (modern Android/iOS rotate "private" addresses) the portal cannot recognise it, and "Reconnect" used to refuse
// phones. Now a phone can reconnect with the number it paid with. Because anyone could type someone else's number, the
// default is to prove ownership with a one-time SMS code sent to that number.
//
// Admin setting (portal.json -> reconnect.phones):
//   auto   (default) SMS code when SMS is set up, otherwise number only
//   sms    SMS code always; if SMS is not set up, phones cannot reconnect this way
//   number number only (anyone who knows the number can take over the phone slot: use only if you accept that risk)
//   off    phones must use the voucher code (laptop/TV companions are not affected by this setting)
const crypto = require('crypto');
const { portal } = require('./config');
const sms = require('./sms');

const MODES = ['auto', 'sms', 'number', 'off'];
const TTL = 5 * 60000, RESEND_AFTER = 45000, MAX_TRIES = 5, MAX_SENDS = 3, SEND_WINDOW = 15 * 60000;
const pending = new Map();       // phone -> { salt, hash, exp, tries, sentAt }
const sends = new Map();         // phone -> [timestamps]

const setting = () => { const m = (portal().reconnect || {}).phones; return MODES.includes(m) ? m : 'auto'; };
function effective() {
  const m = setting();
  if (m === 'auto') return sms.configured() ? 'sms' : 'number';
  return m;
}
const hash = (salt, code) => crypto.createHash('sha256').update(salt + ':' + code).digest();
const maskLocal = (p) => '0' + p.slice(3, 6) + ' *** ' + p.slice(-3);

async function sendCode(phone) {
  const now = Date.now(), recent = (sends.get(phone) || []).filter((t) => now - t < SEND_WINDOW);
  const cur = pending.get(phone);
  if (cur && now - cur.sentAt < RESEND_AFTER) return { ok: false, wait: Math.ceil((RESEND_AFTER - (now - cur.sentAt)) / 1000), message: `A code was just sent. You can ask for another in ${Math.ceil((RESEND_AFTER - (now - cur.sentAt)) / 1000)} seconds.` };
  if (recent.length >= MAX_SENDS) return { ok: false, message: 'Too many codes requested for this number. Please wait 15 minutes or use your voucher code.' };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), salt = crypto.randomBytes(8).toString('hex');
  const brand = (portal().brand && portal().brand.name) || 'WiFi';
  const r = await sms.sendNow({ kind: 'otp', to: [phone], text: `${brand}: your reconnect code is ${code}. It expires in 5 minutes. Do not share it.`, logText: 'Reconnect verification code (hidden)' });
  if (!r.ok) return { ok: false, message: 'We could not send the SMS code right now. Please try again, or use your voucher code.' };
  pending.set(phone, { salt, hash: hash(salt, code), exp: now + TTL, tries: 0, sentAt: now });
  recent.push(now); sends.set(phone, recent);
  return { ok: true, masked: maskLocal(phone), resendIn: Math.ceil(RESEND_AFTER / 1000), expiresInSec: TTL / 1000 };
}

function checkCode(phone, code) {
  const p = pending.get(phone), given = String(code || '').replace(/\D/g, '');
  if (!p || p.exp < Date.now()) { pending.delete(phone); return { ok: false, expired: true, message: 'That code has expired. Request a new one.' }; }
  if (++p.tries > MAX_TRIES) { pending.delete(phone); return { ok: false, expired: true, message: 'Too many wrong attempts. Request a new code.' }; }
  if (given.length !== 6 || !crypto.timingSafeEqual(hash(p.salt, given), p.hash)) return { ok: false, message: `That code is not right. ${MAX_TRIES - p.tries} ${MAX_TRIES - p.tries === 1 ? 'try' : 'tries'} left.` };
  pending.delete(phone);                                           // single use
  return { ok: true };
}

module.exports = { MODES, setting, effective, sendCode, checkCode, maskLocal, _reset: () => { pending.clear(); sends.clear(); } };
