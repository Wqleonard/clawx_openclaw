/**
 * Content Safety Worker — runs as an Electron utilityProcess.
 *
 * Message protocol (parent ↔ worker):
 *   Init:   { type: 'init', fuzzyKeywordsPath: string, hardKeywordsPath: string }
 *   Ready:  { type: 'ready' }
 *   Check:  { type: 'check', id: string, text: string }
 *   Result: { type: 'result', id: string, pass: boolean, reason?: string }
 *   Error:  { type: 'error', message: string }
 */

import { readFileSync, existsSync } from 'fs';
import { createDecipheriv } from 'crypto';

// ---------------------------------------------------------------------------
// Utility: Traditional Chinese → Simplified Chinese
// ---------------------------------------------------------------------------

type ConverterFn = (text: string) => string;

function buildConverter(): ConverterFn {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const OpenCC = require('opencc-js') as any;
    // tw→cn covers mainland Simplified; hk covers Hong Kong Traditional
    const twConverter = OpenCC.Converter({ from: 'tw', to: 'cn' }) as ConverterFn;
    const hkConverter = OpenCC.Converter({ from: 'hk', to: 'cn' }) as ConverterFn;
    return (text: string) => hkConverter(twConverter(text));
  } catch {
    return (text: string) => text;
  }
}

const toSimplified = buildConverter();

// ---------------------------------------------------------------------------
// Helpers: load keyword file (skip blank lines and # comments)
// ---------------------------------------------------------------------------

// Must match the KEY in scripts/encrypt-keywords.mjs
const CONTENT_SAFETY_KEY = Buffer.from(
  '5e78f3c1ec06e887cfa4e54e0bacc77040935f0f395ed95bcfae960b5dcfb61d',
  'hex',
);

/**
 * Read and decrypt a .enc keyword file (AES-256-CBC).
 * Falls back to plaintext .txt if no .enc file exists (development convenience).
 */
function loadKeywords(filePath: string): string[] {
  // Prefer encrypted .enc file; fall back to .txt for local development
  const encPath = filePath.replace(/\.txt$/, '.enc');
  let content: string;

  if (existsSync(encPath)) {
    const raw = readFileSync(encPath);
    const iv = raw.subarray(0, 16);
    const ciphertext = raw.subarray(16);
    const decipher = createDecipheriv('aes-256-cbc', CONTENT_SAFETY_KEY, iv);
    content = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  } else if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf-8');
  } else {
    return [];
  }

  const words = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const w = line.trim();
    if (w && !w.startsWith('#')) words.add(w);
  }
  return Array.from(words);
}

// ---------------------------------------------------------------------------
// Fuzzy Matcher — Trie + DFS with gap allowance
// ---------------------------------------------------------------------------

let nodeIdSeq = 0;

interface TrieNode {
  id: number;
  children: Map<string, TrieNode>;
  isEnd: boolean;
  allowFuzzy: boolean; // true only for keywords with length > 2
}

function mkNode(): TrieNode {
  return { id: nodeIdSeq++, children: new Map(), isEnd: false, allowFuzzy: false };
}

class FuzzyMatcher {
  private root: TrieNode;
  private maxGap: number;

  constructor(keywords: string[], maxGap = 8) {
    this.root = mkNode();
    this.maxGap = maxGap;
    for (const kw of keywords) this.insertKeyword(kw);
  }

  private insertKeyword(keyword: string): void {
    let node = this.root;
    for (const ch of keyword) {
      if (!node.children.has(ch)) node.children.set(ch, mkNode());
      node = node.children.get(ch)!;
    }
    node.isEnd = true;
    node.allowFuzzy = keyword.length > 2;
  }

  findFirst(text: string): boolean {
    // 1. Exact pass
    for (let s = 0; s < text.length; s++) {
      let node = this.root;
      let p = s;
      while (p < text.length) {
        const ch = text[p];
        if (!node.children.has(ch)) break;
        node = node.children.get(ch)!;
        p++;
        if (node.isEnd) return true;
      }
    }

    // 2. Fuzzy pass (DFS with gap budget)
    for (let s = 0; s < text.length; s++) {
      const visited = new Set<string>();
      if (this.dfs(text, s, this.root, 0, visited)) return true;
    }

    return false;
  }

