// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  annealOligos,
  designAnnealedOligos,
  describeEnd,
  endsCompatible,
  findCutSites,
  makeDocument,
  resolveEnzyme,
  reverseComplement,
  simulateDigestion,
  simulateLigation,
} from './index';

const SPACER = 'GTCAGGGTTCTGGATATCTG'; // an arbitrary 20 nt sgRNA spacer

describe('annealOligos', () => {
  it('builds the sgRNA duplex the standard oligo pair is designed to give', () => {
    // The Zhang-lab layout: CACCG + spacer on top, AAAC + revcomp(spacer) + C on the bottom.
    const top = `CACCG${SPACER}`;
    const bottom = `AAAC${reverseComplement(SPACER)}C`;
    const result = annealOligos(top, bottom, { name: 'sgRNA_insert' });

    // The G of CACCG pairs with the C at the end of the bottom oligo, so the
    // duplex is 21 bp and the overhangs are the 4 nt CACC and AAAC.
    expect(result.duplexLength).toBe(SPACER.length + 1);
    expect(result.mismatchPositions).toEqual([]);
    expect(result.alternatives).toBe(0);
    expect(result.left).toMatchObject({ type: '5-prime', sequence: 'CACC' });
    expect(result.right).toMatchObject({ type: '5-prime', sequence: 'AAAC' });
    // The document holds the top strand exactly; the right overhang is on the bottom strand.
    expect(result.duplex.sequence).toBe(top);
    expect(result.duplex.topology).toBe('linear');
    expect(result.duplex.history[0].operation).toBe('oligo_annealing');
    expect(describeEnd(result.left)).toBe("5'-CACC");
  });

  it('reads a 3-prime overhang off whichever strand protrudes, and a blunt duplex as blunt', () => {
    const core = 'ATGGCTAGCTAATTCCGGAT';
    // Top strand carries four extra bases past the paired core: a 3' overhang.
    const right = annealOligos(`${core}TTTT`, reverseComplement(core));
    expect(right.left.type).toBe('blunt');
    expect(right.right).toMatchObject({ type: '3-prime', sequence: 'TTTT' });

    // Bottom oligo runs past the core at its own 3' end: a 3' overhang on the left.
    const left = annealOligos(core, `${reverseComplement(core)}GGGG`);
    expect(left.left).toMatchObject({ type: '3-prime', sequence: 'GGGG' });
    expect(left.right.type).toBe('blunt');

    const blunt = annealOligos(core, reverseComplement(core));
    expect(blunt.left.type).toBe('blunt');
    expect(blunt.right.type).toBe('blunt');
    expect(blunt.duplexLength).toBe(core.length);
    expect(blunt.warnings.some((w) => /not be directional/i.test(w))).toBe(true);
  });

  it('refuses oligos that do not pair, and reports a mismatch when one is allowed', () => {
    expect(() => annealOligos('AAAAAAAAAAAA', 'AAAAAAAAAAAA')).toThrow(/do not pair/i);

    // One wrong base in the bottom oligo: no register pairs perfectly any more.
    const core = 'ATGGCTAGCTAATTCCGGAT';
    const mutated = reverseComplement(core).replace(/^(.{6})./, '$1C');
    expect(() => annealOligos(core, mutated)).toThrow(/do not pair/i);
    const tolerant = annealOligos(core, mutated, { maxMismatches: 1 });
    expect(tolerant.duplexLength).toBe(core.length);
    expect(tolerant.mismatchPositions).toEqual([13]);
    expect(tolerant.warnings.some((w) => /mismatch/i.test(w))).toBe(true);
  });

  it('records the phosphate state the oligos were ordered with', () => {
    const top = `CACCG${SPACER}`;
    const bottom = `AAAC${reverseComplement(SPACER)}C`;
    const asOrdered = annealOligos(top, bottom);
    expect(asOrdered.left.phosphorylated).toBe(false);
    expect(asOrdered.right.phosphorylated).toBe(false);
    expect(asOrdered.warnings.some((w) => /T4 PNK/.test(w))).toBe(true);

    const kinased = annealOligos(top, bottom, { phosphorylated: true });
    expect(kinased.left.phosphorylated).toBe(true);
    expect(kinased.warnings.some((w) => /T4 PNK/.test(w))).toBe(false);
  });

  it('warns when the oligos could pair in more than one register', () => {
    // A repeat lets the same oligos slip by one unit and still pair perfectly.
    const unit = 'ATTTCGGACTGA';
    const result = annealOligos(unit.repeat(3), reverseComplement(unit.repeat(2)), {
      minDuplexLength: 12,
    });
    expect(result.alternatives).toBeGreaterThan(0);
    expect(result.warnings.some((w) => /register/i.test(w))).toBe(true);
  });
});

