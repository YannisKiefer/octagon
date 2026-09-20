'use strict';
// electron-builder afterPack hook.
//
// electron-builder respects the repo .gitignore when copying extraResources,
// which silently drops node_modules/ from BOTH bundled trees (it matches the
// root .gitignore). Explicit `filter:` patterns do not override that. So we
// inject the two node_modules trees ourselves here - afterPack runs before
// signing, and scripts/after-sign.js ad-hoc signs whatever we add.

const path = require('path');
const fs = require('fs');

const DESKTOP = path.join(__dirname, '..');

function injectDir(src, dest, label) {
  if (!fs.existsSync(src)) {
    throw new Error(`[after-pack] missing ${label}: ${src} - run npm run prepare:resources && npm run rebuild:native first`);
  }
  console.log(`[after-pack] injecting ${label} into app bundle...`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, dereference: false });
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // appOutDir is the folder CONTAINING the .app
  const appDir = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resources = path.join(appDir, 'Contents', 'Resources');
  injectDir(
    path.join(DESKTOP, 'standalone', 'node_modules'),
    path.join(resources, 'standalone', 'node_modules'),
    'standalone/node_modules',
  );
  injectDir(
    path.join(DESKTOP, 'farm', 'node_modules'),
    path.join(resources, 'farm', 'node_modules'),
    'farm/node_modules',
  );
};
