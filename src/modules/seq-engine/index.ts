import type {
  CloningHistoryNode,
  CutSite,
  ORF,
  OverhangEnd,
  PlasmidDocument,
  Primer,
  RestrictionEnzyme,
  SequenceFeature,
} from '../../types/schema';
import {
  adjustRangeToDeletionOfAnotherRange,
  adjustRangeToInsert,
  adjustRangeToRotation,
} from '@teselagen/range-utils';
import {
  calculatePercentGC,
  getReverseComplementSequenceString,
} from '@teselagen/sequence-utils';
import { COMMERCIAL_ENZYMES, getEnzymeByName } from './enzymes';
import { FEATURE_LIBRARY } from './feature-library';
import type { FeatureLibraryEntry } from './feature-library';

export { COMMERCIAL_ENZYMES, getEnzymeByName };
export { FEATURE_LIBRARY };
export type { FeatureLibraryEntry };

export type SequenceEdit =
  | { type: 'insert'; position: number; bases: string }
  | { type: 'delete'; start: number; end: number }
  | { type: 'replace'; start: number; end: number; bases: string };

type Strand = 1 | -1;

const STOP_CODONS = new Set(['TAA', 'TAG', 'TGA']);
const START_CODON = 'ATG';

const CODON_TABLE: Record<string, string> = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
};

const AMINO_ACID_MASS: Record<string, number> = {
  A: 89.09, R: 174.2, N: 132.12, D: 133.1, C: 121.16,
  E: 147.13, Q: 146.15, G: 75.07, H: 155.16, I: 131.17,
  L: 131.17, K: 146.19, M: 149.21, F: 165.19, P: 115.13,
  S: 105.09, T: 119.12, W: 204.23, Y: 181.19, V: 117.15,
};

const IUPAC_PATTERN: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: '[AG]', Y: '[CT]', S: '[GC]', W: '[AT]',
  K: '[GT]', M: '[AC]', B: '[CGT]', D: '[AGT]',
  H: '[ACT]', V: '[ACG]', N: '[ACGT]',
};

let identifierCounter = 0;

