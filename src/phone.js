// Kenyan mobile number normaliser shared by payments, reconnect and SMS. Returns 254XXXXXXXXX or null.
function normPhone(p) {
  const d = String(p || '').replace(/[\s\-()]/g, '');
  if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1);
  if (/^\+?254[17]\d{8}$/.test(d)) return d.replace('+', '');
  if (/^[17]\d{8}$/.test(d)) return '254' + d;
  return null;
}
const mask = (p) => (p && p.length >= 8 ? p.slice(0, 5) + '****' + p.slice(-3) : p || '');
module.exports = { normPhone, mask };
