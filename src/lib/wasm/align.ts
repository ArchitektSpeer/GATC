// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// The compiled alignment kernels and the memory around them. The module is a
// few kilobytes of WebAssembly bundled into the app, so it needs no fetch and
// works offline; if anything about it fails - no WebAssembly, a matrix too
// large to allocate - the caller is handed null and runs its own JavaScript
// loop instead. It is compiled synchronously, which browsers only allow for
// small modules on the main thread; that is also why a refusal has to be an
// ordinary outcome rather than an error.
import { WASM_BASE64 } from './align.wasm';

export interface GotohMatrices {
  columns: number;
  bestScore: number;
  bestI: number;
  bestJ: number;
  bestMatrix: 1 | 2 | 3;
  matrix: Int32Array;
  gapInQuery: Int32Array;
  gapInRef: Int32Array;
  pointerM: Uint8Array;
  pointerX: Uint8Array;
  pointerY: Uint8Array;
}

const PAGE = 65536;
/** Above this the kernel declines and the caller falls back; 15 bytes a cell. */
const MAX_BYTES = 512 * 1024 * 1024;

interface Kernel {
  memory: WebAssembly.Memory;
  heapBase: number;
  profile: (
    firstColumns: number,
    secondColumns: number,
    size: number,
    width: number,
    lowerOffset: number,
    gapOpen: number,
    gapExtend: number,
    firstSize: number,
    secondSize: number,
    firstResidues: number,
    secondResidues: number,
    secondCounts: number,
    firstVectors: number,
    secondOpen: number,
    secondExtend: number,
    pointers: number,
    rows: number,
    out: number,
  ) => void;
  banded: (
    target: number,
    query: number,
    targetLength: number,
    queryLength: number,
    lowerOffset: number,
    upperOffset: number,
    width: number,
    pointers: number,
    rows: number,
    out: number,
  ) => void;
  fill: (
    reference: number,
    read: number,
    n: number,
    m: number,
    matchScore: number,
    mismatchScore: number,
    gapOpen: number,
    gapExtend: number,
    matrix: number,
    gapInQuery: number,
    gapInRef: number,
    pointerM: number,
    pointerX: number,
    pointerY: number,
    out: number,
  ) => void;
}

let kernel: Kernel | null | undefined;

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary =
    typeof atob === 'function'
      ? atob(base64)
      : // Node, where the tests run.
        Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Compiles the module on first use; null means this environment cannot run it. */
function load(): Kernel | null {
  if (kernel !== undefined) return kernel;
  kernel = null;
  try {
    if (typeof WebAssembly === 'undefined') return kernel;
    const module = new WebAssembly.Module(decode(WASM_BASE64));
    const instance = new WebAssembly.Instance(module, {});
    const exports = instance.exports as Record<string, unknown>;
    const memory = exports.memory;
    const fill = exports.fill;
    const banded = exports.banded;
    const profile = exports.profile;
    const heapBase = exports.__heap_base;
    if (!(memory instanceof WebAssembly.Memory)) return kernel;
    if (typeof fill !== 'function' || typeof banded !== 'function') return kernel;
    if (typeof profile !== 'function') return kernel;
    kernel = {
      memory,
      // Everything below __heap_base belongs to the module itself.
      heapBase: heapBase instanceof WebAssembly.Global ? Number(heapBase.value) : PAGE,
      fill: fill as Kernel['fill'],
      banded: banded as Kernel['banded'],
      profile: profile as Kernel['profile'],
    };
  } catch {
    kernel = null;
  }
  return kernel;
}

/** Whether the compiled kernels are usable here. Exported for the tests. */
export function alignKernelsAvailable(): boolean {
  return load() !== null;
}

