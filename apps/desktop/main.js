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
const CHILD_MAX_RESTARTS = 3;
const QUIT_SHUTDOWN_BUDGET_MS = 5000;

let mainWindow = null;
let appUrl = null;
let serverPort = 0;
let hubProc = null;
let hubRestarts = 0;
let nextProc = null;
let nextRestarts = 0;
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
// bundled Next.js standalone server (child process)
// ---------------------------------------------------------------------------

function startNextServer(port) {
  if (!fs.existsSync(SERVER_JS)) {
    logErr(`bundled server missing: ${SERVER_JS} - run npm run build:app first`);
    return false;
  }
  serverPort = port;
  nextProc = spawn(process.execPath, [SERVER_JS], {
    env: childEnv({
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  log(`next server starting pid=${nextProc.pid} port=${port}`);
  nextProc.stdout.on('data', (d) => process.stdout.write('[next] ' + d));
  nextProc.stderr.on('data', (d) => process.stderr.write('[next:err] ' + d));
  nextProc.on('exit', (code, signal) => {
    nextProc = null;
    log(`next server exited code=${code} signal=${signal}`);
    if (quitting) return;
    // the UI dies with the server - bring it back (bounded, like the hub)
    if (nextRestarts < CHILD_MAX_RESTARTS) {
      nextRestarts += 1;
      const delay = 2000 * nextRestarts;
      log(`next server restart ${nextRestarts}/${CHILD_MAX_RESTARTS} in ${delay}ms`);
      setTimeout(async () => {
        startNextServer(serverPort);
        try { await waitForServer(serverPort, 15000); log(`server ready on port ${serverPort}`); }
        catch (e) { logErr(e.message); }
      }, delay);
    } else {
      logErr(`next server hit the restart limit (${CHILD_MAX_RESTARTS})`);
    }
  });
  return true;
}

// ---------------------------------------------------------------------------
// farm hub child process (Electron binary as node)
// ---------------------------------------------------------------------------

function startHub() {
  if (quitting || !fs.existsSync(HUB_JS)) {
    if (!fs.existsSync(HUB_JS)) logErr(`hub not found at ${HUB_JS} - run npm run prepare:resources`);
    return;
  }
  hubProc = spawn(process.execPath, [HUB_JS, ...HUB_ARGS], {
    env: childEnv({}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  log(`hub started pid=${hubProc.pid} (${HUB_ARGS.join(' ')})`);
  hubProc.stdout.on('data', (d) => process.stdout.write('[hub] ' + d));
  hubProc.stderr.on('data', (d) => process.stderr.write('[hub:err] ' + d));
  hubProc.on('exit', (code, signal) => {
    hubProc = null;
    log(`hub exited code=${code} signal=${signal}`);
    if (quitting) return;
    if (hubRestarts < CHILD_MAX_RESTARTS) {
      hubRestarts += 1;
      const delay = 2000 * hubRestarts + Math.floor(Math.random() * 1000); // backoff 2s/4s/6s (+jitter)
      log(`hub restart ${hubRestarts}/${CHILD_MAX_RESTARTS} in ${delay}ms`);
      setTimeout(startHub, delay);
    } else {
      logErr(`hub hit the restart limit (${CHILD_MAX_RESTARTS}); not restarting`);
    }
  });
}

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

function sendToPage(channel) {
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (wc) wc.send(channel);
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
    const b = {
      width: Number(raw.width) || defaults.width,
      height: Number(raw.height) || defaults.height,
    };
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) { b.x = Math.round(raw.x); b.y = Math.round(raw.y); }
    // keep the restored window inside a visible display
    if (b.x !== undefined) {
      const { screen } = require('electron');
      const area = screen.getPrimaryDisplay().workArea;
      const onScreen = b.x + 100 >= area.x && b.x < area.x + area.width &&
                       b.y + 40 >= area.y && b.y < area.y + area.height;
      if (!onScreen) { delete b.x; delete b.y; }
    }
    b.width = Math.min(Math.max(b.width, 1100), area.width);
    b.height = Math.min(Math.max(b.height, 700), area.height);
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
      stopChild(hubProc, QUIT_SHUTDOWN_BUDGET_MS),
      stopChild(nextProc, QUIT_SHUTDOWN_BUDGET_MS),
    ]),
    deadline,
  ]).then(() => {
    // make sure nothing survived the SIGTERM grace window
    try { hubProc && hubProc.kill('SIGKILL'); } catch { /* gone */ }
    try { nextProc && nextProc.kill('SIGKILL'); } catch { /* gone */ }
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
