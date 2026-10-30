// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import type { PlasmidDocument } from '../../types/schema';

export interface MotifHit {
  start: number;
  end: number;
  strand: 1 | -1;
  mismatches: number;
  matched: string;
}

const IUPAC_MASK: Record<string, number> = {
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  U: 8,
  R: 5,
  Y: 10,
  S: 6,
  W: 9,
  K: 12,
  M: 3,
  B: 14,
  D: 13,
  H: 11,
  V: 7,
  N: 15,
};

const BASE_CODE: Record<string, number> = {
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  U: 8,
};

const COMPLEMENT: Record<string, string> = {
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  D: 'H',
  H: 'D',
  V: 'B',
  N: 'N',
};

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
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
};

function normalizeSequence(sequence: string): string {
  return (sequence ?? '').toUpperCase().replace(/\s+/g, '').replace(/U/g, 'T');
}

function normalizePattern(pattern: string): string {
  return (pattern ?? '').toUpperCase().replace(/\s+/g, '').replace(/U/g, 'T');
}

function reverseComplement(sequence: string): string {
  let result = '';
  for (let index = sequence.length - 1; index >= 0; index -= 1) {
    result += COMPLEMENT[sequence[index]] ?? 'N';
  }
  return result;
}

function encodeBases(sequence: string): Uint8Array {
  const encoded = new Uint8Array(sequence.length);
  for (let index = 0; index < sequence.length; index += 1) {
    encoded[index] = BASE_CODE[sequence[index]] ?? 0;
  }
  return encoded;
}

function patternMasks(pattern: string): Uint8Array | null {
  const masks = new Uint8Array(pattern.length);
  for (let index = 0; index < pattern.length; index += 1) {
    const mask = IUPAC_MASK[pattern[index]];
    if (mask === undefined) return null;
    masks[index] = mask;
  }
  return masks;
}

function repeatToLength(sequence: string, length: number): string {
  if (sequence.length === 0 || length <= sequence.length) return sequence;
  const repeats = Math.ceil(length / sequence.length);
  return sequence.repeat(repeats).slice(0, length);
}

function matchesAt(
  encoded: Uint8Array,
  masks: Uint8Array,
  start: number,
  maxMismatches: number,
): number {
  let mismatches = 0;
  for (let offset = 0; offset < masks.length; offset += 1) {
    if ((encoded[start + offset] & masks[offset]) === 0) {
      mismatches += 1;
      if (mismatches > maxMismatches) return mismatches;
    }
  }
  return mismatches;
}

function forwardInterval(
  start: number,
  length: number,
  sequenceLength: number,
  circular: boolean,
): { start: number; end: number } {
  if (!circular) return { start, end: start + length };
  if (length >= sequenceLength) return { start: 0, end: sequenceLength };
  const end = (start + length) % sequenceLength;
  return { start, end: end === 0 ? sequenceLength : end };
}

function reverseInterval(
  start: number,
  length: number,
  sequenceLength: number,
  circular: boolean,
): { start: number; end: number } {
  const end = sequenceLength - start;
  if (!circular) {
    return { start: sequenceLength - start - length, end };
  }
  if (length >= sequenceLength) return { start: 0, end: sequenceLength };
  let wrappedStart = (sequenceLength - start - length) % sequenceLength;
  if (wrappedStart < 0) wrappedStart += sequenceLength;
  return { start: wrappedStart, end };
}

function searchDna(
  sequence: string,
  pattern: string,
  maxMismatches: number,
  bothStrands: boolean,
  circular: boolean,
  limit: number,
): MotifHit[] {
  const length = sequence.length;
  const patternLength = pattern.length;
  if (length === 0 || patternLength === 0) return [];

  const plusMasks = patternMasks(pattern);
  if (!plusMasks) return [];

  const scanLength = circular ? length + patternLength - 1 : length;
  const extended = repeatToLength(sequence, scanLength);
  const extendedCodes = encodeBases(extended);
  const starts = circular
    ? length
    : Math.max(0, length - patternLength + 1);
  const hits: MotifHit[] = [];

  for (let start = 0; start < starts; start += 1) {
    const mismatches = matchesAt(extendedCodes, plusMasks, start, maxMismatches);
    if (mismatches > maxMismatches) continue;
    const interval = forwardInterval(start, patternLength, length, circular);
    hits.push({
      start: interval.start,
      end: interval.end,
      strand: 1,
      mismatches,
      matched: extended.slice(start, start + patternLength),
    });
    if (hits.length >= limit) return hits;
  }

  const reversePattern = reverseComplement(pattern);
  if (!bothStrands || reversePattern === pattern) return hits;
  const minusMasks = patternMasks(reversePattern);
  if (!minusMasks) return hits;

  for (let start = 0; start < starts; start += 1) {
    const mismatches = matchesAt(extendedCodes, minusMasks, start, maxMismatches);
    if (mismatches > maxMismatches) continue;
    const interval = reverseInterval(start, patternLength, length, circular);
    hits.push({
      start: interval.start,
      end: interval.end,
      strand: -1,
      mismatches,
      matched: reverseComplement(extended.slice(start, start + patternLength)),
    });
    if (hits.length >= limit) return hits;
  }
  return hits;
}

