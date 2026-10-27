// Built-in laboratory examples: pUC19 (NCBI L09137) and pEGFP-N1 (NCBI U55762),
// auto-annotated on load, plus a synthetic Sanger read across EGFP.
import type { PlasmidDocument, SangerTraceData } from '../../types/schema';
import { parseGenBankString } from '../../modules/io-adapter';
import { autoAnnotateFeatures } from '../../modules/seq-engine';
import { createSyntheticTrace } from '../../modules/alignment-gel';
import pUC19Gb from './pUC19.gb?raw';
import pEGFPGb from './pEGFP-N1.gb?raw';

export async function loadSample(gbk: string, name: string): Promise<PlasmidDocument> {
  const parsed = await parseGenBankString(gbk);
  const base: PlasmidDocument = {
    ...parsed,
    // A stable id lets crash recovery match an edited sample to the one loaded on start.
    id: `sample-${name}`,
    name,
    topology: 'circular',
    // Drop the whole-record 'source' feature and misc_feature duplicates of typed features.
    features: parsed.features.filter(
      (f, _, all) =>
        (f.end - f.start < parsed.length || f.type === 'CDS') &&
        !(f.type === 'misc_feature' && all.some((g) => g !== f && g.type !== 'misc_feature' && g.start === f.start && g.end === f.end)),
    ),
  };
  const taken = new Set(base.features.map((f) => `${f.start}:${f.end}`));
  const found = autoAnnotateFeatures(base).filter((f) => !taken.has(`${f.start}:${f.end}`));
  return { ...base, features: [...base.features, ...found] };
}

export async function loadSampleLibrary(): Promise<{ docs: PlasmidDocument[]; traces: Record<string, SangerTraceData[]> }> {
  const [pUC19, pEGFP] = await Promise.all([
    loadSample(pUC19Gb, 'pUC19'),
    loadSample(pEGFPGb, 'pEGFP-N1'),
  ]);

  const egfp = pEGFP.features.find((f) => f.type === 'CDS' && /egfp/i.test(f.name));
  const readStart = egfp ? egfp.start + 40 : 718;
  // A missense substitution and one heterozygous position inside the EGFP CDS (absolute coordinates).
  const subAt = readStart + 150;
  const hetAt = readStart + 420;
  const trace = createSyntheticTrace(pEGFP.sequence, {
    fileName: 'pEGFP-N1_EGFP-F.ab1',
    start: readStart,
    length: 720,
    mutations: [{ index: subAt, base: pEGFP.sequence[subAt] === 'A' ? 'G' : 'A' }],
    heterozygous: [{ index: hetAt, base: pEGFP.sequence[hetAt] === 'C' ? 'T' : 'C' }],
    seed: 42,
  });

  return { docs: [pUC19, pEGFP], traces: { [pEGFP.id]: [trace] } };
}
