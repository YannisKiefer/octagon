'use strict';
// electron-builder afterSign hook: ad-hoc sign the .app (identity "-") and
// verify. Unsigned arm64 bundles risk macOS "damaged and can't be opened";
// an ad-hoc signature is enough to run locally (no Developer ID, so no
// notarization - see README.md, Gatekeeper section).
//
// electron-builder v26 (latest published) has no `mac.sign.identity` option,
// so `identity: null` skips its signing and this hook does it deterministically.

const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  console.log(`[after-sign] ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });

  console.log('[after-sign] verifying (codesign --verify --deep --strict)');
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log('[after-sign] ok');
};
