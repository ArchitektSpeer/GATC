import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  CutSite,
  OverhangEnd,
  PlasmidDocument,
  Primer,
  RestrictionEnzyme,
  SequenceFeature,
} from '../../types/schema';
import {
  GATEWAY_ATT_SITES,
  bluntEnds,
  buildPrimer,
  calcCrossDimer,
  designGibsonPrimers,
  designGoldenGatePrimers,
  designMutagenesisPrimers,
  designPrimerPair,
  evaluateOligoThermodynamics,
  findCutSites,
  makeDocument,
  reverseComplement,
  sequenceSlice,
  simulateDigestion,
  simulateGatewayBP,
  simulateGatewayLR,
  simulateGibsonAssembly,
  simulateGoldenGateAssembly,
  simulateLigation,
  simulateOverlapExtensionPCR,
  simulatePCR,
  type MutationSpec,
} from './index';

function feature(
  name: string,
  start: number,
  end: number,
  type: SequenceFeature['type'] = 'misc_feature',
  strand: 1 | -1 = 1,
): SequenceFeature {
  return { id: name, name, type, start, end, strand, color: '#2563eb' };
}

function blunt(): OverhangEnd {
  return { type: 'blunt', sequence: '', phosphorylated: false };
}

function sticky(type: '5-prime' | '3-prime', sequence: string, enzyme: string): OverhangEnd {
  return { type, sequence, phosphorylated: true, sourceEnzyme: enzyme };
}

function linearFragment(
  name: string,
  sequence: string,
  left: OverhangEnd,
  right: OverhangEnd,
  features: SequenceFeature[] = [],
): PlasmidDocument {
  return makeDocument({
    name,
    sequence,
    topology: 'linear',
    features,
    linearEnds: { left, right },
  });
}

describe('SantaLucia / Owczarzy thermodynamics', () => {
  it('matches the Primer3 reference Tm for the M13-style 24-mer', () => {
    const result = evaluateOligoThermodynamics('AGCGGATAACAATTTCACACAGGA', {
      naMm: 50,
      mgMm: 1.5,
      dntpMm: 0.6,
      oligoNm: 250,
    });
    expect(result.tm).toBeGreaterThan(59);
    expect(result.tm).toBeLessThan(62);
    expect(Math.abs(result.tm - 61.4)).toBeLessThan(1.5);
    expect(result.gcPercent).toBeCloseTo(41.67, 1);
    expect(result.has3PrimeGCClamp).toBe(false);
  });

  it('identifies a 3-prime G/C clamp on a G-terminated oligo', () => {
    const clamped = evaluateOligoThermodynamics('AGCGGATAACAATTTCACACAGG');
    expect(clamped.has3PrimeGCClamp).toBe(true);
  });

  it('reports nearest-neighbor enthalpy and entropy with the correct signs', () => {
    const result = evaluateOligoThermodynamics('GCGCGCGCGCGCGCGC');
    expect(result.deltaH).toBeLessThan(0);
    expect(result.deltaS).toBeLessThan(0);
    expect(result.deltaG37).toBeLessThan(0);
  });

  it('predicts a hairpin and a self-dimer for a self-complementary oligo', () => {
    const result = evaluateOligoThermodynamics('GAATTCGAATTC');
    expect(result.hairpinAscii).toContain("5'-");
    expect(result.selfDimerAscii).toContain('|');
    expect(result.selfDimerDeltaG).toBeLessThan(0);
  });

  it('calculates cross-dimer free energy and ASCII pairing', () => {
    const result = calcCrossDimer('AGCGGATAACAATTTCACACAGGA', 'TCCTGTGTGAAATTGTTATCCGCT');
    expect(result.ascii).toContain("5'-");
    expect(result.deltaG).toBeLessThanOrEqual(0);
  });

  it('reproduces the Primer3 reference Tm and secondary-structure free energies', () => {
    interface Primer3ReferenceEntry {
      sequence: string;
      tm: number;
      hairpinDeltaG: number;
      homodimerDeltaG: number;
    }
    interface Primer3Reference {
      conditions: {
        naMm: number;
        mgMm: number;
        dntpMm: number;
        oligoNm: number;
      };
      oligos: Primer3ReferenceEntry[];
    }
    const reference = JSON.parse(
      readFileSync(resolve(process.cwd(), 'test-data/primer3-reference.json'), 'utf8'),
    ) as Primer3Reference;
    const hairpinErrors: number[] = [];
    const homodimerErrors: number[] = [];
    for (const entry of reference.oligos) {
      const result = evaluateOligoThermodynamics(entry.sequence, reference.conditions);
      expect(Math.abs(result.tm - entry.tm)).toBeLessThanOrEqual(0.1);
      hairpinErrors.push(Math.abs(result.hairpinDeltaG - entry.hairpinDeltaG));
      homodimerErrors.push(Math.abs(result.selfDimerDeltaG - entry.homodimerDeltaG));
      if (entry.hairpinDeltaG === 0) {
        expect(result.hairpinDeltaG).toBeGreaterThanOrEqual(-1);
      }
      if (entry.homodimerDeltaG === 0) {
        expect(result.selfDimerDeltaG).toBeGreaterThanOrEqual(-1);
      }
    }
    const requiredWithinOne = Math.ceil(reference.oligos.length * 0.9);
    expect(hairpinErrors.filter((error) => error <= 1).length).toBeGreaterThanOrEqual(
      requiredWithinOne,
    );
    expect(homodimerErrors.filter((error) => error <= 1).length).toBeGreaterThanOrEqual(
      requiredWithinOne,
    );
    expect(Math.max(...hairpinErrors)).toBeLessThanOrEqual(2);
    expect(Math.max(...homodimerErrors)).toBeLessThanOrEqual(2);
  });
});

