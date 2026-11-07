const { app, BrowserWindow, Tray, Menu, Notification, dialog, nativeImage, shell } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { execFile } = require('child_process');
const updater = require('./updater');

if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.setAppUserModelId('com.synthnet.hotspot');

// Data lives in %APPDATA%\SYNTHNET\data (survives updates). Must be set BEFORE loading server modules.
const DATA_DIR = path.join(app.getPath('userData'), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.SYNTHNET_DATA = DATA_DIR;
const ENV_FILE = path.join(DATA_DIR, '.env');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const WEBSITE_URL = 'https://synthnetdesktop.anonymiketech.space';
const DEVELOPER_EMAIL = 'anonymiketech@gmail.com';

let win = null, tray = null, quitting = false, port = 80, updateTimer = null;
const UPDATE_MARKER = () => path.join(app.getPath('userData'), '.last-update-notified');

function bootstrapEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'config', 'env.template'), 'utf8');
    fs.writeFileSync(ENV_FILE, tpl.replace('ADMIN_TOKEN=change-me-please', 'ADMIN_TOKEN=' + crypto.randomBytes(24).toString('hex')), { mode: 0o600 });
  }
  try { fs.chmodSync(ENV_FILE, 0o600); } catch { /* Windows ACLs govern access on Windows. */ }
  require('dotenv').config({ path: ENV_FILE });
}

const isAdmin = () => new Promise((res) => execFile('fsutil', ['dirty', 'query', process.env.SystemDrive || 'C:'], { windowsHide: true }, (e) => res(!e)));

function ensureFirewall(p) {
  const name = 'SYNTHNET HTTP';
  execFile('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${name}`], { windowsHide: true }, () =>
    execFile('netsh', ['advfirewall', 'firewall', 'add', 'rule', `name=${name}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${p}`, 'profile=any'], { windowsHide: true }, () => {}));
}

function openInNotepad(f) { execFile('notepad.exe', [f]); }

function openProductWebsite() {
  const version = app.getVersion();
  const marker = path.join(app.getPath('userData'), '.last-website-version');
  let previous = '';
  try { previous = fs.readFileSync(marker, 'utf8').trim(); } catch {}
  const isNewVersion = previous !== version;
  const query = isNewVersion ? `/release?version=${encodeURIComponent(version)}&from=installer` : '/?from=app#download';
  try { fs.writeFileSync(marker, version); } catch {}
  shell.openExternal(`${WEBSITE_URL}${query}`).catch(() => {});
}

function readLastNotifiedVersion() { try { return fs.readFileSync(UPDATE_MARKER(), 'utf8').trim(); } catch { return ''; } }
function rememberNotifiedVersion(version) { try { fs.writeFileSync(UPDATE_MARKER(), String(version)); } catch {} }
function openReleasePage(version) { shell.openExternal(`${WEBSITE_URL}/release?version=${encodeURIComponent(version)}&from=update`).catch(() => {}); }

async function checkForUpdates({ force = false } = {}) {
  try {
    const release = await updater.fetchLatestRelease(`${WEBSITE_URL}/api/latest`);
    const lastNotified = force ? '' : readLastNotifiedVersion();
    if (!updater.shouldNotify(release, app.getVersion(), lastNotified)) return false;
    rememberNotifiedVersion(release.version);
    const title = `SYNTHNET v${release.version} is ready`;
    const body = 'New features and improvements are available. Click to view the release and update your app.';
    if (Notification && Notification.isSupported()) {
      const notice = new Notification({ title, body, icon: ICON, silent: false });
      notice.on('click', () => openReleasePage(release.version));
      notice.show();
    } else {
      const choice = await dialog.showMessageBox({ type: 'info', title: 'SYNTHNET update available', message: title, detail: body, buttons: ['View update', 'Later'], defaultId: 0, cancelId: 1, noLink: true });
      if (choice.response === 0) openReleasePage(release.version);
    }
    return true;
  } catch { return false; }
}

