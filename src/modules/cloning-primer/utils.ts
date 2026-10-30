// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
export { GENETIC_CODE as CODON_TABLE, SYNONYMOUS_CODONS } from '../../lib/genetic-code';
import { GENETIC_CODE } from '../../lib/genetic-code';

import type {
  CloningHistoryNode,
  CloningOperationType,
  OverhangEnd,
  PlasmidDocument,
  Primer,
  SequenceFeature,
  StrandDirection,
} from '../../types/schema';

export const GAS_CONSTANT = 1.9872; // cal / (mol * K)

const COMPLEMENT: Record<string, string> = {
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  D: 'H',
  H: 'D',
  V: 'B',
  N: 'N',
};

const IUPAC_CLASSES: Record<string, string> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  U: 'T',
  R: '[AG]',
  Y: '[CT]',
  S: '[GC]',
  W: '[AT]',
  K: '[GT]',
  M: '[AC]',
  B: '[CGT]',
  D: '[AGT]',
  H: '[ACT]',
  V: '[ACG]',
  N: '[ACGT]',
};

export const AMINO_ACID_NAMES: Record<string, string> = {
  A: 'Ala',
  R: 'Arg',
  N: 'Asn',
  D: 'Asp',
  C: 'Cys',
  Q: 'Gln',
  E: 'Glu',
  G: 'Gly',
  H: 'His',
  I: 'Ile',
  L: 'Leu',
  K: 'Lys',
  M: 'Met',
  F: 'Phe',
  P: 'Pro',
  S: 'Ser',
  T: 'Thr',
  W: 'Trp',
  Y: 'Tyr',
  V: 'Val',
  '*': 'Stop',
};

let idCounter = 0;

export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function mod(value: number, length: number): number {
  if (length <= 0) return 0;
  return ((value % length) + length) % length;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function normalizeDNA(sequence: string): string {
  return sequence.replace(/\s+/g, '').toUpperCase().replace(/U/g, 'T');
}

export function complementBase(base: string): string {
  return COMPLEMENT[base.toUpperCase()] ?? 'N';
}

export function reverseComplement(sequence: string): string {
  const seq = sequence.toUpperCase();
  let out = '';
  for (let i = seq.length - 1; i >= 0; i -= 1) {
    out += COMPLEMENT[seq[i]] ?? 'N';
  }
  return out;
}

export function reverseSequence(sequence: string): string {
  return sequence.split('').reverse().join('');
}

export function isSelfComplementary(sequence: string): boolean {
  const seq = normalizeDNA(sequence);
  return seq.length > 1 && reverseComplement(seq) === seq;
}

export function gcPercentOf(sequence: string): number {
  const seq = normalizeDNA(sequence);
  if (!seq.length) return 0;
  let gc = 0;
  for (const base of seq) {
    if (base === 'G' || base === 'C') gc += 1;
  }
  return (gc / seq.length) * 100;
}

export function has3PrimeGCClamp(sequence: string): boolean {
  const seq = normalizeDNA(sequence);
  if (!seq.length) return false;
  const last = seq[seq.length - 1];
  return last === 'G' || last === 'C';
}

export function isPalindromic(sequence: string): boolean {
  const seq = normalizeDNA(sequence);
  return seq.length > 1 && reverseComplement(seq) === seq;
}

export function hammingDistance(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i].toUpperCase() !== b[i].toUpperCase()) distance += 1;
  }
  return distance;
}

/**
 * Length of a 0-based, half-open interval. On a circular molecule an
 * interval with end < start crosses the origin. Passing end === start + L
 * denotes a complete turn around the circle.
 */
export function rangeLength(start: number, end: number, length: number, circular: boolean): number {
  if (length <= 0) return 0;
  if (!circular) return Math.max(0, end - start);
  if (end === start) return 0;
  if (end > start) return Math.min(length, end - start);
  return length - mod(start, length) + mod(end, length);
}

export function sequenceSlice(
  sequence: string,
  start: number,
  end: number,
  circular: boolean,
): string {
  const seq = sequence;
  const length = seq.length;
  if (!length) return '';
  if (!circular) {
    const from = clamp(start, 0, length);
    const to = clamp(end, 0, length);
    return to > from ? seq.slice(from, to) : '';
  }
  const from = mod(start, length);
  let count: number;
  if (end === start) {
    count = 0;
  } else if (end > start) {
    count = Math.min(end - start, length);
  } else {
    count = length - from + mod(end, length);
  }
  if (count <= 0) return '';
  let out = '';
  for (let i = 0; i < count; i += 1) {
    out += seq[(from + i) % length];
  }
  return out;
}

