const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DATA_DIR = process.env.SYNTHNET_DATA || path.join(__dirname, '..', 'data');

const IMAGE_DIR = path.join(DATA_DIR, 'theme-images');
const STATE_FILE = path.join(DATA_DIR, 'theme-image-rotation.json');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function ensureDirectory() {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

function list() {
  ensureDirectory();
  return fs.readdirSync(IMAGE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function imagePath(filename) {
  if (typeof filename !== 'string' || path.basename(filename) !== filename || !IMAGE_EXT.has(path.extname(filename).toLowerCase()))
    return null;
  const fullPath = path.join(IMAGE_DIR, filename);
  try { return fs.lstatSync(fullPath).isFile() ? fullPath : null; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

function dayKey(date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (state && Array.isArray(state.remaining)) return state;
    throw new Error('Invalid image rotation state.');
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[theme] Could not read image rotation state:', e.message);
    return { date: null, image: null, remaining: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function choose(theme = {}, files = list(), date = new Date()) {
  const today = dayKey(date);
  const override = theme.imageOverrideDate === today && files.includes(theme.imageOverrideFile)
    ? theme.imageOverrideFile : null;
  if (!theme.imageRotationEnabled && !override) return null;
  if (!files.length) return null;

  const state = readState();
  if (override) {
    if (state.date === today && state.image === override && state.manualOverride) return override;
    state.date = today;
    state.image = override;
    state.manualOverride = true;
    state.remaining = state.remaining.filter((file) => files.includes(file) && file !== override);
    saveState(state);
    return override;
  }
  if (state.date === today && files.includes(state.image) && !state.manualOverride) return state.image;

  let remaining = [...new Set(state.remaining.filter((file) => files.includes(file)))];
  const queued = new Set(remaining);
  remaining.push(...shuffle(files.filter((file) => !queued.has(file))));
  if (!remaining.length) remaining = shuffle(files);
  if (remaining.length > 1 && remaining[0] === state.image) {
    const next = remaining.findIndex((file) => file !== state.image);
    [remaining[0], remaining[next]] = [remaining[next], remaining[0]];
  }

  state.date = today;
  state.image = remaining.shift();
  state.manualOverride = false;
  state.remaining = remaining;
  saveState(state);
  return state.image;
}

function url(filename, version = Date.now()) {
  return `/theme-library/${encodeURIComponent(filename)}?v=${version}`;
}

module.exports = { IMAGE_DIR, list, imagePath, dayKey, choose, url };
