// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlasmidDocument, SequenceFeature, SangerTraceData } from '../../types/schema';
import {
  DNA_LADDERS,
  alignTraceToPlasmid,
  computeMigration,
  createSyntheticTrace,
  detectSecondaryPeaks,
  gotohLocalAlign,
  mottTrim,
  parseAb1Trace,
  simulateVirtualGel
} from './index';
import { iupacForPair, reverseComplement } from './genetics';

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomDna(seed: number, length: number): string {
  const random = createRandom(seed);
  const alphabet = 'ACGT';
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    sequence += alphabet[Math.floor(random() * 4)];
  }
  return sequence;
}

function makeDoc(
  sequence: string,
  options: {
    name?: string;
    topology?: 'circular' | 'linear';
    features?: SequenceFeature[];
  } = {}
): PlasmidDocument {
  return {
    id: 'doc-1',
    name: options.name ?? 'Test Plasmid',
    sequence,
    topology: options.topology ?? 'linear',
    length: sequence.length,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features: options.features ?? [],
    primers: [],
    history: []
  };
}

function makeFeature(overrides: Partial<SequenceFeature> = {}): SequenceFeature {
  return {
    id: 'feature-1',
    name: 'TEST_CDS',
    type: 'CDS',
    start: 0,
    end: 30,
    strand: 1,
    color: '#22c55e',
    ...overrides
  };
}

interface AbifFixtureEntry {
  name: string;
  number: number;
  type: number;
  elementSize: number;
  elementCount: number;
  dataSize: number;
  dataOffset: number;
  data: string | number[];
}

interface AbifFixtureOptions {
  peaks?: Array<{
    amplitude?: number;
    secondaryAmplitude?: number;
    secondaryBase?: string;
  }>;
}

function buildAb1Fixture(
  sequence: string,
  qualities: number[],
  channelOrder = 'GATC',
  options: AbifFixtureOptions = {}
): ArrayBuffer {
  const samples = sequence.length * 10 + 10;
  const traces: Record<'A' | 'T' | 'G' | 'C', number[]> = {
    A: new Array<number>(samples).fill(10),
    T: new Array<number>(samples).fill(10),
    G: new Array<number>(samples).fill(10),
    C: new Array<number>(samples).fill(10)
  };
  const locations: number[] = [];
  for (let index = 0; index < sequence.length; index += 1) {
    const location = 5 + index * 10;
    locations.push(location);
    const called = sequence[index];
    const primary = /^[ATGC]$/.test(called) ? (called as 'A' | 'T' | 'G' | 'C') : 'A';
    const override = options.peaks?.[index];
    const amplitude = override?.amplitude ?? 1000;
    traces[primary][location] = amplitude;
    const secondary = override?.secondaryBase?.toUpperCase();
    if (
      secondary &&
      /^[ATGC]$/.test(secondary) &&
      secondary !== primary &&
      override?.secondaryAmplitude !== undefined
    ) {
      traces[secondary as 'A' | 'T' | 'G' | 'C'][location] = Math.round(
        override.secondaryAmplitude
      );
    }
  }

  const channelBases = channelOrder.split('');
  const channelData = channelBases.map(base => traces[base as 'A' | 'T' | 'G' | 'C']);
  const specifications: Array<Omit<AbifFixtureEntry, 'dataOffset'>> = [
    {
      name: 'FWO_',
      number: 1,
      type: 2,
      elementSize: 1,
      elementCount: channelOrder.length,
      dataSize: channelOrder.length,
      data: channelOrder
    },
    {
      name: 'DATA',
      number: 9,
      type: 4,
      elementSize: 2,
      elementCount: samples,
      dataSize: samples * 2,
      data: channelData[0]
    },
    {
      name: 'DATA',
      number: 10,
      type: 4,
      elementSize: 2,
      elementCount: samples,
      dataSize: samples * 2,
      data: channelData[1]
    },
    {
      name: 'DATA',
      number: 11,
      type: 4,
      elementSize: 2,
      elementCount: samples,
      dataSize: samples * 2,
      data: channelData[2]
    },
    {
      name: 'DATA',
      number: 12,
      type: 4,
      elementSize: 2,
      elementCount: samples,
      dataSize: samples * 2,
      data: channelData[3]
    },
    {
      name: 'PBAS',
      number: 2,
      type: 2,
      elementSize: 1,
      elementCount: sequence.length,
      dataSize: sequence.length,
      data: sequence
    },
    {
      name: 'PLOC',
      number: 2,
      type: 3,
      elementSize: 2,
      elementCount: locations.length,
      dataSize: locations.length * 2,
      data: locations
    },
    {
      name: 'PCON',
      number: 2,
      type: 1,
      elementSize: 1,
      elementCount: qualities.length,
      dataSize: qualities.length,
      data: qualities
    }
  ];

  const directoryOffset = 128;
  let dataOffset = directoryOffset + specifications.length * 28;
  const entries: AbifFixtureEntry[] = specifications.map(specification => {
    const entry = { ...specification, dataOffset };
    dataOffset += specification.dataSize;
    return entry;
  });
  const buffer = new ArrayBuffer(dataOffset);
  const view = new DataView(buffer);
  const magic = 'ABIF';
  for (let index = 0; index < magic.length; index += 1) {
    view.setUint8(index, magic.charCodeAt(index));
  }
  view.setInt16(4, 101, false);
  view.setInt32(18, entries.length, false);
  view.setInt32(26, directoryOffset, false);

  entries.forEach((entry, index) => {
    const offset = directoryOffset + index * 28;
    for (let character = 0; character < 4; character += 1) {
      view.setUint8(offset + character, entry.name.charCodeAt(character));
    }
    view.setInt32(offset + 4, entry.number, false);
    view.setInt16(offset + 8, entry.type, false);
    view.setInt16(offset + 10, entry.elementSize, false);
    view.setInt32(offset + 12, entry.elementCount, false);
    view.setInt32(offset + 16, entry.dataSize, false);
    view.setInt32(offset + 20, entry.dataOffset, false);
    view.setInt32(offset + 24, 0, false);

    if (typeof entry.data === 'string') {
      for (let character = 0; character < entry.data.length; character += 1) {
        view.setUint8(entry.dataOffset + character, entry.data.charCodeAt(character));
      }
    } else if (entry.type === 4) {
      entry.data.forEach((value, valueIndex) => {
        view.setInt16(entry.dataOffset + valueIndex * 2, value, false);
      });
    } else if (entry.type === 3) {
      entry.data.forEach((value, valueIndex) => {
        view.setUint16(entry.dataOffset + valueIndex * 2, value, false);
      });
    } else {
      entry.data.forEach((value, valueIndex) => {
        view.setUint8(entry.dataOffset + valueIndex, value);
      });
    }
  });

  return buffer;
}

