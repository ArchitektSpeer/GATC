// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { PlasmidDocument, SangerTraceData } from '../../types/schema';
import {
  alignReadsToReference,
  alignTraceToPlasmid,
  createSyntheticTrace,
  readsToTraces,
  summarizeTraceCoverage
} from './index';
import { reverseComplement } from './genetics';
import type { SequencingRead } from './reads';

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomDna(seed: number, length: number): string {
  const random = createRandom(seed);
  const alphabet = 'ACGT';
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    sequence += alphabet[Math.floor(random() * 4)];
  }
  return sequence;
}

function makeDoc(
  sequence: string,
  topology: 'linear' | 'circular' = 'linear'
): PlasmidDocument {
  return {
    id: 'doc-reads',
    name: 'Read alignment reference',
    sequence,
    topology,
    length: sequence.length,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features: [],
    primers: [],
    history: []
  };
}

function mutateBases(
  sequence: string,
  changes: Array<{ index: number; base: string }>
): string {
  const characters = sequence.split('');
  for (const change of changes) {
    characters[change.index] = change.base;
  }
  return characters.join('');
}

function alternateBase(base: string): string {
  return (['A', 'C', 'G', 'T'] as const).find(candidate => candidate !== base) ?? 'A';
}

function makeTrace(options: {
  id: string;
  refStart: number;
  refEnd?: number;
  strand?: 1 | -1;
  alignedRef: string;
  alignedQuery: string;
  qualities?: number[];
  calledSequence?: string;
  mismatches?: NonNullable<SangerTraceData['alignment']>['mismatches'];
  heterozygousAt?: number[];
}): SangerTraceData {
  const calledSequence = options.calledSequence ?? options.alignedQuery.replace(/-/g, '');
  const mismatches = [...(options.mismatches ?? [])];
  for (const index of options.heterozygousAt ?? []) {
    mismatches.push({
      refIndex: index,
      queryIndex: index,
      type: 'heterozygous_peak',
      refBase: options.alignedRef[index] ?? 'N',
      queryBase: 'N'
    });
  }
  return {
    id: options.id,
    fileName: `${options.id}.ab1`,
    calledSequence,
    qualityScores:
      options.qualities ?? new Array<number>(calledSequence.length).fill(40),
    baseLocations: new Array<number>(calledSequence.length)
      .fill(0)
      .map((_, index) => index * 10 + 5),
    trimRange: [0, calledSequence.length],
    traces: { A: [], T: [], G: [], C: [] },
    alignment: {
      refStart: options.refStart,
      refEnd:
        options.refEnd ??
        options.refStart + options.alignedRef.replace(/-/g, '').length,
      strand: options.strand ?? 1,
      identityPercent: 100,
      alignedRef: options.alignedRef,
      alignedQuery: options.alignedQuery,
      mismatches
    }
  };
}

function makeRead(
  id: string,
  sequence: string,
  qualities?: number[]
): SequencingRead {
  return {
    id,
    name: `${id} read`,
    sequence,
    qualities: qualities ?? new Array<number>(sequence.length).fill(35)
  };
}

