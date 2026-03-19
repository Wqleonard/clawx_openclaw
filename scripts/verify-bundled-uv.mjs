#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

const PLATFORM_TARGETS = {
  win: ['win32-x64', 'win32-arm64'],
  mac: ['darwin-x64', 'darwin-arm64'],
  linux: ['linux-x64', 'linux-arm64'],
};

const BINARY_NAME = {
  win32: 'uv.exe',
  darwin: 'uv',
  linux: 'uv',
};

function parseArgs() {
  const arg = process.argv.find((item) => item.startsWith('--platform='));
  if (!arg) {
    return null;
  }
  return arg.split('=')[1];
}

function getExpectedBinaryPath(targetId) {
  const platform = targetId.split('-')[0];
  const binName = BINARY_NAME[platform];
  return path.join(OUTPUT_BASE, targetId, binName);
}

function main() {
  const platform = parseArgs();

  if (!platform || !PLATFORM_TARGETS[platform]) {
    console.error('Usage: node scripts/verify-bundled-uv.mjs --platform=<win|mac|linux>');
    process.exit(1);
  }

  const targets = PLATFORM_TARGETS[platform];
  const missing = [];

  for (const targetId of targets) {
    const binPath = getExpectedBinaryPath(targetId);
    if (!existsSync(binPath)) {
      missing.push(binPath);
    }
  }

  if (missing.length > 0) {
    console.error(`[verify-bundled-uv] Missing uv binary files for platform "${platform}":`);
    for (const missingPath of missing) {
      console.error(`  - ${missingPath}`);
    }
    console.error(`[verify-bundled-uv] Fix by running: pnpm run uv:download:${platform}`);
    process.exit(1);
  }

  console.log(`[verify-bundled-uv] OK: all uv binaries exist for platform "${platform}"`);
}

main();
