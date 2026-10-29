// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G', U: 'A',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', V: 'B', D: 'H', H: 'D', N: 'N'
};

export { translateCodon } from '../../lib/genetic-code';

export function complementBase(base: string): string {
  return COMPLEMENT[base.toUpperCase()] ?? 'N';
}

export function reverseComplement(sequence: string): string {
  const upper = sequence.toUpperCase();
  let output = '';
  for (let i = upper.length - 1; i >= 0; i -= 1) {
    output += complementBase(upper[i]);
  }
  return output;
}

const IUPAC_PAIRS: Record<string, string> = {
  AC: 'M', AG: 'R', AT: 'W', CG: 'S', CT: 'Y', GT: 'K'
};

export function iupacForPair(first: string, second: string): string {
  const a = first.toUpperCase();
  const b = second.toUpperCase();
  if (!/^[ACGT]$/.test(a) || !/^[ACGT]$/.test(b) || a === b) {
    return a === b ? a : 'N';
  }
  const key = a < b ? a + b : b + a;
  return IUPAC_PAIRS[key] ?? 'N';
}

export function isCanonicalBase(base: string): boolean {
  return /^[ACGT]$/.test(base.toUpperCase());
}
