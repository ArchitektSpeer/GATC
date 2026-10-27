// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import {
  alphabetSize,
  buildSubstitutionTable,
  detectSequenceType,
  normalizeSequence,
  residueCode,
  DNA_ALPHABET,
  PROTEIN_ALPHABET,
  type SequenceType
} from './scoring';

export interface MsaInput {
  id: string;
  name: string;
  sequence: string;
}

export interface MsaRow {
  id: string;
  name: string;
  aligned: string;
}

export interface MsaResult {
  rows: MsaRow[];
  columns: number;
  consensus: string;
  conservation: number[];
  identityMatrix: number[][];
  guideTree: string;
}

export interface MsaOptions {
  match?: number;
  mismatch?: number;
  gapOpen?: number;
  gapExtend?: number;
  type?: SequenceType;
}

interface MsaParameters {
  type: SequenceType;
  size: number;
  table: Float64Array;
  gapOpen: number;
  gapExtend: number;
}

interface ProfileColumn {
  residues: string;
  counts: Int32Array;
  gaps: number;
}

interface Profile {
  order: number[];
  columns: ProfileColumn[];
  size: number;
}

interface GuideNode {
  id: number;
  name?: string;
  height: number;
  branch?: number;
  children?: [GuideNode, GuideNode];
}

const NEGATIVE_INFINITY = -1e15;
const PROFILE_FULL_CELLS = 500_000;
const MAX_BAND_ATTEMPTS = 6;

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundUnit(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildParameters(options: MsaOptions, type: SequenceType): MsaParameters {
  const isProtein = type === 'protein';
  const match = Number.isFinite(options.match) ? (options.match as number) : 2;
  const mismatch = Number.isFinite(options.mismatch) ? (options.mismatch as number) : -1;
  const gapOpen = -Math.abs(
    Number.isFinite(options.gapOpen) ? (options.gapOpen as number) : isProtein ? 11 : 3
  );
  const gapExtend = -Math.abs(
    Number.isFinite(options.gapExtend) ? (options.gapExtend as number) : 1
  );
  const scoring = buildSubstitutionTable(type, match, mismatch);
  return { type, size: scoring.size, table: scoring.table, gapOpen, gapExtend };
}

function chooseKmerLength(sequences: string[], type: SequenceType): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const sequence of sequences) minimum = Math.min(minimum, sequence.length);
  if (!Number.isFinite(minimum) || minimum <= 0) return 1;
  if (type === 'protein') {
    return Math.max(1, Math.min(3, Math.floor(Math.log2(minimum))));
  }
  return Math.max(2, Math.min(8, Math.floor(Math.log2(minimum))));
}

function kmerSet(sequence: string, kmerLength: number, type: SequenceType): Set<string> {
  const upper = sequence.toUpperCase();
  const set = new Set<string>();
  const pattern = type === 'dna' ? /^[ACGT]+$/ : /^[A-Z]+$/;
  for (let position = 0; position + kmerLength <= upper.length; position += 1) {
    const kmer = upper.slice(position, position + kmerLength);
    if (pattern.test(kmer)) set.add(kmer);
  }
  return set;
}

function directDistance(first: string, second: string): number {
  const length = Math.min(first.length, second.length);
  if (length === 0) return first.length === second.length ? 0 : 1;
  let matches = 0;
  const a = first.toUpperCase();
  const b = second.toUpperCase();
  for (let index = 0; index < length; index += 1) {
    if (a[index] === b[index]) matches += 1;
  }
  return 1 - matches / length;
}

function kmerDistances(
  sequences: string[],
  type: SequenceType
): number[][] {
  const count = sequences.length;
  const kmerLength = chooseKmerLength(sequences, type);
  const sets = sequences.map(sequence => kmerSet(sequence, kmerLength, type));
  const distances: number[][] = Array.from({ length: count }, () =>
    new Array<number>(count).fill(0)
  );
  for (let first = 0; first < count; first += 1) {
    for (let second = first + 1; second < count; second += 1) {
      const setA = sets[first];
      const setB = sets[second];
      let distance: number;
      if (setA.size === 0 || setB.size === 0) {
        distance = directDistance(sequences[first], sequences[second]);
      } else {
        let shared = 0;
        if (setA.size <= setB.size) {
          for (const kmer of setA) if (setB.has(kmer)) shared += 1;
        } else {
          for (const kmer of setB) if (setA.has(kmer)) shared += 1;
        }
        const union = setA.size + setB.size - shared;
        distance = union > 0 ? 1 - shared / union : directDistance(sequences[first], sequences[second]);
      }
      const clamped = Math.max(0, Math.min(1, distance));
      distances[first][second] = clamped;
      distances[second][first] = clamped;
    }
  }
  return distances;
}

