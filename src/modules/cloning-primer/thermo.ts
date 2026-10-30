// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
/*
 * Nearest-neighbour thermodynamics for DNA oligonucleotides. Watson-Crick
 * stacking follows SantaLucia (1998) and the salt and magnesium corrections
 * follow Owczarzy et al. (2008), which together give the melting temperature.
 * Secondary structure - the hairpin an oligo folds into and the duplex two
 * oligos form - comes from primer3's own thal (lib/wasm/thal) rather than a
 * second implementation of it here, and is reported at 37 degrees Celsius.
 */
import {
  duplex as duplexStructure,
  hairpin as hairpinStructure,
  type ThalConditions,
} from '../../lib/wasm/thal';
import {
  GAS_CONSTANT,
  clamp,
  gcPercentOf,
  has3PrimeGCClamp,
  isSelfComplementary,
  normalizeDNA,
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

interface HairpinPrediction {
  deltaG: number;
  ascii: string;
}

interface DuplexPrediction {
  deltaG: number;
  ascii: string;
}

/**
 * The hairpin an oligo folds into and the duplex two oligos form, both from
 * primer3's thermodynamic alignment compiled to WebAssembly (lib/wasm/thal).
 * The drawing comes back from the same call as the energy, so the picture and
 * the number beside it are always the same structure.
 */
function thalConditions(conditions?: ReactionConditions): ThalConditions {
  const merged = { ...DEFAULT_REACTION_CONDITIONS, ...conditions };
  return {
    monovalentMm: merged.naMm,
    divalentMm: merged.mgMm,
    dntpMm: merged.dntpMm,
    oligoNm: merged.oligoNm,
    temperatureC: 37,
  };
}

/** primer3 writes its drawing with escaped newlines and an HTML degree sign. */
function fromThal(result: { deltaG: number; structure: string } | null): HairpinPrediction {
  if (!result) {
    throw new Error('primer3 thermodynamics is not loaded; call initThal() before using it');
  }
  return {
    deltaG: result.deltaG,
    ascii: result.structure.replace(/\\n/g, '\n').replace(/&deg;/g, '\u00b0').trimEnd(),
  };
}

export function predictHairpin(sequence: string, conditions?: ReactionConditions): HairpinPrediction {
  const seq = normalizeDNA(sequence);
  if (seq.length < 6) return { deltaG: 0, ascii: '' };
  return fromThal(hairpinStructure(seq, thalConditions(conditions)));
}

export function predictDuplex(
  topSequence: string,
  bottomSequence: string,
  conditions?: ReactionConditions,
): DuplexPrediction {
  const top = normalizeDNA(topSequence);
  const bottom = normalizeDNA(bottomSequence);
  if (!top.length || !bottom.length) return { deltaG: 0, ascii: '' };
  return fromThal(duplexStructure(top, bottom, thalConditions(conditions)));
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