function forceInlineFwo(buffer: ArrayBuffer, order: string): void {
  const view = new DataView(buffer);
  const directoryOffset = view.getInt32(26, false);
  const directoryCount = view.getInt32(18, false);
  for (let index = 0; index < directoryCount; index += 1) {
    const offset = directoryOffset + index * 28;
    let name = '';
    for (let character = 0; character < 4; character += 1) {
      name += String.fromCharCode(view.getUint8(offset + character));
    }
    if (name !== 'FWO_') continue;
    view.setInt32(offset + 20, 0, false);
    for (let character = 0; character < Math.min(4, order.length); character += 1) {
      view.setUint8(offset + 20 + character, order.charCodeAt(character));
    }
  }
}

describe('Mott quality trimming', () => {
  it('trims low-quality tails at the default error threshold', () => {
    const qualities = [
      ...new Array<number>(5).fill(10),
      ...new Array<number>(30).fill(40),
      ...new Array<number>(5).fill(10)
    ];
    expect(mottTrim(qualities)).toEqual([5, 35]);
  });

  it('keeps a read when every base exceeds the quality threshold', () => {
    expect(mottTrim(new Array<number>(50).fill(40))).toEqual([0, 50]);
  });

  it('honors an explicit error threshold', () => {
    const qualities = [10, 10, 40, 40, 40, 40, 10, 10];
    expect(mottTrim(qualities, 0.5)[0]).toBeLessThanOrEqual(2);
    expect(mottTrim(qualities, 0.5)[1]).toBeGreaterThanOrEqual(6);
  });
});

