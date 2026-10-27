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

export {
  COMMERCIAL_ENZYMES,
  ENZYME_DATABASE,
  ENZYME_SETS,
  filterEnzymes,
  findIsoschizomers,
  getEnzymeByName,
} from './enzymes';
export type { EnzymeSet } from './enzymes';
export { searchMotif } from './motif-search';
export type { MotifHit } from './motif-search';
export {
  CODON_USAGE,
  backTranslate,
  codonAdaptationIndex,
} from './codon-usage';
export type { CodonUsageOrganism } from './codon-usage';
export { FEATURE_LIBRARY };
export type { FeatureLibraryEntry };
export { FEATURE_LIBRARY_EXTRA } from './feature-library-extra';
export type { FeatureLibraryExtraEntry } from './feature-library-extra';
export {
  ENZYME_DIGEST_CONDITIONS,
  recommendDoubleDigestBuffer,
} from './digest-buffer';
export type {
  DoubleDigestRecommendation,
  EnzymeDigestCondition,
  NebBufferName,
} from './digest-buffer';

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

const BASE_CODE: Record<string, number> = {
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  U: 8,
};

const IUPAC_MASK: Record<string, number> = {
  A: 1, C: 2, G: 4, T: 8, U: 8,
  R: 5, Y: 10, S: 6, W: 9,
  K: 12, M: 3, B: 14, D: 13,
  H: 11, V: 7, N: 15,
};

const BASES_BY_MASK: Record<number, string> = {
  1: 'A', 2: 'C', 4: 'G', 8: 'T',
  3: 'AC', 5: 'AG', 6: 'CG', 9: 'AT',
  10: 'CT', 12: 'GT',
  7: 'ACG', 11: 'ACT', 13: 'AGT', 14: 'CGT',
  15: 'ACGT',
};

function expandIupacPattern(pattern: string, limit: number): string[] | null {
  let variants = [''];
  for (const letter of pattern) {
    const mask = IUPAC_MASK[letter];
    const bases = mask === undefined ? undefined : BASES_BY_MASK[mask];
    if (!bases || variants.length * bases.length > limit) return null;
    const next: string[] = [];
    for (const prefix of variants) {
      for (const base of bases) next.push(prefix + base);
    }
    variants = next;
  }
  return variants;
}

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

const TRANSLATION_BASE: Record<string, number> = {
  A: 0,
  C: 1,
  G: 2,
  T: 3,
};

const AMINO_ACID_CODE: Record<string, number> = {
  A: 0,
  C: 1,
  D: 2,
  E: 3,
  F: 4,
  G: 5,
  H: 6,
  I: 7,
  K: 8,
  L: 9,
  M: 10,
  N: 11,
  P: 12,
  Q: 13,
  R: 14,
  S: 15,
  T: 16,
  V: 17,
  W: 18,
  Y: 19,
};

const CODON_AMINO_ACID_CODE = new Int8Array(64).fill(-1);
for (const [codon, aminoAcid] of Object.entries(CODON_TABLE)) {
  const a = TRANSLATION_BASE[codon[0]];
  const c = TRANSLATION_BASE[codon[1]];
  const g = TRANSLATION_BASE[codon[2]];
  if (a === undefined || c === undefined || g === undefined) continue;
  const index = a * 16 + c * 4 + g;
  const code = AMINO_ACID_CODE[aminoAcid];
  if (code !== undefined) CODON_AMINO_ACID_CODE[index] = code;
}

function isPalindromic(sequence: string): boolean {
  return reverseComplement(sequence) === sequence;
}

function encodeSequence(sequence: string): Uint8Array {
  const encoded = new Uint8Array(sequence.length);
  for (let position = 0; position < sequence.length; position += 1) {
    encoded[position] = BASE_CODE[sequence[position]] ?? 0;
  }
  return encoded;
}

