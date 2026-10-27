// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type {
  OverhangEnd,
  PlasmidDocument,
  SequenceFeature,
} from '../../types/schema';
import {
  GATEWAY_ATT_SITES,
  designHomologyAssemblyPrimers,
  evaluateOligoThermodynamics,
  findPrimerBindingSites,
  makeDocument,
  reverseComplement,
  sequenceSlice,
  simulateGCCloning,
  simulateInsertFragment,
  simulateMultiSiteGatewayLR,
  type HomologyAssemblyKit,
} from './index';

function feature(
  name: string,
  start: number,
  end: number,
  type: SequenceFeature['type'] = 'misc_feature',
  strand: 1 | -1 = 1,
): SequenceFeature {
  return { id: name, name, type, start, end, strand, color: '#2563eb' };
}

function randomSequence(seed: number, length: number): string {
  let state = seed;
  const nextBase = (): string => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return 'ACGT'[state & 3];
  };
  return Array.from({ length }, nextBase).join('');
}

function sticky(type: '5-prime' | '3-prime', sequence: string, enzyme?: string): OverhangEnd {
  return { type, sequence, phosphorylated: false, sourceEnzyme: enzyme };
}

function blunt(): OverhangEnd {
  return { type: 'blunt', sequence: '', phosphorylated: false };
}

function gatewayEntry(
  name: string,
  leftName: keyof typeof GATEWAY_ATT_SITES,
  insert: string,
  rightName: keyof typeof GATEWAY_ATT_SITES,
  insertFeatures: SequenceFeature[] = [],
): PlasmidDocument {
  const left = GATEWAY_ATT_SITES[leftName];
  const right = GATEWAY_ATT_SITES[rightName];
  const backbone = 'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTA';
  const rightStart = left.length + insert.length;
  const sequence = left + insert + reverseComplement(right) + backbone;
  return makeDocument({
    name,
    sequence,
    topology: 'circular',
    features: [
      feature(leftName, 0, left.length, 'attachment_site', 1),
      ...insertFeatures.map((item) => ({
        ...item,
        start: item.start + left.length,
        end: item.end + left.length,
      })),
      feature(rightName, rightStart, rightStart + right.length, 'attachment_site', -1),
    ],
  });
}

function reverseDocument(doc: PlasmidDocument): PlasmidDocument {
  const sequence = reverseComplement(doc.sequence);
  const features = doc.features.map((item) => ({
    ...item,
    start: doc.length - item.end,
    end: doc.length - item.start,
    strand: (item.strand === -1 ? 1 : item.strand === 1 ? -1 : 0) as 1 | -1 | 0,
  }));
  return makeDocument({
    name: `${doc.name}_rc`,
    sequence,
    topology: doc.topology,
    features,
  });
}

function gatewayDestination(): PlasmidDocument {
  const backbone = 'ATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC';
  const r1Start = backbone.length;
  const r2Start = r1Start + GATEWAY_ATT_SITES.attR1.length + 60;
  const sequence =
    backbone +
    GATEWAY_ATT_SITES.attR1 +
    'CCAG'.repeat(15) +
    GATEWAY_ATT_SITES.attR2;
  return makeDocument({
    name: 'destination',
    sequence,
    topology: 'circular',
    features: [
      feature('attR1', r1Start, r1Start + GATEWAY_ATT_SITES.attR1.length, 'attachment_site', 1),
      feature('ccdB', r1Start + GATEWAY_ATT_SITES.attR1.length, r2Start, 'misc_feature'),
      feature('attR2', r2Start, r2Start + GATEWAY_ATT_SITES.attR2.length, 'attachment_site', -1),
    ],
  });
}