describe('summarizeTraceCoverage', () => {
  const reference = randomDna(9001, 120);

  it('reports full depth, reference consensus and match status for agreeing reads', () => {
    const first = makeTrace({
      id: 'trace-a',
      refStart: 0,
      alignedRef: reference,
      alignedQuery: reference
    });
    const second = makeTrace({
      id: 'trace-b',
      refStart: 0,
      alignedRef: reference,
      alignedQuery: reference
    });

    const summary = summarizeTraceCoverage(reference, [first, second]);
    expect(summary.depth).toHaveLength(reference.length);
    expect(summary.depth.every(value => value === 2)).toBe(true);
    expect(summary.consensus).toBe(reference);
    expect(summary.status.every(value => value === 'match')).toBe(true);
    expect(summary.discrepancies).toEqual([]);
    expect(summary.coveredFraction).toBe(1);
  });

  it('distinguishes a shared variant from conflicting reads', () => {
    const position = 17;
    const referenceBase = reference[position];
    const alternate = alternateBase(referenceBase);
    const mutated = mutateBases(reference, [{ index: position, base: alternate }]);

    const both = [
      makeTrace({
        id: 'mutant-a',
        refStart: 0,
        alignedRef: reference,
        alignedQuery: mutated
      }),
      makeTrace({
        id: 'mutant-b',
        refStart: 0,
        alignedRef: reference,
        alignedQuery: mutated
      })
    ];
    const consistent = summarizeTraceCoverage(reference, both);
    expect(consistent.status[position]).toBe('mismatch');
    expect(consistent.consensus[position]).toBe(alternate);
    expect(consistent.discrepancies).toHaveLength(1);
    expect(consistent.discrepancies[0].refIndex).toBe(position);
    expect(consistent.discrepancies[0].refBase).toBe(referenceBase);
    expect(consistent.discrepancies[0].calls).toHaveLength(2);

    const conflicting = summarizeTraceCoverage(reference, [
      both[0],
      makeTrace({
        id: 'wild-type',
        refStart: 0,
        alignedRef: reference,
        alignedQuery: reference
      })
    ]);
    expect(conflicting.status[position]).toBe('conflict');
    expect(conflicting.discrepancies[0].calls.map(call => call.traceId)).toEqual([
      'mutant-a',
      'wild-type'
    ]);

    const majority = summarizeTraceCoverage(reference, [
      makeTrace({
        id: 'majority-a',
        refStart: 0,
        alignedRef: reference,
        alignedQuery: reference
      }),
      makeTrace({
        id: 'majority-b',
        refStart: 0,
        alignedRef: reference,
        alignedQuery: reference
      }),
      both[0]
    ]);
    expect(majority.depth[position]).toBe(3);
    expect(majority.status[position]).toBe('match');
    expect(majority.consensus[position]).toBe(referenceBase);
    expect(majority.discrepancies).toHaveLength(1);
    expect(majority.discrepancies[0].calls).toHaveLength(3);
  });

  it('filters low quality calls and leaves uncovered positions as N', () => {
    const position = 8;
    const alternate = alternateBase(reference[position]);
    const mutated = mutateBases(reference, [{ index: position, base: alternate }]);
    const lowQuality = makeTrace({
      id: 'low',
      refStart: 0,
      alignedRef: reference,
      alignedQuery: mutated,
      qualities: new Array<number>(reference.length).fill(10)
    });
    const highQuality = makeTrace({
      id: 'high',
      refStart: 0,
      alignedRef: reference,
      alignedQuery: reference
    });

    const filtered = summarizeTraceCoverage(reference, [lowQuality, highQuality], {
      minQuality: 20
    });
    expect(filtered.depth[position]).toBe(1);
    expect(filtered.status[position]).toBe('match');

    const partial = summarizeTraceCoverage(reference, [
      makeTrace({
        id: 'partial',
        refStart: 0,
        alignedRef: reference.slice(0, 50),
        alignedQuery: reference.slice(0, 50)
      })
    ]);
    expect(partial.coveredFraction).toBeCloseTo(50 / reference.length, 10);
    expect(partial.depth[49]).toBe(1);
    expect(partial.depth[50]).toBe(0);
    expect(partial.status[50]).toBe('uncovered');
    expect(partial.consensus[50]).toBe('N');
  });

  it('wraps alignments that cross the circular origin', () => {
    const start = 95;
    const span = 40;
    const wrappedRef = reference.slice(start) + reference.slice(0, span - (reference.length - start));
    expect(wrappedRef).toHaveLength(span);

    const trace = makeTrace({
      id: 'origin',
      refStart: start,
      alignedRef: wrappedRef,
      alignedQuery: wrappedRef
    });
    trace.alignment!.refEnd = (start + span) % reference.length;

    const summary = summarizeTraceCoverage(reference, [trace]);
    for (let index = 0; index < reference.length; index += 1) {
      const covered =
        (index >= start && index < reference.length) || index < span - (reference.length - start);
      expect(summary.depth[index]).toBe(covered ? 1 : 0);
      expect(summary.status[index]).toBe(covered ? 'match' : 'uncovered');
    }
    expect(summary.coveredFraction).toBeCloseTo(span / reference.length, 10);
  });

  it('marks heterozygous traces and ambiguous calls as heterozygous', () => {
    const position = 31;
    const secondary = alternateBase(reference[position]);
    const trace = makeTrace({
      id: 'heterozygous',
      refStart: 0,
      alignedRef: reference,
      alignedQuery: reference,
      heterozygousAt: [position]
    });
    const summary = summarizeTraceCoverage(reference, [trace]);
    expect(summary.status[position]).toBe('heterozygous');
    expect(summary.depth[position]).toBe(1);
    expect(summary.discrepancies[0].refIndex).toBe(position);
    expect(summary.discrepancies[0].calls[0].base).toBe(reference[position]);
    expect(secondary).not.toBe(reference[position]);

    const ambiguousSequence = reference.slice(0, 20) + 'R' + reference.slice(21);
    const ambiguous = makeTrace({
      id: 'ambiguous',
      refStart: 0,
      alignedRef: reference,
      alignedQuery: ambiguousSequence,
      calledSequence: ambiguousSequence
    });
    const ambiguousSummary = summarizeTraceCoverage(reference, [ambiguous]);
    expect(ambiguousSummary.status[20]).toBe('heterozygous');
  });

  it('detects heterozygous peaks from traces produced by the Sanger pipeline', async () => {
    const sequence = randomDna(9100, 260);
    const position = 120;
    const secondary = alternateBase(sequence[position]);
    const doc = makeDoc(sequence);
    const trace = createSyntheticTrace(sequence, {
      length: sequence.length,
      heterozygous: [{ index: position, base: secondary }]
    });
    const aligned = await alignTraceToPlasmid(trace, doc);
    const summary = summarizeTraceCoverage(sequence, [aligned]);
    expect(summary.status[position]).toBe('heterozygous');
    expect(summary.depth[position]).toBe(1);
  });

  it('maps reverse-strand alignments and trimmed quality offsets correctly', async () => {
    const start = 20;
    const end = 60;
    const segment = reference.slice(start, end);
    const readSequence = reverseComplement(segment);
    const qualities = new Array<number>(readSequence.length).fill(40);
    qualities[0] = 5;
    const reverseTrace = makeTrace({
      id: 'reverse',
      refStart: start,
      refEnd: end,
      strand: -1,
      alignedRef: segment,
      alignedQuery: segment,
      calledSequence: readSequence,
      qualities
    });
    const reverseSummary = summarizeTraceCoverage(reference, [reverseTrace], {
      minQuality: 20
    });
    expect(reverseSummary.depth[start]).toBe(1);
    expect(reverseSummary.depth[end - 2]).toBe(1);
    expect(reverseSummary.depth[end - 1]).toBe(0);
    expect(reverseSummary.status[end - 1]).toBe('uncovered');

    const sequence = randomDna(9150, 200);
    const doc = makeDoc(sequence);
    const trace = createSyntheticTrace(sequence, { length: sequence.length });
    trace.trimRange = [20, 180];
    const aligned = await alignTraceToPlasmid(trace, doc);
    const trimmedSummary = summarizeTraceCoverage(sequence, [aligned]);
    expect(trimmedSummary.depth[19]).toBe(0);
    expect(trimmedSummary.depth[20]).toBe(1);
    expect(trimmedSummary.depth[179]).toBe(1);
    expect(trimmedSummary.depth[180]).toBe(0);
  });

  it('ignores traces without an alignment and handles an empty reference', () => {
    const unaligned: SangerTraceData = {
      id: 'unaligned',
      fileName: 'unaligned.fastq',
      calledSequence: 'ACGT',
      qualityScores: [40, 40, 40, 40],
      baseLocations: [],
      trimRange: [0, 4],
      traces: { A: [], T: [], G: [], C: [] }
    };
    const summary = summarizeTraceCoverage(reference, [unaligned]);
    expect(summary.depth.every(value => value === 0)).toBe(true);
    expect(summary.coveredFraction).toBe(0);
    expect(summary.discrepancies).toEqual([]);

    const empty = summarizeTraceCoverage('', [unaligned]);
    expect(empty).toEqual({
      depth: [],
      consensus: '',
      status: [],
      discrepancies: [],
      coveredFraction: 0
    });
  });
});

