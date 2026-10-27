// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Sanger read coverage over reference coordinates.
 *
 * The functions are pure and operate on the alignment records carried by
 * `SangerTraceData`, so they can be unit tested in Node and reused by workers.
 */

import type { SangerTraceData } from '../../../types/schema';

export type CoverageStatus = 'match' | 'mismatch' | 'heterozygous' | 'uncovered';

export interface SangerCoverage {
  start: number;
  end: number;
  /** Per-position read depth. */
  depth: number[];
  /** Per-position consistency state against the reference. */
  status: CoverageStatus[];
  maxDepth: number;
  meanDepth: number;
  coveredBases: number;
  matchBases: number;
  mismatchBases: number;
  heterozygousBases: number;
  uncoveredBases: number;
}

export interface CoverageRun {
  /** Offset relative to the coverage window start. */
  startOffset: number;
  endOffset: number;
  depth: number;
  status: CoverageStatus;
}

const IUPAC_ALTERNATIVES: Record<string, string> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  U: 'T',
  R: 'AG',
  Y: 'CT',
  S: 'GC',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
};

/** Possible bases represented by an IUPAC code. */
export function expandIupacBase(base: string): string[] {
  return (IUPAC_ALTERNATIVES[base.toUpperCase()] ?? '').split('');
}

function canonicalBase(base: string): string {
  const upper = base.toUpperCase();
  if (upper === 'U') return 'T';
  return upper;
}

function basesAgree(observed: string, reference: string): boolean {
  const alternatives = expandIupacBase(observed);
  const refAlternatives = expandIupacBase(reference);
  if (alternatives.length === 0 || refAlternatives.length === 0) return false;
  if (alternatives.length === 1 && refAlternatives.length === 1) {
    return alternatives[0] === refAlternatives[0];
  }
  return alternatives.some((base) => refAlternatives.includes(base));
}

interface PositionState {
  depth: number;
  mismatch: boolean;
  heterozygous: boolean;
  alleles: Set<string>;
}

/**
 * Walk one alignment and accumulate depth and observed alleles. Insertions are
 * ignored for reference coverage, deletions count as covered mismatches.
 */
function accumulateTraceCoverage(
  trace: SangerTraceData,
  windowStart: number,
  windowEnd: number,
  states: PositionState[],
): void {
  const span = windowEnd - windowStart;
  if (span <= 0) return;
  const mark = (refIndex: number, queryBase: string, hetero: boolean): void => {
    const offset = refIndex - windowStart;
    if (offset < 0 || offset >= span) return;
    const state = states[offset];
    state.depth += 1;
    const base = canonicalBase(queryBase);
    if (base === '-') {
      state.mismatch = true;
      return;
    }
    if (base) state.alleles.add(base);
    if (hetero) state.heterozygous = true;
  };

  const alignment = trace.alignment;
  if (alignment) {
    const heteroPositions = new Set<number>();
    for (const mismatch of alignment.mismatches ?? []) {
      if (mismatch.type === 'heterozygous_peak') heteroPositions.add(mismatch.refIndex);
    }
    let refIndex = alignment.refStart;
    const count = Math.min(alignment.alignedRef.length, alignment.alignedQuery.length);
    for (let i = 0; i < count; i += 1) {
      const refChar = alignment.alignedRef[i];
      const queryChar = alignment.alignedQuery[i];
      if (refChar === '-') {
        // Insertion relative to the reference: no reference position consumed.
        continue;
      }
      if (queryChar === '-') {
        mark(refIndex, '-', false);
      } else {
        mark(refIndex, queryChar, heteroPositions.has(refIndex));
      }
      refIndex += 1;
    }
    return;
  }

  // Unaligned reads are assumed to start at the window origin.
  for (let i = 0; i < trace.calledSequence.length; i += 1) {
    const refIndex = windowStart + i;
    if (refIndex >= windowEnd) break;
    mark(refIndex, trace.calledSequence[i], false);
  }
}

