// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import type { Primer, SequenceFeature, CutSite } from '../../../types/schema';
import type { RangeSegment } from '../utils';
import { featureSegments, mod, splitRange } from '../utils';
import {
  buildFeatureSegmentPlan,
  parseSegmentsNote,
  segmentGapRanges,
} from '../segments';

import { translateCodon } from '../../../lib/genetic-code';

export { GENETIC_CODE as CODON_TABLE, translateCodon } from '../../../lib/genetic-code';

export const AMINO_ACID_NAME: Record<string, string> = {
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

const COMPLEMENT: Record<string, string> = {
  A: 'T',
  T: 'A',
  G: 'C',
  C: 'G',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
  N: 'N',
};

export function complementBase(base: string): string {
  return COMPLEMENT[base.toUpperCase()] ?? 'N';
}

export function complementSequence(sequence: string): string {
  let out = '';
  for (let i = 0; i < sequence.length; i += 1) {
    out += complementBase(sequence[i]);
  }
  return out;
}

export function reverseComplement(sequence: string): string {
  let out = '';
  for (let i = sequence.length - 1; i >= 0; i -= 1) {
    out += complementBase(sequence[i]);
  }
  return out;
}

export function extractRange(
  sequence: string,
  start: number,
  end: number,
  length: number,
  circular: boolean,
): string {
  if (length <= 0 || sequence.length === 0) return '';
  if (!circular) {
    const s = Math.max(0, Math.min(length, Math.min(start, end)));
    const e = Math.max(0, Math.min(length, Math.max(start, end)));
    return sequence.slice(s, e);
  }
  const s = mod(start, length);
  const e = mod(end, length);
  if (s === e) return start === end ? '' : sequence;
  if (s < e) return sequence.slice(s, e);
  return sequence.slice(s) + sequence.slice(0, e);
}

export interface CodonInfo {
  pos: number;
  aa: string;
  index: number;
  codon: string;
}

export function buildCdsCodons(
  sequence: string,
  feature: SequenceFeature,
  length: number,
  circular: boolean,
): CodonInfo[] {
  const declared = parseSegmentsNote(feature.notes);
  if (declared && declared.length > 1) {
    const spliced = extractSplicedFeature(sequence, feature, length, circular);
    if (spliced.bases.length < 3) return [];
    const offset = Math.max(0, (feature.codonStart ?? 1) - 1);
    const codons: CodonInfo[] = [];
    let index = 1;
    for (let i = offset; i + 3 <= spliced.bases.length; i += 3) {
      codons.push({
        pos: spliced.positions[i] ?? feature.start,
        aa: translateCodon(spliced.bases.slice(i, i + 3)),
        index,
        codon: spliced.bases.slice(i, i + 3).toUpperCase(),
      });
      index += 1;
    }
    return codons;
  }
  const raw = extractRange(sequence, feature.start, feature.end, length, circular);
  if (raw.length < 3) return [];
  const coding = feature.strand === -1 ? reverseComplement(raw) : raw;
  const offset = Math.max(0, (feature.codonStart ?? 1) - 1);
  const codons: CodonInfo[] = [];
  let index = 1;
  for (let i = offset; i + 3 <= coding.length; i += 3) {
    const codon = coding.slice(i, i + 3).toUpperCase();
    const aa = translateCodon(codon);
    const pos = circular
      ? mod(feature.start + i, length)
      : feature.start + i;
    codons.push({ pos, aa, index, codon });
    index += 1;
  }
  return codons;
}

export interface SplicedFeatureBases {
  /** Spliced coding sequence in 5' -> 3' order. */
  bases: string;
  /** Document coordinate of every spliced base. */
  positions: number[];
}

/**
 * Concatenate the declared segments of a feature in biological order. Minus
 * strand features are reverse-complemented per segment; wrapped segments are
 * resolved so the first base always follows the 5' end.
 */
export function extractSplicedFeature(
  sequence: string,
  feature: SequenceFeature,
  length: number,
  circular: boolean,
): SplicedFeatureBases {
  const declared = parseSegmentsNote(feature.notes) ?? [
    { start: feature.start, end: feature.end },
  ];
  let bases = '';
  const positions: number[] = [];
  for (const segment of declared) {
    const coords: number[] = [];
    if (circular && length > 0) {
      const span =
        segment.start === segment.end
          ? 0
          : mod(segment.end - segment.start, length) || length;
      for (let offset = 0; offset < span; offset += 1) {
        coords.push(mod(segment.start + offset, length));
      }
    } else {
      const start = Math.max(0, Math.min(length, Math.min(segment.start, segment.end)));
      const end = Math.max(0, Math.min(length, Math.max(segment.start, segment.end)));
      for (let offset = start; offset < end; offset += 1) coords.push(offset);
    }
    let segmentBases = coords.map((position) => sequence[position] ?? 'N').join('');
    if (feature.strand === -1) {
      segmentBases = reverseComplement(segmentBases);
      coords.reverse();
    }
    bases += segmentBases;
    positions.push(...coords);
  }
  return { bases, positions };
}

export interface TranslationCodon {
  pos: number;
  aa: string;
  index: number;
  codon: string;
  frame: 1 | 2 | 3 | -1 | -2 | -3;
  strand: 1 | -1;
  featureId?: string;
}

export type TranslationMode = 'none' | 'cds' | 'frame3' | 'frame6';

export function buildTranslationCodons(
  sequence: string,
  features: SequenceFeature[],
  length: number,
  circular: boolean,
  mode: TranslationMode,
): TranslationCodon[] {
  if (mode === 'none' || sequence.length === 0) return [];
  const result: TranslationCodon[] = [];
  if (mode === 'cds') {
    for (const feature of features) {
      if (feature.type !== 'CDS') continue;
      const codons = buildCdsCodons(sequence, feature, length, circular);
      for (const codon of codons) {
        result.push({
          ...codon,
          frame: 1,
          strand: feature.strand === -1 ? -1 : 1,
          featureId: feature.id,
        });
      }
    }
    return result;
  }
  const frames: Array<1 | 2 | 3 | -1 | -2 | -3> =
    mode === 'frame6' ? [1, 2, 3, -1, -2, -3] : [1, 2, 3];
  for (const frame of frames) {
    if (frame > 0) {
      const offset = frame - 1;
      let index = 1;
      for (let s = offset; s + 3 <= length; s += 3) {
        const codon = sequence.slice(s, s + 3).toUpperCase();
        result.push({
          pos: s,
          aa: translateCodon(codon),
          index,
          codon,
          frame,
          strand: 1,
        });
        index += 1;
      }
    } else {
      const absFrame = Math.abs(frame) as 1 | 2 | 3;
      const firstStart = length - 3 - (absFrame - 1);
      let index = 1;
      for (let s = firstStart; s >= 0; s -= 3) {
        const codon = reverseComplement(sequence.slice(s, s + 3)).toUpperCase();
        result.push({
          pos: s,
          aa: translateCodon(codon),
          index,
          codon,
          frame,
          strand: -1,
        });
        index += 1;
      }
    }
  }
  return result;
}

export type TranslationRowMap = Map<number, TranslationCodon[]>;

export function buildTranslationRowMap(
  codons: TranslationCodon[],
  bpPerRow: number,
): TranslationRowMap {
  const map: TranslationRowMap = new Map();
  if (bpPerRow <= 0) return map;
  for (const codon of codons) {
    const row = Math.floor(codon.pos / bpPerRow);
    const existing = map.get(row);
    if (existing) existing.push(codon);
    else map.set(row, [codon]);
  }
  return map;
}

export interface FeatureRowSegment {
  feature: SequenceFeature;
  segment: RangeSegment;
  isTrueStart: boolean;
  isTrueEnd: boolean;
}

export type FeatureRowMap = Map<number, FeatureRowSegment[]>;

export function buildFeatureRowMap(
  features: SequenceFeature[],
  bpPerRow: number,
  length: number,
  circular: boolean,
): FeatureRowMap {
  const map: FeatureRowMap = new Map();
  if (bpPerRow <= 0 || length <= 0) return map;
  for (const feature of features) {
    if (isMultiSegment(feature)) {
      appendMultiSegmentRows(map, feature, bpPerRow, length, circular);
      continue;
    }
    const segments = featureSegments(feature, length, circular);
    const normalizedStart = circular
      ? mod(feature.start, length)
      : Math.max(0, Math.min(length, feature.start));
    const normalizedEnd = circular
      ? mod(feature.end, length)
      : Math.max(0, Math.min(length, feature.end));
    const fullCircle =
      circular && normalizedStart === normalizedEnd && feature.start !== feature.end;
    for (const segment of segments) {
      if (segment.end <= segment.start) continue;
      const firstRow = Math.floor(segment.start / bpPerRow);
      const lastRow = Math.floor((segment.end - 1) / bpPerRow);
      for (let row = firstRow; row <= lastRow; row += 1) {
        const rowStart = row * bpPerRow;
        const rowEnd = rowStart + bpPerRow;
        const clipped = {
          start: Math.max(segment.start, rowStart),
          end: Math.min(segment.end, rowEnd),
        };
        if (clipped.end <= clipped.start) continue;
        const trueEnd =
          normalizedEnd === 0 ? clipped.end === length : clipped.end === normalizedEnd;
        const entry: FeatureRowSegment = {
          feature,
          segment: clipped,
          isTrueStart: !fullCircle && clipped.start === normalizedStart,
          isTrueEnd: !fullCircle && trueEnd,
        };
        const existing = map.get(row);
        if (existing) existing.push(entry);
        else map.set(row, [entry]);
      }
    }
  }
  return map;
}

function isMultiSegment(feature: SequenceFeature): boolean {
  const declared = parseSegmentsNote(feature.notes);
  return declared !== null && declared.length > 1;
}

function appendMultiSegmentRows(
  map: FeatureRowMap,
  feature: SequenceFeature,
  bpPerRow: number,
  length: number,
  circular: boolean,
): void {
  const plan = buildFeatureSegmentPlan(feature, length, circular);
  const lastIndex = plan.pieces.reduce(
    (max, piece) => Math.max(max, piece.segmentIndex),
    -1,
  );
  for (const piece of plan.pieces) {
    if (piece.end <= piece.start) continue;
    const firstRow = Math.floor(piece.start / bpPerRow);
    const lastRow = Math.floor((piece.end - 1) / bpPerRow);
    for (let row = firstRow; row <= lastRow; row += 1) {
      const rowStart = row * bpPerRow;
      const rowEnd = rowStart + bpPerRow;
      const clipped = {
        start: Math.max(piece.start, rowStart),
        end: Math.min(piece.end, rowEnd),
      };
      if (clipped.end <= clipped.start) continue;
      const entry: FeatureRowSegment = {
        feature,
        segment: clipped,
        isTrueStart:
          piece.segmentIndex === lastIndex &&
          piece.isSegmentStart &&
          clipped.start === piece.start,
        isTrueEnd:
          piece.segmentIndex === lastIndex &&
          piece.isSegmentEnd &&
          clipped.end === piece.end,
      };
      const existing = map.get(row);
      if (existing) existing.push(entry);
      else map.set(row, [entry]);
    }
  }
}

export interface FeatureGapRowEntry {
  feature: SequenceFeature;
  gap: RangeSegment;
}

export type FeatureGapRowMap = Map<number, FeatureGapRowEntry[]>;

/** Intron-style connectors between the segments of multi-segment features. */
export function buildFeatureGapRowMap(
  features: SequenceFeature[],
  bpPerRow: number,
  length: number,
  circular: boolean,
): FeatureGapRowMap {
  const map: FeatureGapRowMap = new Map();
  if (bpPerRow <= 0 || length <= 0) return map;
  for (const feature of features) {
    if (!isMultiSegment(feature)) continue;
    const plan = buildFeatureSegmentPlan(feature, length, circular);
    for (const gap of segmentGapRanges(plan, length, circular)) {
      const firstRow = Math.floor(gap.start / bpPerRow);
      const lastRow = Math.floor((gap.end - 1) / bpPerRow);
      for (let row = firstRow; row <= lastRow; row += 1) {
        const rowStart = row * bpPerRow;
        const rowEnd = rowStart + bpPerRow;
        const clipped = {
          start: Math.max(gap.start, rowStart),
          end: Math.min(gap.end, rowEnd),
        };
        if (clipped.end <= clipped.start) continue;
        const entry: FeatureGapRowEntry = { feature, gap: clipped };
        const existing = map.get(row);
        if (existing) existing.push(entry);
        else map.set(row, [entry]);
      }
    }
  }
  return map;
}

export interface CutRowEntry {
  cut: CutSite;
  row: number;
}

export function buildCutRowMap(cutSites: CutSite[], bpPerRow: number): Map<number, CutSite[]> {
  const map: Map<number, CutSite[]> = new Map();
  if (bpPerRow <= 0) return map;
  for (const cut of cutSites) {
    const positions = [cut.cutPositionTop, cut.cutPositionBottom, cut.position];
    const rows = new Set<number>();
    for (const pos of positions) {
      if (Number.isFinite(pos)) rows.add(Math.floor(pos / bpPerRow));
    }
    for (const row of rows) {
      const existing = map.get(row);
      if (existing) existing.push(cut);
      else map.set(row, [cut]);
    }
  }
  return map;
}

export function buildPrimerRowMap(
  primers: Primer[],
  bpPerRow: number,
): Map<number, Primer[]> {
  const map: Map<number, Primer[]> = new Map();
  if (bpPerRow <= 0) return map;
  for (const primer of primers) {
    const firstRow = Math.floor(Math.min(primer.bindingStart, primer.bindingEnd) / bpPerRow);
    const lastRow = Math.floor((Math.max(primer.bindingStart, primer.bindingEnd) - 1) / bpPerRow);
    for (let row = firstRow; row <= lastRow; row += 1) {
      const existing = map.get(row);
      if (existing) existing.push(primer);
      else map.set(row, [primer]);
    }
  }
  return map;
}

export interface LinearTrackLayout {
  rowHeight: number;
  cutTop: number;
  cutBottom: number;
  cutCenter: number;
  plusY: number;
  minusY: number;
  translationTop: number;
  translationLineHeight: number;
  translationLines: number;
  featureTop: number;
  /** Total height of the feature track: one lane per overlapping group. */
  featureHeight: number;
  /** Height of a single feature lane. */
  featureLaneHeight: number;
}

/** Vertical distance between two tiers of stacked enzyme names. */
export const CUT_LABEL_STEP = 10;

/**
 * `labelTiers` is how many rows of enzyme names have to fit above the cut track.
 * Every track below moves down by the same amount so the row keeps one height for
 * the whole document, which is what the virtualised list needs.
 */
export const FEATURE_LANE_HEIGHT = 15;

export function getLinearTrackLayout(
  mode: TranslationMode,
  labelTiers = 1,
  featureLanes = 1,
): LinearTrackLayout {
  const translationLines = mode === 'none' ? 0 : mode === 'cds' ? 1 : mode === 'frame3' ? 3 : 6;
  // The row starts with the ruler numbers; the enzyme names are stacked below them,
  // which is why the cut track never begins before y = 22.
  const band = Math.max(0, labelTiers - 1) * CUT_LABEL_STEP;
  const cutTop = 22 + band;
  const cutBottom = 52 + band;
  const plusY = 74 + band;
  const minusY = 96 + band;
  const translationTop = (mode === 'none' ? 108 : 114) + band;
  const translationLineHeight = mode === 'cds' ? 22 : 17;
  const translationHeight = translationLines * translationLineHeight;
  const featureTop =
    mode === 'none'
      ? 108 + band
      : translationTop + translationHeight + (translationLines > 0 ? 8 : 0);
  // Features that overlap each other get a lane of their own, the way the maps draw them.
  const featureHeight = Math.max(1, featureLanes) * FEATURE_LANE_HEIGHT;
  return {
    rowHeight: featureTop + featureHeight + 12,
    cutTop,
    cutBottom,
    cutCenter: (cutTop + cutBottom) / 2,
    plusY,
    minusY,
    translationTop,
    translationLineHeight,
    translationLines,
    featureTop,
    featureHeight,
    featureLaneHeight: FEATURE_LANE_HEIGHT,
  };
}

export interface CutLabelPlacement {
  cut: CutSite;
  /** Where the name is centred, already kept inside the plot. */
  x: number;
  /** Where the cut itself is, so a leader can be drawn when the two differ. */
  anchorX: number;
  tier: number;
}

/**
 * Lays out the enzyme names above the cut track so they never overlap: names are
 * taken in order along the row and each one drops onto the lowest tier whose
 * previous name has already ended. Names that still do not fit within `maxTiers`
 * are left out - the cut mark and its tooltip remain.
 */
export function buildCutLabelRowMap(
  cutRowMap: Map<number, CutSite[]>,
  options: {
    bpPerRow: number;
    cell: number;
    gutter: number;
    plotRight: number;
    length: number;
    fontSize: number;
    maxTiers?: number;
  },
): { labels: Map<number, CutLabelPlacement[]>; tiers: number } {
  const { bpPerRow, cell, gutter, plotRight, length, fontSize } = options;
  const maxTiers = Math.max(1, options.maxTiers ?? 4);
  const labels = new Map<number, CutLabelPlacement[]>();
  let tiers = 1;
  if (cell < 5 || length <= 0) return { labels, tiers };

  for (const [row, cuts] of cutRowMap) {
    const rowStart = row * bpPerRow;
    const placements: CutLabelPlacement[] = [];
    const candidates = cuts
      .filter((cut) => cut.totalCutsInPlasmid === 1)
      .map((cut) => {
        const topX = clampNumber(gutter + (mod(cut.cutPositionTop, length) - rowStart) * cell, gutter, plotRight);
        const bottomX = clampNumber(gutter + (mod(cut.cutPositionBottom, length) - rowStart) * cell, gutter, plotRight);
        const anchorX = (topX + bottomX) / 2;
        // An average glyph of this font is about 0.62 em wide; 4 px keeps names apart.
        const half = (cut.enzyme.name.length * fontSize * 0.62) / 2 + 2;
        return { cut, anchorX, half };
      })
      .sort((a, b) => a.anchorX - b.anchorX || a.cut.enzyme.name.localeCompare(b.cut.enzyme.name));

    const tierEnds: number[] = [];
    for (const candidate of candidates) {
      const x = clampNumber(candidate.anchorX, gutter + candidate.half, Math.max(gutter + candidate.half, plotRight - candidate.half));
      const left = x - candidate.half;
      let tier = tierEnds.findIndex((end) => left >= end);
      if (tier === -1) {
        if (tierEnds.length >= maxTiers) continue;
        tier = tierEnds.length;
        tierEnds.push(-Infinity);
      }
      tierEnds[tier] = x + candidate.half;
      placements.push({ cut: candidate.cut, x, anchorX: candidate.anchorX, tier });
    }
    if (placements.length) {
      labels.set(row, placements);
      tiers = Math.max(tiers, tierEnds.length);
    }
  }
  return { labels, tiers };
}

function clampNumber(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function clampSelection(
  selection: { start: number; end: number } | null,
  length: number,
): RangeSegment[] {
  if (!selection || length <= 0) return [];
  const s = mod(selection.start, length);
  const e = mod(selection.end, length);
  if (s === e) {
    if (selection.start === selection.end) return [];
    return [{ start: 0, end: length }];
  }
  if (s < e) return [{ start: s, end: e }];
  return [
    { start: s, end: length },
    { start: 0, end: e },
  ];
}
