// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  CloningHistoryNode,
  CutSite,
  OverhangEnd,
  PlasmidDocument,
  Primer,
  RestrictionEnzyme,
  SequenceFeature,
} from '../../types/schema';
import {
  COMMON_ENZYMES,
  cutCoordinates,
  cutEnds,
  endsCompatible,
  findCutSites,
  isTypeIIS,
  reverseEnd,
  scoreOverhang,
} from './enzymes';
import { buildPrimer, designPrimerPair, type PrimerDesignOptions } from './primer';
import { evaluateOligoThermodynamics, type ReactionConditions } from './thermo';
import {
  appendHistory,
  applySequenceMutation,
  bluntOverhang,
  clamp,
  cloneDocument,
  cloneFeature,
  cloneHistoryNode,
  clonePrimer,
  copyOverhang,
  findMotifOnBothStrands,
  gcPercentOf,
  makeDocument,
  makeHistoryNode,
  mod,
  normalizeDNA,
  nowIso,
  rangeLength,
  reverseComplement,
  sequenceSlice,
  shiftFeature,
  shiftPrimer,
  sliceDocumentData,
  uid,
  type SlicedDocumentData,
} from './utils';

function cloneFeatures(features: SequenceFeature[]): SequenceFeature[] {
  return features.map(cloneFeature);
}

function clonePrimers(primers: Primer[]): Primer[] {
  return primers.map(clonePrimer);
}

function parentSnapshot(doc: PlasmidDocument, range?: [number, number]): NonNullable<CloningHistoryNode['parentSnapshots']>[number] {
  return { id: doc.id, name: doc.name, length: doc.length, extractedRange: range };
}

function linearDocFromData(
  source: PlasmidDocument,
  data: SlicedDocumentData,
  name: string,
  ends: { left: OverhangEnd; right: OverhangEnd },
  operation: CloningHistoryNode['operation'],
  description: string,
  enzymesUsed?: string[],
): PlasmidDocument {
  const doc = makeDocument({
    name,
    sequence: data.sequence,
    topology: 'linear',
    features: data.features,
    primers: data.primers,
    history: source.history.map(cloneHistoryNode),
    linearEnds: { left: copyOverhang(ends.left), right: copyOverhang(ends.right) },
    methylationProfile: source.methylationProfile,
    description: source.description,
  });
  appendHistory(
    doc,
    makeHistoryNode(operation, description, {
      enzymesUsed,
      parentSnapshots: [parentSnapshot(source)],
    }),
  );
  return doc;
}

