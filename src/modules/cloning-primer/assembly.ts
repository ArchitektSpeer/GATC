// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  CloningHistoryNode,
  OverhangEnd,
  PlasmidDocument,
  Primer,
  SequenceFeature,
} from '../../types/schema';
import { COMMON_ENZYMES } from './enzymes';
import { designPrimerPair } from './primer';
import { evaluateOligoThermodynamics } from './thermo';
import {
  appendHistory,
  clamp,
  cloneDocument,
  cloneFeature,
  cloneHistoryNode,
  clonePrimer,
  copyOverhang,
  makeDocument,
  makeHistoryNode,
  normalizeDNA,
  nowIso,
  reverseComplement,
  shiftFeature,
  shiftPrimer,
  sliceDocumentData,
  uid,
} from './utils';

export interface CloningProductResult {
  product: PlasmidDocument | null;
  orientation?: 'forward' | 'reverse';
  warnings: string[];
}

export const LIC_DEFAULT_TAILS = {
  forward: 'GACGACGACAAG',
  reverse: 'GAGGAGAAGCCCGGT',
} as const;

const LIC_MIN_TAIL = 6;
const LIC_MAX_TAIL = 30;

function parentSnapshot(
  doc: PlasmidDocument,
): NonNullable<CloningHistoryNode['parentSnapshots']>[number] {
  return { id: doc.id, name: doc.name, length: doc.length };
}

function cloneFeatures(features: SequenceFeature[]): SequenceFeature[] {
  return features.map(cloneFeature);
}

function clonePrimers(primers: Primer[]): Primer[] {
  return primers.map(clonePrimer);
}

function endOverhang(
  doc: PlasmidDocument,
  side: 'left' | 'right',
): OverhangEnd | undefined {
  return side === 'left' ? doc.linearEnds?.left : doc.linearEnds?.right;
}

function isBluntEnd(end: OverhangEnd | undefined): boolean {
  if (!end) return true;
  return end.type === 'blunt' && !normalizeDNA(end.sequence);
}

function hasSimpleOverhang(
  end: OverhangEnd | undefined,
  type: OverhangEnd['type'],
  sequence: string,
): boolean {
  if (!end) return false;
  return end.type === type && normalizeDNA(end.sequence) === normalizeDNA(sequence);
}

function hasTTails(vector: PlasmidDocument): boolean {
  return (
    hasSimpleOverhang(endOverhang(vector, 'left'), '3-prime', 'T') &&
    hasSimpleOverhang(endOverhang(vector, 'right'), '3-prime', 'T')
  );
}

function hasAEnds(insert: PlasmidDocument): boolean {
  return (
    hasSimpleOverhang(endOverhang(insert, 'left'), '3-prime', 'A') &&
    hasSimpleOverhang(endOverhang(insert, 'right'), '3-prime', 'A')
  );
}

function overhangSequence(end: OverhangEnd | undefined): string {
  if (!end || end.type === 'blunt') return '';
  return normalizeDNA(end.sequence);
}

function hasGTGGOverhang(doc: PlasmidDocument): boolean {
  return (
    overhangSequence(endOverhang(doc, 'left')) === 'GTGG' ||
    overhangSequence(endOverhang(doc, 'right')) === 'GTGG'
  );
}

function hasCACCLead(insert: PlasmidDocument): boolean {
  if (insert.sequence.startsWith('CACC')) return true;
  return overhangSequence(endOverhang(insert, 'left')) === 'CACC';
}

function firstCds(doc: PlasmidDocument): SequenceFeature | undefined {
  return doc.features
    .filter((feature) => feature.type === 'CDS')
    .slice()
    .sort((a, b) => a.start - b.start)[0];
}

function referenceStrand(vector: PlasmidDocument): 1 | -1 | undefined {
  const lacZ = vector.features.find((feature) => /lac\s*z/i.test(feature.name));
  if (lacZ) return lacZ.strand === -1 ? -1 : 1;
  const promoter = vector.features.find((feature) => feature.type === 'promoter');
  if (promoter) return promoter.strand === -1 ? -1 : 1;
  return undefined;
}

