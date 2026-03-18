#!/usr/bin/env zx

import 'zx/globals';
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const LOCAL_SOURCE_ROOT = join(ROOT, 'resources', 'preinstalled-skills');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  for (const item of parsed.skills) {
    if (!item.slug) {
      throw new Error(`Invalid manifest entry: ${JSON.stringify(item)}`);
    }
  }
  return parsed.skills;
}

echo`Bundling preinstalled skills...`;
const manifestSkills = loadManifest();
if (!existsSync(LOCAL_SOURCE_ROOT)) {
  throw new Error(`Missing local preinstalled skills source: ${LOCAL_SOURCE_ROOT}`);
}

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  skills: [],
};

for (const entry of manifestSkills) {
  const sourceDir = join(LOCAL_SOURCE_ROOT, entry.slug);
  const targetDir = join(OUTPUT_ROOT, entry.slug);

  if (!existsSync(sourceDir)) {
    throw new Error(`Missing local skill directory: ${sourceDir}`);
  }

  const sourceSkillManifest = join(sourceDir, 'SKILL.md');
  if (!existsSync(sourceSkillManifest)) {
    throw new Error(`Local skill ${entry.slug} is missing SKILL.md: ${sourceDir}`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true });

  lock.skills.push({
    slug: entry.slug,
    version: (entry.version || 'unknown').trim() || 'unknown',
    source: 'local',
  });

  echo`   OK ${entry.slug}`;
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
echo`Preinstalled skills ready: ${OUTPUT_ROOT}`;