describe('ABIF trace parsing', () => {
  it('decodes FWO order, four channels, base calls, peak locations and Phred scores', async () => {
    const sequence = 'ACGTACGT';
    const qualities = [5, 5, 40, 40, 40, 40, 5, 5];
    const buffer = buildAb1Fixture(sequence, qualities, 'GATC');
    const trace = await parseAb1Trace(buffer, 'sample.ab1');

    expect(trace.fileName).toBe('sample.ab1');
    expect(trace.calledSequence).toBe(sequence);
    expect(trace.qualityScores).toEqual(qualities);
    expect(trace.baseLocations).toHaveLength(sequence.length);
    expect(trace.baseLocations[0]).toBe(5);
    expect(trace.baseLocations[7]).toBe(75);
    expect(trace.traces.A).toHaveLength(90);
    expect(trace.traces.A[trace.baseLocations[0]]).toBeGreaterThan(900);
    expect(trace.trimRange).toEqual([2, 6]);
    expect(trace.id.length).toBeGreaterThan(0);
  });

  it('rejects a buffer without the ABIF signature', async () => {
    await expect(parseAb1Trace(new ArrayBuffer(200), 'broken.ab1')).rejects.toThrow(/ABIF/);
  });

  it('reads a four-byte FWO order stored inline in the directory entry', async () => {
    const sequence = 'ACGTACGT';
    const qualities = new Array<number>(sequence.length).fill(40);
    const buffer = buildAb1Fixture(sequence, qualities, 'ACGT');
    forceInlineFwo(buffer, 'ACGT');
    const trace = await parseAb1Trace(buffer, 'inline-fwo.ab1');
    expect(trace.traces.A[trace.baseLocations[0]]).toBeGreaterThan(900);
    expect(trace.traces.C[trace.baseLocations[1]]).toBeGreaterThan(900);
  });
});

describe('estimated trace qualities', () => {
  const samplePath = process.env.AB1_SAMPLE ?? '';
  const sampleAvailable = samplePath.length > 0 && existsSync(samplePath);

  it.skipIf(!sampleAvailable)(
    'assigns low quality to the noisy 3-prime tail of a real read',
    async () => {
      const file = readFileSync(samplePath);
      const buffer = file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength
      ) as ArrayBuffer;
      const trace = await parseAb1Trace(buffer, samplePath);

      expect(trace.calledSequence).toHaveLength(1345);
      expect(trace.qualityScores).toHaveLength(1345);

      const tail = trace.qualityScores.slice(-60);
      const tailMean = tail.reduce((sum, value) => sum + value, 0) / tail.length;
      expect(tailMean).toBeLessThan(20);

      const trimmedLength = trace.trimRange[1] - trace.trimRange[0];
      expect(trace.trimRange[0]).toBeGreaterThan(0);
      expect(trimmedLength).toBeLessThan(1345);
      expect(trimmedLength).toBeGreaterThan(600);
    }
  );

  it('scores ambiguous calls at most Q5', async () => {
    const sequence = 'ACGTNACGTN';
    const buffer = buildAb1Fixture(
      sequence,
      new Array<number>(sequence.length).fill(0)
    );
    const trace = await parseAb1Trace(buffer, 'ambiguous.ab1');

    expect(trace.calledSequence).toBe(sequence);
    for (let index = 0; index < sequence.length; index += 1) {
      if (sequence[index] === 'N') {
        expect(trace.qualityScores[index]).toBeLessThanOrEqual(5);
      }
    }
  });

  it('penalizes a near-equal secondary peak more than a weak one', async () => {
    const sequence = 'ACGTACGTAC';
    const buffer = buildAb1Fixture(
      sequence,
      new Array<number>(sequence.length).fill(0),
      'GATC',
      {
        peaks: [
          {},
          {},
          { amplitude: 1000, secondaryBase: 'A', secondaryAmplitude: 900 },
          {},
          {},
          {},
          { amplitude: 1000, secondaryBase: 'A', secondaryAmplitude: 100 },
          {},
          {},
          {}
        ]
      }
    );
    const trace = await parseAb1Trace(buffer, 'peak-ratio.ab1');

    const ambiguous = trace.qualityScores[2];
    const clean = trace.qualityScores[6];
    expect(ambiguous).toBeLessThanOrEqual(5);
    expect(clean).toBeGreaterThan(ambiguous + 20);
  });
});

