// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  CloningHistoryNode,
  PlasmidDocument,
  Primer,
  SequenceFeature,
} from '../../types/schema';
import {
  appendHistory,
  cloneDocument,
  cloneFeature,
  cloneHistoryNode,
  clonePrimer,
  makeDocument,
  makeHistoryNode,
  mod,
  normalizeDNA,
  reverseComplement,
  sequenceSlice,
  shiftFeature,
  shiftPrimer,
  sliceDocumentData,
  uid,
} from './utils';

export type RecombinationSite =
  | 'loxP'
  | 'lox2272'
  | 'lox511'
  | 'loxN'
  | 'lox66'
  | 'lox71'
  | 'FRT'
  | 'F3';

export const RECOMBINATION_SITES: Record<RecombinationSite, string> = {
  loxP: 'ATAACTTCGTATAATGTATGCTATACGAAGTTAT',
  lox2272: 'ATAACTTCGTATAAAGTATCCTATACGAAGTTAT',
  lox511: 'ATAACTTCGTATAATGTATACTATACGAAGTTAT',
  loxN: 'ATAACTTCGTATAGTATACCTTATACGAAGTTAT',
  lox66: 'ATAACTTCGTATAATGTATGCTATACGAACGGTA',
  lox71: 'TACCGTTCGTATAATGTATGCTATACGAAGTTAT',
  FRT: 'GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC',
  F3: 'GAAGTTCCTATTCTATTTGAAGTATAGGAACTTC',
};

const LOX_SITES: RecombinationSite[] = [
  'loxP',
  'lox2272',
  'lox511',
  'loxN',
  'lox66',
  'lox71',
];

const FLP_SITES: RecombinationSite[] = ['FRT', 'F3'];

const EXTENDED_SITE_MOTIFS: Partial<Record<RecombinationSite, string[]>> = {
  FRT: ['GAAGTTCCTATTCCGAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC'],
  F3: ['GAAGTTCCTATTCCGAAGTTCCTATTCTATTTGAAGTATAGGAACTTC'],
};

interface LocatedSite {
  site: RecombinationSite;
  start: number;
  end: number;
  strand: 1 | -1;
}