describe('primer design', () => {
  const template = makeDocument({
    name: 'template',
    sequence:
      'ATGCGTACGTTAGCTAGCTAGGCTAACGTTAGCCGATCGTAGCTAGCATCGATGCTAGCTAGCTAGCATGCTAGCTAGGATCCATCGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATGCTAGCTAGCTAGCATCGATCGATCGTAGCTAGCTAGCAT',
    topology: 'circular',
  });

  it('designs a pair with matched Tm and a 3-prime clamp', () => {
    const result = designPrimerPair(template, { start: 20, end: 120 });
    expect(result.forward.bindingStart).toBe(20);
    expect(result.reverse.bindingEnd).toBe(120);
    expect(result.forward.sequence).toBe(
      template.sequence.slice(20, 20 + (result.forward.bindingEnd - result.forward.bindingStart)),
    );
    expect(result.forward.has3PrimeGCClamp).toBe(true);
    expect(result.reverse.has3PrimeGCClamp).toBe(true);
    expect(Math.abs(result.forward.tmAnnealing - result.reverse.tmAnnealing)).toBeLessThan(1.5);
    expect(result.productLength).toBe(100);
  });

  it('adds a restriction site and NEB leader bases to the 5-prime tail', () => {
    const result = designPrimerPair(template, { start: 20, end: 120 }, {
      enzymeSiteForward: 'EcoRI',
      leaderBases: 'GCG',
    });
    expect(result.forward.tailSequence).toBe('GCGGAATTC');
    expect(result.forward.sequence.startsWith('GCGGAATTC')).toBe(true);
    expect(result.productSequence.slice(0, 9)).toBe('GCGGAATTC');
    expect(result.productSequence).toContain('GAATTC');
  });

  it('builds a reverse primer from the bottom strand', () => {
    const primer = buildPrimer(template, 30, 50, -1);
    expect(primer.sequence).toBe(reverseComplement(template.sequence.slice(30, 50)));
    expect(primer.strand).toBe(-1);
  });
});

describe('site-directed mutagenesis', () => {
  const codingSequence = [
    'ATG',
    'GCT',
    'GAG',
    'TTC',
    'GCT',
    'AGC',
    'GAT',
    'CGT',
    'AGC',
    'TAG',
    'GCT',
    'GAT',
    'CGT',
    'AGC',
    'TAG',
    'GCT',
    'GAT',
    'CGT',
    'AGC',
    'TAG',
    'GCT',
    'GAT',
    'CGT',
    'AGC',
    'TAG',
    'GCT',
    'GAT',
    'CGT',
    'AGC',
    'TAG',
    'GCT',
    'GAT',
    'CGT',
    'AGC',
    'TAG',
    'GCT',
    'GAT',
    'CGT',
    'AGC',
    'TAG',
  ].join('');
  const doc = makeDocument({
    name: 'cds',
    sequence: codingSequence,
    topology: 'circular',
    features: [feature('CDS1', 0, codingSequence.length, 'CDS')],
  });

  it('creates mutated DNA and a complementary QuikChange pair', () => {
    const mutation: MutationSpec = { start: 30, end: 33, newBases: 'GCC' };
    const result = designMutagenesisPrimers(doc, mutation);
    expect(result.mutatedDoc.sequence.slice(30, 33)).toBe('GCC');
    expect(result.mutatedDoc.length).toBe(doc.length);
    expect(result.forward.sequence).toContain('GCC');
    expect(result.reverse.sequence).toBe(reverseComplement(result.forward.sequence));
    expect(result.forward.mismatches?.length).toBeGreaterThan(0);
    expect(result.silentSiteSuggestions.some((suggestion) => suggestion.enzyme === 'EcoRI' && suggestion.action === 'introduce')).toBe(true);
  });

  it('supports back-to-back Q5 mutagenesis', () => {
    const mutation: MutationSpec = { start: 30, end: 33, newBases: 'GCC', mode: 'q5_back_to_back' };
    const result = designMutagenesisPrimers(doc, mutation);
    expect(result.mutatedDoc.sequence.slice(30, 33)).toBe('GCC');
    expect(result.forward.tailSequence).toBe('GCC');
    expect(result.forward.strand).toBe(1);
    expect(result.reverse.strand).toBe(-1);
  });
});

