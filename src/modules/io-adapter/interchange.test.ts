// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeAll, describe, expect, it } from 'vitest';
import type { PlasmidDocument } from '../../types/schema';
import { designPrimerPair, simulatePCR } from '../cloning-primer';
import { loadSampleLibrary } from '../../app/samples';
import {
  exportCloningStrategy,
  exportPlasmidToGenBank,
  exportPydnaScript,
  importCloningStrategy,
  OPENCLONING_SCHEMA_VERSION,
  overhangNumbers,
  parseBioFile,
} from './index';

let pUC19: PlasmidDocument;

beforeAll(async () => {
  const lib = await loadSampleLibrary();
  [pUC19] = lib.docs;
});

/** pUC19 plus the PCR product its own primers give, which is a two-step lineage. */
function withPcr(): { template: PlasmidDocument; product: PlasmidDocument } {
  const pair = designPrimerPair(pUC19, { start: 400, end: 1200 });
  const template = { ...pUC19, primers: [pair.forward, pair.reverse] };
  const { product } = simulatePCR(template, pair.forward, pair.reverse);
  return { template, product: { ...product!, primers: [pair.forward, pair.reverse] } };
}

const toGenBank = (doc: PlasmidDocument) => exportPlasmidToGenBank(doc);

describe('overhangs in pydna terms', () => {
  it("writes a 5' overhang as a negative crick overhang and a 3' one as positive", () => {
    const base: PlasmidDocument = { ...pUC19, topology: 'linear', sequence: 'AATTCGGATCCG', length: 12 };
    const sticky = {
      ...base,
      linearEnds: {
        left: { type: '5-prime' as const, sequence: 'AATT', phosphorylated: true },
        right: { type: '5-prime' as const, sequence: 'GATC', phosphorylated: true },
      },
    };
    const numbers = overhangNumbers(sticky);
    // Top strand protrudes at the left, bottom strand protrudes at the right.
    expect(numbers.crick3).toBe(-4);
    expect(numbers.watson3).toBe(-4);
    // The full sequence spans both strands, so the right overhang's bases are added.
    expect(numbers.fullSequence).toBe('AATTCGGATCCGGATC');

    const threePrime = {
      ...base,
      linearEnds: {
        left: { type: '3-prime' as const, sequence: 'TTAA', phosphorylated: true },
        right: { type: '3-prime' as const, sequence: 'GGCC', phosphorylated: true },
      },
    };
    const other = overhangNumbers(threePrime);
    expect(other.crick3).toBe(4);
    expect(other.watson3).toBe(4);
    expect(other.fullSequence).toBe('TTAAAATTCGGATCCG');

    expect(overhangNumbers(pUC19)).toEqual({ crick3: 0, watson3: 0, fullSequence: pUC19.sequence });
  });
});

describe('OpenCloning cloning strategy', () => {
  it('writes one sequence and one source per document, sharing their ids', () => {
    const { template, product } = withPcr();
    const { strategy, warnings } = exportCloningStrategy([template, product], { toGenBank });

    expect(strategy.schema_version).toBe(OPENCLONING_SCHEMA_VERSION);
    expect(strategy.sequences.map((s) => s.id)).toEqual([1, 2]);
    expect(strategy.sources.map((s) => s.id)).toEqual([1, 2]);
    expect(strategy.sequences.every((s) => s.type === 'TextFileSequence')).toBe(true);
    expect(strategy.sequences[0].file_content).toMatch(/^LOCUS/);

    // The template was imported; the product came out of a PCR on it.
    expect(strategy.sources[0].type).toBe('UploadedFileSource');
    expect(strategy.sources[1].type).toBe('PCRSource');
    expect(strategy.sources[1].input.some((i) => i.sequence === 1)).toBe(true);
    // Both primers travel as inputs of the reaction, with ids after the sequences.
    expect(strategy.primers).toHaveLength(2);
    expect(strategy.primers.map((p) => p.id)).toEqual([3, 4]);
    for (const primer of strategy.primers) {
      expect(strategy.sources[1].input.some((i) => i.sequence === primer.id)).toBe(true);
      expect(primer.sequence).toMatch(/^[ACGT]+$/);
    }
    expect(warnings).toEqual([]);
  });

  it('says when a parent was left out instead of writing a dangling edge', () => {
    const { product } = withPcr();
    const { strategy, warnings } = exportCloningStrategy([product], { toGenBank });
    expect(strategy.sources[0].type).toBe('PCRSource');
    // Only the primers remain as inputs; the template is gone, and that is said out loud.
    expect(strategy.sources[0].input.every((i) => i.sequence > 1)).toBe(true);
    expect(warnings.some((w) => w.includes('亲本不在导出范围内'))).toBe(true);
  });

  it('writes an operation the schema has no class for as a directly given sequence', () => {
    const mutated: PlasmidDocument = {
      ...pUC19,
      name: 'pUC19_mut',
      history: [
        {
          id: 'h1',
          operation: 'site_directed_mutagenesis',
          timestamp: new Date(0).toISOString(),
          description: 'A100G',
        },
      ],
    };
    const { strategy, warnings } = exportCloningStrategy([mutated], { toGenBank });
    expect(strategy.sources[0].type).toBe('ManuallyTypedSource');
    expect(strategy.sources[0].user_input).toBe(pUC19.sequence);
    expect(warnings.some((w) => w.includes('没有对应的操作类型'))).toBe(true);
  });

  it('requires the enzymes on a restriction-and-ligation source, and says when it had to guess', () => {
    const ligated: PlasmidDocument = {
      ...pUC19,
      name: 'pUC19_religated',
      history: [
        { id: 'h1', operation: 'restriction_ligation', timestamp: new Date(0).toISOString(), description: 'religation' },
      ],
    };
    const { strategy, warnings } = exportCloningStrategy([ligated], { toGenBank });
    expect(strategy.sources[0].type).toBe('RestrictionAndLigationSource');
    expect(strategy.sources[0].restriction_enzymes).toEqual(['unknown']);
    expect(warnings.some((w) => w.includes('没有记录所用的酶'))).toBe(true);
  });

  it('reads a strategy back, with the lineage and the GenBank text intact', async () => {
    const { template, product } = withPcr();
    const { json } = exportCloningStrategy([template, product], { toGenBank, description: '测试' });
    const back = importCloningStrategy(json);

    expect(back.description).toBe('测试');
    expect(back.warnings).toEqual([]);
    expect(back.files.map((f) => f.name)).toEqual([template.name, product.name]);
    expect(back.primers).toHaveLength(2);

    // The GenBank text parses back into the same sequences.
    const [reloaded] = await parseBioFile('x.gb', back.files[0].content);
    expect(reloaded.sequence).toBe(template.sequence);

    const pcrNode = back.files[1].history[0];
    expect(pcrNode.operation).toBe('pcr');
    expect(pcrNode.parentSnapshots?.[0].name).toBe(template.name);
    expect(pcrNode.primersUsed).toHaveLength(2);
  });

  it('refuses something that is not a strategy, and flags a different schema version', () => {
    expect(() => importCloningStrategy('not json')).toThrow(/合法的 JSON/);
    expect(() => importCloningStrategy('{"a":1}')).toThrow(/缺少 sequences/);
    const older = importCloningStrategy(
      JSON.stringify({ sequences: [], sources: [], primers: [], schema_version: '0.2.6' }),
    );
    expect(older.warnings.some((w) => w.includes('0.2.6'))).toBe(true);
  });
});

