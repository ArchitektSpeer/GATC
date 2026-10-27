// Compute-heavy functions from Modules 2/3/4 exposed through a single table,
// shared by the Web Worker and the synchronous fallback.
import {
  findCutSites,
  findAllORFs,
  autoAnnotateFeatures,
  mutatePlasmidSequence,
  reverseComplementPlasmid,
  rotateCircularOrigin,
  searchMotif,
  backTranslate,
  recommendDoubleDigestBuffer,
} from '../modules/seq-engine';
import {
  evaluateOligoThermodynamics,
  calcCrossDimer,
  designPrimerPair,
  designMutagenesisPrimers,
  simulateDigestion,
  bluntEnds,
  simulateLigation,
  simulateGibsonAssembly,
  designGibsonPrimers,
  simulateGoldenGateAssembly,
  simulateGatewayBP,
  simulateGatewayLR,
  simulatePCR,
  simulateOverlapExtensionPCR,
  addATailing,
  simulateTACloning,
  simulateTOPOCloning,
  simulateLIC,
  designLICPrimers,
  findRecombinationSites,
  simulateRecombinase,
  simulateMultiSiteGatewayLR,
  simulateGCCloning,
  designHomologyAssemblyPrimers,
  simulateInsertFragment,
  findPrimerBindingSites,
} from '../modules/cloning-primer';
import {
  parseAb1Trace,
  alignTraceToPlasmid,
  simulateVirtualGel,
  multipleSequenceAlignment,
  pairwiseAlign,
  summarizeTraceCoverage,
  alignReadsToReference,
  readsToTraces,
} from '../modules/alignment-gel';

export const bioApi = {
  findCutSites,
  findAllORFs,
  autoAnnotateFeatures,
  mutatePlasmidSequence,
  reverseComplementPlasmid,
  rotateCircularOrigin,
  evaluateOligoThermodynamics,
  calcCrossDimer,
  designPrimerPair,
  designMutagenesisPrimers,
  simulateDigestion,
  bluntEnds,
  simulateLigation,
  simulateGibsonAssembly,
  designGibsonPrimers,
  simulateGoldenGateAssembly,
  simulateGatewayBP,
  simulateGatewayLR,
  simulatePCR,
  simulateOverlapExtensionPCR,
  parseAb1Trace,
  alignTraceToPlasmid,
  simulateVirtualGel,
  searchMotif,
  backTranslate,
  addATailing,
  simulateTACloning,
  simulateTOPOCloning,
  simulateLIC,
  designLICPrimers,
  findRecombinationSites,
  simulateRecombinase,
  multipleSequenceAlignment,
  pairwiseAlign,
  simulateMultiSiteGatewayLR,
  simulateGCCloning,
  designHomologyAssemblyPrimers,
  simulateInsertFragment,
  findPrimerBindingSites,
  summarizeTraceCoverage,
  alignReadsToReference,
  readsToTraces,
  recommendDoubleDigestBuffer,
};

export type BioApi = typeof bioApi;
export type BioFn = keyof BioApi;

export interface BioRequest {
  id: number;
  fn: BioFn;
  args: unknown[];
}

export type BioResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
