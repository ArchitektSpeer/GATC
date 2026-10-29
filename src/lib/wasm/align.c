/*
 * GATC - Gene Assembly & Toolkit for Cloning
 * Copyright (C) 2026 Xu Zhonghe
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The inner loop of the Gotoh local alignment (Smith-Waterman with affine
 * gaps), compiled to WebAssembly. It mirrors the JavaScript in
 * modules/alignment-gel/alignment.ts statement for statement, including the
 * order of every comparison, so the two fill the matrices identically and the
 * traceback - which stays in JavaScript - gives the same alignment either way.
 * A test checks that on random input; if you change one side, change both.
 *
 * Rebuild with `npm run build:wasm` (needs clang with the wasm32 target and
 * wasm-ld); that script also refreshes the base64 copy in gotoh.wasm.ts.
 */

/* Everything is addressed through pointers the caller hands in, so the module
 * owns no state and needs no allocator. */
__attribute__((export_name("fill"))) void fill(
    const unsigned char *reference, const unsigned char *read, int n, int m,
    int matchScore, int mismatchScore, int gapOpen, int gapExtend,
    int *matrix, int *gapInQuery, int *gapInRef, unsigned char *pointerM,
    unsigned char *pointerX, unsigned char *pointerY, int *out) {
  const int columns = m + 1;
  int bestScore = 0;
  int bestI = 0;
  int bestJ = 0;
  int bestMatrix = 1;

  for (int i = 1; i <= n; i += 1) {
    const unsigned char refChar = reference[i - 1];
    const int row = i * columns;
    const int previousRow = (i - 1) * columns;
    for (int j = 1; j <= m; j += 1) {
      const int index = row + j;
      const int diagonal = previousRow + j - 1;

      int previousBest = matrix[diagonal];
      int previousMatrix = 1;
      if (gapInQuery[diagonal] > previousBest) {
        previousBest = gapInQuery[diagonal];
        previousMatrix = 2;
      }
      if (gapInRef[diagonal] > previousBest) {
        previousBest = gapInRef[diagonal];
        previousMatrix = 3;
      }
      const int substitution = refChar == read[j - 1] ? matchScore : mismatchScore;
      const int matchValue = previousBest + substitution;
      if (matchValue > 0) {
        matrix[index] = matchValue;
        pointerM[index] = (unsigned char)previousMatrix;
      }

      int openValue = matrix[previousRow + j] + gapOpen;
      int openPointer = 1;
      if (gapInQuery[previousRow + j] + gapExtend > openValue) {
        openValue = gapInQuery[previousRow + j] + gapExtend;
        openPointer = 2;
      }
      if (gapInRef[previousRow + j] + gapOpen > openValue) {
        openValue = gapInRef[previousRow + j] + gapOpen;
        openPointer = 3;
      }
      if (openValue > 0) {
        gapInQuery[index] = openValue;
        pointerX[index] = (unsigned char)openPointer;
      }

      int extendValue = matrix[row + j - 1] + gapOpen;
      int extendPointer = 1;
      if (gapInRef[row + j - 1] + gapExtend > extendValue) {
        extendValue = gapInRef[row + j - 1] + gapExtend;
        extendPointer = 3;
      }
      if (gapInQuery[row + j - 1] + gapOpen > extendValue) {
        extendValue = gapInQuery[row + j - 1] + gapOpen;
        extendPointer = 2;
      }
      if (extendValue > 0) {
        gapInRef[index] = extendValue;
        pointerY[index] = (unsigned char)extendPointer;
      }

      if (matrix[index] > bestScore) {
        bestScore = matrix[index];
        bestI = i;
        bestJ = j;
        bestMatrix = 1;
      }
      if (gapInQuery[index] > bestScore) {
        bestScore = gapInQuery[index];
        bestI = i;
        bestJ = j;
        bestMatrix = 2;
      }
      if (gapInRef[index] > bestScore) {
        bestScore = gapInRef[index];
        bestI = i;
        bestJ = j;
        bestMatrix = 3;
      }
    }
  }

  out[0] = bestScore;
  out[1] = bestI;
  out[2] = bestJ;
  out[3] = bestMatrix;
}

/* ------------------------------------------------------------------------- */

#define NEG_INF (-1e9)

static int baseCode(unsigned char character) {
  switch (character) {
    case 'A': return 0;
    case 'C': return 1;
    case 'G': return 2;
    case 'T': return 3;
    default: return -1;
  }
}

static double substitutionScore(unsigned char referenceBase, unsigned char readBase) {
  const int referenceCode = baseCode(referenceBase);
  const int readCode = baseCode(readBase);
  if (referenceCode < 0 || readCode < 0) return 0.0;
  return referenceCode == readCode ? 2.0 : -1.0;
}

