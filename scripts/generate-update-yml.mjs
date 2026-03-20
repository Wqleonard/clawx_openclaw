#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return args;
}

function compareSemver(a, b) {
  const parse = (v) => {
    const core = v.split('-')[0];
    return core.split('.').map((n) => Number.parseInt(n, 10) || 0);
  };
  const av = parse(a);
  const bv = parse(b);
  const length = Math.max(av.length, bv.length);
  for (let i = 0; i < length; i++) {
    const diff = (av[i] || 0) - (bv[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function pickNewestVersion(versions) {
  if (versions.length === 0) return null;
  return versions.sort(compareSemver).at(-1) || null;
}

async function getFileMeta(filePath) {
  const [buffer, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
  const sha512 = createHash('sha512').update(buffer).digest('base64');
  return { sha512, size: stat.size };
}

function toYaml({ version, files, pathValue, topSha512, releaseDate }) {
  const lines = [`version: ${version}`, 'files:'];
  for (const file of files) {
    lines.push(`  - url: ${file.url}`);
    lines.push(`    sha512: ${file.sha512}`);
    lines.push(`    size: ${file.size}`);
  }
  lines.push(`path: ${pathValue}`);
  lines.push(`sha512: ${topSha512}`);
  lines.push(`releaseDate: '${releaseDate}'`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseDir = path.resolve(
    PROJECT_ROOT,
    typeof args['release-dir'] === 'string' ? args['release-dir'] : 'release',
  );
  const outputDir = path.resolve(
    PROJECT_ROOT,
    typeof args['output-dir'] === 'string' ? args['output-dir'] : 'document/update-yml-templates',
  );
  const channel = typeof args.channel === 'string' ? args.channel : 'latest';
  const explicitVersion = typeof args.version === 'string' ? args.version : null;

  const fileNames = await fs.readdir(releaseDir);

  const knownMacVersions = new Set();
  const knownWinVersions = new Set();
  for (const name of fileNames) {
    let m;
    if ((m = name.match(/^StoryClaw-(.+)-mac-x64\.zip$/))) knownMacVersions.add(m[1]);
    if ((m = name.match(/^StoryClaw-(.+)-mac-arm64\.zip$/))) knownMacVersions.add(m[1]);
    if ((m = name.match(/^StoryClaw-(.+)-win-x64\.exe$/))) knownWinVersions.add(m[1]);
    if ((m = name.match(/^StoryClaw-(.+)-win-arm64\.exe$/))) knownWinVersions.add(m[1]);
  }

  const macVersion = explicitVersion || pickNewestVersion([...knownMacVersions]);
  const winVersion = explicitVersion || pickNewestVersion([...knownWinVersions]);

  if (!macVersion && !winVersion) {
    throw new Error(`No release artifacts found in ${releaseDir}`);
  }

  const macX64Zip = macVersion ? `StoryClaw-${macVersion}-mac-x64.zip` : null;
  const macArm64Zip = macVersion ? `StoryClaw-${macVersion}-mac-arm64.zip` : null;
  const winX64Exe = winVersion ? `StoryClaw-${winVersion}-win-x64.exe` : null;
  const winArm64Exe = winVersion ? `StoryClaw-${winVersion}-win-arm64.exe` : null;

  const hasMac = !!(macX64Zip && macArm64Zip && fileNames.includes(macX64Zip) && fileNames.includes(macArm64Zip));
  const hasWin = !!(winX64Exe && winArm64Exe && fileNames.includes(winX64Exe) && fileNames.includes(winArm64Exe));

  if (!hasMac && !hasWin) {
    throw new Error(`No mac or win release artifacts found in ${releaseDir}`);
  }

  const macX64DmgName = macVersion ? `StoryClaw-${macVersion}-mac-x64.dmg` : null;
  const macArm64DmgName = macVersion ? `StoryClaw-${macVersion}-mac-arm64.dmg` : null;
  const winUniversalName = winVersion ? `StoryClaw-${winVersion}-win.exe` : null;

  const releaseDate = new Date().toISOString();
  const written = [];

  await fs.mkdir(outputDir, { recursive: true });

  if (hasMac) {
    const [macX64ZipMeta, macArm64ZipMeta] = await Promise.all([
      getFileMeta(path.join(releaseDir, macX64Zip)),
      getFileMeta(path.join(releaseDir, macArm64Zip)),
    ]);
    const macFiles = [
      { url: macX64Zip, ...macX64ZipMeta },
      { url: macArm64Zip, ...macArm64ZipMeta },
    ];
    if (macX64DmgName && fileNames.includes(macX64DmgName)) {
      macFiles.push({ url: macX64DmgName, ...await getFileMeta(path.join(releaseDir, macX64DmgName)) });
    }
    if (macArm64DmgName && fileNames.includes(macArm64DmgName)) {
      macFiles.push({ url: macArm64DmgName, ...await getFileMeta(path.join(releaseDir, macArm64DmgName)) });
    }
    const macOutputPath = path.join(outputDir, `${channel}-mac.yml`);
    await fs.writeFile(macOutputPath, toYaml({
      version: macVersion,
      files: macFiles,
      pathValue: macArm64Zip,
      topSha512: macArm64ZipMeta.sha512,
      releaseDate,
    }), 'utf8');
    written.push(path.relative(PROJECT_ROOT, macOutputPath));
  }

  if (hasWin) {
    const [winX64Meta, winArm64Meta] = await Promise.all([
      getFileMeta(path.join(releaseDir, winX64Exe)),
      getFileMeta(path.join(releaseDir, winArm64Exe)),
    ]);
    const winFiles = [
      { url: winX64Exe, ...winX64Meta },
      { url: winArm64Exe, ...winArm64Meta },
    ];
    if (winUniversalName && fileNames.includes(winUniversalName)) {
      winFiles.push({ url: winUniversalName, ...await getFileMeta(path.join(releaseDir, winUniversalName)) });
    }
    const winOutputPath = path.join(outputDir, `${channel}.yml`);
    await fs.writeFile(winOutputPath, toYaml({
      version: winVersion,
      files: winFiles,
      pathValue: winX64Exe,
      topSha512: winX64Meta.sha512,
      releaseDate,
    }), 'utf8');
    written.push(path.relative(PROJECT_ROOT, winOutputPath));
  }

  console.log(`[update-yml] mac=${macVersion ?? 'none'} win=${winVersion ?? 'none'} channel=${channel}`);
  for (const p of written) console.log(`[update-yml] wrote ${p}`);
}

main().catch((error) => {
  console.error('[update-yml] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