/**
 * Compute per-base coverage and consistency for a reference window.
 *
 * `reference` is the full document sequence (or at least the window). Positions
 * where the reference base is ambiguous are compared using IUPAC expansion.
 */
export function computeSangerCoverage(
  traces: SangerTraceData[],
  windowStart: number,
  windowEnd: number,
  reference: string,
): SangerCoverage {
  const start = Math.max(0, Math.floor(windowStart));
  const end = Math.max(start, Math.ceil(windowEnd));
  const span = end - start;
  const states: PositionState[] = Array.from({ length: span }, () => ({
    depth: 0,
    mismatch: false,
    heterozygous: false,
    alleles: new Set<string>(),
  }));

  for (const trace of traces) {
    accumulateTraceCoverage(trace, start, end, states);
  }

  const depth = new Array<number>(span).fill(0);
  const status = new Array<CoverageStatus>(span).fill('uncovered');
  let maxDepth = 0;
  let totalDepth = 0;
  let coveredBases = 0;
  let matchBases = 0;
  let mismatchBases = 0;
  let heterozygousBases = 0;
  let uncoveredBases = 0;

  for (let offset = 0; offset < span; offset += 1) {
    const state = states[offset];
    const referenceBase = reference[start + offset] ?? 'N';
    depth[offset] = state.depth;
    totalDepth += state.depth;
    if (state.depth > maxDepth) maxDepth = state.depth;

    let next: CoverageStatus;
    if (state.depth === 0) {
      next = 'uncovered';
    } else {
      const referenceAlternatives = expandIupacBase(referenceBase);
      const nonReference: string[] = [];
      let ambiguity = false;
      for (const allele of state.alleles) {
        const alternatives = expandIupacBase(allele);
        if (alternatives.length > 1) ambiguity = true;
        if (
          alternatives.length > 0 &&
          referenceAlternatives.length > 0 &&
          !alternatives.some((base) => referenceAlternatives.includes(base))
        ) {
          nonReference.push(allele);
        }
      }
      const distinctAlleles = new Set(nonReference);
      if (state.heterozygous || (state.depth >= 2 && state.alleles.size >= 2)) {
        next = 'heterozygous';
      } else if (state.mismatch || distinctAlleles.size > 0) {
        next = 'mismatch';
      } else if (ambiguity) {
        next = 'heterozygous';
      } else {
        next = 'match';
      }
    }

    status[offset] = next;
    if (next === 'uncovered') {
      uncoveredBases += 1;
    } else {
      coveredBases += 1;
      if (next === 'match') matchBases += 1;
      else if (next === 'heterozygous') heterozygousBases += 1;
      else mismatchBases += 1;
    }
  }

  return {
    start,
    end,
    depth,
    status,
    maxDepth,
    meanDepth: span > 0 ? totalDepth / span : 0,
    coveredBases,
    matchBases,
    mismatchBases,
    heterozygousBases,
    uncoveredBases,
  };
}

/** Collapse equal adjacent positions into runs for efficient SVG rendering. */
export function coverageRuns(coverage: SangerCoverage): CoverageRun[] {
  const runs: CoverageRun[] = [];
  const count = Math.min(coverage.depth.length, coverage.status.length);
  for (let offset = 0; offset < count; offset += 1) {
    const depth = coverage.depth[offset];
    const status = coverage.status[offset];
    const previous = runs[runs.length - 1];
    if (previous && previous.depth === depth && previous.status === status) {
      previous.endOffset = offset + 1;
    } else {
      runs.push({ startOffset: offset, endOffset: offset + 1, depth, status });
    }
  }
  return runs;
}

export function coverageStatusColor(
  status: CoverageStatus,
  tokens: { success: string; warning: string; accent: string; faint: string },
): string {
  switch (status) {
    case 'match':
      return tokens.success;
    case 'mismatch':
      return tokens.warning;
    case 'heterozygous':
      return tokens.accent;
    default:
      return tokens.faint;
  }
}