function nextIdentifier(prefix: string): string {
  identifierCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${identifierCounter.toString(36)}`;
}

function mod(value: number, length: number): number {
  if (length <= 0) return 0;
  return ((value % length) + length) % length;
}

function normalizeSequence(sequence: string): string {
  return (sequence ?? '').toUpperCase().replace(/\s+/g, '');
}

function normalizeInsertBases(bases: string): string {
  const clean = (bases ?? '').toUpperCase().replace(/\s+/g, '');
  if (!clean) throw new Error('Sequence edit requires at least one base');
  if (!/^[ACGTURYSWKMBDHVN]+$/.test(clean)) {
    throw new Error('Sequence edit contains an invalid DNA base');
  }
  return clean.replace(/U/g, 'T');
}

export function calcGcPercent(seq: string): number {
  if (!seq) return 0;
  return calculatePercentGC(seq);
}

export function reverseComplement(seq: string): string {
  return getReverseComplementSequenceString(
    (seq ?? '').toUpperCase().replace(/\s+/g, ''),
  );
}

export function translateDna(seq: string): string {
  const clean = normalizeSequence(seq).replace(/U/g, 'T');
  let protein = '';
  for (let index = 0; index + 2 < clean.length; index += 3) {
    const codon = clean.slice(index, index + 3);
    protein += CODON_TABLE[codon] ?? 'X';
  }
  return protein;
}

function isPalindromic(sequence: string): boolean {
  return reverseComplement(sequence) === sequence;
}

function findPatternPositions(sequence: string, pattern: string): number[] {
  if (!pattern || sequence.length < pattern.length) return [];
  if (/^[ACGT]+$/.test(pattern)) {
    const positions: number[] = [];
    let cursor = sequence.indexOf(pattern);
    while (cursor !== -1) {
      positions.push(cursor);
      cursor = sequence.indexOf(pattern, cursor + 1);
    }
    return positions;
  }

  let body = '';
  for (const letter of pattern) {
    body += IUPAC_PATTERN[letter] ?? '[ACGT]';
  }
  const expression = new RegExp(`(?=(${body}))`, 'g');
  const positions: number[] = [];
  let match = expression.exec(sequence);
  while (match) {
    positions.push(match.index);
    expression.lastIndex = match.index + 1;
    match = expression.exec(sequence);
  }
  return positions;
}

function extractRound(sequence: string, start: number, length: number): string {
  if (length <= 0) return '';
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += sequence[mod(start + index, sequence.length)];
  }
  return result;
}

function extractSegment(
  sequence: string,
  circular: boolean,
  start: number,
  length: number,
): string {
  if (length <= 0) return '';
  if (circular) return extractRound(sequence, start, length);
  if (start < 0 || start + length > sequence.length) return '';
  return sequence.slice(start, start + length);
}

interface OverhangResult {
  type: CutSite['overhangType'];
  sequence: string;
}

function calculateOverhang(
  sequence: string,
  circular: boolean,
  rawTop: number,
  rawBottom: number,
): OverhangResult {
  const difference = rawBottom - rawTop;
  if (difference === 0) return { type: 'blunt', sequence: '' };
  const start = Math.min(rawTop, rawBottom);
  return {
    type: difference > 0 ? '5-prime' : '3-prime',
    sequence: extractSegment(sequence, circular, start, Math.abs(difference)),
  };
}

interface MethylationMasks {
  dam: Uint8Array;
  dcm: Uint8Array;
  cpg: Uint8Array;
  profile: { dam: boolean; dcm: boolean; cpg: boolean };
}

function buildMethylationMasks(
  sequence: string,
  circular: boolean,
  profile: PlasmidDocument['methylationProfile'],
): MethylationMasks {
  const length = sequence.length;
  const active = profile ?? { dam: true, dcm: true, cpg: false };
  const masks: MethylationMasks = {
    dam: new Uint8Array(length),
    dcm: new Uint8Array(length),
    cpg: new Uint8Array(length),
    profile: { dam: active.dam, dcm: active.dcm, cpg: active.cpg },
  };

  const mark = (mask: Uint8Array, motif: string): void => {
    const scan = circular ? sequence + sequence.slice(0, motif.length) : sequence;
    for (const position of findPatternPositions(scan, motif)) {
      if (position >= length) continue;
      for (let offset = 0; offset < motif.length; offset += 1) {
        mask[mod(position + offset, length)] = 1;
      }
    }
  };

  if (active.dam) mark(masks.dam, 'GATC');
  if (active.dcm) mark(masks.dcm, 'CCWGG');
  if (active.cpg) mark(masks.cpg, 'CG');
  return masks;
}

function maskContains(
  mask: Uint8Array,
  start: number,
  length: number,
  sequenceLength: number,
  circular: boolean,
): boolean {
  if (length <= 0) return false;
  for (let offset = 0; offset < length; offset += 1) {
    const position = circular ? mod(start + offset, sequenceLength) : start + offset;
    if (position < 0 || position >= sequenceLength) continue;
    if (mask[position] === 1) return true;
  }
  return false;
}

function isMethylationBlocked(
  enzyme: RestrictionEnzyme,
  recognitionStart: number,
  recognitionLength: number,
  rawTop: number,
  rawBottom: number,
  masks: MethylationMasks,
  sequenceLength: number,
  circular: boolean,
): boolean {
  if (enzyme.name.toUpperCase() === 'DPNI') {
    return !masks.profile.dam;
  }

  const sensitivity = enzyme.methylationSensitivity;
  if (!sensitivity) return false;

  const cutStart = Math.min(rawTop, rawBottom);
  const cutLength = Math.abs(rawBottom - rawTop);
  const cutTop = circular ? mod(rawTop, sequenceLength) : rawTop;
  const cutBottom = circular ? mod(rawBottom, sequenceLength) : rawBottom;

  const overlap = (mask: Uint8Array): boolean => {
    if (
      maskContains(mask, recognitionStart, recognitionLength, sequenceLength, circular) ||
      maskContains(mask, cutStart, cutLength, sequenceLength, circular)
    ) {
      return true;
    }
    if (cutTop >= 0 && cutTop < sequenceLength && mask[cutTop] === 1) return true;
    if (cutBottom >= 0 && cutBottom < sequenceLength && mask[cutBottom] === 1) return true;
    return false;
  };

  if (sensitivity.dam === 'blocked' && masks.profile.dam && overlap(masks.dam)) {
    return true;
  }
  if (sensitivity.dcm === 'blocked' && masks.profile.dcm && overlap(masks.dcm)) {
    return true;
  }
  if (sensitivity.cpg === 'blocked' && masks.profile.cpg && overlap(masks.cpg)) {
    return true;
  }
  return false;
}

export function findCutSites(
  doc: PlasmidDocument,
  enzymes: RestrictionEnzyme[] = COMMERCIAL_ENZYMES,
  filter: {
    uniqueOnly?: boolean;
    commercialOnly?: boolean;
    buffer?: 'r1.1' | 'r2.1' | 'r3.1' | 'rCutSmart';
    excludeMethylationBlocked?: boolean;
  } = {},
): CutSite[] {
  const sequence = normalizeSequence(doc.sequence);
  const length = sequence.length;
  if (length === 0) return [];

  const circular = doc.topology === 'circular';
  const selected = enzymes.filter((enzyme) => {
    if (filter.commercialOnly && (enzyme.suppliers ?? []).length === 0) {
      return false;
    }
    if (filter.buffer) {
      const activity = enzyme.nebBuffers?.[filter.buffer];
      if (activity === undefined || activity <= 0) return false;
    }
    return true;
  });
  if (selected.length === 0) return [];

  let maximumRecognitionLength = 0;
  for (const enzyme of selected) {
    maximumRecognitionLength = Math.max(
      maximumRecognitionLength,
      enzyme.recognitionSeq.length,
    );
  }
  const scanSequence = circular
    ? sequence + sequence.slice(0, maximumRecognitionLength)
    : sequence;
  const masks = buildMethylationMasks(
    sequence,
    circular,
    doc.methylationProfile,
  );

  const allSites: CutSite[] = [];

  for (const enzyme of selected) {
    const recognition = enzyme.recognitionSeq.toUpperCase();
    const recognitionLength = recognition.length;
    const hits: Array<{ position: number; strand: Strand }> = [];

    for (const position of findPatternPositions(scanSequence, recognition)) {
      if (position < length) hits.push({ position, strand: 1 });
    }

    if (!isPalindromic(recognition)) {
      const reverseRecognition = reverseComplement(recognition);
      for (const position of findPatternPositions(scanSequence, reverseRecognition)) {
        if (position < length) hits.push({ position, strand: -1 });
      }
    }

    const seen = new Set<string>();
    const enzymeSites: CutSite[] = [];

    for (const hit of hits) {
      const identity = `${hit.position}:${hit.strand}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      const rawTop =
        hit.strand === 1
          ? hit.position + enzyme.cutIndexTop
          : hit.position + recognitionLength - enzyme.cutIndexBottom;
      const rawBottom =
        hit.strand === 1
          ? hit.position + enzyme.cutIndexBottom
          : hit.position + recognitionLength - enzyme.cutIndexTop;

      if (
        !circular &&
        (rawTop < 0 || rawTop > length || rawBottom < 0 || rawBottom > length)
      ) {
        continue;
      }

      const cutPositionTop = circular ? mod(rawTop, length) : rawTop;
      const cutPositionBottom = circular ? mod(rawBottom, length) : rawBottom;
      const overhang = calculateOverhang(sequence, circular, rawTop, rawBottom);
      const blocked = isMethylationBlocked(
        enzyme,
        hit.position,
        recognitionLength,
        rawTop,
        rawBottom,
        masks,
        length,
        circular,
      );

      enzymeSites.push({
        id: `${enzyme.name}:${hit.position}:${hit.strand}`,
        enzyme,
        position: hit.position,
        strand: hit.strand,
        cutPositionTop,
        cutPositionBottom,
        overhangType: overhang.type,
        overhangSeq: overhang.sequence,
        isMethylationBlocked: blocked,
        totalCutsInPlasmid: 0,
      });
    }

    for (const site of enzymeSites) {
      site.totalCutsInPlasmid = enzymeSites.length;
    }
    allSites.push(...enzymeSites);
  }

  let result = allSites;
  if (filter.uniqueOnly) {
    result = result.filter((site) => site.totalCutsInPlasmid === 1);
  }
  if (filter.excludeMethylationBlocked) {
    result = result.filter((site) => !site.isMethylationBlocked);
  }

  return result.sort(
    (left, right) =>
      left.position - right.position ||
      left.enzyme.name.localeCompare(right.enzyme.name) ||
      left.strand - right.strand,
  );
}

