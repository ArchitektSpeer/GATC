// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import type { PlasmidDocument, SangerTraceData } from '../../types/schema';
import { reverseComplement } from './genetics';

export interface SequencingRead {
  id: string;
  name: string;
  sequence: string;
  qualities: number[];
}

export interface ReadMismatch {
  refIndex: number;
  refBase: string;
  readBase: string;
}

export interface ReadAlignment {
  readId: string;
  aligned: boolean;
  refStart: number;
  refEnd: number;
  strand: 1 | -1;
  identityPercent: number;
  mismatches: ReadMismatch[];
}

export interface ReadAlignmentOptions {
  minIdentity?: number;
  maxReads?: number;
}

interface SeedCandidate {
  start: number;
  votes: number;
}

interface RawMismatch {
  refPos: number;
  refBase: string;
  readBase: string;
}

interface BandedAlignment {
  score: number;
  start: number;
  end: number;
  identityPercent: number;
  mismatches: RawMismatch[];
  touchesEdge: boolean;
}

interface EvaluatedAlignment {
  score: number;
  identityPercent: number;
  strand: 1 | -1;
  refStart: number;
  refEnd: number;
  mismatches: ReadMismatch[];
}

const MATCH_SCORE = 2;
const MISMATCH_SCORE = -1;
const GAP_OPEN = -4;
const GAP_EXTEND = -1;
const NEGATIVE_INFINITY = -1e9;
const DEFAULT_MIN_IDENTITY = 80;
const DEFAULT_KMER = 12;
const MAX_KMER_HITS = 32;
const MAX_SEED_CANDIDATES = 3;
const SEED_BUDGET = 24;

