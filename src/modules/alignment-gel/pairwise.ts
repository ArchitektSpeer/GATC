// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import {
  buildSubstitutionTable,
  detectSequenceType,
  encodeResidues,
  normalizeSequence,
  type SequenceType
} from './scoring';

export type PairwiseMode = 'global' | 'local' | 'semiglobal';

export interface PairwiseOptions {
  mode?: PairwiseMode;
  match?: number;
  mismatch?: number;
  gapOpen?: number;
  gapExtend?: number;
  type?: SequenceType;
}

export interface PairwiseResult {
  alignedA: string;
  alignedB: string;
  score: number;
  identityPercent: number;
  startA: number;
  endA: number;
  startB: number;
  endB: number;
}

interface PairwiseParameters {
  gapOpen: number;
  gapExtend: number;
  size: number;
  table: Float64Array;
}

interface RawPairwiseAlignment {
  alignedA: string;
  alignedB: string;
  score: number;
  startA: number;
  startB: number;
}

const NEGATIVE_INFINITY = -1e15;
const FULL_MATRIX_CELLS = 1_500_000;
const MAX_BAND_ATTEMPTS = 6;

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildParameters(options: PairwiseOptions): PairwiseParameters {
  const type = options.type ?? 'dna';
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
  return {
    gapOpen,
    gapExtend,
    size: scoring.size,
    table: scoring.table
  };
}

function emptyResult(alignedA: string, alignedB: string): PairwiseResult {
  return {
    alignedA,
    alignedB,
    score: 0,
    identityPercent: 0,
    startA: 0,
    endA: 0,
    startB: 0,
    endB: 0
  };
}

function identityOf(alignedA: string, alignedB: string): number {
  let matches = 0;
  let compared = 0;
  const columns = Math.min(alignedA.length, alignedB.length);
  for (let index = 0; index < columns; index += 1) {
    const first = alignedA[index];
    const second = alignedB[index];
    if (first === '-' || second === '-') continue;
    compared += 1;
    if (first.toUpperCase() === second.toUpperCase()) matches += 1;
  }
  return compared > 0 ? roundPercent((matches / compared) * 100) : 0;
}

function finishResult(
  raw: RawPairwiseAlignment,
  endA: number,
  endB: number,
  score: number
): PairwiseResult {
  return {
    alignedA: raw.alignedA,
    alignedB: raw.alignedB,
    score,
    identityPercent: identityOf(raw.alignedA, raw.alignedB),
    startA: raw.startA,
    endA,
    startB: raw.startB,
    endB
  };
}

function tracebackFull(
  a: string,
  b: string,
  columns: number,
  pointerM: Uint8Array,
  pointerX: Uint8Array,
  pointerY: Uint8Array,
  endI: number,
  endJ: number,
  endState: number,
  mode: PairwiseMode
): RawPairwiseAlignment {
  let i = endI;
  let j = endJ;
  let state = endState;
  const outputA: string[] = [];
  const outputB: string[] = [];
  while (i > 0 && j > 0) {
    const index = i * columns + j;
    const pointer = state === 1 ? pointerM[index] : state === 2 ? pointerX[index] : pointerY[index];
    if (pointer === 0 && mode !== 'global') break;
    if (state === 1) {
      outputA.push(a[i - 1]);
      outputB.push(b[j - 1]);
      i -= 1;
      j -= 1;
    } else if (state === 2) {
      outputA.push(a[i - 1]);
      outputB.push('-');
      i -= 1;
    } else {
      outputA.push('-');
      outputB.push(b[j - 1]);
      j -= 1;
    }
    state = pointer === 0 ? 1 : pointer;
  }
  if (mode === 'global') {
    while (i > 0) {
      outputA.push(a[i - 1]);
      outputB.push('-');
      i -= 1;
    }
    while (j > 0) {
      outputA.push('-');
      outputB.push(b[j - 1]);
      j -= 1;
    }
  }
  outputA.reverse();
  outputB.reverse();
  return { alignedA: outputA.join(''), alignedB: outputB.join(''), score: 0, startA: i, startB: j };
}

