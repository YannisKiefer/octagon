'use strict';
// OCTAGON DESKTOP SHELL
// Boots the bundled Next.js standalone server as a child process (the Electron
// binary run as node via ELECTRON_RUN_AS_NODE=1) on a random 127.0.0.1 port,
// runs the farm hub the same way, and owns window + menu + lifecycle.
// Set NEXT_DEV_URL=http://localhost:3010 to iterate on the UI against a
// running `npm run dev` server instead of the bundled build.

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const https = require('https');
const os = require('os');

const DEV_URL = process.env.NEXT_DEV_URL || ''; // e.g. http://localhost:3010
const IS_DEV = !!DEV_URL;
const SMOKE = !!process.env.OCTAGON_SMOKE; // CI-style: boot, print page title, exit 0

const log = (...a) => console.log('[desktop]', ...a);
const logErr = (...a) => console.error('[desktop]', ...a);

// Resource roots: packaged apps keep the standalone server + farm runtime in
// Contents/Resources (extraResources); unpackaged runs read them from apps/desktop.
const resourcesRoot = app.isPackaged ? process.resourcesPath : __dirname;
// Next emits a flattened standalone (server.js at the root) outside npm
// workspaces, and standalone/apps/dashboard/server.js inside one.
function findServerJs(base) {
  const candidates = [path.join(base, 'apps', 'dashboard', 'server.js'), path.join(base, 'server.js')];
  return candidates.find((p) => fs.existsSync(p)) || candidates[1];
}
const STANDALONE_DIR = path.join(resourcesRoot, 'standalone');
const SERVER_JS = findServerJs(STANDALONE_DIR);
const HUB_JS = path.join(resourcesRoot, 'farm', 'hub.js');

const HUB_ARGS = ['--slots=4', '--duration=60'];
const QUIT_SHUTDOWN_BUDGET_MS = 5000;

let mainWindow = null;
let appUrl = null;
let serverPort = 0;
let quitting = false;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
        res.resume(); // any HTTP response means the server is up
        if (res.statusCode < 500) resolve(res.statusCode);
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error(`server on 127.0.0.1:${port} not ready after ${timeoutMs}ms`));
      setTimeout(tryOnce, 250);
    };
    tryOnce();
  });
}

function userDataPath(name) {
  return path.join(app.getPath('userData'), name);
}

function childEnv(extra) {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1', // run the Electron binary as plain node
    OCTAGON_DESKTOP: '1',
    FARM_DB_PATH: userDataPath('farm.db'),
    ...extra,
  };
}

// SIGTERM -> wait -> SIGKILL. Resolves when the process is gone or killed.
function stopChild(proc, graceMs) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(killer); resolve(); } };
    proc.once('exit', finish);
    try { proc.kill('SIGTERM'); } catch { return finish(); }
    const killer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      setTimeout(finish, 500);
    }, graceMs);
  });
}

// ---------------------------------------------------------------------------
// supervised children: the bundled Next server and the farm hub, each the
// Electron binary run as plain node, restarted with bounded linear backoff
// ---------------------------------------------------------------------------

const CHILD_MAX_RESTARTS = 3;
const children = {
  next: { proc: null, restarts: 0 },
  hub: { proc: null, restarts: 0 },
};

