// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import type { SangerTraceData } from '../../types/schema';
import { reverseComplement } from './genetics';

export interface CoverageCall {
  traceId: string;
  base: string;
  quality: number;
}

export interface CoverageDiscrepancy {
  refIndex: number;
  refBase: string;
  calls: CoverageCall[];
}

export type CoverageStatus =
  | 'match'
  | 'mismatch'
  | 'heterozygous'
  | 'uncovered'
  | 'conflict';

export interface CoverageSummary {
  depth: number[];
  consensus: string;
  status: CoverageStatus[];
  discrepancies: CoverageDiscrepancy[];
  coveredFraction: number;
}

export interface CoverageOptions {
  minQuality?: number;
}

const IUPAC_BASES: Record<string, string[]> = {
  A: ['A'],
  C: ['C'],
  G: ['G'],
  T: ['T'],
  U: ['T'],
  R: ['A', 'G'],
  Y: ['C', 'T'],
  S: ['C', 'G'],
  W: ['A', 'T'],
  K: ['G', 'T'],
  M: ['A', 'C'],
  B: ['C', 'G', 'T'],
  D: ['A', 'G', 'T'],
  H: ['A', 'C', 'T'],
  V: ['A', 'C', 'G'],
  N: []
};

const CANONICAL_ORDER = ['A', 'C', 'G', 'T'] as const;

function modulo(value: number, length: number): number {
  if (length <= 0) return 0;
  return ((value % length) + length) % length;
}

function expandBase(base: string): string[] {
  return IUPAC_BASES[base.toUpperCase()] ?? [];
}

function normalizeBase(base: string): string {
  const upper = base.toUpperCase();
  return upper === 'U' ? 'T' : upper;
}

function resolveQueryOffset(
  trace: SangerTraceData,
  queryText: string,
  strand: 1 | -1
): { offset: number; reversed: boolean } {
  const called = trace.calledSequence.toUpperCase();
  if (queryText.length === 0) return { offset: 0, reversed: false };

  const rawTrimStart = Array.isArray(trace.trimRange) ? trace.trimRange[0] : 0;
  const rawTrimEnd = Array.isArray(trace.trimRange) ? trace.trimRange[1] : called.length;
  const trimStart = Number.isFinite(rawTrimStart)
    ? Math.max(0, Math.min(called.length, Math.floor(rawTrimStart)))
    : 0;
  const trimEnd = Number.isFinite(rawTrimEnd)
    ? Math.max(trimStart, Math.min(called.length, Math.ceil(rawTrimEnd)))
    : called.length;

  if (strand === -1) {
    const reverse = reverseComplement(called);
    const hinted = reverse.indexOf(queryText, Math.max(0, called.length - trimEnd));
    if (hinted >= 0) return { offset: hinted, reversed: true };
    const found = reverse.indexOf(queryText);
    if (found >= 0) return { offset: found, reversed: true };
  }

  const hinted = called.indexOf(queryText, trimStart);
  if (hinted >= 0) return { offset: hinted, reversed: false };
  const direct = called.indexOf(queryText);
  if (direct >= 0) return { offset: direct, reversed: false };

  return { offset: trimStart, reversed: false };
}

/**
 * Aggregates aligned Sanger traces onto reference coordinates. Reference
 * coordinates are wrapped modulo the reference length so that alignments which
 * cross the origin of a circular molecule land on both ends of the sequence.
 */
