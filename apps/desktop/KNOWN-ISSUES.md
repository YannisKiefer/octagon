# KNOWN ISSUES - Octagon Desktop Shell

Every item below is a real, reproduced behavior at build time
(2026-09-21, macOS 15.7.3 arm64, Node 26.5.0, Electron 44.4.3,
electron-builder 26.15.3). Nothing here is speculative.

## 1. better-sqlite3 has no Electron prebuild for Electron 44 (ABI 149)

`prebuild-install -r electron -t 44.4.3` against better-sqlite3 v12.11.1
404s:

```
prebuild-install http request GET https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-electron-v149-darwin-arm64.tar.gz
prebuild-install http 404
prebuild-install warn install No prebuilt binaries found (target=44.4.3 runtime=electron arch=arm64 libc= platform=darwin)
```

So `scripts/rebuild-native.js` falls back to `@electron/rebuild` and compiles
from source. Consequences:

- Xcode Command Line Tools are required to build the app (clang).
- If better-sqlite3 is bumped, the compile runs again; the script verifies
  every copy by running the built module under the Electron binary
  (`ELECTRON_RUN_AS_NODE=1`, in-memory `CREATE TABLE`) and fails the build on
  any ABI mismatch.

Also reproduced (the failure mode this protects against): running the
unrebuilded standalone server under the Electron binary boots fine (the
dashboard's instrumentation hook swallows the DB-open error), but every
DB-touching route fails - `/api/health` returns **503**:

```
Error: The module '.../better_sqlite3.node' was compiled against a different
Node.js version using NODE_MODULE_VERSION 147. This version of Node.js
requires NODE_MODULE_VERSION 49... (149)
    code: 'ERR_DLOPEN_FAILED'
```

Repro: `cd apps/desktop && node scripts/prepare-resources.js` (skip
`rebuild:native`) and run the server with `ELECTRON_RUN_AS_NODE=1`.

Related: Next.js output-file tracing **strips `binding.gyp`, `src/` and
`deps/`** from `better-sqlite3` inside `.next/standalone` (it only keeps
runtime files). `@electron/rebuild` therefore reports "No native modules
found" for the standalone copy, and `prebuild-install` is pruned from its
tree as well. The script compiles once from the complete `farm/` tree and
copies the binary over after checking both copies are the same
better-sqlite3 version (it hard-fails on a version mismatch).

## 2. electron-builder silently drops node_modules from extraResources

electron-builder respects the **repo-root .gitignore** when copying
extraResources; the root `.gitignore` `node_modules/` rule matches the bundled
trees, so `standalone/node_modules` and `farm/node_modules` were missing from
the packaged app (reproduced: `Contents/Resources/standalone/` contained only
`package.json`, `public`, `server.js`). Explicit `filter: ["**/*"]` on the
extraResources entries does NOT override this.

Workaround implemented: `scripts/after-pack.js` copies both node_modules trees
into `Octagon.app/Contents/Resources/` after packing; `scripts/after-sign.js`
then ad-hoc signs the final bundle (signing runs after afterPack, so the
injected files are covered by the signature).

## 3. npm leaves absolute symlinks in infra/farm/node_modules/.bin

```
farm/node_modules/.bin/prebuild-install -> /Users/<user>/.../infra/farm/node_modules/prebuild-install/bin.js   (absolute)
```

Copied as-is, `codesign --deep` fails with
`"invalid destination for symbolic link in bundle"` (reproduced during the
first packaged build). `scripts/prepare-resources.js` strips absolute
symlinks from the copies (runtime code never executes `.bin` shims; verified
the packaged app passes all gates afterwards).

## 4. No code signing identity / notarization

Out of scope: no Apple Developer account credentials are available. The app
is ad-hoc signed only (`identity: null` in electron-builder + explicit
`codesign --force --deep --sign -` in after-sign; note electron-builder v26 -
the latest published, v27 with `mac.sign.identity` does not exist yet - has no
native ad-hoc identity option). Verified: `codesign --verify --deep --strict
Octagon.app` passes.

Consequences:

- On machines without the quarantine attribute cleared, Gatekeeper blocks
  first launch; on Sequoia 15+ the right-click-Open bypass is gone - users
  must use System Settings -> Privacy & Security -> Open Anyway (see README).
- Squirrel/electron-updater remain out (they require signed, notarized
  builds). Updates instead ship through the in-app updater: it checks GitHub
  releases and swaps the app bundle from the release DMG - a path that works
  for ad-hoc signed builds.

## 5. Login removed - none required

Earlier builds showed a login page in production. The dashboard is now
local-only open-source software with no login and no accounts; the bundled
server needs no auth environment variables. `OCTAGON_DESKTOP=1` is still set
for the bundled server as a general process marker.

## 6. Not verified in this pass

- Real multi-phone farm sessions (needs physical devices); the hub was
  verified with `--test` (silent dry run) only - boots, spawns the per-phone
  brain, heartbeats, exits cleanly on SIGTERM.
- App menu interactions beyond construction (Settings… IPC, Cmd+W hide, dock
  re-open) were not exercised by automation; the smoke test covers boot,
  server readiness, and page render only. Manual GUI testing recommended.
- x64 / universal builds (arm64 only, per spec).
