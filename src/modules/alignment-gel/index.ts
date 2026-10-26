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