function normaliseCutList(doc: PlasmidDocument, cutSites: CutSite[]): Array<{
  enzyme: RestrictionEnzyme;
  position: number;
  strand: 1 | -1;
  top: number;
  bottom: number;
  topLocal: number;
  bottomLocal: number;
  left: OverhangEnd;
  right: OverhangEnd;
}> {
  const length = doc.length;
  const circular = doc.topology === 'circular';
  const result: Array<{
    enzyme: RestrictionEnzyme;
    position: number;
    strand: 1 | -1;
    top: number;
    bottom: number;
    topLocal: number;
    bottomLocal: number;
    left: OverhangEnd;
    right: OverhangEnd;
  }> = [];
  const seen = new Set<string>();
  for (const cut of cutSites) {
    if (cut.isMethylationBlocked) continue;
    if (!circular && (cut.position < 0 || cut.position >= length)) continue;
    let coordinates = cutCoordinates(cut.position, cut.enzyme, cut.strand, length);
    // Enzymes such as BaeI report each of their two cuts as a separate CutSite at the same position.
    if (cut.enzyme.secondCut && coordinates.top !== cut.cutPositionTop) {
      const second = cutCoordinates(cut.position, cut.enzyme, cut.strand, length, true);
      if (second.top === cut.cutPositionTop) coordinates = second;
    }
    if (!circular && (coordinates.topLocal <= 0 || coordinates.topLocal >= length)) continue;
    const key = `${coordinates.top}:${coordinates.bottom}:${cut.enzyme.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ends = cutEnds(doc.sequence, coordinates, circular, cut.enzyme.name);
    result.push({
      enzyme: cut.enzyme,
      position: cut.position,
      strand: cut.strand,
      top: coordinates.top,
      bottom: coordinates.bottom,
      topLocal: coordinates.topLocal,
      bottomLocal: coordinates.bottomLocal,
      left: ends.left,
      right: ends.right,
    });
  }
  return result.sort((a, b) => a.top - b.top);
}

export function simulateDigestion(doc: PlasmidDocument, cutSites: CutSite[]): PlasmidDocument[] {
  const cuts = normaliseCutList(doc, cutSites);
  if (!cuts.length) return [cloneDocument(doc)];
  const circular = doc.topology === 'circular';
  const length = doc.length;
  const fragments: PlasmidDocument[] = [];
  const enzymesUsed = Array.from(new Set(cuts.map((cut) => cut.enzyme.name)));
  if (circular) {
    if (cuts.length === 1) {
      const cut = cuts[0];
      const data = sliceDocumentData(doc, cut.top, cut.top + length, { circular: true });
      fragments.push(
        linearDocFromData(
          doc,
          data,
          `${doc.name}_linearized_${cut.enzyme.name}`,
          { left: cut.left, right: cut.right },
          'restriction_ligation',
          `Linearized ${doc.name} with ${cut.enzyme.name}; cohesive ends recorded.`,
          enzymesUsed,
        ),
      );
      return fragments;
    }
    for (let index = 0; index < cuts.length; index += 1) {
      const startCut = cuts[index];
      const endCut = cuts[(index + 1) % cuts.length];
      const span = rangeLength(startCut.top, endCut.top, length, true);
      if (span <= 0) continue;
      const data = sliceDocumentData(doc, startCut.top, startCut.top + span, { circular: true });
      fragments.push(
        linearDocFromData(
          doc,
          data,
          `${doc.name}_${startCut.enzyme.name}_${index + 1}`,
          { left: startCut.left, right: endCut.right },
          'restriction_ligation',
          `Digestion of ${doc.name} with ${enzymesUsed.join(' + ')}; fragment ${index + 1} of ${cuts.length} (${data.length} bp).`,
          enzymesUsed,
        ),
      );
    }
    return fragments;
  }
  const boundaries = [0, ...cuts.map((cut) => cut.top).filter((value) => value > 0 && value < length), length];
  const uniqueBoundaries = Array.from(new Set(boundaries)).sort((a, b) => a - b);
  for (let index = 0; index + 1 < uniqueBoundaries.length; index += 1) {
    const start = uniqueBoundaries[index];
    const end = uniqueBoundaries[index + 1];
    if (end <= start) continue;
    const data = sliceDocumentData(doc, start, end, { circular: false });
    const leftEnd =
      index === 0
        ? copyOverhang(doc.linearEnds?.left ?? bluntOverhang())
        : cuts.find((cut) => cut.top === start)?.left ?? bluntOverhang();
    const rightEnd =
      index + 2 === uniqueBoundaries.length
        ? copyOverhang(doc.linearEnds?.right ?? bluntOverhang())
        : cuts.find((cut) => cut.top === end)?.right ?? bluntOverhang();
    fragments.push(
      linearDocFromData(
        doc,
        data,
        `${doc.name}_fragment_${index + 1}`,
        { left: leftEnd, right: rightEnd },
        'restriction_ligation',
        `Digestion of ${doc.name} with ${enzymesUsed.join(' + ')}; fragment ${index + 1} (${data.length} bp).`,
        enzymesUsed,
      ),
    );
  }
  return fragments;
}

export function bluntEnds(
  fragment: PlasmidDocument,
  method: 'klenow_fill_in' | 't4_exonuclease',
): PlasmidDocument {
  const result = cloneDocument(fragment);
  const left = copyOverhang(result.linearEnds?.left ?? bluntOverhang());
  const right = copyOverhang(result.linearEnds?.right ?? bluntOverhang());
  let sequence = result.sequence;
  if (right.type === '5-prime') {
    sequence += reverseComplement(right.sequence);
  } else if (right.type === '3-prime') {
    sequence = sequence.slice(0, Math.max(0, sequence.length - right.sequence.length));
  }
  if (left.type === '5-prime') {
    // The recessed bottom strand is extended by the polymerase; the top strand
    // already starts at the correct coordinate.
  } else if (left.type === '3-prime') {
    // The protruding bottom 3-prime end is chewed back by the proofreading
    // exonuclease; the top strand is unchanged.
  }
  result.sequence = normalizeDNA(sequence);
  result.length = result.sequence.length;
  result.features = result.features
    .map((feature) => {
      if (feature.start >= result.length) return null;
      if (feature.end <= result.length) return feature;
      return { ...cloneFeature(feature), end: result.length };
    })
    .filter((feature): feature is SequenceFeature => feature !== null && feature.end > feature.start);
  result.primers = result.primers.filter(
    (primer) => primer.bindingStart >= 0 && primer.bindingEnd <= result.length,
  );
  result.linearEnds = {
    left: { ...left, type: 'blunt', sequence: '' },
    right: { ...right, type: 'blunt', sequence: '' },
  };
  result.topology = 'linear';
  result.updatedAt = nowIso();
  appendHistory(
    result,
    makeHistoryNode(
      'blunting',
      `Blunted ${fragment.name} with ${method === 'klenow_fill_in' ? 'Klenow fragment fill-in' : 'T4 DNA polymerase exonuclease/polymerase'}.`,
    ),
  );
  return result;
}

interface OrientedFragment {
  source: PlasmidDocument;
  sequence: string;
  features: SequenceFeature[];
  primers: Primer[];
  left: OverhangEnd;
  right: OverhangEnd;
  reverse: boolean;
}

function orientFragment(fragment: PlasmidDocument, reverse: boolean): OrientedFragment {
  const length = fragment.sequence.length;
  if (!reverse) {
    return {
      source: fragment,
      sequence: fragment.sequence,
      features: cloneFeatures(fragment.features),
      primers: clonePrimers(fragment.primers),
      left: copyOverhang(fragment.linearEnds?.left ?? bluntOverhang()),
      right: copyOverhang(fragment.linearEnds?.right ?? bluntOverhang()),
      reverse: false,
    };
  }
  // The stored sequence is the top strand, which carries a left 5' and a right 3' overhang.
  // Flipped, the old bottom strand becomes the top strand, so its span runs from the left
  // bottom-strand cut to the right one: prepend a left 3' overhang, append a right 5'
  // overhang, and drop the left 5' / right 3' bases that only the old top strand had.
  const left = fragment.linearEnds?.left ?? bluntOverhang();
  const right = fragment.linearEnds?.right ?? bluntOverhang();
  const leftShift = left.type === '5-prime' ? left.sequence.length : left.type === '3-prime' ? -left.sequence.length : 0;
  const rightShift = right.type === '5-prime' ? right.sequence.length : right.type === '3-prime' ? -right.sequence.length : 0;
  const bottomStrand =
    (left.type === '3-prime' ? reverseComplement(left.sequence) : '') +
    fragment.sequence.slice(Math.max(0, leftShift), length + Math.min(0, rightShift)) +
    (right.type === '5-prime' ? reverseComplement(right.sequence) : '');
  // Top-strand coordinate of the flipped molecule's origin (its new right edge before flipping).
  const pivot = length + rightShift;
  const flippedLength = bottomStrand.length;
  const clampToFlipped = (value: number) => Math.min(flippedLength, Math.max(0, value));
  return {
    source: fragment,
    sequence: reverseComplement(bottomStrand),
    features: fragment.features
      .map((feature) => ({
        ...cloneFeature(feature),
        start: clampToFlipped(pivot - feature.end),
        end: clampToFlipped(pivot - feature.start),
        strand: (feature.strand === 1 ? -1 : feature.strand === -1 ? 1 : 0) as 1 | -1 | 0,
      }))
      .filter((feature) => feature.end > feature.start),
    primers: fragment.primers.map((primer) => ({
      ...clonePrimer(primer),
      sequence: reverseComplement(primer.sequence),
      tailSequence: reverseComplement(primer.tailSequence),
      bindingStart: clampToFlipped(pivot - primer.bindingEnd),
      bindingEnd: clampToFlipped(pivot - primer.bindingStart),
      strand: (primer.strand === 1 ? -1 : 1) as 1 | -1,
      mismatches: primer.mismatches
        ? primer.mismatches.map((position) => pivot - 1 - position)
        : undefined,
    })),
    left: reverseEnd(copyOverhang(fragment.linearEnds?.right ?? bluntOverhang())),
    right: reverseEnd(copyOverhang(fragment.linearEnds?.left ?? bluntOverhang())),
    reverse: true,
  };
}

interface LigationSearchResult {
  path: Array<{ index: number; orientation: 'forward' | 'reverse' }>;
  oriented: OrientedFragment[];
  circular: boolean;
}

function findLigationPath(
  fragments: PlasmidDocument[],
  circularize: boolean,
): LigationSearchResult | null {
  const n = fragments.length;
  if (!n) return null;
  const orientations: Array<'forward' | 'reverse'> = ['forward', 'reverse'];
  for (let startIndex = 0; startIndex < n; startIndex += 1) {
    for (const startOrientation of orientations) {
      const path: Array<{ index: number; orientation: 'forward' | 'reverse' }> = [
        { index: startIndex, orientation: startOrientation },
      ];
      const oriented: OrientedFragment[] = [orientFragment(fragments[startIndex], startOrientation === 'reverse')];
      const used = new Set<number>([startIndex]);
      const recurse = (): LigationSearchResult | null => {
        if (path.length === n) {
          const last = oriented[oriented.length - 1];
          const first = oriented[0];
          if (!circularize || endsCompatible(last.right, first.left)) {
            return { path: [...path], oriented: [...oriented], circular: circularize };
          }
          return null;
        }
        const last = oriented[oriented.length - 1];
        for (let index = 0; index < n; index += 1) {
          if (used.has(index)) continue;
          for (const orientation of orientations) {
            const candidate = orientFragment(fragments[index], orientation === 'reverse');
            if (!endsCompatible(last.right, candidate.left)) continue;
            used.add(index);
            path.push({ index, orientation });
            oriented.push(candidate);
            const result = recurse();
            if (result) return result;
            oriented.pop();
            path.pop();
            used.delete(index);
          }
        }
        return null;
      };
      const found = recurse();
      if (found) return found;
    }
  }
  return null;
}

function destroyedLigationSites(
  fragments: PlasmidDocument[],
  oriented: OrientedFragment[],
  productSequence: string,
  circular: boolean,
): string[] {
  const names = new Set<string>();
  for (const fragment of oriented) {
    if (fragment.left.sourceEnzyme) names.add(fragment.left.sourceEnzyme);
    if (fragment.right.sourceEnzyme) names.add(fragment.right.sourceEnzyme);
    for (const node of fragment.source.history) {
      for (const enzyme of node.enzymesUsed ?? []) names.add(enzyme);
    }
  }
  const destroyed: string[] = [];
  for (const name of names) {
    const enzyme = COMMON_ENZYMES.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!enzyme) continue;
    const sites = findCutSites(productSequence, enzyme, circular);
    if (!sites.length) destroyed.push(name);
  }
  return destroyed.sort();
}

export function simulateLigation(
  fragments: PlasmidDocument[],
  options?: { circularize?: boolean; dephosphorylatedIds?: string[] },
): {
  product: PlasmidDocument | null;
  compatible: boolean;
  orientations: Array<'forward' | 'reverse'>;
  destroyedSites: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!fragments.length) {
    return { product: null, compatible: false, orientations: [], destroyedSites: [], warnings: ['No fragments supplied.'] };
  }
  const circularize = options?.circularize ?? true;
  let result = findLigationPath(fragments, circularize);
  if (!result && circularize && fragments.length > 1) {
    result = findLigationPath(fragments, false);
    if (result) warnings.push('Fragment ends cannot form a circle; a linear ligation product is returned.');
  }
  if (!result) {
    return {
      product: null,
      compatible: false,
      orientations: [],
      destroyedSites: [],
      warnings: ['No compatible fragment order and orientation could be found.'],
    };
  }
  const { oriented, circular } = result;
  let sequence = '';
  const features: SequenceFeature[] = [];
  const primers: Primer[] = [];
  for (const fragment of oriented) {
    const offset = sequence.length;
    features.push(...fragment.features.map((feature) => shiftFeature(feature, offset)));
    primers.push(...fragment.primers.map((primer) => shiftPrimer(primer, offset)));
    sequence += fragment.sequence;
  }
  if (!sequence.length) {
    return { product: null, compatible: false, orientations: [], destroyedSites: [], warnings: ['Ligation produced an empty molecule.'] };
  }
  const product = makeDocument({
    name: `Ligation_${fragments.map((fragment) => fragment.name).join('_')}`,
    sequence,
    topology: circular ? 'circular' : 'linear',
    features,
    primers,
    history: fragments.flatMap((fragment) => fragment.history.map(cloneHistoryNode)),
    linearEnds: circular
      ? undefined
      : { left: copyOverhang(oriented[0].left), right: copyOverhang(oriented[oriented.length - 1].right) },
    methylationProfile: fragments[0].methylationProfile,
  });
  const enzymesUsed = Array.from(
    new Set(
      oriented.flatMap((fragment) => [
        ...(fragment.left.sourceEnzyme ? [fragment.left.sourceEnzyme] : []),
        ...(fragment.right.sourceEnzyme ? [fragment.right.sourceEnzyme] : []),
      ]),
    ),
  );
  appendHistory(
    product,
    makeHistoryNode(
      'restriction_ligation',
      `Ligation of ${fragments.length} fragment(s) in ${circular ? 'circular' : 'linear'} topology.`,
      {
        enzymesUsed,
        parentSnapshots: fragments.map((fragment) => parentSnapshot(fragment)),
      },
    ),
  );
  const dephosphorylated = new Set(options?.dephosphorylatedIds ?? []);
  const dephosphorylatedCount = fragments.filter((fragment) => dephosphorylated.has(fragment.id)).length;
  if (dephosphorylatedCount > 0 && oriented.length === 1) {
    warnings.push('A dephosphorylated fragment cannot circularize without a phosphorylated partner.');
  }
  if (oriented.length > 1 && dephosphorylatedCount === oriented.length) {
    warnings.push('All fragments are dephosphorylated; ligation junctions cannot be sealed.');
  }
  const orientations = result.path.slice(1).map((entry) => entry.orientation);
  const junctionCount = circular ? oriented.length : oriented.length - 1;
  for (let index = 0; index < junctionCount; index += 1) {
    const left = oriented[index];
    const right = oriented[(index + 1) % oriented.length];
    const scar = `${left.sequence.slice(-6)}${right.sequence.slice(0, 6)}`;
    warnings.push(`Ligation junction ${index + 1} scar sequence: ${scar}.`);
  }
  const destroyedSites = destroyedLigationSites(fragments, oriented, product.sequence, circular);
  if (destroyedSites.length) {
    warnings.push(`Ligation destroyed recognition site(s): ${destroyedSites.join(', ')}.`);
  }
  return {
    product,
    compatible: true,
    orientations,
    destroyedSites,
    warnings,
  };
}

interface OverlapMatch {
  length: number;
  sequence: string;
  mismatches: number;
}

function findOverlap(a: string, b: string, minOverlap: number, maxOverlap: number): OverlapMatch | null {
  const limit = Math.min(maxOverlap, Math.min(a.length, b.length));
  let best: OverlapMatch | null = null;
  for (let length = minOverlap; length <= limit; length += 1) {
    const suffix = a.slice(a.length - length);
    const prefix = b.slice(0, length);
    let mismatches = 0;
    for (let index = 0; index < length; index += 1) {
      if (suffix[index] !== prefix[index]) mismatches += 1;
    }
    const allowed = length >= 30 ? 2 : length >= 20 ? 1 : 1;
    if (mismatches > allowed) continue;
    if (!best || mismatches < best.mismatches || (mismatches === best.mismatches && length > best.length)) {
      best = { length, sequence: prefix, mismatches };
    }
  }
  return best;
}

interface GibsonPathEntry {
  index: number;
  orientation: 'forward' | 'reverse';
}

interface GibsonEdge {
  length: number;
  sequence: string;
  mismatches: number;
}

interface GibsonSearchResult {
  path: GibsonPathEntry[];
  edges: GibsonEdge[];
  circular: boolean;
}

function searchGibson(
  fragments: PlasmidDocument[],
  circular: boolean,
  minOverlap: number,
  maxOverlap: number,
): GibsonSearchResult | null {
  const n = fragments.length;
  if (!n) return null;
  const orientations: Array<'forward' | 'reverse'> = ['forward', 'reverse'];
  const sequences = new Map<string, string>();
  const getSequence = (index: number, orientation: 'forward' | 'reverse'): string => {
    const key = `${index}:${orientation}`;
    if (!sequences.has(key)) {
      sequences.set(
        key,
        orientation === 'forward' ? fragments[index].sequence : reverseComplement(fragments[index].sequence),
      );
    }
    return sequences.get(key)!;
  };
  const edgeCache = new Map<string, GibsonEdge | null>();
  const getEdge = (
    fromIndex: number,
    fromOrientation: 'forward' | 'reverse',
    toIndex: number,
    toOrientation: 'forward' | 'reverse',
  ): GibsonEdge | null => {
    const key = `${fromIndex}:${fromOrientation}>${toIndex}:${toOrientation}`;
    if (edgeCache.has(key)) return edgeCache.get(key) ?? null;
    const match = findOverlap(
      getSequence(fromIndex, fromOrientation),
      getSequence(toIndex, toOrientation),
      minOverlap,
      maxOverlap,
    );
    edgeCache.set(
      key,
      match ? { length: match.length, sequence: match.sequence, mismatches: match.mismatches } : null,
    );
    return match;
  };
  const startCandidates: Array<{ index: number; orientation: 'forward' | 'reverse' }> = [];
  for (let index = 0; index < n; index += 1) {
    startCandidates.push({ index, orientation: 'forward' });
    startCandidates.push({ index, orientation: 'reverse' });
  }
  for (const start of startCandidates) {
    const path: GibsonPathEntry[] = [start];
    const edges: GibsonEdge[] = [];
    const used = new Set<number>([start.index]);
    const recurse = (): GibsonSearchResult | null => {
      if (path.length === n) {
        if (!circular) return { path: [...path], edges: [...edges], circular: false };
        const closing = getEdge(
          path[path.length - 1].index,
          path[path.length - 1].orientation,
          path[0].index,
          path[0].orientation,
        );
        if (closing) return { path: [...path], edges: [...edges, closing], circular: true };
        return null;
      }
      const last = path[path.length - 1];
      for (let index = 0; index < n; index += 1) {
        if (used.has(index)) continue;
        for (const orientation of orientations) {
          const edge = getEdge(last.index, last.orientation, index, orientation);
          if (!edge) continue;
          used.add(index);
          path.push({ index, orientation });
          edges.push(edge);
          const result = recurse();
          if (result) return result;
          edges.pop();
          path.pop();
          used.delete(index);
        }
      }
      return null;
    };
    const found = recurse();
    if (found) return found;
  }
  return null;
}

function orientedDoc(fragment: PlasmidDocument, orientation: 'forward' | 'reverse'): PlasmidDocument {
  const oriented = orientFragment(fragment, orientation === 'reverse');
  return makeDocument({
    id: fragment.id,
    name: fragment.name,
    sequence: oriented.sequence,
    topology: 'linear',
    features: oriented.features,
    primers: oriented.primers,
    history: fragment.history,
    linearEnds: { left: oriented.left, right: oriented.right },
    methylationProfile: fragment.methylationProfile,
    description: fragment.description,
  });
}

export function simulateGibsonAssembly(
  fragments: PlasmidDocument[],
  options?: { minOverlap?: number; maxOverlap?: number; circular?: boolean },
): {
  product: PlasmidDocument | null;
  junctions: Array<{ leftId: string; rightId: string; overlapSeq: string; overlapTm: number; reversed: boolean }>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const circular = options?.circular ?? true;
  const minOverlap = Math.max(8, options?.minOverlap ?? 15);
  const maxOverlap = Math.max(minOverlap, options?.maxOverlap ?? 45);
  if (fragments.length < 2) {
    return { product: null, junctions: [], warnings: ['Gibson assembly requires at least two fragments.'] };
  }
  if (fragments.length > 8) {
    warnings.push('More than eight fragments were supplied; assembly efficiency may be very low.');
  }
  const result = searchGibson(fragments, circular, minOverlap, maxOverlap);
  if (!result) {
    return {
      product: null,
      junctions: [],
      warnings: [...warnings, `No ${circular ? 'circular' : 'linear'} overlap path was found in the ${minOverlap}-${maxOverlap} bp window.`],
    };
  }
  const n = result.path.length;
  const orientedDocs = result.path.map((entry) => orientedDoc(fragments[entry.index], entry.orientation));
  const trimStarts = new Array<number>(n).fill(0);
  const trimEnds = orientedDocs.map((doc) => doc.length);
  for (let index = 1; index < n; index += 1) {
    trimStarts[index] = result.edges[index - 1].length;
  }
  if (circular) {
    trimEnds[n - 1] = Math.max(trimStarts[n - 1], orientedDocs[n - 1].length - result.edges[n - 1].length);
  }
  let sequence = '';
  const features: SequenceFeature[] = [];
  const primers: Primer[] = [];
  for (let index = 0; index < n; index += 1) {
    const doc = orientedDocs[index];
    const start = trimStarts[index];
    const end = trimEnds[index];
    if (end <= start) continue;
    const data = sliceDocumentData(doc, start, end, { circular: false });
    const offset = sequence.length;
    features.push(...data.features.map((feature) => shiftFeature(feature, offset)));
    primers.push(...data.primers.map((primer) => shiftPrimer(primer, offset)));
    sequence += data.sequence;
    if (result.edges[index] && result.edges[index].mismatches > 0) {
      warnings.push(
        `Junction ${index + 1} uses a tolerant overlap with ${result.edges[index].mismatches} mismatch(es).`,
      );
    }
    if (result.edges[index] && result.edges[index].length < 20) {
      warnings.push(`Junction ${index + 1} overlap is only ${result.edges[index].length} bp; consider a longer overlap.`);
    }
    if (result.edges[index]) {
      const tm = evaluateOligoThermodynamics(result.edges[index].sequence).tm;
      if (tm < 50) warnings.push(`Junction ${index + 1} overlap Tm is ${tm.toFixed(1)} °C.`);
    }
  }
  if (!sequence.length) {
    return { product: null, junctions: [], warnings: [...warnings, 'Assembly produced an empty sequence.'] };
  }
  const junctionCount = circular ? n : n - 1;
  const junctions = result.path.slice(0, junctionCount).map((entry, index) => {
    const next = result.path[(index + 1) % n];
    const edge = result.edges[index];
    return {
      leftId: orientedDocs[index].id,
      rightId: orientedDocs[(index + 1) % n].id,
      overlapSeq: edge.sequence,
      overlapTm: evaluateOligoThermodynamics(edge.sequence).tm,
      reversed: next.orientation === 'reverse',
    };
  });
  const product = makeDocument({
    name: `Gibson_${fragments.map((fragment) => fragment.name).join('_')}`,
    sequence,
    topology: circular ? 'circular' : 'linear',
    features,
    primers,
    history: fragments.flatMap((fragment) => fragment.history.map(cloneHistoryNode)),
    linearEnds: circular
      ? undefined
      : {
          left: copyOverhang(orientedDocs[0].linearEnds?.left ?? bluntOverhang()),
          right: copyOverhang(orientedDocs[n - 1].linearEnds?.right ?? bluntOverhang()),
        },
    methylationProfile: fragments[0].methylationProfile,
  });
  appendHistory(
    product,
    makeHistoryNode(
      'gibson_assembly',
      `Gibson assembly of ${n} fragment(s) with ${result.edges.length} overlap junction(s).`,
      {
        parentSnapshots: fragments.map((fragment) => parentSnapshot(fragment)),
      },
    ),
  );
  return { product, junctions, warnings };
}

interface BindingChoice {
  start: number;
  end: number;
  sequence: string;
  tm: number;
}

function chooseBinding(
  doc: PlasmidDocument,
  start: number,
  end: number,
  strand: 1 | -1,
  targetTm: number,
  cond?: ReactionConditions,
): BindingChoice {
  const circular = doc.topology === 'circular';
  const targetLength = rangeLength(start, end, doc.length, circular);
  const maxLen = Math.min(30, Math.max(18, targetLength));
  let best: BindingChoice | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let length = 18; length <= maxLen; length += 1) {
    const bindingStart = strand === 1
      ? start
      : circular
        ? mod(end - length, doc.length)
        : Math.max(0, end - length);
    const bindingEnd = strand === 1
      ? circular
        ? mod(start + length, doc.length)
        : Math.min(doc.length, start + length)
      : end;
    const region = sequenceSlice(doc.sequence, bindingStart, bindingEnd, circular);
    if (region.length !== length) continue;
    const annealing = strand === 1 ? region : reverseComplement(region);
    const thermo = evaluateOligoThermodynamics(annealing, cond);
    let score = Math.abs(thermo.tm - targetTm);
    if (!thermo.has3PrimeGCClamp) score += 2;
    if (thermo.tm < 52 || thermo.tm > 72) score += 2;
    if (score < bestScore) {
      bestScore = score;
      best = { start: bindingStart, end: bindingEnd, sequence: annealing, tm: thermo.tm };
    }
  }
  if (!best) {
    const length = Math.max(1, Math.min(20, targetLength));
    const bindingStart = strand === 1
      ? start
      : circular
        ? mod(end - length, doc.length)
        : Math.max(0, end - length);
    const bindingEnd = strand === 1
      ? circular
        ? mod(start + length, doc.length)
        : Math.min(doc.length, start + length)
      : end;
    const region = sequenceSlice(doc.sequence, bindingStart, bindingEnd, circular);
    best = {
      start: bindingStart,
      end: bindingEnd,
      sequence: strand === 1 ? region : reverseComplement(region),
      tm: evaluateOligoThermodynamics(region, cond).tm,
    };
  }
  return best;
}

export function designGibsonPrimers(
  parts: Array<{ doc: PlasmidDocument; range: { start: number; end: number; strand?: 1 | -1 | 'both' } }>,
  options?: { overlapLength?: number; circular?: boolean; cond?: ReactionConditions },
): Array<{ partId: string; forward: Primer; reverse: Primer }> {
  if (!parts.length) return [];
  const overlapLength = clamp(options?.overlapLength ?? 20, 15, 45);
  const circular = options?.circular ?? true;
  const cond = options?.cond;
  const sequences = parts.map((part) =>
    sequenceSlice(
      part.doc.sequence,
      part.range.start,
      part.range.end,
      part.doc.topology === 'circular',
    ),
  );
  const output: Array<{ partId: string; forward: Primer; reverse: Primer }> = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const forwardChoice = chooseBinding(part.doc, part.range.start, part.range.end, 1, 60, cond);
    const reverseChoice = chooseBinding(part.doc, part.range.start, part.range.end, -1, 60, cond);
    let forwardTail = '';
    let reverseTail = '';
    if (parts.length > 1) {
      if (circular || index > 0) {
        const previous = sequences[(index - 1 + parts.length) % parts.length];
        forwardTail = previous.slice(Math.max(0, previous.length - overlapLength));
      }
      if (circular || index < parts.length - 1) {
        const next = sequences[(index + 1) % parts.length];
        reverseTail = reverseComplement(next.slice(0, overlapLength));
      }
    }
    const forward = buildPrimer(
      part.doc,
      forwardChoice.start,
      forwardChoice.end,
      1,
      forwardTail,
      `${part.doc.name}_F${index + 1}`,
      cond,
    );
    const reverse = buildPrimer(
      part.doc,
      reverseChoice.start,
      reverseChoice.end,
      -1,
      reverseTail,
      `${part.doc.name}_R${index + 1}`,
      cond,
    );
    output.push({ partId: part.doc.id, forward, reverse });
  }
  return output;
}

interface GoldenGatePart {
  source: PlasmidDocument;
  name: string;
  sequence: string;
  features: SequenceFeature[];
  primers: Primer[];
  left: OverhangEnd;
  right: OverhangEnd;
}

interface GoldenGateCutInfo {
  top: number;
  bottom: number;
  topLocal: number;
  bottomLocal: number;
  position: number;
  strand: 1 | -1;
  left: OverhangEnd;
  right: OverhangEnd;
}

function goldenGateCutInfos(part: PlasmidDocument, enzyme: RestrictionEnzyme): GoldenGateCutInfo[] {
  const circular = part.topology === 'circular';
  const sites = findCutSites(part.sequence, enzyme, circular);
  const infos: GoldenGateCutInfo[] = [];
  for (const site of sites) {
    const coordinates = cutCoordinates(site.position, enzyme, site.strand, part.length);
    const ends = cutEnds(part.sequence, coordinates, circular, enzyme.name);
    if (!circular && (coordinates.topLocal < 0 || coordinates.topLocal > part.length)) continue;
    if (!circular && (coordinates.bottomLocal < 0 || coordinates.bottomLocal > part.length)) continue;
    infos.push({
      top: coordinates.top,
      bottom: coordinates.bottom,
      topLocal: coordinates.topLocal,
      bottomLocal: coordinates.bottomLocal,
      position: site.position,
      strand: site.strand,
      left: ends.left,
      right: ends.right,
    });
  }
  return infos.sort((a, b) => a.top - b.top);
}

function prepareGoldenGatePart(
  part: PlasmidDocument,
  enzyme: RestrictionEnzyme,
  warnings: string[],
): GoldenGatePart | null {
  const circular = part.topology === 'circular';
  const cuts = goldenGateCutInfos(part, enzyme);
  if (cuts.length < 2) {
    warnings.push(`${part.name}: fewer than two ${enzyme.name} sites were found.`);
    return null;
  }
  let best: { left: GoldenGateCutInfo; right: GoldenGateCutInfo; length: number } | null = null;
  for (let i = 0; i < cuts.length; i += 1) {
    for (let j = i + 1; j < cuts.length; j += 1) {
      const leftCut = cuts[i];
      const rightCut = cuts[j];
      let span: number;
      if (circular) {
        span = rangeLength(leftCut.top, rightCut.top, part.length, true);
      } else {
        span = rightCut.top - leftCut.top;
      }
      if (span <= 0) continue;
      const containsSite = cuts.some((cut) => {
        if (cut === leftCut || cut === rightCut) return false;
        const cutRelative = circular ? mod(cut.top - leftCut.top, part.length) : cut.top - leftCut.top;
        const recognitionRelative = circular
          ? mod(cut.position - leftCut.top, part.length)
          : cut.position - leftCut.top;
        return (
          (cutRelative > 0 && cutRelative < span) ||
          (recognitionRelative > 0 && recognitionRelative < span)
        );
      });
      if (containsSite) continue;
      const leftRecognitionInside = circular
        ? mod(leftCut.position - leftCut.top, part.length) < span
        : leftCut.position >= leftCut.top && leftCut.position < rightCut.top;
      const rightRecognitionInside = circular
        ? mod(rightCut.position - leftCut.top, part.length) < span
        : rightCut.position >= leftCut.top && rightCut.position < rightCut.top;
      if (leftRecognitionInside || rightRecognitionInside) continue;
      if (!best || span > best.length) best = { left: leftCut, right: rightCut, length: span };
    }
  }
  if (!best) {
    warnings.push(`${part.name}: could not identify an insert interval that removes both ${enzyme.name} recognition sites.`);
    const leftCut = cuts[0];
    const rightCut = cuts[cuts.length - 1];
    const span = circular
      ? rangeLength(leftCut.top, rightCut.top, part.length, true)
      : rightCut.top - leftCut.top;
    if (span <= 0) return null;
    best = { left: leftCut, right: rightCut, length: span };
  }
  const data = sliceDocumentData(part, best.left.top, best.left.top + best.length, { circular });
  if (!data.sequence.length) {
    warnings.push(`${part.name}: Golden Gate insert interval is empty.`);
    return null;
  }
  if (best.left.left.type !== '5-prime' || best.right.right.type !== '5-prime') {
    warnings.push(`${part.name}: ${enzyme.name} does not produce two 5-prime overhangs in this orientation.`);
  }
  return {
    source: part,
    name: part.name,
    sequence: data.sequence,
    features: data.features,
    primers: data.primers,
    left: copyOverhang(best.left.left),
    right: copyOverhang(best.right.right),
  };
}

interface GoldenGatePath {
  parts: GoldenGatePart[];
  orientations: Array<'forward' | 'reverse'>;
}

function searchGoldenGate(parts: GoldenGatePart[], circular: boolean): GoldenGatePath | null {
  const n = parts.length;
  if (!n) return null;
  const orientations: Array<'forward' | 'reverse'> = ['forward', 'reverse'];
  const variants = new Map<string, GoldenGatePart>();
  const getVariant = (index: number, orientation: 'forward' | 'reverse'): GoldenGatePart => {
    const key = `${index}:${orientation}`;
    if (variants.has(key)) return variants.get(key)!;
    const part = parts[index];
    if (orientation === 'forward') {
      variants.set(key, part);
      return part;
    }
    const reversed: GoldenGatePart = {
      source: part.source,
      name: `${part.name}_rev`,
      sequence: reverseComplement(part.sequence),
      features: part.features.map((feature) => ({
        ...cloneFeature(feature),
        start: part.sequence.length - feature.end,
        end: part.sequence.length - feature.start,
        strand: (feature.strand === 1 ? -1 : feature.strand === -1 ? 1 : 0) as 1 | -1 | 0,
      })),
      primers: part.primers.map((primer) => ({
        ...clonePrimer(primer),
        sequence: reverseComplement(primer.sequence),
        tailSequence: reverseComplement(primer.tailSequence),
        bindingStart: part.sequence.length - primer.bindingEnd,
        bindingEnd: part.sequence.length - primer.bindingStart,
        strand: (primer.strand === 1 ? -1 : 1) as 1 | -1,
      })),
      left: reverseEnd(part.right),
      right: reverseEnd(part.left),
    };
    variants.set(key, reversed);
    return reversed;
  };
  const startIndices = circular ? [0] : Array.from({ length: n }, (_, index) => index);
  for (const startIndex of startIndices) {
    for (const startOrientation of orientations) {
      const path: Array<{ index: number; orientation: 'forward' | 'reverse' }> = [
        { index: startIndex, orientation: startOrientation },
      ];
      const used = new Set<number>([startIndex]);
      const orderedParts: GoldenGatePart[] = [getVariant(startIndex, startOrientation)];
      const recurse = (): GoldenGatePath | null => {
        if (path.length === n) {
          if (!circular) {
            return { parts: [...orderedParts], orientations: path.map((entry) => entry.orientation) };
          }
          const first = orderedParts[0];
          const last = orderedParts[orderedParts.length - 1];
          if (endsCompatible(last.right, first.left)) {
            return { parts: [...orderedParts], orientations: path.map((entry) => entry.orientation) };
          }
          return null;
        }
        const last = orderedParts[orderedParts.length - 1];
        for (let index = 0; index < n; index += 1) {
          if (used.has(index)) continue;
          for (const orientation of orientations) {
            const candidate = getVariant(index, orientation);
            if (!endsCompatible(last.right, candidate.left)) continue;
            used.add(index);
            path.push({ index, orientation });
            orderedParts.push(candidate);
            const result = recurse();
            if (result) return result;
            orderedParts.pop();
            path.pop();
            used.delete(index);
          }
        }
        return null;
      };
      const found = recurse();
      if (found) return found;
    }
  }
  return null;
}

/**
 * The fragment a Type IIS part plasmid releases, and the two overhangs it presents.
 * This is the same preparation the assembly itself does, exposed so a part can be
 * checked against an assembly standard without assembling anything.
 */
export function goldenGatePartEnds(
  part: PlasmidDocument,
  enzyme: RestrictionEnzyme,
): { left: OverhangEnd; right: OverhangEnd; length: number; sequence: string; warnings: string[] } | null {
  const warnings: string[] = [];
  const prepared = prepareGoldenGatePart(part, enzyme, warnings);
  if (!prepared) return null;
  return {
    left: prepared.left,
    right: prepared.right,
    length: prepared.sequence.length,
    sequence: prepared.sequence,
    warnings,
  };
}

export function simulateGoldenGateAssembly(
  parts: PlasmidDocument[],
  enzyme: RestrictionEnzyme,
  options?: { circular?: boolean },
): {
  product: PlasmidDocument | null;
  overhangs: string[];
  fidelityScore: number;
  internalSiteWarnings: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const internalSiteWarnings: string[] = [];
  const circular = options?.circular ?? true;
  if (!parts.length) {
    return { product: null, overhangs: [], fidelityScore: 0, internalSiteWarnings, warnings: ['No Golden Gate parts supplied.'] };
  }
  const prepared: GoldenGatePart[] = [];
  for (const part of parts) {
    const item = prepareGoldenGatePart(part, enzyme, warnings);
    if (item) prepared.push(item);
  }
  if (prepared.length < 2) {
    return {
      product: null,
      overhangs: prepared.map((part) => part.left.sequence),
      fidelityScore: 0,
      internalSiteWarnings,
      warnings: [...warnings, 'At least two valid Golden Gate parts are required.'],
    };
  }
  for (const part of prepared) {
    const internal = findCutSites(part.sequence, enzyme, false);
    if (internal.length) {
      internalSiteWarnings.push(
        `${part.name}: ${internal.length} internal ${enzyme.name} site(s) remain in the insert.`,
      );
    }
  }
  const path = searchGoldenGate(prepared, circular);
  if (!path) {
    return {
      product: null,
      overhangs: prepared.map((part) => part.left.sequence),
      fidelityScore: 0,
      internalSiteWarnings,
      warnings: [...warnings, 'No unique directed Golden Gate assembly path was found.'],
    };
  }
  const overhangs = path.parts.map((part) => part.left.sequence);
  const fidelityResults = overhangs.map((overhang) => scoreOverhang(overhang, overhangs));
  const fidelityScore = Number(
    (fidelityResults.reduce((sum, result) => sum + result.score, 0) / Math.max(1, fidelityResults.length)).toFixed(3),
  );
  for (const result of fidelityResults) warnings.push(...result.warnings);
  if (fidelityScore < 0.6) warnings.push('Golden Gate overhang set has a high mis-ligation risk; choose a higher-fidelity overhang set.');
  let sequence = '';
  const features: SequenceFeature[] = [];
  const primers: Primer[] = [];
  for (const part of path.parts) {
    const offset = sequence.length;
    features.push(...part.features.map((feature) => shiftFeature(feature, offset)));
    primers.push(...part.primers.map((primer) => shiftPrimer(primer, offset)));
    sequence += part.sequence;
  }
  if (!sequence.length) {
    return {
      product: null,
      overhangs,
      fidelityScore,
      internalSiteWarnings,
      warnings: [...warnings, 'Golden Gate assembly produced an empty sequence.'],
    };
  }
  const product = makeDocument({
    name: `GoldenGate_${parts.map((part) => part.name).join('_')}`,
    sequence,
    topology: circular ? 'circular' : 'linear',
    features,
    primers,
    history: parts.flatMap((part) => part.history.map(cloneHistoryNode)),
    linearEnds: circular
      ? undefined
      : { left: copyOverhang(path.parts[0].left), right: copyOverhang(path.parts[path.parts.length - 1].right) },
    methylationProfile: parts[0].methylationProfile,
  });
  appendHistory(
    product,
    makeHistoryNode(
      'golden_gate',
      `Golden Gate assembly of ${parts.length} part(s) with ${enzyme.name}.`,
      {
        enzymesUsed: [enzyme.name],
        parentSnapshots: parts.map((part) => parentSnapshot(part)),
      },
    ),
  );
  const residual = findCutSites(product.sequence, enzyme, circular);
  for (const site of residual) {
    internalSiteWarnings.push(
      `Residual ${enzyme.name} site in the assembled product at ${site.position} (${site.strand === 1 ? '+' : '-'} strand).`,
    );
  }
  return { product, overhangs, fidelityScore, internalSiteWarnings, warnings };
}

export function designGoldenGatePrimers(
  parts: Array<{ doc: PlasmidDocument; range: { start: number; end: number; strand?: 1 | -1 | 'both' } }>,
  enzyme: RestrictionEnzyme,
  overhangs: string[],
): Array<{ partId: string; forward: Primer; reverse: Primer }> {
  if (!parts.length) return [];
  const output: Array<{ partId: string; forward: Primer; reverse: Primer }> = [];
  const recognition = normalizeDNA(enzyme.recognitionSeq);
  const spacer = 'A'.repeat(Math.max(0, enzyme.cutIndexTop - recognition.length));
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const forwardChoice = chooseBinding(part.doc, part.range.start, part.range.end, 1, 60);
    const reverseChoice = chooseBinding(part.doc, part.range.start, part.range.end, -1, 60);
    const leftOverhang = normalizeDNA(overhangs[index] ?? '');
    const nextOverhang = normalizeDNA(overhangs[(index + 1) % Math.max(1, overhangs.length)] ?? '');
    const forwardTail = recognition + spacer + leftOverhang;
    const reverseTail = recognition + spacer + reverseComplement(nextOverhang);
    const forward = buildPrimer(
      part.doc,
      forwardChoice.start,
      forwardChoice.end,
      1,
      forwardTail,
      `${part.doc.name}_GG_F${index + 1}`,
    );
    const reverse = buildPrimer(
      part.doc,
      reverseChoice.start,
      reverseChoice.end,
      -1,
      reverseTail,
      `${part.doc.name}_GG_R${index + 1}`,
    );
    output.push({ partId: part.doc.id, forward, reverse });
  }
  return output;
}

/**
 * Recombination core sequences for the Gateway MultiSite site families.
 *
 * The values follow the att site annotations of the publicly deposited
 * MultiSite Gateway donor/destination vectors (NCBI Nucleotide) and the
 * primer recommendations of the MultiSite Gateway Pro user guide. attL/attR
 * entries 3-5 include the flanking half-site bases that distinguish the left
 * and right family members; without them the shared 21 bp core would make
 * attL4 and attR4 indistinguishable. Reverse-orientation sites are
 * represented by the normally oriented core; callers may suffix a name with
 * "r" for annotation.
 */
export const GATEWAY_ATT_SITES = {
  attB1: 'ACAAGTTTGTACAAAAAAGCAGGCT',
  attB2: 'ACCCAGCTTTCTTGTACAAAGTGGT',
  attB3: 'CAACTTTGTATAATAAAGTTG',
  attB4: 'CCAACTTTGTATAGAAAAGTTG',
  attB5: 'CAACTTTGTATACAAAAGTTG',
  attP1: 'ACAAGTTTGTACAAAAAAGCTGAACG',
  attP2: 'ACCCAGCTTTCTTGTACAAAGTGGTC',
  attP3: 'CAACTTTGTATAATAAAGTTGAACG',
  attP4: 'CGTTCAACTTTTCTATACAAAGTTG',
  attP5: 'CAACTTTGTATACAAAAGTTGAACG',
  attL1: 'ACAAGTTTGTACAAAAAAGCAGGCT',
  attL2: 'ACCCAGCTTTCTTGTACAAAGTGGT',
  attL3: 'TGCCAACTTTGTATAATAAAGTTG',
  attL4: 'CAACTTTTCTATACAAAGTTGGCATT',
  attL5: 'TGCCAACTTTGTATACAAAAGTTG',
  attR1: 'ACAAGTTTGTACAAAAAAGCTGAACG',
  attR2: 'ACCCAGCTTTCTTGTACAAAGTGGTC',
  attR3: 'CAACTTTGTATAATAAAGTTGAACG',
  attR4: 'CGTTCAACTTTTCTATACAAAGTTG',
  attR5: 'CAACTTTGTATACAAAAGTTGAACG',
} as const;

type GatewayLRSerie = 'attL' | 'attR';
type GatewayLRName = `${GatewayLRSerie}${1 | 2 | 3 | 4 | 5}`;

const GATEWAY_LR_NAMES: GatewayLRName[] = [
  'attL1',
  'attL2',
  'attL3',
  'attL4',
  'attL5',
  'attR1',
  'attR2',
  'attR3',
  'attR4',
  'attR5',
];

interface AttSiteLocation {
  start: number;
  end: number;
  strand: 1 | -1;
  name: string;
}

/**
 * Gateway strand exchange happens inside a short core that the attB, attP, attL and attR site
 * of one series all share, so a BP or LR product is the two parents cut inside their cores and
 * joined crosswise: the entry clone keeps the donor-derived arm of attP, which turns the attB
 * core into a full attL site. The parents are identical across the core, so the exact cut point
 * inside it does not affect the product sequence.
 */
const GATEWAY_CORES: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'TWTGTACAAAAAA',
  2: 'TWTGTACAAGAAA',
  3: 'TWTGTATAATAAA',
  4: 'TWTGTATAGAAAA',
  5: 'TWTGTATACAAAA',
};

/**
 * Top-strand left edge of the recombination core of one att site. The core is searched on both
 * strands because the series-2 sites of a vector point inwards.
 */
function findGatewayCore(
  doc: PlasmidDocument,
  site: AttSiteLocation,
  series: 1 | 2 | 3 | 4 | 5,
): number | null {
  const circular = doc.topology === 'circular';
  const core = GATEWAY_CORES[series];
  const matches = findMotifOnBothStrands(doc.sequence, core, circular);
  if (matches.length === 0) return null;
  const distance = (position: number): number => {
    if (position >= site.start && position < site.end) return 0;
    const raw = Math.min(
      Math.abs(position - site.start),
      Math.abs(position - site.end),
    );
    return circular ? Math.min(raw, doc.length - raw) : raw;
  };
  let best = matches[0];
  for (const match of matches) {
    if (distance(match.position) < distance(best.position)) best = match;
  }
  // A core far from the annotated site belongs to another att site in the same molecule.
  return distance(best.position) > core.length * 4 ? null : best.position;
}

// Conserved stretches of the attP arms. An att site is attL when the attP-derived arm sits
// upstream of its core, attR when it sits downstream, attP when both do and attB when neither
// does, which is how a real entry or destination clone is recognised without annotation.
const ATTP_LEFT_ARM = 'GACTGATAGTGACCTGT';
const ATTP_RIGHT_ARM = 'CAGACTACATAAT';
const ATTP_ARM_WINDOW = 140;

/**
 * Locates an att site from its recombination core and arms, for molecules whose att sites are
 * not annotated. `kind` is the series letter: B, P, L or R.
 */
function findAttSiteByCore(
  doc: PlasmidDocument,
  series: 1 | 2 | 3 | 4 | 5,
  kind: 'B' | 'P' | 'L' | 'R',
): AttSiteLocation | null {
  const circular = doc.topology === 'circular';
  const core = GATEWAY_CORES[series];
  for (const match of findMotifOnBothStrands(doc.sequence, core, circular)) {
    // Read the neighbourhood in the site's own 5'->3' direction.
    const before = sequenceSlice(doc.sequence, match.position - ATTP_ARM_WINDOW, match.position, circular);
    const after = sequenceSlice(
      doc.sequence,
      match.position + core.length,
      match.position + core.length + ATTP_ARM_WINDOW,
      circular,
    );
    const upstream = match.strand === 1 ? before : reverseComplement(after);
    const downstream = match.strand === 1 ? after : reverseComplement(before);
    const hasLeftArm = upstream.includes(ATTP_LEFT_ARM);
    const hasRightArm = downstream.includes(ATTP_RIGHT_ARM);
    const matchesKind =
      kind === 'L'
        ? hasLeftArm && !hasRightArm
        : kind === 'R'
          ? hasRightArm && !hasLeftArm
          : kind === 'P'
            ? hasLeftArm && hasRightArm
            : !hasLeftArm && !hasRightArm;
    if (!matchesKind) continue;
    // Span the arm the site actually carries, so the crossover keeps the right amount of flank.
    const armBefore = hasLeftArm
      ? upstream.length - upstream.lastIndexOf(ATTP_LEFT_ARM)
      : Math.min(GATEWAY_ATT_SITES.attB1.length, upstream.length);
    const armAfter = hasRightArm
      ? downstream.indexOf(ATTP_RIGHT_ARM) + ATTP_RIGHT_ARM.length
      : Math.min(GATEWAY_ATT_SITES.attB1.length, downstream.length);
    const leading = match.strand === 1 ? armBefore : armAfter;
    const trailing = match.strand === 1 ? armAfter : armBefore;
    const start = match.position - leading;
    const end = match.position + core.length + trailing;
    if (!circular && (start < 0 || end > doc.length)) continue;
    return {
      start: circular ? mod(start, doc.length) : start,
      end: circular ? mod(end, doc.length) : end,
      strand: match.strand,
      name: `att${kind}${series}`,
    };
  }
  return null;
}

/** Cut coordinates of a recombination between two att sites, or null if a core is missing. */
function gatewayCoreCuts(
  left: { doc: PlasmidDocument; first: AttSiteLocation; second: AttSiteLocation },
  right: { doc: PlasmidDocument; first: AttSiteLocation; second: AttSiteLocation },
): { leftFirst: number; leftSecond: number; rightFirst: number; rightSecond: number } | null {
  const leftFirst = findGatewayCore(left.doc, left.first, 1);
  const leftSecond = findGatewayCore(left.doc, left.second, 2);
  const rightFirst = findGatewayCore(right.doc, right.first, 1);
  const rightSecond = findGatewayCore(right.doc, right.second, 2);
  if (leftFirst === null || leftSecond === null || rightFirst === null || rightSecond === null) {
    return null;
  }
  return { leftFirst, leftSecond, rightFirst, rightSecond };
}

/**
 * Feature spanning the att site that a crossover builds at `junction`, the position in the
 * product where the second parent's piece begins. The arms are taken from how much of each
 * parent's annotated att site lies outside its core.
 */
function junctionAttFeature(
  name: string,
  junction: number,
  upstream: { doc: PlasmidDocument; site: AttSiteLocation; core: number },
  downstream: { doc: PlasmidDocument; site: AttSiteLocation; core: number },
  productLength: number,
): SequenceFeature | null {
  const armBefore = Math.max(0, rangeLength(upstream.site.start, upstream.core, upstream.doc.length, upstream.doc.topology === 'circular'));
  const armAfter = Math.max(0, rangeLength(downstream.core, downstream.site.end, downstream.doc.length, downstream.doc.topology === 'circular'));
  const start = junction - armBefore;
  const end = junction + armAfter;
  if (end <= start || start < 0 || end > productLength) return null;
  return attFeature(name, start, end);
}

function findAttSite(doc: PlasmidDocument, names: string[], motifs: string[]): AttSiteLocation | null {
  const normalisedNames = names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const feature of doc.features) {
    const featureName = feature.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalisedNames.some((name) => featureName.includes(name))) {
      return { start: feature.start, end: feature.end, strand: feature.strand === -1 ? -1 : 1, name: feature.name };
    }
  }
  for (const motif of motifs) {
    const matches = findMotifOnBothStrands(doc.sequence, motif, doc.topology === 'circular');
    const match = matches.find((candidate) => candidate.strand === 1) ?? matches[0];
    if (match) {
      return {
        start: match.position,
        end: match.position + motif.length,
        strand: match.strand,
        name: motif,
      };
    }
  }
  return null;
}

function attFeature(name: string, start: number, end: number): SequenceFeature {
  return {
    id: uid('feature'),
    name,
    type: 'attachment_site',
    start,
    end,
    strand: 1,
    color: '#7c3aed',
    notes: { gateway: [`${name} recombination product`] },
  };
}

interface SegmentData {
  sequence: string;
  features: SequenceFeature[];
  primers: Primer[];
}

function segmentFrom(doc: PlasmidDocument, start: number, end: number): SegmentData {
  const data = sliceDocumentData(doc, start, end, { circular: doc.topology === 'circular' });
  return { sequence: data.sequence, features: data.features, primers: data.primers };
}

function shiftFeatureWithSegments(feature: SequenceFeature, offset: number): SequenceFeature {
  const shifted = shiftFeature(feature, offset);
  if (shifted.notes?.segments) {
    shifted.notes = {
      ...shifted.notes,
      segments: shifted.notes.segments.map((text) => {
        const match = /^\s*(-?\d+)\s*-\s*(-?\d+)\s*$/.exec(text);
        if (!match) return text;
        return `${Number(match[1]) + offset}-${Number(match[2]) + offset}`;
      }),
    };
  }
  return shifted;
}

function appendSegment(
  target: SegmentData,
  segment: SegmentData,
  featureOverrides?: SequenceFeature[],
): void {
  const offset = target.sequence.length;
  target.sequence += segment.sequence;
  target.features.push(...segment.features.map((feature) => shiftFeatureWithSegments(feature, offset)));
  target.primers.push(...segment.primers.map((primer) => shiftPrimer(primer, offset)));
  if (featureOverrides) target.features.push(...featureOverrides);
}

function buildGatewayProduct(
  name: string,
  operation: 'gateway_bp' | 'gateway_lr',
  sourceDocs: PlasmidDocument[],
  segments: SegmentData[],
  attSites: Array<{ name: string; sequence: string }>,
  topology: 'circular' | 'linear',
  warnings: string[],
  linearEnds?: { left: OverhangEnd; right: OverhangEnd },
): PlasmidDocument {
  const data: SegmentData = { sequence: '', features: [], primers: [] };
  let attIndex = 0;
  for (const segment of segments) {
    appendSegment(data, segment);
    if (attIndex < attSites.length && segment !== segments[segments.length - 1]) {
      const att = attSites[attIndex];
      const start = data.sequence.length;
      data.sequence += att.sequence;
      data.features.push(attFeature(att.name, start, start + att.sequence.length));
      attIndex += 1;
    }
  }
  while (attIndex < attSites.length) {
    const att = attSites[attIndex];
    const start = data.sequence.length;
    data.sequence += att.sequence;
    data.features.push(attFeature(att.name, start, start + att.sequence.length));
    attIndex += 1;
  }
  const doc = makeDocument({
    name,
    sequence: data.sequence,
    topology,
    features: data.features,
    primers: data.primers,
    history: sourceDocs.flatMap((doc) => doc.history.map(cloneHistoryNode)),
    linearEnds,
    methylationProfile: sourceDocs[0]?.methylationProfile,
  });
  appendHistory(
    doc,
    makeHistoryNode(
      operation,
      `${operation === 'gateway_bp' ? 'BP' : 'LR'} recombination of ${sourceDocs.length} plasmid(s).`,
      {
        parentSnapshots: sourceDocs.map((source) => parentSnapshot(source)),
      },
    ),
  );
  return doc;
}

function gatewayBackboneSegments(
  doc: PlasmidDocument,
  leftSite: AttSiteLocation,
  rightSite: AttSiteLocation,
): { segments: SegmentData[]; before?: SegmentData; after?: SegmentData; circular: boolean } {
  if (doc.topology === 'circular') {
    return {
      segments: [segmentFrom(doc, rightSite.end, leftSite.start)],
      circular: true,
    };
  }
  const before = segmentFrom(doc, 0, leftSite.start);
  const after = segmentFrom(doc, rightSite.end, doc.length);
  return { segments: [before, after], before, after, circular: false };
}

/**
 * Products of a Gateway reaction built by cutting both parents inside their recombination cores
 * and joining them crosswise: the product keeps the vector backbone plus the insert's gene, and
 * the byproduct keeps the vector's internal cassette plus the rest of the insert. Returns null
 * when a core cannot be located, so the caller can fall back to joining at the annotated edges.
 */
function gatewayCoreProducts(options: {
  insert: PlasmidDocument;
  vector: PlasmidDocument;
  insertFirst: AttSiteLocation;
  insertSecond: AttSiteLocation;
  vectorFirst: AttSiteLocation;
  vectorSecond: AttSiteLocation;
  operation: 'gateway_bp' | 'gateway_lr';
  productName: string;
  byproductName: string;
  productSiteNames: [string, string];
  warnings: string[];
}): { product: PlasmidDocument; byproduct: PlasmidDocument } | null {
  const { insert, vector, insertFirst, insertSecond, vectorFirst, vectorSecond, warnings } = options;
  if (vector.topology !== 'circular') return null;
  const cuts = gatewayCoreCuts(
    { doc: insert, first: insertFirst, second: insertSecond },
    { doc: vector, first: vectorFirst, second: vectorSecond },
  );
  if (!cuts) return null;

  const gene = segmentFrom(insert, cuts.leftFirst, cuts.leftSecond);
  const backbone = segmentFrom(vector, cuts.rightSecond, cuts.rightFirst);
  const productData: SegmentData = { sequence: '', features: [], primers: [] };
  appendSegment(productData, backbone);
  const junction = productData.sequence.length;
  appendSegment(productData, gene);
  const productLength = productData.sequence.length;
  const firstSite = junctionAttFeature(
    options.productSiteNames[0],
    junction,
    { doc: vector, site: vectorFirst, core: cuts.rightFirst },
    { doc: insert, site: insertFirst, core: cuts.leftFirst },
    productLength,
  );
  // The second site straddles the circle's seam, so it is annotated as a wrapping feature.
  const secondArmBefore = rangeLength(
    insertSecond.start,
    cuts.leftSecond,
    insert.length,
    insert.topology === 'circular',
  );
  const secondArmAfter = rangeLength(
    cuts.rightSecond,
    vectorSecond.end,
    vector.length,
    vector.topology === 'circular',
  );
  const secondSite =
    secondArmBefore > 0 && secondArmAfter > 0 && secondArmBefore + secondArmAfter <= productLength
      ? attFeature(
          options.productSiteNames[1],
          mod(productLength - secondArmBefore, productLength),
          mod(secondArmAfter, productLength),
        )
      : null;
  if (firstSite) productData.features.push(firstSite);
  if (secondSite) productData.features.push(secondSite);
  const product = buildGatewayProduct(
    options.productName,
    options.operation,
    [insert, vector],
    [productData],
    [],
    'circular',
    warnings,
  );

  const cassette = segmentFrom(vector, cuts.rightFirst, cuts.rightSecond);
  const insertIsCircular = insert.topology === 'circular';
  const byproductSegments: SegmentData[] = insertIsCircular
    ? [segmentFrom(insert, cuts.leftSecond, cuts.leftFirst), cassette]
    : [
        segmentFrom(insert, 0, cuts.leftFirst),
        cassette,
        segmentFrom(insert, cuts.leftSecond, insert.length),
      ];
  const byproduct = buildGatewayProduct(
    options.byproductName,
    options.operation,
    [vector, insert],
    byproductSegments,
    [],
    insertIsCircular ? 'circular' : 'linear',
    warnings,
    insertIsCircular
      ? undefined
      : {
          left: copyOverhang(insert.linearEnds?.left ?? bluntOverhang()),
          right: copyOverhang(insert.linearEnds?.right ?? bluntOverhang()),
        },
  );
  return { product, byproduct };
}

export function simulateGatewayBP(
  attBInsert: PlasmidDocument,
  donor: PlasmidDocument,
): { entryClone: PlasmidDocument | null; byproduct: PlasmidDocument | null; warnings: string[] } {
  const warnings: string[] = [];
  const b1 = findAttSite(attBInsert, ['attB1', 'attb1'], [GATEWAY_ATT_SITES.attB1]) ?? findAttSiteByCore(attBInsert, 1, 'B');
  const b2 = findAttSite(attBInsert, ['attB2', 'attb2'], [GATEWAY_ATT_SITES.attB2]) ?? findAttSiteByCore(attBInsert, 2, 'B');
  const p1 = findAttSite(donor, ['attP1', 'attp1'], [GATEWAY_ATT_SITES.attP1, 'ACAAGTTTGTACAAAAAAGCTGAAC']) ?? findAttSiteByCore(donor, 1, 'P');
  const p2 = findAttSite(donor, ['attP2', 'attp2'], [GATEWAY_ATT_SITES.attP2, 'ACCCAGCTTTCTTGTACAAAGTGGT', 'ACCCAGCTTTCTTGTACAAAGTGGTT']) ?? findAttSiteByCore(donor, 2, 'P');
  if (!b1 || !b2) {
    return { entryClone: null, byproduct: null, warnings: ['attB1 and attB2 sites must both be present on the insert.'] };
  }
  if (!p1 || !p2) {
    return { entryClone: null, byproduct: null, warnings: ['attP1 and attP2 sites must both be present on the donor vector.'] };
  }
  if (b1.start >= b2.start) warnings.push('attB1 is downstream of attB2; verify the insert orientation.');
  if (p1.start >= p2.start) warnings.push('attP1 is downstream of attP2; verify the donor orientation.');
  if (attBInsert.topology !== 'circular') warnings.push('The attB insert is linear; the entry clone will be linear.');
  if (donor.topology !== 'circular') warnings.push('The donor vector is linear; the entry clone will be linear.');
  const topology = donor.topology === 'circular' ? 'circular' : 'linear';
  const coreProducts = gatewayCoreProducts({
    insert: attBInsert,
    vector: donor,
    insertFirst: b1,
    insertSecond: b2,
    vectorFirst: p1,
    vectorSecond: p2,
    operation: 'gateway_bp',
    productName: `${attBInsert.name}_entry`,
    byproductName: `${donor.name}_bp_byproduct`,
    productSiteNames: ['attL1', 'attL2'],
    warnings,
  });
  if (coreProducts) {
    return { entryClone: coreProducts.product, byproduct: coreProducts.byproduct, warnings };
  }
  warnings.push('Gateway cores were not found; the att sites were joined at their annotated edges.');
  const insertInternal = segmentFrom(attBInsert, b1.end, b2.start);
  const donorBackbone = gatewayBackboneSegments(donor, p1, p2);
  const entrySegments = donorBackbone.circular
    ? [...donorBackbone.segments, insertInternal]
    : [donorBackbone.before!, insertInternal, donorBackbone.after!];
  const entryClone = buildGatewayProduct(
    `${attBInsert.name}_entry`,
    'gateway_bp',
    [attBInsert, donor],
    entrySegments,
    [
      { name: 'attL1', sequence: GATEWAY_ATT_SITES.attL1 },
      { name: 'attL2', sequence: GATEWAY_ATT_SITES.attL2 },
    ],
    topology,
    warnings,
    topology === 'linear'
      ? { left: copyOverhang(donor.linearEnds?.left ?? bluntOverhang()), right: copyOverhang(donor.linearEnds?.right ?? bluntOverhang()) }
      : undefined,
  );
  const insertBefore = attBInsert.topology === 'circular' ? undefined : segmentFrom(attBInsert, 0, b1.start);
  const insertBackbone = attBInsert.topology === 'circular'
    ? segmentFrom(attBInsert, b2.end, b1.start)
    : undefined;
  const insertAfter = attBInsert.topology === 'circular' ? undefined : segmentFrom(attBInsert, b2.end, attBInsert.length);
  const donorInternal = segmentFrom(donor, p1.end, p2.start);
  const byproductTopology = attBInsert.topology === 'circular' ? 'circular' : 'linear';
  const byproductSegments = attBInsert.topology === 'circular'
    ? [insertBackbone!, donorInternal]
    : [insertBefore!, donorInternal, insertAfter!];
  const byproduct = buildGatewayProduct(
    `${donor.name}_bp_byproduct`,
    'gateway_bp',
    [donor, attBInsert],
    byproductSegments,
    [
      { name: 'attR1', sequence: GATEWAY_ATT_SITES.attR1 },
      { name: 'attR2', sequence: GATEWAY_ATT_SITES.attR2 },
    ],
    byproductTopology,
    warnings,
    byproductTopology === 'linear'
      ? { left: copyOverhang(attBInsert.linearEnds?.left ?? bluntOverhang()), right: copyOverhang(attBInsert.linearEnds?.right ?? bluntOverhang()) }
      : undefined,
  );
  if (entryClone.length === 0 || byproduct.length === 0) {
    warnings.push('One or more BP recombination products are empty.');
  }
  return { entryClone, byproduct, warnings };
}

export function simulateGatewayLR(
  entryClone: PlasmidDocument,
  destination: PlasmidDocument,
): { expressionClone: PlasmidDocument | null; byproduct: PlasmidDocument | null; warnings: string[] } {
  const warnings: string[] = [];
  const l1 = findAttSite(entryClone, ['attL1', 'attl1'], []) ?? findAttSiteByCore(entryClone, 1, 'L');
  const l2 = findAttSite(entryClone, ['attL2', 'attl2'], []) ?? findAttSiteByCore(entryClone, 2, 'L');
  const r1 = findAttSite(destination, ['attR1', 'attr1'], []) ?? findAttSiteByCore(destination, 1, 'R');
  const r2 = findAttSite(destination, ['attR2', 'attr2'], []) ?? findAttSiteByCore(destination, 2, 'R');
  if (!l1 || !l2) {
    return { expressionClone: null, byproduct: null, warnings: ['attL1 and attL2 sites must both be present on the entry clone.'] };
  }
  if (!r1 || !r2) {
    return { expressionClone: null, byproduct: null, warnings: ['attR1 and attR2 sites must both be present on the destination vector.'] };
  }
  if (l1.start >= l2.start) warnings.push('attL1 is downstream of attL2; verify the entry clone orientation.');
  if (r1.start >= r2.start) warnings.push('attR1 is downstream of attR2; verify the destination orientation.');
  if (entryClone.topology !== 'circular') warnings.push('The entry clone is linear; the expression clone will be linear.');
  if (destination.topology !== 'circular') warnings.push('The destination vector is linear; the expression clone will be linear.');
  const coreProducts = gatewayCoreProducts({
    insert: entryClone,
    vector: destination,
    insertFirst: l1,
    insertSecond: l2,
    vectorFirst: r1,
    vectorSecond: r2,
    operation: 'gateway_lr',
    productName: `${entryClone.name}_expression`,
    byproductName: `${entryClone.name}_lr_byproduct`,
    productSiteNames: ['attB1', 'attB2'],
    warnings,
  });
  if (coreProducts) {
    return { expressionClone: coreProducts.product, byproduct: coreProducts.byproduct, warnings };
  }
  const topology = destination.topology === 'circular' ? 'circular' : 'linear';
  const insertInternal = segmentFrom(entryClone, l1.end, l2.start);
  const destinationBackbone = gatewayBackboneSegments(destination, r1, r2);
  const expressionSegments = destinationBackbone.circular
    ? [...destinationBackbone.segments, insertInternal]
    : [destinationBackbone.before!, insertInternal, destinationBackbone.after!];
  const expressionClone = buildGatewayProduct(
    `${entryClone.name}_expression`,
    'gateway_lr',
    [entryClone, destination],
    expressionSegments,
    [
      { name: 'attB1', sequence: GATEWAY_ATT_SITES.attB1 },
      { name: 'attB2', sequence: GATEWAY_ATT_SITES.attB2 },
    ],
    topology,
    warnings,
    topology === 'linear'
      ? { left: copyOverhang(destination.linearEnds?.left ?? bluntOverhang()), right: copyOverhang(destination.linearEnds?.right ?? bluntOverhang()) }
      : undefined,
  );
  const entryBefore = entryClone.topology === 'circular' ? undefined : segmentFrom(entryClone, 0, l1.start);
  const entryBackbone = entryClone.topology === 'circular'
    ? segmentFrom(entryClone, l2.end, l1.start)
    : undefined;
  const entryAfter = entryClone.topology === 'circular' ? undefined : segmentFrom(entryClone, l2.end, entryClone.length);
  const destinationInternal = segmentFrom(destination, r1.end, r2.start);
  const byproductTopology = entryClone.topology === 'circular' ? 'circular' : 'linear';
  const byproductSegments = entryClone.topology === 'circular'
    ? [entryBackbone!, destinationInternal]
    : [entryBefore!, destinationInternal, entryAfter!];
  const byproduct = buildGatewayProduct(
    `${entryClone.name}_lr_byproduct`,
    'gateway_lr',
    [destination, entryClone],
    byproductSegments,
    [
      { name: 'attP1', sequence: GATEWAY_ATT_SITES.attP1 },
      { name: 'attP2', sequence: GATEWAY_ATT_SITES.attP2 },
    ],
    byproductTopology,
    warnings,
    byproductTopology === 'linear'
      ? { left: copyOverhang(entryClone.linearEnds?.left ?? bluntOverhang()), right: copyOverhang(entryClone.linearEnds?.right ?? bluntOverhang()) }
      : undefined,
  );
  if (expressionClone.length === 0 || byproduct.length === 0) {
    warnings.push('One or more LR recombination products are empty.');
  }
  return { expressionClone, byproduct, warnings };
}

interface GatewayLRHit {
  name: GatewayLRName;
  start: number;
  end: number;
  strand: 1 | -1;
  annotated: boolean;
}

function parseGatewayLRFeatureName(
  text: string,
): { site: GatewayLRName; reversed: boolean } | null {
  const match = /att([lr])([1-5])(r(?![a-z0-9]))?/i.exec(text.trim());
  if (!match) return null;
  const site = `att${match[1].toUpperCase()}${match[2]}` as GatewayLRName;
  return { site, reversed: Boolean(match[3]) };
}

function gatewayLRArcOverlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
  length: number,
  circular: boolean,
): boolean {
  if (!circular) return a.start < b.end && b.start < a.end;
  const aLength = a.end - a.start;
  for (const shift of [-length, 0, length]) {
    const shifted = a.start + shift;
    if (shifted < b.end && b.start < shifted + aLength) return true;
  }
  return false;
}

/**
 * Locates all MultiSite Gateway attL/attR sites in a document. Feature
 * annotations take precedence over sequence matches, and longer sequence
 * matches win over shorter cores that are contained inside them (for example
 * the attL2 core that is also the 5' part of attR2).
 */
function collectGatewayLRSites(doc: PlasmidDocument): GatewayLRHit[] {
  const circular = doc.topology === 'circular';
  const hits: GatewayLRHit[] = [];
  for (const feature of doc.features) {
    const parsed = parseGatewayLRFeatureName(feature.name);
    if (!parsed) continue;
    hits.push({
      name: parsed.site,
      start: feature.start,
      end: feature.end,
      strand: parsed.reversed || feature.strand === -1 ? -1 : 1,
      annotated: true,
    });
  }
  for (const name of GATEWAY_LR_NAMES) {
    const motif = GATEWAY_ATT_SITES[name];
    for (const match of findMotifOnBothStrands(doc.sequence, motif, circular)) {
      hits.push({
        name,
        start: match.position,
        end: match.position + motif.length,
        strand: match.strand,
        annotated: false,
      });
    }
  }
  const unique: GatewayLRHit[] = [];
  for (const hit of hits) {
    if (
      unique.some(
        (existing) =>
          existing.name === hit.name &&
          existing.start === hit.start &&
          existing.end === hit.end &&
          existing.strand === hit.strand,
      )
    ) {
      continue;
    }
    unique.push(hit);
  }
  const sorted = unique.sort((a, b) => {
    if (a.annotated !== b.annotated) return a.annotated ? -1 : 1;
    const lengthDifference = b.end - b.start - (a.end - a.start);
    if (lengthDifference !== 0) return lengthDifference;
    return a.start - b.start;
  });
  const resolved: GatewayLRHit[] = [];
  for (const hit of sorted) {
    if (resolved.some((existing) => gatewayLRArcOverlaps(existing, hit, doc.length, circular))) {
      continue;
    }
    resolved.push(hit);
  }
  return resolved.sort((a, b) => a.start - b.start);
}

function gatewayPairIsCompatible(left: string, right: string): boolean {
  const forward =
    (left === 'attL1' && (right === 'attR5' || right === 'attL4')) ||
    (left === 'attL5' && (right === 'attL4' || right === 'attL2')) ||
    (left === 'attR4' && right === 'attR3') ||
    (left === 'attL3' && right === 'attL2');
  if (forward) return true;
  return (
    (right === 'attL1' && (left === 'attR5' || left === 'attL4')) ||
    (right === 'attL5' && (left === 'attL4' || left === 'attL2')) ||
    (right === 'attR4' && left === 'attR3') ||
    (right === 'attL3' && left === 'attL2')
  );
}

function gatewayProductSite(name: string): string {
  const match = /^att[LR]([1-5])$/.exec(name);
  return match ? `attB${match[1]}` : 'attB1';
}

interface GatewayEntryLayout {
  doc: PlasmidDocument;
  left: GatewayLRHit;
  right: GatewayLRHit;
  reversed: boolean;
  segment: SegmentData;
}

function gatewayReversedSegment(
  doc: PlasmidDocument,
  start: number,
  end: number,
): SegmentData {
  const data = sliceDocumentData(doc, start, end, {
    circular: doc.topology === 'circular',
    reverse: true,
  });
  return {
    sequence: reverseComplement(data.sequence),
    features: data.features,
    primers: data.primers,
  };
}

function gatewayExpectedLayout(count: number): Array<[GatewayLRName, GatewayLRName]> | null {
  switch (count) {
    case 1:
      return [['attL1', 'attL2']];
    case 2:
      return [
        ['attL1', 'attR5'],
        ['attL5', 'attL2'],
      ];
    case 3:
      return [
        ['attL1', 'attL4'],
        ['attR4', 'attR3'],
        ['attL3', 'attL2'],
      ];
    case 4:
      return [
        ['attL1', 'attR5'],
        ['attL5', 'attL4'],
        ['attR4', 'attR3'],
        ['attL3', 'attL2'],
      ];
    default:
      return null;
  }
}

function isBackboneMarker(feature: SequenceFeature): boolean {
  return (
    feature.type === 'rep_origin' ||
    /(^|[^a-z])(ori|origin|kan|kanr|ampr|bla|aada|spec|str|cmr|ccdb|backbone|resistance)/i.test(
      feature.name,
    )
  );
}

function backboneMarkerCount(segment: SegmentData): number {
  return segment.features.filter(isBackboneMarker).length;
}

function arcInsertScore(segment: SegmentData): number {
  const markers = backboneMarkerCount(segment);
  const informative = segment.features.filter(
    (feature) =>
      !/att[LRBP]\d/i.test(feature.name) &&
      !isBackboneMarker(feature) &&
      (feature.type === 'CDS' ||
        feature.type === 'promoter' ||
        feature.type === 'terminator' ||
        feature.type === 'regulatory' ||
        feature.type === 'enhancer' ||
        feature.type === 'protein_bind'),
  ).length;
  return markers * 100 - Math.min(informative, 9);
}

function gatewayLayoutForEntry(
  doc: PlasmidDocument,
  expected: [GatewayLRName, GatewayLRName],
  index: number,
  warnings: string[],
): GatewayEntryLayout | null {
  const hits = collectGatewayLRSites(doc);
  const [expectedLeft, expectedRight] = expected;
  const left = hits.find((hit) => hit.name === expectedLeft) ?? null;
  const right = hits.find((hit) => hit.name === expectedRight) ?? null;
  let leftHit = left;
  let rightHit = right;
  if (!leftHit || !rightHit) {
    const pair = hits.find((candidate, candidateIndex) =>
      hits.some(
        (other, otherIndex) =>
          otherIndex !== candidateIndex &&
          !gatewayLRArcOverlaps(candidate, other, doc.length, doc.topology === 'circular') &&
          gatewayPairIsCompatible(candidate.name, other.name),
      ),
    );
    if (pair) {
      const other = hits.find(
        (candidate) =>
          candidate !== pair &&
          !gatewayLRArcOverlaps(candidate, pair, doc.length, doc.topology === 'circular') &&
          gatewayPairIsCompatible(pair.name, candidate.name),
      );
      if (other) {
        leftHit = pair;
        rightHit = other;
      }
    }
    if (!leftHit || !rightHit) {
      const remaining = hits.filter(
        (candidate) =>
          candidate !== leftHit &&
          candidate !== rightHit &&
          (!leftHit ||
            !gatewayLRArcOverlaps(candidate, leftHit, doc.length, doc.topology === 'circular')) &&
          (!rightHit ||
            !gatewayLRArcOverlaps(candidate, rightHit, doc.length, doc.topology === 'circular')),
      );
      if (!leftHit && remaining.length) leftHit = remaining.shift() ?? null;
      if (!rightHit && remaining.length) rightHit = remaining.shift() ?? null;
    }
    if (!leftHit || !rightHit) {
      warnings.push(
        `Entry clone ${index + 1} (${doc.name}) does not contain two usable attL/attR sites.`,
      );
      return null;
    }
    warnings.push(
      `Entry clone ${index + 1} (${doc.name}) carries ${leftHit.name}/${rightHit.name} instead of the expected ${expectedLeft}/${expectedRight}; the detected sites were used.`,
    );
  }
  if (leftHit.start === rightHit.start && leftHit.end === rightHit.end) {
    warnings.push(`Entry clone ${index + 1} (${doc.name}) has both att sites on the same coordinates.`);
    return null;
  }
  let reversed = leftHit.strand === -1 && rightHit.strand === 1;
  let forwardSegment: SegmentData | null = null;
  let reverseSegment: SegmentData | null = null;
  if (leftHit.strand === rightHit.strand) {
    forwardSegment = segmentFrom(doc, leftHit.end, rightHit.start);
    reverseSegment = gatewayReversedSegment(doc, rightHit.end, leftHit.start);
    const forwardMarkers = backboneMarkerCount(forwardSegment);
    const reverseMarkers = backboneMarkerCount(reverseSegment);
    if (reverseMarkers !== forwardMarkers) {
      reversed = reverseMarkers < forwardMarkers;
    } else {
      reversed = arcInsertScore(reverseSegment) < arcInsertScore(forwardSegment);
    }
    warnings.push(
      `Entry clone ${index + 1} (${doc.name}) has both att sites on the same strand; the insert orientation was inferred from the vector backbone and insert annotations.`,
    );
  }
  let segment: SegmentData;
  if (reversed) {
    warnings.push(
      `Entry clone ${index + 1} (${doc.name}) is in the reverse orientation; the insert was flipped for assembly.`,
    );
    segment = reverseSegment ?? gatewayReversedSegment(doc, rightHit.end, leftHit.start);
  } else {
    segment = forwardSegment ?? segmentFrom(doc, leftHit.end, rightHit.start);
  }
  return { doc, left: leftHit, right: rightHit, reversed, segment };
}

/**
 * Simulates a MultiSite Gateway LR reaction for two to four entry clones.
 *
 * The entry clones are supplied in biological order. Each clone is expected
 * to expose the site pair used by the corresponding MultiSite reaction:
 * L1-R5/L5-L2 (2 fragments), L1-L4/R4-R3/L3-L2 (3 fragments) or
 * L1-R5/L5-L4/R4-R3/L3-L2 (4 fragments). The destination must contain attR1
 * and attR2. Mismatched site order or orientation is reported in `warnings`;
 * the assembled product still uses the detected sites so that the result can
 * be inspected.
 */
export function simulateMultiSiteGatewayLR(
  entryClones: PlasmidDocument[],
  destination: PlasmidDocument,
): { expressionClone: PlasmidDocument | null; warnings: string[] } {
  const warnings: string[] = [];
  if (entryClones.length === 0) {
    return { expressionClone: null, warnings: ['At least one entry clone is required.'] };
  }
  const layout = gatewayExpectedLayout(entryClones.length);
  if (!layout) {
    return {
      expressionClone: null,
      warnings: ['MultiSite Gateway LR supports one to four entry clones.'],
    };
  }
  if (entryClones.length === 1) {
    warnings.push('A single entry clone was supplied; consider using simulateGatewayLR for a standard LR reaction.');
  }
  const r1 = findAttSite(destination, ['attR1', 'attr1'], [GATEWAY_ATT_SITES.attR1]);
  const r2 = findAttSite(destination, ['attR2', 'attr2'], [GATEWAY_ATT_SITES.attR2]);
  if (!r1 || !r2) {
    return {
      expressionClone: null,
      warnings: ['attR1 and attR2 sites must both be present on the destination vector.'],
    };
  }
  if (r1.start >= r2.start) {
    warnings.push('attR1 is downstream of attR2; verify the destination orientation.');
  }
  const entries: GatewayEntryLayout[] = [];
  for (let index = 0; index < entryClones.length; index += 1) {
    const entry = gatewayLayoutForEntry(entryClones[index], layout[index], index, warnings);
    if (!entry) {
      return { expressionClone: null, warnings };
    }
    if (entry.doc.topology !== 'circular') {
      warnings.push(
        `Entry clone ${index + 1} (${entry.doc.name}) is linear; circular assembly may be incomplete.`,
      );
    }
    entries.push(entry);
  }

  const attSites: Array<{ name: string; sequence: string }> = [];
  attSites.push({ name: 'attB1', sequence: GATEWAY_ATT_SITES.attB1 });
  for (let index = 0; index < entries.length - 1; index += 1) {
    const leftName = entries[index].right.name;
    const rightName = entries[index + 1].left.name;
    const compatible =
      (leftName === 'attR5' && rightName === 'attL5') ||
      (leftName === 'attL4' && rightName === 'attR4') ||
      (leftName === 'attR3' && rightName === 'attL3');
    if (!compatible) {
      warnings.push(
        `Incompatible junction between entry clone ${index + 1} (${leftName}) and entry clone ${index + 2} (${rightName}); predicted recombination scar ${gatewayProductSite(leftName)}.`,
      );
    }
    const productName = compatible
      ? leftName === 'attR5'
        ? 'attB5'
        : leftName === 'attL4'
          ? 'attB4'
          : 'attB3'
      : gatewayProductSite(leftName);
    attSites.push({
      name: productName,
      sequence: GATEWAY_ATT_SITES[productName as keyof typeof GATEWAY_ATT_SITES],
    });
  }
  attSites.push({ name: 'attB2', sequence: GATEWAY_ATT_SITES.attB2 });

  if (entries[0].left.name !== 'attL1') {
    warnings.push(
      `The first entry clone starts with ${entries[0].left.name} instead of attL1; the destination attR1 junction is not specific.`,
    );
  }
  const last = entries[entries.length - 1];
  if (last.right.name !== 'attL2') {
    warnings.push(
      `The last entry clone ends with ${last.right.name} instead of attL2; the destination attR2 junction is not specific.`,
    );
  }

  const topology = destination.topology;
  const insertSegments = entries.map((entry) => entry.segment);
  let segments: SegmentData[];
  if (topology === 'circular') {
    const backbone = segmentFrom(destination, r2.end, r1.start);
    segments = [backbone, ...insertSegments];
  } else {
    const before = segmentFrom(destination, 0, r1.start);
    const after = segmentFrom(destination, r2.end, destination.length);
    segments = [before, ...insertSegments, after];
  }

  const expressionClone = buildGatewayProduct(
    `${destination.name}_${entries.length}way_expression`,
    'gateway_lr',
    [destination, ...entryClones],
    segments,
    attSites,
    topology,
    warnings,
    topology === 'linear'
      ? {
          left: copyOverhang(destination.linearEnds?.left ?? bluntOverhang()),
          right: copyOverhang(destination.linearEnds?.right ?? bluntOverhang()),
        }
      : undefined,
  );
  if (expressionClone.length === 0) {
    warnings.push('The MultiSite LR expression clone is empty.');
    return { expressionClone: null, warnings };
  }
  return { expressionClone, warnings };
}

interface PrimerBinding {
  start: number;
  end: number;
  tail: string;
  annealing: string;
  strand: 1 | -1;
  primer?: Primer;
}

function countBindingSites(
  template: string,
  query: string,
  circular: boolean,
  maxMismatches: number,
): number {
  const length = template.length;
  const queryLength = query.length;
  if (!queryLength || queryLength > length) return 0;
  let count = 0;
  for (let start = 0; start < length; start += 1) {
    if (!circular && start + queryLength > length) break;
    const region = sequenceSlice(template, start, start + queryLength, circular);
    if (region.length !== queryLength) continue;
    let mismatches = 0;
    for (let index = 0; index < queryLength; index += 1) {
      if (region[index] !== query[index]) mismatches += 1;
      if (mismatches > maxMismatches) break;
    }
    if (mismatches <= maxMismatches) count += 1;
  }
  return count;
}

function findStringBinding(
  primerSequence: string,
  template: string,
  strand: 1 | -1,
  circular: boolean,
  minAnneal: number,
  maxMismatches: number,
): { binding: PrimerBinding; siteCount: number } | null {
  const primer = normalizeDNA(primerSequence);
  const templateLength = template.length;
  let best: { start: number; end: number; length: number; mismatches: number; tail: string; siteCount: number } | null = null;
  const maximum = Math.min(primer.length, templateLength);
  for (let length = maximum; length >= minAnneal; length -= 1) {
    const suffix = primer.slice(primer.length - length);
    const query = strand === 1 ? suffix : reverseComplement(suffix);
    for (let start = 0; start < templateLength; start += 1) {
      if (!circular && start + length > templateLength) break;
      const region = sequenceSlice(template, start, start + length, circular);
      if (region.length !== length) continue;
      let mismatches = 0;
      for (let index = 0; index < length; index += 1) {
        if (region[index] !== query[index]) mismatches += 1;
        if (mismatches > maxMismatches) break;
      }
      if (mismatches > maxMismatches) continue;
      if (region[length - 1] !== query[length - 1]) continue;
      const candidate = {
        start,
        end: circular ? mod(start + length, templateLength) : start + length,
        length,
        mismatches,
        tail: primer.slice(0, primer.length - length),
        siteCount: countBindingSites(template, query, circular, maxMismatches),
      };
      if (
        !best ||
        candidate.mismatches < best.mismatches ||
        (candidate.mismatches === best.mismatches && candidate.length > best.length)
      ) {
        best = candidate;
      }
    }
  }
  if (!best) return null;
  return {
    binding: {
      start: best.start,
      end: best.end,
      tail: best.tail,
      annealing: primer.slice(best.tail.length),
      strand,
    },
    siteCount: best.siteCount,
  };
}

function resolvePrimerBinding(
  primer: Primer | string,
  template: string,
  strand: 1 | -1,
  circular: boolean,
  minAnneal: number,
  maxMismatches: number,
): { binding: PrimerBinding; siteCount: number } | null {
  if (typeof primer !== 'string') {
    const length = rangeLength(primer.bindingStart, primer.bindingEnd, template.length, circular);
    if (length <= 0) return null;
    return {
      binding: {
        start: mod(primer.bindingStart, template.length),
        // On a linear template an end equal to the length is the 3' terminus, not position 0.
        end: circular ? mod(primer.bindingEnd, template.length) : Math.min(primer.bindingEnd, template.length),
        tail: primer.tailSequence,
        annealing: primer.sequence.slice(primer.tailSequence.length),
        strand: primer.strand,
        primer,
      },
      siteCount: 1,
    };
  }
  return findStringBinding(primer, template, strand, circular, minAnneal, maxMismatches);
}

export function simulatePCR(
  templateDoc: PlasmidDocument,
  forward: Primer | string,
  reverse: Primer | string,
  options?: { minAnneal?: number; maxMismatches?: number },
): { product: PlasmidDocument | null; warnings: string[] } {
  const warnings: string[] = [];
  const circular = templateDoc.topology === 'circular';
  const minAnneal = Math.max(8, options?.minAnneal ?? 15);
  const maxMismatches = Math.max(0, options?.maxMismatches ?? 2);
  const template = templateDoc.sequence;
  const forwardBinding = resolvePrimerBinding(forward, template, 1, circular, minAnneal, maxMismatches);
  const reverseBinding = resolvePrimerBinding(reverse, template, -1, circular, minAnneal, maxMismatches);
  if (!forwardBinding) {
    return { product: null, warnings: ['Forward primer does not bind the template with the requested stringency.'] };
  }
  if (!reverseBinding) {
    return { product: null, warnings: ['Reverse primer does not bind the template with the requested stringency.'] };
  }
  if (forwardBinding.binding.strand === -1 || reverseBinding.binding.strand === 1) {
    warnings.push('Primer strand assignments are reversed relative to the expected forward/reverse orientation.');
  }
  if (forwardBinding.siteCount > 1) warnings.push(`Forward primer has ${forwardBinding.siteCount} potential binding sites.`);
  if (reverseBinding.siteCount > 1) warnings.push(`Reverse primer has ${reverseBinding.siteCount} potential binding sites.`);
  // A primer whose 3' end also anneals to the other strand can pair with itself or its partner.
  for (const [label, primer] of [['Forward', forward], ['Reverse', reverse]] as const) {
    const oligo = normalizeDNA(typeof primer === 'string' ? primer : primer.sequence);
    if (oligo.length < minAnneal) continue;
    const threePrime = oligo.slice(-minAnneal);
    const ownStrand = label === 'Forward' ? threePrime : reverseComplement(threePrime);
    const otherHits = countBindingSites(template, reverseComplement(ownStrand), circular, 0);
    if (otherHits > 0 && ownStrand !== reverseComplement(ownStrand)) {
      warnings.push(`${label} primer 3' end also anneals to the opposite strand (${otherHits} site${otherHits > 1 ? 's' : ''}); extra products are possible.`);
    }
  }
  const forwardStart = forwardBinding.binding.start;
  const forwardEnd = forwardBinding.binding.end;
  const reverseStart = reverseBinding.binding.start;
  const reverseEnd = reverseBinding.binding.end;
  const forwardAnnealLength = rangeLength(forwardStart, forwardEnd, template.length, circular);
  const reverseAnnealLength = rangeLength(reverseStart, reverseEnd, template.length, circular);
  const middleLength = rangeLength(forwardEnd, reverseStart, template.length, circular);
  const ampliconLength = forwardAnnealLength + middleLength + reverseAnnealLength;
  if (ampliconLength <= 0) {
    return { product: null, warnings: [...warnings, 'The primer pair does not define a valid amplicon.'] };
  }
  if (!circular && reverseStart < forwardEnd) {
    warnings.push('The reverse primer binding site is upstream of the forward primer on a linear template.');
  }
  if (ampliconLength < 20) warnings.push(`Amplicon is only ${ampliconLength} bp; primer-dimers may dominate.`);
  if (ampliconLength > 15000) warnings.push('Amplicon exceeds 15 kb; long-range PCR conditions are recommended.');
  const middle = sequenceSlice(template, forwardEnd, forwardEnd + middleLength, circular);
  const forwardAnneal = forwardBinding.binding.annealing;
  const reverseAnneal = reverseBinding.binding.annealing;
  const productSequence =
    forwardBinding.binding.tail +
    forwardAnneal +
    middle +
    reverseComplement(reverseAnneal) +
    reverseComplement(reverseBinding.binding.tail);
  const data = sliceDocumentData(templateDoc, forwardStart, forwardStart + ampliconLength, { circular });
  const forwardTemplateAnneal = sequenceSlice(template, forwardStart, forwardEnd, circular);
  const reverseTemplateAnneal = sequenceSlice(template, reverseStart, reverseEnd, circular);
  const featureOffset =
    forwardBinding.binding.tail.length + forwardAnneal.length - forwardTemplateAnneal.length;
  const features = data.features.map((feature) => shiftFeature(feature, featureOffset));
  const productLength = productSequence.length;
  const forwardMismatches = forwardAnneal.length === forwardTemplateAnneal.length
    ? [...forwardAnneal].reduce((total, base, index) => total + (base === forwardTemplateAnneal[index] ? 0 : 1), 0)
    : Math.abs(forwardAnneal.length - forwardTemplateAnneal.length) + 1;
  const reverseMismatches = reverseAnneal.length === reverseTemplateAnneal.length
    ? [...reverseAnneal].reduce((total, base, index) => total + (base === reverseComplement(reverseTemplateAnneal)[index] ? 0 : 1), 0)
    : Math.abs(reverseAnneal.length - reverseTemplateAnneal.length) + 1;
  if (forwardMismatches) warnings.push(`Forward primer annealing region differs from the template at ${forwardMismatches} position(s); the mismatches are incorporated into the product.`);
  if (reverseMismatches) warnings.push(`Reverse primer annealing region differs from the template at ${reverseMismatches} position(s); the mismatches are incorporated into the product.`);
  const forwardPrimer: Primer =
    forwardBinding.binding.primer
      ? clonePrimer(forwardBinding.binding.primer)
      : {
          id: uid('primer'),
          name: 'PCR_forward',
          sequence: forwardBinding.binding.tail + forwardBinding.binding.annealing,
          bindingStart: forwardStart,
          bindingEnd: forwardEnd,
          strand: 1,
          tailSequence: forwardBinding.binding.tail,
          tmAnnealing: evaluateOligoThermodynamics(forwardBinding.binding.annealing).tm,
          tmTotal: 0,
          gcPercent: 0,
          has3PrimeGCClamp: false,
          hairpinDeltaG: 0,
          selfDimerDeltaG: 0,
        };
  const reversePrimer: Primer =
    reverseBinding.binding.primer
      ? clonePrimer(reverseBinding.binding.primer)
      : {
          id: uid('primer'),
          name: 'PCR_reverse',
          sequence: reverseBinding.binding.tail + reverseBinding.binding.annealing,
          bindingStart: reverseStart,
          bindingEnd: reverseEnd,
          strand: -1,
          tailSequence: reverseBinding.binding.tail,
          tmAnnealing: evaluateOligoThermodynamics(reverseBinding.binding.annealing).tm,
          tmTotal: 0,
          gcPercent: 0,
          has3PrimeGCClamp: false,
          hairpinDeltaG: 0,
          selfDimerDeltaG: 0,
        };
  forwardPrimer.bindingStart = forwardBinding.binding.tail.length;
  forwardPrimer.bindingEnd = forwardBinding.binding.tail.length + forwardAnneal.length;
  reversePrimer.bindingStart = productLength - reverseBinding.binding.tail.length - reverseAnneal.length;
  reversePrimer.bindingEnd = productLength - reverseBinding.binding.tail.length;
  if (!forwardPrimer.tmTotal) {
    const thermo = evaluateOligoThermodynamics(forwardPrimer.sequence);
    forwardPrimer.tmTotal = thermo.tm;
    forwardPrimer.gcPercent = thermo.gcPercent;
    forwardPrimer.has3PrimeGCClamp = thermo.has3PrimeGCClamp;
    forwardPrimer.hairpinDeltaG = thermo.hairpinDeltaG;
    forwardPrimer.selfDimerDeltaG = thermo.selfDimerDeltaG;
  }
  if (!reversePrimer.tmTotal) {
    const thermo = evaluateOligoThermodynamics(reversePrimer.sequence);
    reversePrimer.tmTotal = thermo.tm;
    reversePrimer.gcPercent = thermo.gcPercent;
    reversePrimer.has3PrimeGCClamp = thermo.has3PrimeGCClamp;
    reversePrimer.hairpinDeltaG = thermo.hairpinDeltaG;
    reversePrimer.selfDimerDeltaG = thermo.selfDimerDeltaG;
  }
  const product = makeDocument({
    name: `${templateDoc.name}_PCR_${productLength}bp`,
    sequence: productSequence,
    topology: 'linear',
    features,
    primers: [forwardPrimer, reversePrimer],
    history: templateDoc.history.map(cloneHistoryNode),
    linearEnds: { left: bluntOverhang(), right: bluntOverhang() },
    methylationProfile: templateDoc.methylationProfile,
  });
  appendHistory(
    product,
    makeHistoryNode('pcr', `PCR amplification of ${templateDoc.name} (${productLength} bp).`, {
      primersUsed: [forwardPrimer.name, reversePrimer.name],
      parentSnapshots: [
        {
          ...parentSnapshot(templateDoc),
          extractedRange: [forwardStart, reverseEnd],
        },
      ],
    }),
  );
  return { product, warnings };
}