function proteinMolecularWeightKda(aminoAcids: string): number {
  if (!aminoAcids) return 0;
  let mass = 18.015;
  for (const residue of aminoAcids) {
    mass += AMINO_ACID_MASS[residue] ?? 0;
  }
  return mass / 1000;
}

function proteinIsoelectricPoint(aminoAcids: string): number {
  if (!aminoAcids) return 0;
  const count = (residue: string): number => {
    let total = 0;
    for (const letter of aminoAcids) {
      if (letter === residue) total += 1;
    }
    return total;
  };

  const lysine = count('K');
  const arginine = count('R');
  const histidine = count('H');
  const aspartate = count('D');
  const glutamate = count('E');
  const cysteine = count('C');
  const tyrosine = count('Y');

  const chargeAt = (ph: number): number => {
    const positive =
      1 / (1 + 10 ** (ph - 9.69)) +
      lysine / (1 + 10 ** (ph - 10.53)) +
      arginine / (1 + 10 ** (ph - 10.52)) +
      histidine / (1 + 10 ** (ph - 6.0));
    const negative =
      1 / (1 + 10 ** (2.34 - ph)) +
      aspartate / (1 + 10 ** (3.65 - ph)) +
      glutamate / (1 + 10 ** (4.25 - ph)) +
      cysteine / (1 + 10 ** (8.18 - ph)) +
      tyrosine / (1 + 10 ** (10.07 - ph));
    return positive - negative;
  };

  let low = 0;
  let high = 14;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (chargeAt(middle) > 0) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

function orfFrame(start: number, strand: Strand): ORF['frame'] {
  if (strand === 1) {
    return ((start % 3) + 1) as ORF['frame'];
  }
  return -(((start % 3) + 1)) as ORF['frame'];
}

export function findAllORFs(doc: PlasmidDocument, minAaLength = 75): ORF[] {
  const sequence = normalizeSequence(doc.sequence);
  const length = sequence.length;
  if (length < 3) return [];

  const circular = doc.topology === 'circular';
  const minimum = Math.max(0, Math.floor(minAaLength));
  interface Candidate {
    start: number;
    endRaw: number;
    strand: Strand;
    aminoAcids: string;
  }
  const candidates = new Map<string, Candidate>();

  for (const strand of [1, -1] as const) {
    const oriented = strand === 1 ? sequence : reverseComplement(sequence);
    const scan = circular ? oriented + oriented : oriented;
    const orientedLength = oriented.length;

    for (let start = 0; start < length; start += 1) {
      if (scan.slice(start, start + 3) !== START_CODON) continue;

      const limit = circular ? start + length : orientedLength;
      let stopStart = -1;
      for (let position = start; position + 3 <= limit; position += 3) {
        const codon = scan.slice(position, position + 3);
        if (STOP_CODONS.has(codon)) {
          stopStart = position;
          break;
        }
      }
      if (stopStart < 0) continue;

      const endRaw = stopStart + 3;
      const lengthBp = endRaw - start;
      if (lengthBp < 3 || lengthBp > length) continue;

      const aminoAcids = translateDna(scan.slice(start, stopStart));
      if (aminoAcids.length < minimum) continue;

      const key = `${strand}:${stopStart}`;
      const current = candidates.get(key);
      if (!current || start < current.start) {
        candidates.set(key, {
          start,
          endRaw,
          strand,
          aminoAcids,
        });
      }
    }
  }

  const orfs: ORF[] = [];
  for (const candidate of candidates.values()) {
    const { start, endRaw, strand, aminoAcids } = candidate;
    const lengthBp = endRaw - start;

    let topStart: number;
    let topEnd: number;
    if (lengthBp === length) {
      topStart = 0;
      topEnd = length;
    } else if (strand === 1) {
      topStart = start;
      topEnd = circular ? endRaw % length : endRaw;
    } else if (circular) {
      topStart = mod(length - (endRaw % length), length);
      topEnd = mod(length - (start % length), length);
    } else {
      topStart = length - endRaw;
      topEnd = length - start;
    }

    orfs.push({
      id: `orf-${strand === 1 ? 'f' : 'r'}-${topStart}-${topEnd}-${lengthBp}`,
      start: topStart,
      end: topEnd,
      strand,
      frame: orfFrame(strand === 1 ? topStart : start, strand),
      lengthBp,
      aminoAcids,
      mwKda: Number(proteinMolecularWeightKda(aminoAcids).toFixed(3)),
      pI: Number(proteinIsoelectricPoint(aminoAcids).toFixed(2)),
    });
  }

  return orfs.sort(
    (left, right) => left.start - right.start || left.strand - right.strand,
  );
}

function inclusiveRange(
  start: number,
  end: number,
  length: number,
): { start: number; end: number } | null {
  if (start === end) return null;
  if (end > 0) return { start, end: end - 1 };
  return { start, end: length - 1 };
}

function shiftRangeForInsertion(
  length: number,
  start: number,
  end: number,
  position: number,
  insertedLength: number,
  circular: boolean,
): [number, number] {
  const newLength = length + insertedLength;
  if (start === end) return [start, end];
  if (start === 0 && end === length) {
    return [0, newLength];
  }

  const range = inclusiveRange(start, end, length);
  if (!range) return [start, end];
  const adjusted = adjustRangeToInsert(range, position, insertedLength) as {
    start: number;
    end: number;
  };
  let newStart = adjusted.start;
  let newEnd = adjusted.end + 1;
  if (circular) {
    newStart = mod(newStart, newLength);
    newEnd = mod(newEnd, newLength);
  }
  return [newStart, newEnd];
}

interface TransformResult {
  sequence: string;
  features: SequenceFeature[];
  primers: Primer[];
}

function transformInsertion(
  sequence: string,
  features: SequenceFeature[],
  primers: Primer[],
  position: number,
  bases: string,
  circular: boolean,
): TransformResult {
  const length = sequence.length;
  const newLength = length + bases.length;
  const nextSequence = sequence.slice(0, position) + bases + sequence.slice(position);

  const nextFeatures = features.map((feature) => {
    const [start, end] = shiftRangeForInsertion(
      length,
      feature.start,
      feature.end,
      position,
      bases.length,
      circular,
    );
    return { ...feature, start, end };
  });

  const nextPrimers = primers.map((primer) => {
    const [bindingStart, bindingEnd] = shiftRangeForInsertion(
      length,
      primer.bindingStart,
      primer.bindingEnd,
      position,
      bases.length,
      circular,
    );
    let mismatches = primer.mismatches;
    if (mismatches) {
      mismatches = mismatches
        .map((mismatch) => {
          const shifted = mismatch >= position ? mismatch + bases.length : mismatch;
          return circular ? mod(shifted, newLength) : shifted;
        })
        .filter((mismatch) => mismatch >= 0 && mismatch < newLength);
    }
    return { ...primer, bindingStart, bindingEnd, mismatches };
  });

  return { sequence: nextSequence, features: nextFeatures, primers: nextPrimers };
}

interface DeletionResult extends TransformResult {
  deletedLength: number;
}

function transformDeletion(
  sequence: string,
  features: SequenceFeature[],
  primers: Primer[],
  requestedStart: number,
  requestedEnd: number,
  circular: boolean,
): DeletionResult {
  const length = sequence.length;
  let start = requestedStart;
  let end = requestedEnd;

  if (!circular) {
    if (start < 0 || end < start || end > length) {
      throw new Error('Deletion range is outside the linear sequence');
    }
  } else {
    if (start < 0 || end < 0) {
      throw new Error('Deletion coordinates must be non-negative');
    }
    if (start === 0 && end === length) {
      throw new Error('Deleting the entire plasmid sequence is not supported');
    }
    start = mod(start, length);
    end = end === length ? 0 : mod(end, length);
  }

  if (start === end) {
    return {
      sequence,
      features: features.map((feature) => ({ ...feature })),
      primers: primers.map((primer) => ({ ...primer })),
      deletedLength: 0,
    };
  }

  const wrapped = start > end;
  const deletedLength = wrapped ? length - start + end : end - start;
  if (deletedLength >= length) {
    throw new Error('Deleting the entire plasmid sequence is not supported');
  }
  const newLength = length - deletedLength;
  const nextSequence = wrapped
    ? sequence.slice(end, start)
    : sequence.slice(0, start) + sequence.slice(end);

  const deletionRange = inclusiveRange(start, end, length);
  if (!deletionRange) {
    return {
      sequence: nextSequence,
      features: [],
      primers: [],
      deletedLength,
    };
  }

  const nextFeatures: SequenceFeature[] = [];
  for (const feature of features) {
    const wasFullLength = feature.start === 0 && feature.end === length;
    const featureRange = inclusiveRange(feature.start, feature.end, length);
    if (!featureRange) continue;
    const trimmed = adjustRangeToDeletionOfAnotherRange(
      featureRange,
      deletionRange,
      length,
    ) as { start: number; end: number } | null;
    if (!trimmed) continue;

    const trimmedLength = trimmed.end - trimmed.start + 1;
    let newStart = trimmed.start;
    let newEnd = trimmed.end + 1;
    if (circular) {
      newStart = mod(newStart, newLength);
      newEnd = mod(newEnd, newLength);
    }
    if (newStart === newEnd) {
      if (newLength > 0 && (trimmedLength === newLength || wasFullLength)) {
        newStart = 0;
        newEnd = newLength;
      } else {
        continue;
      }
    }
    nextFeatures.push({ ...feature, start: newStart, end: newEnd });
  }

  const nextPrimers: Primer[] = [];
  for (const primer of primers) {
    const primerRange = inclusiveRange(
      primer.bindingStart,
      primer.bindingEnd,
      length,
    );
    if (!primerRange) continue;
    const trimmed = adjustRangeToDeletionOfAnotherRange(
      primerRange,
      deletionRange,
      length,
    ) as { start: number; end: number } | null;
    if (!trimmed) continue;

    const trimmedLength = trimmed.end - trimmed.start + 1;
    let bindingStart = trimmed.start;
    let bindingEnd = trimmed.end + 1;
    if (circular) {
      bindingStart = mod(bindingStart, newLength);
      bindingEnd = mod(bindingEnd, newLength);
    }
    if (bindingStart === bindingEnd) {
      if (newLength > 0 && trimmedLength === newLength) {
        bindingStart = 0;
        bindingEnd = newLength;
      } else {
        continue;
      }
    }

    let mismatches = primer.mismatches;
    if (mismatches) {
      mismatches = mismatches
        .map((mismatch) => {
          if (wrapped) {
            if (mismatch < end || mismatch >= start) return null;
            return mod(mismatch - end, newLength);
          }
          if (mismatch >= start && mismatch < end) return null;
          if (mismatch >= end) return mismatch - deletedLength;
          return mismatch;
        })
        .filter((mismatch): mismatch is number => mismatch !== null)
        .filter((mismatch) => mismatch >= 0 && mismatch < newLength);
    }

    nextPrimers.push({ ...primer, bindingStart, bindingEnd, mismatches });
  }

  return {
    sequence: nextSequence,
    features: nextFeatures,
    primers: nextPrimers,
    deletedLength,
  };
}

function withHistory(
  doc: PlasmidDocument,
  sequence: string,
  features: SequenceFeature[],
  primers: Primer[],
  description: string,
): PlasmidDocument {
  const timestamp = new Date().toISOString();
  const node: CloningHistoryNode = {
    id: nextIdentifier('history'),
    operation: 'manual_edit',
    timestamp,
    description,
    parentSnapshots: [
      {
        id: doc.id,
        name: doc.name,
        length: doc.sequence.length,
      },
    ],
  };
  return {
    ...doc,
    sequence,
    length: sequence.length,
    features,
    primers,
    history: [...(doc.history ?? []), node],
    updatedAt: timestamp,
  };
}

export function mutatePlasmidSequence(
  doc: PlasmidDocument,
  edit: SequenceEdit,
): PlasmidDocument {
  const sequence = normalizeSequence(doc.sequence);
  const circular = doc.topology === 'circular';

  if (edit.type === 'insert') {
    if (
      !Number.isInteger(edit.position) ||
      edit.position < 0 ||
      edit.position > sequence.length
    ) {
      throw new Error('Insertion position is outside the sequence');
    }
    const bases = normalizeInsertBases(edit.bases);
    const result = transformInsertion(
      sequence,
      doc.features,
      doc.primers,
      edit.position,
      bases,
      circular,
    );
    return withHistory(
      doc,
      result.sequence,
      result.features,
      result.primers,
      `Inserted ${bases.length} bp at position ${edit.position}`,
    );
  }

  if (edit.type === 'delete') {
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
      throw new Error('Deletion coordinates must be integers');
    }
    const result = transformDeletion(
      sequence,
      doc.features,
      doc.primers,
      edit.start,
      edit.end,
      circular,
    );
    return withHistory(
      doc,
      result.sequence,
      result.features,
      result.primers,
      `Deleted ${result.deletedLength} bp from ${edit.start} to ${edit.end}`,
    );
  }

  const bases = normalizeInsertBases(edit.bases);
  if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
    throw new Error('Replacement coordinates must be integers');
  }
  if (edit.start === 0 && edit.end === sequence.length) {
    const next = withHistory(
      doc,
      bases,
      [],
      [],
      `Replaced entire ${sequence.length} bp sequence with ${bases.length} bp`,
    );
    return doc.topology === 'linear'
      ? { ...next, linearEnds: undefined }
      : next;
  }
  const deleted = transformDeletion(
    sequence,
    doc.features,
    doc.primers,
    edit.start,
    edit.end,
    circular,
  );
  const insertionPosition = edit.start <= edit.end ? edit.start : 0;
  const result = transformInsertion(
    deleted.sequence,
    deleted.features,
    deleted.primers,
    insertionPosition,
    bases,
    circular,
  );

  // A replacement removes the old bases, but a feature or primer that exactly
  // spans the replaced interval still describes the new interval. Re-attach
  // those annotations instead of dropping them with the deleted sequence.
  if (edit.start <= edit.end) {
    const delta = bases.length - deleted.deletedLength;
    const newLength = result.sequence.length;
    for (const feature of doc.features) {
      if (feature.start > edit.start || feature.end < edit.end) continue;
      if (result.features.some((candidate) => candidate.id === feature.id)) continue;
      let start = feature.start;
      let end = feature.end + delta;
      if (circular) {
        start = mod(start, newLength);
        end = mod(end, newLength);
        if (start === 0 && feature.start === 0 && feature.end === sequence.length) {
          end = newLength;
        }
      }
      result.features.push({ ...feature, start, end });
    }
    for (const primer of doc.primers) {
      if (primer.bindingStart > edit.start || primer.bindingEnd < edit.end) continue;
      if (result.primers.some((candidate) => candidate.id === primer.id)) continue;
      let bindingStart = primer.bindingStart;
      let bindingEnd = primer.bindingEnd + delta;
      if (circular) {
        bindingStart = mod(bindingStart, newLength);
        bindingEnd = mod(bindingEnd, newLength);
      }
      result.primers.push({ ...primer, bindingStart, bindingEnd });
    }
  } else {
    // A wrapped replacement can also delete an annotation exactly. The new
    // bases occupy the start of the rotated sequence, so re-anchor it there.
    for (const feature of doc.features) {
      if (feature.start !== edit.start || feature.end !== edit.end) continue;
      if (result.features.some((candidate) => candidate.id === feature.id)) continue;
      result.features.push({ ...feature, start: 0, end: bases.length });
    }
    for (const primer of doc.primers) {
      if (
        primer.bindingStart !== edit.start ||
        primer.bindingEnd !== edit.end
      ) {
        continue;
      }
      if (result.primers.some((candidate) => candidate.id === primer.id)) continue;
      result.primers.push({
        ...primer,
        bindingStart: 0,
        bindingEnd: bases.length,
      });
    }
  }

  return withHistory(
    doc,
    result.sequence,
    result.features,
    result.primers,
    `Replaced ${deleted.deletedLength} bp from ${edit.start} to ${edit.end} with ${bases.length} bp`,
  );
}