function modulo(value: number, length: number): number {
  if (length <= 0) return 0;
  return ((value % length) + length) % length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function baseCode(character: string): number {
  switch (character) {
    case 'A':
      return 0;
    case 'C':
      return 1;
    case 'G':
      return 2;
    case 'T':
      return 3;
    default:
      return -1;
  }
}

function encodeKmer(sequence: string, position: number, kmerLength: number): number {
  let code = 0;
  for (let offset = 0; offset < kmerLength; offset += 1) {
    const value = baseCode(sequence[position + offset]);
    if (value < 0) return -1;
    code = code * 4 + value;
  }
  return code;
}

function buildKmerIndex(sequence: string, kmerLength: number): Map<number, number[]> {
  const index = new Map<number, number[]>();
  const limit = sequence.length - kmerLength;
  for (let position = 0; position <= limit; position += 1) {
    const code = encodeKmer(sequence, position, kmerLength);
    if (code < 0) continue;
    const hits = index.get(code);
    if (!hits) {
      index.set(code, [position]);
    } else if (hits.length < MAX_KMER_HITS) {
      hits.push(position);
    }
  }
  return index;
}

function substitutionScore(referenceBase: string, readBase: string): number {
  const referenceCode = baseCode(referenceBase);
  const readCode = baseCode(readBase);
  if (referenceCode < 0 || readCode < 0) return 0;
  return referenceCode === readCode ? MATCH_SCORE : MISMATCH_SCORE;
}

function collectSeedCandidates(
  query: string,
  index: Map<number, number[]>,
  kmerLength: number,
  referenceLength: number,
  circular: boolean
): SeedCandidate[] {
  const queryLength = query.length;
  if (queryLength < kmerLength) return [];
  const lastPosition = queryLength - kmerLength;
  const step = Math.max(1, Math.ceil((lastPosition + 1) / SEED_BUDGET));
  const positions: number[] = [];
  for (let position = 0; position <= lastPosition; position += step) {
    positions.push(position);
  }
  if (positions[positions.length - 1] !== lastPosition) positions.push(lastPosition);

  const votes = new Map<number, number>();
  for (const queryPosition of positions) {
    const code = encodeKmer(query, queryPosition, kmerLength);
    if (code < 0) continue;
    const hits = index.get(code);
    if (!hits) continue;
    for (const referencePosition of hits) {
      let start = referencePosition - queryPosition;
      if (circular) {
        start = modulo(start, referenceLength);
      } else if (start < 0 || start > referenceLength - 1) {
        continue;
      }
      votes.set(start, (votes.get(start) ?? 0) + 1);
    }
  }

  const candidates: SeedCandidate[] = [];
  for (const [start, count] of votes) candidates.push({ start, votes: count });
  candidates.sort(
    (left, right) => right.votes - left.votes || left.start - right.start
  );
  return candidates.slice(0, MAX_SEED_CANDIDATES);
}

/**
 * Semiglobal affine-gap alignment inside a diagonal band. The read is aligned
 * end-to-end while the reference window may lose arbitrary prefixes and
 * suffixes. `guide` is the expected j - i diagonal of the read start.
 */
function bandedSemiglobal(
  target: string,
  query: string,
  guide: number,
  band: number,
  windowStart: number
): BandedAlignment | null {
  const targetLength = target.length;
  const queryLength = query.length;
  if (targetLength === 0 || queryLength === 0) return null;

  const lowerOffset = guide - band;
  const upperOffset = guide + band;
  const width = upperOffset - lowerOffset + 1;
  const cells = (queryLength + 1) * width;
  const pointers = new Uint8Array(cells);

  let previousM = new Float64Array(width).fill(NEGATIVE_INFINITY);
  let previousX = new Float64Array(width).fill(NEGATIVE_INFINITY);
  let previousY = new Float64Array(width).fill(NEGATIVE_INFINITY);
  let currentM = new Float64Array(width);
  let currentX = new Float64Array(width);
  let currentY = new Float64Array(width);

  for (let offset = lowerOffset; offset <= upperOffset; offset += 1) {
    const column = offset;
    if (column < 0 || column > targetLength) continue;
    previousM[offset - lowerOffset] = 0;
  }

  for (let row = 1; row <= queryLength; row += 1) {
    currentM.fill(NEGATIVE_INFINITY);
    currentX.fill(NEGATIVE_INFINITY);
    currentY.fill(NEGATIVE_INFINITY);
    const readBase = query[row - 1];
    const lowest = Math.max(lowerOffset, -row);
    const highest = Math.min(upperOffset, targetLength - row);
    const rowBase = row * width;

    for (let offset = lowest; offset <= highest; offset += 1) {
      const index = offset - lowerOffset;
      const column = row + offset;

      let matchValue = NEGATIVE_INFINITY;
      let matchPointer = 0;
      if (column >= 1) {
        let diagonal = previousM[index];
        let diagonalPointer = 1;
        if (previousX[index] > diagonal) {
          diagonal = previousX[index];
          diagonalPointer = 2;
        }
        if (previousY[index] > diagonal) {
          diagonal = previousY[index];
          diagonalPointer = 3;
        }
        if (diagonal > NEGATIVE_INFINITY / 2) {
          matchValue =
            diagonal + substitutionScore(target[column - 1], readBase);
          matchPointer = diagonalPointer;
        }
      }

      let gapInTarget = NEGATIVE_INFINITY;
      let gapInTargetPointer = 0;
      if (index + 1 < width) {
        gapInTarget = previousM[index + 1] + GAP_OPEN;
        gapInTargetPointer = 1;
        if (previousX[index + 1] + GAP_EXTEND > gapInTarget) {
          gapInTarget = previousX[index + 1] + GAP_EXTEND;
          gapInTargetPointer = 2;
        }
        if (previousY[index + 1] + GAP_OPEN > gapInTarget) {
          gapInTarget = previousY[index + 1] + GAP_OPEN;
          gapInTargetPointer = 3;
        }
        if (gapInTarget < NEGATIVE_INFINITY / 2) gapInTargetPointer = 0;
      }

      let gapInQuery = NEGATIVE_INFINITY;
      let gapInQueryPointer = 0;
      if (column >= 1 && index >= 1) {
        gapInQuery = currentM[index - 1] + GAP_OPEN;
        gapInQueryPointer = 1;
        if (currentY[index - 1] + GAP_EXTEND > gapInQuery) {
          gapInQuery = currentY[index - 1] + GAP_EXTEND;
          gapInQueryPointer = 3;
        }
        if (currentX[index - 1] + GAP_OPEN > gapInQuery) {
          gapInQuery = currentX[index - 1] + GAP_OPEN;
          gapInQueryPointer = 2;
        }
        if (gapInQuery < NEGATIVE_INFINITY / 2) gapInQueryPointer = 0;
      }

      currentM[index] = matchValue;
      currentX[index] = gapInTarget;
      currentY[index] = gapInQuery;
      pointers[rowBase + index] =
        matchPointer | (gapInTargetPointer << 2) | (gapInQueryPointer << 4);
    }

    const swapM = previousM;
    previousM = currentM;
    currentM = swapM;
    const swapX = previousX;
    previousX = currentX;
    currentX = swapX;
    const swapY = previousY;
    previousY = currentY;
    currentY = swapY;
  }

  const lowestEnd = Math.max(lowerOffset, -queryLength);
  const highestEnd = Math.min(upperOffset, targetLength - queryLength);
  if (lowestEnd > highestEnd) return null;

  let bestScore = NEGATIVE_INFINITY;
  let bestColumn = -1;
  let bestState = 1;
  const expectedColumn = guide + queryLength;
  for (let offset = lowestEnd; offset <= highestEnd; offset += 1) {
    const index = offset - lowerOffset;
    const column = queryLength + offset;
    const candidates: Array<[number, number]> = [
      [previousM[index], 1],
      [previousX[index], 2],
      [previousY[index], 3]
    ];
    for (const [score, state] of candidates) {
      if (score < NEGATIVE_INFINITY / 2) continue;
      const sameScore = Math.abs(score - bestScore) <= 1e-9;
      const closer =
        Math.abs(column - expectedColumn) < Math.abs(bestColumn - expectedColumn);
      if (
        score > bestScore + 1e-9 ||
        (sameScore &&
          (bestColumn < 0 ||
            state < bestState ||
            (state === bestState && closer)))
      ) {
        bestScore = score;
        bestColumn = column;
        bestState = state;
      }
    }
  }
  if (bestColumn < 0 || bestScore < NEGATIVE_INFINITY / 2) return null;

  const referencePieces: string[] = [];
  const readPieces: string[] = [];
  const mismatches: RawMismatch[] = [];
  let touchesEdge = false;
  let row = queryLength;
  let column = bestColumn;
  let state = bestState;

  while (row > 0) {
    const offset = column - row;
    const index = offset - lowerOffset;
    if (index < 0 || index >= width) return null;
    if (index === 0 || index === width - 1) touchesEdge = true;
    const packed = pointers[row * width + index];

    if (state === 1) {
      if (column < 1) return null;
      const referenceBase = target[column - 1];
      const readBase = query[row - 1];
      referencePieces.push(referenceBase);
      readPieces.push(readBase);
      if (referenceBase !== readBase) {
        mismatches.push({
          refPos: windowStart + column - 1,
          refBase: referenceBase,
          readBase
        });
      }
      state = (packed & 3) || 1;
      row -= 1;
      column -= 1;
    } else if (state === 2) {
      referencePieces.push('-');
      readPieces.push(query[row - 1]);
      mismatches.push({
        refPos: windowStart + column,
        refBase: '-',
        readBase: query[row - 1]
      });
      state = ((packed >> 2) & 3) || 1;
      row -= 1;
    } else {
      if (column < 1) return null;
      const referenceBase = target[column - 1];
      referencePieces.push(referenceBase);
      readPieces.push('-');
      mismatches.push({
        refPos: windowStart + column - 1,
        refBase: referenceBase,
        readBase: '-'
      });
      state = ((packed >> 4) & 3) || 1;
      column -= 1;
    }
  }

  referencePieces.reverse();
  readPieces.reverse();
  mismatches.reverse();
  const compared = referencePieces.length;
  if (compared === 0) return null;
  const matches = compared - mismatches.length;

  return {
    score: bestScore,
    start: column,
    end: bestColumn,
    identityPercent: (matches / compared) * 100,
    mismatches,
    touchesEdge
  };
}

function quickDiagonalIdentity(
  target: string,
  query: string,
  guide: number
): number {
  let matches = 0;
  let compared = 0;
  for (let index = 0; index < query.length; index += 1) {
    const column = guide + index;
    if (column < 0 || column >= target.length) continue;
    compared += 1;
    if (target[column] === query[index]) matches += 1;
  }
  return compared > 0 ? (matches / compared) * 100 : 0;
}

function kmerLengthsFor(readLength: number): number[] {
  const primary = Math.min(DEFAULT_KMER, Math.max(1, readLength));
  const lengths: number[] = [primary];
  for (const reduction of [4, 8]) {
    const candidate = Math.max(1, primary - reduction);
    if (!lengths.includes(candidate)) lengths.push(candidate);
  }
  if (!lengths.includes(4) && readLength >= 4) lengths.push(4);
  return lengths;
}

function alignOneStrand(
  query: string,
  strand: 1 | -1,
  searchReference: string,
  referenceLength: number,
  circular: boolean,
  indexCache: Map<number, Map<number, number[]>>
): EvaluatedAlignment | null {
  const readLength = query.length;
  const lengths = kmerLengthsFor(readLength);
  let best: EvaluatedAlignment | null = null;

  for (const kmerLength of lengths) {
    let index = indexCache.get(kmerLength);
    if (!index) {
      index = buildKmerIndex(searchReference, kmerLength);
      indexCache.set(kmerLength, index);
    }
    const candidates = collectSeedCandidates(
      query,
      index,
      kmerLength,
      referenceLength,
      circular
    );
    if (candidates.length === 0) continue;

    const margin = Math.max(12, Math.ceil(readLength * 0.1));
    for (const candidate of candidates) {
      const absoluteStart = candidate.start;
      const windowStart = Math.max(0, absoluteStart - margin);
      const windowEnd = Math.min(
        searchReference.length,
        absoluteStart + readLength + margin
      );
      if (windowEnd <= windowStart) continue;
      const target = searchReference.slice(windowStart, windowEnd);
      const guide = absoluteStart - windowStart;
      if (readLength >= 20 && quickDiagonalIdentity(target, query, guide) < 35) {
        continue;
      }

      let band = Math.max(12, Math.ceil(readLength * 0.1));
      const maximumBand = readLength + margin + 1;
      let alignment: BandedAlignment | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        alignment = bandedSemiglobal(target, query, guide, band, windowStart);
        if (!alignment || !alignment.touchesEdge) break;
        if (alignment.identityPercent < 50) break;
        if (band >= maximumBand) break;
        band = Math.min(maximumBand, band * 2);
      }
      if (!alignment) continue;

      const absoluteAlignmentStart = windowStart + alignment.start;
      const absoluteAlignmentEnd = windowStart + alignment.end;
      const refStart = circular
        ? modulo(absoluteAlignmentStart, referenceLength)
        : clamp(absoluteAlignmentStart, 0, referenceLength);
      const refEnd = circular
        ? modulo(absoluteAlignmentEnd, referenceLength)
        : clamp(absoluteAlignmentEnd, 0, referenceLength);
      const mismatches: ReadMismatch[] = alignment.mismatches.map(item => {
        const refIndex = circular
          ? modulo(item.refPos, referenceLength)
          : clamp(item.refPos, 0, Math.max(0, referenceLength - 1));
        return {
          refIndex,
          refBase: item.refBase,
          readBase: item.readBase
        };
      });

      const evaluated: EvaluatedAlignment = {
        score: alignment.score,
        identityPercent: Math.round(alignment.identityPercent * 1000) / 1000,
        strand,
        refStart,
        refEnd,
        mismatches
      };
      if (
        !best ||
        evaluated.score > best.score + 1e-9 ||
        (Math.abs(evaluated.score - best.score) <= 1e-9 &&
          evaluated.identityPercent > best.identityPercent)
      ) {
        best = evaluated;
      }
    }
    if (best && best.identityPercent >= 80) return best;
  }

  return best;
}