describe('MultiSite Gateway LR', () => {
  const gene1 = 'ATGGCTAGCGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGC';
  const gene2 = 'ATGGATCCGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGG';
  const gene3 = 'ATGTTGACCGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTACT';
  const gene4 = 'ATGCAGTCGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTACA';

  it('publishes core sequences for attB, attL and attR families 1-5', () => {
    for (let index = 1; index <= 5; index += 1) {
      expect(GATEWAY_ATT_SITES[`attB${index}` as keyof typeof GATEWAY_ATT_SITES]).toBeTruthy();
      expect(GATEWAY_ATT_SITES[`attL${index}` as keyof typeof GATEWAY_ATT_SITES]).toBeTruthy();
      expect(GATEWAY_ATT_SITES[`attR${index}` as keyof typeof GATEWAY_ATT_SITES]).toBeTruthy();
      expect(
        GATEWAY_ATT_SITES[`attB${index}` as keyof typeof GATEWAY_ATT_SITES].length,
      ).toBeGreaterThan(15);
    }
  });

  it('assembles two fragments into an expression clone', () => {
    const entry1 = gatewayEntry('entry1', 'attL1', gene1, 'attR5', [
      feature('gene1', 0, gene1.length, 'CDS'),
    ]);
    const entry2 = gatewayEntry('entry2', 'attL5', gene2, 'attL2', [
      feature('gene2', 0, gene2.length, 'CDS'),
    ]);
    const result = simulateMultiSiteGatewayLR([entry1, entry2], gatewayDestination());
    expect(result.expressionClone).not.toBeNull();
    const product = result.expressionClone!;
    expect(product.sequence).toContain(gene1);
    expect(product.sequence).toContain(gene2);
    expect(product.sequence.indexOf(gene1)).toBeLessThan(product.sequence.indexOf(gene2));
    expect(product.features.some((item) => item.name === 'attB1')).toBe(true);
    expect(product.features.some((item) => item.name === 'attB5')).toBe(true);
    expect(product.features.some((item) => item.name === 'attB2')).toBe(true);
    expect(product.history.some((node) => node.operation === 'gateway_lr')).toBe(true);
    expect(product.history[product.history.length - 1].parentSnapshots).toHaveLength(3);
  });

  it('assembles three and four fragments in biological order', () => {
    const three = simulateMultiSiteGatewayLR(
      [
        gatewayEntry('e1', 'attL1', gene1, 'attL4'),
        gatewayEntry('e2', 'attR4', gene2, 'attR3'),
        gatewayEntry('e3', 'attL3', gene3, 'attL2'),
      ],
      gatewayDestination(),
    );
    expect(three.expressionClone).not.toBeNull();
    const threeProduct = three.expressionClone!;
    expect(threeProduct.features.some((item) => item.name === 'attB4')).toBe(true);
    expect(threeProduct.features.some((item) => item.name === 'attB3')).toBe(true);
    expect(threeProduct.sequence.indexOf(gene1)).toBeLessThan(threeProduct.sequence.indexOf(gene2));
    expect(threeProduct.sequence.indexOf(gene2)).toBeLessThan(threeProduct.sequence.indexOf(gene3));

    const four = simulateMultiSiteGatewayLR(
      [
        gatewayEntry('f1', 'attL1', gene1, 'attR5'),
        gatewayEntry('f2', 'attL5', gene2, 'attL4'),
        gatewayEntry('f3', 'attR4', gene3, 'attR3'),
        gatewayEntry('f4', 'attL3', gene4, 'attL2'),
      ],
      gatewayDestination(),
    );
    expect(four.expressionClone).not.toBeNull();
    const fourProduct = four.expressionClone!;
    const order = [gene1, gene2, gene3, gene4].map((gene) => fourProduct.sequence.indexOf(gene));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const site of ['attB1', 'attB5', 'attB4', 'attB3', 'attB2']) {
      expect(fourProduct.features.some((item) => item.name === site)).toBe(true);
    }
  });

  it('uses backbone annotations to orient entry clones whose sites share a strand', () => {
    const entry1 = gatewayEntry('entry1', 'attL1', gene1, 'attR5');
    const backbone = 'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTA';
    const rightStart = GATEWAY_ATT_SITES.attL5.length + gene2.length;
    const sameStrand = makeDocument({
      name: 'entry2_same_strand',
      sequence:
        GATEWAY_ATT_SITES.attL5 +
        gene2 +
        GATEWAY_ATT_SITES.attL2 +
        backbone,
      topology: 'circular',
      features: [
        feature('attL5', 0, GATEWAY_ATT_SITES.attL5.length, 'attachment_site', 1),
        feature('gene2', GATEWAY_ATT_SITES.attL5.length, rightStart, 'CDS'),
        feature(
          'attL2',
          rightStart,
          rightStart + GATEWAY_ATT_SITES.attL2.length,
          'attachment_site',
          1,
        ),
        feature(
          'KanR',
          rightStart + GATEWAY_ATT_SITES.attL2.length + 5,
          rightStart + GATEWAY_ATT_SITES.attL2.length + 35,
          'CDS',
        ),
      ],
    });
    const forward = simulateMultiSiteGatewayLR([entry1, sameStrand], gatewayDestination());
    expect(forward.expressionClone).not.toBeNull();
    expect(forward.warnings.some((warning) => /same strand/.test(warning))).toBe(true);
    expect(forward.expressionClone!.sequence).toContain(gene2);

    const reversed = simulateMultiSiteGatewayLR(
      [entry1, reverseDocument(sameStrand)],
      gatewayDestination(),
    );
    expect(reversed.expressionClone).not.toBeNull();
    expect(reversed.warnings.some((warning) => /reverse orientation/.test(warning))).toBe(true);
    expect(reversed.expressionClone!.sequence).toContain(gene2);
  });

  it('warns but still assembles when entry clones are supplied out of order', () => {
    const entry1 = gatewayEntry('entry1', 'attL1', gene1, 'attR5');
    const entry2 = gatewayEntry('entry2', 'attL5', gene2, 'attL2');
    const swapped = simulateMultiSiteGatewayLR([entry2, entry1], gatewayDestination());
    expect(swapped.expressionClone).not.toBeNull();
    expect(swapped.warnings.some((warning) => /instead of the expected/.test(warning))).toBe(true);
    expect(swapped.expressionClone!.sequence).toContain(gene1);
    expect(swapped.expressionClone!.sequence).toContain(gene2);
  });

  it('detects and flips a reverse-oriented entry clone', () => {
    const entry1 = gatewayEntry('entry1', 'attL1', gene1, 'attR5');
    const entry2 = reverseDocument(gatewayEntry('entry2', 'attL5', gene2, 'attL2'));
    const result = simulateMultiSiteGatewayLR([entry1, entry2], gatewayDestination());
    expect(result.expressionClone).not.toBeNull();
    expect(result.warnings.some((warning) => /reverse orientation/.test(warning))).toBe(true);
    expect(result.expressionClone!.sequence).toContain(gene2);
    expect(result.expressionClone!.sequence).not.toContain(reverseComplement(gene2));
  });

  it('rejects a destination that lacks attR1 or attR2', () => {
    const destination = makeDocument({
      name: 'no_att',
      sequence: randomSequence(31, 400),
      topology: 'circular',
    });
    const entry = gatewayEntry('entry1', 'attL1', gene1, 'attR5');
    const result = simulateMultiSiteGatewayLR([entry], destination);
    expect(result.expressionClone).toBeNull();
    expect(result.warnings[0]).toContain('attR1 and attR2');
  });
});