// Shared supervision: spawn `args`, pipe logs as [tag]/[tag:err], and on an
// unplanned exit restart at most CHILD_MAX_RESTARTS times (backoff 2s/4s/6s).
// Returns false when the entry script is missing (and logs `missing`).
function startChild(name, { file, missing, args, env = {}, tag = name, onUp }) {
  const c = children[name];
  if (quitting) return false;
  if (!fs.existsSync(file)) {
    logErr(missing);
    return false;
  }
  c.proc = spawn(process.execPath, args, { env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  log(`${name} started pid=${c.proc.pid}`);
  c.proc.stdout.on('data', (d) => process.stdout.write(`[${tag}] ` + d));
  c.proc.stderr.on('data', (d) => process.stderr.write(`[${tag}:err] ` + d));
  c.proc.on('exit', (code, signal) => {
    c.proc = null;
    log(`${name} exited code=${code} signal=${signal}`);
    if (quitting) return;
    if (c.restarts >= CHILD_MAX_RESTARTS) return logErr(`${name} hit the restart limit (${CHILD_MAX_RESTARTS}); not restarting`);
    c.restarts += 1;
    const delay = 2000 * c.restarts;
    log(`${name} restart ${c.restarts}/${CHILD_MAX_RESTARTS} in ${delay}ms`);
    setTimeout(() => {
      if (startChild(name, { file, missing, args, env, tag, onUp }) && onUp) onUp();
    }, delay);
  });
  return true;
}

function startNextServer(port) {
  serverPort = port;
  return startChild(`next server (port ${port})`, {
    file: SERVER_JS,
    missing: `bundled server missing: ${SERVER_JS} - run npm run build:app first`,
    args: [SERVER_JS],
    env: { NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1' },
    tag: 'next',
    onUp: async () => {
      try { await waitForServer(serverPort, 15000); log(`server ready on port ${serverPort}`); }
      catch (e) { logErr(e.message); }
    },
  });
}

function startHub() {
  startChild('hub', {
    file: HUB_JS,
    missing: `hub not found at ${HUB_JS} - run npm run prepare:resources`,
    args: [HUB_JS, ...HUB_ARGS],
  });
}

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

function sendToPage(channel, payload) {
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (wc) wc.send(channel, payload);
}


// ---------------------------------------------------------------------------
// updater - unsigned builds cannot use electron-updater (macOS requires signed
// apps for Squirrel.Mac), so this checks GitHub releases and swaps the app
// bundle in place: download DMG -> attach -> copy Octagon.app over the
// installed copy -> relaunch. No quarantine attribute is created by this path,
// so updated installs never see the Gatekeeper dialog again.
// ---------------------------------------------------------------------------
const UPDATE_FEED = process.env.OCTAGON_UPDATE_FEED
  || 'https://api.github.com/repos/YannisKiefer/octagon/releases/latest';

function parseVersion(v) {
  return String(v || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}
function isNewer(latest, current) {
  const a = parseVersion(latest); const b = parseVersion(current);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) > (b[i] || 0)) return true; if ((a[i] || 0) < (b[i] || 0)) return false; }
  return false;
}
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'octagon-desktop', Accept: 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
  });
}
async function checkForUpdate() {
  const feed = await fetchJson(UPDATE_FEED);
  const latest = String(feed.tag_name || '').replace(/^v/, '');
  if (!latest || !isNewer(latest, app.getVersion())) return { available: false, current: app.getVersion() };
  const dmg = (feed.assets || []).find((a) => /arm64\.dmg$/.test(a.name));
  return {
    available: true, current: app.getVersion(), version: latest,
    url: dmg ? dmg.browser_download_url : null,
  };
}
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'octagon-desktop' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'], 10) || 0;
      let done = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        done += chunk.length;
        if (total && onProgress) onProgress(Math.min(100, Math.round((done / total) * 100)));
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(0, () => {}); // large file; no idle timeout
  });
}
function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let stdout = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.on('close', (code) => resolve({ code, stdout }));
    p.on('error', (e) => resolve({ code: 1, stdout: '', error: e.message }));
  });
}
let updateInstalling = false;
async function installUpdate(onProgress) {
  if (updateInstalling) return { ok: false, error: 'An update is already in progress.' };
  updateInstalling = true;
  try {
    const check = await checkForUpdate();
    if (!check.available || !check.url) return { ok: false, error: 'No update available.' };
    const dmgPath = path.join(os.tmpdir(), 'Octagon-' + check.version + '.dmg');
    onProgress({ phase: 'download', pct: 0 });
    await downloadFile(check.url, dmgPath, (pct) => onProgress({ phase: 'download', pct }));
    onProgress({ phase: 'install', pct: 100 });
    const mountpoint = path.join(os.tmpdir(), 'octagon-update-mount');
    const attach = await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountpoint, dmgPath]);
    if (attach.code !== 0) return { ok: false, error: 'Could not open the downloaded update.' };
    try {
      const src = path.join(mountpoint, 'Octagon.app');
      if (!fs.existsSync(src)) return { ok: false, error: 'The downloaded update is missing Octagon.app.' };
      const exe = app.getPath('exe'); // .../Octagon.app/Contents/MacOS/Octagon
      const installedRoot = path.resolve(exe, '..', '..', '..');
      if (installedRoot.startsWith('/Applications')) {
        fs.rmSync('/Applications/Octagon.app', { recursive: true, force: true });
        fs.cpSync(src, '/Applications/Octagon.app', { recursive: true });
        onProgress({ phase: 'relaunch', pct: 100 });
        app.relaunch();
        setTimeout(() => app.exit(0), 300);
        return { ok: true, relaunching: true };
      }
      // Not installed in /Applications (e.g. running from the DMG): hand the
      // mounted volume to the user for the normal drag.
      shell.openPath(mountpoint);
      return { ok: true, relaunching: false, note: 'Drag Octagon to Applications to finish the update.' };
    } finally {
      run('/usr/bin/hdiutil', ['detach', mountpoint, '-force']).then(() => {
        try { fs.unlinkSync(dmgPath); } catch {}
      });
    }
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    updateInstalling = false;
  }
}