/**
 * Aligns FASTQ reads to a plasmid reference using k-mer seeds followed by a
 * banded affine-gap alignment. Both strands are evaluated and circular
 * references are searched as a doubled sequence so reads crossing the origin
 * obtain wrapped coordinates (`refStart > refEnd`).
 */
export function alignReadsToReference(
  reads: SequencingRead[],
  ref: PlasmidDocument,
  opts: ReadAlignmentOptions = {}
): ReadAlignment[] {
  const reference = (ref.sequence ?? '').toUpperCase();
  const referenceLength = reference.length;
  const circular = ref.topology === 'circular';

  let selectedReads = reads;
  if (Number.isFinite(opts.maxReads)) {
    const limit = Math.max(0, Math.floor(opts.maxReads as number));
    selectedReads = reads.slice(0, limit);
  }

  const requestedIdentity = Number.isFinite(opts.minIdentity)
    ? (opts.minIdentity as number)
    : DEFAULT_MIN_IDENTITY;
  // Accept either a fraction (0..1) or a percentage (0..100).
  const minimumIdentity = clamp(
    requestedIdentity <= 1 ? requestedIdentity * 100 : requestedIdentity,
    0,
    100
  );

  if (referenceLength === 0) {
    return selectedReads.map(read => ({
      readId: read.id,
      aligned: false,
      refStart: 0,
      refEnd: 0,
      strand: 1,
      identityPercent: 0,
      mismatches: []
    }));
  }

  const searchReference = circular ? `${reference}${reference}` : reference;
  const indexCache = new Map<number, Map<number, number[]>>();

  return selectedReads.map(read => {
    const sequence = (read.sequence ?? '').toUpperCase();

    const unaligned: ReadAlignment = {
      readId: read.id,
      aligned: false,
      refStart: 0,
      refEnd: 0,
      strand: 1,
      identityPercent: 0,
      mismatches: []
    };
    if (sequence.length === 0) return unaligned;

    let best: EvaluatedAlignment | null = null;
    const forward = alignOneStrand(
      sequence,
      1,
      searchReference,
      referenceLength,
      circular,
      indexCache
    );
    if (forward) best = forward;

    const reverseQuery = reverseComplement(sequence);
    const reverse = alignOneStrand(
      reverseQuery,
      -1,
      searchReference,
      referenceLength,
      circular,
      indexCache
    );
    if (
      reverse &&
      (!best ||
        reverse.score > best.score + 1e-9 ||
        (Math.abs(reverse.score - best.score) <= 1e-9 &&
          reverse.identityPercent > best.identityPercent))
    ) {
      best = reverse;
    }

    if (!best || best.identityPercent < minimumIdentity) return unaligned;

    return {
      readId: read.id,
      aligned: true,
      refStart: best.refStart,
      refEnd: best.refEnd,
      strand: best.strand,
      identityPercent: best.identityPercent,
      mismatches: best.mismatches
    };
  });
}

/**
 * Wraps FASTQ records in the Sanger trace shape so that they can be reused by
 * the existing chromatogram and alignment views. No trace samples exist for a
 * FASTQ record, hence the empty channel arrays.
 */
export function readsToTraces(reads: SequencingRead[]): SangerTraceData[] {
  return reads.map((read, index) => {
    const sequence = (read.sequence ?? '').toUpperCase();
    const qualities = new Array<number>(sequence.length).fill(0);
    const source = Array.isArray(read.qualities) ? read.qualities : [];
    for (let position = 0; position < sequence.length; position += 1) {
      const value = Number(source[position]);
      qualities[position] = Number.isFinite(value) ? Math.max(0, value) : 0;
    }
    const id = read.id || `read-${index + 1}`;

    return {
      id,
      fileName: read.name || `${id}.fastq`,
      calledSequence: sequence,
      qualityScores: qualities,
      baseLocations: [],
      trimRange: [0, sequence.length],
      traces: {
        A: [],
        T: [],
        G: [],
        C: []
      }
    };
  });
}