function reverseRange(
  start: number,
  end: number,
  length: number,
  circular: boolean,
): [number, number] {
  if (start === end) return [start, end];
  if (start === 0 && end === length) return [0, length];
  if (!circular) return [length - end, length - start];
  return [mod(length - end, length), mod(length - start, length)];
}

function reverseOverhang(end: OverhangEnd): OverhangEnd {
  return {
    ...end,
    type:
      end.type === '5-prime'
        ? '3-prime'
        : end.type === '3-prime'
          ? '5-prime'
          : 'blunt',
    sequence: reverseComplement(end.sequence),
  };
}

export function reverseComplementPlasmid(doc: PlasmidDocument): PlasmidDocument {
  const sequence = normalizeSequence(doc.sequence);
  const length = sequence.length;
  const circular = doc.topology === 'circular';
  const nextSequence = reverseComplement(sequence);

  const nextFeatures = doc.features.map((feature) => {
    const [start, end] = reverseRange(
      feature.start,
      feature.end,
      length,
      circular,
    );
    const strand: SequenceFeature['strand'] =
      feature.strand === 1 ? -1 : feature.strand === -1 ? 1 : 0;
    return {
      ...feature,
      start,
      end,
      strand,
    };
  });

  const nextPrimers = doc.primers.map((primer) => {
    const [bindingStart, bindingEnd] = reverseRange(
      primer.bindingStart,
      primer.bindingEnd,
      length,
      circular,
    );
    const mismatches = primer.mismatches
      ?.map((mismatch) => mod(length - 1 - mismatch, length))
      .sort((left, right) => left - right);
    return {
      ...primer,
      bindingStart,
      bindingEnd,
      strand: (primer.strand === 1 ? -1 : 1) as Strand,
      mismatches,
    };
  });

  let nextDoc = withHistory(
    doc,
    nextSequence,
    nextFeatures,
    nextPrimers,
    'Reverse-complemented plasmid',
  );

  if (doc.linearEnds) {
    nextDoc = {
      ...nextDoc,
      linearEnds: {
        left: reverseOverhang(doc.linearEnds.right),
        right: reverseOverhang(doc.linearEnds.left),
      },
    };
  }
  return nextDoc;
}

