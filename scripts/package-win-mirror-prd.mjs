import { execSync } from 'node:child_process';

const env = {
  ...process.env,
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

execSync('pnpm run package:win', { stdio: 'inherit', env });
execSync('node scripts/generate-update-yml.mjs --output-dir release', { stdio: 'inherit', env });
