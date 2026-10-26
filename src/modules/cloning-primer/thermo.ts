import {
  GAS_CONSTANT,
  clamp,
  gcPercentOf,
  has3PrimeGCClamp,
  isSelfComplementary,
  normalizeDNA,
  reverseComplement,
} from './utils';

export interface ReactionConditions {
  naMm?: number;
  mgMm?: number;
  dntpMm?: number;
  oligoNm?: number;
}

export const DEFAULT_REACTION_CONDITIONS: Required<ReactionConditions> = {
  naMm: 50,
  mgMm: 2,
  dntpMm: 0.8,
  oligoNm: 250,
};

interface NearestNeighborStep {
  dH: number; // kcal / mol
  dS: number; // cal / (mol * K)
}

/**
 * SantaLucia (1998) unified nearest-neighbor parameters. The table lists all
 * sixteen oriented dinucleotide steps so that either strand may be used for
 * the lookup.
 */
export const SANTA_LUCIA_1998: Record<string, NearestNeighborStep> = {
  AA: { dH: -7.9, dS: -22.2 },
  TT: { dH: -7.9, dS: -22.2 },
  AT: { dH: -7.2, dS: -20.4 },
  TA: { dH: -7.2, dS: -21.3 },
  CA: { dH: -8.5, dS: -22.7 },
  TG: { dH: -8.5, dS: -22.7 },
  GT: { dH: -8.4, dS: -22.4 },
  AC: { dH: -8.4, dS: -22.4 },
  CT: { dH: -7.8, dS: -21.0 },
  AG: { dH: -7.8, dS: -21.0 },
  GA: { dH: -8.2, dS: -22.2 },
  TC: { dH: -8.2, dS: -22.2 },
  CG: { dH: -10.6, dS: -27.2 },
  GC: { dH: -9.8, dS: -24.4 },
  GG: { dH: -8.0, dS: -19.9 },
  CC: { dH: -8.0, dS: -19.9 },
};

export const SANTA_LUCIA_INITIATION = {
  GC: { dH: 0.1, dS: -2.8 },
  AT: { dH: 2.3, dS: 4.1 },
};

const SYMMETRY_ENTROPY = -1.4; // cal / (mol * K)

export interface NearestNeighborSummary {
  deltaH: number;
  deltaS: number;
  gcPercent: number;
}

export function nearestNeighborSummary(sequence: string): NearestNeighborSummary {
  const seq = normalizeDNA(sequence);
  let deltaH = 0;
  let deltaS = 0;
  for (let i = 0; i + 1 < seq.length; i += 1) {
    const step = SANTA_LUCIA_1998[seq.slice(i, i + 2)];
    if (step) {
      deltaH += step.dH;
      deltaS += step.dS;
    }
  }
  if (seq.length) {
    const first = seq[0];
    const last = seq[seq.length - 1];
    const firstInit = first === 'G' || first === 'C' ? SANTA_LUCIA_INITIATION.GC : SANTA_LUCIA_INITIATION.AT;
    const lastInit = last === 'G' || last === 'C' ? SANTA_LUCIA_INITIATION.GC : SANTA_LUCIA_INITIATION.AT;
    deltaH += firstInit.dH + lastInit.dH;
    deltaS += firstInit.dS + lastInit.dS;
  }
  if (isSelfComplementary(seq)) deltaS += SYMMETRY_ENTROPY;
  return { deltaH, deltaS, gcPercent: gcPercentOf(seq) };
}

function effectiveMonovalentMm(conditions: ReactionConditions): number {
  const na = conditions.naMm ?? DEFAULT_REACTION_CONDITIONS.naMm;
  const mg = conditions.mgMm ?? DEFAULT_REACTION_CONDITIONS.mgMm;
  const dntp = conditions.dntpMm ?? DEFAULT_REACTION_CONDITIONS.dntpMm;
  const freeMagnesium = Math.max(0, mg - dntp);
  return Math.max(0.001, na + 120 * Math.sqrt(freeMagnesium));
}

/**
 * Owczarzy et al. (2008) salt correction for the reciprocal melting
 * temperature. The monovalent-only branch follows Owczarzy et al. (2004),
 * while the magnesium-dominant branch uses the 2008 fifteen-coefficient
 * expression with the low-monovalent cross terms.
 */