function rotateRange(
  start: number,
  end: number,
  zeroIndex: number,
  length: number,
): [number, number] {
  if (start === 0 && end === length) return [0, length];
  const adjusted = adjustRangeToRotation(
    { start, end },
    zeroIndex,
    length,
  ) as { start: number; end: number };
  return [adjusted.start, adjusted.end];
}

export function rotateCircularOrigin(
  doc: PlasmidDocument,
  newZeroIndex: number,
): PlasmidDocument {
  if (doc.topology !== 'circular') {
    throw new Error('rotateCircularOrigin requires a circular plasmid');
  }
  const sequence = normalizeSequence(doc.sequence);
  const length = sequence.length;
  if (!Number.isFinite(newZeroIndex)) {
    throw new Error('New origin must be a finite number');
  }
  if (length === 0) {
    return withHistory(doc, sequence, [], [], 'Rotated circular origin to 0');
  }
  const zeroIndex = mod(Math.floor(newZeroIndex), length);
  if (zeroIndex === 0) {
    return withHistory(
      doc,
      sequence,
      doc.features.map((feature) => ({ ...feature })),
      doc.primers.map((primer) => ({ ...primer })),
      'Rotated circular origin to 0',
    );
  }
  const nextSequence = sequence.slice(zeroIndex) + sequence.slice(0, zeroIndex);

  const nextFeatures = doc.features.map((feature) => {
    const [start, end] = rotateRange(
      feature.start,
      feature.end,
      zeroIndex,
      length,
    );
    return { ...feature, start, end };
  });

  const nextPrimers = doc.primers.map((primer) => {
    const [bindingStart, bindingEnd] = rotateRange(
      primer.bindingStart,
      primer.bindingEnd,
      zeroIndex,
      length,
    );
    const mismatches = primer.mismatches
      ?.map((mismatch) => mod(mismatch - zeroIndex, length))
      .sort((left, right) => left - right);
    return { ...primer, bindingStart, bindingEnd, mismatches };
  });

  return withHistory(
    doc,
    nextSequence,
    nextFeatures,
    nextPrimers,
    `Rotated circular origin to ${zeroIndex}`,
  );
}