function translateFrame(sequence: string, frame: number): string {
  let protein = '';
  for (let position = frame; position + 3 <= sequence.length; position += 3) {
    const codon = sequence.slice(position, position + 3);
    protein += CODON_TABLE[codon] ?? 'X';
  }
  return protein;
}

function proteinMismatches(
  text: string,
  pattern: string,
  start: number,
): number {
  let mismatches = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    if (expected === 'X') continue;
    if (text[start + index] !== expected) {
      mismatches += 1;
    }
  }
  return mismatches;
}

function searchProtein(
  sequence: string,
  pattern: string,
  maxMismatches: number,
  bothStrands: boolean,
  circular: boolean,
  limit: number,
): MotifHit[] {
  const length = sequence.length;
  const patternLength = pattern.length;
  if (length < 3 || patternLength === 0) return [];

  const hits: MotifHit[] = [];
  const strands: Array<1 | -1> = bothStrands ? [1, -1] : [1];
  const dnaSpan = patternLength * 3;

  for (const strand of strands) {
    const oriented = strand === 1 ? sequence : reverseComplement(sequence);
    const extra = circular ? dnaSpan + 6 : 0;
    const scanDna = repeatToLength(oriented, length + extra);
    const effectiveLength = circular ? scanDna.length : oriented.length;

    for (let frame = 0; frame < 3; frame += 1) {
      const protein = translateFrame(scanDna.slice(0, effectiveLength), frame);
      for (let position = 0; position + patternLength <= protein.length; position += 1) {
        const dnaStart = frame + position * 3;
        if (circular && dnaStart >= length) break;
        const dnaEnd = dnaStart + dnaSpan;
        if (!circular && dnaEnd > length) break;

        const mismatches = proteinMismatches(protein, pattern, position);
        if (mismatches > maxMismatches) continue;

        const interval =
          strand === 1
            ? forwardInterval(dnaStart, dnaSpan, length, circular)
            : reverseInterval(dnaStart, dnaSpan, length, circular);
        hits.push({
          start: interval.start,
          end: interval.end,
          strand,
          mismatches,
          matched: protein.slice(position, position + patternLength),
        });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

export function searchMotif(
  doc: PlasmidDocument,
  pattern: string,
  opts: {
    maxMismatches?: number;
    bothStrands?: boolean;
    protein?: boolean;
    limit?: number;
  } = {},
): MotifHit[] {
  const sequence = normalizeSequence(doc.sequence);
  if (!sequence) return [];

  const requestedLimit = opts.limit ?? 1000;
  const limit = Math.max(0, Math.floor(requestedLimit));
  if (limit === 0) return [];

  const maxMismatches = Math.max(0, Math.floor(opts.maxMismatches ?? 0));
  const bothStrands = opts.bothStrands !== false;
  const circular = doc.topology === 'circular';

  if (opts.protein) {
    const proteinPattern = normalizePattern(pattern);
    if (!proteinPattern || !/^[A-Z*]+$/.test(proteinPattern)) return [];
    const hits = searchProtein(
      sequence,
      proteinPattern,
      maxMismatches,
      bothStrands,
      circular,
      limit,
    );
    return hits.sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.strand - right.strand,
    );
  }

  const dnaPattern = normalizePattern(pattern);
  if (!dnaPattern || !/^[ACGTURYSWKMBDHVN]+$/.test(dnaPattern)) return [];
  const hits = searchDna(
    sequence,
    dnaPattern,
    maxMismatches,
    bothStrands,
    circular,
    limit,
  );
  return hits.sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.strand - right.strand,
  );
}