describe('alignReadsToReference', () => {
  it('aligns forward reads at their reference positions', () => {
    const reference = randomDna(9200, 2500);
    const doc = makeDoc(reference);
    const exact = reference.slice(300, 450);
    const mutated = mutateBases(reference.slice(900, 1050), [
      { index: 20, base: alternateBase(reference[920]) },
      { index: 70, base: alternateBase(reference[970]) }
    ]);
    const results = alignReadsToReference(
      [makeRead('exact', exact), makeRead('mutated', mutated)],
      doc
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      readId: 'exact',
      aligned: true,
      refStart: 300,
      refEnd: 450,
      strand: 1,
      identityPercent: 100,
      mismatches: []
    });
    expect(results[1].aligned).toBe(true);
    expect(results[1].refStart).toBe(900);
    expect(results[1].refEnd).toBe(1050);
    expect(results[1].strand).toBe(1);
    expect(results[1].identityPercent).toBeCloseTo(98.667, 3);
    expect(results[1].mismatches).toHaveLength(2);
    expect(results[1].mismatches[0]).toEqual({
      refIndex: 920,
      refBase: reference[920],
      readBase: mutated[20]
    });
  });

  it('aligns reads from the reverse strand and reports forward coordinates', () => {
    const reference = randomDna(9300, 3000);
    const doc = makeDoc(reference);
    const segment = reference.slice(1000, 1150);
    const read = reverseComplement(segment);
    const results = alignReadsToReference([makeRead('reverse', read)], doc);

    expect(results[0].aligned).toBe(true);
    expect(results[0].strand).toBe(-1);
    expect(results[0].refStart).toBe(1000);
    expect(results[0].refEnd).toBe(1150);
    expect(results[0].identityPercent).toBe(100);
    expect(results[0].mismatches).toEqual([]);
  });

  it('supports circular references and reads crossing the origin', () => {
    const reference = randomDna(9400, 1000);
    const doc = makeDoc(reference, 'circular');
    const spanning = reference.slice(950) + reference.slice(0, 100);
    const internal = reference.slice(200, 350);
    const results = alignReadsToReference(
      [makeRead('spanning', spanning), makeRead('internal', internal)],
      doc
    );

    expect(results[0].aligned).toBe(true);
    expect(results[0].refStart).toBe(950);
    expect(results[0].refEnd).toBe(100);
    expect(results[0].refStart).toBeGreaterThan(results[0].refEnd);
    expect(results[0].identityPercent).toBe(100);
    expect(results[1]).toMatchObject({
      aligned: true,
      refStart: 200,
      refEnd: 350,
      strand: 1
    });

    const mutated = mutateBases(spanning, [
      { index: 60, base: alternateBase(reference[10]) }
    ]);
    const mutatedResult = alignReadsToReference([makeRead('wrapped-mutant', mutated)], doc);
    expect(mutatedResult[0].refStart).toBe(950);
    expect(mutatedResult[0].refEnd).toBe(100);
    expect(mutatedResult[0].mismatches).toEqual([
      { refIndex: 10, refBase: reference[10], readBase: mutated[60] }
    ]);
  });

  it('aligns reverse reads that cross a circular origin', () => {
    const reference = randomDna(9450, 1200);
    const doc = makeDoc(reference, 'circular');
    const spanning = reference.slice(1100) + reference.slice(0, 80);
    const read = reverseComplement(spanning);
    const results = alignReadsToReference([makeRead('reverse-spanning', read)], doc);

    expect(results[0].aligned).toBe(true);
    expect(results[0].strand).toBe(-1);
    expect(results[0].refStart).toBe(1100);
    expect(results[0].refEnd).toBe(80);
    expect(results[0].identityPercent).toBe(100);
  });

  it('handles deletions and insertions without losing the alignment', () => {
    const reference = randomDna(9500, 2000);
    const doc = makeDoc(reference);
    const segment = reference.slice(400, 550);
    const deleted = segment.slice(0, 40) + segment.slice(41);
    const inserted =
      segment.slice(0, 80) + alternateBase(segment[80]) + segment.slice(80);
    const results = alignReadsToReference(
      [makeRead('deletion', deleted), makeRead('insertion', inserted)],
      doc
    );

    expect(results[0].aligned).toBe(true);
    expect(results[0].refStart).toBe(400);
    expect(results[0].refEnd).toBe(550);
    expect(results[0].mismatches.some(mismatch => mismatch.readBase === '-')).toBe(true);

    expect(results[1].aligned).toBe(true);
    expect(results[1].refStart).toBe(400);
    expect(results[1].refEnd).toBe(550);
    expect(results[1].mismatches.some(mismatch => mismatch.refBase === '-')).toBe(true);
  });

  it('honors minIdentity and maxReads', () => {
    const reference = randomDna(9600, 1500);
    const doc = makeDoc(reference);
    const segment = reference.slice(200, 350);
    const noisy = mutateBases(
      segment,
      Array.from({ length: 15 }, (_, index) => ({
        index: index * 9,
        base: alternateBase(segment[index * 9])
      }))
    );
    const unrelated = randomDna(9700, 150);

    const strict = alignReadsToReference([makeRead('noisy', noisy)], doc, {
      minIdentity: 95
    });
    expect(strict[0].aligned).toBe(false);
    expect(strict[0].identityPercent).toBe(0);
    expect(strict[0].mismatches).toEqual([]);

    const fractional = alignReadsToReference([makeRead('noisy', noisy)], doc, {
      minIdentity: 0.95
    });
    expect(fractional[0].aligned).toBe(false);

    const relaxed = alignReadsToReference([makeRead('noisy', noisy)], doc, {
      minIdentity: 80
    });
    expect(relaxed[0].aligned).toBe(true);
    expect(relaxed[0].identityPercent).toBeGreaterThan(80);

    const unrelatedResult = alignReadsToReference([makeRead('random', unrelated)], doc);
    expect(unrelatedResult[0].aligned).toBe(false);

    const limited = alignReadsToReference(
      [
        makeRead('one', reference.slice(0, 150)),
        makeRead('two', reference.slice(300, 450)),
        makeRead('three', reference.slice(600, 750))
      ],
      doc,
      { maxReads: 2 }
    );
    expect(limited.map(result => result.readId)).toEqual(['one', 'two']);
  });

  it('aligns one thousand 150 bp reads to a 10 kb reference within the time budget', () => {
    const reference = randomDna(9800, 10000);
    const doc = makeDoc(reference, 'circular');
    const random = createRandom(9900);
    const reads: SequencingRead[] = [];
    for (let index = 0; index < 1000; index += 1) {
      const start = Math.floor(random() * (reference.length - 150));
      const segment = reference.slice(start, start + 150).split('');
      const mutationCount = random() < 0.5 ? 1 : 2;
      for (let mutation = 0; mutation < mutationCount; mutation += 1) {
        const offset = Math.floor(random() * segment.length);
        segment[offset] = alternateBase(segment[offset]);
      }
      const sequence = index % 2 === 0 ? segment.join('') : reverseComplement(segment.join(''));
      reads.push(makeRead(`read-${index}`, sequence));
    }

    const started = Date.now();
    const results = alignReadsToReference(reads, doc);
    const elapsed = Date.now() - started;

    expect(results).toHaveLength(1000);
    expect(results.every(result => result.aligned)).toBe(true);
    expect(results.every(result => result.identityPercent > 95)).toBe(true);
    expect(results.some(result => result.strand === -1)).toBe(true);
    expect(elapsed).toBeLessThan(3000);
  }, 20000);
});

