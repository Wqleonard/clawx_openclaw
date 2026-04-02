#!/usr/bin/env zx

import 'zx/globals';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  cpSync,
  writeFileSync,
  lstatSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  chmodSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');
const TMP_ROOT = join(ROOT, 'build', '.tmp-preinstalled-skills');
const LOCAL_PREINSTALLED_SKILLS_ROOT = join(ROOT, 'resources', 'preinstalled-skills');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeVersion(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  const seenSlugs = new Set();
  const normalized = [];
  for (const item of parsed.skills) {
    const slug = typeof item?.slug === 'string' ? item.slug.trim() : '';
    if (!slug) {
      throw new Error(`Invalid manifest entry: ${JSON.stringify(item)}`);
    }

    if (seenSlugs.has(slug)) {
      throw new Error(`Duplicate skill slug in manifest: ${slug}`);
    }
    seenSlugs.add(slug);

    const hasRemoteRepo = isNonEmptyString(item.repo);
    const hasRemoteRepoPath = isNonEmptyString(item.repoPath);
    if (hasRemoteRepo || hasRemoteRepoPath) {
      if (!hasRemoteRepo || !hasRemoteRepoPath) {
        throw new Error(`Invalid manifest entry: ${JSON.stringify(item)}`);
      }
      normalized.push({
        ...item,
        slug,
        repo: item.repo.trim(),
        repoPath: item.repoPath.trim(),
        ref: normalizeVersion(item.ref, 'main'),
        sourceType: 'remote',
      });
      continue;
    }

    normalized.push({
      ...item,
      slug,
      localPath: isNonEmptyString(item.localPath) ? item.localPath.trim() : undefined,
      sourceType: 'local',
    });
  }
  return normalized;
}

function groupByRepoRef(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const ref = entry.ref || 'main';
    const key = `${entry.repo}#${ref}`;
    if (!grouped.has(key)) grouped.set(key, { repo: entry.repo, ref, entries: [] });
    grouped.get(key).entries.push(entry);
  }
  return [...grouped.values()];
}

function createRepoDirName(repo, ref) {
  return `${repo.replace(/[\\/]/g, '__')}__${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function toGitPath(inputPath) {
  if (process.platform !== 'win32') return inputPath;
  // Git on Windows accepts forward slashes and avoids backslash escape quirks.
  return inputPath.replace(/\\/g, '/');
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function resolveLocalSourceDir(entry) {
  if (entry.localPath) {
    return join(ROOT, entry.localPath);
  }
  return join(LOCAL_PREINSTALLED_SKILLS_ROOT, entry.slug);
}

function shouldCopySkillFile(srcPath) {
  const base = basename(srcPath);
  if (base === '.git') return false;
  if (base === '.subset.tar') return false;
  return true;
}

function removeDirSafe(dirPath) {
  if (!existsSync(dirPath)) return;
  for (const entry of readdirSync(dirPath)) {
    const fullPath = join(dirPath, entry);
    const stat = lstatSync(fullPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      removeDirSafe(fullPath);
      continue;
    }
    try {
      chmodSync(fullPath, 0o666);
    } catch {
      // Ignore chmod errors and still try unlink.
    }
    unlinkSync(fullPath);
  }
  try {
    chmodSync(dirPath, 0o777);
  } catch {
    // Ignore chmod errors and still try rmdir.
  }
  rmdirSync(dirPath);
}

async function extractArchive(archiveFileName, cwd) {
  const prevCwd = $.cwd;
  $.cwd = cwd;
  try {
    try {
      await $`tar -xf ${archiveFileName}`;
      return;
    } catch (tarError) {
      if (process.platform === 'win32') {
        // Some Windows images expose bsdtar instead of tar.
        await $`bsdtar -xf ${archiveFileName}`;
        return;
      }
      throw tarError;
    }
  } finally {
    $.cwd = prevCwd;
  }
}

async function fetchSparseRepo(repo, ref, paths, checkoutDir) {
  const remote = `https://github.com/${repo}.git`;
  mkdirSync(checkoutDir, { recursive: true });
  const gitCheckoutDir = toGitPath(checkoutDir);
  const archiveFileName = '.subset.tar';
  const archivePath = join(checkoutDir, archiveFileName);
  const archivePaths = [...new Set(paths.map(normalizeRepoPath))];

  await $`git init ${gitCheckoutDir}`;
  await $`git -C ${gitCheckoutDir} remote add origin ${remote}`;
  await $`git -C ${gitCheckoutDir} fetch --depth 1 origin ${ref}`;
  // Do not checkout working tree on Windows: upstream repos may contain
  // Windows-invalid paths. Export only requested directories via git archive.
  await $`git -C ${gitCheckoutDir} archive --format=tar --output ${archiveFileName} FETCH_HEAD ${archivePaths}`;
  await extractArchive(archiveFileName, checkoutDir);
  rmSync(archivePath, { force: true });

  const commit = (await $`git -C ${gitCheckoutDir} rev-parse FETCH_HEAD`).stdout.trim();
  return commit;
}

