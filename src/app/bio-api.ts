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
import { parseFastq } from '../modules/io-adapter';

/** Parse FASTQ text and convert the first `max` reads to traces; parsing a large file stays off the main thread. */
function fastqToTraces(text: string, max: number) {
  const reads = parseFastq(text);
  return { traces: readsToTraces(reads.slice(0, max)), total: reads.length };
}

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
  fastqToTraces,
};

export type BioApi = typeof bioApi;
export type BioFn = keyof BioApi;

export interface BioRequest {
  id: number;
  fn: BioFn;
  args: unknown[];
  /** The document revision a task was computed for, when it derives from one. */
  doc?: { docId: string; revision: number };
}

export type BioResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