export function owczarzySaltCorrection(sequence: string, conditions?: ReactionConditions): number {
  const seq = normalizeDNA(sequence);
  const cond = { ...DEFAULT_REACTION_CONDITIONS, ...(conditions ?? {}) };
  if (!seq.length) return 0;
  const gcFraction = gcPercentOf(seq) / 100;
  const na = Math.max(0, cond.naMm);
  const mg = Math.max(0, cond.mgMm);
  const dntp = Math.max(0, cond.dntpMm);
  const freeMagnesium = dntp >= mg ? 1e-11 : (mg - dntp) / 1000;
  const ratio = na === 0 ? 6 : Math.sqrt(freeMagnesium) / (na / 1000);
  if (ratio < 0.22) {
    if (na <= 0) return 0;
    const logNa = Math.log(na / 1000);
    return (4.29 * gcFraction - 3.95) * 1e-5 * logNa + 9.4e-6 * logNa * logNa;
  }
  let a = 3.92e-5;
  let b = -9.11e-6;
  let c = 6.26e-5;
  let d = 1.42e-5;
  let e = -4.82e-4;
  let f = 5.25e-4;
  let g = 8.31e-5;
  if (ratio < 6) {
    const logNa = Math.log(Math.max(1e-6, na / 1000));
    const sqrtNa = Math.sqrt(Math.max(0, na / 1000));
    a = 3.92e-5 * (0.843 - 0.352 * sqrtNa * logNa);
    d = 1.42e-5 * (1.279 - 4.03e-3 * logNa - 8.03e-3 * logNa * logNa);
    g = 8.31e-5 * (0.486 - 0.258 * logNa + 5.25e-3 * logNa * logNa * logNa);
  }
  const logMg = Math.log(freeMagnesium);
  const length = seq.length;
  const terminalTerm = length > 1 ? 1 / (2 * (length - 1)) : 0.5;
  return (
    a +
    b * logMg +
    gcFraction * (c + d * logMg) +
    terminalTerm * (e + f * logMg + g * logMg * logMg)
  );
}

export function meltingTemperature(
  sequence: string,
  conditions?: ReactionConditions,
): { tm: number; deltaH: number; deltaS: number } {
  const seq = normalizeDNA(sequence);
  const cond = { ...DEFAULT_REACTION_CONDITIONS, ...(conditions ?? {}) };
  if (!seq.length) return { tm: 0, deltaH: 0, deltaS: 0 };
  const { deltaH, deltaS } = nearestNeighborSummary(seq);
  const selfComplementary = isSelfComplementary(seq);
  const concentration = Math.max(1e-12, (cond.oligoNm * 1e-9) / (selfComplementary ? 1 : 4));
  const denominator = deltaS + GAS_CONSTANT * Math.log(concentration);
  if (denominator === 0) return { tm: 0, deltaH, deltaS };
  const rawTm = (deltaH * 1000) / denominator;
  const correction = owczarzySaltCorrection(seq, cond);
  if (!Number.isFinite(rawTm) || rawTm <= 0) return { tm: 0, deltaH, deltaS };
  const corrected = 1 / (1 / rawTm + correction) - 273.15;
  return {
    tm: Number.isFinite(corrected) && corrected > -100 ? corrected : 0,
    deltaH,
    deltaS,
  };
}

export function deltaG37(sequence: string, conditions?: ReactionConditions): number {
  const seq = normalizeDNA(sequence);
  if (!seq.length) return 0;
  const cond = { ...DEFAULT_REACTION_CONDITIONS, ...(conditions ?? {}) };
  const { deltaH, deltaS } = nearestNeighborSummary(seq);
  const effectiveNaM = effectiveMonovalentMm(cond) / 1000;
  const saltEntropy = seq.length > 1 ? 0.368 * (seq.length - 1) * Math.log(Math.max(1e-6, effectiveNaM)) : 0;
  return (deltaH * 1000 - 310.15 * (deltaS + saltEntropy)) / 1000;
}

function neighborStepDeltaG(step: string, conditions?: ReactionConditions): number {
  const params = SANTA_LUCIA_1998[step];
  if (!params) return 0;
  const cond = { ...DEFAULT_REACTION_CONDITIONS, ...(conditions ?? {}) };
  const effectiveNaM = effectiveMonovalentMm(cond) / 1000;
  const saltEntropy = 0.368 * Math.log(Math.max(1e-6, effectiveNaM));
  return (params.dH * 1000 - 310.15 * (params.dS + saltEntropy)) / 1000;
}

function isWatsonCrick(a: string, b: string): boolean {
  return (
    (a === 'A' && b === 'T') ||
    (a === 'T' && b === 'A') ||
    (a === 'G' && b === 'C') ||
    (a === 'C' && b === 'G')
  );
}