interface AutomationEntry {
  libraryIndex: number;
  strand: Strand;
  kind: 'full' | 'seed';
  offset: number;
  patternLength: number;
}

interface AutomatonNode {
  next: Int32Array;
  fail: number;
  outputs: number[];
}

const NUCLEOTIDE_CODE: Record<string, number> = {
  A: 0,
  C: 1,
  G: 2,
  T: 3,
};

function createAutomatonNode(): AutomatonNode {
  return { next: new Int32Array(4).fill(-1), fail: 0, outputs: [] };
}

// Aho-Corasick automaton with failure links. The four-symbol transition
// table keeps multi-pattern scans over both strands linear in the sequence
// length with a very small constant factor.
class AnnotationAutomaton {
  private readonly nodes: AutomatonNode[] = [createAutomatonNode()];

  readonly entries: AutomationEntry[] = [];

  add(
    pattern: string,
    entry: Omit<AutomationEntry, 'patternLength'>,
  ): void {
    if (!pattern || !/^[ACGT]+$/.test(pattern)) return;
    let state = 0;
    for (const letter of pattern) {
      const code = NUCLEOTIDE_CODE[letter];
      if (code === undefined) continue;
      let next = this.nodes[state].next[code];
      if (next === -1) {
        next = this.nodes.length;
        this.nodes.push(createAutomatonNode());
        this.nodes[state].next[code] = next;
      }
      state = next;
    }
    this.entries.push({ ...entry, patternLength: pattern.length });
    this.nodes[state].outputs.push(this.entries.length - 1);
  }

