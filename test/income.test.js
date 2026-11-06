// Daily income / growth maths, in Nairobi (EAT) days.   Run: npm test
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'synthnet-inc-'));
process.env.SYNTHNET_DATA = DATA;
// "Now" = Tue 20 Oct 2026 13:00 EAT (10:00 UTC). Seed payments BEFORE the modules load (payments are cached in memory).
const NOW = Date.parse('2026-10-20T10:00:00Z'), H = 3600e3, D = 864e5;
const at = (isoUtc) => Date.parse(isoUtc);
const pays = [
  // Tue 20 Oct (today)            : 30 + 5   at 08:00 and 12:30 EAT
  ['a1', '254711000001', '24h', 30, at('2026-10-20T05:00:00Z')], ['a2', '254711000002', '1h', 5, at('2026-10-20T09:30:00Z')],
  // 00:30 EAT on the 20th = 21:30 UTC on the 19th: must count as TUESDAY, not Monday
  ['a3', '254711000003', '24h', 30, at('2026-10-19T21:30:00Z')],
  // Mon 19 Oct (yesterday)        : 30 at 10:00 EAT (before 13:00 so it counts toward "yesterday so far"), 50 at 20:00 EAT
  ['b1', '254711000001', '24h', 30, at('2026-10-19T07:00:00Z')], ['b2', '254711000004', '2d', 50, at('2026-10-19T17:00:00Z')],
  // Mon 12 Oct .. Sun 18 Oct      : previous week
  ['c1', '254711000005', '24h', 30, at('2026-10-14T09:00:00Z')], ['c2', '254711000005', '24h', 30, at('2026-10-15T09:00:00Z')], ['c3', '254711000006', '24h', 30, at('2026-10-16T09:00:00Z')],
  // Mon 5 Oct.. : two weeks ago
  ['d1', '254711000007', '24h', 30, at('2026-10-07T09:00:00Z')]
].map(([id, phone, tier, amount, t]) => ({ id, phone, tier, amount, status: 'success', paidAt: t, createdAt: t - 20000, voucher: 'V-' + id }));
// failures / pending must never count as income
pays.push({ id: 'x1', phone: '254711000009', tier: '24h', amount: 30, status: 'cancelled', createdAt: NOW - H }, { id: 'x2', phone: '254711000009', tier: '24h', amount: 30, status: 'pending', createdAt: NOW - 1000 });
fs.writeFileSync(path.join(DATA, 'payments.json'), JSON.stringify(Object.fromEntries(pays.map((p) => [p.id, p]))));
// vouchers: one STK voucher (must not double count), one manual Till sale, one award (never counted)
const v = { 'V-a1': { tier: '24h', minutes: 1440, redeemedAt: at('2026-10-20T05:00:00Z'), phone: '254711000001' },
  'MAN-1': { tier: '1h', minutes: 60, redeemedAt: at('2026-10-20T08:00:00Z') }, 'MAN-2': { tier: '24h', minutes: 1440, redeemedAt: at('2026-10-19T08:00:00Z') },
  'AWD-1': { tier: '24h', minutes: 1440, redeemedAt: at('2026-10-20T08:00:00Z'), awarded: true, phone: '254711000008' } };
fs.writeFileSync(path.join(DATA, 'vouchers.json'), JSON.stringify(v));
// SMS log: 2 recipients x 5 segments accepted on Oct 20 = 10 SMS units; a failed one must not cost anything
fs.writeFileSync(path.join(DATA, 'sms-log.json'), JSON.stringify([
  { id: 's1', kind: 'broadcast', to: ['254700000001', '254700000002'], segments: 5, status: 'sent', sentAt: at('2026-10-20T06:00:00Z'), createdAt: at('2026-10-20T06:00:00Z') },
  { id: 's2', kind: 'purchase', to: ['254700000003'], segments: 1, status: 'failed', createdAt: at('2026-10-20T06:00:00Z') }]));
let income;
before(() => { income = require('../src/income'); });

test('daily series uses Nairobi days (a payment at 00:30 EAT belongs to the new day)', async () => {
  const r = await income.report({ days: 7, now: NOW });
  const byDate = Object.fromEntries(r.daily.map((d) => [d.date, d]));
  assert.equal(r.daily.length, 7); assert.equal(r.daily.at(-1).date, '2026-10-20'); assert.equal(r.daily.at(-1).partial, true);
  assert.equal(byDate['2026-10-20'].income, 65); assert.equal(byDate['2026-10-20'].sales, 3);
  assert.equal(byDate['2026-10-19'].income, 80); assert.equal(byDate['2026-10-19'].sales, 2);
  assert.equal(byDate['2026-10-16'].income, 30); assert.equal(byDate['2026-10-17'].income, 0);
});

test('failed and pending payments are never counted', async () => {
  const r = await income.report({ days: 30, now: NOW });
  assert.equal(r.kpis.range.sales, 9); assert.equal(r.kpis.range.income, 65 + 80 + 90 + 30);
});

