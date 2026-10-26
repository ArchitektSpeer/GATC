import type { Primer, SequenceFeature, CutSite } from '../../../types/schema';
import type { RangeSegment } from '../utils';
import { featureSegments, mod } from '../utils';

export const CODON_TABLE: Record<string, string> = {
  TTT: 'F',
  TTC: 'F',
  TTA: 'L',
  TTG: 'L',
  TCT: 'S',
  TCC: 'S',
  TCA: 'S',
  TCG: 'S',
  TAT: 'Y',
  TAC: 'Y',
  TAA: '*',
  TAG: '*',
  TGT: 'C',
  TGC: 'C',
  TGA: '*',
  TGG: 'W',
  CTT: 'L',
  CTC: 'L',
  CTA: 'L',
  CTG: 'L',
  CCT: 'P',
  CCC: 'P',
  CCA: 'P',
  CCG: 'P',
  CAT: 'H',
  CAC: 'H',
  CAA: 'Q',
  CAG: 'Q',
  CGT: 'R',
  CGC: 'R',
  CGA: 'R',
  CGG: 'R',
  ATT: 'I',
  ATC: 'I',
  ATA: 'I',
  ATG: 'M',
  ACT: 'T',
  ACC: 'T',
  ACA: 'T',
  ACG: 'T',
  AAT: 'N',
  AAC: 'N',
  AAA: 'K',
  AAG: 'K',
  AGT: 'S',
  AGC: 'S',
  AGA: 'R',
  AGG: 'R',
  GTT: 'V',
  GTC: 'V',
  GTA: 'V',
  GTG: 'V',
  GCT: 'A',
  GCC: 'A',
  GCA: 'A',
  GCG: 'A',
  GAT: 'D',
  GAC: 'D',
  GAA: 'E',
  GAG: 'E',
  GGT: 'G',
  GGC: 'G',
  GGA: 'G',
  GGG: 'G',
};

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

export function translateCodon(codon: string): string {
  return CODON_TABLE[codon.toUpperCase()] ?? 'X';
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
  featureHeight: number;
}

export function getLinearTrackLayout(mode: TranslationMode): LinearTrackLayout {
  const translationLines = mode === 'none' ? 0 : mode === 'cds' ? 1 : mode === 'frame3' ? 3 : 6;
  const cutTop = 10;
  const cutBottom = 40;
  const plusY = 62;
  const minusY = 84;
  const translationTop = mode === 'none' ? 96 : 102;
  const translationLineHeight = mode === 'cds' ? 22 : 17;
  const translationHeight = translationLines * translationLineHeight;
  const featureTop =
    mode === 'none'
      ? 96
      : translationTop + translationHeight + (translationLines > 0 ? 8 : 0);
  const featureHeight = 20;
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
  };
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
