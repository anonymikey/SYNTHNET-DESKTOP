// Central paths + hot-reloadable portal content (prices, till number, branding, theme).
const fs = require('fs'), path = require('path');
const { DEFAULT_WEEKDAY, WEEKDAY_NAMES } = require('./themes');
const themeImages = require('./themeImages');
const DATA_DIR = process.env.SYNTHNET_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT = path.join(__dirname, '..', 'config', 'portal.json');
const PORTAL_FILE = path.join(DATA_DIR, 'portal.json');
if (!fs.existsSync(PORTAL_FILE)) fs.copyFileSync(DEFAULT, PORTAL_FILE);

function portal() {
  try { return JSON.parse(fs.readFileSync(PORTAL_FILE, 'utf8')); }
  catch { return JSON.parse(fs.readFileSync(DEFAULT, 'utf8')); }
}

// Shallow-merges brand/payment/theme (so a partial edit from the admin dashboard doesn't wipe fields it didn't
// send) and fully replaces `tiers`/`theme.holidays` when provided (they're lists; the dashboard always sends the
// complete list it wants, so a partial merge would make deleting an entry impossible).
function savePortal(patch) {
  const cur = portal();
  const next = {
    ...cur,
    ...(patch.brand ? { brand: { ...cur.brand, ...patch.brand } } : {}),
    ...(patch.payment ? { payment: { ...cur.payment, ...patch.payment } } : {}),
    ...(patch.tiers ? { tiers: patch.tiers } : {}),
    ...(patch.greeting ? { greeting: patch.greeting } : {}),
    ...(patch.finance ? { finance: patch.finance } : {}),
    ...(patch.sound ? { sound: patch.sound } : {}),
    ...(patch.reconnect ? { reconnect: { ...cur.reconnect, ...patch.reconnect } } : {}),
    ...(patch.theme ? { theme: { ...cur.theme, ...patch.theme, ...(patch.theme.weekday ? { weekday: { ...cur.theme?.weekday, ...patch.theme.weekday } } : {}) } } : {})
  };
  fs.writeFileSync(PORTAL_FILE, JSON.stringify(next, null, 2));
  return next;
}

// Library images take priority only when daily rotation or today's explicit image override is enabled.
// Otherwise the existing uploaded photo and named theme behavior stay unchanged.
function resolveTheme(p = portal()) {
  const th = p.theme || {};
  const today = themeImages.dayKey();
  const image = themeImages.choose(th);
  if (image) return {
    template: th.manualTemplate || 'default',
    customBackground: true,
    backgroundUrl: themeImages.url(image, today),
    libraryImage: image
  };
  if (th.customBackground) return { template: th.manualTemplate || 'default', customBackground: true, backgroundUrl: '/theme-bg?v=' + (th.bgVersion || 0) };
  if ((th.mode || 'manual') !== 'auto') return { template: th.manualTemplate || 'default', customBackground: false };
  const now = new Date(), mmdd = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const holiday = (th.holidays || []).find((h) => h.date === mmdd);
  if (holiday) return { template: holiday.template, customBackground: false, holidayName: holiday.name };
  const weekday = { ...DEFAULT_WEEKDAY, ...(th.weekday || {}) };
  return { template: weekday[WEEKDAY_NAMES[now.getDay()]] || 'default', customBackground: false };
}

module.exports = { DATA_DIR, PORTAL_FILE, portal, savePortal, resolveTheme };
