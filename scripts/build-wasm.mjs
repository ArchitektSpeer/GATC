// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Compiles src/lib/wasm/*.c to WebAssembly and writes the bytes into a
// generated TypeScript file, so the module is bundled with the app and works
// offline with no extra fetch. Needs clang with the wasm32 target and wasm-ld.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KERNELS = [
  {
    source: 'src/lib/wasm/align.c',
    output: 'src/lib/wasm/align.wasm.ts',
    exports: ['fill', 'banded', 'profile', '__heap_base'],
    what: 'the alignment inner loops',
  },
];

const scratch = mkdtempSync(join(tmpdir(), 'gatc-wasm-'));

for (const kernel of KERNELS) {
  const binary = join(scratch, 'kernel.wasm');
  execFileSync(
    'clang',
    [
      '--target=wasm32',
      // -Oz, not -O3: it measures the same on these loops and keeps the module
      // under the 4 KB browsers allow to be compiled synchronously, which is
      // how the app loads it.
      '-Oz',
      '-nostdlib',
      '-ffreestanding',
      '-fno-builtin',
      '-Wl,--no-entry',
      ...kernel.exports.map((name) => `-Wl,--export=${name}`),
      '-Wl,--export-memory',
      '-Wl,--initial-memory=1048576',
      '-Wl,--max-memory=2147483648',
      '-o',
      binary,
      kernel.source,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const bytes = readFileSync(binary);
  const base64 = bytes.toString('base64');
  const lines = base64.match(/.{1,96}/g) ?? [];
  writeFileSync(
    kernel.output,
    [
      '// GATC - Gene Assembly & Toolkit for Cloning',
      '// Copyright (C) 2026 Xu Zhonghe',
      '// SPDX-License-Identifier: GPL-3.0-or-later',
      `// Generated from ${kernel.source} by scripts/build-wasm.mjs - do not edit.`,
      `// ${kernel.what}, ${bytes.length} bytes of WebAssembly.`,
      'export const WASM_BASE64 =',
      ...lines.map((line, index) => `  '${line}'${index === lines.length - 1 ? ';' : ' +'}`),
      '',
    ].join('\n'),
  );
  console.log(`${kernel.output}: ${bytes.length} bytes from ${kernel.source}`);
}