function findPatternPositions(
  sequence: string,
  pattern: string,
  encodedSequence?: Uint8Array,
): number[] {
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

  const masks = new Uint8Array(pattern.length);
  for (let index = 0; index < pattern.length; index += 1) {
    const mask = IUPAC_MASK[pattern[index]];
    if (mask === undefined) return [];
    masks[index] = mask;
  }

  if (pattern.length <= 31) {
    // Shift-And matching evaluates every IUPAC pattern against the whole
    // sequence with one bit-parallel pass, independent of the number of
    // degenerate positions in the pattern.
    const baseMasks = new Int32Array(16);
    for (let index = 0; index < masks.length; index += 1) {
      const bit = 1 << index;
      const mask = masks[index];
      if (mask & 1) baseMasks[1] |= bit;
      if (mask & 2) baseMasks[2] |= bit;
      if (mask & 4) baseMasks[4] |= bit;
      if (mask & 8) baseMasks[8] |= bit;
    }
    const highBit = 1 << (pattern.length - 1);
    const encoded = encodedSequence ?? encodeSequence(sequence);
    const positions: number[] = [];
    let state = 0;
    for (let position = 0; position < sequence.length; position += 1) {
      state = ((state << 1) | 1) & baseMasks[encoded[position]];
      if (state & highBit) positions.push(position - pattern.length + 1);
    }
    return positions;
  }

  const matchesAt = (start: number): boolean => {
    for (let offset = 0; offset < masks.length; offset += 1) {
      const code = BASE_CODE[sequence[start + offset]] ?? 0;
      if ((code & masks[offset]) === 0) return false;
    }
    return true;
  };
  const positions: number[] = [];
  for (let start = 0; start + pattern.length <= sequence.length; start += 1) {
    if (matchesAt(start)) positions.push(start);
  }
  return positions;
}

function extractSegment(
  sequence: string,
  circular: boolean,
  start: number,
  length: number,
): string {
  if (length <= 0) return '';
  const sequenceLength = sequence.length;
  if (circular) {
    const normalizedStart = mod(start, sequenceLength);
    const end = normalizedStart + length;
    if (end <= sequenceLength) return sequence.slice(normalizedStart, end);
    return (
      sequence.slice(normalizedStart) +
      sequence.slice(0, end - sequenceLength)
    );
  }
  if (start < 0 || start + length > sequenceLength) return '';
  return sequence.slice(start, start + length);
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
  enzymeIsDpnI: boolean,
  recognitionStart: number,
  recognitionLength: number,
  rawTop: number,
  rawBottom: number,
  masks: MethylationMasks,
  sequenceLength: number,
  circular: boolean,
): boolean {
  if (enzymeIsDpnI) {
    return !masks.profile.dam;
  }

  const sensitivity = enzyme.methylationSensitivity;
  if (!sensitivity) return false;

  const damBlocked = sensitivity.dam === 'blocked' && masks.profile.dam;
  const dcmBlocked = sensitivity.dcm === 'blocked' && masks.profile.dcm;
  const cpgBlocked = sensitivity.cpg === 'blocked' && masks.profile.cpg;
  if (!damBlocked && !dcmBlocked && !cpgBlocked) return false;

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

  if (damBlocked && overlap(masks.dam)) return true;
  if (dcmBlocked && overlap(masks.dcm)) return true;
  if (cpgBlocked && overlap(masks.cpg)) return true;
  return false;
}