describe('GC cloning', () => {
  const vectorSequence = randomSequence(11, 220);
  const insertSequence = randomSequence(12, 90);

  function gcVector(left: OverhangEnd, right: OverhangEnd): PlasmidDocument {
    return makeDocument({
      name: 'gc_vector',
      sequence: vectorSequence,
      topology: 'linear',
      linearEnds: { left, right },
    });
  }

  function gcInsert(sequence: string): PlasmidDocument {
    return makeDocument({
      name: 'gc_insert',
      sequence,
      topology: 'linear',
      linearEnds: { left: sticky('3-prime', 'G'), right: sticky('3-prime', 'C') },
    });
  }

  it('joins a GC-tailed insert to a GC vector', () => {
    const result = simulateGCCloning(
      gcVector(sticky('3-prime', 'G'), sticky('3-prime', 'C')),
      gcInsert(insertSequence),
    );
    expect(result.product).not.toBeNull();
    expect(result.orientation).toBe('forward');
    expect(result.product!.sequence).toBe(vectorSequence + insertSequence);
    expect(result.product!.length).toBe(vectorSequence.length + insertSequence.length);
    expect(
      result.product!.history.some((node) => /GC cloning/.test(node.description)),
    ).toBe(true);
  });

  it('supports the reverse insert orientation', () => {
    const result = simulateGCCloning(
      gcVector(sticky('3-prime', 'G'), sticky('3-prime', 'C')),
      gcInsert(insertSequence),
      { orientation: 'reverse' },
    );
    expect(result.product).not.toBeNull();
    expect(result.orientation).toBe('reverse');
    expect(result.product!.sequence).toBe(vectorSequence + reverseComplement(insertSequence));
  });

  it('rejects a circular vector and non-GC overhangs', () => {
    const circular = makeDocument({
      name: 'circular',
      sequence: vectorSequence,
      topology: 'circular',
    });
    const circularResult = simulateGCCloning(circular, gcInsert(insertSequence));
    expect(circularResult.product).toBeNull();
    expect(circularResult.warnings[0]).toContain('linear vector');

    const tVector = gcVector(sticky('3-prime', 'T'), sticky('3-prime', 'T'));
    const tResult = simulateGCCloning(tVector, gcInsert(insertSequence));
    expect(tResult.product).toBeNull();
    expect(tResult.warnings[0]).toContain('G or C');
  });

  it('warns when the insert ends are not annotated but still assembles', () => {
    const plainInsert = makeDocument({
      name: 'plain_insert',
      sequence: insertSequence,
      topology: 'linear',
      linearEnds: { left: blunt(), right: blunt() },
    });
    const result = simulateGCCloning(
      gcVector(sticky('3-prime', 'G'), sticky('3-prime', 'C')),
      plainInsert,
    );
    expect(result.product).not.toBeNull();
    expect(result.warnings.some((warning) => /not annotated/.test(warning))).toBe(true);
  });
});