function fuseByOverlap(
  fragments: PlasmidDocument[],
  warnings: string[],
): PlasmidDocument | null {
  if (fragments.length < 2) return null;
  const first = cloneDocument(fragments[0]);
  first.topology = 'linear';
  let sequence = first.sequence;
  const features = cloneFeatures(first.features);
  const primers = clonePrimers(first.primers);
  const used: Array<{ doc: PlasmidDocument; orientation: 'forward' | 'reverse' }> = [
    { doc: fragments[0], orientation: 'forward' },
  ];
  for (let index = 1; index < fragments.length; index += 1) {
    let chosen: { sequence: string; features: SequenceFeature[]; primers: Primer[]; overlap: OverlapMatch; orientation: 'forward' | 'reverse' } | null = null;
    for (const orientation of ['forward', 'reverse'] as const) {
      const oriented = orientFragment(fragments[index], orientation === 'reverse');
      const overlap = findOverlap(sequence, oriented.sequence, 10, 80);
      if (!overlap) continue;
      const data = sliceDocumentData(
        makeDocument({
          name: fragments[index].name,
          sequence: oriented.sequence,
          topology: 'linear',
          features: oriented.features,
          primers: oriented.primers,
        }),
        0,
        oriented.sequence.length,
        { circular: false },
      );
      chosen = {
        sequence: oriented.sequence.slice(overlap.length),
        features: data.features
          .filter((feature) => feature.end > overlap.length)
          .map((feature) => shiftFeature({ ...feature, start: Math.max(overlap.length, feature.start) }, -overlap.length)),
        primers: data.primers
          .filter((primer) => primer.bindingStart >= overlap.length)
          .map((primer) => shiftPrimer(primer, -overlap.length)),
        overlap,
        orientation,
      };
      break;
    }
    if (!chosen) {
      warnings.push(`No overlap was found between fragment ${index} and fragment ${index + 1}.`);
      return null;
    }
    const offset = sequence.length;
    features.push(...chosen.features.map((feature) => shiftFeature(feature, offset)));
    primers.push(...chosen.primers.map((primer) => shiftPrimer(primer, offset)));
    sequence += chosen.sequence;
    used.push({ doc: fragments[index], orientation: chosen.orientation });
    if (chosen.overlap.mismatches) {
      warnings.push(`SOE junction ${index} contains ${chosen.overlap.mismatches} mismatch(es).`);
    }
  }
  const fused = makeDocument({
    name: `SOE_fused_${fragments.map((fragment) => fragment.name).join('_')}`,
    sequence,
    topology: 'linear',
    features,
    primers,
    history: fragments.flatMap((fragment) => fragment.history.map(cloneHistoryNode)),
    linearEnds: { left: bluntOverhang(), right: bluntOverhang() },
    methylationProfile: fragments[0].methylationProfile,
  });
  appendHistory(
    fused,
    makeHistoryNode('soe_pcr', `Overlap-extension fusion of ${fragments.length} fragment(s).`, {
      parentSnapshots: fragments.map((fragment) => parentSnapshot(fragment)),
    }),
  );
  return fused;
}