function isWobble(a: string, b: string): boolean {
  return (a === 'G' && b === 'T') || (a === 'T' && b === 'G');
}

function loopPenalty(loopLength: number, loopSequence: string): number {
  if (loopLength < 3) return Number.POSITIVE_INFINITY;
  const table: Record<number, number> = {
    3: 5.9,
    4: 4.4,
    5: 3.6,
    6: 3.2,
    7: 3.0,
    8: 2.9,
    9: 2.8,
  };
  let penalty = table[loopLength] ?? 2.8 + 1.078 * Math.log(loopLength / 9);
  const stableTetraloops = new Set(['GAAA', 'GCAA', 'GGGG', 'CAAA', 'AGAA', 'TTTC']);
  if (loopLength === 4 && stableTetraloops.has(loopSequence)) penalty -= 1.5;
  return penalty;
}

interface HairpinPrediction {
  deltaG: number;
  ascii: string;
}

interface DuplexPrediction {
  deltaG: number;
  ascii: string;
}

interface DuplexState {
  deltaG: number;
  length: number;
  previous: { i: number; j: number } | null;
}

function hairpinAscii(sequence: string, pairs: Array<[number, number]>): string {
  const marks = new Array(sequence.length).fill(' ');
  for (const [i, j] of pairs) {
    marks[i] = '|';
    marks[j] = '|';
  }
  return `5'-${sequence}-3'\n   ${marks.join('')}`;
}

function duplexAscii(
  top: string,
  bottomOriginal: string,
  pairs: Array<[number, number]>,
): string {
  if (!pairs.length) {
    return `5'-${top}-3'\n   no stable duplex predicted`;
  }
  const bottom = bottomOriginal.split('').reverse().join('');
  const ordered = [...pairs].sort((a, b) => a[0] - b[0]);
  const offset = ordered[0][1] - ordered[0][0];
  const padTop = Math.max(0, -offset);
  const padBottom = Math.max(0, offset);
  const topLine = ' '.repeat(padTop) + top;
  const bottomLine = ' '.repeat(padBottom) + bottom;
  const width = Math.max(topLine.length, bottomLine.length);
  const marks = new Array(width).fill(' ');
  for (const [i, j] of ordered) {
    const column = i + padTop;
    if (column >= 0 && column < width) marks[column] = '|';
  }
  return `5'-${topLine.padEnd(width)}-3'\n   ${marks.join('')}\n3'-${bottomLine.padEnd(width)}-5'`;
}

/**
 * Exhaustive dynamic-programming search for the most stable intramolecular
 * hairpin. A closing pair (i, j) is extended inwards; the stem free energy is
 * the sum of nearest-neighbor stack energies and the loop penalty is a
 * Jacobson-Stockmayer style function with a tetraloop bonus.
 */
export function predictHairpin(sequence: string, conditions?: ReactionConditions): HairpinPrediction {
  const seq = normalizeDNA(sequence);
  const length = seq.length;
  if (length < 6) return { deltaG: 0, ascii: hairpinAscii(seq, []) };
  let bestDeltaG = 0;
  let bestPairs: Array<[number, number]> = [];
  for (let i = 0; i < length; i += 1) {
    for (let j = i + 4; j < length; j += 1) {
      if (!isWatsonCrick(seq[i], seq[j]) && !isWobble(seq[i], seq[j])) continue;
      const maxStem = Math.floor((j - i - 2) / 2);
      for (let stem = 1; stem <= maxStem; stem += 1) {
        let valid = true;
        for (let t = 0; t < stem; t += 1) {
          const left = seq[i + t];
          const right = seq[j - t];
          if (!isWatsonCrick(left, right) && !isWobble(left, right)) {
            valid = false;
            break;
          }
        }
        if (!valid) continue;
        const loopLength = j - i - 2 * stem + 1;
        if (loopLength < 3) continue;
        let energy = 0.5;
        for (let t = 0; t + 1 < stem; t += 1) {
          energy += neighborStepDeltaG(seq.slice(i + t, i + t + 2), conditions);
        }
        energy += loopPenalty(loopLength, seq.slice(i + stem, j - stem + 1));
        if (energy < bestDeltaG) {
          bestDeltaG = energy;
          bestPairs = [];
          for (let t = 0; t < stem; t += 1) bestPairs.push([i + t, j - t]);
        }
      }
    }
  }
  return {
    deltaG: Number(bestDeltaG.toFixed(3)),
    ascii: hairpinAscii(seq, bestPairs),
  };
}

