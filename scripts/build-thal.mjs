// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Builds src/lib/wasm/thal.wasm: primer3's thermodynamic alignment, which is
// what says whether a primer folds back on itself or two primers stick
// together. The sources are primer3's own; src/lib/wasm/thal-wrap.c is the only
// code here, and it does nothing but pass arguments through.
//
// Needs clang with the wasm32 target (the system one will do) and the WASI
// sysroot, which this downloads into a cache directory. No Emscripten.
// Run with `npm run build:thal`; a test checks the result against primer3's own
// numbers, so a build that goes wrong is caught rather than shipped.
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WASI_SDK = '34';
const WASI_VERSION = '34.0';
// The thermodynamic code is split across thal_params/thal_util/thal_draw/thal_trace only on
// primer3's main branch; the last release, 2.6.1, still has it in one file. Pinned to a commit
// so the same bytes come out every time.
const PRIMER3 = '345cba9ca22fdb8f9f90da9b57948b81b4866330';
const CACHE = join(tmpdir(), 'gatc-thal-build');
const OUT = 'src/lib/wasm/thal.wasm';

/** Download `url` into the cache once, and unpack it. */
async function fetchAndUnpack(url, name) {
  const target = join(CACHE, name);
  if (await stat(target).catch(() => null)) return target;
  await mkdir(CACHE, { recursive: true });
  const archive = `${target}.tar.gz`;
  if (!(await stat(archive).catch(() => null))) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  }
  const into = await mkdtemp(join(CACHE, 'unpack-'));
  execFileSync('tar', ['xzf', archive, '-C', into]);
  const [only] = await readdir(into);
  await cp(join(into, only), target, { recursive: true });
  await rm(into, { recursive: true, force: true });
  return target;
}

const base = `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK}`;
const sysroot = await fetchAndUnpack(`${base}/wasi-sysroot-${WASI_VERSION}.tar.gz`, 'wasi-sysroot');
const runtime = await fetchAndUnpack(`${base}/libclang_rt-${WASI_VERSION}.tar.gz`, 'libclang_rt');
const primer3 = await fetchAndUnpack(
  `https://github.com/primer3-org/primer3/archive/${PRIMER3}.tar.gz`,
  `primer3-${PRIMER3.slice(0, 12)}`,
);

// clang looks for its wasm compiler runtime inside its own resource directory,
// which is not writable; this is a copy of it with the runtime added.
const resource = join(CACHE, 'resource-dir');
if (!(await stat(resource).catch(() => null))) {
  const own = execFileSync('clang', ['-print-resource-dir'], { encoding: 'utf8' }).trim();
  await cp(own, resource, { recursive: true });
  await mkdir(join(resource, 'lib/wasm32-unknown-wasip1'), { recursive: true });
  await cp(
    join(runtime, 'wasm32-unknown-wasip1/libclang_rt.builtins.a'),
    join(resource, 'lib/wasm32-unknown-wasip1/libclang_rt.builtins.a'),
  );
}

const src = join(primer3, 'src');
execFileSync(
  'clang',
  [
    '--target=wasm32-wasip1',
    `--sysroot=${sysroot}`,
    `-resource-dir=${resource}`,
    '-O2',
    `-I${src}`,
    // thal reports errors with setjmp/longjmp, which on WebAssembly needs the
    // exception-handling proposal; every engine this ships to implements it.
    '-mllvm',
    '-wasm-enable-sjlj',
    '-o',
    OUT,
    'src/lib/wasm/thal-wrap.c',
    join(src, 'thal.c'),
    join(src, 'thal_params.c'),
    join(src, 'thal_util.c'),
    join(src, 'thal_draw.c'),
    join(src, 'thal_trace.c'),
    '-lsetjmp',
    '-Wl,--no-entry',
    '-Wl,--export-dynamic',
    '-mexec-model=reactor',
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

const built = await stat(OUT);
console.log(`${OUT}: ${(built.size / 1024).toFixed(0)} kB from primer3 ${PRIMER3.slice(0, 12)}`);