describe('restriction digestion', () => {
  it('cuts a circular plasmid at a cross-origin EcoRI site and records AATT overhangs', () => {
    const core = 'ACGTTGCAAGCTTAGCGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCG';
    const sequence = 'TC' + core.slice(2, core.length - 4) + 'GAAT';
    const circular = makeDocument({
      name: 'ecoRI_wrap',
      sequence,
      topology: 'circular',
      features: [feature('marker', 10, 30)],
    });
    const enzyme: RestrictionEnzyme = {
      name: 'EcoRI',
      recognitionSeq: 'GAATTC',
      cutIndexTop: 1,
      cutIndexBottom: 5,
    };
    const sites = findCutSites(circular.sequence, enzyme, true);
    expect(sites).toHaveLength(1);
    const fragments = simulateDigestion(circular, sites);
    expect(fragments).toHaveLength(1);
    expect(fragments[0].topology).toBe('linear');
    expect(fragments[0].length).toBe(circular.length);
    expect(fragments[0].linearEnds?.left.type).toBe('5-prime');
    expect(fragments[0].linearEnds?.left.sequence).toBe('AATT');
    expect(fragments[0].linearEnds?.right.sequence).toBe('AATT');
    expect(fragments[0].features.some((item) => item.name === 'marker')).toBe(true);
  });

  it('blunts a 5-prime overhang by filling the recessed strand', () => {
    const fragment = linearFragment(
      'blunt_me',
      'AAAAG',
      blunt(),
      sticky('5-prime', 'GATC', 'BamHI'),
    );
    const blunted = bluntEnds(fragment, 'klenow_fill_in');
    expect(blunted.linearEnds?.left.type).toBe('blunt');
    expect(blunted.linearEnds?.right.type).toBe('blunt');
    expect(blunted.sequence).toBe('AAAAGGATC');
  });
});

describe('ligation', () => {
  it('ligates BamHI and BglII compatible ends and reports destroyed sites', () => {
    const vector = linearFragment('vector', 'AAAAG', blunt(), sticky('5-prime', 'GATC', 'BamHI'));
    const insert = linearFragment('insert', 'GATCTTTT', sticky('5-prime', 'GATC', 'BglII'), blunt());
    const result = simulateLigation([vector, insert]);
    expect(result.compatible).toBe(true);
    expect(result.product).not.toBeNull();
    expect(result.product?.topology).toBe('circular');
    expect(result.product?.length).toBe(13);
    expect(result.destroyedSites).toContain('BamHI');
    expect(result.destroyedSites).toContain('BglII');
    expect(result.warnings.some((warning) => warning.includes('destroyed'))).toBe(true);
  });

  it('detects a reverse insert when the ends are directional', () => {
    const vector = linearFragment('vector', 'AAAAG', sticky('5-prime', 'CTAG', 'NheI'), sticky('5-prime', 'GATC', 'BamHI'));
    const insertForward = linearFragment('insert', 'GATCTTTTCTAG', sticky('5-prime', 'GATC', 'BglII'), sticky('5-prime', 'CTAG', 'NheI'));
    const result = simulateLigation([vector, insertForward]);
    expect(result.compatible).toBe(true);
    expect(result.orientations.length).toBeGreaterThan(0);
  });
});

describe('Gibson assembly', () => {
  it('circularizes two fragments with two overlaps and preserves features', () => {
    const overlapA = 'ACGTTGCAACGTAGCTAGCT';
    const overlapB = 'TTGACCGTATCGGATCCATA';
    const middle1 = 'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC';
    const middle2 = 'TACGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTA';
    const f1 = linearFragment('f1', overlapA + middle1 + overlapB, blunt(), blunt(), [feature('gene1', 30, 60, 'CDS')]);
    const f2 = linearFragment('f2', overlapB + middle2 + overlapA, blunt(), blunt(), [feature('gene2', 30, 60, 'CDS')]);
    const result = simulateGibsonAssembly([f1, f2]);
    expect(result.product).not.toBeNull();
    expect(result.product?.topology).toBe('circular');
    expect(result.product?.length).toBe(f1.length + f2.length - overlapA.length - overlapB.length);
    expect(result.junctions).toHaveLength(2);
    expect(result.product?.features.some((item) => item.name === 'gene1')).toBe(true);
    expect(result.product?.features.some((item) => item.name === 'gene2')).toBe(true);
    expect(result.product?.history.some((node) => node.operation === 'gibson_assembly')).toBe(true);
  });

  it('designs Gibson primers with overlaps to the neighbouring parts', () => {
    const overlapA = 'ACGTTGCAACGTAGCTAGCT';
    const overlapB = 'TTGACCGTATCGGATCCATA';
    const middle1 = 'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC';
    const middle2 = 'TACGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTA';
    const doc = makeDocument({
      name: 'gibson_template',
      sequence: overlapA + middle1 + overlapB + middle2 + overlapA,
      topology: 'circular',
    });
    const parts = [
      { doc, range: { start: 0, end: overlapA.length + middle1.length + overlapB.length } },
      {
        doc,
        range: {
          start: overlapA.length + middle1.length,
          end: doc.length,
        },
      },
    ];
    const primers = designGibsonPrimers(parts, { overlapLength: 20 });
    expect(primers).toHaveLength(2);
    expect(primers[0].forward.tailSequence).toBe(overlapA);
    expect(primers[0].reverse.tailSequence).toBe(reverseComplement(overlapB));
    expect(primers[1].forward.tailSequence).toBe(overlapB);
    expect(primers[1].reverse.tailSequence).toBe(reverseComplement(overlapA));
  });
});