function chooseOrientation(
  vector: PlasmidDocument,
  insert: PlasmidDocument,
  requested?: 'forward' | 'reverse',
): 'forward' | 'reverse' {
  if (requested) return requested;
  const cds = firstCds(insert);
  const reference = referenceStrand(vector);
  if (!cds || !reference) return 'forward';
  const forwardStrand: 1 | -1 = cds.strand === -1 ? -1 : 1;
  const reverseStrand: 1 | -1 = forwardStrand === 1 ? -1 : 1;
  if (forwardStrand === reference) return 'forward';
  if (reverseStrand === reference) return 'reverse';
  return 'forward';
}

interface InsertSegment {
  sequence: string;
  features: SequenceFeature[];
  primers: Primer[];
}

function orientedInsert(insert: PlasmidDocument, reverse: boolean): InsertSegment {
  const data = sliceDocumentData(insert, 0, insert.length, {
    circular: false,
    reverse,
  });
  return {
    sequence: reverse ? reverseComplement(data.sequence) : data.sequence,
    features: data.features,
    primers: data.primers,
  };
}

function buildInsertionProduct(
  vector: PlasmidDocument,
  insert: PlasmidDocument,
  reverse: boolean,
  description: string,
  enzymesUsed?: string[],
): PlasmidDocument {
  const insertData = orientedInsert(insert, reverse);
  const vectorLength = vector.sequence.length;
  const sequence = vector.sequence + insertData.sequence;
  const features = [
    ...cloneFeatures(vector.features),
    ...insertData.features.map((feature) => shiftFeature(feature, vectorLength)),
  ];
  const primers = [
    ...clonePrimers(vector.primers),
    ...insertData.primers.map((primer) => shiftPrimer(primer, vectorLength)),
  ];
  const product = makeDocument({
    name: `${vector.name}_${insert.name}`,
    sequence,
    topology: 'circular',
    features,
    primers,
    history: [
      ...vector.history.map(cloneHistoryNode),
      ...insert.history.map(cloneHistoryNode),
    ],
    methylationProfile: vector.methylationProfile,
    description: vector.description,
  });
  appendHistory(
    product,
    makeHistoryNode('restriction_ligation', description, {
      enzymesUsed,
      parentSnapshots: [parentSnapshot(vector), parentSnapshot(insert)],
    }),
  );
  return product;
}

function taLikeCloning(
  vector: PlasmidDocument,
  insert: PlasmidDocument,
  opts: { orientation?: 'forward' | 'reverse' } | undefined,
  method: string,
  descriptionPrefix: string,
): CloningProductResult {
  const warnings: string[] = [];
  if (vector.topology === 'circular') {
    warnings.push(
      `${method} requires a linear vector; linearize the vector first to expose its 3-prime T overhangs.`,
    );
    return { product: null, warnings };
  }
  if (!hasTTails(vector)) {
    warnings.push(
      `${method} requires a linear vector with 3-prime T overhangs on both ends.`,
    );
    return { product: null, warnings };
  }
  if (insert.topology === 'circular') {
    warnings.push(`${method} requires a linear insert; provide a linear A-tailed PCR product.`);
    return { product: null, warnings };
  }
  if (!hasAEnds(insert)) {
    warnings.push(
      'Insert ends are not annotated as 3-prime A overhangs; treating the insert as a Taq A-tailed product.',
    );
  }
  const orientation = chooseOrientation(vector, insert, opts?.orientation);
  const product = buildInsertionProduct(
    vector,
    insert,
    orientation === 'reverse',
    `${descriptionPrefix} into ${vector.name}`,
  );
  return { product, orientation, warnings };
}