/** Grow the module's memory to cover `bytes`, or report that it cannot. */
function reserve(loaded: Kernel, bytes: number): boolean {
  if (bytes > MAX_BYTES) return false;
  const needed = Math.ceil(bytes / PAGE);
  const have = loaded.memory.buffer.byteLength / PAGE;
  if (needed <= have) return true;
  try {
    loaded.memory.grow(needed - have);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill the three score matrices and the three pointer matrices for a local
 * alignment of `reference` against `read`, in WebAssembly. Returns null when
 * the kernel is unavailable or the matrices would not fit, which means the
 * caller should run its own loop; the layout of what comes back is exactly what
 * the JavaScript version builds, so the traceback is the same code either way.
 */
export function gotohFill(
  reference: string,
  read: string,
  scoring: { matchScore: number; mismatchScore: number; gapOpen: number; gapExtend: number },
): GotohMatrices | null {
  const loaded = load();
  if (!loaded) return null;
  const n = reference.length;
  const m = read.length;
  if (n === 0 || m === 0) return null;

  const columns = m + 1;
  const cells = (n + 1) * columns;
  // Three Int32 matrices, three Uint8 matrices, the two sequences and four
  // output slots, each block aligned to 4 bytes.
  const int32Bytes = cells * 4;
  const align4 = (value: number) => (value + 3) & ~3;
  let offset = align4(loaded.heapBase);
  const matrixPtr = offset;
  offset += int32Bytes;
  const gapInQueryPtr = offset;
  offset += int32Bytes;
  const gapInRefPtr = offset;
  offset += int32Bytes;
  const pointerMPtr = offset;
  offset += align4(cells);
  const pointerXPtr = offset;
  offset += align4(cells);
  const pointerYPtr = offset;
  offset += align4(cells);
  const referencePtr = offset;
  offset += align4(n);
  const readPtr = offset;
  offset += align4(m);
  const outPtr = offset;
  offset += 16;

  if (!reserve(loaded, offset)) return null;

  const buffer = loaded.memory.buffer;
  const matrix = new Int32Array(buffer, matrixPtr, cells);
  const gapInQuery = new Int32Array(buffer, gapInQueryPtr, cells);
  const gapInRef = new Int32Array(buffer, gapInRefPtr, cells);
  const pointerM = new Uint8Array(buffer, pointerMPtr, cells);
  const pointerX = new Uint8Array(buffer, pointerXPtr, cells);
  const pointerY = new Uint8Array(buffer, pointerYPtr, cells);
  // The kernel only ever writes a cell when its score is positive, so the
  // matrices have to start at zero as they do in the JavaScript version.
  matrix.fill(0);
  gapInQuery.fill(0);
  gapInRef.fill(0);
  pointerM.fill(0);
  pointerX.fill(0);
  pointerY.fill(0);

  const referenceBytes = new Uint8Array(buffer, referencePtr, n);
  for (let index = 0; index < n; index += 1) referenceBytes[index] = reference.charCodeAt(index) & 0xff;
  const readBytes = new Uint8Array(buffer, readPtr, m);
  for (let index = 0; index < m; index += 1) readBytes[index] = read.charCodeAt(index) & 0xff;

  const out = new Int32Array(buffer, outPtr, 4);
  loaded.fill(
    referencePtr,
    readPtr,
    n,
    m,
    scoring.matchScore,
    scoring.mismatchScore,
    scoring.gapOpen,
    scoring.gapExtend,
    matrixPtr,
    gapInQueryPtr,
    gapInRefPtr,
    pointerMPtr,
    pointerXPtr,
    pointerYPtr,
    outPtr,
  );

  const bestMatrix = out[3] === 2 ? 2 : out[3] === 3 ? 3 : 1;
  return {
    columns,
    bestScore: out[0],
    bestI: out[1],
    bestJ: out[2],
    bestMatrix,
    matrix,
    gapInQuery,
    gapInRef,
    pointerM,
    pointerX,
    pointerY,
  };
}

export interface BandedRows {
  /** 0 or 1: which of the two row triples in `rows` holds the final row. */
  previousTriple: number;
  width: number;
  /** Six rows of `width` doubles: M, X, Y of one triple then of the other. */
  rows: Float64Array;
  /** One packed byte per cell: match | gapInTarget << 2 | gapInQuery << 4. */
  pointers: Uint8Array;
}

/**
 * Run the row loop of the banded semiglobal alignment in WebAssembly, for the
 * read aligner. Returns null when the kernel cannot run or the band would not
 * fit, in which case the caller runs its own loop. The arrays come back as
 * views into the module's memory, valid until the next call into it.
 */
export function bandedFill(
  target: string,
  query: string,
  lowerOffset: number,
  upperOffset: number,
): BandedRows | null {
  const loaded = load();
  if (!loaded) return null;
  const targetLength = target.length;
  const queryLength = query.length;
  const width = upperOffset - lowerOffset + 1;
  if (targetLength === 0 || queryLength === 0 || width <= 0) return null;

  const cells = (queryLength + 1) * width;
  const align8 = (value: number) => (value + 7) & ~7;
  let offset = align8(loaded.heapBase);
  const rowsPtr = offset;
  offset += 6 * width * 8;
  const pointersPtr = offset;
  offset += align8(cells);
  const targetPtr = offset;
  offset += align8(targetLength);
  const queryPtr = offset;
  offset += align8(queryLength);
  const outPtr = offset;
  offset += 16;

  if (!reserve(loaded, offset)) return null;

  const buffer = loaded.memory.buffer;
  const rows = new Float64Array(buffer, rowsPtr, 6 * width);
  const pointers = new Uint8Array(buffer, pointersPtr, cells);
  // Cells outside the band are never written, and the caller reads them as 0.
  pointers.fill(0);

  const targetBytes = new Uint8Array(buffer, targetPtr, targetLength);
  for (let index = 0; index < targetLength; index += 1) targetBytes[index] = target.charCodeAt(index) & 0xff;
  const queryBytes = new Uint8Array(buffer, queryPtr, queryLength);
  for (let index = 0; index < queryLength; index += 1) queryBytes[index] = query.charCodeAt(index) & 0xff;

  const out = new Int32Array(buffer, outPtr, 4);
  loaded.banded(
    targetPtr,
    queryPtr,
    targetLength,
    queryLength,
    lowerOffset,
    upperOffset,
    width,
    pointersPtr,
    rowsPtr,
    outPtr,
  );

  return { previousTriple: out[0], width, rows, pointers };
}

/**
 * Run the row loop of the banded profile-profile alignment in WebAssembly, for
 * the multiple sequence alignment. The caller has already turned both profiles
 * into the flat arrays this takes; null means it should run its own loop. The
 * arrays come back as views into the module's memory, valid until the next call.
 */
export function profileFill(input: {
  firstColumns: number;
  secondColumns: number;
  size: number;
  width: number;
  lowerOffset: number;
  gapOpen: number;
  gapExtend: number;
  firstSize: number;
  secondSize: number;
  firstResidues: Int32Array;
  secondResidues: Int32Array;
  secondCounts: Int32Array;
  firstVectors: Float64Array;
  secondOpen: Float64Array;
  secondExtend: Float64Array;
}): BandedRows | null {
  const loaded = load();
  if (!loaded) return null;
  const { firstColumns, secondColumns, size, width, lowerOffset } = input;
  if (firstColumns <= 0 || secondColumns <= 0 || width <= 0 || size <= 0) return null;
  // The kernel writes previousM[-lowerOffset] without checking, as the loop does.
  if (-lowerOffset < 0 || -lowerOffset >= width) return null;

  const cells = (firstColumns + 1) * width;
  const align8 = (value: number) => (value + 7) & ~7;
  let offset = align8(loaded.heapBase);
  const rowsPtr = offset;
  offset += 6 * width * 8;
  const firstVectorsPtr = offset;
  offset += align8(input.firstVectors.length * 8);
  const secondOpenPtr = offset;
  offset += align8(secondColumns * 8);
  const secondExtendPtr = offset;
  offset += align8(secondColumns * 8);
  const firstResiduesPtr = offset;
  offset += align8(firstColumns * 4);
  const secondResiduesPtr = offset;
  offset += align8(secondColumns * 4);
  const secondCountsPtr = offset;
  offset += align8(input.secondCounts.length * 4);
  const pointersPtr = offset;
  offset += align8(cells);
  const outPtr = offset;
  offset += 16;

  if (!reserve(loaded, offset)) return null;

  const buffer = loaded.memory.buffer;
  const rows = new Float64Array(buffer, rowsPtr, 6 * width);
  new Float64Array(buffer, firstVectorsPtr, input.firstVectors.length).set(input.firstVectors);
  new Float64Array(buffer, secondOpenPtr, secondColumns).set(input.secondOpen);
  new Float64Array(buffer, secondExtendPtr, secondColumns).set(input.secondExtend);
  new Int32Array(buffer, firstResiduesPtr, firstColumns).set(input.firstResidues);
  new Int32Array(buffer, secondResiduesPtr, secondColumns).set(input.secondResidues);
  new Int32Array(buffer, secondCountsPtr, input.secondCounts.length).set(input.secondCounts);
  const pointers = new Uint8Array(buffer, pointersPtr, cells);
  // Cells outside the band are never written, and the traceback reads them as 0.
  pointers.fill(0);

  const out = new Int32Array(buffer, outPtr, 4);
  loaded.profile(
    firstColumns,
    secondColumns,
    size,
    width,
    lowerOffset,
    input.gapOpen,
    input.gapExtend,
    input.firstSize,
    input.secondSize,
    firstResiduesPtr,
    secondResiduesPtr,
    secondCountsPtr,
    firstVectorsPtr,
    secondOpenPtr,
    secondExtendPtr,
    pointersPtr,
    rowsPtr,
    outPtr,
  );

  return { previousTriple: out[0], width, rows, pointers };
}
