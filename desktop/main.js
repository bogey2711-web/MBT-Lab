// MBT Lab: Windows desktop shell. Loads the newest copy of the single-file app it has (works offline),
// checks GitHub for a newer copy in the background, and keeps the PDF export working through a save dialog.
const { app, BrowserWindow, Menu, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const REPO_RAW = 'https://raw.githubusercontent.com/bogey2711-web/mbt-lab/main/';
const PAGES = 'https://bogey2711-web.github.io/mbt-lab/';
const BUNDLED = path.join(__dirname, 'app');
const MAX_BYTES = 60 * 1024 * 1024;
const UPD = () => path.join(app.getPath('userData'), 'update');

function readVer(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')); } catch (e) { return null; } }
function buildOf(v) { return v && Number.isFinite(+v.build) ? +v.build : 0; }
function bestCopy() {
  const b = readVer(BUNDLED), u = readVer(UPD());
  if (u && buildOf(u) > buildOf(b) && fs.existsSync(path.join(UPD(), 'index.html'))) return { dir: UPD(), ver: u };
  return { dir: BUNDLED, ver: b };
}

async function getText(urls) {
  for (const u of urls) {
    try { const r = await net.fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store', redirect: 'error' });   // never follow a redirect: only our own https hosts are ever read
      if (!r.ok || !/^https:\/\/(raw\.githubusercontent\.com|bogey2711-web\.github\.io)\//.test(r.url || u)) continue;   // https and our own hosts only (r.url is empty in some Electron builds, so fall back to the requested URL)
      const len = +r.headers.get('content-length') || 0; if (len > MAX_BYTES) continue;
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX_BYTES) continue; return buf; } catch (e) { }
  }
  return null;
}

let checking = false;
async function checkForUpdate(win, running) {
  if (checking) return; checking = true;
  try {
    const vb = await getText([REPO_RAW + 'version.json', PAGES + 'version.json']); if (!vb) return;
    const remote = JSON.parse(vb.toString('utf8'));
    if (buildOf(remote) <= buildOf(running.ver)) return;
    const have = readVer(UPD());
    if (have && buildOf(have) >= buildOf(remote) && fs.existsSync(path.join(UPD(), 'index.html'))) { offerRestart(win, remote); return; }
    const html = await getText([REPO_RAW + 'index.html', PAGES + 'index.html']); if (!html) return;
    const sha = crypto.createHash('sha256').update(html).digest('hex');
    if (remote.sha256 && sha !== remote.sha256) return;           // incomplete or mismatched download: ignore
    if (!remote.sha256 || !/^[0-9a-f]{64}$/.test(remote.sha256)) return;   // an update without a checksum is never installed
    const head = html.toString('utf8', 0, 6000);
    if (html.length < 500000 || !head.includes('<title>') || !head.includes('Content-Security-Policy')) return;
    if (/<script[^>]+\ssrc\s*=/i.test(html.toString('utf8'))) return;     // the app is one self-contained file
    const d = UPD(); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'index.tmp'), html);
    fs.renameSync(path.join(d, 'index.tmp'), path.join(d, 'index.html'));
    fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify(remote));
    offerRestart(win, remote);
  } catch (e) { } finally { checking = false; }
}

function offerRestart(win, remote) {
  if (!win || win.isDestroyed()) return;
  dialog.showMessageBox(win, {
    type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1, title: 'MBT Lab update',
    message: 'An update to MBT Lab has been downloaded.',
    detail: (remote.notes ? remote.notes + '\n\n' : '') + 'Restart now to use it, or it will be used next time you open MBT Lab.'
  }).then(r => { if (r.response === 0) { app.relaunch(); app.exit(0); } }).catch(() => { });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 360, minHeight: 600, autoHideMenuBar: true, backgroundColor: '#ffffff', title: 'MBT Lab',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, devTools: false }
  });
  Menu.setApplicationMenu(null);
  const running = bestCopy();
  win.loadFile(path.join(running.dir, 'index.html'));
  // if an update copy is ever broken, fall back to the bundled copy
  win.webContents.on('did-fail-load', () => { if (running.dir !== BUNDLED) { running.dir = BUNDLED; running.ver = readVer(BUNDLED); win.loadFile(path.join(BUNDLED, 'index.html')); } });
  win.webContents.once('did-finish-load', () => setTimeout(() => checkForUpdate(win, running), 3000));
  setInterval(() => checkForUpdate(win, running), 6 * 3600 * 1000);
  // external links open in the normal browser
  const ext = url => /^(https:|http:|mailto:)/i.test(url);
  win.webContents.setWindowOpenHandler(({ url }) => { if (ext(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (url.split('#')[0] === win.webContents.getURL().split('#')[0]) return; e.preventDefault(); if (ext(url)) shell.openExternal(url); });
  win.webContents.on('will-redirect', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  // downloads (PDF export) ask where to save
  win.webContents.session.on('will-download', (event, item) => {
    const def = path.join(app.getPath('downloads'), item.getFilename());
    const p = dialog.showSaveDialogSync(win, { defaultPath: def, filters: [{ name: 'PDF document', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }] });
    if (!p) { item.cancel(); return; }
    item.setSavePath(p);
  });
}
app.on('web-contents-created', (e, wc) => { wc.on('will-attach-webview', ev => ev.preventDefault()); });
const lock = app.requestSingleInstanceLock();
if (!lock) { app.quit(); } else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