echo`Bundling preinstalled skills...`;

if (process.env.SKIP_PREINSTALLED_SKILLS === '1') {
  echo`⏭  SKIP_PREINSTALLED_SKILLS=1 set, skipping skills fetch.`;
  process.exit(0);
}

const manifestSkills = loadManifest();

removeDirSafe(OUTPUT_ROOT);
mkdirSync(OUTPUT_ROOT, { recursive: true });
removeDirSafe(TMP_ROOT);
mkdirSync(TMP_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  skills: [],
};

const remoteManifestSkills = manifestSkills.filter((entry) => entry.sourceType === 'remote');
const localManifestSkills = manifestSkills.filter((entry) => entry.sourceType === 'local');

const groups = groupByRepoRef(remoteManifestSkills);
for (const group of groups) {
  const repoDir = join(TMP_ROOT, createRepoDirName(group.repo, group.ref));
  const sparsePaths = [...new Set(group.entries.map((entry) => entry.repoPath))];

  echo`Fetching ${group.repo} @ ${group.ref}`;
  const commit = await fetchSparseRepo(group.repo, group.ref, sparsePaths, repoDir);
  echo`   commit ${commit}`;

  for (const entry of group.entries) {
    const sourceDir = join(repoDir, entry.repoPath);
    const targetDir = join(OUTPUT_ROOT, entry.slug);

    if (!existsSync(sourceDir)) {
      throw new Error(`Missing source path in repo checkout: ${entry.repoPath}`);
    }

    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

    const skillManifest = join(targetDir, 'SKILL.md');
    if (!existsSync(skillManifest)) {
      throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
    }

    const requestedVersion = (entry.version || '').trim();
    const resolvedVersion = !requestedVersion || requestedVersion === 'main'
      ? commit
      : requestedVersion;
    lock.skills.push({
      slug: entry.slug,
      version: resolvedVersion,
      repo: entry.repo,
      repoPath: entry.repoPath,
      ref: group.ref,
      commit,
    });

    echo`   OK ${entry.slug}`;
  }
}

for (const entry of localManifestSkills) {
  const sourceDir = resolveLocalSourceDir(entry);
  const targetDir = join(OUTPUT_ROOT, entry.slug);

  if (!existsSync(sourceDir)) {
    throw new Error(`Missing local preinstalled skill source: ${sourceDir}`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

  const skillManifest = join(targetDir, 'SKILL.md');
  if (!existsSync(skillManifest)) {
    throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
  }

  const resolvedVersion = normalizeVersion(entry.version, 'local');
  lock.skills.push({
    slug: entry.slug,
    version: resolvedVersion,
    source: 'local',
  });

  echo`   OK ${entry.slug} (local)`;
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
removeDirSafe(TMP_ROOT);
echo`Preinstalled skills ready: ${OUTPUT_ROOT}`;