test('headline numbers and growth percentages', async () => {
  const k = (await income.report({ days: 30, now: NOW })).kpis;
  assert.equal(k.today.income, 65); assert.equal(k.yesterday.income, 80);
  assert.equal(k.today.yesterdaySoFar, 30, 'yesterday up to 13:00 only: a fair like-for-like comparison');
  assert.equal(k.today.changePct, 116.7);                                              // (65 - 30) / 30
  assert.equal(k.last7.income, 235); assert.equal(k.last7.prevIncome, 30); assert.equal(k.last7.changePct, 683.3);   // Oct 14-20 vs Oct 7-13
  assert.equal(k.month.income, 265); assert.equal(k.month.prevMonthSoFar, 0); assert.equal(k.month.changePct, null, 'nothing earlier to compare: shown as "New"');
  assert.deepEqual(k.customers, { unique: 7, new: 7, returning: 0 });
  assert.equal(k.bestDay.date, '2026-10-19'); assert.equal(k.bestDay.income, 80);
  assert.equal(k.range.avgPerDay, Math.round(265 / 30)); assert.equal(k.range.avgSale, Math.round(265 / 9));
  assert.equal(k.successRate, 90, '9 paid out of 10 finished attempts (pending ignored)');
});

test('returning customers are told apart from new ones', async () => {
  const pay = require('../src/pay'), db = pay._t.load();
  const r1 = await income.report({ days: 7, now: NOW });                                 // range starts Oct 14: everyone's first purchase is inside it
  assert.deepEqual(r1.kpis.customers, { unique: 6, new: 6, returning: 0 });
  // 0007 first bought on Oct 7 (before the range). Buying again on Oct 18 makes them a RETURNING customer.
  db.e1 = { id: 'e1', phone: '254711000007', tier: '24h', amount: 30, status: 'success', paidAt: at('2026-10-18T09:00:00Z'), createdAt: at('2026-10-18T09:00:00Z'), voucher: 'V-e1' };
  const r2 = await income.report({ days: 7, now: NOW });
  assert.deepEqual(r2.kpis.customers, { unique: 7, new: 6, returning: 1 });
  delete db.e1;
});

test('weekly table starts on Monday; the unfinished week is never compared', async () => {
  const w = (await income.report({ days: 30, now: NOW })).weekly;
  assert.equal(w.length, 8); const cur = w.at(-1), prev = w.at(-2), older = w.at(-3);
  assert.equal(cur.weekStart, '2026-10-19'); assert.equal(cur.income, 145); assert.equal(cur.partial, true); assert.equal(cur.changePct, null);
  assert.equal(prev.weekStart, '2026-10-12'); assert.equal(prev.income, 90); assert.equal(older.weekStart, '2026-10-05'); assert.equal(older.income, 30);
  assert.equal(prev.changePct, 200);
});

test('trend, package mix and busiest hours', async () => {
  const r = await income.report({ days: 30, now: NOW });
  assert.equal(r.trend.direction, 'up'); assert.equal(r.trend.last7Income, 170); assert.equal(r.trend.prev7Income, 30);   // complete days Oct 13-19 vs Oct 6-12
  assert.equal(r.trend.weekChangePct, 466.7); assert.ok(r.trend.slopePerDay > 0);
  const mix = Object.fromEntries(r.packages.map((p) => [p.tier, p]));
  assert.equal(r.packages[0].tier, '24h'); assert.equal(mix['24h'].sales, 7); assert.equal(mix['24h'].income, 210); assert.equal(mix['2d'].income, 50); assert.equal(mix['1h'].income, 5);
  assert.equal(r.packages.reduce((n, p) => n + p.sharePct, 0) >= 99, true);
  assert.equal(r.hours.reduce((n, x) => n + x, 0), 9); assert.equal(r.hours[0], 1, 'the 00:30 EAT sale lands in hour 0');
  const ma = r.daily.filter((d) => d.ma7 != null); assert.equal(r.daily.at(-1).ma7, null, 'the unfinished day has no trend point'); assert.ok(ma.length >= 6);
});

test('manual Till sales are optional, estimated, and never double counted', async () => {
  const off = await income.report({ days: 7, now: NOW }), on = await income.report({ days: 7, now: NOW, includeManual: true });
  assert.equal(off.kpis.range.income, 235);
  // MAN-1 (1h, today) + MAN-2 (24h, yesterday) are added; V-a1 (already an M-Pesa sale) and AWD-1 (award) add nothing
  assert.equal(on.kpis.range.income - off.kpis.range.income, 5 + 30);
  assert.equal(on.daily.at(-1).manual, 5); assert.equal(on.daily.at(-1).mpesa, 65);
});

test('empty business: zeros, no crashes, no NaN', async () => {
  fs.writeFileSync(path.join(DATA, 'payments.json'), '{}');
  const r = await income.report({ days: 14, now: NOW + 400 * D, includeManual: false });
  assert.equal(r.kpis.range.income, 0); assert.equal(r.kpis.range.avgSale, 0); assert.equal(r.trend.direction, 'flat');
  assert.ok(!JSON.stringify(r).includes('null,"sales"') && !JSON.stringify(r).includes('NaN'));
});