describe('Golden Gate assembly', () => {
  const overhangs = ['AATG', 'GCTT', 'TGAC'];
  const internals = [
    'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGC',
    'TACGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTA',
    'CCGTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATC',
  ];
  const parts = internals.map((internal, index) => {
    const next = overhangs[(index + 1) % 3];
    const sequence = `GGTCTCA${overhangs[index]}${internal}${next}TGAGACC`;
    return makeDocument({
      name: `part${index + 1}`,
      sequence,
      topology: 'linear',
      features: [feature(`insert${index + 1}`, 7, 7 + 4 + internal.length)],
      linearEnds: { left: blunt(), right: blunt() },
    });
  });
  const bsaI: RestrictionEnzyme = {
    name: 'BsaI',
    recognitionSeq: 'GGTCTC',
    cutIndexTop: 7,
    cutIndexBottom: 11,
    isTypeIIS: true,
  };

  it('assembles three BsaI parts in a directed circle', () => {
    const result = simulateGoldenGateAssembly(parts, bsaI);
    expect(result.product).not.toBeNull();
    expect(result.product?.topology).toBe('circular');
    expect(result.product?.length).toBe(
      internals.reduce((sum, internal) => sum + 4 + internal.length, 0),
    );
    expect(result.overhangs).toEqual(overhangs);
    expect(result.fidelityScore).toBeGreaterThan(0.8);
    expect(result.internalSiteWarnings).toHaveLength(0);
    expect(result.product?.history.some((node) => node.operation === 'golden_gate')).toBe(true);
  });

  it('designs BsaI primers with the requested overhangs', () => {
    const docs = internals.map((internal, index) =>
      makeDocument({ name: `internal${index + 1}`, sequence: internal, topology: 'linear' }),
    );
    const output = designGoldenGatePrimers(
      docs.map((doc) => ({ doc, range: { start: 0, end: doc.length } })),
      bsaI,
      overhangs,
    );
    expect(output).toHaveLength(3);
    expect(output[0].forward.tailSequence).toBe('GGTCTCA' + overhangs[0]);
    expect(output[0].reverse.tailSequence).toBe('GGTCTCA' + reverseComplement(overhangs[1]));
  });
});

describe('Gateway cloning', () => {
  const gene = 'ATGGCTAGCGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGC';
  const insert = makeDocument({
    name: 'attB_insert',
    sequence: GATEWAY_ATT_SITES.attB1 + gene + GATEWAY_ATT_SITES.attB2 + 'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTA',
    topology: 'circular',
    features: [
      feature('attB1', 0, GATEWAY_ATT_SITES.attB1.length, 'attachment_site'),
      feature('gene', GATEWAY_ATT_SITES.attB1.length, GATEWAY_ATT_SITES.attB1.length + gene.length, 'CDS'),
      feature(
        'attB2',
        GATEWAY_ATT_SITES.attB1.length + gene.length,
        GATEWAY_ATT_SITES.attB1.length + gene.length + GATEWAY_ATT_SITES.attB2.length,
        'attachment_site',
      ),
    ],
  });
  const donor = makeDocument({
    name: 'donor',
    sequence:
      'ATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC' +
      GATEWAY_ATT_SITES.attP1 +
      'CCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAG' +
      GATEWAY_ATT_SITES.attP2,
    topology: 'circular',
    features: [
      feature('attP1', 80, 80 + GATEWAY_ATT_SITES.attP1.length, 'attachment_site'),
      feature('ccdB', 80 + GATEWAY_ATT_SITES.attP1.length, 80 + GATEWAY_ATT_SITES.attP1.length + 60, 'misc_feature'),
      feature(
        'attP2',
        80 + GATEWAY_ATT_SITES.attP1.length + 60,
        80 + GATEWAY_ATT_SITES.attP1.length + 60 + GATEWAY_ATT_SITES.attP2.length,
        'attachment_site',
      ),
    ],
  });

  it('performs BP recombination into an entry clone', () => {
    const result = simulateGatewayBP(insert, donor);
    expect(result.entryClone).not.toBeNull();
    expect(result.byproduct).not.toBeNull();
    expect(result.entryClone?.features.some((item) => item.name === 'gene')).toBe(true);
    expect(result.entryClone?.features.some((item) => item.name === 'attL1')).toBe(true);
    expect(result.entryClone?.features.some((item) => item.name === 'attL2')).toBe(true);
    expect(result.entryClone?.history.some((node) => node.operation === 'gateway_bp')).toBe(true);
  });

  it('performs LR recombination into an expression clone', () => {
    const bp = simulateGatewayBP(insert, donor);
    expect(bp.entryClone).not.toBeNull();
    const destination = makeDocument({
      name: 'destination',
      sequence:
        'ATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC' +
        GATEWAY_ATT_SITES.attR1 +
        'CCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAG' +
        GATEWAY_ATT_SITES.attR2,
      topology: 'circular',
      features: [
        feature('attR1', 80, 80 + GATEWAY_ATT_SITES.attR1.length, 'attachment_site'),
        feature('ccdB', 80 + GATEWAY_ATT_SITES.attR1.length, 80 + GATEWAY_ATT_SITES.attR1.length + 60, 'misc_feature'),
        feature(
          'attR2',
          80 + GATEWAY_ATT_SITES.attR1.length + 60,
          80 + GATEWAY_ATT_SITES.attR1.length + 60 + GATEWAY_ATT_SITES.attR2.length,
          'attachment_site',
        ),
      ],
    });
    const lr = simulateGatewayLR(bp.entryClone!, destination);
    expect(lr.expressionClone).not.toBeNull();
    expect(lr.expressionClone?.features.some((item) => item.name === 'gene')).toBe(true);
    expect(lr.expressionClone?.features.some((item) => item.name === 'attB1')).toBe(true);
    expect(lr.expressionClone?.features.some((item) => item.name === 'attB2')).toBe(true);
    expect(lr.expressionClone?.history.some((node) => node.operation === 'gateway_lr')).toBe(true);
  });
});