  build(): void {
    const queue: number[] = [];
    for (let code = 0; code < 4; code += 1) {
      const child = this.nodes[0].next[code];
      if (child !== -1) {
        this.nodes[child].fail = 0;
        queue.push(child);
      }
    }

    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const current = queue[queueIndex];
      queueIndex += 1;
      for (let code = 0; code < 4; code += 1) {
        const child = this.nodes[current].next[code];
        if (child === -1) continue;

        let fallback = this.nodes[current].fail;
        while (
          fallback !== 0 &&
          this.nodes[fallback].next[code] === -1
        ) {
          fallback = this.nodes[fallback].fail;
        }
        const candidate = this.nodes[fallback].next[code];
        this.nodes[child].fail =
          candidate !== -1 && candidate !== child ? candidate : 0;
        this.nodes[child].outputs.push(
          ...this.nodes[this.nodes[child].fail].outputs,
        );
        queue.push(child);
      }
    }
  }

  search(text: string): Array<{ entryIndex: number; start: number }> {
    const results: Array<{ entryIndex: number; start: number }> = [];
    let state = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = NUCLEOTIDE_CODE[text[index]];
      if (code === undefined) {
        state = 0;
        continue;
      }
      while (state !== 0 && this.nodes[state].next[code] === -1) {
        state = this.nodes[state].fail;
      }
      const next = this.nodes[state].next[code];
      state = next === -1 ? 0 : next;
      for (const output of this.nodes[state].outputs) {
        const entry = this.entries[output];
        results.push({
          entryIndex: output,
          start: index - entry.patternLength + 1,
        });
      }
    }
    return results;
  }
}

interface AutomationData {
  automaton: AnnotationAutomaton;
  sequences: string[];
  maxPatternLength: number;
}

const AUTOMATA = new WeakMap<object, AutomationData>();

function buildAutomation(library: FeatureLibraryEntry[]): AutomationData {
  const automaton = new AnnotationAutomaton();
  const sequences: string[] = [];
  let maxPatternLength = 0;

  const addSeeds = (
    pattern: string,
    libraryIndex: number,
    strand: Strand,
  ): void => {
    if (pattern.length <= 30) return;
    const seedLength = pattern.length >= 120 ? 18 : 12;
    const available = pattern.length - seedLength;
    const offsets =
      pattern.length >= 120
        ? [
            12,
            Math.floor(available / 4),
            Math.floor(available / 2),
            Math.floor((3 * available) / 4),
            available - 12,
          ]
        : [0, Math.floor(available / 2), available];
    const uniqueOffsets = [...new Set(offsets)].filter(
      (offset) => offset >= 0 && offset + seedLength <= pattern.length,
    );
    for (const offset of uniqueOffsets) {
      automaton.add(pattern.slice(offset, offset + seedLength), {
        libraryIndex,
        strand,
        kind: 'seed',
        offset,
      });
    }
  };

  const addOrientation = (
    pattern: string,
    libraryIndex: number,
    strand: Strand,
  ): void => {
    automaton.add(pattern, {
      libraryIndex,
      strand,
      kind: 'full',
      offset: 0,
    });
    addSeeds(pattern, libraryIndex, strand);
  };

  for (let index = 0; index < library.length; index += 1) {
    const sequence = (library[index].sequence ?? '').toUpperCase();
    if (!/^[ACGT]+$/.test(sequence)) {
      sequences.push('');
      continue;
    }
    sequences.push(sequence);
    maxPatternLength = Math.max(maxPatternLength, sequence.length);
    addOrientation(sequence, index, 1);
    const reverse = reverseComplement(sequence);
    if (reverse !== sequence) {
      addOrientation(reverse, index, -1);
    }
  }

  automaton.build();
  return { automaton, sequences, maxPatternLength };
}

