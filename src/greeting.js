// Portal greeting settings (stored in portal.json under "greeting"). Rendering lives in public/greeting.js.
// Time of day is Nairobi (EAT, UTC+3). The portal gets the server clock with the settings, so phone clocks don't matter.
const { portal, savePortal } = require('./config');

const ACCENTS = [
  { id: 'sunrise', name: 'Sunrise (amber + rose)' }, { id: 'sky', name: 'Sky (blue + indigo)' }, { id: 'sunset', name: 'Sunset (orange + crimson)' },
  { id: 'night', name: 'Night (indigo + stars)' }, { id: 'emerald', name: 'Emerald (green + teal)' }, { id: 'violet', name: 'Violet (purple + pink)' }
];
const ACCENT_IDS = new Set(ACCENTS.map((a) => a.id));
const PLACEHOLDERS = ['brand', 'support', 'day'];

const DEFAULTS = {
  enabled: true,
  showClock: true,
  periods: [
    { id: 'morning',   start: 5,  emoji: '\u2600\ufe0f', accent: 'sunrise', title: 'Good morning',   subtitle: 'Habari za asubuhi! Welcome to {brand}. Pick a package and get online in seconds.' },
    { id: 'afternoon', start: 12, emoji: '\ud83c\udf24\ufe0f', accent: 'sky',     title: 'Good afternoon', subtitle: 'Habari za mchana! Fast, reliable Wi-Fi from {brand}. Choose a package to connect.' },
    { id: 'evening',   start: 17, emoji: '\ud83c\udf06', accent: 'sunset',  title: 'Good evening',   subtitle: 'Habari za jioni! Unwind online with {brand}. Pick a package to get started.' },
    { id: 'night',     start: 21, emoji: '\ud83c\udf19', accent: 'night',   title: 'Good night',     subtitle: 'Usiku mwema! Night owl? Stay connected with {brand}.' }
  ]
};

function get() {
  const saved = portal().greeting || {};
  const byId = new Map((Array.isArray(saved.periods) ? saved.periods : []).map((p) => [p.id, p]));
  return {
    enabled: saved.enabled !== false,
    showClock: saved.showClock !== false,
    periods: DEFAULTS.periods.map((d) => ({ ...d, ...(byId.get(d.id) || {}) }))
  };
}

function checkText(text, label, max, required) {
  const t = String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (required && !t) throw new Error(`${label} cannot be empty.`);
  if (t.length > max) throw new Error(`${label} is too long (max ${max} characters).`);
  const bad = [...t.matchAll(/\{(\w*)\}/g)].map((m) => m[1]).filter((n) => !PLACEHOLDERS.includes(n));
  if (bad.length) throw new Error(`${label}: unknown placeholder {${bad[0]}}. Allowed: ${PLACEHOLDERS.map((p) => '{' + p + '}').join(' ')}`);
  return t;
}

function save(input) {
  const cur = get(), next = { enabled: cur.enabled, showClock: cur.showClock, periods: cur.periods.map((p) => ({ ...p })) };
  if (input.enabled != null) next.enabled = !!input.enabled;
  if (input.showClock != null) next.showClock = !!input.showClock;
  if (input.periods != null) {
    if (!Array.isArray(input.periods)) throw new Error('periods must be a list.');
    for (const p of input.periods) {
      const target = next.periods.find((x) => x.id === p.id);
      if (!target) throw new Error(`Unknown greeting period "${p.id}".`);
      const label = target.id[0].toUpperCase() + target.id.slice(1);
      if (p.start != null) {
        const n = Number(p.start);
        if (!Number.isInteger(n) || n < 0 || n > 23) throw new Error(`${label}: start hour must be a whole number from 0 to 23.`);
        target.start = n;
      }
      if (p.accent != null) { if (!ACCENT_IDS.has(p.accent)) throw new Error(`${label}: unknown colour style "${p.accent}".`); target.accent = p.accent; }
      if (p.emoji != null) { const e = String(p.emoji).trim(); if ([...e].length > 6) throw new Error(`${label}: use at most one or two emoji.`); target.emoji = e; }
      if (p.title != null) target.title = checkText(p.title, `${label} greeting`, 40, true);
      if (p.subtitle != null) target.subtitle = checkText(p.subtitle, `${label} message`, 160, false);
    }
  }
  const starts = next.periods.map((p) => p.start);
  if (new Set(starts).size !== starts.length) throw new Error('Each time of day needs a different start hour.');
  savePortal({ greeting: next });
  return get();
}

const reset = () => { savePortal({ greeting: JSON.parse(JSON.stringify(DEFAULTS)) }); return get(); };
const publicConfig = () => ({ ...get(), serverNow: Date.now() });

module.exports = { get, save, reset, publicConfig, DEFAULTS, ACCENTS, PLACEHOLDERS };