export function motifToRegex(motif: string): RegExp {
  const source = motif
    .toUpperCase()
    .split('')
    .map((base) => IUPAC_CLASSES[base] ?? 'N')
    .join('');
  return new RegExp(source, 'g');
}

export function findMotifPositions(sequence: string, motif: string, circular: boolean): number[] {
  const seq = sequence.toUpperCase();
  const probe = motif.toUpperCase();
  if (!seq.length || !probe.length) return [];
  const length = seq.length;
  const searchSpace = circular
    ? seq + seq.slice(0, Math.max(0, probe.length - 1))
    : seq;
  const regex = motifToRegex(probe);
  const positions: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(searchSpace)) !== null) {
    if (match.index < length) positions.push(match.index);
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return Array.from(new Set(positions)).sort((a, b) => a - b);
}

export function findMotifOnlyPositions(
  sequence: string,
  motif: string,
  circular: boolean,
): number[] {
  const seq = sequence.toUpperCase();
  const probe = motif.toUpperCase();
  if (!seq.length || !probe.length) return [];
  if (!/[RYSWKMBDHVN]/.test(probe)) {
    const positions: number[] = [];
    const length = seq.length;
    const search = circular ? seq + seq.slice(0, Math.max(0, probe.length - 1)) : seq;
    let index = search.indexOf(probe);
    while (index !== -1) {
      if (index < length) positions.push(index);
      index = search.indexOf(probe, index + 1);
    }
    return positions;
  }
  return findMotifPositions(seq, probe, circular);
}

export interface StrandedMotifMatch {
  position: number;
  strand: 1 | -1;
  sequence: string;
}

export function findMotifOnBothStrands(
  sequence: string,
  motif: string,
  circular: boolean,
): StrandedMotifMatch[] {
  const seq = sequence.toUpperCase();
  const probe = motif.toUpperCase();
  const matches: StrandedMotifMatch[] = [];
  for (const position of findMotifOnlyPositions(seq, probe, circular)) {
    matches.push({ position, strand: 1, sequence: probe });
  }
  const rcProbe = reverseComplement(probe);
  if (rcProbe !== probe) {
    for (const position of findMotifOnlyPositions(seq, rcProbe, circular)) {
      matches.push({ position, strand: -1, sequence: rcProbe });
    }
  }
  return matches.sort((a, b) => a.position - b.position);
}

export function translateSequence(sequence: string, frame = 0, stopAtStop = false): string {
  const seq = normalizeDNA(sequence);
  let protein = '';
  for (let i = frame; i + 3 <= seq.length; i += 3) {
    const codon = seq.slice(i, i + 3);
    const aa = GENETIC_CODE[codon] ?? 'X';
    if (aa === '*' && stopAtStop) break;
    protein += aa;
  }
  return protein;
}

export function codonStartFor(anchor: number, position: number): number {
  return anchor + Math.floor((position - anchor) / 3) * 3;
}

export function bluntOverhang(): OverhangEnd {
  return { type: 'blunt', sequence: '', phosphorylated: false };
}

export function copyOverhang(end: OverhangEnd | undefined): OverhangEnd {
  if (!end) return bluntOverhang();
  return {
    type: end.type,
    sequence: end.sequence.toUpperCase(),
    phosphorylated: end.phosphorylated,
    sourceEnzyme: end.sourceEnzyme,
  };
}

export function reverseOverhang(end: OverhangEnd | undefined): OverhangEnd {
  const copy = copyOverhang(end);
  return {
    type: copy.type,
    sequence: reverseComplement(copy.sequence),
    phosphorylated: copy.phosphorylated,
    sourceEnzyme: copy.sourceEnzyme,
  };
}

export function cloneFeature(feature: SequenceFeature): SequenceFeature {
  return {
    ...feature,
    notes: feature.notes
      ? Object.fromEntries(Object.entries(feature.notes).map(([key, value]) => [key, [...value]]))
      : undefined,
  };
}