function buildGuideTree(names: string[], distances: number[][]): GuideNode | null {
  const count = names.length;
  if (count === 0) return null;
  if (count === 1) {
    return { id: 0, name: names[0], height: 0 };
  }

  interface Cluster {
    node: GuideNode;
    size: number;
    height: number;
    active: boolean;
  }

  const clusters: Cluster[] = names.map((name, index) => ({
    node: { id: index, name, height: 0 },
    size: 1,
    height: 0,
    active: true
  }));
  const matrix: number[][] = distances.map(row => row.slice());
  let nextId = count;

  for (let merge = 0; merge < count - 1; merge += 1) {
    let bestFirst = -1;
    let bestSecond = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let first = 0; first < clusters.length; first += 1) {
      if (!clusters[first].active) continue;
      for (let second = first + 1; second < clusters.length; second += 1) {
        if (!clusters[second].active) continue;
        const candidate = matrix[first][second];
        if (
          candidate < bestDistance - 1e-12 ||
          (Math.abs(candidate - bestDistance) <= 1e-12 &&
            (bestFirst === -1 || first < bestFirst))
        ) {
          bestDistance = candidate;
          bestFirst = first;
          bestSecond = second;
        }
      }
    }
    if (bestFirst === -1 || bestSecond === -1) break;

    const firstCluster = clusters[bestFirst];
    const secondCluster = clusters[bestSecond];
    const height = Math.max(0, bestDistance) / 2;
    firstCluster.node.branch = Math.max(0, height - firstCluster.height);
    secondCluster.node.branch = Math.max(0, height - secondCluster.height);
    const parent: GuideNode = {
      id: nextId,
      height,
      children: [firstCluster.node, secondCluster.node]
    };
    nextId += 1;

    const combinedSize = firstCluster.size + secondCluster.size;
    const newIndex = clusters.length;
    const newRow = new Array<number>(newIndex + 1).fill(0);
    for (let other = 0; other < clusters.length; other += 1) {
      let distance = 0;
      if (other !== bestFirst && other !== bestSecond && clusters[other].active) {
        distance =
          (firstCluster.size * matrix[bestFirst][other] +
            secondCluster.size * matrix[bestSecond][other]) /
          combinedSize;
      }
      newRow[other] = distance;
      matrix[other].push(distance);
    }
    matrix.push(newRow);

    firstCluster.active = false;
    secondCluster.active = false;
    clusters.push({ node: parent, size: combinedSize, height, active: true });
  }

  const active = clusters.filter(cluster => cluster.active);
  return active.length > 0 ? active[active.length - 1].node : null;
}

