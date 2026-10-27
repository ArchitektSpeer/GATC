// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
export {
  parseAb1Trace,
  mottTrim,
  detectSecondaryPeaks
} from './abif';
export type { SecondaryPeakCall } from './abif';

export {
  gotohLocalAlign,
  alignTraceToPlasmid
} from './alignment';
export type { GotohScoring } from './alignment';

export { pairwiseAlign } from './pairwise';
export type { PairwiseMode, PairwiseOptions, PairwiseResult } from './pairwise';

export { multipleSequenceAlignment } from './msa';
export type { MsaInput, MsaOptions, MsaResult, MsaRow } from './msa';

export type { SequenceType } from './scoring';

export {
  DNA_LADDERS,
  computeMigration,
  simulateVirtualGel
} from './gel';
export type {
  GelSampleInput,
  GelRunParams,
  LadderName,
  LadderBand,
  GelConformation
} from './gel';

export { createSyntheticTrace } from './synthetic';
export type { SyntheticTraceOptions } from './synthetic';

export { summarizeTraceCoverage } from './coverage';
export type {
  CoverageCall,
  CoverageDiscrepancy,
  CoverageOptions,
  CoverageStatus,
  CoverageSummary
} from './coverage';

export { alignReadsToReference, readsToTraces } from './reads';
export type {
  ReadAlignment,
  ReadAlignmentOptions,
  ReadMismatch,
  SequencingRead
} from './reads';