function getAutomation(library: FeatureLibraryEntry[]): AutomationData {
  const cached = AUTOMATA.get(library);
  if (cached) return cached;
  const built = buildAutomation(library);
  AUTOMATA.set(library, built);
  return built;
}

function rangeLength(start: number, end: number, sequenceLength: number): number {
  if (start === end) return 0;
  return end > start ? end - start : sequenceLength - start + end;
}

function splitRange(
  start: number,
  end: number,
  sequenceLength: number,
): Array<[number, number]> {
  if (start === end) return [];
  if (start < end) return [[start, end]];
  return [
    [start, sequenceLength],
    [0, end],
  ];
}

function overlapLength(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
  sequenceLength: number,
): number {
  let total = 0;
  for (const [leftA, leftB] of splitRange(leftStart, leftEnd, sequenceLength)) {
    for (const [rightA, rightB] of splitRange(rightStart, rightEnd, sequenceLength)) {
      total += Math.max(0, Math.min(leftB, rightB) - Math.max(leftA, rightA));
    }
  }
  return total;
}

function hasEquivalentAnnotation(
  features: SequenceFeature[],
  name: string,
  start: number,
  end: number,
  sequenceLength: number,
): boolean {
  const targetLength = rangeLength(start, end, sequenceLength);
  if (targetLength <= 0) return false;
  const normalizedName = name.trim().toLowerCase();
  for (const feature of features) {
    if (feature.name.trim().toLowerCase() !== normalizedName) continue;
    const featureLength = rangeLength(feature.start, feature.end, sequenceLength);
    if (featureLength <= 0) continue;
    const overlap = overlapLength(
      start,
      end,
      feature.start,
      feature.end,
      sequenceLength,
    );
    if (overlap >= 0.8 * Math.min(targetLength, featureLength)) {
      return true;
    }
  }
  return false;
}

function sequenceIdentity(
  sequence: string,
  pattern: string,
  start: number,
  circular: boolean,
): number {
  if (pattern.length === 0) return 0;
  if (!circular && (start < 0 || start + pattern.length > sequence.length)) {
    return 0;
  }
  let matches = 0;
  for (let offset = 0; offset < pattern.length; offset += 1) {
    const position = circular
      ? mod(start + offset, sequence.length)
      : start + offset;
    if (sequence[position] === pattern[offset]) matches += 1;
  }
  return matches / pattern.length;
}

function annotatedFeatureEnd(
  start: number,
  patternLength: number,
  sequenceLength: number,
  circular: boolean,
): number {
  if (patternLength === sequenceLength) return sequenceLength;
  if (!circular) return start + patternLength;
  return mod(start + patternLength, sequenceLength);
}

export function autoAnnotateFeatures(
  doc: PlasmidDocument,
  library: typeof FEATURE_LIBRARY = FEATURE_LIBRARY,
): SequenceFeature[] {
  const sequence = normalizeSequence(doc.sequence);
  const length = sequence.length;
  if (length === 0) return [];

  const data = getAutomation(library);
  if (data.maxPatternLength === 0) return [];
  const circular = doc.topology === 'circular';
  const text = circular
    ? sequence + sequence.slice(0, Math.max(0, data.maxPatternLength - 1))
    : sequence;

  interface Candidate {
    libraryIndex: number;
    strand: Strand;
    start: number;
    exact: boolean;
  }
  const candidates = new Map<string, Candidate>();

  for (const match of data.automaton.search(text)) {
    const entry = data.automaton.entries[match.entryIndex];
    const start =
      entry.kind === 'full' ? match.start : match.start - entry.offset;
    if (start < 0 || start >= length) continue;
    const key = `${entry.libraryIndex}:${entry.strand}:${start}`;
    const existing = candidates.get(key);
    if (!existing || entry.kind === 'full') {
      candidates.set(key, {
        libraryIndex: entry.libraryIndex,
        strand: entry.strand,
        start,
        exact: entry.kind === 'full',
      });
    }
  }

  const ordered = [...candidates.values()].sort(
    (left, right) =>
      left.start - right.start ||
      library[left.libraryIndex].name.localeCompare(library[right.libraryIndex].name),
  );

  const discovered: SequenceFeature[] = [];
  for (const candidate of ordered) {
    const item = library[candidate.libraryIndex];
    const pattern = data.sequences[candidate.libraryIndex];
    if (!pattern) continue;

    if (
      !candidate.exact &&
      sequenceIdentity(sequence, pattern, candidate.start, circular) < 0.95
    ) {
      continue;
    }

    const end = annotatedFeatureEnd(
      candidate.start,
      pattern.length,
      length,
      circular,
    );
    if (!circular && end > length) continue;

    if (
      hasEquivalentAnnotation(
        doc.features,
        item.name,
        candidate.start,
        end,
        length,
      )
    ) {
      continue;
    }
    if (
      hasEquivalentAnnotation(
        discovered,
        item.name,
        candidate.start,
        end,
        length,
      )
    ) {
      continue;
    }

    const slug = item.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
    discovered.push({
      id: `auto-${slug}-${candidate.start}-${candidate.strand}-${discovered.length}`,
      name: item.name,
      type: item.type,
      start: candidate.start,
      end,
      strand: candidate.strand,
      color: item.color,
    });
  }

  return discovered;
}

// Build the default multi-pattern index once at module load so the first
// annotation request only pays for scanning, not for trie construction.
getAutomation(FEATURE_LIBRARY);
