/**
 * after-sign.cjs
 *
 * electron-builder afterSign hook — runs AFTER electron-builder finishes all
 * signing steps (including its own codesign pass).
 *
 * Problem: adhoc-signed macOS apps get a designated requirement of
 *   "cdhash H\"<hash>\""
 * which is unique per build. ShipIt (Squirrel.Mac) validates the new app
 * against the installed app's designated requirement, so every update fails
 * with "代码未能满足指定的代码要求".
 *
 * Fix: re-sign ONLY the main executable with an identifier-based designated
 * requirement. Do NOT use --deep as it breaks Electron Framework signatures.
 */

const { execSync } = require('child_process');
const { join } = require('path');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') return;

  const appName = packager.appInfo.productFilename;
  const appId = packager.appInfo.id;
  const appPath = join(appOutDir, `${appName}.app`);
  const req = `designated => identifier "${appId}"`;

  try {
    // Sign only the top-level app bundle (no --deep) to avoid breaking
    // Electron Framework's Team ID requirement
    execSync(
      `echo '${req}' | codesign --sign - --force --timestamp=none --options runtime --requirements - "${appPath}"`,
      { stdio: 'pipe' }
    );
    console.log(`[after-sign] ✅ Re-signed ${appName}.app with identifier requirement: ${appId}`);

    // Verify
    const result = execSync(`codesign -d --requirements - "${appPath}" 2>&1`).toString().trim();
    console.log(`[after-sign] Verified: ${result}`);
  } catch (e) {
    console.warn(`[after-sign] ⚠️  Re-sign failed: ${e.message}`);
  }
};
