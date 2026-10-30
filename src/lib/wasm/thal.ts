// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// primer3's thermodynamic alignment, compiled to WebAssembly. This is the
// calculation behind "will this primer fold back on itself" and "will two
// primers stick together": thal.c from primer3, built with clang's wasm32-wasip1
// target against the WASI sysroot (see scripts/build-thal.mjs), reached through
// the few lines of C in thal-wrap.c.
//
// Nothing on the path thal takes opens a file or reads the clock, so the WASI
// imports are answered here rather than pulling in a runtime; the stub exists so
// a stray call cannot make the module give up and exit.
import wasmUrl from './thal.wasm?url';

/** primer3's alignment types; the two this project asks for. */
const HAIRPIN = 4;
const ANY = 1;

export interface ThalResult {
  /** kcal/mol, zero when no structure is predicted. */
  deltaG: number;
  /** kcal/mol. */
  deltaH: number;
  /** cal/(mol·K). */
  deltaS: number;
  /** Melting temperature of the structure, °C. */
  tm: number;
  /** primer3's own drawing of the structure it found. */
  structure: string;
}

export interface ThalConditions {
  /** Monovalent cations, mM. */
  monovalentMm: number;
  /** Divalent cations, mM. */
  divalentMm: number;
  /** dNTPs, mM. */
  dntpMm: number;
  /** Oligo concentration, nM. */
  oligoNm: number;
  /** Temperature the structure is evaluated at, °C. */
  temperatureC: number;
}

interface Thal {
  memory: WebAssembly.Memory;
  p3_init: () => number;
  p3_buf1: () => number;
  p3_buf2: () => number;
  p3_thal: (
    s1: number,
    s2: number,
    type: number,
    mv: number,
    dv: number,
    dntp: number,
    dnaConc: number,
    tempC: number,
    dimer: number,
  ) => number;
  p3_dg: () => number;
  p3_dh: () => number;
  p3_ds: () => number;
  p3_temp: () => number;
  p3_struct: () => number;
  _initialize?: () => void;
}

const EBADF = 8;
const ENOENT = 44;

function wasiStub(read: () => DataView): WebAssembly.Imports['wasi_snapshot_preview1'] {
  return {
    environ_sizes_get: (count: number, size: number) => {
      const view = read();
      view.setUint32(count, 0, true);
      view.setUint32(size, 0, true);
      return 0;
    },
    environ_get: () => 0,
    clock_time_get: (_id: number, _precision: bigint, out: number) => {
      read().setBigUint64(out, 0n, true);
      return 0;
    },
    fd_close: () => 0,
    fd_fdstat_get: (_fd: number, out: number) => {
      const view = read();
      for (let offset = 0; offset < 24; offset += 1) view.setUint8(out + offset, 0);
      return 0;
    },
    fd_fdstat_set_flags: () => 0,
    fd_prestat_get: () => EBADF,
    fd_prestat_dir_name: () => EBADF,
    fd_read: (_fd: number, _iovs: number, _length: number, read_: number) => {
      read().setUint32(read_, 0, true);
      return 0;
    },
    fd_seek: (_fd: number, _offset: bigint, _whence: number, out: number) => {
      read().setBigUint64(out, 0n, true);
      return 0;
    },
    // Anything thal writes to stdout or stderr is accepted and dropped.
    fd_write: (_fd: number, iovs: number, count: number, written: number) => {
      const view = read();
      let total = 0;
      for (let index = 0; index < count; index += 1) {
        total += view.getUint32(iovs + index * 8 + 4, true);
      }
      view.setUint32(written, total, true);
      return 0;
    },
    path_open: () => ENOENT,
    proc_exit: (code: number) => {
      throw new Error(`primer3 thal exited with ${code}`);
    },
  } as unknown as WebAssembly.Imports['wasi_snapshot_preview1'];
}

let loading: Promise<Thal | null> | null = null;
let loaded: Thal | null = null;
let view: DataView | null = null;

function dataView(thal: Thal): DataView {
  if (!view || view.buffer !== thal.memory.buffer) view = new DataView(thal.memory.buffer);
  return view;
}

async function start(): Promise<Thal | null> {
  try {
    // In a browser the bundler gives a URL to fetch. The MCP build inlines the
    // module as a data: URL, which fetch takes too. Under the test runner the
    // URL is the path the module has in the project, which is read from disk.
    const fetchable = typeof globalThis.location !== 'undefined' || wasmUrl.startsWith('data:');
    const bytes = fetchable
      ? await (await fetch(wasmUrl)).arrayBuffer()
      : (await import(/* @vite-ignore */ 'node:fs')).readFileSync(
          (await import(/* @vite-ignore */ 'node:path')).join(
            process.cwd(),
            wasmUrl.replace(/^\//, '').replace(/\?.*$/, ''),
          ),
        );
    let instance: Thal;
    const imports = {
      wasi_snapshot_preview1: wasiStub(() => dataView(instance)),
    } as unknown as WebAssembly.Imports;
    const result = await WebAssembly.instantiate(bytes as BufferSource, imports);
    instance = ('instance' in result ? result.instance : result).exports as unknown as Thal;
    instance._initialize?.();
    if (instance.p3_init() !== 0) return null;
    loaded = instance;
    return instance;
  } catch (error) {
    // Said once rather than swallowed: without this the thermodynamics simply
    // reports "not loaded" and the reason is nowhere.
    console.error('primer3 thermodynamics failed to load:', error);
    return null;
  }
}

/** Start primer3's thermodynamics; null means it could not be loaded. */
export function initThal(): Promise<Thal | null> {
  loading ??= start();
  return loading;
}

/** Whether the compiled thal is ready; a caller that cannot wait checks this. */
export function thalReady(): boolean {
  return loaded !== null;
}

function readString(thal: Thal, address: number): string {
  const bytes = new Uint8Array(thal.memory.buffer);
  let end = address;
  while (bytes[end]) end += 1;
  return new TextDecoder().decode(bytes.slice(address, end));
}

function run(
  thal: Thal,
  first: string,
  second: string,
  type: number,
  conditions: ThalConditions,
  dimer: number,
): ThalResult {
  const address = thal.p3_buf1();
  const second_ = thal.p3_buf2();
  const bytes = new Uint8Array(thal.memory.buffer);
  for (let index = 0; index < first.length; index += 1) bytes[address + index] = first.charCodeAt(index);
  bytes[address + first.length] = 0;
  for (let index = 0; index < second.length; index += 1) bytes[second_ + index] = second.charCodeAt(index);
  bytes[second_ + second.length] = 0;
  thal.p3_thal(
    address,
    second_,
    type,
    conditions.monovalentMm,
    conditions.divalentMm,
    conditions.dntpMm,
    conditions.oligoNm,
    conditions.temperatureC,
    dimer,
  );
  // primer3 reports energies in cal/mol.
  return {
    deltaG: thal.p3_dg() / 1000,
    deltaH: thal.p3_dh() / 1000,
    deltaS: thal.p3_ds(),
    tm: thal.p3_temp(),
    structure: readString(thal, thal.p3_struct()),
  };
}

/** The hairpin an oligo folds into, by primer3. Null when thal is not loaded. */
export function hairpin(sequence: string, conditions: ThalConditions): ThalResult | null {
  return loaded ? run(loaded, sequence, sequence, HAIRPIN, conditions, 0) : null;
}

/** The duplex two oligos form, by primer3. Null when thal is not loaded. */
export function duplex(
  first: string,
  second: string,
  conditions: ThalConditions,
): ThalResult | null {
  return loaded ? run(loaded, first, second, ANY, conditions, 1) : null;
}
