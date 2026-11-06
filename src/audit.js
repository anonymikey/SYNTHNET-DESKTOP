// Turns every successful admin change into an activity entry ("Cost settings updated", "Generated 10 vouchers"...).
// Called by admin.js after the token check, so only the authenticated admin can ever create these. Never records secrets.
const events = require('./events');
const { portal } = require('./config');
const { mask, normPhone } = require('./phone');

const tierName = (id) => ((portal().tiers || []).find((t) => t.id === id) || {}).name || id || 'package';
const target = (t) => { const n = normPhone(t); return n ? mask(n) : String(t || '').slice(0, 40); };
const dur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h || d ? h + 'h ' : '') + m + 'm'; };

// [method, path regex, (requestBody, responseBody) => { category?, title, message?, level?, silent? }]
const RULES = [
  ['POST', /^\/vouchers$/, (b, r) => ({ title: `Generated ${(r.codes || []).length} voucher${(r.codes || []).length === 1 ? '' : 's'}`, message: `${tierName(b.tier)}${r.smsQueued ? ' · code sent by SMS' : ''}` })],
  ['POST', /^\/award$/, (b, r) => ({ title: 'Awarded free time', message: `${tierName(b.tier)} to ${target(b.target || b.phone || b.ip)}${r.smsQueued ? ' · code sent by SMS' : ''}` })],
  ['POST', /^\/revoke$/, (b) => ({ title: 'Disconnected a device', message: String(b.ip || b.key || '').slice(0, 60) })],
  ['POST', /^\/hotspot$/, (b) => ({ title: 'Hotspot settings changed', message: String(b.action || b.ssid || '').slice(0, 60) })],
  ['POST', /^\/outage$/, (b, r) => b.action === 'resolve'
    ? { category: 'outage', level: 'success', title: 'Service restored', message: `${dur(r.durationMs)} of downtime credited across ${r.packagesCredited || 0} package(s)${r.sms && r.sms.queued ? ` · SMS queued for ${r.sms.queued} customer(s)` : ''}` }
    : { category: 'outage', level: 'warning', title: 'Outage recorded', message: `Package clocks are paused${r.sms && r.sms.queued ? ` · SMS queued for ${r.sms.queued} customer(s)` : ''}` }],
  ['POST', /^\/portal$/, () => ({ title: 'Portal content or prices updated' })],
  ['POST', /^\/logo$/, () => ({ title: 'Portal logo changed' })], ['POST', /^\/logo\/clear$/, () => ({ title: 'Portal logo removed' })],
  ['POST', /^\/theme$/, () => ({ title: 'Portal theme changed' })], ['POST', /^\/theme\/background$/, () => ({ title: 'Portal background changed' })], ['POST', /^\/theme\/background\/clear$/, () => ({ title: 'Portal background removed' })],
  ['POST', /^\/greeting$/, (b) => ({ title: b.enabled === false ? 'Portal greeting switched off' : 'Portal greeting updated' })], ['POST', /^\/greeting\/reset$/, () => ({ title: 'Portal greeting reset to defaults' })],
  ['POST', /^\/tv$/, (b, r) => ({ title: 'TV linked to a package by MAC address', message: `${String(b.label || r.mac || '').slice(0, 30)} · ${r.code || ''}` })],
  ['POST', /^\/sound$/, (b) => ({ title: b.enabled === false ? 'Connection sound switched off' : 'Connection sound changed', message: b.preset ? `Sound: ${b.preset}` : '' })],
  ['POST', /^\/sound\/upload$/, () => ({ title: 'Custom connection sound uploaded' })], ['POST', /^\/sound\/clear$/, () => ({ title: 'Custom connection sound removed' })],
  ['POST', /^\/reconnect$/, (b) => ({ title: 'Reconnect mode changed', message: `Phones: ${b.phones}` })],
  ['POST', /^\/finance$/, () => ({ title: 'Cost settings updated' })],
  ['POST', /^\/finance\/expense$/, (b) => ({ title: 'Expense added', message: `${String(b.label || '').slice(0, 40)} · KSh ${b.amountKsh}` })],
  ['DELETE', /^\/finance\/expense\/[^/]+$/, () => ({ title: 'Expense deleted' })],
  ['POST', /^\/sms\/credentials$/, () => ({ category: 'sms', title: 'SMS connection details saved' })],
  ['POST', /^\/sms\/settings$/, () => ({ category: 'sms', title: 'SMS message settings updated' })],
  ['POST', /^\/sms\/test-send$/, () => ({ category: 'sms', title: 'Test SMS sent' })],
  ['POST', /^\/sms\/broadcast$/, (b, r) => ({ category: 'sms', level: 'success', title: `${r.scheduled ? 'Broadcast scheduled' : 'Broadcast queued'} for ${r.queued} recipient${r.queued === 1 ? '' : 's'}`, message: `~${r.units || 0} SMS units${r.excluded ? ` · ${r.excluded} skipped (do-not-message)` : ''}` })],
  ['POST', /^\/sms\/log\/[^/]+\/retry$/, () => ({ category: 'sms', title: 'SMS retry requested' })],
  ['POST', /^\/sms\/log\/[^/]+\/cancel$/, () => ({ category: 'sms', title: 'Queued SMS cancelled' })],
  ['POST', /^\/security\/admin-token$/, () => ({ category: 'security', level: 'warning', silent: false, title: 'Admin password changed', message: 'Use the new password next time you unlock the dashboard.' })]
];
const SKIP = [/^\/notifications/, /^\/sms\/(audience|preview|test-connection)$/, /^\/income/];

function record(req, res, body) {
  const path = req.originalUrl.split('?')[0].replace(/^\/api\/admin/, '') || '/';
  if (req.method === 'GET' || SKIP.some((r) => r.test(path))) return;
  const status = res.statusCode || 200, b = req.body || {}, r = body && typeof body === 'object' ? body : {};
  if (status >= 500) return events.emit({ category: 'system', level: 'warning', title: 'An admin action failed', message: `${req.method} ${path}: ${String(r.error || status).slice(0, 120)}`, dedupeKey: 'adminfail500:' + path, dedupeMs: 600000 });
  if (status >= 400) return;                                                  // validation messages are not news
  const rule = RULES.find(([m, re]) => m === req.method && re.test(path));
  const e = rule ? rule[2](b, r) : { title: 'Admin changed a setting', message: `${req.method} ${path}` };
  events.emit({ category: 'admin', level: 'info', silent: true, ...e });     // the admin did it themselves: logged, but it should not ring the bell
}

module.exports = { record };
