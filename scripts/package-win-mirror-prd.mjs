import { execSync } from 'node:child_process';

const buildMode = (process.env.BUILD_MODE || 'prd').trim().toLowerCase();
const packageScript = buildMode === 'dev' ? 'package:win:dev' : 'package:win';

const env = {
  ...process.env,
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

console.log(`[win-mirror] build mode: ${buildMode} -> ${packageScript}`);
execSync(`pnpm run ${packageScript}`, { stdio: 'inherit', env });
execSync('node scripts/generate-update-yml.mjs --output-dir release', { stdio: 'inherit', env });
