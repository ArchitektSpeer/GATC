// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
const CODON_TABLE: Record<string, string> = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G'
};

const COMPLEMENT: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G', U: 'A',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', V: 'B', D: 'H', H: 'D', N: 'N'
};

export function translateCodon(codon: string): string {
  const upper = codon.toUpperCase();
  return CODON_TABLE[upper] ?? 'X';
}

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