export function simulateOverlapExtensionPCR(
  fragments: PlasmidDocument[],
  outerForward: Primer | string,
  outerReverse: Primer | string,
): { product: PlasmidDocument | null; warnings: string[] } {
  const warnings: string[] = [];
  if (fragments.length < 2) {
    return { product: null, warnings: ['Overlap-extension PCR requires at least two fragments.'] };
  }
  const fused = fuseByOverlap(fragments, warnings);
  if (!fused) {
    return { product: null, warnings: [...warnings, 'The fragments could not be fused.'] };
  }
  const forwardString = typeof outerForward === 'string' ? outerForward : outerForward.sequence;
  const reverseString = typeof outerReverse === 'string' ? outerReverse : outerReverse.sequence;
  const pcr = simulatePCR(fused, forwardString, reverseString, { minAnneal: 12, maxMismatches: 2 });
  if (!pcr.product) {
    return { product: null, warnings: [...warnings, ...pcr.warnings] };
  }
  const product = pcr.product;
  appendHistory(
    product,
    makeHistoryNode('soe_pcr', `Overlap-extension PCR with outer primers on ${fragments.length} fragments.`, {
      primersUsed: [forwardString.slice(0, 8), reverseString.slice(0, 8)],
      parentSnapshots: fragments.map((fragment) => parentSnapshot(fragment)),
    }),
  );
  return { product, warnings: [...warnings, ...pcr.warnings] };
}

