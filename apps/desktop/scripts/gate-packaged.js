#!/usr/bin/env node
'use strict';
// CI-style gates against the PACKAGED app (release/mac-arm64/Octagon.app):
//   1. sqlite ABI gate: run the packaged Electron binary as node and require
//      better-sqlite3 from BOTH bundled copies (standalone + farm); an
//      in-memory CREATE TABLE must succeed (exit 0).
//   2. app smoke: run the packaged app with OCTAGON_SMOKE=1; it must print a
//      page title and exit 0.
// Run after `npm run build:app`. Exits non-zero on any failure.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const DESKTOP = path.join(__dirname, '..');
const APP = path.join(DESKTOP, 'release', 'mac-arm64', 'Octagon.app');
const BIN = path.join(APP, 'Contents', 'MacOS', 'Octagon');
const RES = path.join(APP, 'Contents', 'Resources');

function die(msg) {
  console.error(`[gate-packaged] FAIL: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(BIN)) die(`packaged app not found at ${APP} - run npm run build:app first`);

// 1. sqlite ABI gate on both bundled copies
for (const copy of ['standalone', 'farm']) {
  const mod = path.join(RES, copy, 'node_modules', 'better-sqlite3');
  if (!fs.existsSync(mod)) die(`${copy}: better-sqlite3 missing under ${RES}`);
  const script = `const D=require(${JSON.stringify(mod)});
const db=new D(':memory:'); db.exec('CREATE TABLE t(a)');
db.prepare('INSERT INTO t VALUES (1)').run();
if (db.prepare('SELECT COUNT(*) c FROM t').get().c !== 1) process.exit(1);
console.log('${copy}: sqlite ABI ok', process.versions.modules, process.arch);`;
  const r = spawnSync(BIN, ['-e', script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) die(`${copy}: better-sqlite3 does not load in the packaged app (NODE_MODULE_VERSION mismatch?)`);
}

// 2. packaged app smoke (boots server + window, prints page title, exits 0)
const smoke = spawnSync(BIN, [], {
  env: { ...process.env, OCTAGON_SMOKE: '1' },
  encoding: 'utf8',
  timeout: 120000,
});
process.stdout.write(smoke.stdout || '');
process.stderr.write(smoke.stderr || '');
if (smoke.error) die(`smoke failed to run: ${smoke.error.message}`);
if (smoke.status !== 0) die(`smoke exited ${smoke.status}`);
if (!/smoke page title:/.test(smoke.stdout || '')) die('smoke did not report a page title');

console.log('[gate-packaged] PASS: sqlite ABI gate + packaged smoke');