describe('homology assembly primer design', () => {
  const fragments = [
    makeDocument({ name: 'fragA', sequence: randomSequence(21, 320), topology: 'linear' }),
    makeDocument({ name: 'fragB', sequence: randomSequence(22, 280), topology: 'linear' }),
    makeDocument({ name: 'fragC', sequence: randomSequence(23, 360), topology: 'linear' }),
  ];

  function expectArmRange(kit: HomologyAssemblyKit, length: number): void {
    if (kit === 'Gibson') {
      expect(length).toBeGreaterThanOrEqual(20);
      expect(length).toBeLessThanOrEqual(40);
    } else if (kit === 'NEBuilder HiFi') {
      expect(length).toBeGreaterThanOrEqual(15);
      expect(length).toBeLessThanOrEqual(35);
    } else {
      expect(length).toBe(15);
    }
  }

  it('designs circular Gibson primers with both junction arms', () => {
    const result = designHomologyAssemblyPrimers(fragments, 'Gibson', { circular: true });
    expect(result.primers).toHaveLength(3);
    for (let index = 0; index < result.primers.length; index += 1) {
      const entry = result.primers[index];
      const previous = fragments[(index - 1 + fragments.length) % fragments.length];
      const next = fragments[(index + 1) % fragments.length];
      expect(entry.fragmentId).toBe(fragments[index].id);
      expect(entry.forward.bindingStart).toBe(0);
      expect(entry.reverse.bindingEnd).toBe(fragments[index].length);
      expectArmRange('Gibson', entry.forward.tailSequence.length);
      expectArmRange('Gibson', entry.reverse.tailSequence.length);
      expect(previous.sequence.endsWith(entry.forward.tailSequence)).toBe(true);
      expect(next.sequence.startsWith(reverseComplement(entry.reverse.tailSequence))).toBe(true);
      expect(evaluateOligoThermodynamics(entry.forward.tailSequence).tm).toBeGreaterThanOrEqual(48);
      expect(evaluateOligoThermodynamics(entry.reverse.tailSequence).tm).toBeGreaterThanOrEqual(48);
      expect(entry.forward.tmAnnealing).toBeGreaterThanOrEqual(58);
      expect(entry.forward.tmAnnealing).toBeLessThanOrEqual(62);
    }
  });

  it('omits the outer tails for a linear assembly', () => {
    const result = designHomologyAssemblyPrimers(fragments, 'NEBuilder HiFi', {
      circular: false,
    });
    expect(result.primers).toHaveLength(3);
    expect(result.primers[0].forward.tailSequence).toBe('');
    expect(result.primers[2].reverse.tailSequence).toBe('');
    expect(result.primers[0].reverse.tailSequence.length).toBeGreaterThanOrEqual(15);
    expect(result.primers[1].forward.tailSequence.length).toBeGreaterThanOrEqual(15);
    for (const entry of result.primers) {
      if (entry.forward.tailSequence) {
        expectArmRange('NEBuilder HiFi', entry.forward.tailSequence.length);
      }
      if (entry.reverse.tailSequence) {
        expectArmRange('NEBuilder HiFi', entry.reverse.tailSequence.length);
      }
    }
  });

  it('uses fixed 15 bp arms for In-Fusion and warns when overridden', () => {
    const result = designHomologyAssemblyPrimers(fragments, 'In-Fusion', {
      circular: true,
      overlapLength: 25,
    });
    for (const entry of result.primers) {
      expect(entry.forward.tailSequence.length).toBe(15);
      expect(entry.reverse.tailSequence.length).toBe(15);
    }
    expect(result.warnings.some((warning) => /fixed 15 bp/.test(warning))).toBe(true);
  });

  it('returns an empty primer list for an empty fragment array', () => {
    const result = designHomologyAssemblyPrimers([], 'Gibson');
    expect(result.primers).toHaveLength(0);
    expect(result.warnings.length).toBe(1);
  });
});