function sanitizeNewickName(name: string, fallback: string): string {
  const cleaned = name.trim().replace(/[\s:;,()[\]']/g, '_');
  return cleaned.length > 0 ? cleaned : fallback;
}

function formatBranchLength(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Number.isFinite(rounded) ? String(rounded) : '0';
}

function toNewick(node: GuideNode, fallbackName: string): string {
  let label: string;
  if (node.children) {
    label = `(${toNewick(node.children[0], fallbackName)},${toNewick(node.children[1], fallbackName)})`;
  } else {
    label = sanitizeNewickName(node.name ?? '', `${fallbackName}${node.id + 1}`);
  }
  return node.branch === undefined
    ? label
    : `${label}:${formatBranchLength(node.branch)}`;
}

function leafProfile(index: number, sequence: string, parameters: MsaParameters): Profile {
  const columns: ProfileColumn[] = [];
  for (const character of sequence) {
    const counts = new Int32Array(parameters.size);
    counts[residueCode(character, parameters.type)] += 1;
    columns.push({ residues: character, counts, gaps: 0 });
  }
  return { order: [index], columns, size: 1 };
}

function combineAlignedColumns(
  first: ProfileColumn,
  second: ProfileColumn,
  firstSize: number,
  secondSize: number,
  size: number
): ProfileColumn {
  const counts = new Int32Array(size);
  for (let index = 0; index < size; index += 1) {
    counts[index] = first.counts[index] + second.counts[index];
  }
  return {
    residues: first.residues + second.residues,
    counts,
    gaps: first.gaps + second.gaps
  };
}

function buildMergedProfile(
  first: Profile,
  second: Profile,
  moves: number[],
  parameters: MsaParameters
): Profile {
  const columns: ProfileColumn[] = [];
  let firstIndex = 0;
  let secondIndex = 0;
  for (const move of moves) {
    if (move === 1) {
      columns.push(
        combineAlignedColumns(
          first.columns[firstIndex],
          second.columns[secondIndex],
          first.size,
          second.size,
          parameters.size
        )
      );
      firstIndex += 1;
      secondIndex += 1;
    } else if (move === 2) {
      const column = first.columns[firstIndex];
      columns.push({
        residues: column.residues + '-'.repeat(second.size),
        counts: column.counts,
        gaps: column.gaps + second.size
      });
      firstIndex += 1;
    } else {
      const column = second.columns[secondIndex];
      columns.push({
        residues: '-'.repeat(first.size) + column.residues,
        counts: column.counts,
        gaps: column.gaps + first.size
      });
      secondIndex += 1;
    }
  }
  return {
    order: first.order.concat(second.order),
    columns,
    size: first.size + second.size
  };
}

function scoreVectors(
  columns: ProfileColumn[],
  parameterSize: number,
  table: Float64Array
): Float64Array {
  const vectors = new Float64Array(columns.length * parameterSize);
  for (let column = 0; column < columns.length; column += 1) {
    const counts = columns[column].counts;
    const base = column * parameterSize;
    for (let target = 0; target < parameterSize; target += 1) {
      let value = 0;
      for (let source = 0; source < parameterSize; source += 1) {
        if (counts[source] === 0) continue;
        value += counts[source] * table[source * parameterSize + target];
      }
      vectors[base + target] = value;
    }
  }
  return vectors;
}

function columnSubstitution(
  vector: Float64Array,
  vectorBase: number,
  counts: Int32Array,
  countsBase: number,
  size: number
): number {
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    const count = counts[countsBase + index];
    if (count !== 0) value += count * vector[vectorBase + index];
  }
  return value;
}

function profileMovesFull(
  first: Profile,
  second: Profile,
  parameters: MsaParameters
): number[] {
  const firstColumns = first.columns.length;
  const secondColumns = second.columns.length;
  const columns = secondColumns + 1;
  const cells = (firstColumns + 1) * columns;
  const pointerM = new Uint8Array(cells);
  const pointerX = new Uint8Array(cells);
  const pointerY = new Uint8Array(cells);
  const { size, table, gapOpen, gapExtend } = parameters;
  const firstSize = first.size;
  const secondSize = second.size;

  const firstResidues = new Int32Array(firstColumns);
  for (let index = 0; index < firstColumns; index += 1) {
    firstResidues[index] = firstSize - first.columns[index].gaps;
  }
  const secondResidues = new Int32Array(secondColumns);
  for (let index = 0; index < secondColumns; index += 1) {
    secondResidues[index] = secondSize - second.columns[index].gaps;
  }
  const firstVectors = scoreVectors(first.columns, size, table);

  let previousM = new Float64Array(columns);
  let previousX = new Float64Array(columns);
  let previousY = new Float64Array(columns);
  let currentM = new Float64Array(columns);
  let currentX = new Float64Array(columns);
  let currentY = new Float64Array(columns);

  previousM[0] = 0;
  previousX[0] = NEGATIVE_INFINITY;
  previousY[0] = NEGATIVE_INFINITY;
  let accumulated = 0;
  for (let j = 1; j <= secondColumns; j += 1) {
    const open = gapOpen * secondResidues[j - 1] * firstSize;
    const extend = gapExtend * secondResidues[j - 1] * firstSize;
    accumulated = j === 1 ? open : accumulated + extend;
    previousM[j] = NEGATIVE_INFINITY;
    previousX[j] = NEGATIVE_INFINITY;
    previousY[j] = accumulated;
    pointerY[j] = j === 1 ? 1 : 3;
  }

  for (let i = 1; i <= firstColumns; i += 1) {
    currentM[0] = NEGATIVE_INFINITY;
    currentY[0] = NEGATIVE_INFINITY;
    const openX = gapOpen * firstResidues[i - 1] * secondSize;
    const extendX = gapExtend * firstResidues[i - 1] * secondSize;
    if (i === 1) {
      currentX[0] = openX;
      pointerX[i * columns] = 1;
    } else {
      currentX[0] = previousX[0] + extendX;
      pointerX[i * columns] = 2;
    }

    const rowBase = i * columns;
    const vectorBase = (i - 1) * size;
    for (let j = 1; j <= secondColumns; j += 1) {
      const index = rowBase + j;
      const substitution = columnSubstitution(
        firstVectors,
        vectorBase,
        second.columns[j - 1].counts,
        0,
        size
      );

      let diagonalValue = previousM[j - 1];
      let diagonalPointer = 1;
      if (previousX[j - 1] > diagonalValue) {
        diagonalValue = previousX[j - 1];
        diagonalPointer = 2;
      }
      if (previousY[j - 1] > diagonalValue) {
        diagonalValue = previousY[j - 1];
        diagonalPointer = 3;
      }
      const matchValue = diagonalValue + substitution;

      let gapXValue = previousM[j] + openX;
      let gapXPointer = 1;
      if (previousX[j] + extendX > gapXValue) {
        gapXValue = previousX[j] + extendX;
        gapXPointer = 2;
      }
      if (previousY[j] + openX > gapXValue) {
        gapXValue = previousY[j] + openX;
        gapXPointer = 3;
      }

      const openY = gapOpen * secondResidues[j - 1] * firstSize;
      const extendY = gapExtend * secondResidues[j - 1] * firstSize;
      let gapYValue = currentM[j - 1] + openY;
      let gapYPointer = 1;
      if (currentY[j - 1] + extendY > gapYValue) {
        gapYValue = currentY[j - 1] + extendY;
        gapYPointer = 3;
      }
      if (currentX[j - 1] + openY > gapYValue) {
        gapYValue = currentX[j - 1] + openY;
        gapYPointer = 2;
      }

      currentM[j] = matchValue;
      currentX[j] = gapXValue;
      currentY[j] = gapYValue;
      pointerM[index] = diagonalPointer;
      pointerX[index] = gapXPointer;
      pointerY[index] = gapYPointer;
    }

    let swap = previousM;
    previousM = currentM;
    currentM = swap;
    swap = previousX;
    previousX = currentX;
    currentX = swap;
    swap = previousY;
    previousY = currentY;
    currentY = swap;
  }

  const lastColumn = secondColumns;
  let state = 1;
  if (previousX[lastColumn] > previousM[lastColumn]) state = 2;
  if (
    previousY[lastColumn] >
    (state === 2 ? previousX[lastColumn] : previousM[lastColumn])
  ) {
    state = 3;
  }

  const moves: number[] = [];
  let i = firstColumns;
  let j = secondColumns;
  while (i > 0 || j > 0) {
    if (state === 1 && i > 0 && j > 0) {
      moves.push(1);
      state = pointerM[i * columns + j] || 1;
      i -= 1;
      j -= 1;
    } else if (state === 2 && i > 0) {
      moves.push(2);
      state = pointerX[i * columns + j] || 1;
      i -= 1;
    } else if (j > 0) {
      moves.push(3);
      state = pointerY[i * columns + j] || 1;
      j -= 1;
    } else if (i > 0) {
      moves.push(2);
      i -= 1;
    } else {
      break;
    }
  }
  moves.reverse();
  return moves;
}

function profileMovesBanded(
  first: Profile,
  second: Profile,
  parameters: MsaParameters,
  margin: number
): { moves: number[]; touchesEdge: boolean } | null {
  const firstColumns = first.columns.length;
  const secondColumns = second.columns.length;
  const delta = secondColumns - firstColumns;
  const lowerOffset = Math.min(0, delta) - margin;
  const upperOffset = Math.max(0, delta) + margin;
  const width = upperOffset - lowerOffset + 1;
  const cells = (firstColumns + 1) * width;
  const pointers = new Uint8Array(cells);
  const { size, table, gapOpen, gapExtend } = parameters;
  const firstSize = first.size;
  const secondSize = second.size;

  const firstResidues = new Int32Array(firstColumns);
  for (let index = 0; index < firstColumns; index += 1) {
    firstResidues[index] = firstSize - first.columns[index].gaps;
  }
  const secondResidues = new Int32Array(secondColumns);
  const secondCounts = new Int32Array(secondColumns * size);
  for (let index = 0; index < secondColumns; index += 1) {
    secondResidues[index] = secondSize - second.columns[index].gaps;
    secondCounts.set(second.columns[index].counts, index * size);
  }
  const secondOpen = new Float64Array(secondColumns);
  const secondExtend = new Float64Array(secondColumns);
  for (let index = 0; index < secondColumns; index += 1) {
    secondOpen[index] = gapOpen * secondResidues[index] * firstSize;
    secondExtend[index] = gapExtend * secondResidues[index] * firstSize;
  }
  const firstVectors = scoreVectors(first.columns, size, table);

  let previousM = new Float64Array(width).fill(NEGATIVE_INFINITY);
  let previousX = new Float64Array(width).fill(NEGATIVE_INFINITY);
  let previousY = new Float64Array(width).fill(NEGATIVE_INFINITY);
  let currentM = new Float64Array(width);
  let currentX = new Float64Array(width);
  let currentY = new Float64Array(width);

  const initialUpper = Math.min(secondColumns, upperOffset);
  previousM[-lowerOffset] = 0;
  let accumulated = 0;
  for (let j = 1; j <= initialUpper; j += 1) {
    const offset = j - lowerOffset;
    const open = gapOpen * secondResidues[j - 1] * firstSize;
    const extend = gapExtend * secondResidues[j - 1] * firstSize;
    accumulated = j === 1 ? open : accumulated + extend;
    previousY[offset] = accumulated;
    pointers[offset] = (j === 1 ? 1 : 3) << 4;
  }

  for (let i = 1; i <= firstColumns; i += 1) {
    currentM.fill(NEGATIVE_INFINITY);
    currentX.fill(NEGATIVE_INFINITY);
    currentY.fill(NEGATIVE_INFINITY);
    const lower = Math.max(0, i + lowerOffset);
    const upper = Math.min(secondColumns, i + upperOffset);
    const openX = gapOpen * firstResidues[i - 1] * secondSize;
    const extendX = gapExtend * firstResidues[i - 1] * secondSize;
    const vectorBase = (i - 1) * size;
    for (let j = lower; j <= upper; j += 1) {
      const offset = j - i - lowerOffset;
      const index = i * width + offset;
      if (j === 0) {
        const up = offset + 1;
        let value = previousM[up] + openX;
        let pointer = 1;
        if (previousX[up] + extendX > value) {
          value = previousX[up] + extendX;
          pointer = 2;
        }
        if (previousY[up] + openX > value) {
          value = previousY[up] + openX;
          pointer = 3;
        }
        currentX[offset] = value;
        pointers[index] = pointer << 2;
        continue;
      }

      const up = offset + 1;
      const left = offset - 1;
      const hasUp = up < width;
      const hasLeft = left >= 0;
      const countsBase = (j - 1) * size;
      let substitution: number;
      if (size === 5) {
        substitution =
          secondCounts[countsBase] * firstVectors[vectorBase] +
          secondCounts[countsBase + 1] * firstVectors[vectorBase + 1] +
          secondCounts[countsBase + 2] * firstVectors[vectorBase + 2] +
          secondCounts[countsBase + 3] * firstVectors[vectorBase + 3] +
          secondCounts[countsBase + 4] * firstVectors[vectorBase + 4];
      } else {
        substitution = 0;
        for (let symbol = 0; symbol < size; symbol += 1) {
          substitution +=
            secondCounts[countsBase + symbol] * firstVectors[vectorBase + symbol];
        }
      }

      let diagonalValue = previousM[offset];
      let diagonalPointer = 1;
      if (previousX[offset] > diagonalValue) {
        diagonalValue = previousX[offset];
        diagonalPointer = 2;
      }
      if (previousY[offset] > diagonalValue) {
        diagonalValue = previousY[offset];
        diagonalPointer = 3;
      }
      const matchValue = diagonalValue + substitution;

      let gapXValue = hasUp ? previousM[up] + openX : NEGATIVE_INFINITY;
      let gapXPointer = 1;
      if (hasUp && previousX[up] + extendX > gapXValue) {
        gapXValue = previousX[up] + extendX;
        gapXPointer = 2;
      }
      if (hasUp && previousY[up] + openX > gapXValue) {
        gapXValue = previousY[up] + openX;
        gapXPointer = 3;
      }

      const openY = secondOpen[j - 1];
      const extendY = secondExtend[j - 1];
      let gapYValue = hasLeft ? currentM[left] + openY : NEGATIVE_INFINITY;
      let gapYPointer = 1;
      if (hasLeft && currentY[left] + extendY > gapYValue) {
        gapYValue = currentY[left] + extendY;
        gapYPointer = 3;
      }
      if (hasLeft && currentX[left] + openY > gapYValue) {
        gapYValue = currentX[left] + openY;
        gapYPointer = 2;
      }

      currentM[offset] = matchValue;
      currentX[offset] = gapXValue;
      currentY[offset] = gapYValue;
      pointers[index] = diagonalPointer | (gapXPointer << 2) | (gapYPointer << 4);
    }

    let swap = previousM;
    previousM = currentM;
    currentM = swap;
    swap = previousX;
    previousX = currentX;
    currentX = swap;
    swap = previousY;
    previousY = currentY;
    currentY = swap;
  }

  const endpointOffset = delta - lowerOffset;
  if (endpointOffset < 0 || endpointOffset >= width) return null;
  let state = 1;
  if (previousX[endpointOffset] > previousM[endpointOffset]) state = 2;
  if (
    previousY[endpointOffset] >
    (state === 2 ? previousX[endpointOffset] : previousM[endpointOffset])
  ) {
    state = 3;
  }

  let i = firstColumns;
  let j = secondColumns;
  let touchesEdge = false;
  const moves: number[] = [];
  while (i > 0 || j > 0) {
    if (i <= 0) {
      moves.push(3);
      j -= 1;
      continue;
    }
    if (j <= 0) {
      moves.push(2);
      i -= 1;
      continue;
    }
    const offset = j - i - lowerOffset;
    if (offset < 0 || offset >= width) return null;
    if (offset === 0 || offset === width - 1) touchesEdge = true;
    const index = i * width + offset;
    const packed = pointers[index];
    if (state === 1) {
      moves.push(1);
      state = (packed & 3) || 1;
      i -= 1;
      j -= 1;
    } else if (state === 2) {
      moves.push(2);
      state = ((packed >> 2) & 3) || 1;
      i -= 1;
    } else {
      moves.push(3);
      state = ((packed >> 4) & 3) || 1;
      j -= 1;
    }
  }
  moves.reverse();
  return { moves, touchesEdge };
}

function mergeProfiles(
  first: Profile,
  second: Profile,
  parameters: MsaParameters
): Profile {
  if (first.columns.length === 0) {
    return {
      order: first.order.concat(second.order),
      columns: second.columns.map(column => ({
        residues: '-'.repeat(first.size) + column.residues,
        counts: column.counts,
        gaps: column.gaps + first.size
      })),
      size: first.size + second.size
    };
  }
  if (second.columns.length === 0) {
    return {
      order: first.order.concat(second.order),
      columns: first.columns.map(column => ({
        residues: column.residues + '-'.repeat(second.size),
        counts: column.counts,
        gaps: column.gaps + second.size
      })),
      size: first.size + second.size
    };
  }

  const firstColumns = first.columns.length;
  const secondColumns = second.columns.length;
  let moves: number[];
  if (firstColumns * secondColumns <= PROFILE_FULL_CELLS) {
    moves = profileMovesFull(first, second, parameters);
  } else {
    const maximumColumns = Math.max(firstColumns, secondColumns);
    let margin = Math.max(32, Math.ceil(maximumColumns * 0.03));
    let chosen: number[] | null = null;
    for (let attempt = 0; attempt < MAX_BAND_ATTEMPTS; attempt += 1) {
      const result = profileMovesBanded(first, second, parameters, margin);
      if (result) {
        chosen = result.moves;
        if (!result.touchesEdge) break;
      }
      if (margin >= maximumColumns) break;
      margin = Math.min(maximumColumns, margin * 2);
    }
    if (!chosen) {
      chosen = profileMovesFull(first, second, parameters);
    }
    moves = chosen;
  }

  return buildMergedProfile(first, second, moves, parameters);
}

function alignProfile(
  node: GuideNode,
  leaves: Profile[],
  parameters: MsaParameters
): Profile {
  if (!node.children) return leaves[node.id];
  const first = alignProfile(node.children[0], leaves, parameters);
  const second = alignProfile(node.children[1], leaves, parameters);
  return mergeProfiles(first, second, parameters);
}

function consensusAndConservation(
  rows: string[],
  type: SequenceType
): { consensus: string; conservation: number[] } {
  if (rows.length === 0) return { consensus: '', conservation: [] };
  const columns = rows[0].length;
  const alphabet = type === 'dna' ? DNA_ALPHABET : PROTEIN_ALPHABET;
  const size = alphabetSize(type);
  const counts = new Int32Array(size);
  const consensusCharacters: string[] = [];
  const conservation: number[] = [];

  for (let column = 0; column < columns; column += 1) {
    counts.fill(0);
    let gaps = 0;
    for (const row of rows) {
      const character = row[column];
      if (character === '-') {
        gaps += 1;
      } else {
        counts[residueCode(character, type)] += 1;
      }
    }
    let bestIndex = 0;
    let bestCount = 0;
    for (let index = 0; index < size; index += 1) {
      if (counts[index] > bestCount) {
        bestCount = counts[index];
        bestIndex = index;
      }
    }
    const nonGap = rows.length - gaps;
    if (gaps > bestCount) {
      consensusCharacters.push('-');
      conservation.push(0);
    } else {
      consensusCharacters.push(alphabet[bestIndex]);
      conservation.push(nonGap > 0 ? roundUnit(bestCount / nonGap) : 0);
    }
  }

  return { consensus: consensusCharacters.join(''), conservation };
}

function identityMatrixOf(rows: string[]): number[][] {
  const count = rows.length;
  const matrix: number[][] = Array.from({ length: count }, () =>
    new Array<number>(count).fill(0)
  );
  const columns = count > 0 ? rows[0].length : 0;
  for (let first = 0; first < count; first += 1) {
    matrix[first][first] = 100;
    for (let second = first + 1; second < count; second += 1) {
      let compared = 0;
      let matches = 0;
      for (let column = 0; column < columns; column += 1) {
        const a = rows[first][column];
        const b = rows[second][column];
        if (a === '-' || b === '-') continue;
        compared += 1;
        if (a.toUpperCase() === b.toUpperCase()) matches += 1;
      }
      const value = compared > 0 ? roundPercent((matches / compared) * 100) : 0;
      matrix[first][second] = value;
      matrix[second][first] = value;
    }
  }
  return matrix;
}

function emptyMsaResult(): MsaResult {
  return {
    rows: [],
    columns: 0,
    consensus: '',
    conservation: [],
    identityMatrix: [],
    guideTree: ''
  };
}

export function multipleSequenceAlignment(
  seqs: MsaInput[],
  options: MsaOptions = {}
): MsaResult {
  if (seqs.length === 0) return emptyMsaResult();

  const sequences = seqs.map(input => normalizeSequence(input.sequence));
  const type = options.type ?? detectSequenceType(sequences);
  const parameters = buildParameters(options, type);
  const names = seqs.map((input, index) => input.name || input.id || `seq${index + 1}`);

  let guideTree = '';
  let profile: Profile;
  if (seqs.length === 1) {
    profile = leafProfile(0, sequences[0], parameters);
    guideTree = `${sanitizeNewickName(names[0], 'seq1')};`;
  } else {
    const distances = kmerDistances(sequences, type);
    const tree = buildGuideTree(names, distances);
    if (!tree) return emptyMsaResult();
    guideTree = `${toNewick(tree, 'seq')};`;
    const leaves = sequences.map((sequence, index) =>
      leafProfile(index, sequence, parameters)
    );
    profile = alignProfile(tree, leaves, parameters);
  }

  const rowCharacters: string[][] = sequences.map(() => []);
  for (let position = 0; position < profile.order.length; position += 1) {
    const target = rowCharacters[profile.order[position]];
    for (const column of profile.columns) target.push(column.residues[position]);
  }
  const rows: MsaRow[] = seqs.map((input, index) => ({
    id: input.id,
    name: input.name,
    aligned: rowCharacters[index].join('')
  }));
  const alignedStrings = rows.map(row => row.aligned);
  const { consensus, conservation } = consensusAndConservation(alignedStrings, type);

  return {
    rows,
    columns: profile.columns.length,
    consensus,
    conservation,
    identityMatrix: identityMatrixOf(alignedStrings),
    guideTree
  };
}