export function addATailing(pcrProduct: PlasmidDocument): PlasmidDocument {
  const result = cloneDocument(pcrProduct);
  result.topology = 'linear';
  const tail: OverhangEnd = {
    type: '3-prime',
    sequence: 'A',
    phosphorylated: false,
    sourceEnzyme: 'Taq',
  };
  result.linearEnds = { left: copyOverhang(tail), right: copyOverhang(tail) };
  result.updatedAt = nowIso();
  appendHistory(
    result,
    makeHistoryNode('restriction_ligation', `Taq 3-prime A tailing of ${pcrProduct.name}.`, {
      enzymesUsed: ['Taq'],
      parentSnapshots: [parentSnapshot(pcrProduct)],
    }),
  );
  return result;
}

export function simulateTACloning(
  vector: PlasmidDocument,
  insert: PlasmidDocument,
  opts?: { orientation?: 'forward' | 'reverse' },
): CloningProductResult {
  return taLikeCloning(vector, insert, opts, 'TA cloning', 'TA cloning');
}

function isGCSingleBaseOverhang(end: OverhangEnd | undefined): boolean {
  if (!end || end.type !== '3-prime') return false;
  const sequence = normalizeDNA(end.sequence);
  return sequence.length === 1 && (sequence === 'G' || sequence === 'C');
}

/**
 * Simulates Lucigen GC cloning. Like TA cloning, the linear vector presents
 * single-base 3-prime overhangs, but the overhangs are G or C instead of T;
 * the insert must carry the corresponding 3-prime G/C overhangs.
 */
export function simulateGCCloning(
  vector: PlasmidDocument,
  insert: PlasmidDocument,
  opts?: { orientation?: 'forward' | 'reverse' },
): CloningProductResult {
  const warnings: string[] = [];
  if (vector.topology === 'circular') {
    warnings.push(
      'GC cloning requires a linear vector; linearize the vector first to expose its 3-prime G/C overhangs.',
    );
    return { product: null, warnings };
  }
  if (
    !isGCSingleBaseOverhang(endOverhang(vector, 'left')) ||
    !isGCSingleBaseOverhang(endOverhang(vector, 'right'))
  ) {
    warnings.push(
      'GC cloning requires a linear vector with single-base 3-prime G or C overhangs on both ends.',
    );
    return { product: null, warnings };
  }
  if (insert.topology === 'circular') {
    warnings.push('GC cloning requires a linear insert; provide a linear GC-tailed PCR product.');
    return { product: null, warnings };
  }
  if (
    !isGCSingleBaseOverhang(endOverhang(insert, 'left')) ||
    !isGCSingleBaseOverhang(endOverhang(insert, 'right'))
  ) {
    warnings.push(
      'Insert ends are not annotated as 3-prime G/C overhangs; treating the insert as a GC-tailed product.',
    );
  }
  const orientation = chooseOrientation(vector, insert, opts?.orientation);
  const product = buildInsertionProduct(
    vector,
    insert,
    orientation === 'reverse',
    `GC cloning into ${vector.name}`,
  );
  return { product, orientation, warnings };
}

