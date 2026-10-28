// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
export type {
  ReactionConditions,
  OligoThermo,
} from './thermo';
export {
  calcCrossDimer,
  evaluateOligoThermodynamics,
  meltingTemperature,
  predictDuplex,
  predictHairpin,
  SANTA_LUCIA_1998,
  SANTA_LUCIA_INITIATION,
  owczarzySaltCorrection,
  deltaG37,
} from './thermo';

export type {
  PrimerDesignOptions,
  MutationSpec,
  SilentSiteSuggestion,
  PrimerBindingHit,
} from './primer';
export {
  buildPrimer,
  designPrimerPair,
  designMutagenesisPrimers,
  findPrimerBindingSites,
} from './primer';

export type {
  EnzymeDefinition,
  EnzymeCutCoordinates,
  MethylationProfile,
  OverhangFidelity,
} from './enzymes';
export {
  COMMON_ENZYMES,
  NEB_LEADER_BASES,
  cutCoordinates,
  cutEnds,
  endsCompatible,
  enzymeByName,
  findCutSites,
  isMethylationBlocked,
  isTypeIIS,
  makeEnzyme,
  recommendedLeader,
  resolveEnzyme,
  reverseEnd,
  scoreOverhang,
} from './enzymes';

export {
  simulateDigestion,
  bluntEnds,
  simulateLigation,
  simulateGibsonAssembly,
  designGibsonPrimers,
  simulateGoldenGateAssembly,
  designGoldenGatePrimers,
  simulateGatewayBP,
  simulateGatewayLR,
  simulateMultiSiteGatewayLR,
  simulatePCR,
  simulateOverlapExtensionPCR,
  GATEWAY_ATT_SITES,
} from './cloning';

export type {
  CloningProductResult,
} from './assembly';
export {
  LIC_DEFAULT_TAILS,
  addATailing,
  designLICPrimers,
  simulateGCCloning,
  simulateLIC,
  simulateTACloning,
  simulateTOPOCloning,
} from './assembly';

export type {
  DuplexEnd,
  OligoAnnealingOptions,
  OligoAnnealingResult,
  AnnealedOligoDesign,
} from './oligo';
export { annealOligos, designAnnealedOligos, describeEnd } from './oligo';

export type { HomologyAssemblyKit } from './fragment-assembly';
export {
  designHomologyAssemblyPrimers,
  simulateInsertFragment,
} from './fragment-assembly';

export type { RecombinationSite } from './recombination';
export {
  RECOMBINATION_SITES,
  findRecombinationSites,
  simulateRecombinase,
} from './recombination';

export type {
  SlicedDocumentData,
  MutationAdjustment,
  StrandedMotifMatch,
} from './utils';
export {
  CODON_TABLE,
  SYNONYMOUS_CODONS,
  AMINO_ACID_NAMES,
  applySequenceMutation,
  adjustFeaturesForMutation,
  cloneDocument,
  complementBase,
  findMotifOnBothStrands,
  findMotifOnlyPositions,
  findMotifPositions,
  gcPercentOf,
  has3PrimeGCClamp,
  makeDocument,
  makeHistoryNode,
  mod,
  normalizeDNA,
  rangeLength,
  reverseComplement,
  reverseSequence,
  sequenceSlice,
  sliceDocumentData,
  translateSequence,
  uid,
} from './utils';