export function clonePrimer(primer: Primer): Primer {
  return {
    ...primer,
    mismatches: primer.mismatches ? [...primer.mismatches] : undefined,
  };
}

export function cloneHistoryNode(node: CloningHistoryNode): CloningHistoryNode {
  return {
    ...node,
    enzymesUsed: node.enzymesUsed ? [...node.enzymesUsed] : undefined,
    primersUsed: node.primersUsed ? [...node.primersUsed] : undefined,
    parentSnapshots: node.parentSnapshots
      ? node.parentSnapshots.map((snapshot) => ({
          ...snapshot,
          extractedRange: snapshot.extractedRange
            ? ([snapshot.extractedRange[0], snapshot.extractedRange[1]] as [number, number])
            : undefined,
        }))
      : undefined,
  };
}

export function cloneDocument(doc: PlasmidDocument): PlasmidDocument {
  return {
    ...doc,
    sequence: doc.sequence,
    features: doc.features.map(cloneFeature),
    primers: doc.primers.map(clonePrimer),
    history: doc.history.map(cloneHistoryNode),
    linearEnds: doc.linearEnds
      ? { left: copyOverhang(doc.linearEnds.left), right: copyOverhang(doc.linearEnds.right) }
      : undefined,
    methylationProfile: doc.methylationProfile ? { ...doc.methylationProfile } : undefined,
  };
}

export interface MakeDocumentInput {
  id?: string;
  name: string;
  sequence: string;
  topology: 'circular' | 'linear';
  features?: SequenceFeature[];
  primers?: Primer[];
  history?: CloningHistoryNode[];
  linearEnds?: { left: OverhangEnd; right: OverhangEnd };
  description?: string;
  methylationProfile?: { dam: boolean; dcm: boolean; cpg: boolean };
}

export function makeDocument(input: MakeDocumentInput): PlasmidDocument {
  const sequence = normalizeDNA(input.sequence);
  const now = nowIso();
  return {
    id: input.id ?? uid('doc'),
    name: input.name,
    sequence,
    topology: input.topology,
    length: sequence.length,
    createdAt: now,
    updatedAt: now,
    description: input.description,
    methylationProfile: input.methylationProfile ? { ...input.methylationProfile } : undefined,
    linearEnds: input.linearEnds
      ? { left: copyOverhang(input.linearEnds.left), right: copyOverhang(input.linearEnds.right) }
      : undefined,
    features: input.features ? input.features.map(cloneFeature) : [],
    primers: input.primers ? input.primers.map(clonePrimer) : [],
    history: input.history ? input.history.map(cloneHistoryNode) : [],
  };
}

export function makeHistoryNode(
  operation: CloningOperationType,
  description: string,
  extra?: {
    enzymesUsed?: string[];
    primersUsed?: string[];
    parentSnapshots?: CloningHistoryNode['parentSnapshots'];
  },
): CloningHistoryNode {
  return {
    id: uid('history'),
    operation,
    timestamp: nowIso(),
    description,
    enzymesUsed: extra?.enzymesUsed ? [...extra.enzymesUsed] : undefined,
    primersUsed: extra?.primersUsed ? [...extra.primersUsed] : undefined,
    parentSnapshots: extra?.parentSnapshots
      ? extra.parentSnapshots.map((snapshot) => ({
          ...snapshot,
          extractedRange: snapshot.extractedRange
            ? ([snapshot.extractedRange[0], snapshot.extractedRange[1]] as [number, number])
            : undefined,
        }))
      : undefined,
  };
}

export interface DocumentSnapshot {
  id: string;
  name: string;
  length: number;
  extractedRange?: [number, number];
}

export function documentSnapshot(
  doc: PlasmidDocument,
  extractedRange?: [number, number],
): DocumentSnapshot {
  return {
    id: doc.id,
    name: doc.name,
    length: doc.length,
    extractedRange,
  };
}

export function appendHistory(doc: PlasmidDocument, node: CloningHistoryNode): PlasmidDocument {
  doc.history.push(node);
  doc.updatedAt = nowIso();
  return doc;
}

export interface SlicedDocumentData {
  sequence: string;
  features: SequenceFeature[];
  primers: Primer[];
  length: number;
}

interface FeaturePart {
  start: number;
  end: number;
}