function runFull(
  a: string,
  aCodes: Uint8Array,
  b: string,
  bCodes: Uint8Array,
  parameters: PairwiseParameters,
  mode: PairwiseMode
): PairwiseResult {
  const n = a.length;
  const m = b.length;
  const columns = m + 1;
  const cells = (n + 1) * columns;
  const pointerM = new Uint8Array(cells);
  const pointerX = new Uint8Array(cells);
  const pointerY = new Uint8Array(cells);
  const { table, size, gapOpen, gapExtend } = parameters;

  let previousM = new Float64Array(columns);
  let previousX = new Float64Array(columns);
  let previousY = new Float64Array(columns);
  let currentM = new Float64Array(columns);
  let currentX = new Float64Array(columns);
  let currentY = new Float64Array(columns);

  if (mode === 'global') {
    previousM[0] = 0;
    previousX[0] = NEGATIVE_INFINITY;
    previousY[0] = NEGATIVE_INFINITY;
    for (let j = 1; j <= m; j += 1) {
      previousM[j] = NEGATIVE_INFINITY;
      previousX[j] = NEGATIVE_INFINITY;
      previousY[j] = gapOpen + (j - 1) * gapExtend;
    }
  } else {
    previousM.fill(0);
    previousX.fill(0);
    previousY.fill(0);
  }

  let bestScore = mode === 'global' ? 0 : mode === 'local' ? NEGATIVE_INFINITY : 0;
  let bestI = 0;
  let bestJ = 0;
  let bestState = 1;

  for (let i = 1; i <= n; i += 1) {
    if (mode === 'global') {
      currentM[0] = NEGATIVE_INFINITY;
      currentY[0] = NEGATIVE_INFINITY;
      currentX[0] = gapOpen + (i - 1) * gapExtend;
      pointerX[i * columns] = i === 1 ? 1 : 2;
    } else {
      currentM[0] = 0;
      currentX[0] = 0;
      currentY[0] = 0;
    }
    const rowBase = i * columns;
    const codeA = aCodes[i - 1];
    for (let j = 1; j <= m; j += 1) {
      const index = rowBase + j;

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
      let matchValue = diagonalValue + table[codeA * size + bCodes[j - 1]];

      let gapXValue = previousM[j] + gapOpen;
      let gapXPointer = 1;
      if (previousX[j] + gapExtend > gapXValue) {
        gapXValue = previousX[j] + gapExtend;
        gapXPointer = 2;
      }
      if (previousY[j] + gapOpen > gapXValue) {
        gapXValue = previousY[j] + gapOpen;
        gapXPointer = 3;
      }

      let gapYValue = currentM[j - 1] + gapOpen;
      let gapYPointer = 1;
      if (currentY[j - 1] + gapExtend > gapYValue) {
        gapYValue = currentY[j - 1] + gapExtend;
        gapYPointer = 3;
      }
      if (currentX[j - 1] + gapOpen > gapYValue) {
        gapYValue = currentX[j - 1] + gapOpen;
        gapYPointer = 2;
      }

      if (mode === 'local') {
        if (matchValue < 0) {
          matchValue = 0;
          diagonalPointer = 0;
        }
        if (gapXValue < 0) {
          gapXValue = 0;
          gapXPointer = 0;
        }
        if (gapYValue < 0) {
          gapYValue = 0;
          gapYPointer = 0;
        }
      }

      currentM[j] = matchValue;
      currentX[j] = gapXValue;
      currentY[j] = gapYValue;
      pointerM[index] = diagonalPointer;
      pointerX[index] = gapXPointer;
      pointerY[index] = gapYPointer;

      if (mode === 'local' || (mode === 'semiglobal' && (i === n || j === m))) {
        if (matchValue > bestScore) {
          bestScore = matchValue;
          bestI = i;
          bestJ = j;
          bestState = 1;
        }
        if (gapXValue > bestScore) {
          bestScore = gapXValue;
          bestI = i;
          bestJ = j;
          bestState = 2;
        }
        if (gapYValue > bestScore) {
          bestScore = gapYValue;
          bestI = i;
          bestJ = j;
          bestState = 3;
        }
      }
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

  let endI = n;
  let endJ = m;
  let endState = 1;
  let score = 0;
  if (mode === 'global') {
    const offset = m;
    score = previousM[offset];
    if (previousX[offset] > score) {
      score = previousX[offset];
      endState = 2;
    }
    if (previousY[offset] > score) {
      score = previousY[offset];
      endState = 3;
    }
  } else if (mode === 'semiglobal') {
    if (bestScore <= 0) return emptyResult('', '');
    endI = bestI;
    endJ = bestJ;
    endState = bestState;
    score = bestScore;
  } else {
    if (bestScore <= 0) return emptyResult('', '');
    endI = bestI;
    endJ = bestJ;
    endState = bestState;
    score = bestScore;
  }

  const raw = tracebackFull(
    a,
    b,
    columns,
    pointerM,
    pointerX,
    pointerY,
    endI,
    endJ,
    endState,
    mode
  );
  return finishResult(raw, endI, endJ, score);
}

interface BandedAttempt {
  alignment: PairwiseResult;
  touchesEdge: boolean;
}

function runBanded(
  a: string,
  aCodes: Uint8Array,
  b: string,
  bCodes: Uint8Array,
  parameters: PairwiseParameters,
  mode: PairwiseMode,
  margin: number
): BandedAttempt | null {
  const n = a.length;
  const m = b.length;
  const delta = m - n;
  const lowerOffset = Math.min(0, delta) - margin;
  const upperOffset = Math.max(0, delta) + margin;
  const width = upperOffset - lowerOffset + 1;
  const cells = (n + 1) * width;
  const pointers = new Uint8Array(cells);
  const { table, size, gapOpen, gapExtend } = parameters;

  let previousM = new Float64Array(width).fill(NEGATIVE_INFINITY);
  let previousX = new Float64Array(width).fill(NEGATIVE_INFINITY);
  let previousY = new Float64Array(width).fill(NEGATIVE_INFINITY);
  let currentM = new Float64Array(width);
  let currentX = new Float64Array(width);
  let currentY = new Float64Array(width);

  const initialUpper = Math.min(m, upperOffset);
  if (mode === 'global') {
    previousM[-lowerOffset] = 0;
    for (let j = 1; j <= initialUpper; j += 1) {
      const offset = j - lowerOffset;
      previousY[offset] = gapOpen + (j - 1) * gapExtend;
      pointers[offset] = (j === 1 ? 1 : 3) << 4;
    }
  } else {
    for (let j = 0; j <= initialUpper; j += 1) {
      const offset = j - lowerOffset;
      previousM[offset] = 0;
      previousX[offset] = 0;
      previousY[offset] = 0;
    }
  }

  let bestScore = mode === 'global' ? 0 : mode === 'local' ? NEGATIVE_INFINITY : 0;
  let bestI = 0;
  let bestJ = 0;
  let bestState = 1;

  for (let i = 1; i <= n; i += 1) {
    currentM.fill(NEGATIVE_INFINITY);
    currentX.fill(NEGATIVE_INFINITY);
    currentY.fill(NEGATIVE_INFINITY);
    const lower = Math.max(0, i + lowerOffset);
    const upper = Math.min(m, i + upperOffset);
    const codeA = aCodes[i - 1];
    for (let j = lower; j <= upper; j += 1) {
      const offset = j - i - lowerOffset;
      const index = i * width + offset;
      if (j === 0) {
        if (mode === 'global') {
          const up = offset + 1;
          let value = previousM[up] + gapOpen;
          let pointer = 1;
          if (previousX[up] + gapExtend > value) {
            value = previousX[up] + gapExtend;
            pointer = 2;
          }
          if (previousY[up] + gapOpen > value) {
            value = previousY[up] + gapOpen;
            pointer = 3;
          }
          currentX[offset] = value;
          pointers[index] = pointer << 2;
        } else {
          currentM[offset] = 0;
          currentX[offset] = 0;
          currentY[offset] = 0;
        }
        continue;
      }

      const up = offset + 1;
      const left = offset - 1;
      const hasUp = up < width;
      const hasLeft = left >= 0;

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
      let matchValue = diagonalValue + table[codeA * size + bCodes[j - 1]];

      let gapXValue = hasUp ? previousM[up] + gapOpen : NEGATIVE_INFINITY;
      let gapXPointer = 1;
      if (hasUp && previousX[up] + gapExtend > gapXValue) {
        gapXValue = previousX[up] + gapExtend;
        gapXPointer = 2;
      }
      if (hasUp && previousY[up] + gapOpen > gapXValue) {
        gapXValue = previousY[up] + gapOpen;
        gapXPointer = 3;
      }

      let gapYValue = hasLeft ? currentM[left] + gapOpen : NEGATIVE_INFINITY;
      let gapYPointer = 1;
      if (hasLeft && currentY[left] + gapExtend > gapYValue) {
        gapYValue = currentY[left] + gapExtend;
        gapYPointer = 3;
      }
      if (hasLeft && currentX[left] + gapOpen > gapYValue) {
        gapYValue = currentX[left] + gapOpen;
        gapYPointer = 2;
      }

      if (mode === 'local') {
        if (matchValue < 0) {
          matchValue = 0;
          diagonalPointer = 0;
        }
        if (gapXValue < 0) {
          gapXValue = 0;
          gapXPointer = 0;
        }
        if (gapYValue < 0) {
          gapYValue = 0;
          gapYPointer = 0;
        }
      }

      currentM[offset] = matchValue;
      currentX[offset] = gapXValue;
      currentY[offset] = gapYValue;
      pointers[index] = diagonalPointer | (gapXPointer << 2) | (gapYPointer << 4);

      if (mode === 'local' || (mode === 'semiglobal' && (i === n || j === m))) {
        if (matchValue > bestScore) {
          bestScore = matchValue;
          bestI = i;
          bestJ = j;
          bestState = 1;
        }
        if (gapXValue > bestScore) {
          bestScore = gapXValue;
          bestI = i;
          bestJ = j;
          bestState = 2;
        }
        if (gapYValue > bestScore) {
          bestScore = gapYValue;
          bestI = i;
          bestJ = j;
          bestState = 3;
        }
      }
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

  let endI = n;
  let endJ = m;
  let endState = 1;
  let score = 0;
  if (mode === 'global') {
    const offset = delta - lowerOffset;
    if (offset < 0 || offset >= width) return null;
    score = previousM[offset];
    if (previousX[offset] > score) {
      score = previousX[offset];
      endState = 2;
    }
    if (previousY[offset] > score) {
      score = previousY[offset];
      endState = 3;
    }
  } else {
    if (bestScore <= 0) return { alignment: emptyResult('', ''), touchesEdge: false };
    endI = bestI;
    endJ = bestJ;
    endState = bestState;
    score = bestScore;
  }

  let i = endI;
  let j = endJ;
  let state = endState;
  let touchesEdge = false;
  const outputA: string[] = [];
  const outputB: string[] = [];
  while (i > 0 && j > 0) {
    const offset = j - i - lowerOffset;
    if (offset < 0 || offset >= width) return null;
    if (offset === 0 || offset === width - 1) touchesEdge = true;
    const index = i * width + offset;
    const packed = pointers[index];
    const pointer = state === 1 ? packed & 3 : state === 2 ? (packed >> 2) & 3 : (packed >> 4) & 3;
    if (pointer === 0 && mode !== 'global') break;
    if (state === 1) {
      outputA.push(a[i - 1]);
      outputB.push(b[j - 1]);
      i -= 1;
      j -= 1;
    } else if (state === 2) {
      outputA.push(a[i - 1]);
      outputB.push('-');
      i -= 1;
    } else {
      outputA.push('-');
      outputB.push(b[j - 1]);
      j -= 1;
    }
    state = pointer === 0 ? 1 : pointer;
  }
  if (mode === 'global') {
    while (i > 0) {
      outputA.push(a[i - 1]);
      outputB.push('-');
      i -= 1;
    }
    while (j > 0) {
      outputA.push('-');
      outputB.push(b[j - 1]);
      j -= 1;
    }
  }
  outputA.reverse();
  outputB.reverse();
  return {
    alignment: finishResult(
      { alignedA: outputA.join(''), alignedB: outputB.join(''), score: 0, startA: i, startB: j },
      endI,
      endJ,
      score
    ),
    touchesEdge
  };
}

export function pairwiseAlign(
  a: string,
  b: string,
  options: PairwiseOptions = {}
): PairwiseResult {
  const first = normalizeSequence(a);
  const second = normalizeSequence(b);
  const type = options.type ?? detectSequenceType([first, second]);
  const parameters = buildParameters({ ...options, type });
  const mode = options.mode ?? 'global';

  if (first.length === 0 || second.length === 0) {
    if (mode !== 'global') return emptyResult('', '');
    if (first.length === 0 && second.length === 0) {
      return emptyResult('', '');
    }
    if (first.length === 0) {
      const score = parameters.gapOpen + Math.max(0, second.length - 1) * parameters.gapExtend;
      return {
        alignedA: '-'.repeat(second.length),
        alignedB: second,
        score,
        identityPercent: 0,
        startA: 0,
        endA: 0,
        startB: 0,
        endB: second.length
      };
    }
    const score = parameters.gapOpen + Math.max(0, first.length - 1) * parameters.gapExtend;
    return {
      alignedA: first,
      alignedB: '-'.repeat(first.length),
      score,
      identityPercent: 0,
      startA: 0,
      endA: first.length,
      startB: 0,
      endB: 0
    };
  }

  const codesA = encodeResidues(first, type);
  const codesB = encodeResidues(second, type);

  if (first.length * second.length <= FULL_MATRIX_CELLS) {
    return runFull(first, codesA, second, codesB, parameters, mode);
  }

  const maximumLength = Math.max(first.length, second.length);
  let margin = Math.max(64, Math.ceil(maximumLength * 0.02));

  let lastAlignment: PairwiseResult | null = null;
  for (let attempt = 0; attempt < MAX_BAND_ATTEMPTS; attempt += 1) {
    const result = runBanded(first, codesA, second, codesB, parameters, mode, margin);
    if (result) {
      lastAlignment = result.alignment;
      if (!result.touchesEdge) return result.alignment;
    }
    if (margin >= maximumLength) break;
    margin = Math.min(maximumLength, margin * 2);
  }
  if (lastAlignment) return lastAlignment;
  const fallback = runBanded(
    first,
    codesA,
    second,
    codesB,
    parameters,
    mode,
    maximumLength
  );
  return fallback ? fallback.alignment : emptyResult('', '');
}