export function simulateTOPOCloning(
  vector: PlasmidDocument,
  insert: PlasmidDocument,
  kind: 'TA' | 'blunt' | 'directional',
  opts?: { orientation?: 'forward' | 'reverse' },
): CloningProductResult {
  if (kind === 'TA') {
    return taLikeCloning(vector, insert, opts, 'TOPO TA cloning', 'TOPO TA cloning');
  }
  const warnings: string[] = [];
  if (vector.topology === 'circular') {
    warnings.push(
      `TOPO ${kind} cloning requires a linear vector; linearize the vector first.`,
    );
    return { product: null, warnings };
  }
  if (kind === 'blunt') {
    if (!isBluntEnd(endOverhang(vector, 'left')) || !isBluntEnd(endOverhang(vector, 'right'))) {
      warnings.push('TOPO blunt cloning requires blunt ends on both sides of the vector.');
      return { product: null, warnings };
    }
    if (insert.topology === 'circular') {
      warnings.push('TOPO blunt cloning requires a linear insert.');
      return { product: null, warnings };
    }
    if (!isBluntEnd(endOverhang(insert, 'left')) || !isBluntEnd(endOverhang(insert, 'right'))) {
      warnings.push('TOPO blunt cloning requires blunt ends on both sides of the insert.');
      return { product: null, warnings };
    }
    const orientation: 'forward' | 'reverse' = opts?.orientation ?? 'forward';
    const product = buildInsertionProduct(
      vector,
      insert,
      orientation === 'reverse',
      `TOPO blunt cloning into ${vector.name}`,
    );
    return { product, orientation, warnings };
  }
  if (!hasGTGGOverhang(vector)) {
    warnings.push('Directional TOPO cloning requires a GTGG overhang on the vector.');
    return { product: null, warnings };
  }
  if (insert.topology === 'circular') {
    warnings.push('Directional TOPO cloning requires a linear insert.');
    return { product: null, warnings };
  }
  if (!hasCACCLead(insert)) {
    warnings.push('Directional TOPO cloning requires the insert 5-prime end to start with CACC.');
    return { product: null, warnings };
  }
  if (opts?.orientation === 'reverse') {
    warnings.push('Directional TOPO cloning has a fixed insert orientation; the reverse request was ignored.');
  }
  const product = buildInsertionProduct(
    vector,
    insert,
    false,
    `Directional TOPO cloning into ${vector.name}`,
  );
  return { product, orientation: 'forward', warnings };
}

function terminalTail(doc: PlasmidDocument, side: 'left' | 'right', window: number): string {
  const overhang = endOverhang(doc, side);
  if (overhang && overhang.type !== 'blunt' && overhang.sequence) {
    return normalizeDNA(overhang.sequence);
  }
  const sequence = normalizeDNA(doc.sequence);
  if (!sequence.length) return '';
  const length = Math.min(sequence.length, Math.max(window, LIC_DEFAULT_TAILS.reverse.length));
  return side === 'left' ? sequence.slice(0, length) : sequence.slice(sequence.length - length);
}

function tailPairAnneals(a: string, b: string, window: number): boolean {
  if (!a.length || !b.length) return false;
  if (Math.min(a.length, b.length, window) < LIC_MIN_TAIL) return false;
  if (a.length === b.length) {
    if (a === b || a === normalizeDNA(reverseComplement(b))) return true;
    const size = Math.min(window, a.length);
    const aPrefix = a.slice(0, size);
    const bPrefix = b.slice(0, size);
    return (
      aPrefix === bPrefix ||
      aPrefix === normalizeDNA(reverseComplement(bPrefix))
    );
  }
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  const reverse = normalizeDNA(reverseComplement(shorter));
  return (
    longer.startsWith(shorter) ||
    longer.endsWith(shorter) ||
    longer.startsWith(reverse) ||
    longer.endsWith(reverse)
  );
}

function licOrientationMatches(
  vector: PlasmidDocument,
  insert: PlasmidDocument,
  reverse: boolean,
  window: number,
): boolean {
  const vectorLeft = terminalTail(vector, 'left', window);
  const vectorRight = terminalTail(vector, 'right', window);
  const insertLeft = terminalTail(insert, 'left', window);
  const insertRight = terminalTail(insert, 'right', window);
  if (reverse) {
    return (
      tailPairAnneals(vectorRight, reverseComplement(insertRight), window) &&
      tailPairAnneals(reverseComplement(insertLeft), vectorLeft, window)
    );
  }
  return (
    tailPairAnneals(vectorRight, insertLeft, window) &&
    tailPairAnneals(insertRight, vectorLeft, window)
  );
}