/* ---------------- profit ---------------- */
test('with no costs entered, profit equals revenue and the dashboard says costs are not set', async () => {
  const r = await income.report({ days: 30, now: NOW });
  assert.equal(r.finance.configured, false);
  assert.equal(r.finance.range.revenue, 265); assert.equal(r.finance.range.profit, 265); assert.equal(r.finance.range.cost, 0);
  assert.ok(r.daily.every((d) => d.profit === d.income && d.cost === 0));
});

test('profit = revenue - M-Pesa fees - SMS - running cost - one-off expenses (Nairobi days, today pro-rated)', async () => {
  const finance = require('../src/finance');
  finance.setRates({ mpesaFeePct: 2, smsUnitCostKsh: 0.5, dailyCostKsh: 240 });
  finance.addExpense({ date: '2026-10-19', label: 'Router repair', amountKsh: 100 });
  const r = await income.report({ days: 7, now: NOW }), byDate = Object.fromEntries(r.daily.map((d) => [d.date, d]));
  const t = byDate['2026-10-20'];                                       // 13:00 EAT: 13/24 of the day has passed
  assert.deepEqual([t.fees, t.smsCost, t.fixed, t.oneOff, t.cost, t.profit], [1.3, 5, 130, 0, 136.3, -71.3]);
  const y = byDate['2026-10-19'];
  assert.deepEqual([y.fees, y.smsCost, y.fixed, y.oneOff, y.cost, y.profit], [1.6, 0, 240, 100, 341.6, -261.6]);
  const f = r.finance;
  assert.equal(f.configured, true); assert.equal(f.today.profit, -71.3); assert.equal(f.yesterday.profit, -261.6);
  assert.deepEqual([f.range.revenue, f.range.fees, f.range.smsCost, f.range.fixed, f.range.oneOff, f.range.cost, f.range.profit], [235, 4.7, 5, 1570, 100, 1679.7, -1444.7]);
});

test('running cost only starts on the day of the first sale, and failed SMS cost nothing', async () => {
  const before = await income.report({ days: 30, date: '2026-10-06', now: NOW });
  assert.equal(before.dayDetail.costs.fixed, 0, 'before the business started');
  const first = await income.report({ days: 30, date: '2026-10-07', now: NOW });
  assert.equal(first.dayDetail.costs.fixed, 240);
  assert.equal(first.dayDetail.costs.sms, 0);
});

test('day detail powers the earnings pie: packages, costs and profit for any chosen day', async () => {
  const d = (await income.report({ days: 30, date: '2026-10-20', now: NOW })).dayDetail;
  assert.equal(d.isToday, true); assert.equal(d.revenue, 65); assert.equal(d.sales, 3); assert.equal(d.customers, 3);
  assert.deepEqual(d.packages.map((p) => [p.tier, p.income, p.sales]), [['24h', 60, 2], ['1h', 5, 1]]);
  assert.deepEqual(d.costs, { fees: 1.3, sms: 5, fixed: 130, oneOff: 0, total: 136.3 }); assert.equal(d.profit, -71.3);
  const past = (await income.report({ days: 30, date: '2026-10-19', now: NOW })).dayDetail;
  assert.equal(past.isToday, false); assert.equal(past.revenue, 80); assert.equal(past.costs.oneOff, 100);
  assert.deepEqual(past.packages.map((p) => p.tier), ['2d', '24h']);
  const bad = (await income.report({ days: 30, date: 'nonsense', now: NOW })).dayDetail;
  assert.equal(bad.date, '2026-10-20', 'a bad date falls back to today');
  assert.equal((await income.report({ days: 30, date: '2030-01-01', now: NOW })).dayDetail.isFuture, true);
});

test('cost settings are validated and expenses can be removed', async () => {
  const finance = require('../src/finance');
  assert.throws(() => finance.setRates({ mpesaFeePct: 101 }), /0 to 100/); assert.throws(() => finance.setRates({ dailyCostKsh: -5 }), /0 to 1000000/);
  assert.throws(() => finance.setRates({ smsUnitCostKsh: 'abc' }), /number/);
  assert.throws(() => finance.addExpense({ date: '19/10/2026', label: 'x', amountKsh: 5 }), /valid date/);
  assert.throws(() => finance.addExpense({ date: '2026-10-19', label: '  ', amountKsh: 5 }), /Describe/);
  assert.throws(() => finance.addExpense({ date: '2026-10-19', label: 'x', amountKsh: 0 }), /Expense amount/);
  const list = finance.get().expenses; assert.equal(list.length, 1);
  assert.throws(() => finance.removeExpense('nope'), /not found/);
  finance.removeExpense(list[0].id); assert.equal(finance.get().expenses.length, 0);
  finance.setRates({ mpesaFeePct: 0, smsUnitCostKsh: 0, dailyCostKsh: 0 });
  assert.equal((await income.report({ days: 7, now: NOW })).finance.configured, false);
});