describe('PCR', () => {
  function pcrTemplate(): PlasmidDocument {
    let state = 20261026;
    const nextBase = (): string => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return 'ACGT'[state & 3];
    };
    const sequence = Array.from({ length: 200 }, nextBase).join('');
    return makeDocument({
      name: 'circular_pcr_template',
      sequence,
      topology: 'circular',
      features: [feature('cross_origin_feature', 195, 205)],
    });
  }

  it('amplifies across the origin of a circular template', () => {
    const template = pcrTemplate();
    const forward = sequenceSlice(template.sequence, 190, 210, true);
    const reverse = reverseComplement(sequenceSlice(template.sequence, 10, 30, true));
    const result = simulatePCR(template, forward, reverse);
    expect(result.product).not.toBeNull();
    expect(result.product?.topology).toBe('linear');
    expect(result.product?.length).toBe(40);
    expect(result.product?.sequence).toBe(sequenceSlice(template.sequence, 190, 30, true));
    const migrated = result.product?.features.find((item) => item.name === 'cross_origin_feature');
    expect(migrated).toBeDefined();
    expect(migrated?.start).toBe(5);
    expect(migrated?.end).toBe(15);
    expect(result.product?.history.some((node) => node.operation === 'pcr')).toBe(true);
  });

  it('accepts primer objects and writes primer binding coordinates', () => {
    const template = pcrTemplate();
    const forward = buildPrimer(template, 30, 50, 1);
    const reverse = buildPrimer(template, 130, 150, -1);
    const result = simulatePCR(template, forward, reverse, { minAnneal: 12 });
    expect(result.product).not.toBeNull();
    expect(result.product?.length).toBe(120);
    expect(result.product?.primers).toHaveLength(2);
    expect(result.product?.primers[0].bindingStart).toBe(0);
    expect(result.product?.primers[1].bindingEnd).toBe(120);
  });

  it('fuses two fragments by overlap extension', () => {
    const overlap = 'ACGTTGCAACGTAGCTAGCT';
    let state = 987654321;
    const randomBlock = (length: number): string =>
      Array.from({ length }, () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return 'ACGT'[state & 3];
      }).join('');
    const left = linearFragment('soe_left', randomBlock(40) + overlap, blunt(), blunt());
    const right = linearFragment('soe_right', overlap + randomBlock(40), blunt(), blunt());
    const forward = sequenceSlice(left.sequence, 0, 20, false);
    const reverse = reverseComplement(sequenceSlice(right.sequence, right.length - 20, right.length, false));
    const result = simulateOverlapExtensionPCR([left, right], forward, reverse);
    expect(result.product).not.toBeNull();
    expect(result.product?.length).toBe(left.length + right.length - overlap.length);
  });
});

describe('digestion and ligation edge cases', () => {
  it('orients the two ends of a single non-palindromic Type IIS cut', () => {
    const sequence = 'GGTCTCA' + 'AATG' + 'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGC';
    const circular = makeDocument({ name: 'bsaI_single', sequence, topology: 'circular' });
    const bsaI: RestrictionEnzyme = {
      name: 'BsaI',
      recognitionSeq: 'GGTCTC',
      cutIndexTop: 7,
      cutIndexBottom: 11,
      isTypeIIS: true,
    };
    const sites = findCutSites(circular.sequence, bsaI, true);
    expect(sites).toHaveLength(1);
    const fragments = simulateDigestion(circular, sites);
    expect(fragments).toHaveLength(1);
    expect(fragments[0].linearEnds?.left.sequence).toBe('AATG');
    expect(fragments[0].linearEnds?.right.sequence).toBe('CATT');
  });

  it('keeps features on both sides of a two-site digest', () => {
    const sequence = 'GAATTC' + 'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGC' + 'GAATTC' + 'TACGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGC';
    const circular = makeDocument({
      name: 'two_site',
      sequence,
      topology: 'circular',
      features: [feature('left_marker', 10, 30), feature('right_marker', 70, 90)],
    });
    const enzyme: RestrictionEnzyme = { name: 'EcoRI', recognitionSeq: 'GAATTC', cutIndexTop: 1, cutIndexBottom: 5 };
    const fragments = simulateDigestion(circular, findCutSites(circular.sequence, enzyme, true));
    expect(fragments.length).toBe(2);
    expect(fragments.every((fragment) => fragment.topology === 'linear')).toBe(true);
    expect(fragments.reduce((sum, fragment) => sum + fragment.length, 0)).toBe(circular.length);
    expect(fragments.some((fragment) => fragment.features.some((item) => item.name === 'left_marker'))).toBe(true);
    expect(fragments.some((fragment) => fragment.features.some((item) => item.name === 'right_marker'))).toBe(true);
  });

  it('ligates NheI, SpeI and XbaI CTAG overhangs', () => {
    const vector = linearFragment('vector', 'AAAACTAG', sticky('5-prime', 'CTAG', 'NheI'), sticky('5-prime', 'CTAG', 'NheI'));
    const insert = linearFragment('insert', 'CTAGTTTTCTAG', sticky('5-prime', 'CTAG', 'SpeI'), sticky('5-prime', 'CTAG', 'XbaI'));
    const result = simulateLigation([vector, insert]);
    expect(result.compatible).toBe(true);
    expect(result.product).not.toBeNull();
    expect(result.product?.topology).toBe('circular');
  });
});

