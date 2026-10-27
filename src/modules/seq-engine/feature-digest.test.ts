// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { PlasmidDocument } from '../../types/schema';
import {
  ENZYME_DIGEST_CONDITIONS,
  FEATURE_LIBRARY,
  autoAnnotateFeatures,
  backTranslate,
  getEnzymeByName,
  recommendDoubleDigestBuffer,
  reverseComplement,
  translateDna,
} from './index';
import type { FeatureLibraryEntry } from './index';

function makeDoc(sequence: string, topology: PlasmidDocument['topology'] = 'linear'): PlasmidDocument {
  return {
    id: 'doc-protein-test',
    name: 'protein test',
    sequence,
    topology,
    length: sequence.length,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features: [],
    primers: [],
    history: [],
  };
}

function entry(name: string): FeatureLibraryEntry {
  const found = FEATURE_LIBRARY.find((item) => item.name === name);
  if (!found) throw new Error(`Missing library entry ${name}`);
  return found;
}

describe('expanded feature library', () => {
  it('contains at least three hundred distinct public elements', () => {
    expect(FEATURE_LIBRARY.length).toBeGreaterThanOrEqual(300);
    expect(new Set(FEATURE_LIBRARY.map((item) => item.sequence)).size).toBe(
      FEATURE_LIBRARY.length,
    );
    for (const item of FEATURE_LIBRARY) {
      expect(item.sequence).toMatch(/^[ACGT]+$/);
      expect(item.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('covers the requested promoter, terminator, marker, origin and tag families', () => {
    const names = FEATURE_LIBRARY.map((item) => item.name.toLowerCase()).join(' ');
    for (const expected of [
      't7', 't3', 'sp6', 'lac', 'lacuv5', 'tac', 'trc', 'arabad', 'rhabad',
      'cmv enhancer', 'cmv promoter', 'ef-1alpha', 'pgk', 'cag', 'sv40',
      'rsv', 'u6', 'h1', '7sk', 'ubc', 'camv 35s', 'gal1', 'gal10', 'tef1',
      'adh1', 'tdh3', 'gpd', 'aox1', 'polyhedrin', 'p10', 't5',
      'rrnb t1', 'rrnb t2', 'lambda t0', 't7 terminator', 'bgh polya',
      'sv40 polya', 'hgh polya', 'cyc1',
      'ampr', 'kanr', 'neor', 'cmr', 'tetr', 'smr', 'specr', 'gentr',
      'zeor', 'hygr', 'puroR'.toLowerCase(), 'bsd', 'natr', 'hph', 'bar',
      'puc', 'pmb1', 'cole1', 'p15a', 'psc101', 'r6k', 'f1 ori',
      'sv40 ori', '2 micron', 'cen', 'pbr322', 'rk2', 'pro1600',
      'his6', 'flag', '3xflag', 'ha', 'myc', 'v5', 'strep', 'gst', 'mbp',
      'trx', 'sumo', 'egfp', 'mcherry', 'mneongreen', 'tdtomato', 'bfp',
      'mscarlet', 'yfp', 'cfp', 'firefly', 'renilla', 'nanoluc', 'tev',
      'prescission', 'thrombin', 'factor xa', 'enterokinase', 'ires',
      'wpre', 'cppt', 'rre', 'ltr', 'itr', 'attb', 'attp', 'attl', 'attr',
      'loxp', 'frt', 'kozak', 'mcs', 'nls', 'p2a', 't2a', 'e2a', 'f2a',
      'chs4', 'grna', 'cas9',
    ]) {
      expect(names, expected).toContain(expected);
    }
  });
});

describe('protein-aware feature annotation', () => {
  it('recognises codon-optimised fluorescent proteins through translation', () => {
    for (const name of ['EGFP', 'mCherry', 'mNeonGreen']) {
      const reference = entry(name);
      const protein = translateDna(reference.sequence).replace(/\*$/, '');
      const optimised = backTranslate(protein, 'E. coli', {
        strategy: 'weighted',
        seed: 7,
      });
      const sequence = `${'C'.repeat(20)}${optimised}${'C'.repeat(20)}`;
      const found = autoAnnotateFeatures(makeDoc(sequence)).find(
        (feature) => feature.name === name,
      );
      expect(found, name).toBeDefined();
      expect(found!.start).toBe(20);
      expect(found!.strand).toBe(1);
      expect(found!.type).toBe('CDS');
    }
  });

  it('recognises a codon-optimised coding sequence on the reverse strand', () => {
    const reference = entry('mCherry');
    const protein = translateDna(reference.sequence).replace(/\*$/, '');
    const optimised = backTranslate(protein, 'E. coli', {
      strategy: 'weighted',
      seed: 42,
    });
    const sequence = `${'C'.repeat(16)}${reverseComplement(optimised)}${'C'.repeat(16)}`;
    const found = autoAnnotateFeatures(makeDoc(sequence)).find(
      (feature) => feature.name === 'mCherry',
    );
    expect(found).toBeDefined();
    expect(found!.start).toBe(16);
    expect(found!.strand).toBe(-1);
  });


  it('finds an internal protein tag inside a longer open reading frame', () => {
    const flag = entry('FLAG');
    const codonOptimisedFlag = 'GACTACAAAGATGATGACGATAAG';
    const sequence = `ATG${'GCT'.repeat(2)}${codonOptimisedFlag}TAA`;
    const found = autoAnnotateFeatures(makeDoc(sequence)).find(
      (feature) => feature.name === 'FLAG',
    );
    expect(found).toBeDefined();
    expect(found!.start).toBe(9);
    expect(found!.end).toBe(9 + codonOptimisedFlag.length + 3);
  });

  it('prefers an exact nucleotide match when similar elements overlap', () => {
    const exactSequence =
      'ATGACCGAGGACGTGATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAG';
    const exact: FeatureLibraryEntry = {
      name: 'exact element',
      type: 'CDS',
      sequence: exactSequence,
      color: '#22c55e',
    };
    const near: FeatureLibraryEntry = {
      name: 'near element',
      type: 'CDS',
      sequence: `${exactSequence.slice(0, 30)}A${exactSequence.slice(31)}`,
      color: '#ef4444',
    };
    const found = autoAnnotateFeatures(makeDoc(exactSequence), [near, exact]);
    expect(found.map((feature) => feature.name)).toEqual(['exact element']);
  });
});

describe('double digest buffer recommendation', () => {
  it('provides NEBuffer data for more than one hundred twenty enzymes', () => {
    expect(Object.keys(ENZYME_DIGEST_CONDITIONS).length).toBeGreaterThanOrEqual(120);
    const ecoRI = ENZYME_DIGEST_CONDITIONS.EcoRI;
    expect(ecoRI.activities).toEqual({
      'r1.1': 25,
      'r2.1': 100,
      'r3.1': 50,
      rCutSmart: 50,
    });
    expect(ecoRI.incubationC).toBe(37);
    expect(ecoRI.heatInactivation).toContain('65°C');
    expect(ecoRI.starBuffers).toContain('r2.1');
    expect(ENZYME_DIGEST_CONDITIONS.PstI.starBuffers).toContain('rCutSmart');
    expect(getEnzymeByName('EcoRI')!.nebBuffers).toEqual({
      'r1.1': 25,
      'r2.1': 100,
      'r3.1': 50,
      rCutSmart: 50,
    });
    expect(getEnzymeByName('BamHI')!.nebBuffers).toEqual({
      'r1.1': 75,
      'r2.1': 100,
      'r3.1': 100,
      rCutSmart: 100,
    });
  });

  it('recommends r2.1 for EcoRI and HindIII and reports the EcoRI star risk', () => {
    const recommendation = recommendDoubleDigestBuffer([
      getEnzymeByName('EcoRI')!,
      getEnzymeByName('HindIII')!,
    ]);
    expect(recommendation.buffer).toBe('r2.1');
    expect(recommendation.activities).toEqual({ EcoRI: 100, HindIII: 100 });
    expect(recommendation.temperatureC).toEqual([37]);
    expect(recommendation.heatInactivation.EcoRI).toContain('65°C');
    expect(recommendation.heatInactivation.HindIII).toContain('80°C');
    expect(
      recommendation.starActivityWarning.some((warning) =>
        warning.includes('EcoRI'),
      ),
    ).toBe(true);
  });

  it('recommends r3.1 for BamHI and NotI', () => {
    const recommendation = recommendDoubleDigestBuffer([
      getEnzymeByName('BamHI')!,
      getEnzymeByName('NotI')!,
    ]);
    expect(recommendation.buffer).toBe('r3.1');
    expect(recommendation.activities).toEqual({ BamHI: 100, NotI: 100 });
    expect(recommendation.temperatureC).toEqual([37]);
  });

  it('falls back to a sequential digest when no common buffer reaches 75%', () => {
    const recommendation = recommendDoubleDigestBuffer([
      getEnzymeByName('AatII')!,
      getEnzymeByName('BglII')!,
    ]);
    expect(recommendation.buffer).toBe('sequential');
    expect(recommendation.activities).toEqual({ AatII: 100, BglII: 100 });
    const text = recommendation.notes.join(' ');
    expect(text).toContain('Step 1');
    expect(text.indexOf('AatII')).toBeLessThan(text.indexOf('BglII'));
    expect(text).toContain('rCutSmart');
    expect(text).toContain('NEBuffer r3.1');
    expect(recommendation.heatInactivation.AatII).toContain('80°C');
  });
});
