import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BAKE_SCRIPT = resolve(ROOT, 'scripts', 'generate-install-reporter-config.mjs');

function parseArgs(argv) {
  const result = {
    mode: '',
    command: '',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--mode' && argv[i + 1]) {
      result.mode = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (current === '--') {
      result.command = argv.slice(i + 1).join(' ').trim();
      break;
    }
  }
  return result;
}

function runNode(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
}

function runCommand(command, env) {
  return spawnSync(command, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: true,
  });
}

const { mode, command } = parseArgs(process.argv);
if (!command) {
  console.error('[install-reporter-bake] missing command, expected: -- "<command>"');
  process.exit(1);
}

const runEnv = {
  ...process.env,
  ...(mode ? { MODE: mode } : {}),
};

console.log(`[install-reporter-bake] start (mode=${mode || 'default'})`);
console.log('[install-reporter-bake] baking installer reporter...');
const bake = runNode([BAKE_SCRIPT], runEnv);
if (bake.status !== 0) {
  console.error(`[install-reporter-bake] bake failed (exit=${bake.status ?? 1})`);
  process.exit(bake.status ?? 1);
}

console.log('[install-reporter-bake] bake done, running build command...');
const commandRun = runCommand(command, runEnv);
const commandStatus = commandRun.status ?? 1;

console.log('[install-reporter-bake] restoring reporter placeholders...');
const restore = runNode([BAKE_SCRIPT, '--restore'], runEnv);
if (restore.status !== 0) {
  console.error(`[install-reporter-bake] restore failed (exit=${restore.status ?? 1})`);
  process.exit(restore.status ?? 1);
}

if (commandStatus === 0) {
  console.log('[install-reporter-bake] build command finished successfully.');
} else {
  console.warn(`[install-reporter-bake] build command failed (exit=${commandStatus}).`);
}
process.exit(commandStatus);