function createWindow(url) {
  const bounds = loadBounds();
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0B0E12',
    fullscreenable: true,
    // tabbingIdentifier intentionally not set: no native tabbing
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true, // what makes the 127.0.0.1 origin safe - do not disable
    },
  });
  log(`window created (${bounds.width}x${bounds.height})`);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', saveBounds);

  // keep navigation inside the app origin; everything else opens in the browser
  const allowedOrigin = new URL(url).origin;
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http')) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, target) => {
    if (!target.startsWith(allowedOrigin)) { e.preventDefault(); if (target.startsWith('http')) shell.openExternal(target); }
  });

  mainWindow.loadURL(url);
  return mainWindow;
}

// ---------------------------------------------------------------------------
// window bounds persistence (userData/bounds.json)
// ---------------------------------------------------------------------------

function loadBounds() {
  const defaults = { width: 1280, height: 860 };
  try {
    const raw = JSON.parse(fs.readFileSync(userDataPath('bounds.json'), 'utf8'));
    const { screen } = require('electron');
    const area = screen.getPrimaryDisplay().workArea;
    const b = {
      width: Math.min(Math.max(Number(raw.width) || defaults.width, 1100), area.width),
      height: Math.min(Math.max(Number(raw.height) || defaults.height, 700), area.height),
    };
    // restore x/y only if the window would land on a visible display
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y) &&
        raw.x + 100 >= area.x && raw.x < area.x + area.width &&
        raw.y + 40 >= area.y && raw.y < area.y + area.height) {
      b.x = Math.round(raw.x);
      b.y = Math.round(raw.y);
    }
    return b;
  } catch {
    return defaults;
  }
}

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return;
  const b = mainWindow.getNormalBounds();
  try { fs.writeFileSync(userDataPath('bounds.json'), JSON.stringify(b)); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// menu
// ---------------------------------------------------------------------------

function buildMenu() {
  const devtoolsAllowed = IS_DEV || !app.isPackaged;
  const template = [
    {
      label: 'Octagon',
      submenu: [
        { role: 'about', label: 'About Octagon' },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => {
            checkForUpdate()
              .then((r) => {
                if (r.available) {
                  sendToPage('update:available', r);
                  dialog.showMessageBox({ type: 'info', message: 'Update ' + r.version + ' is available.', detail: 'Use the Update banner in the app to install it.', buttons: ['OK'] });
                } else {
                  dialog.showMessageBox({ type: 'info', message: "You're up to date.", detail: 'Octagon ' + app.getVersion() + ' is the latest version.', buttons: ['OK'] });
                }
              })
              .catch(() => dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates.', detail: 'GitHub was unreachable. Try again later.', buttons: ['OK'] }));
          },
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToPage('open-settings'),
        },
        { type: 'separator' },
        {
          label: 'Quit Octagon',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        ...(devtoolsAllowed ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+W' },
        { label: 'Octagon keeps running in the background', enabled: false },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(app.getPath('userData')),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

// Cmd+W closes the window; the app (and the hub) keep running. Dock icon
// stays; clicking it reopens the window.
app.on('window-all-closed', () => { /* stay alive on macOS */ });

app.on('activate', () => {
  // dock click: reopen (or recreate) the window; the app and hub never stopped
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
  else if (appUrl) { createWindow(appUrl); }
});

// Bounded child shutdown, then quit: SIGTERM both children, 5s budget, then
// SIGKILL, then exit. Runs once (quitting flag guards re-entry).
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  log('quitting: stopping hub and next server...');
  const deadline = new Promise((r) => setTimeout(r, QUIT_SHUTDOWN_BUDGET_MS));
  Promise.race([
    Promise.all([
      stopChild(children.hub.proc, QUIT_SHUTDOWN_BUDGET_MS),
      stopChild(children.next.proc, QUIT_SHUTDOWN_BUDGET_MS),
    ]),
    deadline,
  ]).then(() => {
    // make sure nothing survived the SIGTERM grace window
    try { if (children.hub.proc) children.hub.proc.kill('SIGKILL'); } catch { /* gone */ }
    try { if (children.next.proc) children.next.proc.kill('SIGKILL'); } catch { /* gone */ }
    log('children stopped; exiting');
    app.exit(0);
  });
});

if (!app.requestSingleInstanceLock()) {
  // a second copy is already running - focus it and leave
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.setAboutPanelOptions({
    applicationName: 'Octagon',
    applicationVersion: app.getVersion(),
    copyright: 'Local-first phone farm dashboard',
  });

  app.whenReady().then(async () => {
    buildMenu();

    const { ipcMain } = require('electron');
    ipcMain.handle('update:check', () => checkForUpdate());
    ipcMain.handle('update:install', async () => {
      const send = (payload) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:progress', payload); };
      return installUpdate(send);
    });
    // one quiet check shortly after launch; the renderer shows a banner if a
    // newer version exists
    if (!SMOKE) {
      setTimeout(() => {
        checkForUpdate()
          .then((r) => { if (r.available && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:available', r); })
          .catch(() => {});
      }, 15000);
    }

    // Dock icon: the packed icns covers packaged builds, but dev/unpacked
    // launches otherwise show the generic Electron icon.
    if (process.platform === "darwin" && app.dock) {
      try { app.dock.setIcon(path.join(__dirname, "build", "icon.png")); }
      catch (e) { log(`dock icon: ${e.message}`); }
    }

    if (!SMOKE) startHub(); // smoke runs server + window only

    let url;
    if (IS_DEV) {
      url = DEV_URL;
      log(`dev mode: loading ${url}`);
    } else {
      const port = await getFreePort();
      log(`starting bundled server on port ${port}...`);
      if (!startNextServer(port)) {
        if (SMOKE) { app.exit(1); return; }
        dialog.showErrorBox('Octagon', `The bundled dashboard is missing.\n\nRun "npm run build:app" in apps/desktop, then relaunch.`);
        app.exit(1);
        return;
      }
      try {
        const status = await waitForServer(port);
        log(`server ready on port ${port} (GET /api/health -> ${status})`);
      } catch (err) {
        logErr(err.message);
        if (SMOKE) { app.exit(1); return; }
        dialog.showErrorBox('Octagon', `The bundled dashboard failed to start.\n\n${err.message}`);
        app.exit(1);
        return;
      }
      url = `http://127.0.0.1:${port}`;
    }

    createWindow(url);
    appUrl = url;

    if (SMOKE) {
      // CI-style smoke: wait for load, print the page title, exit 0.
      const fail = setTimeout(() => { logErr('smoke TIMEOUT'); app.exit(1); }, 30000);
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const title = await mainWindow.webContents.executeJavaScript('document.title');
            log(`smoke page title: ${JSON.stringify(title)}`);
            clearTimeout(fail);
            log('smoke OK');
            app.exit(0);
          } catch (err) {
            logErr(`smoke executeJavaScript failed: ${err.message}`);
            clearTimeout(fail);
            app.exit(1);
          }
        }, 5000);
      });
    }
  });
}