/*
 * The row loop of the banded semiglobal alignment used for sequencing reads,
 * mirroring bandedSemiglobal in modules/alignment-gel/reads.ts. Every value in
 * this recurrence is a whole number held exactly in a double, so both sides
 * compute the same scores bit for bit.
 *
 * `rows` holds six rows of `width` doubles: M, X, Y of one triple followed by
 * M, X, Y of the other. The loop swaps them, so out[0] says which triple holds
 * the last row (0 for the first, 1 for the second).
 */
__attribute__((export_name("banded"))) void banded(
    const unsigned char *target, const unsigned char *query, int targetLength,
    int queryLength, int lowerOffset, int upperOffset, int width,
    unsigned char *pointers, double *rows, int *out) {
  double *previousM = rows;
  double *previousX = rows + width;
  double *previousY = rows + 2 * width;
  double *currentM = rows + 3 * width;
  double *currentX = rows + 4 * width;
  double *currentY = rows + 5 * width;
  int previousTriple = 0;

  for (int index = 0; index < width; index += 1) {
    previousM[index] = NEG_INF;
    previousX[index] = NEG_INF;
    previousY[index] = NEG_INF;
  }
  for (int offset = lowerOffset; offset <= upperOffset; offset += 1) {
    if (offset < 0 || offset > targetLength) continue;
    previousM[offset - lowerOffset] = 0.0;
  }

  for (int row = 1; row <= queryLength; row += 1) {
    for (int index = 0; index < width; index += 1) {
      currentM[index] = NEG_INF;
      currentX[index] = NEG_INF;
      currentY[index] = NEG_INF;
    }
    const unsigned char readBase = query[row - 1];
    int lowest = lowerOffset > -row ? lowerOffset : -row;
    int highest = upperOffset < targetLength - row ? upperOffset : targetLength - row;
    const int rowBase = row * width;

    for (int offset = lowest; offset <= highest; offset += 1) {
      const int index = offset - lowerOffset;
      const int column = row + offset;

      double matchValue = NEG_INF;
      int matchPointer = 0;
      if (column >= 1) {
        double diagonal = previousM[index];
        int diagonalPointer = 1;
        if (previousX[index] > diagonal) {
          diagonal = previousX[index];
          diagonalPointer = 2;
        }
        if (previousY[index] > diagonal) {
          diagonal = previousY[index];
          diagonalPointer = 3;
        }
        if (diagonal > NEG_INF / 2) {
          matchValue = diagonal + substitutionScore(target[column - 1], readBase);
          matchPointer = diagonalPointer;
        }
      }

      double gapInTarget = NEG_INF;
      int gapInTargetPointer = 0;
      if (index + 1 < width) {
        gapInTarget = previousM[index + 1] + -4.0;
        gapInTargetPointer = 1;
        if (previousX[index + 1] + -1.0 > gapInTarget) {
          gapInTarget = previousX[index + 1] + -1.0;
          gapInTargetPointer = 2;
        }
        if (previousY[index + 1] + -4.0 > gapInTarget) {
          gapInTarget = previousY[index + 1] + -4.0;
          gapInTargetPointer = 3;
        }
        if (gapInTarget < NEG_INF / 2) gapInTargetPointer = 0;
      }

      double gapInQuery = NEG_INF;
      int gapInQueryPointer = 0;
      if (column >= 1 && index >= 1) {
        gapInQuery = currentM[index - 1] + -4.0;
        gapInQueryPointer = 1;
        if (currentY[index - 1] + -1.0 > gapInQuery) {
          gapInQuery = currentY[index - 1] + -1.0;
          gapInQueryPointer = 3;
        }
        if (currentX[index - 1] + -4.0 > gapInQuery) {
          gapInQuery = currentX[index - 1] + -4.0;
          gapInQueryPointer = 2;
        }
        if (gapInQuery < NEG_INF / 2) gapInQueryPointer = 0;
      }

      currentM[index] = matchValue;
      currentX[index] = gapInTarget;
      currentY[index] = gapInQuery;
      pointers[rowBase + index] =
          (unsigned char)(matchPointer | (gapInTargetPointer << 2) | (gapInQueryPointer << 4));
    }

    double *swap = previousM;
    previousM = currentM;
    currentM = swap;
    swap = previousX;
    previousX = currentX;
    currentX = swap;
    swap = previousY;
    previousY = currentY;
    currentY = swap;
    previousTriple = previousTriple == 0 ? 1 : 0;
  }

  out[0] = previousTriple;
}

/* ------------------------------------------------------------------------- */

#define PROFILE_NEG_INF (-1e15)

/*
 * The row loop of the banded profile-profile alignment that drives the multiple
 * sequence alignment, mirroring profileMovesBanded in
 * modules/alignment-gel/msa.ts. Every input is a flat array the caller fills,
 * and `rows` holds six rows of `width` doubles as in `banded` above; out[0]
 * says which triple holds the last row.
 */
