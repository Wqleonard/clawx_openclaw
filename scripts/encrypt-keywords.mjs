#!/usr/bin/env node
/**
 * Encrypt content-safety keyword files.
 *
 * Usage:
 *   node scripts/encrypt-keywords.mjs
 *
 * Input:  resources/content-safety/{fuzzy,hard}-keywords.txt
 * Output: resources/content-safety/{fuzzy,hard}-keywords.enc
 *
 * The same KEY constant must be kept in sync with content-safety-worker.ts.
 * Format of .enc file: [IV 16 bytes][AES-256-CBC ciphertext]
 */

import { createCipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Must match CONTENT_SAFETY_KEY in content-safety-worker.ts
const KEY = Buffer.from('5e78f3c1ec06e887cfa4e54e0bacc77040935f0f395ed95bcfae960b5dcfb61d', 'hex');

const FILES = ['fuzzy-keywords', 'hard-keywords'];

for (const name of FILES) {
  const src = join(ROOT, 'resources', 'content-safety', `${name}.txt`);
  const dst = join(ROOT, 'resources', 'content-safety', `${name}.enc`);

  if (!existsSync(src)) {
    console.warn(`⚠️  Skipping ${name}.txt (not found)`);
    continue;
  }

  const plaintext = readFileSync(src);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  // File layout: IV (16 bytes) | ciphertext
  writeFileSync(dst, Buffer.concat([iv, encrypted]));

  console.log(`✓  ${name}.txt  →  ${name}.enc  (${plaintext.length} bytes → ${iv.length + encrypted.length} bytes)`);
}

console.log('\nDone. Remember to exclude .txt files from your production build.');
