import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  PlasmidDocument,
  Primer,
  SequenceFeature,
} from '../../types/schema';
import {
  COMMERCIAL_ENZYMES,
  CODON_USAGE,
  ENZYME_DATABASE,
  ENZYME_SETS,
  FEATURE_LIBRARY,
  autoAnnotateFeatures,
  backTranslate,
  calcGcPercent,
  codonAdaptationIndex,
  filterEnzymes,
  findAllORFs,
  findCutSites,
  findIsoschizomers,
  getEnzymeByName,
  mutatePlasmidSequence,
  reverseComplement,
  reverseComplementPlasmid,
  rotateCircularOrigin,
  searchMotif,
  translateDna,
} from './index';
import type { CodonUsageOrganism } from './index';

function makeDoc(
  sequence: string,
  topology: PlasmidDocument['topology'] = 'circular',
  features: SequenceFeature[] = [],
  primers: Primer[] = [],
  methylationProfile?: PlasmidDocument['methylationProfile'],
): PlasmidDocument {
  return {
    id: 'doc-test',
    name: 'test plasmid',
    sequence,
    topology,
    length: sequence.length,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    methylationProfile,
    features,
    primers,
    history: [],
  };
}

function makeFeature(
  start: number,
  end: number,
  overrides: Partial<SequenceFeature> = {},
): SequenceFeature {
  return {
    id: 'feature-1',
    name: 'test feature',
    type: 'misc_feature',
    start,
    end,
    strand: 1,
    color: '#22c55e',
    ...overrides,
  };
}

function makePrimer(
  bindingStart: number,
  bindingEnd: number,
  overrides: Partial<Primer> = {},
): Primer {
  return {
    id: 'primer-1',
    name: 'test primer',
    sequence: 'ACGTACGTACGTACGTACGT',
    bindingStart,
    bindingEnd,
    strand: 1,
    tailSequence: '',
    tmAnnealing: 60,
    tmTotal: 60,
    gcPercent: 50,
    has3PrimeGCClamp: false,
    hairpinDeltaG: 0,
    selfDimerDeltaG: 0,
    ...overrides,
  };
}

function readSampleSequence(fileName: string): string {
  const text = readFileSync(
    new URL(`../../app/samples/${fileName}`, import.meta.url),
    'utf8',
  );
  const originIndex = text.search(/^ORIGIN\b/m);
  if (originIndex === -1) throw new Error(`No ORIGIN block in ${fileName}`);
  const originBody = text.slice(originIndex).split('\n').slice(1).join('\n');
  const sequence = originBody
    .split('//')[0]
    .replace(/[^ACGTacgt]/g, '')
    .toUpperCase();
  if (sequence.length === 0) throw new Error(`No sequence in ${fileName}`);
  return sequence;
}

function featureNames(features: SequenceFeature[]): string[] {
  return features.map((feature) => feature.name);
}

