// End-to-end pipelines across modules on the bundled real plasmids.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PlasmidDocument, SangerTraceData } from '../types/schema';
import { parseBioFile, exportPlasmidToGenBank } from '../modules/io-adapter';
import { COMMERCIAL_ENZYMES, getEnzymeByName } from '../modules/seq-engine';
import { buildPlasmidContextPrompt, validateAction } from '../modules/ai-copilot';
import { callBio, callBioSync } from './bio-client';
import { loadSampleLibrary } from './samples';

let pUC19: PlasmidDocument;
let pEGFP: PlasmidDocument;
let trace: SangerTraceData;

beforeAll(async () => {
  const lib = await loadSampleLibrary();
  [pUC19, pEGFP] = lib.docs;
  trace = lib.traces[pEGFP.id][0];
});

const enz = (...names: string[]) => names.map((n) => getEnzymeByName(n)!);

describe('sample library', () => {
  it('loads real pUC19 and pEGFP-N1 with auto-annotated elements', () => {
    expect(pUC19.length).toBe(2686);
    expect(pEGFP.length).toBe(4733);
    expect(pUC19.topology).toBe('circular');
    const names = pUC19.features.map((f) => f.name.toLowerCase()).join(' ');
    expect(names).toMatch(/amp|bla/);
    expect(pEGFP.features.some((f) => /egfp/i.test(f.name))).toBe(true);
  });

  it('round-trips through GenBank export', async () => {
    const [again] = await parseBioFile('pUC19.gbk', exportPlasmidToGenBank(pUC19));
    expect(again.sequence).toBe(pUC19.sequence);
    expect(again.features.length).toBe(pUC19.features.length);
  });
});

describe('restriction → gel → ligation', () => {
  it('finds the pUC19 MCS unique cutters', () => {
    const sites = callBioSync('findCutSites', pUC19, enz('EcoRI', 'HindIII'));
    expect(sites.filter((s) => s.enzyme.name === 'EcoRI')).toHaveLength(1);
    expect(sites.filter((s) => s.enzyme.name === 'HindIII')).toHaveLength(1);
  });

  it('double digest produces fragments summing to the plasmid', () => {
    const sites = callBioSync('findCutSites', pUC19, enz('EcoRI', 'HindIII')).filter((s) => !s.isMethylationBlocked);
    const frags = callBioSync('simulateDigestion', pUC19, sites);
    expect(frags).toHaveLength(2);
    expect(frags.reduce((a, f) => a + f.length, 0)).toBeGreaterThanOrEqual(pUC19.length);
    const lanes = callBioSync(
      'simulateVirtualGel',
      [{ label: 'L', ladder: 'NEB 1kb Plus' }, { label: 'digest', fragments: frags.map((f) => ({ sizeBp: f.length, doc: f })) }],
      { agarosePercent: 1 },
    );
    expect(lanes).toHaveLength(2);
    const [big, small] = [...lanes[1].bands].sort((a, b) => b.sizeBp - a.sizeBp);
    expect(big.migrationY).toBeLessThan(small.migrationY);
  });

  it('re-ligates an EcoRI-linearised vector', () => {
    const sites = callBioSync('findCutSites', pUC19, enz('EcoRI'));
    const [lin] = callBioSync('simulateDigestion', pUC19, sites);
    expect(lin.linearEnds?.left.sequence).toBe('AATT');
    const r = callBioSync('simulateLigation', [lin], { circularize: true });
    expect(r.compatible).toBe(true);
    expect(r.product?.length).toBe(pUC19.length);
  });
});

describe('primers, PCR and assembly', () => {
  it('designs primers around EGFP and amplifies it', () => {
    const egfp = pEGFP.features.find((f) => /egfp/i.test(f.name))!;
    const pair = callBioSync('designPrimerPair', pEGFP, { start: egfp.start, end: egfp.end });
    expect(Math.abs(pair.forward.tmAnnealing - pair.reverse.tmAnnealing)).toBeLessThan(5);
    const pcr = callBioSync('simulatePCR', pEGFP, pair.forward, pair.reverse);
    expect(pcr.product).not.toBeNull();
    expect(pcr.product!.length).toBe(pair.productLength);
  });

  it('Gibson-assembles two halves of pUC19 back into the plasmid', () => {
    const half = 1300;
    const a: PlasmidDocument = { ...pUC19, id: 'a', topology: 'linear', sequence: pUC19.sequence.slice(0, half + 30), length: half + 30, features: [], primers: [] };
    const bSeq = pUC19.sequence.slice(half) + pUC19.sequence.slice(0, 30);
    const b: PlasmidDocument = { ...pUC19, id: 'b', topology: 'linear', sequence: bSeq, length: bSeq.length, features: [], primers: [] };
    const r = callBioSync('simulateGibsonAssembly', [a, b], { circular: true });
    expect(r.product?.length).toBe(pUC19.length);
  });
});

describe('Sanger alignment', () => {
  it('aligns the synthetic EGFP read and reports the planted substitution', async () => {
    const aligned = await callBio('alignTraceToPlasmid', trace, pEGFP);
    expect(aligned.alignment).toBeDefined();
    expect(aligned.alignment!.identityPercent).toBeGreaterThan(95);
    expect(aligned.alignment!.mismatches.some((m) => m.type === 'substitution')).toBe(true);
  });
});

describe('AI copilot context', () => {
  it('summarises the plasmid without dumping the full sequence and validates actions', () => {
    const sites = callBioSync('findCutSites', pEGFP, COMMERCIAL_ENZYMES);
    const prompt = buildPlasmidContextPrompt(pEGFP, sites, { start: 700, end: 760 }, [trace]);
    expect(prompt).toContain('4733');
    expect(prompt.includes(pEGFP.sequence)).toBe(false);
    expect(validateAction({ type: 'HIGHLIGHT_RANGE', payload: { start: 10, end: 20, reason: 'x' } }, pEGFP).ok).toBe(true);
    expect(validateAction({ type: 'HIGHLIGHT_RANGE', payload: { start: 10, end: 99999, reason: 'x' } }, pEGFP).ok).toBe(false);
  });
});