  private dfs(text: string, idx: number, node: TrieNode, gapsUsed: number, visited: Set<string>): boolean {
    if (node.isEnd && node.allowFuzzy) return true;
    if (idx >= text.length) return false;

    const state = `${idx}:${node.id}:${gapsUsed}`;
    if (visited.has(state)) return false;
    visited.add(state);

    const ch = text[idx];
    if (node.children.has(ch) && this.dfs(text, idx + 1, node.children.get(ch)!, gapsUsed, visited)) return true;
    if (gapsUsed < this.maxGap && this.dfs(text, idx + 1, node, gapsUsed + 1, visited)) return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hard Matcher — Aho-Corasick automaton
// ---------------------------------------------------------------------------

class HardMatcher {
  private goto: Map<string, number>[];
  private fail: number[];
  private output: boolean[];

  constructor(keywords: string[]) {
    this.goto = [new Map()];
    this.fail = [0];
    this.output = [false];
    for (const kw of keywords) this.insert(kw);
    this.buildFail();
  }

  private insert(word: string): void {
    let curr = 0;
    for (const ch of word) {
      if (!this.goto[curr].has(ch)) {
        const s = this.goto.length;
        this.goto[curr].set(ch, s);
        this.goto.push(new Map());
        this.fail.push(0);
        this.output.push(false);
      }
      curr = this.goto[curr].get(ch)!;
    }
    this.output[curr] = true;
  }

  private buildFail(): void {
    const q: number[] = [];
    for (const [, next] of this.goto[0]) {
      this.fail[next] = 0;
      q.push(next);
    }
    while (q.length) {
      const curr = q.shift()!;
      for (const [ch, next] of this.goto[curr]) {
        q.push(next);
        let f = this.fail[curr];
        while (f !== 0 && !this.goto[f].has(ch)) f = this.fail[f];
        const failTarget = this.goto[f].get(ch) ?? 0;
        this.fail[next] = failTarget === next ? 0 : failTarget;
        if (this.output[this.fail[next]]) this.output[next] = true;
      }
    }
  }

  findFirst(text: string): boolean {
    let curr = 0;
    for (const ch of text) {
      while (curr !== 0 && !this.goto[curr].has(ch)) curr = this.fail[curr];
      curr = this.goto[curr].get(ch) ?? 0;
      if (this.output[curr]) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let fuzzyMatcher: FuzzyMatcher | null = null;
let hardMatcher: HardMatcher | null = null;
let ready = false;

function checkText(rawText: string): { pass: boolean; reason?: string } {
  if (!rawText) return { pass: true };

  // Strip all whitespace (defeats split-word evasion), then Traditional → Simplified
  const text = toSimplified(rawText.replace(/\s+/g, ''));

  if (fuzzyMatcher?.findFirst(text)) return { pass: false, reason: '内容存在安全风险' };
  if (hardMatcher?.findFirst(text)) return { pass: false, reason: '内容存在安全风险' };

  return { pass: true };
}

// ---------------------------------------------------------------------------
// IPC with parent process
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parentPort = (process as any).parentPort as Electron.ParentPort;

parentPort.on('message', (evt: Electron.MessageEvent) => {
  const msg = evt.data as Record<string, unknown>;

  if (msg.type === 'init') {
    try {
      const fuzzyPath = msg.fuzzyKeywordsPath as string;
      const hardPath = msg.hardKeywordsPath as string;

      const fuzzyKeywords = loadKeywords(fuzzyPath);
      const hardKeywords = loadKeywords(hardPath);

      fuzzyMatcher = new FuzzyMatcher(fuzzyKeywords);
      hardMatcher = new HardMatcher(hardKeywords);
      ready = true;

      parentPort.postMessage({
        type: 'ready',
        fuzzyCount: fuzzyKeywords.length,
        hardCount: hardKeywords.length,
      });
    } catch (err) {
      parentPort.postMessage({ type: 'error', message: String(err) });
    }
    return;
  }

  if (msg.type === 'check') {
    const id = msg.id as string;
    const text = msg.text as string;

    if (!ready) {
      parentPort.postMessage({ type: 'result', id, pass: true });
      return;
    }

    try {
      const result = checkText(text);
      parentPort.postMessage({ type: 'result', id, ...result });
    } catch (err) {
      parentPort.postMessage({ type: 'result', id, pass: true });
      console.error('[content-safety-worker] checkText error:', err);
    }
    return;
  }
});
