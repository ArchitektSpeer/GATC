// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// The compiled kernel has to agree with the JavaScript fill in every cell; if it
// ever does not, the alignment it produces would silently differ.
import { describe, expect, it } from 'vitest';
import { fillGotohMatrices, gotohLocalAlign } from '../../modules/alignment-gel/alignment';
import { bandedRows } from '../../modules/alignment-gel/reads';
import { profileRows, type ProfileRowInput } from '../../modules/alignment-gel/msa';
import { alignKernelsAvailable, bandedFill, gotohFill, profileFill } from './align';

function sequence(length: number, seed: number): string {
  const bases = 'ACGT';
  let state = seed >>> 0;
  let out = '';
  for (let index = 0; index < length; index += 1) {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    out += bases[((value ^ (value >>> 14)) >>> 0) % 4];
  }
  return out;
}

const SCORES = { matchScore: 2, mismatchScore: -1, gapOpen: -3, gapExtend: -1 };

describe('compiled Gotoh kernel', () => {
  it('compiles and runs here', () => {
    expect(alignKernelsAvailable()).toBe(true);
  });

  it('fills every cell exactly as the JavaScript fill does', () => {
    for (const seed of [1, 2, 3, 97]) {
      const reference = sequence(160, seed);
      // A read with a substitution, a deletion and an insertion in it.
      const read =
        sequence(40, seed + 1) +
        reference.slice(20, 60) +
        reference.slice(63, 100) +
        'GGGG' +
        reference.slice(100, 130);

      const wasm = gotohFill(reference, read, SCORES);
      expect(wasm).not.toBeNull();
      const js = fillGotohMatrices(reference, read, SCORES);
      if (!wasm) return;

      expect(wasm.columns).toBe(js.columns);
      expect([wasm.bestScore, wasm.bestI, wasm.bestJ, wasm.bestMatrix]).toEqual([
        js.bestScore,
        js.bestI,
        js.bestJ,
        js.bestMatrix,
      ]);
      // Compared as plain arrays so a mismatch reports which cell differs.
      expect([...wasm.matrix]).toEqual([...js.matrix]);
      expect([...wasm.gapInQuery]).toEqual([...js.gapInQuery]);
      expect([...wasm.gapInRef]).toEqual([...js.gapInRef]);
      expect([...wasm.pointerM]).toEqual([...js.pointerM]);
      expect([...wasm.pointerX]).toEqual([...js.pointerX]);
      expect([...wasm.pointerY]).toEqual([...js.pointerY]);
    }
  });

  it('agrees with the scoring the aligner is documented to use', () => {
    const reference = 'ACGTACGTAGGCTTACCGTA';
    const result = gotohLocalAlign(reference, reference);
    expect(result.score).toBe(reference.length * 2);
    expect(result.alignedRef).toBe(reference);
    expect(result.alignedQuery).toBe(reference);
  });

  it('declines a matrix too large to fit instead of throwing', () => {
    // 15 bytes a cell: 200k x 200k would be 6 TB.
    expect(gotohFill(sequence(200000, 5), sequence(200000, 6), SCORES)).toBeNull();
  });

  it('reuses its memory across calls of different shapes', () => {
    const first = gotohFill(sequence(80, 11), sequence(60, 12), SCORES);
    const second = gotohFill(sequence(200, 13), sequence(150, 14), SCORES);
    const third = gotohFill(sequence(80, 11), sequence(60, 12), SCORES);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // The third call sees the memory the second one dirtied, so it has to clear it.
    expect(third && [...third.matrix]).toEqual(first && [...fillGotohMatrices(sequence(80, 11), sequence(60, 12), SCORES).matrix]);
  });
});

