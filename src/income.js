// Business analytics for the admin dashboard: daily income and growth, in NAIROBI days (EAT = UTC+3, no daylight saving).
// Verified income = M-Pesa payments that Courtney Tech confirmed. Optionally (admin toggle) manual Till sales are
// estimated from admin-generated vouchers that customers redeemed, priced at the package's current price.
const pay = require('./pay');
const vouchers = require('./vouchers');
const sms = require('./sms');
const finance = require('./finance');
const { portal } = require('./config');

const EAT = 3 * 3600e3, DAY = 864e5;
const dayStart = (ms) => Math.floor((ms + EAT) / DAY) * DAY - EAT;               // epoch ms of Nairobi midnight
const dayKey = (ms) => new Date(ms + EAT).toISOString().slice(0, 10);
const weekStart = (ms) => { const d = dayStart(ms), dow = new Date(d + EAT).getUTCDay(); return d - ((dow + 6) % 7) * DAY; };   // Monday
const monthStart = (ms) => { const x = new Date(ms + EAT); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) - EAT; };
const prevMonthStart = (ms) => { const x = new Date(ms + EAT); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth() - 1, 1) - EAT; };
const sum = (a) => a.reduce((n, x) => n + x, 0);
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;
// % change; null means "no earlier income to compare with" (shown as "New").
const pct = (cur, prev) => (prev > 0 ? round1((cur - prev) / prev * 100) : cur > 0 ? null : 0);

async function events(includeManual) {
  const tiers = new Map((portal().tiers || []).map((t) => [t.id, t]));
  const paid = pay.successes(), out = paid.map((r) => ({ t: r.paidAt || r.createdAt, amount: Number(r.amount) || 0, phone: r.phone, tier: r.tier, src: 'mpesa' }));
  if (includeManual) {
    const linked = new Set(paid.map((r) => r.voucher).filter(Boolean));
    for (const v of await vouchers.salesCandidates()) {
      const tier = tiers.get(v.tier);
      if (linked.has(v.code) || !tier || !(tier.priceKsh > 0)) continue;     // STK vouchers are already counted; unknown/test tiers have no price
      out.push({ t: v.redeemedAt, amount: tier.priceKsh, phone: v.phone, tier: v.tier, src: 'manual' });
    }
  }
  return out.filter((e) => e.t > 0).sort((a, b) => a.t - b.t);
}