function mapFeatureToSlice(
  feature: SequenceFeature,
  sliceStart: number,
  sliceLength: number,
  sequenceLength: number,
  circular: boolean,
): FeaturePart[] {
  const featureLength = circular
    ? rangeLength(feature.start, feature.end, sequenceLength, true)
    : Math.max(0, feature.end - feature.start);
  if (featureLength <= 0 || sliceLength <= 0) return [];
  if (!circular) {
    const relativeStart = feature.start - sliceStart;
    const from = Math.max(0, relativeStart);
    const to = Math.min(sliceLength, relativeStart + featureLength);
    return to > from ? [{ start: from, end: to }] : [];
  }
  const relativeStart = mod(feature.start - sliceStart, sequenceLength);
  const relativeEnd = relativeStart + featureLength;
  const parts: FeaturePart[] = [];
  if (relativeStart < sliceLength) {
    const to = Math.min(relativeEnd, sliceLength);
    if (to > relativeStart) parts.push({ start: relativeStart, end: to });
  }
  if (relativeEnd > sequenceLength) {
    const to = Math.min(relativeEnd - sequenceLength, sliceLength);
    if (to > 0) parts.push({ start: 0, end: to });
  }
  return parts;
}

function flipFeature(feature: SequenceFeature, fragmentLength: number): SequenceFeature {
  const flipped: SequenceFeature = {
    ...cloneFeature(feature),
    start: fragmentLength - feature.end,
    end: fragmentLength - feature.start,
    strand: (feature.strand === 1 ? -1 : feature.strand === -1 ? 1 : 0) as StrandDirection,
  };
  return flipped;
}

function flipPrimer(primer: Primer, fragmentLength: number): Primer {
  return {
    ...clonePrimer(primer),
    sequence: reverseComplement(primer.sequence),
    tailSequence: reverseComplement(primer.tailSequence),
    bindingStart: fragmentLength - primer.bindingEnd,
    bindingEnd: fragmentLength - primer.bindingStart,
    strand: (primer.strand === 1 ? -1 : 1) as 1 | -1,
    mismatches: primer.mismatches
      ? primer.mismatches.map((position) => fragmentLength - 1 - position)
      : undefined,
  };
}

/**
 * Extracts a half-open interval from a document and remaps all annotations.
 * The returned coordinates are relative to the extracted fragment.
 */
export function sliceDocumentData(
  doc: PlasmidDocument,
  start: number,
  end: number,
  options?: { reverse?: boolean; circular?: boolean },
): SlicedDocumentData {
  const circular = options?.circular ?? doc.topology === 'circular';
  const reverse = options?.reverse ?? false;
  const length = rangeLength(start, end, doc.length, circular);
  const sequence = sequenceSlice(doc.sequence, start, end, circular);
  const fragmentLength = sequence.length;
  if (fragmentLength <= 0) {
    return { sequence: '', features: [], primers: [], length: 0 };
  }
  const features: SequenceFeature[] = [];
  for (const feature of doc.features) {
    const parts = mapFeatureToSlice(feature, start, fragmentLength, doc.length, circular);
    if (!parts.length) continue;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const mapped: SequenceFeature = {
        ...cloneFeature(feature),
        start: part.start,
        end: part.end,
      };
      if (parts.length > 1) {
        mapped.name = `${feature.name}_part${index + 1}`;
        mapped.notes = {
          ...(mapped.notes ?? {}),
          fragment: ['Feature split across the extraction boundary'],
        };
      }
      features.push(reverse ? flipFeature(mapped, fragmentLength) : mapped);
    }
  }
  const primers: Primer[] = [];
  for (const primer of doc.primers) {
    const primerLength = circular
      ? rangeLength(primer.bindingStart, primer.bindingEnd, doc.length, true)
      : Math.max(0, primer.bindingEnd - primer.bindingStart);
    if (primerLength <= 0) continue;
    const parts = mapFeatureToSlice(
      {
        id: primer.id,
        name: primer.name,
        type: 'primer_bind',
        start: primer.bindingStart,
        end: primer.bindingEnd,
        strand: primer.strand,
        color: '#888888',
      },
      start,
      fragmentLength,
      doc.length,
      circular,
    );
    if (parts.length !== 1) continue;
    if (parts[0].end - parts[0].start !== primerLength) continue;
    const mapped: Primer = {
      ...clonePrimer(primer),
      bindingStart: parts[0].start,
      bindingEnd: parts[0].end,
    };
    primers.push(reverse ? flipPrimer(mapped, fragmentLength) : mapped);
  }
  return {
    sequence,
    features,
    primers,
    length: fragmentLength,
  };
}

