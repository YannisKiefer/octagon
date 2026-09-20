#!/usr/bin/env node
'use strict';
// Copies the packaging resources into apps/desktop for electron-builder and
// for unpackaged `electron .` runs:
//   standalone/  <- apps/dashboard/.next/standalone (+ .next/static, public)
//   farm/        <- infra/farm (hub.js, farm-brain.js, node_modules)
// Run scripts/rebuild-native.js afterwards: the copied better-sqlite3 builds
// must be recompiled for the Electron ABI.

const fs = require('fs');
const path = require('path');

const DESKTOP = __dirname ? path.join(__dirname, '..') : process.cwd();
const ROOT = path.join(DESKTOP, '..', '..');
const DASHBOARD = path.join(ROOT, 'apps', 'dashboard');
const FARM = path.join(ROOT, 'infra', 'farm');

const STANDALONE_SRC = path.join(DASHBOARD, '.next', 'standalone');
const STANDALONE_DST = path.join(DESKTOP, 'standalone');
const FARM_DST = path.join(DESKTOP, 'farm');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function cp(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: false });
}

function fail(msg) {
  console.error(`[prepare-resources] ERROR: ${msg}`);
  process.exit(1);
}

// 1. standalone Next server
// Next emits a flattened layout (standalone/server.js) when the app is not in
// an npm workspace, and a monorepo layout (standalone/apps/dashboard/server.js)
// when outputFileTracingRoot is the repo root. Support both.
const FLAT_SERVER = path.join(STANDALONE_SRC, 'server.js');
const MONO_SERVER = path.join(STANDALONE_SRC, 'apps', 'dashboard', 'server.js');
const APP_REL = fs.existsSync(MONO_SERVER) ? path.join('apps', 'dashboard') : '.';
const SERVER = path.join(STANDALONE_SRC, APP_REL, 'server.js');
if (!fs.existsSync(SERVER)) {
  fail(`missing ${SERVER} - run: cd apps/dashboard && NEXT_TELEMETRY_DISABLED=1 npm run build (requires output:"standalone" in next.config.ts)`);
}
console.log(`[prepare-resources] copying standalone server (layout: ${APP_REL === '.' ? 'flat' : 'monorepo'})...`);
rmrf(STANDALONE_DST);
cp(STANDALONE_SRC, STANDALONE_DST);
// Next.js docs: standalone does not include .next/static and public - copy by hand.
cp(path.join(DASHBOARD, '.next', 'static'), path.join(STANDALONE_DST, APP_REL, '.next', 'static'));
cp(path.join(DASHBOARD, 'public'), path.join(STANDALONE_DST, APP_REL, 'public'));

// 2. farm runtime (copy, then rebuild the copy - never mutate infra/farm)
if (!fs.existsSync(path.join(FARM, 'hub.js'))) fail(`missing ${FARM}/hub.js`);
if (!fs.existsSync(path.join(FARM, 'node_modules', 'better-sqlite3'))) {
  fail(`missing ${FARM}/node_modules/better-sqlite3 - run: cd infra/farm && npm install`);
}
console.log('[prepare-resources] copying farm runtime...');
rmrf(FARM_DST);
cp(FARM, FARM_DST);

// 3. strip absolute symlinks (e.g. npm's absolute .bin links back into
// infra/farm). They would break `codesign --deep` ("invalid destination for
// symbolic link in bundle") and would dangle in any installed app. Nothing
// at runtime executes .bin shims.
function stripAbsoluteSymlinks(dir) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      if (path.isAbsolute(fs.readlinkSync(p))) { fs.unlinkSync(p); removed++; }
    } else if (entry.isDirectory()) {
      removed += stripAbsoluteSymlinks(p);
    }
  }
  return removed;
}
const removed = stripAbsoluteSymlinks(STANDALONE_DST) + stripAbsoluteSymlinks(FARM_DST);
if (removed) console.log(`[prepare-resources] removed ${removed} absolute symlink(s) from copies`);

console.log('[prepare-resources] done. next: npm run rebuild:native');