describe('secondary peak detection', () => {
  it('finds a heterozygous peak and emits the IUPAC code', () => {
    const reference = randomDna(11, 260);
    const primary = reference[120];
    const secondary = (['A', 'T', 'G', 'C'] as const).find(base => base !== primary) ?? 'T';
    const trace = createSyntheticTrace(reference, {
      length: 260,
      heterozygous: [{ index: 120, base: secondary }]
    });

    expect(trace.trimRange).toEqual([0, 260]);
    const calls = detectSecondaryPeaks(trace);
    const call = calls.find(item => item.baseIndex === 120);
    expect(call).toBeDefined();
    expect(call?.primary).toBe(primary);
    expect(call?.secondary).toBe(secondary);
    expect(call?.ratio).toBeGreaterThanOrEqual(0.35);
    expect(call?.iupac).toMatch(/^[ACGTMRWSYK]$/);
  });
});

describe('Gotoh local alignment', () => {
  it('locates a query inside a longer reference', () => {
    const result = gotohLocalAlign('TTTTACGTACGTGGGG', 'ACGTACGT');
    expect(result.score).toBe(16);
    expect(result.refStart).toBe(4);
    expect(result.refEnd).toBe(12);
    expect(result.queryStart).toBe(0);
    expect(result.queryEnd).toBe(8);
    expect(result.alignedRef).toBe('ACGTACGT');
    expect(result.alignedQuery).toBe('ACGTACGT');
  });

  it('uses affine gaps for an insertion', () => {
    const result = gotohLocalAlign('ACGTACGT', 'ACGTTACGT');
    expect(result.score).toBeGreaterThanOrEqual(13);
    expect(result.alignedQuery).toContain('T');
    expect(result.alignedQuery.length).toBeGreaterThanOrEqual(result.alignedRef.length);
  });
});

describe('circular trace alignment', () => {
  it('maps a read that crosses the origin back into modulo space', async () => {
    const length = 2000;
    const sequence = randomDna(29, length);
    const doc = makeDoc(sequence, { topology: 'circular' });
    const trace = createSyntheticTrace(sequence, {
      start: length - 200,
      length: 400,
      fileName: 'origin-spanning.ab1'
    });

    const aligned = await alignTraceToPlasmid(trace, doc);
    expect(aligned.alignment).toBeDefined();
    expect(aligned.alignment?.refStart).toBe(length - 200);
    expect(aligned.alignment?.refEnd).toBe(200);
    expect(aligned.alignment?.refStart).toBeGreaterThan(aligned.alignment?.refEnd ?? 0);
    expect(aligned.alignment?.identityPercent).toBe(100);
    expect(aligned.alignment?.mismatches).toHaveLength(0);
  });

  it('surfaces heterozygous peaks as IUPAC mismatch records', async () => {
    const sequence = randomDna(41, 320);
    const primary = sequence[100];
    const secondary = (['A', 'T', 'G', 'C'] as const).find(base => base !== primary) ?? 'T';
    const doc = makeDoc(sequence);
    const trace = createSyntheticTrace(sequence, {
      length: sequence.length,
      heterozygous: [{ index: 100, base: secondary }]
    });
    const aligned = await alignTraceToPlasmid(trace, doc);
    const heterozygous = aligned.alignment?.mismatches.find(
      mismatch => mismatch.type === 'heterozygous_peak'
    );
    expect(heterozygous?.refIndex).toBe(100);
    expect(heterozygous?.queryBase).toBe(iupacForPair(primary, secondary));
  });

  it('uses the pure TypeScript path when WebAssembly is unavailable', async () => {
    const sequence = randomDna(53, 500);
    const doc = makeDoc(sequence);
    const trace = createSyntheticTrace(sequence, { length: 300 });
    const aligned = await alignTraceToPlasmid(trace, doc, { useWasm: true, kmer: 12 });
    expect(aligned.alignment?.identityPercent).toBe(100);
    expect(aligned.alignment?.refStart).toBe(0);
  });
});

