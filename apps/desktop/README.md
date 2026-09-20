# Octagon Desktop Shell

Native macOS app wrapper for the local Octagon dashboard: an installable
`Octagon.app` (DMG + ZIP, arm64) that boots the bundled Next.js standalone
server on `127.0.0.1` (random free port) and runs the farm hub (`hub.js`) as a
managed child process.

```
apps/desktop/
├── main.js                  Electron main process (window, menu, lifecycle)
├── preload.js               contextBridge: window.octagonDesktop (open-settings)
├── electron-builder.yml     packaging config (dmg + zip, arm64, ad-hoc sign)
├── build/icon.png           1024x1024 icon (generated from public/glyph-white.png via sips)
├── scripts/
│   ├── prepare-resources.js   copies .next/standalone -> standalone/, infra/farm -> farm/
│   ├── rebuild-native.js      better-sqlite3 -> Electron ABI for both copies (+ verify gate)
│   ├── after-pack.js          injects node_modules trees electron-builder drops (see below)
│   ├── after-sign.js          ad-hoc codesign + strict verify
│   └── gate-packaged.js       CI-style gates against the packaged .app
├── standalone/              (generated) bundled Next server
├── farm/                    (generated) hub + farm-brain + node_modules
└── release/                 (generated) .app / .dmg / .zip
```

## Requirements

- macOS on Apple Silicon (arm64), Node 20+ (verified on Node 26 / macOS 15)
- Xcode Command Line Tools (only if the better-sqlite3 electron prebuild is
  missing for your Electron version - it is for Electron 44 today, so the
  source compile runs and CLT is effectively required)

## Build

```bash
# one-time
cd apps/desktop && npm install
cd ../farm && npm install && cd ../desktop

# unpacked app (release/mac-arm64/Octagon.app) + all gates
npm run build:app

# DMG + ZIP (release/) + packaged gates
npm run dist
```

`build:app` runs: dashboard `next build` (output:"standalone") -> copy
standalone + farm into apps/desktop -> rebuild better-sqlite3 for the Electron
ABI (with a hard require-gate) -> `electron-builder --dir`.

`dist` additionally builds `release/Octagon-<version>-arm64.dmg` and `.zip`,
then runs `gate:packaged`:

1. **sqlite ABI gate** - runs the packaged Electron binary with
   `ELECTRON_RUN_AS_NODE=1` and requires better-sqlite3 from BOTH bundled
   copies; an in-memory `CREATE TABLE` must succeed (exit 0). This exists
   because the failure mode of a missed rebuild is a `NODE_MODULE_VERSION`
   crash on first use.
2. **packaged smoke** - runs the packaged app with `OCTAGON_SMOKE=1`; the main
   process boots the server + window, prints the page title, exits 0.

## Scripts

| script | what it does |
| --- | --- |
| `npm run dev` | Electron shell against a dev server: start the dashboard separately (`cd apps/dashboard && npm run dev`), then run this. Loads `NEXT_DEV_URL` (default `http://localhost:3010`); hub still runs against `<userData>/farm.db`. |
| `npm run smoke` | unpackaged CI-style smoke: boots bundled server + window, 5s watchdog prints page title via `executeJavaScript`, exits 0. |
| `npm run smoke:packaged` | same against `release/mac-arm64/Octagon.app`. |
| `npm run gate:packaged` | sqlite ABI gate + packaged smoke (used by `dist`). |
| `npm run build:app` / `npm run dist` | see above. |

## Runtime behavior

- **Single instance**: `app.requestSingleInstanceLock()`; a second launch
  focuses the existing window.
- **Window**: `titleBarStyle: "hiddenInset"`, `trafficLightPosition {16,16}`,
  `backgroundColor #0B0E12`, min 1100x700, fullscreenable, no native tabbing
  (no `tabbingIdentifier`). Bounds persist in `<userData>/bounds.json` and are
  clamped back on-screen on restore.