function startUpdateChecker() {
  clearInterval(updateTimer);
  setTimeout(() => checkForUpdates(), 3500);
  updateTimer = setInterval(() => checkForUpdates(), updater.DEFAULT_INTERVAL_MS);
  updateTimer.unref();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 720, title: 'SYNTHNET', backgroundColor: '#020617', icon: ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const url = `http://localhost:${port}/admin#t=${encodeURIComponent(process.env.ADMIN_TOKEN)}`;
  const load = () => win.loadURL(url).catch(() => {});
  win.webContents.on('did-fail-load', () => setTimeout(load, 1500));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(`http://localhost:${port}/`)) e.preventDefault(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  load();
}

function showWindow() { if (!win) return createWindow(); win.show(); win.focus(); }

function buildMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Edit settings (.env)', click: () => openInNotepad(ENV_FILE) },
      { label: 'Edit portal page, prices, till (portal.json)', click: () => openInNotepad(path.join(DATA_DIR, 'portal.json')) },
      { label: 'Open data folder', click: () => shell.openPath(DATA_DIR) },
      { type: 'separator' },
      { label: 'Quit SYNTHNET (stops hotspot)', click: () => quit() }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
    { label: 'Help', submenu: [
      { label: 'Open SYNTHNET website', click: () => shell.openExternal(`${WEBSITE_URL}/?from=app#download`) },
      { label: 'Check for updates', click: () => checkForUpdates({ force: true }) },
      { label: 'Contact developer / request a feature', click: () => shell.openExternal(`mailto:${DEVELOPER_EMAIL}?subject=SYNTHNET%20feature%20request%20or%20support`) },
      { label: 'Preview guest portal in browser', click: () => shell.openExternal(`http://localhost:${port}/login`) }
    ] }
  ]));
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('SYNTHNET hotspot manager');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open dashboard', click: showWindow }, { label: 'Quit (stops hotspot)', click: () => quit() }]));
  tray.on('click', showWindow);
}

async function quit() {
  if (quitting) return; quitting = true;
  clearInterval(updateTimer);
  try {
    await require('../src/gate').stop();
    // If the hotspot kept running without the gate, unpaid users would get free internet.
    if (String(process.env.STOP_HOTSPOT_ON_EXIT || 'true').toLowerCase() !== 'false') await require('../src/hotspot').run('stop');
  } catch {}
  app.exit(0);
}
app.on('before-quit', (e) => { if (!quitting) { e.preventDefault(); quit(); } });
app.on('window-all-closed', () => {});
app.on('second-instance', showWindow);

app.whenReady().then(async () => {
  if (process.platform === 'win32' && !(await isAdmin())) {
    dialog.showErrorBox('Administrator required', 'SYNTHNET controls the Windows hotspot and network filter.\nRight-click SYNTHNET and choose "Run as administrator".');
    return app.exit(1);
  }
  bootstrapEnv();
  const server = require('../server');
  port = server.PORT;
  try { await server.start(); }
  catch (e) {
    dialog.showErrorBox('Cannot start portal on port ' + port,
      (e.code === 'EADDRINUSE' ? `Port ${port} is already in use (IIS, Skype or another SYNTHNET?). Stop it, or set PORT=8080 in:\n${ENV_FILE}` : e.message));
    return app.exit(1);
  }
  ensureFirewall(port);
  buildMenus();
  createWindow();
  openProductWebsite();
  startUpdateChecker();

  // ORDER MATTERS: the gate must be filtering BEFORE the hotspot exists, so no device ever gets a free-internet moment.
  const gate = require('../src/gate'), hotspot = require('../src/hotspot'), guard = require('../src/guard');
  const g = await gate.start();
  console.log('[gate]', g.active ? 'ACTIVE' : 'OFF: ' + g.reason);
  guard.start(gate, hotspot);                                           // watchdog: gate down => hotspot stopped
  if (!g.active && guard.required()) {
    dialog.showMessageBox({ type: 'warning', title: 'Hotspot NOT started',
      message: 'The internet gate could not start, so the hotspot was not started (it would give free internet).', detail: g.reason });
  } else if (String(process.env.AUTO_START_HOTSPOT || 'true').toLowerCase() !== 'false') {
    hotspot.run('apply').then((r) => console.log('[hotspot]', r.ok ? r.message : 'FAILED: ' + r.message));
  }
});
