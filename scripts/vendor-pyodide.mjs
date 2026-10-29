// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Copies the Pyodide runtime and the wheels we use into public/pyodide/, so the app
// serves them itself. Pyodide fetches packages from a CDN by default, which would
// break offline use and send a request per package; everything here ships with the app.
// Run after `npm install` or when the pyodide version changes: `npm run vendor:pyodide`.
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const SOURCE = 'node_modules/pyodide';
const OUT = 'public/pyodide';
/** Everything the loader itself reads. */
const RUNTIME = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip'];
/** The packages the app imports; their dependencies come along automatically. */
const PACKAGES = ['biopython'];

const lock = JSON.parse(await readFile(join(SOURCE, 'pyodide-lock.json'), 'utf8'));
// The lock describes the ABI, not the release; the release is the npm package's version.
const { version } = JSON.parse(await readFile(join(SOURCE, 'package.json'), 'utf8'));
const byName = Object.fromEntries(
  Object.values(lock.packages).map((p) => [p.name.toLowerCase(), p]),
);

/** The wheels needed for `names`, following `depends` to its end. */
function resolve(names) {
  const found = new Map();
  const queue = [...names];
  while (queue.length) {
    const name = queue.pop().toLowerCase();
    if (found.has(name)) continue;
    const pkg = byName[name];
    if (!pkg) throw new Error(`${name} is not in pyodide-lock.json`);
    found.set(name, pkg);
    queue.push(...(pkg.depends ?? []));
  }
  return [...found.values()];
}

await mkdir(OUT, { recursive: true });
for (const file of RUNTIME) await copyFile(join(SOURCE, file), join(OUT, file));

const wanted = resolve(PACKAGES);
const base = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
for (const pkg of wanted) {
  const target = join(OUT, pkg.file_name);
  const already = await stat(target).catch(() => null);
  if (already?.size) continue;
  // Pyodide caches wheels next to itself when it runs under Node; reuse those.
  const cached = join(SOURCE, pkg.file_name);
  if (await stat(cached).catch(() => null)) {
    await copyFile(cached, target);
    continue;
  }
  const response = await fetch(base + pkg.file_name);
  if (!response.ok) throw new Error(`${pkg.file_name}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

// A lock listing only what we ship, so a stray import cannot reach for the network.
const keep = new Set(wanted.map((p) => p.name));
await writeFile(
  join(OUT, 'pyodide-lock.json'),
  JSON.stringify(
    {
      ...lock,
      packages: Object.fromEntries(
        Object.entries(lock.packages).filter(([, p]) => keep.has(p.name)),
      ),
    },
    null,
    1,
  ),
);

let total = 0;
for (const file of [...RUNTIME, ...wanted.map((p) => p.file_name), 'pyodide-lock.json']) {
  total += (await stat(join(OUT, file))).size;
}
console.log(
  `${OUT}: pyodide ${version}, ${wanted.length} wheel(s) ` +
    `(${wanted.map((p) => p.name).join(', ')}), ${(total / 1048576).toFixed(1)} MB`,
);