describe('commercial restriction enzyme library', () => {
  it('contains at least sixty enzymes with complete metadata', () => {
    expect(COMMERCIAL_ENZYMES.length).toBeGreaterThanOrEqual(60);

    const required = [
      'EcoRI', 'BamHI', 'HindIII', 'NotI', 'XhoI', 'NheI', 'SpeI',
      'XbaI', 'PstI', 'SalI', 'NdeI', 'KpnI', 'SacI', 'SmaI',
      'EcoRV', 'AgeI', 'MluI', 'NcoI', 'BglII', 'AscI', 'PacI',
      'PmeI', 'SbfI', 'BsaI', 'BsmBI', 'BbsI', 'SapI', 'PaqCI',
      'AarI', 'DpnI',
    ];
    for (const name of required) {
      expect(getEnzymeByName(name), name).toBeDefined();
    }

    const buffers = ['r1.1', 'r2.1', 'r3.1', 'rCutSmart'] as const;
    for (const enzyme of COMMERCIAL_ENZYMES) {
      expect(enzyme.recognitionSeq).toMatch(/^[ACGTURYSWKMBDHVN]+$/);
      expect(enzyme.cutIndexTop).toBeGreaterThanOrEqual(0);
      expect(enzyme.cutIndexBottom).toBeGreaterThanOrEqual(0);
      expect(enzyme.methylationSensitivity).toBeDefined();
      expect(enzyme.nebBuffers).toBeDefined();
      for (const buffer of buffers) {
        expect(enzyme.nebBuffers?.[buffer]).toBeGreaterThanOrEqual(0);
        expect(enzyme.nebBuffers?.[buffer]).toBeLessThanOrEqual(100);
      }
    }

    const names = COMMERCIAL_ENZYMES.map((enzyme) => enzyme.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks golden-gate enzymes as Type IIS and resolves names case-insensitively', () => {
    for (const name of ['BsaI', 'BsmBI', 'BbsI', 'SapI', 'PaqCI', 'AarI']) {
      expect(getEnzymeByName(name)?.isTypeIIS).toBe(true);
    }
    expect(getEnzymeByName('ecori')?.name).toBe('EcoRI');
    expect(getEnzymeByName('EcoRI')?.isTypeIIS).toBe(false);
  });
});

describe('feature library', () => {
  it('contains at least thirty-five authentic, DNA-only element entries', () => {
    expect(FEATURE_LIBRARY.length).toBeGreaterThanOrEqual(35);
    for (const entry of FEATURE_LIBRARY) {
      expect(entry.sequence).toMatch(/^[ACGT]+$/);
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const names = FEATURE_LIBRARY.map((entry) => entry.name.toLowerCase()).join(' ');
    for (const expected of [
      'cmv enhancer',
      'cmv promoter',
      'ef1a',
      't7',
      'u6',
      'lacuv5',
      'amp',
      'egfp',
      'mcherry',
      'tdtomato',
      'mneongreen',
      'luciferase',
      'cas9',
      'cre',
      'wpre',
      'sv40 polya',
      'bgh polya',
      'loxp',
      'attb1',
      'attb2',
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe('sequence primitives', () => {
  it('calculates GC content, reverse complements and translates DNA', () => {
    expect(calcGcPercent('GGCC')).toBe(100);
    expect(calcGcPercent('ATAT')).toBe(0);
    expect(calcGcPercent('')).toBe(0);
    expect(reverseComplement('GAATTC')).toBe('GAATTC');
    expect(reverseComplement('ATGC')).toBe('GCAT');
    expect(translateDna('ATGGCTTAA')).toBe('MA*');
    expect(translateDna('ATGNNNTGA')).toBe('MX*');
  });
});

describe('restriction digestion', () => {
  it('finds an EcoRI site spanning the zero origin of a circular plasmid', () => {
    const sequence = `${'TTC'}${'C'.repeat(44)}GAA`;
    const doc = makeDoc(sequence);
    const enzyme = getEnzymeByName('EcoRI');
    expect(enzyme).toBeDefined();

    const sites = findCutSites(doc, [enzyme!]);
    expect(sites).toHaveLength(1);
    const site = sites[0];
    expect(site.position).toBe(47);
    expect(site.strand).toBe(1);
    expect(site.cutPositionTop).toBe(48);
    expect(site.cutPositionBottom).toBe(2);
    expect(site.overhangType).toBe('5-prime');
    expect(site.overhangSeq).toBe('AATT');
    expect(site.totalCutsInPlasmid).toBe(1);
    expect(findCutSites(doc, [enzyme!], { uniqueOnly: true })).toHaveLength(1);
  });

  it('counts multiple sites and applies the unique-cutter filter', () => {
    const sequence = `GAATTC${'C'.repeat(38)}GAATTC`;
    const doc = makeDoc(sequence);
    const enzyme = getEnzymeByName('EcoRI')!;
    const sites = findCutSites(doc, [enzyme]);
    expect(sites).toHaveLength(2);
    expect(sites.every((site) => site.totalCutsInPlasmid === 2)).toBe(true);
    expect(findCutSites(doc, [enzyme], { uniqueOnly: true })).toHaveLength(0);
  });

  it('computes a BsaI Type IIS cut on the negative strand', () => {
    const sequence = `CCCCCAAGC${'C'}GAGACC${'C'.repeat(64)}`;
    const doc = makeDoc(sequence, 'linear');
    const enzyme = getEnzymeByName('BsaI');
    expect(enzyme).toBeDefined();

    const sites = findCutSites(doc, [enzyme!]);
    expect(sites).toHaveLength(1);
    const site = sites[0];
    expect(site.strand).toBe(-1);
    expect(site.position).toBe(10);
    expect(site.cutPositionTop).toBe(5);
    expect(site.cutPositionBottom).toBe(9);
    expect(site.overhangType).toBe('5-prime');
    expect(site.overhangSeq).toBe(sequence.slice(5, 9));
  });

  it('reports three-prime and blunt overhangs', () => {
    const kpnSequence = `GGTACC${'C'.repeat(44)}`;
    const kpnSite = findCutSites(
      makeDoc(kpnSequence, 'linear'),
      [getEnzymeByName('KpnI')!],
    )[0];
    expect(kpnSite.cutPositionTop).toBe(5);
    expect(kpnSite.cutPositionBottom).toBe(1);
    expect(kpnSite.overhangType).toBe('3-prime');
    expect(kpnSite.overhangSeq).toBe('GTAC');

    const ecorvSequence = `GATATC${'C'.repeat(44)}`;
    const ecorvSite = findCutSites(
      makeDoc(ecorvSequence, 'linear'),
      [getEnzymeByName('EcoRV')!],
    )[0];
    expect(ecorvSite.cutPositionTop).toBe(3);
    expect(ecorvSite.cutPositionBottom).toBe(3);
    expect(ecorvSite.overhangType).toBe('blunt');
    expect(ecorvSite.overhangSeq).toBe('');
  });

  it('blocks XbaI when a Dam site overlaps TCTAGATC and gates DpnI on Dam status', () => {
    const sequence = `${'C'.repeat(10)}TCTAGATC${'C'.repeat(82)}`;
    const damDoc = makeDoc(sequence, 'linear', [], [], {
      dam: true,
      dcm: false,
      cpg: false,
    });
    const noDamDoc = makeDoc(sequence, 'linear', [], [], {
      dam: false,
      dcm: false,
      cpg: false,
    });
    const xbaI = getEnzymeByName('XbaI')!;
    const dpnI = getEnzymeByName('DpnI')!;

    const blocked = findCutSites(damDoc, [xbaI]);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].isMethylationBlocked).toBe(true);
    expect(
      findCutSites(damDoc, [xbaI], { excludeMethylationBlocked: true }),
    ).toHaveLength(0);

    const unmethylated = findCutSites(noDamDoc, [xbaI]);
    expect(unmethylated).toHaveLength(1);
    expect(unmethylated[0].isMethylationBlocked).toBe(false);

    const dpnOnDam = findCutSites(damDoc, [dpnI]);
    expect(dpnOnDam).toHaveLength(1);
    expect(dpnOnDam[0].isMethylationBlocked).toBe(false);

    const dpnWithoutDam = findCutSites(noDamDoc, [dpnI]);
    expect(dpnWithoutDam).toHaveLength(1);
    expect(dpnWithoutDam[0].isMethylationBlocked).toBe(true);
  });

  it('detects Dcm and CpG methylation dependencies', () => {
    const dcmSequence = `${'C'.repeat(10)}CCAGG${'C'.repeat(85)}`;
    const dcmDoc = makeDoc(dcmSequence, 'linear', [], [], {
      dam: false,
      dcm: true,
      cpg: false,
    });
    const bstNI = getEnzymeByName('BstNI')!;
    const bstSites = findCutSites(dcmDoc, [bstNI]);
    expect(bstSites).toHaveLength(1);
    expect(bstSites[0].isMethylationBlocked).toBe(true);

    const cpgSequence = `${'C'.repeat(10)}CCGG${'C'.repeat(86)}`;
    const cpgDoc = makeDoc(cpgSequence, 'linear', [], [], {
      dam: false,
      dcm: false,
      cpg: true,
    });
    const hpaII = getEnzymeByName('HpaII')!;
    const hpaSites = findCutSites(cpgDoc, [hpaII]);
    expect(hpaSites).toHaveLength(1);
    expect(hpaSites[0].isMethylationBlocked).toBe(true);
  });

  it('filters non-commercial enzymes and inactive buffers', () => {
    const sequence = `GAATTC${'C'.repeat(44)}`;
    const doc = makeDoc(sequence, 'linear');
    const ecoRI = getEnzymeByName('EcoRI')!;
    const custom = {
      ...ecoRI,
      name: 'CustomEco',
      suppliers: [],
      nebBuffers: { 'r1.1': 0, 'r2.1': 0, 'r3.1': 0, rCutSmart: 0 },
    };
    expect(findCutSites(doc, [custom], { commercialOnly: true })).toHaveLength(0);
    expect(findCutSites(doc, [custom], { buffer: 'rCutSmart' })).toHaveLength(0);
    expect(findCutSites(doc, [custom])).toHaveLength(1);
  });
});

describe('six-frame ORF discovery', () => {
  it('finds an ORF that crosses the circular origin with a shifted phase', () => {
    const bases = new Array<string>(60).fill('C');
    const set = (index: number, base: string): void => {
      bases[index] = base;
    };
    set(55, 'A');
    set(56, 'T');
    set(57, 'G');
    set(58, 'G');
    set(59, 'C');
    set(0, 'T');
    set(1, 'G');
    set(2, 'C');
    set(3, 'T');
    set(4, 'G');
    set(5, 'C');
    set(6, 'T');
    set(7, 'T');
    set(8, 'A');
    set(9, 'A');
    const doc = makeDoc(bases.join(''), 'circular');

    const orfs = findAllORFs(doc, 4);
    const target = orfs.find((orf) => orf.start === 55 && orf.strand === 1);
    expect(target).toBeDefined();
    expect(target!.end).toBe(10);
    expect(target!.lengthBp).toBe(15);
    expect(target!.aminoAcids).toBe('MAAA');
    expect(target!.frame).toBe(2);
    expect(target!.mwKda).toBeGreaterThan(0);
    expect(target!.pI).toBeGreaterThan(0);
  });

  it('keeps the reading phase when a circular length is not divisible by three', () => {
    const bases = new Array<string>(61).fill('C');
    const set = (index: number, base: string): void => {
      bases[index] = base;
    };
    set(56, 'A');
    set(57, 'T');
    set(58, 'G');
    set(59, 'G');
    set(60, 'C');
    set(0, 'T');
    set(1, 'G');
    set(2, 'C');
    set(3, 'T');
    set(4, 'G');
    set(5, 'C');
    set(6, 'T');
    set(7, 'T');
    set(8, 'A');
    set(9, 'A');

    const doc = makeDoc(bases.join(''), 'circular');
    const target = findAllORFs(doc, 4).find(
      (orf) => orf.start === 56 && orf.strand === 1,
    );
    expect(target).toBeDefined();
    expect(target!.end).toBe(10);
    expect(target!.lengthBp).toBe(15);
    expect(target!.aminoAcids).toBe('MAAA');
  });

  it('maps a cross-origin ORF back from the minus strand', () => {
    const bases = new Array<string>(60).fill('C');
    const set = (index: number, base: string): void => {
      bases[index] = base;
    };
    set(55, 'A');
    set(56, 'T');
    set(57, 'G');
    set(58, 'G');
    set(59, 'C');
    set(0, 'T');
    set(1, 'G');
    set(2, 'C');
    set(3, 'T');
    set(4, 'G');
    set(5, 'C');
    set(6, 'T');
    set(7, 'T');
    set(8, 'A');
    set(9, 'A');

    const minusDoc = makeDoc(reverseComplement(bases.join('')), 'circular');
    const target = findAllORFs(minusDoc, 4).find(
      (orf) => orf.strand === -1 && orf.aminoAcids === 'MAAA',
    );
    expect(target).toBeDefined();
    expect(target!.start).toBe(50);
    expect(target!.end).toBe(5);
    expect(target!.lengthBp).toBe(15);
  });

  it('returns protein properties for long linear ORFs', () => {
    const coding = `ATG${'GCT'.repeat(100)}TAA`;
    const doc = makeDoc(coding, 'linear');
    const orfs = findAllORFs(doc, 50);
    expect(orfs).toHaveLength(1);
    expect(orfs[0].lengthBp).toBe(coding.length);
    expect(orfs[0].aminoAcids.length).toBe(101);
    expect(Number.isFinite(orfs[0].mwKda)).toBe(true);
    expect(orfs[0].pI).toBeGreaterThan(0);
  });

  it('keeps linear ORF ends at the sequence boundary', () => {
    const coding = `CCC${'ATG'}${'GCT'.repeat(20)}TAA`;
    const doc = makeDoc(coding, 'linear');
    const orf = findAllORFs(doc, 20).find((candidate) => candidate.start === 3);
    expect(orf).toBeDefined();
    expect(orf!.end).toBe(coding.length);
    expect(orf!.lengthBp).toBe(coding.length - 3);
  });
});

describe('sequence editing and feature linkage', () => {
  it('shifts feature and primer coordinates after insertion and deletion', () => {
    const sequence = 'ACGT'.repeat(25);
    const feature = makeFeature(10, 20);
    const primer = makePrimer(30, 40);
    const doc = makeDoc(sequence, 'circular', [feature], [primer]);

    const inserted = mutatePlasmidSequence(doc, {
      type: 'insert',
      position: 15,
      bases: 'GGGGG',
    });
    expect(inserted.length).toBe(105);
    expect(inserted.sequence).toBe(
      sequence.slice(0, 15) + 'GGGGG' + sequence.slice(15),
    );
    expect(inserted.features[0].start).toBe(10);
    expect(inserted.features[0].end).toBe(25);
    expect(inserted.primers[0].bindingStart).toBe(35);
    expect(inserted.primers[0].bindingEnd).toBe(45);
    expect(inserted.history).toHaveLength(1);
    expect(inserted.history[0].operation).toBe('manual_edit');
    expect(inserted.history[0].parentSnapshots?.[0].length).toBe(100);
    expect(doc.sequence).toBe(sequence);
    expect(doc.features[0].end).toBe(20);

    const deleted = mutatePlasmidSequence(inserted, {
      type: 'delete',
      start: 12,
      end: 18,
    });
    expect(deleted.length).toBe(99);
    expect(deleted.features[0].start).toBe(10);
    expect(deleted.features[0].end).toBe(19);
    expect(deleted.primers[0].bindingStart).toBe(29);
    expect(deleted.primers[0].bindingEnd).toBe(39);
    expect(deleted.history).toHaveLength(2);
  });

  it('removes features that are fully deleted and handles wrapped ranges', () => {
    const sequence = 'ACGT'.repeat(25);
    const removable = makeFeature(10, 20, { id: 'removable' });
    const wrapped = makeFeature(90, 10, { id: 'wrapped' });
    const doc = makeDoc(sequence, 'circular', [removable, wrapped]);

    const removed = mutatePlasmidSequence(doc, {
      type: 'delete',
      start: 10,
      end: 20,
    });
    expect(removed.features.some((feature) => feature.id === 'removable')).toBe(false);
    const survivingWrap = removed.features.find((feature) => feature.id === 'wrapped');
    expect(survivingWrap).toBeDefined();
    expect(survivingWrap!.start).toBe(80);
    expect(survivingWrap!.end).toBe(10);

    const inserted = mutatePlasmidSequence(doc, {
      type: 'insert',
      position: 95,
      bases: 'AAA',
    });
    const wrapAfterInsert = inserted.features.find((feature) => feature.id === 'wrapped');
    expect(wrapAfterInsert).toBeDefined();
    expect(wrapAfterInsert!.start).toBe(90);
    expect(wrapAfterInsert!.end).toBe(10);
    expect(inserted.length).toBe(103);
  });

  it('keeps a feature that becomes the full remaining circle after deletion', () => {
    const sequence = 'ACGT'.repeat(25);
    const feature = makeFeature(0, 50);
    const doc = makeDoc(sequence, 'circular', [feature]);
    const deleted = mutatePlasmidSequence(doc, {
      type: 'delete',
      start: 50,
      end: 100,
    });
    expect(deleted.length).toBe(50);
    expect(deleted.features).toHaveLength(1);
    expect(deleted.features[0].start).toBe(0);
    expect(deleted.features[0].end).toBe(50);
  });

  it('deletes a range that crosses the origin of a circular plasmid', () => {
    const sequence = 'ACGT'.repeat(25);
    const feature = makeFeature(90, 10, { id: 'wrapped' });
    const doc = makeDoc(sequence, 'circular', [feature]);
    const deleted = mutatePlasmidSequence(doc, {
      type: 'delete',
      start: 80,
      end: 5,
    });
    expect(deleted.length).toBe(75);
    expect(deleted.sequence).toBe(sequence.slice(5, 80));
    expect(deleted.features).toHaveLength(1);
    expect(deleted.features[0].start).toBe(0);
    expect(deleted.features[0].end).toBe(5);
  });

  it('replaces an entire sequence and clears its annotations', () => {
    const doc = makeDoc(
      'ACGT'.repeat(25),
      'circular',
      [makeFeature(10, 20)],
    );
    const replaced = mutatePlasmidSequence(doc, {
      type: 'replace',
      start: 0,
      end: 100,
      bases: 'GGGG',
    });
    expect(replaced.sequence).toBe('GGGG');
    expect(replaced.length).toBe(4);
    expect(replaced.features).toHaveLength(0);
    expect(replaced.history).toHaveLength(1);
  });

  it('preserves a wrapped feature replaced exactly by a wrapped replacement', () => {
    const sequence = 'ACGT'.repeat(25);
    const feature = makeFeature(90, 10, { id: 'wrapped' });
    const doc = makeDoc(sequence, 'circular', [feature]);
    const replaced = mutatePlasmidSequence(doc, {
      type: 'replace',
      start: 90,
      end: 10,
      bases: 'TTTTT',
    });
    expect(replaced.length).toBe(85);
    expect(replaced.features).toHaveLength(1);
    expect(replaced.features[0].start).toBe(0);
    expect(replaced.features[0].end).toBe(5);
  });

  it('supports replacement edits and preserves history', () => {
    const sequence = 'ACGT'.repeat(25);
    const feature = makeFeature(10, 20);
    const doc = makeDoc(sequence, 'circular', [feature]);
    const replaced = mutatePlasmidSequence(doc, {
      type: 'replace',
      start: 10,
      end: 20,
      bases: 'TTTTT',
    });
    expect(replaced.length).toBe(95);
    expect(replaced.sequence).toBe(sequence.slice(0, 10) + 'TTTTT' + sequence.slice(20));
    expect(replaced.features).toHaveLength(1);
    expect(replaced.features[0].start).toBe(10);
    expect(replaced.features[0].end).toBe(15);
    expect(replaced.history.at(-1)?.description).toContain('Replaced');
  });
});

describe('reverse complement and origin rotation', () => {
  it('reverse complements sequence, features and primers without losing metadata', () => {
    const sequence = 'ACGT'.repeat(25);
    const feature = makeFeature(10, 20, { codonStart: 1 });
    const primer = makePrimer(30, 40, { sequence: 'ACGTACGTACGTACGTACGT' });
    const doc = makeDoc(sequence, 'circular', [feature], [primer]);

    const result = reverseComplementPlasmid(doc);
    expect(result.sequence).toBe(reverseComplement(sequence));
    expect(result.features[0].start).toBe(80);
    expect(result.features[0].end).toBe(90);
    expect(result.features[0].strand).toBe(-1);
    expect(result.features[0].codonStart).toBe(1);
    expect(result.primers[0].bindingStart).toBe(60);
    expect(result.primers[0].bindingEnd).toBe(70);
    expect(result.primers[0].strand).toBe(-1);
    expect(result.primers[0].sequence).toBe(primer.sequence);
    expect(result.history).toHaveLength(1);
    expect(result.history[0].operation).toBe('manual_edit');
  });

  it('reverse complements linear features without wrapping coordinates', () => {
    const sequence = 'ACGT'.repeat(25);
    const feature = makeFeature(0, 10);
    const doc = makeDoc(sequence, 'linear', [feature]);
    const result = reverseComplementPlasmid(doc);
    expect(result.features[0].start).toBe(90);
    expect(result.features[0].end).toBe(100);
    expect(result.features[0].strand).toBe(-1);
  });

  it('rotates a circular origin and shifts all annotations', () => {
    const sequence = 'ACGT'.repeat(25);
    const feature = makeFeature(10, 20);
    const wrapped = makeFeature(90, 10, { id: 'wrapped' });
    const primer = makePrimer(30, 40);
    const doc = makeDoc(sequence, 'circular', [feature, wrapped], [primer]);

    const rotated = rotateCircularOrigin(doc, 25);
    expect(rotated.sequence).toBe(sequence.slice(25) + sequence.slice(0, 25));
    expect(rotated.features[0].start).toBe(85);
    expect(rotated.features[0].end).toBe(95);
    expect(rotated.features[1].start).toBe(65);
    expect(rotated.features[1].end).toBe(85);
    expect(rotated.primers[0].bindingStart).toBe(5);
    expect(rotated.primers[0].bindingEnd).toBe(15);
    expect(rotated.history).toHaveLength(1);

    const wrappedRotation = rotateCircularOrigin(doc, 5);
    expect(wrappedRotation.features[0].start).toBe(5);
    expect(wrappedRotation.features[0].end).toBe(15);
    expect(wrappedRotation.features[1].start).toBe(85);
    expect(wrappedRotation.features[1].end).toBe(5);

    expect(() => rotateCircularOrigin(makeDoc(sequence, 'linear'), 5)).toThrow();
  });
});

describe('local feature auto-annotation', () => {
  const egfp = FEATURE_LIBRARY.find((entry) => entry.name === 'EGFP')!;

  it('finds an EGFP element on the forward strand and skips existing annotations', () => {
    const sequence = `${'C'.repeat(20)}${egfp.sequence}${'C'.repeat(20)}`;
    const doc = makeDoc(sequence, 'linear');
    const discovered = autoAnnotateFeatures(doc);
    const found = discovered.find((feature) => feature.name === 'EGFP');
    expect(found).toBeDefined();
    expect(found!.start).toBe(20);
    expect(found!.end).toBe(20 + egfp.sequence.length);
    expect(found!.strand).toBe(1);
    expect(found!.type).toBe('CDS');

    const existing = makeFeature(20, 20 + egfp.sequence.length, {
      name: 'EGFP',
      type: 'CDS',
    });
    const docWithExisting = makeDoc(sequence, 'linear', [existing]);
    expect(
      autoAnnotateFeatures(docWithExisting).some(
        (feature) => feature.name === 'EGFP',
      ),
    ).toBe(false);
  });

  it('finds elements on the reverse strand and tolerates a single mismatch', () => {
    const reversed = reverseComplement(egfp.sequence);
    const sequence = `${'C'.repeat(15)}${reversed}${'C'.repeat(15)}`;
    const doc = makeDoc(sequence, 'linear');
    const found = autoAnnotateFeatures(doc).find(
      (feature) => feature.name === 'EGFP',
    );
    expect(found).toBeDefined();
    expect(found!.strand).toBe(-1);
    expect(found!.start).toBe(15);

    const mutationIndex = 100;
    const replacement = egfp.sequence[mutationIndex] === 'A' ? 'C' : 'A';
    const mutated =
      egfp.sequence.slice(0, mutationIndex) +
      replacement +
      egfp.sequence.slice(mutationIndex + 1);
    const mutatedSequence = `${'C'.repeat(25)}${mutated}${'C'.repeat(25)}`;
    const tolerant = autoAnnotateFeatures(makeDoc(mutatedSequence, 'linear')).find(
      (feature) => feature.name === 'EGFP',
    );
    expect(tolerant).toBeDefined();
    expect(tolerant!.start).toBe(25);
  });

  it('annotates a large circular plasmid quickly after the library automaton is warm', () => {
    let seed = 123456789;
    const alphabet = 'ACGT';
    let largeSequence = '';
    for (let index = 0; index < 50000; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      largeSequence += alphabet[seed & 3];
    }
    const doc = makeDoc(largeSequence, 'circular');
    autoAnnotateFeatures(doc);
    const start = performance.now();
    const features = autoAnnotateFeatures(doc);
    const elapsed = performance.now() - start;
    expect(Array.isArray(features)).toBe(true);
    expect(elapsed).toBeLessThan(250);
  });

  it('annotates a 100 kb circular sequence within thirty milliseconds', () => {
    let seed = 987654321;
    const alphabet = 'ACGT';
    let largeSequence = '';
    for (let index = 0; index < 100000; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      largeSequence += alphabet[seed & 3];
    }
    const doc = makeDoc(largeSequence, 'circular');
    for (let warmup = 0; warmup < 2; warmup += 1) {
      autoAnnotateFeatures(doc);
    }

    const samples: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      const features = autoAnnotateFeatures(doc);
      samples.push(performance.now() - start);
      expect(Array.isArray(features)).toBe(true);
    }
    expect(Math.min(...samples)).toBeLessThan(30);
  });
});

describe('annotation of real vector records', () => {
  it('annotates pUC19 with wild-type lac elements and M13 primer sites', () => {
    const sequence = readSampleSequence('pUC19.gb');
    expect(sequence).toHaveLength(2686);

    const features = autoAnnotateFeatures(makeDoc(sequence, 'circular'));
    const names = featureNames(features);

    expect(names.some((name) => /lacZ/i.test(name))).toBe(true);
    expect(names.some((name) => /^lac promoter$/i.test(name))).toBe(true);
    expect(names.some((name) => /lacUV5/i.test(name))).toBe(false);
    expect(names.some((name) => /lac operator/i.test(name))).toBe(true);
    expect(names.some((name) => /M13 fwd/i.test(name))).toBe(true);
    expect(names.some((name) => /M13 rev/i.test(name))).toBe(true);
    expect(names.some((name) => /AmpR/i.test(name))).toBe(true);
    expect(names.some((name) => /ori/i.test(name))).toBe(true);
  });

  it('keeps the standard pEGFP-N1 elements annotated', () => {
    const sequence = readSampleSequence('pEGFP-N1.gb');
    expect(sequence).toHaveLength(4733);

    const names = featureNames(autoAnnotateFeatures(makeDoc(sequence, 'circular')));
    expect(names.some((name) => /EGFP/i.test(name))).toBe(true);
    expect(names.some((name) => /CMV promoter/i.test(name))).toBe(true);
    expect(names.some((name) => /SV40 polyA/i.test(name))).toBe(true);
    expect(names.some((name) => /KanR|NeoR/i.test(name))).toBe(true);
    expect(names.some((name) => /f1 ori/i.test(name))).toBe(true);
    expect(names.some((name) => /SV40 ori/i.test(name))).toBe(true);
  });
});

function makeRandomSequence(length: number, seed: number): string {
  const alphabet = 'ACGT';
  let state = seed >>> 0;
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    sequence += alphabet[(state >>> 24) & 3];
  }
  return sequence;
}

describe('expanded restriction enzyme catalogue', () => {
  it('contains the full database and a commercial catalogue of at least 550 enzymes', () => {
    expect(ENZYME_DATABASE.length).toBeGreaterThanOrEqual(1500);
    expect(COMMERCIAL_ENZYMES.length).toBeGreaterThanOrEqual(550);

    const names = COMMERCIAL_ENZYMES.map((enzyme) => enzyme.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const enzyme of COMMERCIAL_ENZYMES) {
      expect(enzyme.recognitionSeq).toMatch(/^[ACGTURYSWKMBDHVN]+$/);
      expect(enzyme.suppliers?.length ?? 0).toBeGreaterThan(0);
      expect(enzyme.methylationSensitivity).toBeDefined();
    }
  });

  it('resolves REBASE aliases case-insensitively', () => {
    expect(getEnzymeByName('asp718i')?.recognitionSeq).toBe('GGTACC');
    expect(getEnzymeByName('BME18I')?.recognitionSeq).toBe('GGWCC');
    expect(getEnzymeByName('paqci')?.isTypeIIS).toBe(true);
    expect(getEnzymeByName('not-an-enzyme')).toBeUndefined();
  });

  it('reports isoschizomers and neoschizomers from the shared recognition site', () => {
    const kpnI = getEnzymeByName('KpnI');
    expect(kpnI).toBeDefined();
    const kpnResult = findIsoschizomers(kpnI!);
    expect(
      kpnResult.neoschizomers.some((enzyme) => enzyme.name === 'Acc65I'),
    ).toBe(true);

    const acc65I = getEnzymeByName('Acc65I');
    expect(acc65I).toBeDefined();
    const accResult = findIsoschizomers(acc65I!);
    expect(accResult.isoschizomers.length).toBeGreaterThan(0);
    expect(
      accResult.isoschizomers.every(
        (enzyme) =>
          enzyme.cutIndexTop === acc65I!.cutIndexTop &&
          enzyme.cutIndexBottom === acc65I!.cutIndexBottom,
      ),
    ).toBe(true);
  });

  it('keeps every preset enzyme set resolvable and filters by metadata', () => {
    expect(ENZYME_SETS.length).toBeGreaterThanOrEqual(8);
    for (const set of ENZYME_SETS) {
      expect(set.enzymeNames.length).toBeGreaterThan(0);
      for (const name of set.enzymeNames) {
        expect(getEnzymeByName(name), `${set.id}: ${name}`).toBeDefined();
      }
    }

    const typeIIS = filterEnzymes(COMMERCIAL_ENZYMES, { typeIIS: true });
    expect(typeIIS.length).toBeGreaterThan(0);
    expect(typeIIS.every((enzyme) => enzyme.isTypeIIS === true)).toBe(true);

    const blunt = filterEnzymes(COMMERCIAL_ENZYMES, { overhang: ['blunt'] });
    expect(blunt.length).toBeGreaterThan(0);
    expect(
      blunt.every((enzyme) => enzyme.cutIndexTop === enzyme.cutIndexBottom),
    ).toBe(true);

    const nebSix = filterEnzymes(COMMERCIAL_ENZYMES, {
      minSiteLength: 6,
      maxSiteLength: 8,
      supplier: 'NEB',
      nameQuery: 'i',
    });
    expect(nebSix.length).toBeGreaterThan(0);
    expect(
      filterEnzymes(COMMERCIAL_ENZYMES, { supplier: 'Thermo' }).length,
    ).toBeGreaterThan(0);
  });

  it('scans a 100 kb circular plasmid with the full commercial catalogue quickly', () => {
    const doc = makeDoc(makeRandomSequence(100000, 424242), 'circular');
    for (let warmup = 0; warmup < 2; warmup += 1) {
      findCutSites(doc, COMMERCIAL_ENZYMES);
    }
    const samples: number[] = [];
    let siteCount = 0;
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      const sites = findCutSites(doc, COMMERCIAL_ENZYMES);
      samples.push(performance.now() - start);
      siteCount = sites.length;
    }
    expect(siteCount).toBeGreaterThan(0);
    expect(Math.min(...samples)).toBeLessThan(400);
  });
});

describe('IUPAC motif search', () => {
  it('finds a hit spanning the circular origin', () => {
    const sequence = `${'TTC'}${'C'.repeat(44)}GAA`;
    const hits = searchMotif(makeDoc(sequence, 'circular'), 'GAATTC');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      start: 47,
      end: 3,
      strand: 1,
      mismatches: 0,
      matched: 'GAATTC',
    });
  });

  it('finds negative-strand hits and returns positive-strand coordinates', () => {
    const recognition = 'GGTCTC';
    const sequence = `${'C'.repeat(20)}${reverseComplement(recognition)}${'C'.repeat(20)}`;
    const hits = searchMotif(makeDoc(sequence, 'linear'), recognition);
    const minus = hits.find((hit) => hit.strand === -1);
    expect(minus).toBeDefined();
    expect(minus!.start).toBe(20);
    expect(minus!.end).toBe(26);
    expect(minus!.matched).toBe(recognition);
    expect(minus!.mismatches).toBe(0);
  });

  it('maps a negative-strand hit across the circular origin', () => {
    const sequence = `${'ACC'}${'C'.repeat(44)}GAG`;
    const hits = searchMotif(makeDoc(sequence, 'circular'), 'GGTCTC');
    const minus = hits.find((hit) => hit.strand === -1);
    expect(minus).toBeDefined();
    expect(minus!.start).toBe(47);
    expect(minus!.end).toBe(3);
    expect(minus!.matched).toBe('GGTCTC');
  });

  it('allows Hamming mismatches and respects the mismatch limit', () => {
    const sequence = `${'C'.repeat(10)}GAAATC${'C'.repeat(20)}`;
    const doc = makeDoc(sequence, 'linear');
    expect(searchMotif(doc, 'GAATTC')).toHaveLength(0);
    const tolerant = searchMotif(doc, 'GAATTC', { maxMismatches: 1 });
    expect(tolerant).toHaveLength(1);
    expect(tolerant[0].mismatches).toBe(1);
    expect(tolerant[0].start).toBe(10);
    expect(tolerant[0].matched).toBe('GAAATC');
  });

  it('searches all six reading frames for protein patterns', () => {
    const sequence = `CCCATGGCTACT${'C'.repeat(12)}`;
    const doc = makeDoc(sequence, 'linear');
    const hits = searchMotif(doc, 'MAT', { protein: true, bothStrands: false });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({
      start: 3,
      end: 12,
      strand: 1,
      mismatches: 0,
      matched: 'MAT',
    });

    const wildcard = searchMotif(doc, 'MXT', { protein: true, bothStrands: false });
    expect(wildcard.some((hit) => hit.matched === 'MAT')).toBe(true);

    const minusDoc = makeDoc(reverseComplement('ATGGCTTAA'), 'linear');
    const minus = searchMotif(minusDoc, 'MA', { protein: true }).find(
      (hit) => hit.strand === -1,
    );
    expect(minus).toBeDefined();
    expect(minus!.start).toBe(3);
    expect(minus!.end).toBe(9);
    expect(minus!.matched).toBe('MA');
  });

  it('scans a 100 kb sequence for a 20 bp motif with two mismatches quickly', () => {
    const doc = makeDoc(makeRandomSequence(100000, 98765), 'circular');
    const start = performance.now();
    const hits = searchMotif(doc, 'GATCGATCGATCGATCGATC', { maxMismatches: 2 });
    const elapsed = performance.now() - start;
    expect(Array.isArray(hits)).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('reverse translation and codon usage', () => {
  const protein = 'MKTIIALSYIFCLVFADYKDDDDK';
  const organisms: CodonUsageOrganism[] = [
    'E. coli',
    'S. cerevisiae',
    'H. sapiens',
    'M. musculus',
    'P. pastoris',
    'D. melanogaster',
    'A. thaliana',
    'CHO',
  ];

  it('provides 64 codon frequencies for every supported organism', () => {
    for (const organism of organisms) {
      expect(Object.keys(CODON_USAGE[organism])).toHaveLength(64);
      for (const frequency of Object.values(CODON_USAGE[organism])) {
        expect(frequency).toBeGreaterThan(0);
      }
    }
  });

  it('round-trips proteins with the most-frequent and weighted strategies', () => {
    for (const organism of organisms) {
      const common = backTranslate(protein, organism);
      expect(common).toHaveLength(protein.length * 3);
      expect(translateDna(common)).toBe(protein);

      const weightedA = backTranslate(protein, organism, {
        strategy: 'weighted',
        seed: 12345,
      });
      const weightedB = backTranslate(protein, organism, {
        strategy: 'weighted',
        seed: 12345,
      });
      expect(weightedA).toBe(weightedB);
      expect(translateDna(weightedA)).toBe(protein);
    }
  });

  it('removes forbidden recognition sites with synonymous codons', () => {
    const avoidSites = ['GAATTC', 'GGTCTC', 'AAGCTT'];
    for (const organism of organisms) {
      const dna = backTranslate(protein, organism, { avoidSites });
      expect(translateDna(dna)).toBe(protein);
      for (const site of avoidSites) {
        expect(dna.includes(site), `${organism} ${site}`).toBe(false);
        expect(dna.includes(reverseComplement(site)), `${organism} ${site} rc`).toBe(
          false,
        );
      }
    }
  });

  it('computes a codon adaptation index between zero and one', () => {
    for (const organism of organisms) {
      const dna = backTranslate(protein, organism);
      const cai = codonAdaptationIndex(dna, organism);
      expect(cai).toBeGreaterThan(0);
      expect(cai).toBeLessThanOrEqual(1);
    }
  });
});
