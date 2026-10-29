// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Sanger attribution: every finding has to rest on evidence that is in the data.
import { describe, expect, it } from 'vitest';
import type { PlasmidDocument, Primer, SangerTraceData } from '../../types/schema';
import { alignTraceToPlasmid } from './alignment';
import { attributeSangerFailures, groupTraceMismatches } from './attribution';
import { createSyntheticTrace } from './synthetic';

/** A reproducible pseudo-random plasmid, so the tests do not depend on a file. */
function syntheticSequence(length: number, seed = 7): string {
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

const SEQ = syntheticSequence(1600);

function primer(overrides: Partial<Primer>): Primer {
  return {
    id: 'p1',
    name: 'F1',
    sequence: 'ACGT',
    bindingStart: 0,
    bindingEnd: 20,
    strand: 1,
    tailSequence: '',
    tmAnnealing: 60,
    tmTotal: 60,
    gcPercent: 50,
    has3PrimeGCClamp: true,
    hairpinDeltaG: 0,
    selfDimerDeltaG: 0,
    ...overrides,
  };
}

function plasmid(sequence: string, extra: Partial<PlasmidDocument> = {}): PlasmidDocument {
  return {
    id: 'doc1',
    name: 'pTest',
    sequence,
    topology: 'circular',
    length: sequence.length,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features: [],
    primers: [],
    history: [],
    ...extra,
  };
}

/** Align a read to `doc` so the attribution has something to work from. */
async function aligned(trace: SangerTraceData, doc: PlasmidDocument): Promise<SangerTraceData> {
  return alignTraceToPlasmid(trace, doc);
}

describe('grouping', () => {
  it('reads a run of deletions as one event, which is what decides the frame', async () => {
    const doc = plasmid(SEQ);
    const withDeletion = SEQ.slice(0, 400) + SEQ.slice(403);
    const trace = await aligned(createSyntheticTrace(withDeletion, { start: 250, length: 300, seed: 3 }), doc);
    const events = groupTraceMismatches(trace);
    const deletions = events.filter((event) => event.type === 'deletion');
    expect(deletions).toHaveLength(1);
    expect(deletions[0].refEnd - deletions[0].refStart).toBe(3);
  });
});

describe('attribution', () => {
  it('says nothing is wrong when nothing is wrong', async () => {
    const doc = plasmid(SEQ);
    const trace = await aligned(createSyntheticTrace(SEQ, { start: 300, length: 300, seed: 11 }), doc);
    const diagnosis = attributeSangerFailures(trace, doc);
    expect(diagnosis.aligned).toBe(true);
    expect(diagnosis.events).toHaveLength(0);
    expect(diagnosis.summary.join(' ')).toContain('没有发现差异');
  });

  it('blames the oligo when the change sits in a primer tail', async () => {
    // A PCR product keeps its primers: the forward tail is the first 12 bases.
    const doc = plasmid(SEQ, {
      topology: 'linear',
      primers: [primer({ name: 'F_BamHI', bindingStart: 12, bindingEnd: 34, tailSequence: 'GGATCCAAAAAA' })],
    });
    const mutated = SEQ.slice(0, 5) + (SEQ[5] === 'A' ? 'C' : 'A') + SEQ.slice(6);
    const trace = await aligned(createSyntheticTrace(mutated, { start: 0, length: 300, seed: 5 }), doc);
    const diagnosis = attributeSangerFailures(trace, doc);
    const finding = diagnosis.findings.find((item) => item.event?.refStart === 5);
    expect(finding?.cause).toBe('primer_tail');
    expect(finding?.primerName).toBe('F_BamHI');
    expect(finding?.suggestion).toContain('重新合成');
  });

  it('points at the primer when the change sits in its annealing footprint', async () => {
    const doc = plasmid(SEQ, { primers: [primer({ name: 'F_seq', bindingStart: 400, bindingEnd: 424 })] });
    const mutated = SEQ.slice(0, 410) + (SEQ[410] === 'G' ? 'T' : 'G') + SEQ.slice(411);
    const trace = await aligned(createSyntheticTrace(mutated, { start: 300, length: 300, seed: 9 }), doc);
    const diagnosis = attributeSangerFailures(trace, doc);
    const finding = diagnosis.findings.find((item) => item.event?.refStart === 410);
    expect(finding?.cause).toBe('primer_annealing');
    expect(finding?.primerName).toBe('F_seq');
  });

  it('reads a deletion at a supplied junction as over-digestion of the ends', async () => {
    const doc = plasmid(SEQ);
    const withDeletion = SEQ.slice(0, 500) + SEQ.slice(504);
    const trace = await aligned(createSyntheticTrace(withDeletion, { start: 350, length: 300, seed: 13 }), doc);
    const diagnosis = attributeSangerFailures(trace, doc, {
      junctions: [{ position: 500, label: 'EcoRI/HindIII' }],
    });
    const finding = diagnosis.findings.find((item) => item.event?.type === 'deletion');
    expect(finding?.cause).toBe('junction');
    expect(finding?.junctionLabel).toBe('EcoRI/HindIII');
    expect(finding?.suggestion).toContain('过度消化');
  });

  it('calls the template mixed when the read carries several double peaks', async () => {
    const doc = plasmid(SEQ);
    const trace = await aligned(
      createSyntheticTrace(SEQ, {
        start: 200,
        length: 300,
        seed: 17,
        heterozygous: [
          { index: 240, base: SEQ[240] === 'A' ? 'G' : 'A' },
          { index: 280, base: SEQ[280] === 'C' ? 'T' : 'C' },
          { index: 320, base: SEQ[320] === 'G' ? 'A' : 'G' },
        ],
      }),
      doc,
    );
    const diagnosis = attributeSangerFailures(trace, doc);
    const mixed = diagnosis.findings.find((item) => item.cause === 'mixed_template');
    expect(mixed).toBeDefined();
    expect(mixed?.event).toBeNull();
    expect(mixed?.suggestion).toContain('单克隆');
  });

  it('refuses to invent a cause, and says the junction class was not checked', async () => {
    const doc = plasmid(SEQ);
    const mutated = SEQ.slice(0, 700) + (SEQ[700] === 'T' ? 'A' : 'T') + SEQ.slice(701);
    const trace = await aligned(createSyntheticTrace(mutated, { start: 600, length: 300, seed: 23 }), doc);
    const diagnosis = attributeSangerFailures(trace, doc);
    const finding = diagnosis.findings.find((item) => item.event?.refStart === 700);
    expect(finding?.cause).toBe('unexplained');
    expect(finding?.confidence).toBe('low');
    expect(diagnosis.summary.join(' ')).toContain('没有提供连接边界坐标');
  });

  it('asks for an alignment before it says anything about the read', () => {
    const doc = plasmid(SEQ);
    const trace = createSyntheticTrace(SEQ, { start: 100, length: 200, seed: 29 });
    const diagnosis = attributeSangerFailures({ ...trace, alignment: undefined }, doc);
    expect(diagnosis.aligned).toBe(false);
    expect(diagnosis.findings).toHaveLength(0);
    expect(diagnosis.summary[0]).toContain('还没有比对');
  });
});
