// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Collects every message passed to t() in the source. The Chinese text is the key, so
// this is both the translator's worklist and what the completeness test checks against.
// Usage: node scripts/i18n-keys.mjs [--missing]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_ROOT = new URL('../src', import.meta.url).pathname;

/**
 * Every single- or double-quoted literal. In a converted file each Chinese literal is
 * either a message passed to t() or a label in a table that t() is called on, so taking
 * all of them gives the complete worklist.
 */
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === 'data') continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/** Every message key used in the source, with the files that use it. */
export function collectKeys(root = SOURCE_ROOT) {
  const keys = new Map();
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(LITERAL)) {
      const raw = match[1] ?? match[2] ?? '';
      // Only messages written in Chinese are keys; the rest are identifiers passed through.
      if (!/[一-鿿]/.test(raw)) continue;
      const key = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n');
      const where = keys.get(key) ?? [];
      where.push(file.slice(root.length + 1));
      keys.set(key, where);
    }
  }
  return keys;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const keys = collectKeys();
  const { EN } = await import('../src/lib/messages.en.ts').catch(() => ({ EN: null }));
  if (process.argv.includes('--missing') && EN) {
    const missing = [...keys.keys()].filter((k) => !(k in EN));
    for (const key of missing) console.log(JSON.stringify(key) + ': ' + JSON.stringify(''),);
    console.error(`${missing.length} of ${keys.size} messages have no English yet`);
  } else {
    for (const key of keys.keys()) console.log(JSON.stringify(key));
    console.error(`${keys.size} messages`);
  }
}