describe('compiled banded kernel', () => {
  it('produces the same rows and pointers as the JavaScript loop', () => {
    for (const seed of [31, 32, 101]) {
      const target = sequence(500, seed);
      // A read taken from the target with one deletion and one insertion.
      const query = target.slice(100, 180) + target.slice(183, 240) + 'TTTT' + target.slice(240, 300);
      const guide = 100;
      const band = 24;
      const lowerOffset = guide - band;
      const upperOffset = guide + band;
      const width = upperOffset - lowerOffset + 1;

      const wasm = bandedFill(target, query, lowerOffset, upperOffset);
      expect(wasm).not.toBeNull();
      const js = bandedRows(target, query, target.length, query.length, lowerOffset, upperOffset, width);
      if (!wasm) return;

      const base = wasm.previousTriple * 3 * width;
      expect([...wasm.rows.subarray(base, base + width)]).toEqual([...js.previousM]);
      expect([...wasm.rows.subarray(base + width, base + 2 * width)]).toEqual([...js.previousX]);
      expect([...wasm.rows.subarray(base + 2 * width, base + 3 * width)]).toEqual([...js.previousY]);
      expect([...wasm.pointers]).toEqual([...js.pointers]);
    }
  });

  it('refuses an empty read rather than reading past its memory', () => {
    expect(bandedFill('ACGTACGT', '', 0, 8)).toBeNull();
    expect(bandedFill('', 'ACGT', 0, 8)).toBeNull();
  });
});

/**
 * The profile kernel only sees flat numbers, so the test can hand it numbers
 * rather than build real profiles; what matters is that both sides agree.
 */
function profileInput(firstColumns: number, secondColumns: number, margin: number, seed: number): ProfileRowInput {
  const size = 5;
  const delta = secondColumns - firstColumns;
  const lowerOffset = Math.min(0, delta) - margin;
  const upperOffset = Math.max(0, delta) + margin;
  const width = upperOffset - lowerOffset + 1;
  let state = seed >>> 0;
  const next = (modulus: number) => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) % modulus;
  };
  const firstResidues = new Int32Array(firstColumns);
  for (let index = 0; index < firstColumns; index += 1) firstResidues[index] = 1 + next(3);
  const secondResidues = new Int32Array(secondColumns);
  for (let index = 0; index < secondColumns; index += 1) secondResidues[index] = 1 + next(3);
  const secondCounts = new Int32Array(secondColumns * size);
  for (let index = 0; index < secondCounts.length; index += 1) secondCounts[index] = next(4);
  const firstVectors = new Float64Array(firstColumns * size);
  for (let index = 0; index < firstVectors.length; index += 1) firstVectors[index] = next(9) - 4;
  const gapOpen = -11;
  const gapExtend = -1;
  const firstSize = 2;
  const secondSize = 3;
  const secondOpen = new Float64Array(secondColumns);
  const secondExtend = new Float64Array(secondColumns);
  for (let index = 0; index < secondColumns; index += 1) {
    secondOpen[index] = gapOpen * secondResidues[index] * firstSize;
    secondExtend[index] = gapExtend * secondResidues[index] * firstSize;
  }
  return {
    firstColumns,
    secondColumns,
    size,
    width,
    lowerOffset,
    upperOffset,
    gapOpen,
    gapExtend,
    firstSize,
    secondSize,
    firstResidues,
    secondResidues,
    secondCounts,
    firstVectors,
    secondOpen,
    secondExtend,
  };
}

describe('compiled profile kernel', () => {
  it('produces the same rows and pointers as the JavaScript loop', () => {
    for (const [first, second, margin, seed] of [
      [40, 40, 8, 5],
      [60, 45, 12, 41],
      [30, 70, 6, 77],
    ]) {
      const input = profileInput(first, second, margin, seed);
      const wasm = profileFill(input);
      expect(wasm).not.toBeNull();
      const pointers = new Uint8Array((input.firstColumns + 1) * input.width);
      const js = profileRows(input, pointers);
      if (!wasm) return;

      const base = wasm.previousTriple * 3 * input.width;
      expect([...wasm.rows.subarray(base, base + input.width)]).toEqual([...js.previousM]);
      expect([...wasm.rows.subarray(base + input.width, base + 2 * input.width)]).toEqual([...js.previousX]);
      expect([...wasm.rows.subarray(base + 2 * input.width, base + 3 * input.width)]).toEqual([...js.previousY]);
      expect([...wasm.pointers]).toEqual([...pointers]);
    }
  });

  it('declines a band that does not contain the starting cell', () => {
    const input = profileInput(40, 40, 8, 5);
    expect(profileFill({ ...input, lowerOffset: 1 })).toBeNull();
  });
});
