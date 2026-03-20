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

  const knownVersions = new Set();
  const versionRegexes = [
    /^StoryClaw-(.+)-win-x64\.exe$/,
    /^StoryClaw-(.+)-win-arm64\.exe$/,
    /^StoryClaw-(.+)-mac-x64\.zip$/,
    /^StoryClaw-(.+)-mac-arm64\.zip$/,
  ];
  for (const name of fileNames) {
    for (const regex of versionRegexes) {
      const matched = name.match(regex);
      if (matched?.[1]) knownVersions.add(matched[1]);
    }
  }

  const version = explicitVersion || pickNewestVersion([...knownVersions]);
  if (!version) {
    throw new Error(`No release artifacts found in ${releaseDir}`);
  }

  const required = {
    winX64: `StoryClaw-${version}-win-x64.exe`,
    winArm64: `StoryClaw-${version}-win-arm64.exe`,
    macX64Zip: `StoryClaw-${version}-mac-x64.zip`,
    macArm64Zip: `StoryClaw-${version}-mac-arm64.zip`,
  };

  for (const fileName of Object.values(required)) {
    if (!fileNames.includes(fileName)) {
      throw new Error(`Missing required release artifact: ${fileName}`);
    }
  }

  const optional = {
    winUniversal: `StoryClaw-${version}-win.exe`,
    macX64Dmg: `StoryClaw-${version}-mac-x64.dmg`,
    macArm64Dmg: `StoryClaw-${version}-mac-arm64.dmg`,
  };

  const hasOptional = {
    winUniversal: fileNames.includes(optional.winUniversal),
    macX64Dmg: fileNames.includes(optional.macX64Dmg),
    macArm64Dmg: fileNames.includes(optional.macArm64Dmg),
  };

  const [winX64Meta, winArm64Meta, macX64ZipMeta, macArm64ZipMeta] = await Promise.all([
    getFileMeta(path.join(releaseDir, required.winX64)),
    getFileMeta(path.join(releaseDir, required.winArm64)),
    getFileMeta(path.join(releaseDir, required.macX64Zip)),
    getFileMeta(path.join(releaseDir, required.macArm64Zip)),
  ]);

  const optionalMeta = {};
  if (hasOptional.winUniversal) {
    optionalMeta.winUniversal = await getFileMeta(path.join(releaseDir, optional.winUniversal));
  }
  if (hasOptional.macX64Dmg) {
    optionalMeta.macX64Dmg = await getFileMeta(path.join(releaseDir, optional.macX64Dmg));
  }
  if (hasOptional.macArm64Dmg) {
    optionalMeta.macArm64Dmg = await getFileMeta(path.join(releaseDir, optional.macArm64Dmg));
  }

  const releaseDate = new Date().toISOString();

  const winFiles = [
    { url: required.winX64, ...winX64Meta },
    { url: required.winArm64, ...winArm64Meta },
  ];
  if (optionalMeta.winUniversal) {
    winFiles.push({ url: optional.winUniversal, ...optionalMeta.winUniversal });
  }

  const macFiles = [
    { url: required.macX64Zip, ...macX64ZipMeta },
    { url: required.macArm64Zip, ...macArm64ZipMeta },
  ];
  if (optionalMeta.macX64Dmg) {
    macFiles.push({ url: optional.macX64Dmg, ...optionalMeta.macX64Dmg });
  }
  if (optionalMeta.macArm64Dmg) {
    macFiles.push({ url: optional.macArm64Dmg, ...optionalMeta.macArm64Dmg });
  }

  const winYaml = toYaml({
    version,
    files: winFiles,
    pathValue: required.winX64,
    topSha512: winX64Meta.sha512,
    releaseDate,
  });

  const macYaml = toYaml({
    version,
    files: macFiles,
    pathValue: required.macX64Zip,
    topSha512: macX64ZipMeta.sha512,
    releaseDate,
  });

  await fs.mkdir(outputDir, { recursive: true });
  const winOutputPath = path.join(outputDir, `${channel}.yml`);
  const macOutputPath = path.join(outputDir, `${channel}-mac.yml`);
  await Promise.all([
    fs.writeFile(winOutputPath, winYaml, 'utf8'),
    fs.writeFile(macOutputPath, macYaml, 'utf8'),
  ]);

  console.log(`[update-yml] version=${version} channel=${channel}`);
  console.log(`[update-yml] wrote ${path.relative(PROJECT_ROOT, winOutputPath)}`);
  console.log(`[update-yml] wrote ${path.relative(PROJECT_ROOT, macOutputPath)}`);
}

main().catch((error) => {
  console.error('[update-yml] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