async function report({ days = 30, includeManual = false, date = null, now = Date.now() } = {}) {
  days = Math.min(Math.max(parseInt(days, 10) || 30, 7), 365);
  const evs = await events(includeManual), today = dayStart(now), first = today - (days - 1) * DAY;

  // ---- Costs and profit (see src/finance.js). Fixed running cost starts on the day of the first sale ever, and today's
  // share is pro-rated by how much of the Nairobi day has passed, so an early-morning "today" is not shown as a big loss.
  const fin = finance.get(), smsByDay = new Map();
  for (const m of sms.sentUnits()) smsByDay.set(dayKey(m.t), (smsByDay.get(dayKey(m.t)) || 0) + m.units);
  const fixedFrom = evs.length ? dayStart(evs[0].t) : Infinity;
  const costsFor = (from, list) => {
    const mpesa = sum(list.filter((e) => e.src === 'mpesa').map((e) => e.amount)), revenue = sum(list.map((e) => e.amount));
    const fees = round2(mpesa * fin.mpesaFeePct / 100), smsCost = round2((smsByDay.get(dayKey(from)) || 0) * fin.smsUnitCostKsh);
    const share = from === today ? Math.min(1, Math.max(0, (now - today) / DAY)) : 1;
    const fixed = from >= fixedFrom ? round2(fin.dailyCostKsh * share) : 0;
    const oneOff = round2(sum(fin.expenses.filter((x) => x.date === dayKey(from)).map((x) => x.amountKsh)));
    const cost = round2(fees + smsCost + fixed + oneOff);
    return { fees, smsCost, fixed, oneOff, cost, profit: round2(revenue - cost) };
  };
  const addFin = (a, b) => ({ revenue: round2(a.revenue + b.revenue), fees: round2(a.fees + b.fees), smsCost: round2(a.smsCost + b.smsCost), fixed: round2(a.fixed + b.fixed), oneOff: round2(a.oneOff + b.oneOff), cost: round2(a.cost + b.cost), profit: round2(a.profit + b.profit) });
  const ZERO = { revenue: 0, fees: 0, smsCost: 0, fixed: 0, oneOff: 0, cost: 0, profit: 0 };
  const financeOf = (from, to) => { let t = ZERO; for (let d = from; d < to; d += DAY) { const list = evs.filter((e) => e.t >= d && e.t < d + DAY); t = addFin(t, { revenue: sum(list.map((e) => e.amount)), ...costsFor(d, list) }); } return t; };
  const inRange = (from, to) => evs.filter((e) => e.t >= from && e.t < to);
  const tot = (list) => ({ income: sum(list.map((e) => e.amount)), sales: list.length });

  // Daily series (oldest -> newest, today last and flagged partial). Built from 6 extra days so the moving average is full.
  const series = [];
  for (let i = -6; i < days; i++) {
    const from = first + i * DAY, list = inRange(from, from + DAY);
    series.push({ date: dayKey(from), ...tot(list), ...costsFor(from, list), mpesa: sum(list.filter((e) => e.src === 'mpesa').map((e) => e.amount)), manual: sum(list.filter((e) => e.src === 'manual').map((e) => e.amount)), customers: new Set(list.map((e) => e.phone).filter(Boolean)).size, partial: from === today });
  }
  const complete = series.filter((d) => !d.partial);
  series.forEach((d, i) => { const win = series.slice(Math.max(0, i - 6), i + 1); d.ma7 = d.partial ? null : round1(sum(win.map((x) => x.income)) / win.length); });
  const daily = series.slice(6);

  // Trend: last 7 complete days vs the 7 before; slope via least squares over the complete days in range.
  const rangeComplete = daily.filter((d) => !d.partial), n = rangeComplete.length;
  const last7 = sum(complete.slice(-7).map((d) => d.income)), prev7 = sum(complete.slice(-14, -7).map((d) => d.income));
  let slope = 0;
  if (n > 2) { const mx = (n - 1) / 2, my = sum(rangeComplete.map((d) => d.income)) / n; let num = 0, den = 0; rangeComplete.forEach((d, i) => { num += (i - mx) * (d.income - my); den += (i - mx) ** 2; }); slope = den ? num / den : 0; }
  const wkChange = pct(last7, prev7), direction = wkChange === null ? 'up' : wkChange > 5 ? 'up' : wkChange < -5 ? 'down' : 'flat';

  // Headline numbers.
  const todayT = tot(inRange(today, today + DAY)), yest = tot(inRange(today - DAY, today)), yestSoFar = tot(inRange(today - DAY, now - DAY + 1));
  // Rolling windows ending NOW (not calendar days), so a half-finished day never makes "last 7 days" look worse than the 7 before it.
  const w7 = tot(inRange(now - 7 * DAY, now + 1)), w7prev = tot(inRange(now - 14 * DAY, now - 7 * DAY));
  const d30 = tot(inRange(now - 30 * DAY, now + 1)), d30prev = tot(inRange(now - 60 * DAY, now - 30 * DAY));
  const ms = monthStart(now), pms = prevMonthStart(now), month = tot(inRange(ms, now + 1)), prevMonthSoFar = tot(inRange(pms, Math.min(ms, pms + (now - ms) + 1)));
  const rangeList = inRange(first, today + DAY), rangeTotal = tot(rangeList);
  const best = daily.reduce((b, d) => (d.income > b.income ? d : b), { income: 0, date: null });

  // Customers: unique buyers in range, how many bought for the first time in range.
  const firstSeen = new Map(); for (const e of evs) if (e.phone && !firstSeen.has(e.phone)) firstSeen.set(e.phone, e.t);
  const buyers = new Set(rangeList.map((e) => e.phone).filter(Boolean)), fresh = [...buyers].filter((p) => firstSeen.get(p) >= first).length;

  // M-Pesa success rate over the range (pending ones excluded).
  const attempts = Object.values(pay._t.load()).filter((r) => r.createdAt >= first && r.status !== 'pending');
  const successRate = attempts.length ? Math.round(attempts.filter((r) => r.status === 'success').length / attempts.length * 100) : null;

  // Last 8 Mondays-start weeks.
  const wk0 = weekStart(now), weekly = [];
  for (let i = 7; i >= 0; i--) { const from = wk0 - i * 7 * DAY; weekly.push({ weekStart: dayKey(from), ...tot(inRange(from, from + 7 * DAY)), partial: i === 0 }); }
  weekly.forEach((w, i) => { w.changePct = i === 0 || w.partial ? null : pct(w.income, weekly[i - 1].income); w.isNew = !w.partial && i > 0 && weekly[i - 1].income === 0 && w.income > 0; });   // a half-finished week is never compared

  // Package mix and busiest hours (range).
  const names = new Map((portal().tiers || []).map((t) => [t.id, t.name])), mix = new Map();
  for (const e of rangeList) { const m = mix.get(e.tier) || { tier: e.tier, name: names.get(e.tier) || e.tier, sales: 0, income: 0 }; m.sales++; m.income += e.amount; mix.set(e.tier, m); }
  const packages = [...mix.values()].sort((a, b) => b.income - a.income).map((m) => ({ ...m, sharePct: rangeTotal.income ? Math.round(m.income / rangeTotal.income * 100) : 0 }));
  const hours = Array(24).fill(0); for (const e of rangeList) hours[new Date(e.t + EAT).getUTCHours()]++;

  return {
    tz: 'Africa/Nairobi', generatedAt: now, days, includeManual, daily,
    trend: { direction, weekChangePct: wkChange, slopePerDay: Math.round(slope), last7Income: last7, prev7Income: prev7 },
    kpis: {
      today: { ...todayT, yesterdaySoFar: yestSoFar.income, changePct: pct(todayT.income, yestSoFar.income) },
      yesterday: yest,
      last7: { ...w7, prevIncome: w7prev.income, changePct: pct(w7.income, w7prev.income) },
      last30: { ...d30, prevIncome: d30prev.income, changePct: pct(d30.income, d30prev.income) },
      month: { ...month, prevMonthSoFar: prevMonthSoFar.income, changePct: pct(month.income, prevMonthSoFar.income) },
      range: { ...rangeTotal, avgPerDay: Math.round(rangeTotal.income / days), avgSale: rangeTotal.sales ? Math.round(rangeTotal.income / rangeTotal.sales) : 0 },
      bestDay: best.date ? { date: best.date, income: best.income } : null,
      customers: { unique: buyers.size, new: fresh, returning: buyers.size - fresh },
      successRate
    },
    finance: {
      settings: fin, configured: fin.mpesaFeePct > 0 || fin.smsUnitCostKsh > 0 || fin.dailyCostKsh > 0 || fin.expenses.length > 0,
      today: financeOf(today, today + DAY), yesterday: financeOf(today - DAY, today), month: financeOf(monthStart(now), today + DAY),
      range: financeOf(first, today + DAY)
    },
    dayDetail: dayDetail(date),
    weekly, packages, hours
  };

  function dayDetail(dateKey) {
    const k = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || '')) && !Number.isNaN(Date.parse(dateKey + 'T00:00:00Z')) ? dateKey : dayKey(now);
    const from = Date.parse(k + 'T00:00:00Z') - EAT, list = inRange(from, from + DAY), names = new Map((portal().tiers || []).map((t) => [t.id, t.name])), by = new Map();
    for (const e of list) { const m = by.get(e.tier) || { tier: e.tier, name: names.get(e.tier) || e.tier, sales: 0, income: 0 }; m.sales++; m.income += e.amount; by.set(e.tier, m); }
    const c = costsFor(from, list), revenue = sum(list.map((e) => e.amount));
    return { date: k, isToday: from === today, isFuture: from > today, revenue, sales: list.length, customers: new Set(list.map((e) => e.phone).filter(Boolean)).size, packages: [...by.values()].sort((a, b) => b.income - a.income), costs: { fees: c.fees, sms: c.smsCost, fixed: c.fixed, oneOff: c.oneOff, total: c.cost }, profit: c.profit };
  }
}

module.exports = { report, _t: { dayStart, dayKey, weekStart, pct } };