export function simulateLIC(
  vector: PlasmidDocument,
  insert: PlasmidDocument,
  opts?: { vectorEnzyme?: string; tailLength?: number },
): CloningProductResult {
  const warnings: string[] = [];
  const requestedTailLength = opts?.tailLength;
  const tailLength = clamp(
    Math.round(requestedTailLength ?? LIC_DEFAULT_TAILS.forward.length),
    LIC_MIN_TAIL,
    LIC_MAX_TAIL,
  );
  const matchWindow =
    requestedTailLength === undefined ? Number.POSITIVE_INFINITY : tailLength;
  if (vector.topology === 'circular') {
    warnings.push('LIC requires a linear vector; linearize the vector before T4 DNA polymerase treatment.');
    return { product: null, warnings };
  }
  if (insert.topology === 'circular') {
    warnings.push('LIC requires a linear insert; provide a linear PCR product with LIC tails.');
    return { product: null, warnings };
  }
  const forwardMatch = licOrientationMatches(vector, insert, false, matchWindow);
  const reverseMatch = licOrientationMatches(vector, insert, true, matchWindow);
  if (!forwardMatch && !reverseMatch) {
    const vectorLeft = terminalTail(vector, 'left', tailLength);
    const vectorRight = terminalTail(vector, 'right', tailLength);
    const insertLeft = terminalTail(insert, 'left', tailLength);
    const insertRight = terminalTail(insert, 'right', tailLength);
    warnings.push(
      `LIC tail mismatch: vector ${vectorLeft}/${vectorRight} and insert ${insertLeft}/${insertRight} are not complementary and do not anneal.`,
    );
    return { product: null, warnings };
  }
  const orientation: 'forward' | 'reverse' =
    forwardMatch && !reverseMatch ? 'forward' : reverseMatch && !forwardMatch ? 'reverse' : 'forward';
  const enzymeName = opts?.vectorEnzyme
    ? COMMON_ENZYMES.find(
        (candidate) => candidate.name.toLowerCase() === opts.vectorEnzyme!.toLowerCase(),
      )?.name ?? opts.vectorEnzyme
    : undefined;
  const product = buildInsertionProduct(
    vector,
    insert,
    orientation === 'reverse',
    `LIC cloning into ${vector.name}${enzymeName ? ` (${enzymeName})` : ''}`,
    enzymeName ? [enzymeName] : undefined,
  );
  return { product, orientation, warnings };
}

function addTail(primer: Primer, tail: string, name: string): Primer {
  const tailSequence = normalizeDNA(tail);
  const annealing = primer.sequence.slice(primer.tailSequence.length);
  const fullSequence = tailSequence + annealing;
  const fullThermo = evaluateOligoThermodynamics(fullSequence);
  const annealingThermo = evaluateOligoThermodynamics(annealing);
  return {
    ...clonePrimer(primer),
    id: primer.id || uid('primer'),
    name,
    sequence: fullSequence,
    tailSequence,
    tmAnnealing: annealingThermo.tm,
    tmTotal: fullThermo.tm,
    gcPercent: fullThermo.gcPercent,
    has3PrimeGCClamp: fullThermo.has3PrimeGCClamp,
    hairpinDeltaG: fullThermo.hairpinDeltaG,
    selfDimerDeltaG: fullThermo.selfDimerDeltaG,
    mismatches: primer.mismatches ? [...primer.mismatches] : undefined,
  };
}

export function designLICPrimers(
  template: PlasmidDocument,
  range: { start: number; end: number },
  vectorTails?: { forward: string; reverse: string },
): { forward: Primer; reverse: Primer } {
  const pair = designPrimerPair(template, range, { targetTm: 60 });
  const forwardTail = normalizeDNA(vectorTails?.forward ?? LIC_DEFAULT_TAILS.forward);
  const reverseTail = normalizeDNA(vectorTails?.reverse ?? LIC_DEFAULT_TAILS.reverse);
  return {
    forward: addTail(pair.forward, forwardTail, `${template.name}_LIC_F`),
    reverse: addTail(pair.reverse, reverseTail, `${template.name}_LIC_R`),
  };
}