describe('Gibson and Golden Gate topology options', () => {
  const overlapA = 'ACGTTGCAACGTAGCTAGCT';
  const overlapB = 'TTGACCGTATCGGATCCATA';
  const middle1 = 'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC';
  const middle2 = 'TACGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTA';
  const f1 = () => linearFragment('f1', overlapA + middle1 + overlapB, blunt(), blunt(), [feature('gene1', 30, 60, 'CDS')]);
  const f2 = () => linearFragment('f2', overlapB + middle2 + overlapA, blunt(), blunt(), [feature('gene2', 30, 60, 'CDS')]);

  it('assembles a linear Gibson product with one junction', () => {
    const result = simulateGibsonAssembly([f1(), f2()], { circular: false });
    expect(result.product).not.toBeNull();
    expect(result.product?.topology).toBe('linear');
    expect(result.product?.length).toBe(f1().length + f2().length - overlapB.length);
    expect(result.junctions).toHaveLength(1);
  });

  it('reverses a fragment automatically when its supplied orientation is flipped', () => {
    const flipped = linearFragment('f2_flipped', reverseComplement(overlapB + middle2 + overlapA), blunt(), blunt());
    const result = simulateGibsonAssembly([f1(), flipped]);
    expect(result.product).not.toBeNull();
    expect(result.product?.length).toBe(f1().length + flipped.length - overlapA.length - overlapB.length);
    expect(result.junctions.some((junction) => junction.reversed)).toBe(true);
  });

  it('supports a linear Golden Gate path', () => {
    const overhangs = ['AATG', 'GCTT', 'TGAC'];
    const internals = [
      'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGC',
      'TACGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTA',
      'CCGTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATC',
    ];
    const parts = internals.map((internal, index) => {
      const next = overhangs[(index + 1) % 3];
      return makeDocument({
        name: `linear_part${index + 1}`,
        sequence: `GGTCTCA${overhangs[index]}${internal}${next}TGAGACC`,
        topology: 'linear',
      });
    });
    const bsaI: RestrictionEnzyme = {
      name: 'BsaI',
      recognitionSeq: 'GGTCTC',
      cutIndexTop: 7,
      cutIndexBottom: 11,
      isTypeIIS: true,
    };
    const result = simulateGoldenGateAssembly(parts, bsaI, { circular: false });
    expect(result.product).not.toBeNull();
    expect(result.product?.topology).toBe('linear');
    expect(result.product?.length).toBe(internals.reduce((sum, internal) => sum + 4 + internal.length, 0));
    expect(result.product?.linearEnds?.left.sequence).toBe('AATG');
  });
});

describe('mutagenesis indels and wrap-around primer design', () => {
  const sequence = [
    'ATG', 'GCT', 'GAG', 'TTC', 'GCT', 'AGC', 'GAT', 'CGT', 'AGC', 'TAG',
    'GCT', 'GAT', 'CGT', 'AGC', 'TAG', 'GCT', 'GAT', 'CGT', 'AGC', 'TAG',
    'GCT', 'GAT', 'CGT', 'AGC', 'TAG', 'GCT', 'GAT', 'CGT', 'AGC', 'TAG',
    'GCT', 'GAT', 'CGT', 'AGC', 'TAG', 'GCT', 'GAT', 'CGT', 'AGC', 'TAG',
  ].join('');
  const doc = makeDocument({
    name: 'indel_template',
    sequence,
    topology: 'circular',
    features: [feature('CDS', 0, sequence.length, 'CDS')],
  });

  it('deletes a codon and returns the shortened mutated document', () => {
    const result = designMutagenesisPrimers(doc, { start: 30, end: 33, newBases: '' });
    expect(result.mutatedDoc.length).toBe(doc.length - 3);
    expect(result.mutatedDoc.sequence.slice(30, 33)).toBe(sequence.slice(33, 36));
    expect(result.forward.sequence.length).toBeGreaterThan(0);
    expect(result.reverse.sequence).toBe(reverseComplement(result.forward.sequence));
  });

  it('inserts bases and returns the lengthened mutated document', () => {
    const result = designMutagenesisPrimers(doc, { start: 30, end: 30, newBases: 'AAA' });
    expect(result.mutatedDoc.length).toBe(doc.length + 3);
    expect(result.mutatedDoc.sequence.slice(30, 33)).toBe('AAA');
    expect(result.forward.sequence.length).toBeGreaterThan(0);
  });

  it('designs a primer pair for a target that crosses the origin', () => {
    const circular = makeDocument({
      name: 'wrap_target',
      sequence: Array.from({ length: 220 }, (_, index) => 'ACGT'[((index * 13) ^ (index * index)) % 4]).join(''),
      topology: 'circular',
    });
    const result = designPrimerPair(circular, { start: 190, end: 30 });
    expect(result.forward.bindingStart).toBe(190);
    expect(result.reverse.bindingEnd).toBe(30);
    expect(result.productLength).toBe(60);
    expect(result.productSequence).toBe(sequenceSlice(circular.sequence, 190, 30, true));
  });
});

