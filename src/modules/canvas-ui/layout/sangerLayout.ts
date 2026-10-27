// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import type { PlasmidDocument, SangerTraceData } from '../../../types/schema';
import { mod } from '../utils';
import { reverseComplement, translateCodon } from './linearLayout';

export interface QueryRefMapping {
  ref: number;
  gap: boolean;
}

export interface SangerWindow {
  start: number;
  end: number;
  span: number;
}

export function mapAlignedQueryToReference(
  alignedRef: string,
  alignedQuery: string,
  refStart: number,
): Map<number, QueryRefMapping> {
  const mapping = new Map<number, QueryRefMapping>();
  let queryIndex = 0;
  let refPosition = refStart;
  const count = Math.min(alignedRef.length, alignedQuery.length);
  for (let i = 0; i < count; i += 1) {
    const refChar = alignedRef[i];
    const queryChar = alignedQuery[i];
    if (queryChar !== '-') {
      if (refChar !== '-') {
        mapping.set(queryIndex, { ref: refPosition, gap: false });
        refPosition += 1;
      } else {
        mapping.set(queryIndex, { ref: refPosition, gap: true });
      }
      queryIndex += 1;
    } else if (refChar !== '-') {
      refPosition += 1;
    }
  }
  return mapping;
}

export function buildSangerWindow(
  doc: PlasmidDocument,
  traces: SangerTraceData[],
): SangerWindow {
  const length = doc.length || doc.sequence.length || 0;
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const trace of traces) {
    if (trace.alignment) {
      start = Math.min(start, trace.alignment.refStart);
      const alignedSpan = trace.alignment.alignedRef.replace(/-/g, '').length;
      end = Math.max(end, trace.alignment.refEnd || trace.alignment.refStart + alignedSpan);
    } else {
      start = Math.min(start, 0);
      end = Math.max(end, Math.min(length, trace.calledSequence.length));
    }
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    start = 0;
    end = Math.max(1, Math.min(length || 1, 1000));
  }
  if (length > 0) {
    start = Math.max(0, Math.min(length - 1, Math.floor(start)));
    end = Math.max(start + 1, Math.min(length, Math.ceil(end)));
  } else {
    start = 0;
    end = Math.max(1, Math.ceil(end));
  }
  return { start, end, span: end - start };
}

export function buildTraceMapping(
  trace: SangerTraceData,
  windowStart: number,
  windowEnd: number,
): Map<number, QueryRefMapping> {
  if (trace.alignment) {
    return mapAlignedQueryToReference(
      trace.alignment.alignedRef,
      trace.alignment.alignedQuery,
      trace.alignment.refStart,
    );
  }
  const mapping = new Map<number, QueryRefMapping>();
  for (let i = 0; i < trace.calledSequence.length; i += 1) {
    const ref = windowStart + i;
    if (ref >= windowEnd) break;
    mapping.set(i, { ref, gap: false });
  }
  return mapping;
}

export interface SangerMutationEntry {
  key: string;
  traceId: string;
  fileName: string;
  rowIndex: number;
  mismatchIndex: number;
  refIndex: number;
  queryIndex: number;
  type: 'substitution' | 'insertion' | 'deletion' | 'heterozygous_peak';
  refBase: string;
  queryBase: string;
  impact: string;
}

export const MUTATION_LABEL: Record<SangerMutationEntry['type'], string> = {
  substitution: 'Substitution',
  insertion: 'Insertion',
  deletion: 'Deletion',
  heterozygous_peak: 'Heterozygous',
};

export function buildMutationList(traces: SangerTraceData[]): SangerMutationEntry[] {
  const entries: SangerMutationEntry[] = [];
  traces.forEach((trace, rowIndex) => {
    const mismatches = trace.alignment?.mismatches ?? [];
    mismatches.forEach((mismatch, mismatchIndex) => {
      entries.push({
        key: `${trace.id}:${mismatchIndex}`,
        traceId: trace.id,
        fileName: trace.fileName,
        rowIndex,
        mismatchIndex,
        refIndex: mismatch.refIndex,
        queryIndex: mismatch.queryIndex,
        type: mismatch.type,
        refBase: mismatch.refBase,
        queryBase: mismatch.queryBase,
        impact: mismatch.aminoAcidImpact ?? '',
      });
    });
  });
  return entries.sort((a, b) => {
    if (a.refIndex !== b.refIndex) return a.refIndex - b.refIndex;
    if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
    return a.queryIndex - b.queryIndex;
  });
}

export interface ReferenceAminoAcid {
  pos: number;
  aa: string;
  index: number;
}

export function buildReferenceAminoAcids(
  doc: PlasmidDocument,
  windowStart: number,
  windowEnd: number,
): ReferenceAminoAcid[] {
  const sequence = doc.sequence.toUpperCase();
  const length = doc.length || sequence.length;
  if (length <= 0 || windowEnd <= windowStart) return [];
  const cds = doc.features.find(
    (feature) =>
      feature.type === 'CDS' &&
      ((feature.start < windowEnd && feature.end > windowStart) ||
        (feature.start > feature.end && feature.end > 0)),
  );
  const result: ReferenceAminoAcid[] = [];
  if (cds) {
    const start = mod(cds.start, length);
    const end = mod(cds.end, length);
    const raw =
      start < end
        ? sequence.slice(start, end)
        : sequence.slice(start) + sequence.slice(0, end);
    const coding = cds.strand === -1 ? reverseComplement(raw) : raw;
    const offset = Math.max(0, (cds.codonStart ?? 1) - 1);
    let index = 1;
    for (let i = offset; i + 3 <= coding.length; i += 3) {
      const pos = mod(cds.start + i, length);
      if (pos + 3 > windowStart && pos < windowEnd) {
        result.push({
          pos,
          aa: translateCodon(coding.slice(i, i + 3)),
          index,
        });
      }
      index += 1;
    }
    return result;
  }
  const first = Math.ceil(windowStart / 3) * 3;
  let index = Math.floor(first / 3) + 1;
  for (let pos = first; pos + 3 <= Math.min(length, windowEnd + 3); pos += 3) {
    if (pos >= length) break;
    result.push({
      pos,
      aa: translateCodon(sequence.slice(pos, pos + 3)),
      index,
    });
    index += 1;
  }
  return result;
}

export function tracePeakRange(
  trace: SangerTraceData,
  queryIndex: number,
): [number, number] {
  const start = trace.baseLocations[queryIndex] ?? 0;
  const end =
    trace.baseLocations[queryIndex + 1] ??
    Math.min(start + 12, Math.max(start + 1, trace.traces.A.length - 1));
  return [Math.max(0, start), Math.max(start + 1, end)];
}

export function qualityToColor(score: number, warning: string, neutral: string): string {
  return score < 20 ? warning : neutral;
}