function findRecombinationSitesRaw(doc: PlasmidDocument): LocatedSite[] {
  const matches: LocatedSite[] = [];
  const circular = doc.topology === 'circular';
  for (const site of Object.keys(RECOMBINATION_SITES) as RecombinationSite[]) {
    const motifs = [...(EXTENDED_SITE_MOTIFS[site] ?? []), RECOMBINATION_SITES[site]];
    for (const motif of motifs) {
      for (const match of findMotifOnBothStrands(doc.sequence, motif, circular)) {
        matches.push({
          site,
          start: match.position,
          end: match.position + motif.length,
          strand: match.strand,
        });
      }
    }
  }
  const output: LocatedSite[] = [];
  for (const candidate of matches.slice().sort((a, b) => b.end - b.start - (a.end - a.start))) {
    const covered = output.some(
      (existing) =>
        existing.site === candidate.site &&
        existing.start <= candidate.start &&
        existing.end >= candidate.end,
    );
    if (!covered) output.push(candidate);
  }
  return output.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function findRecombinationSites(doc: PlasmidDocument): LocatedSite[] {
  const length = doc.length;
  return findRecombinationSitesRaw(doc).map((site) => {
    if (doc.topology === 'circular' && length > 0 && site.end > length) {
      return { ...site, end: mod(site.end, length) };
    }
    return site;
  });
}

function findMotifOnBothStrands(
  sequence: string,
  motif: string,
  circular: boolean,
): Array<{ position: number; strand: 1 | -1 }> {
  const normalized = normalizeDNA(sequence);
  const probe = normalizeDNA(motif);
  const length = normalized.length;
  const results: Array<{ position: number; strand: 1 | -1 }> = [];
  const searchSpace = circular
    ? normalized + normalized.slice(0, Math.max(0, probe.length - 1))
    : normalized;
  const addMatches = (needle: string, strand: 1 | -1): void => {
    let index = searchSpace.indexOf(needle);
    while (index !== -1) {
      if (index < length) results.push({ position: index, strand });
      index = searchSpace.indexOf(needle, index + 1);
    }
  };
  addMatches(probe, 1);
  const reverse = reverseComplement(probe);
  if (reverse !== probe) addMatches(reverse, -1);
  return results;
}

function recombinaseSiteKey(
  site: RecombinationSite,
  recombinase: 'Cre' | 'Flp',
): string | null {
  if (recombinase === 'Cre') {
    if (!LOX_SITES.includes(site)) return null;
    if (site === 'lox66' || site === 'lox71') return 'lox66/71';
    return site;
  }
  if (!FLP_SITES.includes(site)) return null;
  return site;
}

function parentSnapshot(
  doc: PlasmidDocument,
): NonNullable<CloningHistoryNode['parentSnapshots']>[number] {
  return { id: doc.id, name: doc.name, length: doc.length };
}

function clonePrimers(primers: Primer[]): Primer[] {
  return primers.map(clonePrimer);
}

interface SegmentData {
  sequence: string;
  features: SequenceFeature[];
  primers: Primer[];
}

function segmentFrom(
  doc: PlasmidDocument,
  start: number,
  end: number,
  circular: boolean,
  reverse = false,
): SegmentData {
  const data = sliceDocumentData(doc, start, end, { circular, reverse });
  return {
    sequence: reverse ? reverseComplement(data.sequence) : data.sequence,
    features: data.features,
    primers: data.primers,
  };
}

function concatenateSegments(segments: SegmentData[]): SegmentData {
  const output: SegmentData = { sequence: '', features: [], primers: [] };
  for (const segment of segments) {
    const offset = output.sequence.length;
    output.sequence += segment.sequence;
    output.features.push(...segment.features.map((feature) => shiftFeature(feature, offset)));
    output.primers.push(...segment.primers.map((primer) => shiftPrimer(primer, offset)));
  }
  return output;
}

function siteFeature(
  name: string,
  start: number,
  end: number,
  strand: 1 | -1 = 1,
): SequenceFeature {
  return {
    id: uid('feature'),
    name,
    type: 'attachment_site',
    start,
    end,
    strand,
    color: '#eab308',
    notes: { recombination: [`${name} recombination site`] },
  };
}

function overlappingSiteFeature(
  features: SequenceFeature[],
  start: number,
  end: number,
): SequenceFeature | undefined {
  return features.find(
    (feature) =>
      feature.type === 'attachment_site' &&
      feature.start < end &&
      feature.end > start,
  );
}

function addSiteFeature(
  features: SequenceFeature[],
  name: string,
  start: number,
  end: number,
  strand: 1 | -1 = 1,
): void {
  if (start < 0 || end <= start) return;
  if (overlappingSiteFeature(features, start, end)) return;
  features.push(siteFeature(name, start, end, strand));
}

function setSiteFeature(
  features: SequenceFeature[],
  name: string,
  start: number,
  end: number,
  strand: 1 | -1 = 1,
): void {
  const existing = overlappingSiteFeature(features, start, end);
  if (existing) {
    existing.name = name;
    existing.start = start;
    existing.end = end;
    existing.strand = strand;
    existing.notes = { ...(existing.notes ?? {}), recombination: [`${name} recombination product`] };
    return;
  }
  features.push(siteFeature(name, start, end, strand));
}

function linearEndsOf(doc: PlasmidDocument): PlasmidDocument['linearEnds'] {
  if (!doc.linearEnds) return undefined;
  return { left: doc.linearEnds.left, right: doc.linearEnds.right };
}

function buildProduct(
  name: string,
  data: SegmentData,
  topology: 'circular' | 'linear',
  sources: PlasmidDocument[],
  description: string,
  linearEnds?: PlasmidDocument['linearEnds'],
): PlasmidDocument {
  const product = makeDocument({
    name,
    sequence: data.sequence,
    topology,
    features: data.features.map(cloneFeature),
    primers: clonePrimers(data.primers),
    history: sources.flatMap((source) => source.history.map(cloneHistoryNode)),
    linearEnds,
    methylationProfile: sources[0]?.methylationProfile,
    description: sources[0]?.description,
  });
  appendHistory(
    product,
    makeHistoryNode('manual_edit', description, {
      parentSnapshots: sources.map(parentSnapshot),
    }),
  );
  return product;
}

function rotateCircularSites(
  doc: PlasmidDocument,
  sites: LocatedSite[],
): { doc: PlasmidDocument; sites: LocatedSite[] } {
  if (doc.topology !== 'circular' || !sites.length) return { doc, sites };
  const length = doc.length;
  const crossing = sites.find((site) => site.end > length);
  if (!crossing) return { doc, sites };
  const offset = crossing.start;
  const data = sliceDocumentData(doc, offset, offset + length, { circular: true });
  const rotated = makeDocument({
    id: doc.id,
    name: doc.name,
    sequence: data.sequence,
    topology: 'circular',
    features: data.features,
    primers: data.primers,
    history: doc.history.map(cloneHistoryNode),
    methylationProfile: doc.methylationProfile,
    description: doc.description,
  });
  const shifted = sites.map((site) => {
    const start = mod(site.start - offset, length);
    return { ...site, start, end: start + (site.end - site.start) };
  });
  return { doc: rotated, sites: shifted };
}

function findIntramolecularPair(
  sites: LocatedSite[],
  recombinase: 'Cre' | 'Flp',
): [LocatedSite, LocatedSite] | null {
  const ordered = sites.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  for (let first = 0; first < ordered.length; first += 1) {
    const firstKey = recombinaseSiteKey(ordered[first].site, recombinase);
    if (!firstKey) continue;
    for (let second = first + 1; second < ordered.length; second += 1) {
      const secondKey = recombinaseSiteKey(ordered[second].site, recombinase);
      if (secondKey !== firstKey) continue;
      if (ordered[first].end > ordered[second].start) continue;
      return [ordered[first], ordered[second]];
    }
  }
  return null;
}

function junctionSite(site1: RecombinationSite, site2: RecombinationSite): string {
  if (
    (site1 === 'lox66' && site2 === 'lox71') ||
    (site1 === 'lox71' && site2 === 'lox66')
  ) {
    return 'loxP';
  }
  return site1;
}

function excisionProducts(
  doc: PlasmidDocument,
  site1: LocatedSite,
  site2: LocatedSite,
  recombinase: 'Cre' | 'Flp',
  events: string[],
): PlasmidDocument[] {
  const circular = doc.topology === 'circular';
  const length = doc.length;
  const interiorLength = site2.start - site1.end;
  const junctionName = junctionSite(site1.site, site2.site);
  const hybridJunction = junctionName !== site1.site;
  const canonicalJunction =
    RECOMBINATION_SITES[junctionName as RecombinationSite] ?? RECOMBINATION_SITES[site1.site];
  const junctionSequence = hybridJunction
    ? site1.strand === -1
      ? reverseComplement(canonicalJunction)
      : canonicalJunction
    : sequenceSlice(doc.sequence, site1.start, site1.end, circular);
  const circle = segmentFrom(doc, site1.end, site2.start, circular);
  const circleSiteStart = circle.sequence.length;
  circle.sequence += junctionSequence;
  addSiteFeature(
    circle.features,
    junctionName,
    circleSiteStart,
    circle.sequence.length,
    site1.strand,
  );
  const circleProduct = buildProduct(
    `${doc.name}_excised_circle`,
    circle,
    'circular',
    [doc],
    `${recombinase}-mediated excision between ${site1.site} and ${site2.site} sites; circular excision product.`,
  );
  const backbone = concatenateSegments([
    segmentFrom(doc, 0, site1.end, circular),
    segmentFrom(doc, site2.start, length, circular),
  ]);
  addSiteFeature(backbone.features, site1.site, site1.start, site1.end, site1.strand);
  addSiteFeature(
    backbone.features,
    site2.site,
    site1.end,
    site1.end + (site2.end - site2.start),
    site2.strand,
  );
  const backboneProduct = buildProduct(
    `${doc.name}_excised_backbone`,
    backbone,
    circular ? 'circular' : 'linear',
    [doc],
    `${recombinase}-mediated excision between ${site1.site} and ${site2.site} sites; remaining molecule.`,
    circular ? undefined : linearEndsOf(doc),
  );
  events.push(
    `${recombinase}-mediated excision between ${site1.site} and ${site2.site} sites: ${interiorLength} bp moved into a circular product; a ${junctionName} site was generated.`,
  );
  return [circleProduct, backboneProduct];
}

function inversionProduct(
  doc: PlasmidDocument,
  site1: LocatedSite,
  site2: LocatedSite,
  recombinase: 'Cre' | 'Flp',
  events: string[],
): PlasmidDocument {
  const circular = doc.topology === 'circular';
  const length = doc.length;
  const invertedLength = site2.start - site1.end;
  const data = concatenateSegments([
    segmentFrom(doc, 0, site1.end, circular),
    segmentFrom(doc, site1.end, site2.start, circular, true),
    segmentFrom(doc, site2.start, length, circular),
  ]);
  addSiteFeature(data.features, site1.site, site1.start, site1.end, site1.strand);
  addSiteFeature(data.features, site2.site, site2.start, site2.end, site2.strand);
  const product = buildProduct(
    `${doc.name}_inverted`,
    data,
    doc.topology,
    [doc],
    `${recombinase}-mediated inversion between ${site1.site} and ${site2.site} sites.`,
    circular ? undefined : linearEndsOf(doc),
  );
  events.push(
    `${recombinase}-mediated inversion between ${site1.site} and ${site2.site} sites: ${invertedLength} bp inverted.`,
  );
  return product;
}

function replaceInterval(
  sequence: string,
  start: number,
  end: number,
  replacement: string,
  circular: boolean,
): string {
  const length = sequence.length;
  if (!circular) {
    return sequence.slice(0, start) + replacement + sequence.slice(end);
  }
  const from = mod(start, length);
  const to = mod(end, length);
  if (from < to) {
    return sequence.slice(0, from) + replacement + sequence.slice(to);
  }
  return sequence.slice(to, from) + replacement;
}

function loxArmType(doc: PlasmidDocument, site: LocatedSite): 'left' | 'right' | 'wild' {
  const sequence = normalizeDNA(
    sequenceSlice(
      doc.sequence,
      site.start,
      site.end,
      doc.topology === 'circular',
    ),
  );
  if (sequence.startsWith('TACCGTTCGTATA')) return 'left';
  if (sequence.endsWith('TATACGAACGGTA')) return 'right';
  return 'wild';
}

/** Rotates a circular segment so that `offset` becomes its origin. */
function rotateSegment(data: SegmentData, offset: number): SegmentData {
  const length = data.sequence.length;
  if (length === 0) return data;
  const shift = mod(offset, length);
  if (shift === 0) return data;
  const temp = makeDocument({
    name: 'rotation',
    sequence: data.sequence,
    topology: 'circular',
    features: data.features,
    primers: data.primers,
  });
  return segmentFrom(temp, shift, shift + length, true);
}

/** Crossover point inside a recombination site: the start of its 8 bp spacer. */
const SITE_SPACER_OFFSET = 13;

/**
 * Opens a circular molecule at the crossover point of `site` so the site's spacer starts the
 * sequence, reverse-complementing it when the site sits on the bottom strand.
 */
function openAtSite(
  doc: PlasmidDocument,
  site: LocatedSite,
): { data: SegmentData; site: LocatedSite } {
  const circular = doc.topology === 'circular';
  const length = doc.sequence.length;
  if (!circular || length === 0) {
    return { data: segmentFrom(doc, 0, length, false), site };
  }
  const reverse = site.strand === -1;
  const cut = reverse
    ? mod(site.end - SITE_SPACER_OFFSET, length)
    : mod(site.start + SITE_SPACER_OFFSET, length);
  const data = reverse
    ? segmentFrom(doc, cut - length, cut, true, true)
    : segmentFrom(doc, cut, cut + length, true);
  const siteLength = site.end - site.start;
  // After opening, the spacer is at the origin, so the site wraps the seam.
  return {
    data,
    site: {
      ...site,
      strand: 1,
      start: mod(length - SITE_SPACER_OFFSET, length),
      end: mod(length - SITE_SPACER_OFFSET, length) + siteLength,
    },
  };
}

function integrationProduct(
  doc1: PlasmidDocument,
  site1Input: LocatedSite,
  doc2: PlasmidDocument,
  site2Input: LocatedSite,
  recombinase: 'Cre' | 'Flp',
  events: string[],
): PlasmidDocument {
  let site1 = site1Input;
  let site2 = site2Input;
  const arm1 = loxArmType(doc1, site1);
  const arm2 = loxArmType(doc2, site2);
  const mutantLabelPair =
    (site1.site === 'lox66' && site2.site === 'lox71') ||
    (site1.site === 'lox71' && site2.site === 'lox66');
  const specialPair =
    recombinase === 'Cre' &&
    (mutantLabelPair ||
      (arm1 === 'left' && arm2 === 'right') ||
      (arm1 === 'right' && arm2 === 'left'));
  const topology: 'circular' | 'linear' =
    doc1.topology === 'circular' && doc2.topology === 'circular' ? 'circular' : 'linear';
  // Strand exchange happens inside the site's spacer, so each molecule is opened there (and
  // flipped when its site faces the other way) before the two are joined. Joining them at their
  // stored origins instead would put the junction in the wrong place. Each junction then carries
  // one arm from either parent, which is what makes lox66 x lox71 yield loxP and lox72.
  const prepared1 = openAtSite(doc1, site1);
  const prepared2 = openAtSite(doc2, site2);
  const joined = concatenateSegments([prepared1.data, prepared2.data]);
  const firstLength = prepared1.data.sequence.length;
  const siteLength = site1.end - site1.start;
  // Opened at the spacer, the second recombinant site straddles the seam; rotating the product
  // by the upstream arm brings it back into one piece.
  const rotated =
    topology === 'circular' ? rotateSegment(joined, joined.sequence.length - SITE_SPACER_OFFSET) : joined;
  const sequence = rotated.sequence;
  const features = rotated.features;
  const primers = rotated.primers;
  const firstSiteStart = topology === 'circular' ? firstLength : firstLength - SITE_SPACER_OFFSET;
  const secondSiteStart = topology === 'circular' ? 0 : sequence.length - SITE_SPACER_OFFSET;
  if (specialPair) {
    setSiteFeature(features, 'loxP', firstSiteStart, firstSiteStart + siteLength, 1);
    setSiteFeature(features, 'lox72', secondSiteStart, secondSiteStart + siteLength, 1);
  } else {
    addSiteFeature(features, site1.site, firstSiteStart, firstSiteStart + siteLength, 1);
    addSiteFeature(features, site2.site, secondSiteStart, secondSiteStart + siteLength, 1);
  }
  const product = buildProduct(
    `${doc1.name}_${doc2.name}_cointegrate`,
    { sequence, features, primers },
    topology,
    [doc1, doc2],
    specialPair
      ? `${recombinase}-mediated integration between lox66 and lox71 sites; loxP and lox72 sites were generated.`
      : `${recombinase}-mediated integration between ${site1.site} and ${site2.site} sites.`,
    topology === 'linear'
      ? {
          left: doc1.linearEnds?.left ?? { type: 'blunt', sequence: '', phosphorylated: false },
          right: doc2.linearEnds?.right ?? { type: 'blunt', sequence: '', phosphorylated: false },
        }
      : undefined,
  );
  if (specialPair) {
    events.push(
      `${recombinase}-mediated integration between lox66 and lox71: loxP and double-mutant lox72 sites were generated.`,
    );
  } else {
    events.push(
      `${recombinase}-mediated integration between ${site1.site} and ${site2.site} sites.`,
    );
  }
  return product;
}

export function simulateRecombinase(
  docs: PlasmidDocument[],
  recombinase: 'Cre' | 'Flp',
): { products: PlasmidDocument[]; events: string[]; warnings: string[] } {
  const products: PlasmidDocument[] = [];
  const events: string[] = [];
  const warnings: string[] = [];
  if (!docs.length) {
    return { products, events, warnings: ['No DNA molecules were supplied.'] };
  }
  const candidates: Array<{ doc: PlasmidDocument; site: LocatedSite }> = [];
  for (const source of docs) {
    const relevant = findRecombinationSitesRaw(source).filter((site) =>
      recombinaseSiteKey(site.site, recombinase),
    );
    const rotated = rotateCircularSites(source, relevant);
    const pair = findIntramolecularPair(rotated.sites, recombinase);
    if (pair) {
      if (pair[0].strand === pair[1].strand) {
        products.push(...excisionProducts(rotated.doc, pair[0], pair[1], recombinase, events));
      } else {
        products.push(inversionProduct(rotated.doc, pair[0], pair[1], recombinase, events));
      }
      continue;
    }
    if (rotated.sites.length) {
      candidates.push({ doc: rotated.doc, site: rotated.sites[0] });
    } else {
      products.push(cloneDocument(source));
    }
  }
  const paired = new Set<number>();
  for (let first = 0; first < candidates.length; first += 1) {
    if (paired.has(first)) continue;
    const firstKey = recombinaseSiteKey(candidates[first].site.site, recombinase);
    if (!firstKey) continue;
    for (let second = first + 1; second < candidates.length; second += 1) {
      if (paired.has(second)) continue;
      const secondKey = recombinaseSiteKey(candidates[second].site.site, recombinase);
      if (secondKey !== firstKey) continue;
      products.push(
        integrationProduct(
          candidates[first].doc,
          candidates[first].site,
          candidates[second].doc,
          candidates[second].site,
          recombinase,
          events,
        ),
      );
      paired.add(first);
      paired.add(second);
      break;
    }
  }
  for (let index = 0; index < candidates.length; index += 1) {
    if (!paired.has(index)) products.push(cloneDocument(candidates[index].doc));
  }
  return { products, events, warnings };
}