describe('readsToTraces', () => {
  it('wraps FASTQ records as trace-shaped data without chromatogram samples', () => {
    const reads: SequencingRead[] = [
      {
        id: 'read-1',
        name: 'Read one',
        sequence: 'acgtacgt',
        qualities: [30, 31, 32, 33, 34, 35, 36, 37]
      },
      {
        id: 'read-2',
        name: '',
        sequence: 'TTTT',
        qualities: [10, 11]
      }
    ];

    const traces = readsToTraces(reads);
    expect(traces).toHaveLength(2);
    expect(traces[0].id).toBe('read-1');
    expect(traces[0].fileName).toBe('Read one');
    expect(traces[0].calledSequence).toBe('ACGTACGT');
    expect(traces[0].qualityScores).toEqual([30, 31, 32, 33, 34, 35, 36, 37]);
    expect(traces[0].trimRange).toEqual([0, 8]);
    expect(traces[0].baseLocations).toEqual([]);
    expect(traces[0].traces).toEqual({ A: [], T: [], G: [], C: [] });
    expect(traces[0].alignment).toBeUndefined();

    expect(traces[1].fileName).toBe('read-2.fastq');
    expect(traces[1].qualityScores).toEqual([10, 11, 0, 0]);
    expect(traces[1].trimRange).toEqual([0, 4]);
  });

  it('preserves inputs when converting an empty read list', () => {
    expect(readsToTraces([])).toEqual([]);
  });
});
