// Cost settings behind the dashboard's profit figures (stored in portal.json under "finance").
// Profit = revenue - M-Pesa fees - SMS cost - daily running cost - one-off expenses. Every cost defaults to 0, so until you
// enter your real costs, profit simply equals revenue.
const crypto = require('crypto');
const { portal, savePortal } = require('./config');

const DEFAULTS = { mpesaFeePct: 0, smsUnitCostKsh: 0, dailyCostKsh: 0, expenses: [] };
const round2 = (x) => Math.round(x * 100) / 100;

function get() {
  const f = portal().finance || {};
  return {
    mpesaFeePct: Number(f.mpesaFeePct) || 0, smsUnitCostKsh: Number(f.smsUnitCostKsh) || 0, dailyCostKsh: Number(f.dailyCostKsh) || 0,
    expenses: Array.isArray(f.expenses) ? f.expenses.filter((e) => e && e.id && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.amountKsh > 0) : []
  };
}
function num(v, label, min, max) {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be a number from ${min} to ${max}.`);
  return round2(n);
}
const save = (next) => { savePortal({ finance: next }); return get(); };

function setRates(p) {
  const cur = get();
  if (p.mpesaFeePct != null) cur.mpesaFeePct = num(p.mpesaFeePct, 'M-Pesa fee (%)', 0, 100);
  if (p.smsUnitCostKsh != null) cur.smsUnitCostKsh = num(p.smsUnitCostKsh, 'SMS cost per unit (KSh)', 0, 1000);
  if (p.dailyCostKsh != null) cur.dailyCostKsh = num(p.dailyCostKsh, 'Daily running cost (KSh)', 0, 1000000);
  return save(cur);
}
function addExpense({ date, label, amountKsh }) {
  const cur = get();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) throw new Error('Pick a valid date for the expense.');
  const text = String(label || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
  if (!text) throw new Error('Describe the expense (e.g. "Router repair").');
  if (cur.expenses.length >= 300) throw new Error('Too many expenses saved (max 300). Delete old ones first.');
  cur.expenses.push({ id: crypto.randomUUID(), date, label: text, amountKsh: num(amountKsh, 'Expense amount (KSh)', 0.01, 100000000) });
  cur.expenses.sort((a, b) => (a.date < b.date ? 1 : -1));
  return save(cur);
}
function removeExpense(id) {
  const cur = get(), n = cur.expenses.length;
  cur.expenses = cur.expenses.filter((e) => e.id !== id);
  if (cur.expenses.length === n) throw new Error('That expense was not found.');
  return save(cur);
}
module.exports = { get, setRates, addExpense, removeExpense, DEFAULTS };