__attribute__((export_name("profile"))) void profile(
    int firstColumns, int secondColumns, int size, int width, int lowerOffset,
    double gapOpen, double gapExtend, int firstSize, int secondSize,
    const int *firstResidues, const int *secondResidues,
    const int *secondCounts, const double *firstVectors,
    const double *secondOpen, const double *secondExtend,
    unsigned char *pointers, double *rows, int *out) {
  double *previousM = rows;
  double *previousX = rows + width;
  double *previousY = rows + 2 * width;
  double *currentM = rows + 3 * width;
  double *currentX = rows + 4 * width;
  double *currentY = rows + 5 * width;
  int previousTriple = 0;

  for (int index = 0; index < width; index += 1) {
    previousM[index] = PROFILE_NEG_INF;
    previousX[index] = PROFILE_NEG_INF;
    previousY[index] = PROFILE_NEG_INF;
  }

  const int upperOffset = lowerOffset + width - 1;
  const int initialUpper = secondColumns < upperOffset ? secondColumns : upperOffset;
  previousM[-lowerOffset] = 0.0;
  double accumulated = 0.0;
  for (int j = 1; j <= initialUpper; j += 1) {
    const int offset = j - lowerOffset;
    if (offset < 0 || offset >= width) continue;
    const double open = gapOpen * secondResidues[j - 1] * firstSize;
    const double extend = gapExtend * secondResidues[j - 1] * firstSize;
    accumulated = j == 1 ? open : accumulated + extend;
    previousY[offset] = accumulated;
    pointers[offset] = (unsigned char)((j == 1 ? 1 : 3) << 4);
  }

  for (int i = 1; i <= firstColumns; i += 1) {
    for (int index = 0; index < width; index += 1) {
      currentM[index] = PROFILE_NEG_INF;
      currentX[index] = PROFILE_NEG_INF;
      currentY[index] = PROFILE_NEG_INF;
    }
    const int lowerBand = i + lowerOffset;
    const int lower = lowerBand > 0 ? lowerBand : 0;
    const int upperBand = i + upperOffset;
    const int upper = secondColumns < upperBand ? secondColumns : upperBand;
    const double openX = gapOpen * firstResidues[i - 1] * secondSize;
    const double extendX = gapExtend * firstResidues[i - 1] * secondSize;
    const int vectorBase = (i - 1) * size;

    for (int j = lower; j <= upper; j += 1) {
      const int offset = j - i - lowerOffset;
      const int index = i * width + offset;
      if (j == 0) {
        const int up = offset + 1;
        double value = previousM[up] + openX;
        int pointer = 1;
        if (previousX[up] + extendX > value) {
          value = previousX[up] + extendX;
          pointer = 2;
        }
        if (previousY[up] + openX > value) {
          value = previousY[up] + openX;
          pointer = 3;
        }
        currentX[offset] = value;
        pointers[index] = (unsigned char)(pointer << 2);
        continue;
      }

      const int up = offset + 1;
      const int left = offset - 1;
      const int hasUp = up < width;
      const int hasLeft = left >= 0;
      const int countsBase = (j - 1) * size;
      double substitution = 0.0;
      for (int symbol = 0; symbol < size; symbol += 1) {
        substitution += secondCounts[countsBase + symbol] * firstVectors[vectorBase + symbol];
      }

      double diagonalValue = previousM[offset];
      int diagonalPointer = 1;
      if (previousX[offset] > diagonalValue) {
        diagonalValue = previousX[offset];
        diagonalPointer = 2;
      }
      if (previousY[offset] > diagonalValue) {
        diagonalValue = previousY[offset];
        diagonalPointer = 3;
      }
      const double matchValue = diagonalValue + substitution;

      double gapXValue = hasUp ? previousM[up] + openX : PROFILE_NEG_INF;
      int gapXPointer = 1;
      if (hasUp && previousX[up] + extendX > gapXValue) {
        gapXValue = previousX[up] + extendX;
        gapXPointer = 2;
      }
      if (hasUp && previousY[up] + openX > gapXValue) {
        gapXValue = previousY[up] + openX;
        gapXPointer = 3;
      }

      const double openY = secondOpen[j - 1];
      const double extendY = secondExtend[j - 1];
      double gapYValue = hasLeft ? currentM[left] + openY : PROFILE_NEG_INF;
      int gapYPointer = 1;
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
      pointers[index] =
          (unsigned char)(diagonalPointer | (gapXPointer << 2) | (gapYPointer << 4));
    }

    double *swap = previousM;
    previousM = currentM;
    currentM = swap;
    swap = previousX;
    previousX = currentX;
    currentX = swap;
    swap = previousY;
    previousY = currentY;
    currentY = swap;
    previousTriple = previousTriple == 0 ? 1 : 0;
  }

  out[0] = previousTriple;
}
