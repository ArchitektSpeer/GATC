// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
/*
 * Nearest-neighbour thermodynamics for DNA oligonucleotides. Watson-Crick
 * stacking follows SantaLucia (1998); mismatch, terminal-contact, bulge and
 * loop terms follow SantaLucia & Hicks (2004); salt and magnesium corrections
 * follow Owczarzy et al. (2008). All secondary-structure energies are reported
 * at 37 degrees Celsius.
 */
import {
  GAS_CONSTANT,
  clamp,
  complementBase,
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

const STRUCTURE_TEMPERATURE = 310.15; // K
const STRUCTURE_MAX_LOOP = 11;
const HAIRPIN_MAX_LOOP = 9;

/**
 * Structure parameters use the nearest-neighbour model of SantaLucia (1998)
 * and the loop, bulge, mismatch and terminal-contact values summarised by
 * SantaLucia & Hicks (2004). Values are expressed as local lookup tables so
 * that the stacking and loop terms can be chosen independently for the
 * intramolecular and intermolecular searches.
 */
const DUPLEX_MISMATCH_PENALTIES: Record<string, number> = {
  'G/G': -0.5,
  'A/A': -0.1,
  'C/C': 0.9,
  'T/T': 0.3,
  'G/A': -0.4,
  'A/G': 0.3,
  'C/T': 0.3,
  'T/C': 0.3,
  'A/C': 0.3,
  'C/A': 0.3,
  'G/T': 0.9,
  'T/G': 0.3,
};

const DUPLEX_MISMATCH_STEP = 0.45; // kcal/mol
const DUPLEX_DANGLE = -0.5; // kcal/mol per unpaired terminal base
const DUPLEX_AT_TERMINAL = 0.6; // kcal/mol for an A/T terminal pair
const DUPLEX_MISMATCH_TERMINAL = 0.3; // kcal/mol for a terminal mismatch

const DUPLEX_BULGE = {
  one: 3.5,
  two: 3.2,
  base: 3.0,
  slope: 1.08,
};

const DUPLEX_INTERNAL_LOOP = {
  oneByOne: 2.7,
  oneByTwo: 2.3,
  twoByTwo: 3.2,
  base: 2.4,
  slope: 1.08,
};

const HAIRPIN_LOOP_PENALTIES: Record<number, number> = {
  3: 3.2,
  4: 3.1,
  5: 3.05,
  6: 3.0,
  7: 2.95,
  8: 2.9,
  9: 2.85,
};

const HAIRPIN_LOOP_FAR_BASE = 2.85;
const HAIRPIN_LOOP_FAR_SLOPE = 1.4;

/**
 * Small terminal-contact correction at the hairpin closing pair. The first
 * unpaired base stacks against the closing base pair; the signs follow the
 * published terminal-mismatch trends and keep the loop table transferable
 * between closing-pair contexts.
 */
const HAIRPIN_TERMINAL_CONTACT: Record<string, number> = {
  G: -0.1,
  C: -0.05,
  A: 0.05,
  T: 0.1,
};

const HAIRPIN_BULGE = {
  one: 3.3,
  two: 3.0,
  base: 3.3,
  slope: 1.08,
};

const HAIRPIN_INTERNAL_LOOP = {
  oneByOne: 2.0,
  oneByTwo: 2.9,
  twoByTwo: 2.5,
  base: 2.5,
  slope: 1.08,
};

interface HairpinPrediction {
  deltaG: number;
  ascii: string;
}

interface DuplexPrediction {
  deltaG: number;
  ascii: string;
}

interface StructureContext {
  saltPerStack: number;
}

function structureConditions(conditions?: ReactionConditions): StructureContext {
  const merged = { ...DEFAULT_REACTION_CONDITIONS, ...(conditions ?? {}) };
  const effectiveNaM = effectiveMonovalentMm(merged) / 1000;
  const saltEntropy = 0.368 * Math.log(Math.max(1e-6, effectiveNaM));
  return {
    saltPerStack: (-STRUCTURE_TEMPERATURE * saltEntropy) / 1000,
  };
}

function stackEnergy(step: string, context: StructureContext): number {
  const parameters = SANTA_LUCIA_1998[step];
  if (!parameters) return context.saltPerStack;
  return (
    (parameters.dH * 1000 - STRUCTURE_TEMPERATURE * parameters.dS) / 1000 +
    context.saltPerStack
  );
}

function initiationEnergy(base: string): number {
  const parameters =
    base === 'G' || base === 'C' ? SANTA_LUCIA_INITIATION.GC : SANTA_LUCIA_INITIATION.AT;
  return (parameters.dH * 1000 - STRUCTURE_TEMPERATURE * parameters.dS) / 1000;
}

function isCanonicalPair(top: string, bottom: string): boolean {
  return (
    (top === 'A' && bottom === 'T') ||
    (top === 'T' && bottom === 'A') ||
    (top === 'G' && bottom === 'C') ||
    (top === 'C' && bottom === 'G')
  );
}

function mismatchPenalty(top: string, bottom: string): number {
  return (
    DUPLEX_MISMATCH_PENALTIES[`${top}/${bottom}`] ??
    DUPLEX_MISMATCH_PENALTIES[`${bottom}/${top}`] ??
    0.3
  );
}

function duplexTerminalPenalty(top: string, bottom: string): number {
  if (isCanonicalPair(top, bottom)) {
    return top === 'A' || top === 'T' ? DUPLEX_AT_TERMINAL : 0;
  }
  return DUPLEX_MISMATCH_TERMINAL;
}

function duplexDangle(topFlank: boolean, bottomFlank: boolean): number {
  return DUPLEX_DANGLE * ((topFlank ? 1 : 0) + (bottomFlank ? 1 : 0));
}

function bulgePenalty(size: number): number {
  if (size === 1) return DUPLEX_BULGE.one;
  if (size === 2) return DUPLEX_BULGE.two;
  return DUPLEX_BULGE.base + DUPLEX_BULGE.slope * Math.log(size);
}

function internalLoopPenalty(left: number, right: number): number {
  if (left === 1 && right === 1) return DUPLEX_INTERNAL_LOOP.oneByOne;
  if ((left === 1 && right === 2) || (left === 2 && right === 1)) {
    return DUPLEX_INTERNAL_LOOP.oneByTwo;
  }
  if (left === 2 && right === 2) return DUPLEX_INTERNAL_LOOP.twoByTwo;
  return DUPLEX_INTERNAL_LOOP.base + DUPLEX_INTERNAL_LOOP.slope * Math.log(left + right);
}

function hairpinBulgePenalty(size: number): number {
  if (size === 1) return HAIRPIN_BULGE.one;
  if (size === 2) return HAIRPIN_BULGE.two;
  return HAIRPIN_BULGE.base + HAIRPIN_BULGE.slope * Math.log(size);
}

function hairpinInternalLoopPenalty(left: number, right: number): number {
  if (left === 1 && right === 1) return HAIRPIN_INTERNAL_LOOP.oneByOne;
  if ((left === 1 && right === 2) || (left === 2 && right === 1)) {
    return HAIRPIN_INTERNAL_LOOP.oneByTwo;
  }
  if (left === 2 && right === 2) return HAIRPIN_INTERNAL_LOOP.twoByTwo;
  return (
    HAIRPIN_INTERNAL_LOOP.base +
    HAIRPIN_INTERNAL_LOOP.slope * Math.log(left + right)
  );
}

function hairpinLoopPenalty(length: number, firstLoopBase: string): number {
  const initiation =
    HAIRPIN_LOOP_PENALTIES[length] ??
    HAIRPIN_LOOP_FAR_BASE + HAIRPIN_LOOP_FAR_SLOPE * Math.log(length / 9);
  return initiation + (HAIRPIN_TERMINAL_CONTACT[firstLoopBase] ?? 0);
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
  const columns: Array<{ top: string; bottom: string; mark: string }> = [];
  let topCursor = 0;
  let bottomCursor = 0;
  const appendUnpaired = (topEnd: number, bottomEnd: number): void => {
    const topSegment = top.slice(topCursor, topEnd);
    const bottomSegment = bottom.slice(bottomCursor, bottomEnd);
    const width = Math.max(topSegment.length, bottomSegment.length);
    for (let index = 0; index < width; index += 1) {
      columns.push({
        top: topSegment[index] ?? ' ',
        bottom: bottomSegment[index] ?? ' ',
        mark: ' ',
      });
    }
    topCursor = topEnd;
    bottomCursor = bottomEnd;
  };
  for (const [i, j] of ordered) {
    appendUnpaired(i, j);
    columns.push({
      top: top[i] ?? ' ',
      bottom: bottom[j] ?? ' ',
      mark: '|',
    });
    topCursor = i + 1;
    bottomCursor = j + 1;
  }
  appendUnpaired(top.length, bottom.length);
  return `5'-${columns.map((column) => column.top).join('')}-3'\n   ${columns
    .map((column) => column.mark)
    .join('')}\n3'-${columns.map((column) => column.bottom).join('')}-5'`;
}

/**
 * Minimum-free-energy hairpin search. A closing pair (i, j) is extended
 * inwards through stacks, single- or multi-nucleotide bulges and internal
 * loops; the terminal loop is treated with the Jacobson-Stockmayer length
 * extrapolation and a small terminal-contact correction.
 */
export function predictHairpin(sequence: string, conditions?: ReactionConditions): HairpinPrediction {
  const seq = normalizeDNA(sequence);
  const length = seq.length;
  if (length < 6) return { deltaG: 0, ascii: hairpinAscii(seq, []) };
  const context = structureConditions(conditions);
  const total = length * length;
  const dp = new Float64Array(total);
  dp.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(total);
  previous.fill(-1);
  let bestEnergy = 0;
  let bestIndex = -1;
  for (let span = 4; span <= length; span += 1) {
    for (let i = 0; i + span <= length; i += 1) {
      const j = i + span - 1;
      if (!isCanonicalPair(seq[i], seq[j])) continue;
      const index = i * length + j;
      let energy = Number.POSITIVE_INFINITY;
      let back = -1;
      const loopLength = j - i - 1;
      if (loopLength >= 3) {
        const penalty = hairpinLoopPenalty(loopLength, seq[i + 1]);
        if (penalty < energy) {
          energy = penalty;
          back = -1;
        }
      }
      if (i + 1 < j - 1 && isCanonicalPair(seq[i + 1], seq[j - 1])) {
        const inner = dp[(i + 1) * length + (j - 1)];
        if (Number.isFinite(inner)) {
          const candidate = stackEnergy(seq.slice(i, i + 2), context) + inner;
          if (candidate < energy) {
            energy = candidate;
            back = (i + 1) * length + (j - 1);
          }
        }
      }
      for (let leftGap = 1; leftGap <= HAIRPIN_MAX_LOOP; leftGap += 1) {
        const innerTop = i + 1 + leftGap;
        if (innerTop >= j - 1) break;
        if (!isCanonicalPair(seq[innerTop], seq[j - 1])) continue;
        const inner = dp[innerTop * length + (j - 1)];
        if (!Number.isFinite(inner)) continue;
        const candidate = hairpinBulgePenalty(leftGap) + inner;
        if (candidate < energy) {
          energy = candidate;
          back = innerTop * length + (j - 1);
        }
      }
      for (let rightGap = 1; rightGap <= HAIRPIN_MAX_LOOP; rightGap += 1) {
        const innerBottom = j - 1 - rightGap;
        if (innerBottom <= i + 1) break;
        if (!isCanonicalPair(seq[i + 1], seq[innerBottom])) continue;
        const inner = dp[(i + 1) * length + innerBottom];
        if (!Number.isFinite(inner)) continue;
        const candidate = hairpinBulgePenalty(rightGap) + inner;
        if (candidate < energy) {
          energy = candidate;
          back = (i + 1) * length + innerBottom;
        }
      }
      for (let leftGap = 1; leftGap <= HAIRPIN_MAX_LOOP; leftGap += 1) {
        const innerTop = i + 1 + leftGap;
        if (innerTop >= j - 2) break;
        for (let rightGap = 1; rightGap <= HAIRPIN_MAX_LOOP; rightGap += 1) {
          const innerBottom = j - 1 - rightGap;
          if (innerTop >= innerBottom) break;
          if (!isCanonicalPair(seq[innerTop], seq[innerBottom])) continue;
          const inner = dp[innerTop * length + innerBottom];
          if (!Number.isFinite(inner)) continue;
          const candidate =
            hairpinInternalLoopPenalty(leftGap, rightGap) + inner;
          if (candidate < energy) {
            energy = candidate;
            back = innerTop * length + innerBottom;
          }
        }
      }
      if (Number.isFinite(energy)) {
        dp[index] = energy;
        previous[index] = back;
        if (energy < bestEnergy) {
          bestEnergy = energy;
          bestIndex = index;
        }
      }
    }
  }
  if (bestIndex < 0) {
    return { deltaG: 0, ascii: hairpinAscii(seq, []) };
  }
  const pairs: Array<[number, number]> = [];
  let cursor = bestIndex;
  while (cursor >= 0) {
    pairs.push([Math.floor(cursor / length), cursor % length]);
    cursor = previous[cursor];
  }
  pairs.reverse();
  const rounded = Number(bestEnergy.toFixed(3));
  return {
    deltaG: rounded < 0 ? rounded : 0,
    ascii: hairpinAscii(seq, pairs),
  };
}

/**
 * Minimum-free-energy duplex search. The two strands are compared in every
 * antiparallel register; each state stores the best helix ending at a base
 * pair and may be extended by a stack, a bulge, or an internal loop. Terminal
 * base pairs contribute an initiation term plus a sequence-dependent terminal
 * contact, and unpaired overhanging bases contribute a dangling-end term.
 */
export function predictDuplex(
  topSequence: string,
  bottomSequence: string,
  conditions?: ReactionConditions,
): DuplexPrediction {
  const top = normalizeDNA(topSequence);
  const bottom = normalizeDNA(bottomSequence);
  const pairingBottom = reverseComplement(bottom);
  const n = top.length;
  const m = pairingBottom.length;
  if (n < 2 || m < 2) {
    return {
      deltaG: 0,
      ascii: duplexAscii(top, bottom, []),
    };
  }
  const context = structureConditions(conditions);
  const total = n * m;
  const dp = new Float64Array(total);
  dp.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(total);
  previous.fill(-1);
  let bestEnergy = 0;
  let bestIndex = -1;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const index = i * m + j;
      const bottomBase = complementBase(pairingBottom[j]);
      const canonical = isCanonicalPair(top[i], bottomBase);
      const pairPenalty = canonical ? 0 : mismatchPenalty(top[i], bottomBase);
      const startEnergy =
        initiationEnergy(top[i]) +
        pairPenalty +
        duplexTerminalPenalty(top[i], bottomBase) +
        duplexDangle(i > 0, j > 0);
      let energy = startEnergy;
      let back = -1;
      if (i > 0 && j > 0) {
        const previousIndex = index - m - 1;
        if (Number.isFinite(dp[previousIndex])) {
          const previousBottom = complementBase(pairingBottom[j - 1]);
          const previousCanonical = isCanonicalPair(top[i - 1], previousBottom);
          let step: number;
          if (canonical && previousCanonical) {
            step = stackEnergy(top.slice(i - 1, i + 1), context);
          } else {
            step =
              DUPLEX_MISMATCH_STEP +
              (canonical ? 0 : pairPenalty) +
              (previousCanonical ? 0 : mismatchPenalty(top[i - 1], previousBottom));
          }
          const candidate = dp[previousIndex] + step;
          if (candidate < energy) {
            energy = candidate;
            back = previousIndex;
          }
        }
      }
      for (let leftGap = 0; leftGap <= STRUCTURE_MAX_LOOP; leftGap += 1) {
        for (let rightGap = 0; rightGap <= STRUCTURE_MAX_LOOP; rightGap += 1) {
          if (leftGap === 0 && rightGap === 0) continue;
          const previousTop = i - leftGap - 1;
          const previousBottom = j - rightGap - 1;
          if (previousTop < 0 || previousBottom < 0) continue;
          const previousIndex = previousTop * m + previousBottom;
          if (!Number.isFinite(dp[previousIndex])) continue;
          let loop: number;
          if (rightGap === 0) {
            loop = bulgePenalty(leftGap);
          } else if (leftGap === 0) {
            loop = bulgePenalty(rightGap);
          } else {
            loop = internalLoopPenalty(leftGap, rightGap);
          }
          const candidate = dp[previousIndex] + loop;
          if (candidate < energy) {
            energy = candidate;
            back = previousIndex;
          }
        }
      }
      dp[index] = energy;
      previous[index] = back;
      const endEnergy =
        energy +
        initiationEnergy(top[i]) +
        pairPenalty +
        duplexTerminalPenalty(top[i], bottomBase) +
        duplexDangle(i + 1 < n, j + 1 < m);
      if (endEnergy < bestEnergy) {
        bestEnergy = endEnergy;
        bestIndex = index;
      }
    }
  }
  if (bestIndex < 0) {
    return { deltaG: 0, ascii: duplexAscii(top, bottom, []) };
  }
  const pairs: Array<[number, number]> = [];
  let cursor = bestIndex;
  while (cursor >= 0) {
    pairs.push([Math.floor(cursor / m), cursor % m]);
    cursor = previous[cursor];
  }
  pairs.reverse();
  const rounded = Number(bestEnergy.toFixed(3));
  return {
    deltaG: rounded < 0 ? rounded : 0,
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