describe('designAnnealedOligos', () => {
  it('writes the oligo pair for a requested insert and pair of 5-prime overhangs', () => {
    const design = designAnnealedOligos({
      insert: `G${SPACER}`,
      leftOverhang: { type: '5-prime', sequence: 'CACC' },
      rightOverhang: { type: '5-prime', sequence: 'AAAC' },
      name: 'sgRNA',
    });
    expect(design.top).toBe(`CACCG${SPACER}`);
    expect(design.bottom).toBe(`AAAC${reverseComplement(SPACER)}C`);
    expect(design.result.duplexLength).toBe(SPACER.length + 1);
    expect(design.result.duplex.name).toBe('sgRNA');
  });

  it('puts 3-prime overhang bases on the strand that actually carries them', () => {
    const core = 'ATGGCTAGCTAATTCCGGAT';
    const design = designAnnealedOligos({
      insert: core,
      leftOverhang: { type: '3-prime', sequence: 'TTAA' },
      rightOverhang: { type: '3-prime', sequence: 'GGCC' },
    });
    expect(design.top).toBe(`${core}GGCC`);
    expect(design.bottom).toBe(`${reverseComplement(core)}TTAA`);
    expect(design.result.left).toMatchObject({ type: '3-prime', sequence: 'TTAA' });
    expect(design.result.right).toMatchObject({ type: '3-prime', sequence: 'GGCC' });
  });

  it('rejects an end whose overhang bases contradict its type', () => {
    expect(() =>
      designAnnealedOligos({ insert: 'ATGGCTAGCTAATTCCGGAT', leftOverhang: { type: 'blunt', sequence: 'AATT' } }),
    ).toThrow(/blunt end cannot carry/i);
    expect(() =>
      designAnnealedOligos({ insert: 'ATGGCTAGCTAATTCCGGAT', rightOverhang: { type: '5-prime', sequence: '' } }),
    ).toThrow(/needs its overhang bases/i);
  });
});

describe('an annealed duplex as a cloning fragment', () => {
  // A short linear plasmid carrying one EcoRI and one BamHI site.
  const vector = makeDocument({
    name: 'test_vector',
    sequence: `GGGGGGGGGGGAATTCTTTTTTTTTTTTTTTTTTTTGGATCCAAAAAAAAAA${'ACGT'.repeat(20)}`,
    topology: 'circular',
  });

  it('ligates into a doubly digested vector when the overhangs are the enzymes own', () => {
    const ecoRI = resolveEnzyme('EcoRI')!;
    const bamHI = resolveEnzyme('BamHI')!;
    const cuts = [
      ...findCutSites(vector.sequence, ecoRI, true),
      ...findCutSites(vector.sequence, bamHI, true),
    ];
    const fragments = simulateDigestion(vector, cuts);
    const backbone = fragments.reduce((a, b) => (a.length >= b.length ? a : b));
    expect(backbone.linearEnds).toBeDefined();

    // Ask for a duplex whose ends mirror the cut vector's, then check they really fit.
    const design = designAnnealedOligos({
      insert: 'ATGCATCACCATCACCATCACTAA',
      leftOverhang: backbone.linearEnds!.right,
      rightOverhang: backbone.linearEnds!.left,
      phosphorylated: true,
      name: 'His6_linker',
    });
    expect(endsCompatible(backbone.linearEnds!.right, design.result.left)).toBe(true);
    expect(endsCompatible(design.result.right, backbone.linearEnds!.left)).toBe(true);

    const ligation = simulateLigation([backbone, design.result.duplex], { circularize: true });
    expect(ligation.compatible).toBe(true);
    expect(ligation.product?.topology).toBe('circular');
    expect(ligation.product?.sequence).toContain('CACCATCACCATCAC');
    // The insert adds its core plus the two overhangs it reconstitutes.
    expect(ligation.product?.length).toBe(backbone.length + design.result.duplex.length);
  });
});