/**
 * Dynamic-programming alignment of two antiparallel oligonucleotides. Each
 * state stores the best helix ending at a complementary base pair; extension
 * adds the nearest-neighbor stack free energy, which makes the search O(n*m).
 */
export function predictDuplex(
  topSequence: string,
  bottomSequence: string,
  conditions?: ReactionConditions,
): DuplexPrediction {
  const top = normalizeDNA(topSequence);
  const bottom = normalizeDNA(bottomSequence);
  const bottomReversed = bottom.split('').reverse().join('');
  const n = top.length;
  const m = bottomReversed.length;
  if (n < 2 || m < 2) {
    return {
      deltaG: 0,
      ascii: duplexAscii(top, bottom, []),
    };
  }
  const dp: Array<Array<DuplexState | null>> = Array.from({ length: n }, () =>
    Array.from({ length: m }, () => null),
  );
  let best: { deltaG: number; i: number; j: number } = { deltaG: 0, i: -1, j: -1 };
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      if (!isWatsonCrick(top[i], bottomReversed[j]) && !isWobble(top[i], bottomReversed[j])) {
        continue;
      }
      let state: DuplexState = { deltaG: 0.5, length: 1, previous: null };
      if (i > 0 && j > 0) {
        const previous = dp[i - 1][j - 1];
        if (previous) {
          const stack = neighborStepDeltaG(top.slice(i - 1, i + 1), conditions);
          const candidate = previous.deltaG + stack;
          if (candidate < state.deltaG) {
            state = { deltaG: candidate, length: previous.length + 1, previous: { i: i - 1, j: j - 1 } };
          }
        }
      }
      dp[i][j] = state;
      if (state.length >= 3 && state.deltaG < best.deltaG) {
        best = { deltaG: state.deltaG, i, j };
      }
    }
  }
  if (best.i < 0 || best.j < 0) {
    return { deltaG: 0, ascii: duplexAscii(top, bottom, []) };
  }
  const pairs: Array<[number, number]> = [];
  let cursor: { i: number; j: number } | null = { i: best.i, j: best.j };
  while (cursor) {
    pairs.push([cursor.i, cursor.j]);
    const state: DuplexState | null = dp[cursor.i][cursor.j];
    cursor = state?.previous ?? null;
  }
  pairs.reverse();
  return {
    deltaG: Number(best.deltaG.toFixed(3)),
    ascii: duplexAscii(top, bottom, pairs),
  };
}

export interface OligoThermo {
  tm: number;
  deltaH: number;
  deltaS: number;
  deltaG37: number;
  gcPercent: number;
  has3PrimeGCClamp: boolean;
  hairpinDeltaG: number;
  selfDimerDeltaG: number;
  hairpinAscii: string;
  selfDimerAscii: string;
}

export function evaluateOligoThermodynamics(
  sequence: string,
  conditions?: ReactionConditions,
): OligoThermo {
  const seq = normalizeDNA(sequence);
  const summary = nearestNeighborSummary(seq);
  const tmResult = meltingTemperature(seq, conditions);
  const hairpin = predictHairpin(seq, conditions);
  const selfDimer = predictDuplex(seq, seq, conditions);
  return {
    tm: tmResult.tm,
    deltaH: summary.deltaH,
    deltaS: summary.deltaS,
    deltaG37: deltaG37(seq, conditions),
    gcPercent: summary.gcPercent,
    has3PrimeGCClamp: has3PrimeGCClamp(seq),
    hairpinDeltaG: hairpin.deltaG,
    selfDimerDeltaG: selfDimer.deltaG,
    hairpinAscii: hairpin.ascii,
    selfDimerAscii: selfDimer.ascii,
  };
}

export function calcCrossDimer(
  a: string,
  b: string,
  conditions?: ReactionConditions,
): { deltaG: number; ascii: string } {
  const prediction = predictDuplex(a, b, conditions);
  return { deltaG: prediction.deltaG, ascii: prediction.ascii };
}

export function tmDifference(a: number, b: number): number {
  return Math.abs(a - b);
}

export function normalizeConditions(conditions?: ReactionConditions): Required<ReactionConditions> {
  const merged = { ...DEFAULT_REACTION_CONDITIONS, ...(conditions ?? {}) };
  return {
    naMm: clamp(merged.naMm, 0, 5000),
    mgMm: clamp(merged.mgMm, 0, 1000),
    dntpMm: clamp(merged.dntpMm, 0, 1000),
    oligoNm: clamp(merged.oligoNm, 0.001, 1e7),
  };
}