describe('insert fragment simulation', () => {
  const baseSequence =
    'AAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCCGGGGTTTTAAAACCCCGGGGTTTT';

  it('replaces a range and migrates, truncates or removes features', () => {
    const vector = makeDocument({
      name: 'vector',
      sequence: baseSequence,
      topology: 'linear',
      features: [
        feature('before', 5, 20),
        feature('removed', 30, 50),
        feature('left_boundary', 25, 35),
        feature('right_boundary', 45, 60),
        feature('after', 70, 85),
      ],
    });
    const insertSequence = 'ACGTACGTAC';
    const insert = makeDocument({
      name: 'insert',
      sequence: insertSequence,
      topology: 'linear',
      features: [feature('payload', 0, insertSequence.length, 'CDS')],
    });
    const result = simulateInsertFragment(vector, { start: 30, end: 50 }, insert);
    const product = result.product;
    expect(product.length).toBe(baseSequence.length - 20 + insertSequence.length);
    expect(product.sequence.slice(0, 30)).toBe(baseSequence.slice(0, 30));
    expect(product.sequence.slice(30, 40)).toBe(insertSequence);
    expect(product.sequence.slice(40)).toBe(baseSequence.slice(50));
    expect(product.features.some((item) => item.name === 'removed')).toBe(false);
    const left = product.features.find((item) => item.name === 'left_boundary')!;
    expect(left.start).toBe(25);
    expect(left.end).toBe(30);
    expect(left.notes?.truncated?.length).toBeGreaterThan(0);
    const right = product.features.find((item) => item.name === 'right_boundary')!;
    expect(right.start).toBe(40);
    expect(right.end).toBe(50);
    expect(right.notes?.truncated?.length).toBeGreaterThan(0);
    const after = product.features.find((item) => item.name === 'after')!;
    expect(after.start).toBe(60);
    expect(after.end).toBe(75);
    const payload = product.features.find((item) => item.name === 'payload')!;
    expect(payload.start).toBe(30);
    expect(payload.end).toBe(40);
    expect(product.history.some((node) => /Inserted 10 bp/.test(node.description))).toBe(true);
    expect(product.history[product.history.length - 1].operation).toBe('restriction_ligation');
  });

  it('preserves unaffected multi-segment features and truncates affected segments', () => {
    const vector = makeDocument({
      name: 'multi_vector',
      sequence: baseSequence,
      topology: 'linear',
      features: [
        {
          ...feature('multi_intact', 10, 40),
          notes: { segments: ['10-20', '30-40'] },
        },
        {
          ...feature('multi_truncated', 40, 80),
          notes: { segments: ['40-50', '70-80'] },
        },
      ],
    });
    const insert = makeDocument({
      name: 'insert',
      sequence: 'GGGG',
      topology: 'linear',
    });
    const result = simulateInsertFragment(vector, { start: 45, end: 55 }, insert);
    const intact = result.product.features.find((item) => item.name === 'multi_intact')!;
    expect(intact.notes?.segments).toEqual(['10-20', '30-40']);
    const truncated = result.product.features.find(
      (item) => item.name === 'multi_truncated',
    )!;
    expect(truncated.start).toBe(40);
    expect(truncated.notes?.truncated?.length).toBeGreaterThan(0);
    expect(truncated.notes?.segments).toBeDefined();
    expect(truncated.notes?.segments?.length).toBe(2);
    expect(truncated.notes?.segments?.[0]).toBe('40-45');
    expect(truncated.notes?.segments?.[1]).toBe('64-74');
  });

  it('performs a pure insertion and extends features that contain the insertion point', () => {
    const vector = makeDocument({
      name: 'vector',
      sequence: baseSequence,
      topology: 'linear',
      features: [feature('spanning', 30, 60), feature('after', 70, 85)],
    });
    const insert = makeDocument({
      name: 'insert',
      sequence: 'GGGGCCCC',
      topology: 'linear',
    });
    const result = simulateInsertFragment(vector, { start: 40, end: 40 }, insert);
    expect(result.product.length).toBe(baseSequence.length + 8);
    const spanning = result.product.features.find((item) => item.name === 'spanning')!;
    expect(spanning.start).toBe(30);
    expect(spanning.end).toBe(68);
    expect(spanning.notes?.insertion?.length).toBeGreaterThan(0);
    const after = result.product.features.find((item) => item.name === 'after')!;
    expect(after.start).toBe(78);
    expect(after.end).toBe(93);
  });

  it('replaces a circular range that crosses the origin', () => {
    const vector = makeDocument({
      name: 'circular_vector',
      sequence: baseSequence,
      topology: 'circular',
      features: [
        feature('retained_start', 10, 30),
        feature('middle', 40, 50),
        feature('retained_end', 85, 95),
        feature('crossing_origin', 95, 5),
      ],
    });
    const insert = makeDocument({
      name: 'insert',
      sequence: 'TTTTAAAA',
      topology: 'linear',
    });
    const result = simulateInsertFragment(vector, { start: 90, end: 20 }, insert);
    expect(result.product.length).toBe(baseSequence.length - 58 + 8);
    expect(result.product.sequence).toBe(baseSequence.slice(20, 90) + 'TTTTAAAA');
    expect(result.product.features.some((item) => item.name === 'crossing_origin')).toBe(false);
    const startFeature = result.product.features.find(
      (item) => item.name === 'retained_start',
    )!;
    expect(startFeature.start).toBe(0);
    expect(startFeature.end).toBe(10);
    const endFeature = result.product.features.find((item) => item.name === 'retained_end')!;
    expect(endFeature.start).toBe(65);
    expect(endFeature.end).toBe(70);
    const middle = result.product.features.find((item) => item.name === 'middle')!;
    expect(middle.start).toBe(20);
    expect(middle.end).toBe(30);
  });

  it('reverses the inserted fragment and its annotations when requested', () => {
    const vector = makeDocument({
      name: 'vector',
      sequence: baseSequence,
      topology: 'linear',
    });
    const insertSequence = 'ATGCGTACGT';
    const insert = makeDocument({
      name: 'insert',
      sequence: insertSequence,
      topology: 'linear',
      features: [feature('cds', 0, insertSequence.length, 'CDS', 1)],
    });
    const result = simulateInsertFragment(vector, { start: 20, end: 30 }, insert, undefined, {
      reverseInsert: true,
    });
    expect(result.product.sequence.slice(20, 30)).toBe(reverseComplement(insertSequence));
    const cds = result.product.features.find((item) => item.name === 'cds')!;
    expect(cds.start).toBe(20);
    expect(cds.end).toBe(30);
    expect(cds.strand).toBe(-1);
  });
});