describe('PCR mismatch incorporation', () => {
  it('incorporates a primer-encoded point mutation into the product', () => {
    let state = 13579;
    const sequence = Array.from({ length: 120 }, () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return 'ACGT'[state & 3];
    }).join('');
    const template = makeDocument({ name: 'mismatch_template', sequence, topology: 'linear' });
    const forwardAnneal = sequence.slice(0, 20);
    const mutatedBase = forwardAnneal[10] === 'A' ? 'C' : 'A';
    const mutatedForward = forwardAnneal.slice(0, 10) + mutatedBase + forwardAnneal.slice(11);
    const forwardPrimer: Primer = {
      id: 'mut_fwd',
      name: 'mut_fwd',
      sequence: mutatedForward,
      bindingStart: 0,
      bindingEnd: 20,
      strand: 1,
      tailSequence: '',
      tmAnnealing: evaluateOligoThermodynamics(mutatedForward).tm,
      tmTotal: evaluateOligoThermodynamics(mutatedForward).tm,
      gcPercent: 50,
      has3PrimeGCClamp: true,
      hairpinDeltaG: 0,
      selfDimerDeltaG: 0,
    };
    const reverse = buildPrimer(template, 80, 100, -1);
    const result = simulatePCR(template, forwardPrimer, reverse);
    expect(result.product).not.toBeNull();
    expect(result.product?.sequence[10]).toBe(mutatedBase);
    expect(result.warnings.some((warning) => warning.includes('differs from the template'))).toBe(true);
  });
});

describe('additional biological edge cases', () => {
  it('predicts a stable hairpin for a GC-rich stem', () => {
    const result = evaluateOligoThermodynamics('GCGCGCAAAAGCGCGC');
    expect(result.hairpinDeltaG).toBeLessThan(0);
    expect(result.hairpinAscii).toContain('|');
  });

  it('reports a reverse insert orientation when only the flipped insert is compatible', () => {
    const vector = linearFragment(
      'directional_vector',
      'AAAACCCC',
      sticky('5-prime', 'AAAA', 'XhoI'),
      sticky('5-prime', 'CCCC', 'SalI'),
    );
    const correctInsert = linearFragment(
      'correct_insert',
      'GGGGTTTT',
      sticky('5-prime', 'GGGG', 'BsaI'),
      sticky('5-prime', 'TTTT', 'BsaI'),
    );
    const flippedInsert = linearFragment(
      'flipped_insert',
      reverseComplement(correctInsert.sequence),
      sticky('5-prime', 'AAAA', 'BsaI'),
      sticky('5-prime', 'CCCC', 'BsaI'),
    );
    const result = simulateLigation([vector, flippedInsert]);
    expect(result.compatible).toBe(true);
    expect(result.orientations).toEqual(['reverse']);
    expect(result.product?.length).toBe(vector.length + flippedInsert.length);
  });

  it('excises a 3-prime overhang during blunting', () => {
    const fragment = linearFragment('three_prime', 'AAAAGGGG', blunt(), sticky('3-prime', 'GGGG', 'KpnI'));
    const blunted = bluntEnds(fragment, 't4_exonuclease');
    expect(blunted.sequence).toBe('AAAA');
    expect(blunted.linearEnds?.right.type).toBe('blunt');
    expect(blunted.linearEnds?.right.sequence).toBe('');
  });

  it('digests a linear molecule without losing the original end chemistry', () => {
    const sequence = 'GGCATCGATCGTAGCTAGCTAGCATCGATC' + 'GAATTC' + 'TACGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC';
    const linear = makeDocument({
      name: 'linear_digest',
      sequence,
      topology: 'linear',
      features: [feature('downstream', 40, 60)],
      linearEnds: {
        left: { type: '5-prime', sequence: 'AGCT', phosphorylated: true, sourceEnzyme: 'HindIII' },
        right: { type: '5-prime', sequence: 'TCGA', phosphorylated: true, sourceEnzyme: 'SalI' },
      },
    });
    const enzyme: RestrictionEnzyme = { name: 'EcoRI', recognitionSeq: 'GAATTC', cutIndexTop: 1, cutIndexBottom: 5 };
    const fragments = simulateDigestion(linear, findCutSites(linear.sequence, enzyme, false));
    expect(fragments).toHaveLength(2);
    expect(fragments[0].linearEnds?.left.sequence).toBe('AGCT');
    expect(fragments[0].linearEnds?.right.sequence).toBe('AATT');
    expect(fragments[1].linearEnds?.left.sequence).toBe('AATT');
    expect(fragments[1].linearEnds?.right.sequence).toBe('TCGA');
    expect(fragments.reduce((sum, fragment) => sum + fragment.length, 0)).toBe(linear.length);
    expect(fragments[1].features.some((item) => item.name === 'downstream')).toBe(true);
  });

  it('finds Gateway att sites from sequence motifs when no annotation is present', () => {
    const gene = 'ATGGCTAGCGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGC';
    const cleanInsert = makeDocument({
      name: 'motif_insert',
      sequence:
        GATEWAY_ATT_SITES.attB1 +
        gene +
        GATEWAY_ATT_SITES.attB2 +
        'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTA',
      topology: 'circular',
    });
    const cleanDonor = makeDocument({
      name: 'motif_donor',
      sequence:
        'ATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC' +
        GATEWAY_ATT_SITES.attP1 +
        'CCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAGCCAG' +
        GATEWAY_ATT_SITES.attP2,
      topology: 'circular',
    });
    const result = simulateGatewayBP(cleanInsert, cleanDonor);
    expect(result.entryClone).not.toBeNull();
    expect(result.entryClone?.sequence).toContain(gene);
    expect(result.entryClone?.features.some((item) => item.name === 'attL1')).toBe(true);
    expect(result.entryClone?.features.some((item) => item.name === 'attL2')).toBe(true);
  });
});