describe('coding sequence impact annotation', () => {
  const sequence = 'GGGGATGGAATTCCAGTATTAACCCC';
  const feature = makeFeature({
    id: 'cds-egfp',
    name: 'TEST_CDS',
    start: 4,
    end: 22,
    strand: 1,
    codonStart: 1
  });

  async function impactFor(mutationIndex: number, base: string): Promise<string | undefined> {
    const doc = makeDoc(sequence, { features: [feature] });
    const trace = createSyntheticTrace(sequence, {
      length: sequence.length,
      mutations: [{ index: mutationIndex, base }]
    });
    const aligned = await alignTraceToPlasmid(trace, doc);
    const mismatch = aligned.alignment?.mismatches.find(item => item.type === 'substitution');
    return mismatch?.aminoAcidImpact;
  }

  it('reports a missense substitution', async () => {
    expect(await impactFor(8, 'T')).toBe('Missense (E2V in TEST_CDS)');
  });

  it('reports a nonsense substitution', async () => {
    expect(await impactFor(13, 'T')).toBe('Nonsense (Q4* Premature Stop)');
  });

  it('reports a silent substitution', async () => {
    expect(await impactFor(12, 'T')).toBe('Silent (F3F in TEST_CDS)');
  });

  it('annotates a mutation on the reverse strand using the biological reading frame', async () => {
    const biologicalCds = 'ATGGAATTCCAGTATTAA';
    const reverseSequence = `GGGG${reverseComplement(biologicalCds)}CCCC`;
    const reverseDoc = makeDoc(reverseSequence, {
      features: [
        makeFeature({
          id: 'cds-minus',
          name: 'MINUS_CDS',
          start: 4,
          end: 22,
          strand: -1,
          codonStart: 1
        })
      ]
    });
    const reverseTrace = createSyntheticTrace(reverseSequence, {
      length: reverseSequence.length,
      mutations: [{ index: 17, base: 'A' }]
    });
    const aligned = await alignTraceToPlasmid(reverseTrace, reverseDoc);
    const mismatch = aligned.alignment?.mismatches.find(item => item.type === 'substitution');
    expect(mismatch?.aminoAcidImpact).toBe('Missense (E2V in MINUS_CDS)');
  });

  it('annotates a mutation in a CDS that crosses the circular origin', async () => {
    const biologicalCds = 'ATGGAATTCCAGTATTAA';
    const circularSequence = `${biologicalCds.slice(6)}${'C'.repeat(42)}${biologicalCds.slice(0, 6)}`;
    const circularDoc = makeDoc(circularSequence, {
      topology: 'circular',
      features: [
        makeFeature({
          id: 'cds-origin',
          name: 'ORI_CDS',
          start: 54,
          end: 12,
          strand: 1,
          codonStart: 1
        })
      ]
    });
    const circularTrace = createSyntheticTrace(circularSequence, {
      length: circularSequence.length,
      mutations: [{ index: 58, base: 'T' }]
    });
    const aligned = await alignTraceToPlasmid(circularTrace, circularDoc);
    const mismatch = aligned.alignment?.mismatches.find(item => item.type === 'substitution');
    expect(mismatch?.aminoAcidImpact).toBe('Missense (E2V in ORI_CDS)');
  });

  it('reports a frameshift deletion inside a CDS', async () => {
    const cdsSequence = `ATG${'GAA'.repeat(10)}TAA`;    const fullSequence = `${cdsSequence}CCCC`;
    const doc = makeDoc(fullSequence, {
      features: [
        makeFeature({
          id: 'cds-ampr',
          name: 'AmpR',
          start: 0,
          end: cdsSequence.length,
          strand: 1,
          codonStart: 1
        })
      ]
    });
    const deletedSequence = fullSequence.slice(0, 10) + fullSequence.slice(11);
    const frameTrace: SangerTraceData = {
      id: 'frameshift',
      fileName: 'frameshift.ab1',
      calledSequence: deletedSequence,
      qualityScores: new Array<number>(deletedSequence.length).fill(40),
      baseLocations: new Array<number>(deletedSequence.length)
        .fill(0)
        .map((_, index) => index * 10 + 5),
      trimRange: [0, deletedSequence.length],
      traces: { A: [], T: [], G: [], C: [] }
    };

    const aligned = await alignTraceToPlasmid(frameTrace, doc);
    const deletion = aligned.alignment?.mismatches.find(item => item.type === 'deletion');
    expect(deletion).toBeDefined();
    expect(deletion?.aminoAcidImpact).toBe('Frameshift (-1 bp in AmpR)');
  });
});

