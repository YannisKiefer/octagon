#!/usr/bin/env node
'use strict';
// Rebuilds better-sqlite3 inside the packaging copies (standalone/, farm/) for
// the Electron ABI. The original infra/farm and apps/dashboard node_modules
// are left untouched - only apps/desktop copies are modified.
//
// Why: Node and Electron have different ABIs (NODE_MODULE_VERSION). A
// better-sqlite3 build for the system Node fails inside Electron with
// "was compiled against a different Node.js version".
//
// Strategy (fast path first, then verified fallback):
//   1. prebuild-install -r electron -t <electronVersion>
//      (works when upstream publishes an electron prebuild for this ABI;
//       as of better-sqlite3 v12.11.1 + electron 44/ABI 149 there is none -
//       GitHub release 404s - so this usually skips)
//   2. @electron/rebuild, compiling from source:
//        - farm/ has a complete npm tree (binding.gyp, src, deps) -> rebuilds
//          in place.
//        - standalone/ CANNOT compile in place: Next.js output tracing prunes
//          binding.gyp/src/deps from better-sqlite3. If both copies ship the
//          same better-sqlite3 version we copy the electron-ABI binary built
//          for farm/ over; on a version mismatch we fail loudly.
//   3. Hard gate: every copy is require-tested under the Electron binary
//      (ELECTRON_RUN_AS_NODE=1) with an in-memory CREATE TABLE.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const DESKTOP = path.join(__dirname, '..');
const electronVersion = require(path.join(DESKTOP, 'node_modules', 'electron', 'package.json')).version;
const electronBin = path.join(DESKTOP, 'node_modules', '.bin', 'electron');

const FARM = path.join(DESKTOP, 'farm');
const STANDALONE = path.join(DESKTOP, 'standalone');

function run(cmd, args, cwd, extraEnv) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: extraEnv ? { ...process.env, ...extraEnv } : process.env });
  return r.status === 0;
}

function moduleDir(copy) {
  return path.join(copy, 'node_modules', 'better-sqlite3');
}

function sqliteVersion(copy) {
  return require(path.join(moduleDir(copy), 'package.json')).version;
}

// 1. prebuilt electron binary (better-sqlite3 v12 ships electron prebuilds).
//    Next's output tracing prunes prebuild-install from the standalone copy,
//    so we use the one installed in apps/desktop and point cwd at moduleDir.
function tryPrebuilt(copy) {
  const prebuildBin = path.join(DESKTOP, 'node_modules', '.bin', 'prebuild-install');
  if (!fs.existsSync(prebuildBin)) return false;
  console.log(`[rebuild-native] trying prebuild-install (electron ${electronVersion}) in ${moduleDir(copy)}`);
  return run(prebuildBin, ['-r', 'electron', '-t', electronVersion], moduleDir(copy));
}

// 2. compile from source for the electron ABI (needs a tree with binding.gyp)
async function electronRebuild(copy) {
  const { rebuild } = require('@electron/rebuild');
  await rebuild({
    buildPath: copy,
    electronVersion,
    arch: process.arch,
    onlyModules: ['better-sqlite3'],
    force: true,
  });
}

function copyBuiltBinary(fromCopy, toCopy) {
  const src = path.join(moduleDir(fromCopy), 'build', 'Release', 'better_sqlite3.node');
  const dst = path.join(moduleDir(toCopy), 'build', 'Release', 'better_sqlite3.node');
  fs.copyFileSync(src, dst);
  console.log(`[rebuild-native] copied electron-ABI binary: ${path.relative(DESKTOP, src)} -> ${path.relative(DESKTOP, dst)}`);
}

// 3. hard gate: the binary must load under the Electron binary as node
function verifyUnderElectron(copy) {
  const script = `const D=require(${JSON.stringify(path.join(moduleDir(copy), ''))});
const db=new D(':memory:'); db.exec('CREATE TABLE t(a)');
db.prepare('INSERT INTO t VALUES (1)').run();
if (db.prepare('SELECT COUNT(*) c FROM t').get().c !== 1) process.exit(1);
console.log('sqlite ABI ok:', process.versions.modules, process.arch);`;
  return run(electronBin, ['-e', script], DESKTOP, { ELECTRON_RUN_AS_NODE: '1' });
}

(async () => {
  for (const copy of [FARM, STANDALONE]) {
    if (!fs.existsSync(moduleDir(copy))) {
      console.error(`[rebuild-native] ERROR: ${moduleDir(copy)} missing - run npm run prepare:resources first`);
      process.exit(1);
    }
  }

  // farm: complete npm tree -> prebuild or compile in place
  if (!tryPrebuilt(FARM)) {
    console.log(`[rebuild-native] compiling better-sqlite3 for electron ${electronVersion} (farm copy)...`);
    await electronRebuild(FARM);
  }

  // standalone: pruned tree -> reuse the farm binary (same version required)
  if (!tryPrebuilt(STANDALONE)) {
    const farmV = sqliteVersion(FARM);
    const saV = sqliteVersion(STANDALONE);
    if (farmV !== saV) {
      console.error(`[rebuild-native] ERROR: better-sqlite3 version mismatch (farm ${farmV} vs standalone ${saV}); cannot reuse the compiled binary. Align both packages on the same version, or compile the standalone copy from a full tree.`);
      process.exit(1);
    }
    copyBuiltBinary(FARM, STANDALONE);
  }

  // 3. hard gate on both copies
  for (const copy of [FARM, STANDALONE]) {
    console.log(`[rebuild-native] verifying ${path.relative(DESKTOP, copy)} under electron-as-node...`);
    if (!verifyUnderElectron(copy)) {
      console.error(`[rebuild-native] ERROR: better-sqlite3 in ${path.relative(DESKTOP, copy)} does NOT load under electron ${electronVersion} (ABI mismatch).`);
      process.exit(1);
    }
  }
  console.log('[rebuild-native] all copies verified: better-sqlite3 loads under electron (in-memory CREATE TABLE ok)');
})().catch((err) => {
  console.error('[rebuild-native] ERROR:', err && err.stack ? err.stack : err);
  process.exit(1);
});