describe('three-base Type IIS overhangs', () => {
  it('assembles SapI parts with 3-nt overhangs', () => {
    const overhangs = ['AAT', 'GCT', 'TGA'];
    const internals = [
      'GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGC',
      'TACGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTA',
      'CCGTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATC',
    ];
    const parts = internals.map((internal, index) => {
      const next = overhangs[(index + 1) % 3];
      return makeDocument({
        name: `sap_part${index + 1}`,
        sequence: `GCTCTTCA${overhangs[index]}${internal}${next}TGAAGAGC`,
        topology: 'linear',
      });
    });
    const sapI: RestrictionEnzyme = {
      name: 'SapI',
      recognitionSeq: 'GCTCTTC',
      cutIndexTop: 8,
      cutIndexBottom: 11,
      isTypeIIS: true,
    };
    const result = simulateGoldenGateAssembly(parts, sapI);
    expect(result.product).not.toBeNull();
    expect(result.product?.length).toBe(
      internals.reduce((sum, internal) => sum + 3 + internal.length, 0),
    );
    expect(result.overhangs).toEqual(overhangs);
    expect(result.fidelityScore).toBeGreaterThan(0.5);
  });

  it('designs SapI primers with a one-base spacer and 3-nt overhangs', () => {
    const sapI: RestrictionEnzyme = {
      name: 'SapI',
      recognitionSeq: 'GCTCTTC',
      cutIndexTop: 8,
      cutIndexBottom: 11,
      isTypeIIS: true,
    };
    const docs = ['GGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGC', 'TACGATCGATCGTAGCTAGCTAGCATCGATCGTAGCTA'].map(
      (sequence, index) => makeDocument({ name: `sap_doc${index + 1}`, sequence, topology: 'linear' }),
    );
    const output = designGoldenGatePrimers(
      docs.map((doc) => ({ doc, range: { start: 0, end: doc.length } })),
      sapI,
      ['AAT', 'GCT'],
    );
    expect(output[0].forward.tailSequence).toBe('GCTCTTCA' + 'AAT');
    expect(output[0].reverse.tailSequence).toBe('GCTCTTCA' + reverseComplement('GCT'));
  });
});

describe('minus-strand silent site screening', () => {
  it('finds synonymous restriction sites on a reverse-strand CDS', () => {
    const coding = 'GCT'.repeat(20) + 'GAG' + 'TTC' + 'GCT'.repeat(18);
    const top = reverseComplement(coding);
    const doc = makeDocument({
      name: 'minus_cds',
      sequence: top,
      topology: 'circular',
      features: [feature('reverse_CDS', 0, top.length, 'CDS', -1)],
    });
    const result = designMutagenesisPrimers(doc, { start: 30, end: 33, newBases: 'GCC' });
    const suggestion = result.silentSiteSuggestions.find(
      (item) => item.enzyme === 'EcoRI' && item.action === 'introduce',
    );
    expect(suggestion).toBeDefined();
    expect(suggestion?.changedBases).toBe('GAG>GAA');
    expect(suggestion?.note.toLowerCase()).toContain('minus strand');
  });
});

describe('linear mutagenesis boundary handling', () => {
  it('designs a primer pair for a mutation near the start of a linear molecule', () => {
    const sequence =
      'ATGGCTGAGTTTGCTAGCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC';
    const doc = makeDocument({
      name: 'linear_cds',
      sequence,
      topology: 'linear',
      features: [feature('linear_CDS', 0, sequence.length, 'CDS')],
    });
    const result = designMutagenesisPrimers(doc, { start: 3, end: 6, newBases: 'GCC' });
    expect(result.mutatedDoc.sequence.slice(3, 6)).toBe('GCC');
    expect(result.forward.bindingStart).toBe(0);
    expect(result.forward.bindingEnd).toBeGreaterThan(result.forward.bindingStart);
    expect(result.forward.sequence.length).toBe(result.forward.bindingEnd - result.forward.bindingStart);
  });
});

describe('incompatible ligation ends', () => {
  it('returns no product for a single fragment with incompatible ends', () => {
    const fragment = linearFragment(
      'incompatible',
      'AAAAGGGG',
      sticky('5-prime', 'AAAA', 'XhoI'),
      sticky('5-prime', 'CCCC', 'SalI'),
    );
    const result = simulateLigation([fragment], { circularize: true });
    expect(result.compatible).toBe(false);
    expect(result.product).toBeNull();
  });
});