describe('primer binding site search', () => {
  const templateSequence = randomSequence(41, 300);

  function template(topology: 'linear' | 'circular' = 'linear'): PlasmidDocument {
    return makeDocument({ name: 'template', sequence: templateSequence, topology });
  }

  it('finds a forward binding site with an exact match', () => {
    const primer = templateSequence.slice(50, 80);
    const hits = findPrimerBindingSites(template(), primer);
    const hit = hits.find((item) => item.start === 50 && item.strand === 1);
    expect(hit).toBeDefined();
    expect(hit!.end).toBe(80);
    expect(hit!.mismatches).toBe(0);
    expect(hit!.threePrimeMatchLength).toBe(30);
    expect(hit!.tmAnnealing).toBeGreaterThan(0);
  });

  it('finds a reverse-strand binding site', () => {
    const primer = reverseComplement(templateSequence.slice(100, 130));
    const hits = findPrimerBindingSites(template(), primer);
    const hit = hits.find((item) => item.start === 100 && item.strand === -1);
    expect(hit).toBeDefined();
    expect(hit!.end).toBe(130);
    expect(hit!.mismatches).toBe(0);
    expect(hit!.threePrimeMatchLength).toBe(30);
  });

  it('ignores a non-annealing 5-prime tail', () => {
    const tail = 'CAACCACA';
    const primer = tail + templateSequence.slice(150, 180);
    const hits = findPrimerBindingSites(template(), primer);
    const hit = hits.find((item) => item.end === 180 && item.strand === 1);
    expect(hit).toBeDefined();
    expect(hit!.mismatches).toBe(0);
    expect(hit!.start).toBe(150);
    expect(hit!.threePrimeMatchLength).toBe(30);
  });

  it('reports internal mismatches while requiring an exact 3-prime end', () => {
    const region = templateSequence.slice(200, 230);
    const original = region[10];
    const replacement = original === 'A' ? 'C' : 'A';
    const primer = `${region.slice(0, 10)}${replacement}${region.slice(11)}`;
    const hits = findPrimerBindingSites(template(), primer, { maxMismatches: 1 });
    const hit = hits.find((item) => item.start === 200 && item.strand === 1);
    expect(hit).toBeDefined();
    expect(hit!.mismatches).toBe(1);
    expect(hit!.mismatchPositions).toEqual([210]);
    expect(hit!.threePrimeMatchLength).toBeGreaterThanOrEqual(10);
  });

  it('does not report a site when the 3-prime terminal base mismatches', () => {
    const region = templateSequence.slice(200, 230);
    const last = region[region.length - 1];
    const replacement = last === 'A' ? 'C' : 'A';
    const primer = region.slice(0, -1) + replacement;
    const hits = findPrimerBindingSites(template(), primer, { maxMismatches: 2 });
    expect(hits.some((item) => item.start === 200 && item.strand === 1)).toBe(false);
  });

  it('finds a circular site that crosses the origin', () => {
    const spanning = sequenceSlice(templateSequence, 290, 10, true);
    const hits = findPrimerBindingSites(template('circular'), spanning, { maxMismatches: 0 });
    const hit = hits.find((item) => item.start === 290 && item.strand === 1);
    expect(hit).toBeDefined();
    expect(hit!.end).toBe(10);
    expect(hit!.mismatches).toBe(0);
  });

  it('sorts hits by mismatches', () => {
    const exact = templateSequence.slice(50, 80);
    const hits = findPrimerBindingSites(template(), exact, { maxMismatches: 2 });
    for (let index = 1; index < hits.length; index += 1) {
      expect(hits[index].mismatches).toBeGreaterThanOrEqual(hits[index - 1].mismatches);
    }
  });
});