describe('virtual agarose gel', () => {
  it('migrates smaller fragments farther than large fragments', () => {
    const small = computeMigration(1000, { agarosePercent: 1 });
    const large = computeMigration(8000, { agarosePercent: 1 });
    expect(small).toBeGreaterThan(large);
  });

  it('retards large fragments more at higher agarose concentration', () => {
    const lowConcentration = computeMigration(5000, { agarosePercent: 1 });
    const highConcentration = computeMigration(5000, { agarosePercent: 2 });
    expect(highConcentration).toBeLessThan(lowConcentration);
  });

  it('simulates supercoiled DNA migrating faster than linear DNA', () => {
    const params = { agarosePercent: 1, voltage: 5, minutes: 45 };
    const lanes = simulateVirtualGel(
      [
        { id: 'linear', label: 'Linear 3 kb', fragments: [{ sizeBp: 3000, conformation: 'linear' }] },
        {
          id: 'supercoiled',
          label: 'Supercoiled 3 kb',
          fragments: [{ sizeBp: 3000, conformation: 'supercoiled' }]
        },
        { id: 'nicked', label: 'Nicked 3 kb', fragments: [{ sizeBp: 3000, conformation: 'nicked' }] }
      ],
      params
    );
    const linear = lanes[0].bands[0];
    const supercoiled = lanes[1].bands[0];
    const nicked = lanes[2].bands[0];
    expect(supercoiled.apparentBp).toBeCloseTo(3000 * 0.68, 5);
    expect(nicked.apparentBp).toBeCloseTo(3000 * 1.35, 5);
    expect(supercoiled.migrationY).toBeGreaterThan(linear.migrationY);
    expect(nicked.migrationY).toBeLessThan(linear.migrationY);
  });

  it('builds all commercial ladders with highlighted reference bands', () => {
    const params = { agarosePercent: 1 };
    const lanes = simulateVirtualGel(
      (Object.keys(DNA_LADDERS) as Array<keyof typeof DNA_LADDERS>).map(name => ({
        label: name,
        ladder: name
      })),
      params
    );
    expect(lanes).toHaveLength(Object.keys(DNA_LADDERS).length);
    lanes.forEach((lane, index) => {
      const names = Object.keys(DNA_LADDERS);
      const definition = DNA_LADDERS[names[index] as keyof typeof DNA_LADDERS];
      expect(lane.isLadder).toBe(true);
      expect(lane.bands).toHaveLength(definition.length);
      expect(definition.some(band => band.highlighted)).toBe(true);
      for (const band of lane.bands) {
        expect(band.migrationY).toBeGreaterThanOrEqual(0);
        expect(band.migrationY).toBeLessThanOrEqual(1);
        expect(band.relativeIntensity).toBeGreaterThanOrEqual(0.1);
        expect(band.relativeIntensity).toBeLessThanOrEqual(1);
      }
    });
  });

  it('keeps fragment documents attached to their gel bands', () => {
    const fragmentDoc = makeDoc(randomDna(7, 1200), { name: 'Fragment' });
    const lanes = simulateVirtualGel(
      [
        {
          label: 'Digest',
          fragments: [{ sizeBp: 1200, massNg: 120, doc: fragmentDoc }]
        }
      ],
      { agarosePercent: 1 }
    );
    expect(lanes[0].bands[0].fragmentDoc?.name).toBe('Fragment');
  });
});

describe('expanded commercial DNA ladders', () => {
  const names = Object.keys(DNA_LADDERS) as Array<keyof typeof DNA_LADDERS>;

  it('offers at least 25 ladders and keeps the original five names', () => {
    expect(names.length).toBeGreaterThanOrEqual(25);
    for (const original of [
      'NEB 1kb Plus',
      'NEB 1kb',
      'NEB 100bp',
      'Takara DL2000',
      'Takara DL5000'
    ] as const) {
      expect(names).toContain(original);
    }
  });

  it('orders every ladder by fragment size and uses positive band masses', () => {
    for (const name of names) {
      const bands = DNA_LADDERS[name];
      expect(bands.length).toBeGreaterThan(0);
      expect(bands.some(band => band.highlighted)).toBe(true);
      expect(bands[0].sizeBp).toBeGreaterThan(0);
      for (let index = 0; index < bands.length; index += 1) {
        expect(bands[index].massNg).toBeGreaterThan(0);
        if (index > 0) {
          expect(bands[index].sizeBp).toBeGreaterThan(bands[index - 1].sizeBp);
        }
      }
    }
  });
});