- **Cmd+W** closes the window only: the app and the hub keep running ("Octagon
  keeps running in the background" note in the Window menu); the dock icon
  stays and clicking it reopens the window.
- **Cmd+Q** full quit: SIGTERM to both children, 5s bounded wait, then SIGKILL,
  then `app.exit(0)`.
- **Hub**: spawned with `ELECTRON_RUN_AS_NODE=1` and `process.execPath`
  (Electron binary as node), args `--slots=4 --duration=60`,
  `FARM_DB_PATH=<userData>/farm.db`. Unexpected exits restart with backoff
  (2s/4s/6s + jitter), max 3, then it gives up and logs.
- **Next server**: standalone `server.js` runs as a child process (also
  `ELECTRON_RUN_AS_NODE=1`) - never required into the main process. Port is a
  random free port on `127.0.0.1`; the window loads only after `/api/health`
  answers. Unexpected exits restart like the hub.
- **Menu**: App (About, Settings… Cmd+, -> `webContents.send('open-settings')`,
  Quit), Edit (standard roles), View (reload, zoom, devtools unpackaged/dev
  only), Window (Minimize, Close + the background note), Help (Open Data
  Folder).
- **Security**: `contextIsolation`, `sandbox`, `nodeIntegration: false`,
  `webSecurity: true` (do not disable - it is what makes the 127.0.0.1 origin
  safe), `setWindowOpenHandler` denies and forwards external http(s) links to
  the default browser; `will-navigate` is pinned to the app origin.

## Environment the shell sets for the bundled server

| var | value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` / `HOSTNAME` | random free port / `127.0.0.1` |
| `FARM_DB_PATH` | `<userData>/farm.db` (`~/Library/Application Support/Octagon/`) |
| `OCTAGON_DESKTOP` | `1` - **auth contract**: the dashboard middleware is expected to honor this env for the desktop app. Until that lands, production auth applies as-is (see below). |
| `NEXTAUTH_URL` | `http://127.0.0.1:<port>` |
| `NEXTAUTH_SECRET` | generated once, persisted at `<userData>/nextauth-secret.txt` (0600) |
| `DASHBOARD_ADMIN_USER` / `DASHBOARD_ADMIN_PASSWORD` | pass through from your environment if you set both; otherwise a local pair is generated on first run and stored at `<userData>/local-admin.json` (0600). The server's instrumentation hook refuses to boot in production without these. |

## Signing / Gatekeeper (read before distributing)

The app is **ad-hoc signed** (`codesign --force --deep --sign -`, done by
`scripts/after-sign.js`, then verified with
`codesign --verify --deep --strict`). Notarization is **impossible** without a
paid ($99/yr) Apple Developer account - there is no way around that, so on
other machines Gatekeeper will warn.

On macOS Sequoia 15+ the old right-click-Open bypass is **removed**. The
first-launch path is:

1. Drag `Octagon.app` to `/Applications` first (avoids App Translocation).
2. Open it once -> you get "cannot be opened" -> Done.
3. System Settings -> Privacy & Security -> scroll to the Octagon message ->
   **Open Anyway** -> Open.
4. Or, from the terminal:
   `xattr -dr com.apple.quarantine /Applications/Octagon.app`
   (only for an app you built locally or otherwise trust).

## Notes / gotchas (see also KNOWN-ISSUES.md)

- **electron-builder drops node_modules from extraResources** because it
  respects the repo root .gitignore (`node_modules/` matches); explicit
  `filter:` patterns do not override it. `scripts/after-pack.js` re-injects
  `standalone/node_modules` and `farm/node_modules` into the bundle before
  signing.
- **better-sqlite3 Electron ABI**: better-sqlite3 v12.11.1 publishes no
  electron prebuild for Electron 44 (ABI 149; the GitHub release 404s), so
  `rebuild-native.js` compiles from source via `@electron/rebuild`. Next.js
  output tracing strips `binding.gyp`/`src`/`deps` from the standalone copy,
  so the binary is built once from the farm copy (complete npm tree) and
  copied over after a strict version-equality check.
- The standalone build uses the **flattened** layout (`standalone/server.js`)
  because the repo has no npm workspace root; the code also handles the
  `standalone/apps/dashboard/server.js` layout for when that changes.
- `next.config.ts` carries `output: "standalone"` (required for all of this)
  while keeping `serverExternalPackages: ["better-sqlite3"]` and all security
  headers.