function orderCutSites(sites: CutSite[], sequenceLength: number): CutSite[] {
  if (sites.length < 2) return sites;
  const counts = new Uint32Array(sequenceLength);
  for (const site of sites) counts[site.position] += 1;
  const starts = new Uint32Array(sequenceLength + 1);
  for (let position = 0; position < sequenceLength; position += 1) {
    starts[position + 1] = starts[position] + counts[position];
  }
  const cursors = starts.slice(0, sequenceLength);
  const ordered = new Array<CutSite>(sites.length);
  for (const site of sites) {
    ordered[cursors[site.position]] = site;
    cursors[site.position] += 1;
  }
  return ordered;
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
  // Generating sites in enzyme-name order lets a stable counting sort below
  // reproduce the historical position/name/strand ordering without comparing
  // every pair of cut sites.
  selected.sort((left, right) => left.name.localeCompare(right.name));

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
  const encodedScan = encodeSequence(scanSequence);
  const masks = buildMethylationMasks(
    sequence,
    circular,
    doc.methylationProfile,
  );

  // Isoschizomers and commercial aliases share recognition sequences, so the
  // scan is performed once per unique motif and reused by every enzyme.
  const patternCache = new Map<string, number[]>();
  const patterns = new Set<string>();
  for (const enzyme of selected) {
    const recognition = enzyme.recognitionSeq.toUpperCase();
    patterns.add(recognition);
    if (!isPalindromic(recognition)) {
      patterns.add(reverseComplement(recognition));
    }
  }

  // Motifs with a small IUPAC expansion share one Aho-Corasick pass. Highly
  // degenerate motifs fall back to the bit-parallel matcher.
  const automaton = new AnnotationAutomaton();
  const expandedPatterns: string[] = [];
  const entryPatterns: number[] = [];
  const fallbackPatterns: string[] = [];
  for (const pattern of patterns) {
    const variants = expandIupacPattern(pattern, 64);
    if (!variants) {
      fallbackPatterns.push(pattern);
      continue;
    }
    const patternIndex = expandedPatterns.length;
    expandedPatterns.push(pattern);
    for (const variant of variants) {
      entryPatterns.push(patternIndex);
      automaton.add(variant, {
        libraryIndex: patternIndex,
        strand: 1,
        kind: 'full',
        offset: 0,
      });
    }
  }

  if (expandedPatterns.length > 0) {
    automaton.build();
    const buckets = expandedPatterns.map(() => [] as number[]);
    for (const match of automaton.search(scanSequence)) {
      buckets[entryPatterns[match.entryIndex]].push(match.start);
    }
    for (let index = 0; index < expandedPatterns.length; index += 1) {
      patternCache.set(
        expandedPatterns[index],
        buckets[index].filter((position) => position < length),
      );
    }
  }

  for (const pattern of fallbackPatterns) {
    patternCache.set(
      pattern,
      findPatternPositions(scanSequence, pattern, encodedScan).filter(
        (position) => position < length,
      ),
    );
  }

  const positionsFor = (pattern: string): number[] =>
    patternCache.get(pattern) ?? [];

  const allSites: CutSite[] = [];

  for (const enzyme of selected) {
    const recognition = enzyme.recognitionSeq.toUpperCase();
    const recognitionLength = recognition.length;
    const enzymeIsDpnI = enzyme.name.toUpperCase() === 'DPNI';
    const sensitivity = enzyme.methylationSensitivity;
    const hasBlockingMethylation =
      enzymeIsDpnI ||
      (sensitivity !== undefined &&
        ((sensitivity.dam === 'blocked' && masks.profile.dam) ||
          (sensitivity.dcm === 'blocked' && masks.profile.dcm) ||
          (sensitivity.cpg === 'blocked' && masks.profile.cpg)));
    const firstSiteIndex = allSites.length;

    const cuts = [{ top: enzyme.cutIndexTop, bottom: enzyme.cutIndexBottom, suffix: '' }];
    if (enzyme.secondCut) cuts.push({ ...enzyme.secondCut, suffix: ':2' });

    const addPosition = (position: number, strand: Strand): void => {
      for (const cut of cuts) addCut(position, strand, cut.top, cut.bottom, cut.suffix);
    };

    const addCut = (position: number, strand: Strand, cutTop: number, cutBottom: number, suffix: string): void => {
      const rawTop =
        strand === 1
          ? position + cutTop
          : position + recognitionLength - cutBottom;
      const rawBottom =
        strand === 1
          ? position + cutBottom
          : position + recognitionLength - cutTop;

      if (
        !circular &&
        (rawTop < 0 || rawTop > length || rawBottom < 0 || rawBottom > length)
      ) {
        return;
      }

      const difference = rawBottom - rawTop;
      const overhangType: CutSite['overhangType'] =
        difference === 0 ? 'blunt' : difference > 0 ? '5-prime' : '3-prime';
      const overhangSeq =
        difference === 0
          ? ''
          : extractSegment(
              sequence,
              circular,
              Math.min(rawTop, rawBottom),
              Math.abs(difference),
            );
      allSites.push({
        id: `${enzyme.name}:${position}:${strand}${suffix}`,
        enzyme,
        position,
        strand,
        cutPositionTop: circular ? mod(rawTop, length) : rawTop,
        cutPositionBottom: circular ? mod(rawBottom, length) : rawBottom,
        overhangType,
        overhangSeq,
        isMethylationBlocked: hasBlockingMethylation
          ? isMethylationBlocked(
              enzyme,
              enzymeIsDpnI,
              position,
              recognitionLength,
              rawTop,
              rawBottom,
              masks,
              length,
              circular,
            )
          : false,
        totalCutsInPlasmid: 0,
      });
    };

    for (const position of positionsFor(recognition)) {
      addPosition(position, 1);
    }

    if (!isPalindromic(recognition)) {
      const reverseRecognition = reverseComplement(recognition);
      for (const position of positionsFor(reverseRecognition)) {
        addPosition(position, -1);
      }
    }

    const enzymeCutCount = allSites.length - firstSiteIndex;
    for (let index = firstSiteIndex; index < allSites.length; index += 1) {
      allSites[index].totalCutsInPlasmid = enzymeCutCount;
    }
  }

  let result = allSites;
  if (filter.uniqueOnly) {
    result = result.filter((site) => site.totalCutsInPlasmid === 1);
  }
  if (filter.excludeMethylationBlocked) {
    result = result.filter((site) => !site.isMethylationBlocked);
  }

  return orderCutSites(result, length);
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

const AMINO_ACID_PATTERN = /^[ACDEFGHIKLMNPQRSTVWY]+$/;

interface ProteinAutomationEntry {
  libraryIndex: number;
  strand: Strand;
  kind: 'full' | 'seed';
  offset: number;
  patternLength: number;
}

interface ProteinAutomatonNode {
  next: Int32Array;
  fail: number;
  outputs: number[];
}

function createProteinNode(): ProteinAutomatonNode {
  return { next: new Int32Array(20).fill(-1), fail: 0, outputs: [] };
}

// Amino-acid automaton used to find protein seeds in the six translated
// frames of a query. It mirrors the nucleotide automaton but uses the
// twenty standard residues; ambiguous residues reset the current state.
class ProteinAnnotationAutomaton {
  private readonly nodes: ProteinAutomatonNode[] = [createProteinNode()];

  readonly entries: ProteinAutomationEntry[] = [];

  add(
    pattern: string,
    entry: Omit<ProteinAutomationEntry, 'patternLength'>,
  ): void {
    if (!pattern || !AMINO_ACID_PATTERN.test(pattern)) return;
    let state = 0;
    for (const letter of pattern) {
      const code = AMINO_ACID_CODE[letter];
      if (code === undefined) continue;
      let next = this.nodes[state].next[code];
      if (next === -1) {
        next = this.nodes.length;
        this.nodes.push(createProteinNode());
        this.nodes[state].next[code] = next;
      }
      state = next;
    }
    this.entries.push({ ...entry, patternLength: pattern.length });
    this.nodes[state].outputs.push(this.entries.length - 1);
  }

  build(): void {
    const queue: number[] = [];
    for (let code = 0; code < 20; code += 1) {
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
      for (let code = 0; code < 20; code += 1) {
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
      const code = AMINO_ACID_CODE[text[index]];
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

  searchCodons(
    sequence: string,
    frame: number,
  ): Array<{ entryIndex: number; start: number }> {
    const results: Array<{ entryIndex: number; start: number }> = [];
    let state = 0;
    const length = Math.max(0, Math.floor((sequence.length - frame) / 3));
    for (let index = 0; index < length; index += 1) {
      const offset = frame + index * 3;
      const a = TRANSLATION_BASE[sequence[offset]];
      const c = TRANSLATION_BASE[sequence[offset + 1]];
      const g = TRANSLATION_BASE[sequence[offset + 2]];
      const code =
        a === undefined || c === undefined || g === undefined
          ? -1
          : CODON_AMINO_ACID_CODE[a * 16 + c * 4 + g];
      if (code < 0) {
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

interface ProteinAutomationData {
  automaton: ProteinAnnotationAutomaton;
  proteins: string[];
  maxProteinLength: number;
}

const PROTEIN_AUTOMATA = new WeakMap<object, ProteinAutomationData>();
const LIBRARY_PROTEIN_CACHE = new WeakMap<object, string>();

function libraryProtein(entry: FeatureLibraryEntry): string {
  const cached = LIBRARY_PROTEIN_CACHE.get(entry);
  if (cached !== undefined) return cached;
  const proteinTagNames =
    /(?:\bHis\b|6xHis|FLAG|\bHA\b|Myc|\bV5\b|Strep|S-Tag|E-Tag|TEV|PreScission|Thrombin|Factor Xa|Enterokinase|\bNLS\b|2A peptide|\bP2A\b|\bT2A\b|\bE2A\b|\bF2A\b)/i;
  const isCoding =
    entry.type === 'CDS' ||
    (entry.type === 'misc_feature' && proteinTagNames.test(entry.name));
  if (!isCoding) {
    LIBRARY_PROTEIN_CACHE.set(entry, '');
    return '';
  }
  const sequence = (entry.sequence ?? '').toUpperCase();
  if (sequence.length < 15 || sequence.length % 3 !== 0) {
    LIBRARY_PROTEIN_CACHE.set(entry, '');
    return '';
  }
  const translated = translateDna(sequence);
  const protein = translated.endsWith('*')
    ? translated.slice(0, -1)
    : translated;
  if (
    protein.length < 5 ||
    protein.includes('*') ||
    !AMINO_ACID_PATTERN.test(protein)
  ) {
    LIBRARY_PROTEIN_CACHE.set(entry, '');
    return '';
  }
  LIBRARY_PROTEIN_CACHE.set(entry, protein);
  return protein;
}

function buildProteinAutomation(
  library: FeatureLibraryEntry[],
): ProteinAutomationData {
  const automaton = new ProteinAnnotationAutomaton();
  const proteins: string[] = [];
  let maxProteinLength = 0;

  const addSeeds = (
    protein: string,
    libraryIndex: number,
    strand: Strand,
  ): void => {
    if (protein.length <= 8) {
      automaton.add(protein, {
        libraryIndex,
        strand,
        kind: 'full',
        offset: 0,
      });
      return;
    }
    if (protein.length <= 60) {
      automaton.add(protein, {
        libraryIndex,
        strand,
        kind: 'full',
        offset: 0,
      });
    }
    const seedLength = protein.length < 30 ? 5 : 6;
    const count = protein.length < 30 ? 3 : protein.length < 60 ? 3 : 5;
    const available = protein.length - seedLength;
    if (available < 0) return;
    const offsets =
      count === 3
        ? [0, Math.floor(available / 2), available]
        : [
            0,
            Math.floor(available / 4),
            Math.floor(available / 2),
            Math.floor((3 * available) / 4),
            available,
          ];
    const uniqueOffsets = [...new Set(offsets)].filter(
      (offset) => offset >= 0 && offset + seedLength <= protein.length,
    );
    for (const offset of uniqueOffsets) {
      automaton.add(protein.slice(offset, offset + seedLength), {
        libraryIndex,
        strand,
        kind: 'seed',
        offset,
      });
    }
  };

  for (let index = 0; index < library.length; index += 1) {
    const protein = libraryProtein(library[index]);
    proteins.push(protein);
    if (!protein) continue;
    maxProteinLength = Math.max(maxProteinLength, protein.length);
    addSeeds(protein, index, 1);
    // The same coding protein can be present on either strand; the search
    // translates the reverse complement separately, so only one protein
    // pattern set is required.
  }

  automaton.build();
  return { automaton, proteins, maxProteinLength };
}

function getProteinAutomation(
  library: FeatureLibraryEntry[],
): ProteinAutomationData {
  const cached = PROTEIN_AUTOMATA.get(library);
  if (cached) return cached;
  const built = buildProteinAutomation(library);
  PROTEIN_AUTOMATA.set(library, built);
  return built;
}

function proteinIdentity(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let matches = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) matches += 1;
  }
  return matches / length;
}

interface AutomationData {
  automaton: AnnotationAutomaton;
  sequences: string[];
  maxPatternLength: number;
}

const AUTOMATA = new WeakMap<object, AutomationData>();

const MIN_ANNOTATION_PATTERN_LENGTH = 12;

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
    // Very short motifs (Kozak, Shine-Dalgarno, restriction half-sites) are
    // useful as library entries but too ambiguous for genome-wide marking.
    if (
      sequence.length < MIN_ANNOTATION_PATTERN_LENGTH ||
      !/^[ACGT]+$/.test(sequence)
    ) {
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

interface AnnotationCandidate {
  libraryIndex: number;
  strand: Strand;
  start: number;
  end: number;
  exact: boolean;
  identity: number;
  patternLength: number;
  source: 'dna' | 'protein';
}

const MIN_ANNOTATION_IDENTITY = 0.95;
const SIMILAR_ELEMENT_OVERLAP = 0.6;
const SIMILAR_ELEMENT_LENGTH_RATIO = 0.9;
const SIMILAR_ELEMENT_IDENTITY = 0.9;

function patternIdentity(
  left: string,
  right: string,
  sameOrientation: boolean,
): number {
  const oriented = sameOrientation ? right : reverseComplement(right);
  const length = Math.min(left.length, oriented.length);
  if (length === 0) return 0;
  let matches = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] === oriented[index]) matches += 1;
  }
  return matches / length;
}

function annotationsOverlapEnough(
  left: AnnotationCandidate,
  right: AnnotationCandidate,
  sequenceLength: number,
): boolean {
  const leftLength = rangeLength(left.start, left.end, sequenceLength);
  const rightLength = rangeLength(right.start, right.end, sequenceLength);
  const shorter = Math.min(leftLength, rightLength);
  if (shorter <= 0) return false;
  const overlap = overlapLength(
    left.start,
    left.end,
    right.start,
    right.end,
    sequenceLength,
  );
  return overlap >= SIMILAR_ELEMENT_OVERLAP * shorter;
}

function representsSameElement(
  left: AnnotationCandidate,
  right: AnnotationCandidate,
  library: FeatureLibraryEntry[],
): boolean {
  const leftEntry = library[left.libraryIndex];
  const rightEntry = library[right.libraryIndex];
  if (left.libraryIndex === right.libraryIndex) return true;
  if (
    leftEntry.name.trim().toLowerCase() ===
    rightEntry.name.trim().toLowerCase()
  ) {
    return true;
  }
  if (leftEntry.group && leftEntry.group === rightEntry.group) return true;
  if (leftEntry.type !== rightEntry.type) return false;

  const leftLength = leftEntry.sequence.length;
  const rightLength = rightEntry.sequence.length;
  const lengthRatio =
    Math.min(leftLength, rightLength) / Math.max(leftLength, rightLength);
  if (!Number.isFinite(lengthRatio) || lengthRatio < SIMILAR_ELEMENT_LENGTH_RATIO) {
    return false;
  }
  const dnaIdentity = patternIdentity(
    leftEntry.sequence,
    rightEntry.sequence,
    left.strand === right.strand,
  );
  if (dnaIdentity >= SIMILAR_ELEMENT_IDENTITY) return true;

  // Codon-optimised coding sequences can share almost no nucleotides while
  // encoding the same protein. Treat those as the same element as well.
  const leftProtein = libraryProtein(leftEntry);
  const rightProtein = libraryProtein(rightEntry);
  if (!leftProtein || !rightProtein) return false;
  const proteinLengthRatio =
    Math.min(leftProtein.length, rightProtein.length) /
    Math.max(leftProtein.length, rightProtein.length);
  return (
    proteinLengthRatio >= SIMILAR_ELEMENT_LENGTH_RATIO &&
    proteinIdentity(leftProtein, rightProtein) >= SIMILAR_ELEMENT_IDENTITY
  );
}

export function autoAnnotateFeatures(
  doc: PlasmidDocument,
  library: typeof FEATURE_LIBRARY = FEATURE_LIBRARY,
): SequenceFeature[] {
  const sequence = normalizeSequence(doc.sequence);
  const length = sequence.length;
  if (length === 0) return [];

  const data = getAutomation(library);
  const proteinData = getProteinAutomation(library);
  if (data.maxPatternLength === 0 && proteinData.maxProteinLength === 0) {
    return [];
  }
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

  interface ProteinCandidate {
    libraryIndex: number;
    strand: Strand;
    start: number;
    end: number;
    identity: number;
    patternLength: number;
  }
  const proteinCandidates = new Map<string, ProteinCandidate>();

  if (proteinData.maxProteinLength > 0) {
    const extraNt = circular ? proteinData.maxProteinLength * 3 : 0;
    const forwardText = circular
      ? sequence + sequence.slice(0, Math.min(length, extraNt))
      : sequence;
    const reverseText = reverseComplement(forwardText);

    const scanFrames = (textValue: string, strand: Strand): void => {
      for (let frame = 0; frame < 3; frame += 1) {
        for (const match of proteinData.automaton.searchCodons(textValue, frame)) {
          const entry = proteinData.automaton.entries[match.entryIndex];
          const aminoAcidStart = match.start - entry.offset;
          if (aminoAcidStart < 0) continue;
          const orientedStart = frame + aminoAcidStart * 3;
          if (orientedStart < 0 || orientedStart >= length) continue;

          const protein = proteinData.proteins[entry.libraryIndex];
          if (!protein) continue;
          const codingLength = protein.length * 3;
          const translated = translateDna(
            textValue.slice(orientedStart, orientedStart + codingLength),
          );
          if (translated.length < protein.length) continue;

          let matches = 0;
          for (let index = 0; index < protein.length; index += 1) {
            if (translated[index] === protein[index]) matches += 1;
          }
          const aminoAcidIdentity = matches / protein.length;
          const threshold = protein.length < 10 ? 1 : 0.9;
          if (aminoAcidIdentity < threshold) continue;

          let orientedEnd = orientedStart + codingLength;
          if (
            STOP_CODONS.has(
              textValue.slice(orientedEnd, orientedEnd + 3),
            )
          ) {
            orientedEnd += 3;
          }
          if (orientedEnd > textValue.length) continue;

          let start: number;
          let end: number;
          if (strand === 1) {
            start = orientedStart;
            end = orientedEnd;
          } else {
            start = length - orientedEnd;
            end = length - orientedStart;
          }
          if (circular) {
            start = mod(start, length);
            end = mod(end, length);
            if (start === end) continue;
          } else if (start < 0 || end > length || start >= end) {
            continue;
          }

          const key = `${entry.libraryIndex}:${strand}:${start}`;
          if (candidates.has(key)) continue;
          const existing = proteinCandidates.get(key);
          if (!existing || aminoAcidIdentity > existing.identity) {
            proteinCandidates.set(key, {
              libraryIndex: entry.libraryIndex,
              strand,
              start,
              end,
              identity: 0.9 + 0.099 * aminoAcidIdentity,
              patternLength: codingLength,
            });
          }
        }
      }
    };

    scanFrames(forwardText, 1);
    scanFrames(reverseText, -1);
  }

  const scored: AnnotationCandidate[] = [];
  for (const candidate of candidates.values()) {
    const pattern = data.sequences[candidate.libraryIndex];
    if (!pattern) continue;

    const identity = candidate.exact
      ? 1
      : sequenceIdentity(sequence, pattern, candidate.start, circular);
    if (identity < MIN_ANNOTATION_IDENTITY) continue;

    const end = annotatedFeatureEnd(
      candidate.start,
      pattern.length,
      length,
      circular,
    );
    if (!circular && end > length) continue;

    scored.push({
      libraryIndex: candidate.libraryIndex,
      strand: candidate.strand,
      start: candidate.start,
      end,
      exact: candidate.exact,
      identity,
      patternLength: pattern.length,
      source: 'dna',
    });
  }

  for (const candidate of proteinCandidates.values()) {
    scored.push({
      libraryIndex: candidate.libraryIndex,
      strand: candidate.strand,
      start: candidate.start,
      end: candidate.end,
      exact: false,
      identity: candidate.identity,
      patternLength: candidate.patternLength,
      source: 'protein',
    });
  }

  // Higher identity wins first, exact hits ahead of tolerated mismatches, so a
  // wild-type element is never displaced by a close mutant allele. Protein
  // matches score just below exact DNA hits but above tolerated DNA matches.
  scored.sort(
    (left, right) =>
      right.identity - left.identity ||
      Number(right.exact) - Number(left.exact) ||
      Number(right.source === 'dna') - Number(left.source === 'dna') ||
      right.patternLength - left.patternLength ||
      left.start - right.start ||
      library[left.libraryIndex].name.localeCompare(
        library[right.libraryIndex].name,
      ),
  );

  const selected: AnnotationCandidate[] = [];
  for (const candidate of scored) {
    const item = library[candidate.libraryIndex];
    if (
      hasEquivalentAnnotation(
        doc.features,
        item.name,
        candidate.start,
        candidate.end,
        length,
      )
    ) {
      continue;
    }

    let conflicts = false;
    for (const other of selected) {
      if (!annotationsOverlapEnough(candidate, other, length)) continue;
      if (representsSameElement(candidate, other, library)) {
        conflicts = true;
        break;
      }
    }
    if (conflicts) continue;
    selected.push(candidate);
  }

  selected.sort(
    (left, right) =>
      left.start - right.start ||
      library[left.libraryIndex].name.localeCompare(
        library[right.libraryIndex].name,
      ),
  );

  return selected.map((candidate, index) => {
    const item = library[candidate.libraryIndex];
    const slug = item.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
    return {
      id: `auto-${slug}-${candidate.start}-${candidate.strand}-${index}`,
      name: item.name,
      type: item.type,
      start: candidate.start,
      end: candidate.end,
      strand: candidate.strand,
      color: item.color,
    };
  });
}

// Build the default multi-pattern indexes once at module load so the first
// annotation request only pays for scanning, not for trie construction.
getAutomation(FEATURE_LIBRARY);
getProteinAutomation(FEATURE_LIBRARY);