export function summarizeTraceCoverage(
  refSequence: string,
  traces: SangerTraceData[],
  opts: CoverageOptions = {}
): CoverageSummary {
  const reference = (refSequence ?? '').toUpperCase();
  const length = reference.length;
  if (length === 0) {
    return {
      depth: [],
      consensus: '',
      status: [],
      discrepancies: [],
      coveredFraction: 0
    };
  }

  const minimumQuality = Number.isFinite(opts.minQuality)
    ? Math.max(0, opts.minQuality as number)
    : 0;

  const depth = new Array<number>(length).fill(0);
  const callsByPosition: CoverageCall[][] = Array.from(
    { length },
    () => [] as CoverageCall[]
  );
  const heterozygousPositions = new Set<number>();

  for (const trace of traces) {
    const alignment = trace.alignment;
    if (!alignment) continue;

    const alignedRef = alignment.alignedRef ?? '';
    const alignedQuery = alignment.alignedQuery ?? '';
    const columns = Math.min(alignedRef.length, alignedQuery.length);
    if (columns === 0) continue;

    const strand: 1 | -1 = alignment.strand === -1 ? -1 : 1;
    const queryPieces: string[] = [];
    for (let column = 0; column < columns; column += 1) {
      const queryChar = alignedQuery[column];
      if (queryChar !== '-') queryPieces.push(queryChar.toUpperCase());
    }
    const queryText = queryPieces.join('');
    const queryOffset = resolveQueryOffset(trace, queryText, strand);
    const calledLength = trace.calledSequence.length;
    const qualities = trace.qualityScores ?? [];

    let referencePosition = Number.isFinite(alignment.refStart)
      ? alignment.refStart
      : 0;
    let queryCounter = 0;
    const contributedPositions = new Set<number>();

    for (let column = 0; column < columns; column += 1) {
      const referenceChar = alignedRef[column];
      const queryChar = alignedQuery[column];

      if (referenceChar === '-' && queryChar === '-') continue;
      if (referenceChar === '-') {
        if (queryChar !== '-') queryCounter += 1;
        continue;
      }
      if (queryChar === '-') {
        referencePosition += 1;
        continue;
      }

      const queryIndex = queryOffset.reversed
        ? calledLength - 1 - (queryOffset.offset + queryCounter)
        : queryOffset.offset + queryCounter;
      queryCounter += 1;

      const rawQuality = qualities[queryIndex];
      const quality = Number.isFinite(rawQuality)
        ? Math.max(0, rawQuality as number)
        : 0;

      const refIndex = modulo(referencePosition, length);
      referencePosition += 1;
      if (quality < minimumQuality) continue;

      contributedPositions.add(refIndex);
      depth[refIndex] += 1;
      callsByPosition[refIndex].push({
        traceId: trace.id,
        base: normalizeBase(queryChar),
        quality
      });
    }

    for (const mismatch of alignment.mismatches ?? []) {
      if (mismatch.type !== 'heterozygous_peak') continue;
      if (!Number.isFinite(mismatch.refIndex)) continue;
      const refIndex = modulo(mismatch.refIndex, length);
      if (contributedPositions.has(refIndex)) {
        heterozygousPositions.add(refIndex);
      }
    }
  }

  const consensusCharacters = new Array<string>(length);
  const status = new Array<CoverageStatus>(length);
  const discrepancies: CoverageDiscrepancy[] = [];

  for (let index = 0; index < length; index += 1) {
    const calls = callsByPosition[index];
    if (calls.length === 0 || depth[index] === 0) {
      consensusCharacters[index] = 'N';
      status[index] = 'uncovered';
      continue;
    }

    const counts = new Map<string, number>();
    const qualitySums = new Map<string, number>();
    const alleles = new Set<string>();
    let hasAmbiguousCall = false;
    let hasDeviation = false;

    for (const call of calls) {
      const expanded = expandBase(call.base);
      if (expanded.length > 1) hasAmbiguousCall = true;
      for (const allele of expanded) {
        if (allele !== reference[index]) hasDeviation = true;
        counts.set(allele, (counts.get(allele) ?? 0) + 1);
        qualitySums.set(allele, (qualitySums.get(allele) ?? 0) + call.quality);
        alleles.add(allele);
      }
    }

    let consensus = 'N';
    let bestCount = 0;
    let bestQuality = -1;
    for (const base of CANONICAL_ORDER) {
      const count = counts.get(base) ?? 0;
      if (count === 0) continue;
      const quality = qualitySums.get(base) ?? 0;
      if (
        count > bestCount ||
        (count === bestCount &&
          (quality > bestQuality ||
            (quality === bestQuality && base === reference[index])))
      ) {
        consensus = base;
        bestCount = count;
        bestQuality = quality;
      }
    }

    let topAlleles = 0;
    let maximumCount = 0;
    for (const count of counts.values()) {
      if (count > maximumCount) {
        maximumCount = count;
        topAlleles = 1;
      } else if (count === maximumCount) {
        topAlleles += 1;
      }
    }

    let positionStatus: CoverageStatus;
    if (heterozygousPositions.has(index) || hasAmbiguousCall) {
      positionStatus = 'heterozygous';
    } else if (alleles.size === 0 || alleles.size > 2 || topAlleles > 1) {
      positionStatus = 'conflict';
    } else {
      positionStatus = consensus === reference[index] ? 'match' : 'mismatch';
    }

    consensusCharacters[index] = consensus;
    status[index] = positionStatus;

    if (positionStatus !== 'match' || hasDeviation) {
      discrepancies.push({
        refIndex: index,
        refBase: reference[index] ?? 'N',
        calls: calls.map(call => ({ ...call }))
      });
    }
  }

  let coveredBases = 0;
  for (let index = 0; index < length; index += 1) {
    if (depth[index] > 0) coveredBases += 1;
  }

  return {
    depth,
    consensus: consensusCharacters.join(''),
    status,
    discrepancies,
    coveredFraction: coveredBases / length
  };
}
