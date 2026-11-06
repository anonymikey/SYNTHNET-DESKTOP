// "You are connected" sound settings (stored in portal.json under "sound"). The sounds themselves live in public/connectsound.js.
// The admin picks one of the built-in sounds or uploads a short clip; the portal never plays more than 2 seconds of it.
const fs = require('fs'), path = require('path');
const { DATA_DIR, portal, savePortal } = require('./config');

const PRESETS = ['beep', 'double', 'chime', 'success', 'bell', 'sparkle', 'droplet', 'powerup', 'welcome', 'fanfare'];
const DEFAULTS = { enabled: true, preset: 'beep', volume: 70 };
const MAX_UPLOAD = 300 * 1024;                                  // a 2-second clip is far smaller; this stops accidental full songs
const TYPES = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm' };
const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm' };

function get() {
  const s = portal().sound || {};
  const hasCustom = !!(s.customExt && fs.existsSync(path.join(DATA_DIR, 'connect-sound.' + s.customExt)));
  const preset = s.preset === 'custom' ? (hasCustom ? 'custom' : DEFAULTS.preset) : PRESETS.includes(s.preset) ? s.preset : DEFAULTS.preset;
  const volume = Number.isInteger(s.volume) && s.volume >= 5 && s.volume <= 100 ? s.volume : DEFAULTS.volume;
  return { enabled: s.enabled !== false, preset, volume, hasCustom, customName: hasCustom ? String(s.customName || 'Custom sound') : null, customVersion: s.customVersion || 0, customExt: hasCustom ? s.customExt : null };
}
const store = (next) => { savePortal({ sound: { enabled: next.enabled, preset: next.preset, volume: next.volume, customExt: next.customExt, customName: next.customName, customVersion: next.customVersion } }); return get(); };

function save(p) {
  const cur = get(), next = { ...cur };
  if (p.enabled != null) next.enabled = !!p.enabled;
  if (p.volume != null) {
    const n = Number(p.volume);
    if (!Number.isInteger(n) || n < 5 || n > 100) throw new Error('Volume must be a whole number from 5 to 100.');
    next.volume = n;
  }
  if (p.preset != null) {
    if (p.preset === 'custom') { if (!cur.hasCustom) throw new Error('Upload your own sound first.'); }
    else if (!PRESETS.includes(p.preset)) throw new Error('Unknown sound.');
    next.preset = p.preset;
  }
  return store(next);
}

// Checks the first bytes so a renamed image/script can never be stored as "audio".
function looksLikeAudio(buf, ext) {
  const head = buf.subarray(0, 12), ascii = (a, b) => head.subarray(a, b).toString('latin1');
  if (ext === 'mp3') return ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
  if (ext === 'wav') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
  if (ext === 'ogg') return ascii(0, 4) === 'OggS';
  if (ext === 'm4a') return ascii(4, 8) === 'ftyp';
  if (ext === 'aac') return head[0] === 0xff && (head[1] & 0xf0) === 0xf0;
  if (ext === 'webm') return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  return false;
}
function decode(dataUrl) {
  const m = /^data:(audio\/[a-z0-9.+-]+)(?:;[a-z0-9=.+-]+)*;base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || '').trim());
  if (!m || !TYPES[m[1].toLowerCase()]) return { error: 'Upload an MP3, WAV, OGG or M4A sound.' };
  const ext = TYPES[m[1].toLowerCase()], buf = Buffer.from(m[2], 'base64');
  if (!buf.length) return { error: 'That file is empty.' };
  if (buf.length > MAX_UPLOAD) return { error: `That file is too big (max ${MAX_UPLOAD / 1024} KB). Only the first 2 seconds are ever played, so use a short clip.` };
  if (!looksLikeAudio(buf, ext)) return { error: 'That does not look like a real audio file.' };
  return { ext, buf };
}
function setCustom(dataUrl, name) {
  const d = decode(dataUrl); if (d.error) throw new Error(d.error);
  const cur = get();
  for (const e of Object.keys(MIME)) { try { fs.unlinkSync(path.join(DATA_DIR, 'connect-sound.' + e)); } catch { /* not there */ } }
  fs.writeFileSync(path.join(DATA_DIR, 'connect-sound.' + d.ext), d.buf);
  const label = String(name || 'Custom sound').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60) || 'Custom sound';
  return store({ ...cur, preset: 'custom', hasCustom: true, customExt: d.ext, customName: label, customVersion: (cur.customVersion || 0) + 1 });
}
function clearCustom() {
  const cur = get();
  for (const e of Object.keys(MIME)) { try { fs.unlinkSync(path.join(DATA_DIR, 'connect-sound.' + e)); } catch { /* not there */ } }
  return store({ ...cur, preset: cur.preset === 'custom' ? DEFAULTS.preset : cur.preset, customExt: null, customName: null });
}
const publicConfig = () => { const s = get(); return { enabled: s.enabled, preset: s.preset, volume: s.volume, customUrl: s.hasCustom ? '/connect-sound?v=' + s.customVersion : null }; };
const filePath = () => { const s = get(); return s.hasCustom ? { file: path.join(DATA_DIR, 'connect-sound.' + s.customExt), mime: MIME[s.customExt] } : null; };

module.exports = { get, save, setCustom, clearCustom, publicConfig, filePath, PRESETS, MAX_UPLOAD };