export function shiftFeature(feature: SequenceFeature, offset: number): SequenceFeature {
  return {
    ...cloneFeature(feature),
    start: feature.start + offset,
    end: feature.end + offset,
  };
}

export function shiftPrimer(primer: Primer, offset: number): Primer {
  return {
    ...clonePrimer(primer),
    bindingStart: primer.bindingStart + offset,
    bindingEnd: primer.bindingEnd + offset,
    mismatches: primer.mismatches ? primer.mismatches.map((position) => position + offset) : undefined,
  };
}

export function clipFeatureToLength(feature: SequenceFeature, length: number): SequenceFeature | null {
  if (feature.start >= length) return null;
  if (feature.end <= 0) return null;
  const start = Math.max(0, feature.start);
  const end = Math.min(length, feature.end);
  if (end <= start) return null;
  return { ...cloneFeature(feature), start, end };
}

export interface MutationAdjustment {
  sequence: string;
  delta: number;
  sequenceLength: number;
}

export function applySequenceMutation(
  sequence: string,
  start: number,
  end: number,
  newBases: string,
  circular: boolean,
): MutationAdjustment {
  const seq = normalizeDNA(sequence);
  const length = seq.length;
  const insert = normalizeDNA(newBases);
  if (!circular) {
    const from = clamp(start, 0, length);
    const to = clamp(end, from, length);
    const next = seq.slice(0, from) + insert + seq.slice(to);
    return { sequence: next, delta: next.length - length, sequenceLength: next.length };
  }
  if (start <= end) {
    const from = mod(start, length);
    const to = mod(end, length);
    const next = seq.slice(0, from) + insert + seq.slice(to);
    return { sequence: next, delta: next.length - length, sequenceLength: next.length };
  }
  // The replaced interval crosses the origin. Represent the product starting
  // at the first base after the deleted interval, which keeps the remaining
  // arc contiguous and places the replacement at the end of the molecule.
  const next = seq.slice(end, start) + insert;
  return { sequence: next, delta: next.length - length, sequenceLength: next.length };
}

export function adjustFeaturesForMutation(
  features: SequenceFeature[],
  start: number,
  end: number,
  delta: number,
  sequenceLength: number,
  circular: boolean,
): SequenceFeature[] {
  const result: SequenceFeature[] = [];
  const wrapped = circular && start > end;
  const removed = wrapped
    ? rangeLength(start, end, sequenceLength, true)
    : Math.max(0, end - start);
  const newLength = sequenceLength + delta;
  for (const feature of features) {
    const copy = cloneFeature(feature);
    if (!wrapped) {
      if (copy.end <= start) {
        result.push(copy);
      } else if (copy.start >= end) {
        copy.start += delta;
        copy.end += delta;
        result.push(copy);
      } else {
        if (copy.start < start) {
          copy.end = Math.max(start, copy.end + delta);
          if (copy.end > copy.start) result.push(copy);
        } else if (copy.end > end) {
          copy.start = start;
          copy.end = copy.end + delta;
          if (copy.end > copy.start) result.push(copy);
        }
      }
      continue;
    }
    // Wrapped replacement: the new molecule starts at the old end coordinate.
    const remaining = sequenceLength - removed;
    const featureLength = rangeLength(copy.start, copy.end, sequenceLength, true);
    if (featureLength <= 0) continue;
    const relativeStart = mod(copy.start - end, sequenceLength);
    const relativeEnd = relativeStart + featureLength;
    if (relativeStart >= remaining) continue;
    const clippedEnd = Math.min(relativeEnd, remaining);
    if (clippedEnd <= relativeStart) continue;
    result.push({
      ...copy,
      start: mod(relativeStart, Math.max(1, newLength)),
      end: mod(clippedEnd, Math.max(1, newLength)),
    });
  }
  return result;
}

export function findFirstDifference(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : length;
}

export function formatKcal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}
