const { execFile } = require('child_process');
const path = require('path');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'set-hotspot.ps1');

const defaults = () => ({
  ssid: process.env.HOTSPOT_SSID || 'SYNTHNET_VOUCHER_HOTSPOT',
  password: process.env.HOTSPOT_PASSWORD || '12345678'
});

// Args go through execFile (no shell), and are validated, so nothing here can inject commands.
const okText = (s, min, max) => typeof s === 'string' && s.length >= min && s.length <= max &&
  /^[\x20-\x7E]+$/.test(s) && !s.startsWith('-');

function run(action, opts = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, message: 'Hotspot control only works on Windows.' });
    const d = defaults();
    const ssid = opts.ssid || d.ssid, password = opts.password || d.password;
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Action', action];
    if (action === 'apply') {
      if (!okText(ssid, 1, 32)) return resolve({ ok: false, message: 'SSID must be 1-32 plain characters and not start with "-".' });
      if (!okText(password, 8, 63)) return resolve({ ok: false, message: 'Password must be 8-63 plain characters and not start with "-".' });
      args.push('-Ssid', ssid, '-Password', password);
    }
    execFile('powershell.exe', args, { timeout: 60000, windowsHide: true }, (err, stdout, stderr) => {
      const last = String(stdout).trim().split(/\r?\n/).filter(Boolean).pop();
      try { return resolve(JSON.parse(last)); } catch {}
      resolve({ ok: false, message: String(stderr || (err && err.message) || 'No output from PowerShell').slice(0, 300) });
    });
  });
}

module.exports = { run, defaults };

// CLI:  node src/hotspot.js apply | start | stop | status
if (require.main === module) {
  require('dotenv').config();
  const action = process.argv[2] || 'status';
  run(action).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
}