describe('pydna script', () => {
  it('rebuilds a PCR product from its template and primers, and checks it', () => {
    const { template, product } = withPcr();
    const script = exportPydnaScript([template, product], { toGenBank, title: 'test run' });

    expect(script.reproduced).toBe(1);
    expect(script.literal).toBe(0);
    expect(script.warnings).toEqual([]);
    expect(script.code).toContain('from pydna.amplify import pcr');
    expect(script.code).toMatch(/= pcr\(\w+_fwd, \w+_rev, pUC19\)/);
    // Every product is compared with what GATC recorded.
    expect(script.code).toContain('def check(');
    expect((script.code.match(/^check\(/gm) ?? [])).toHaveLength(1);
    expect(script.code).toContain('print("all steps reproduced")');
  });

  it('gives a document whose step cannot be expressed its recorded sequence and a TODO', () => {
    const mutated: PlasmidDocument = {
      ...pUC19,
      name: 'pUC19 mut',
      history: [
        {
          id: 'h1',
          operation: 'site_directed_mutagenesis',
          timestamp: new Date(0).toISOString(),
          description: 'A100G',
          parentSnapshots: [{ id: pUC19.id, name: pUC19.name, length: pUC19.length }],
        },
      ],
    };
    const script = exportPydnaScript([pUC19, mutated], { toGenBank });
    expect(script.literal).toBe(1);
    expect(script.reproduced).toBe(0);
    expect(script.code).toContain('# TODO: A100G');
    expect(script.warnings.some((w) => w.includes('pUC19 mut'))).toBe(true);
    // A name with a space still has to give a usable python identifier.
    expect(script.code).toMatch(/pUC19_mut = pUC19_mut_recorded/);
  });

  it('writes a cut-and-close step as a real digest, but only when the parent is the plasmid', () => {
    const religated: PlasmidDocument = {
      ...pUC19,
      name: 'pUC19_religated',
      history: [
        {
          id: 'h1',
          operation: 'restriction_ligation',
          timestamp: new Date(0).toISOString(),
          description: 'EcoRI digest and religation',
          enzymesUsed: ['EcoRI'],
          parentSnapshots: [{ id: pUC19.id, name: pUC19.name, length: pUC19.length }],
        },
      ],
    };
    const script = exportPydnaScript([pUC19, religated], { toGenBank });
    expect(script.reproduced).toBe(1);
    expect(script.code).toContain('Restriction.EcoRI');
    expect(script.code).toContain('.cut(*pUC19_religated_enzymes)');
    expect(script.code).toContain('.looped()');

    // The same step on an already linear parent cannot be written down faithfully.
    const fromFragment: PlasmidDocument = {
      ...religated,
      history: [
        {
          ...religated.history[0],
          parentSnapshots: [{ id: 'frag', name: 'fragment', length: 100 }],
        },
      ],
    };
    const fragment: PlasmidDocument = { ...pUC19, id: 'frag', name: 'fragment', topology: 'linear' };
    const guarded = exportPydnaScript([fragment, fromFragment], { toGenBank });
    expect(guarded.reproduced).toBe(0);
    expect(guarded.literal).toBe(1);
  });

  it('keeps variable names apart when two documents share a name', () => {
    const script = exportPydnaScript([pUC19, { ...pUC19, id: 'second' }], { toGenBank });
    expect(script.code).toContain('pUC19_recorded = gb(');
    expect(script.code).toContain('pUC19_2_recorded = gb(');
  });
});