export function digestAndReligate(
  doc: PlasmidDocument,
  cutSites: CutSite[],
  options?: { circularize?: boolean },
): PlasmidDocument | null {
  const fragments = simulateDigestion(doc, cutSites);
  const ligation = simulateLigation(fragments, options);
  return ligation.product;
}

export function pcrProductLength(
  template: PlasmidDocument,
  forward: Primer | string,
  reverse: Primer | string,
  options?: { minAnneal?: number; maxMismatches?: number },
): number {
  const result = simulatePCR(template, forward, reverse, options);
  return result.product?.length ?? 0;
}

export function gibsonProductLength(fragments: PlasmidDocument[], options?: { minOverlap?: number; maxOverlap?: number; circular?: boolean }): number {
  const result = simulateGibsonAssembly(fragments, options);
  return result.product?.length ?? 0;
}

export function mutationProduct(
  doc: PlasmidDocument,
  mutation: { start: number; end: number; newBases: string },
): PlasmidDocument {
  const mutated = applySequenceMutation(
    doc.sequence,
    mutation.start,
    mutation.end,
    mutation.newBases,
    doc.topology === 'circular',
  );
  const result = cloneDocument(doc);
  result.sequence = mutated.sequence;
  result.length = mutated.sequenceLength;
  result.updatedAt = nowIso();
  return result;
}

export function defaultEnzymeList(): RestrictionEnzyme[] {
  return COMMON_ENZYMES.map((enzyme) => ({ ...enzyme }));
}

export function restrictionEnzymePanel(): RestrictionEnzyme[] {
  return COMMON_ENZYMES.map((enzyme) => ({ ...enzyme }));
}

export function isGoldenGateEnzyme(enzyme: RestrictionEnzyme): boolean {
  return isTypeIIS(enzyme);
}

export function primerPairOptions(options?: PrimerDesignOptions): PrimerDesignOptions {
  return { ...(options ?? {}) };
}

export function designPrimerPairForFeature(
  doc: PlasmidDocument,
  feature: SequenceFeature,
  options?: PrimerDesignOptions,
): ReturnType<typeof designPrimerPair> {
  return designPrimerPair(doc, { start: feature.start, end: feature.end }, options);
}

export function gcOf(sequence: string): number {
  return gcPercentOf(sequence);
}

export * from './assembly';
export * from './recombination';
