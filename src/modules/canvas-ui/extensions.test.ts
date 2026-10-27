import { describe, expect, it } from 'vitest';
import type { PlasmidDocument, SangerTraceData, SequenceFeature } from '../../types/schema';
import {
  assignSegmentTracks,
  buildFeatureSegmentPlan,
  parseSegmentsNote,
  segmentGapRanges,
} from './segments';
import {
  DEFAULT_MAP_DISPLAY_OPTIONS,
  filterVisibleFeatures,
  resolveMapDisplayOptions,
} from './mapDisplayOptions';
import {
  buildCutMarkerItems,
  computeGcProfile,
  computeLinearMapLayout,
  layoutLinearLabels,
  layoutOrfTracks,
  layoutRulerTicks,
} from './layout/linearMapLayout';
import {
  computeSangerCoverage,
  coverageRuns,
  expandIupacBase,
} from './layout/coverage';
import {
  classifyResidue,
  proteinFeatureSpans,
  proteinIsoelectricPoint,
  proteinMolecularWeight,
  proteinMolecularWeightKda,
  proteinRowCount,
  virtualProteinRowRange,
} from './layout/proteinLayout';
import {
  buildFeaturePrintRows,
  buildPrintDocument,
  buildSequencePrintHtml,
  buildSequencePrintLines,
  buildSvgPrintHtml,
  escapeHtml,
} from './printHtml';
import { buildCdsCodons, buildFeatureGapRowMap, buildFeatureRowMap } from './layout/linearLayout';

function feature(
  id: string,
  start: number,
  end: number,
  strand: 1 | -1 | 0 = 1,
  notes?: Record<string, string[]>,
): SequenceFeature {
  return {
    id,
    name: id,
    type: 'misc_feature',
    start,
    end,
    strand,
    color: '#0284c7',
    notes,
  };
}

function doc(partial: Partial<PlasmidDocument>): PlasmidDocument {
  const sequence = partial.sequence ?? '';
  return {
    id: 'doc',
    name: 'Test plasmid',
    sequence,
    topology: 'circular',
    length: partial.length ?? sequence.length,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    features: [],
    primers: [],
    history: [],
    ...partial,
  };
}

describe('multi-segment feature plans', () => {
  it('parses segment notes and rejects malformed entries', () => {
    expect(parseSegmentsNote({ segments: ['10-20', '30-40'] })).toEqual([
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ]);
    expect(parseSegmentsNote({ segments: ['bogus', '30-30'] })).toBeNull();
    expect(parseSegmentsNote(undefined)).toBeNull();
    expect(parseSegmentsNote({ segments: ['  5 - 9 '] })).toEqual([{ start: 5, end: 9 }]);
  });

  it('places the arrow on the last biological segment', () => {
    const forward = buildFeatureSegmentPlan(
      feature('f', 10, 40, 1, { segments: ['10-20', '30-40'] }),
      100,
      true,
    );
    expect(forward.multi).toBe(true);
    expect(forward.pieces).toHaveLength(2);
    expect(forward.arrowIndex).toBe(40);
    expect(forward.arrowDirection).toBe(1);

    const reverse = buildFeatureSegmentPlan(
      feature('r', 20, 50, -1, { segments: ['40-50', '20-30'] }),
      100,
      true,
    );
    expect(reverse.arrowIndex).toBe(20);
    expect(reverse.arrowDirection).toBe(-1);
    expect(segmentGapRanges(reverse, 100, true)).toEqual([{ start: 30, end: 40 }]);
  });

  it('splits a wrapped segment across the origin', () => {
    const plan = buildFeatureSegmentPlan(
      feature('wrap', 90, 30, 1, { segments: ['90-10', '20-30'] }),
      100,
      true,
    );
    expect(plan.pieces.map((piece) => [piece.start, piece.end])).toEqual([
      [90, 100],
      [0, 10],
      [20, 30],
    ]);
    expect(plan.arrowIndex).toBe(30);
  });

  it('does not let an intron occupy a track', () => {
    const assignment = assignSegmentTracks(
      [
        feature('spliced', 0, 100, 1, { segments: ['0-10', '90-100'] }),
        feature('middle', 40, 50),
      ],
      1000,
      true,
    );
    expect(assignment.lanes).toHaveLength(1);
    expect(assignment.lanes[0].map((entry) => entry.feature.id).sort()).toEqual([
      'middle',
      'spliced',
    ]);
    const plan = assignment.plans.get('spliced');
    expect(plan).toBeDefined();
    expect(segmentGapRanges(plan!, 1000, true)).toEqual([{ start: 10, end: 90 }]);
  });

  it('builds intron rows and clipped feature rows', () => {
    const spliced = feature('spliced', 0, 100, 1, { segments: ['0-10', '90-100'] });
    const rows = buildFeatureRowMap([spliced], 50, 1000, true);
    expect(rows.get(0)?.[0].isTrueEnd).toBe(false);
    expect(rows.get(1)?.[0].isTrueEnd).toBe(true);
    const gaps = buildFeatureGapRowMap([spliced], 50, 1000, true);
    expect(gaps.get(0)?.[0].gap).toEqual({ start: 10, end: 50 });
    expect(gaps.get(1)?.[0].gap).toEqual({ start: 50, end: 90 });
  });

  it('translates the spliced CDS across segment junctions', () => {
    const sequence = 'ATGAAATAG' + 'C'.repeat(10) + 'ATGAAATAG';
    const spliced = feature('cds', 0, 28, 1, {
      segments: ['0-9', '19-28'],
    });
    const codons = buildCdsCodons(sequence, { ...spliced, type: 'CDS' }, 28, true);
    expect(codons.map((codon) => codon.aa)).toEqual(['M', 'K', '*', 'M', 'K', '*']);
  });
});

describe('map display options', () => {
  it('fills defaults and clamps editor values', () => {
    expect(resolveMapDisplayOptions()).toEqual(DEFAULT_MAP_DISPLAY_OPTIONS);
    const clamped = resolveMapDisplayOptions({ labelFontSize: 2, tickInterval: -4 });
    expect(clamped.labelFontSize).toBe(7);
    expect(clamped.tickInterval).toBe('auto');
    expect(resolveMapDisplayOptions({ labelFontSize: 999 }).labelFontSize).toBe(20);
    expect(resolveMapDisplayOptions({ tickInterval: 250 }).tickInterval).toBe(250);
  });

  it('filters hidden feature types', () => {
    const options = resolveMapDisplayOptions({ hiddenFeatureTypes: ['CDS'] });
    const features = [
      feature('a', 0, 10),
      { ...feature('b', 20, 30), type: 'CDS' as const },
    ];
    expect(filterVisibleFeatures(features, options).map((entry) => entry.id)).toEqual(['a']);
    expect(filterVisibleFeatures(features, resolveMapDisplayOptions())).toHaveLength(2);
  });
});

describe('linear map layout', () => {
  it('samples a bounded sliding-window GC profile', () => {
    const samples = computeGcProfile('GGCCAAAATT'.repeat(100), {
      windowSize: 50,
      maxSamples: 40,
      circular: true,
    });
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.length).toBeLessThanOrEqual(41);
    for (const sample of samples) {
      expect(sample.position).toBeGreaterThanOrEqual(0);
      if (sample.gc !== null) {
        expect(sample.gc).toBeGreaterThanOrEqual(0);
        expect(sample.gc).toBeLessThanOrEqual(1);
      }
    }
    expect(computeGcProfile('')).toEqual([]);
  });

  it('places ruler ticks with labelled majors and minor subdivisions', () => {
    const ticks = layoutRulerTicks(1000, 'auto', 10);
    expect(ticks[0]).toMatchObject({ position: 0, major: true, label: '1' });
    expect(ticks.filter((tick) => tick.major).every((tick) => tick.label !== '')).toBe(true);
    for (const tick of ticks) {
      expect(tick.fraction).toBeGreaterThanOrEqual(0);
      expect(tick.fraction).toBeLessThan(1);
    }
    const fixed = layoutRulerTicks(500, 100);
    expect(fixed.filter((tick) => tick.major).map((tick) => tick.position)).toEqual([
      0, 100, 200, 300, 400,
    ]);
  });

  it('packs enzyme labels into collision-free rows', () => {
    const items = Array.from({ length: 14 }, (_, index) => ({
      id: `cut-${index}`,
      position: 100 + index * 3,
      text: `EcoRI (${index})`,
    }));
    const layout = layoutLinearLabels(items, {
      length: 1000,
      plotWidth: 400,
      fontSize: 11,
      gap: 6,
      maxRows: 5,
    });
    expect(layout.rowCount).toBeGreaterThan(1);
    for (let row = 0; row < layout.rowCount; row += 1) {
      const rowItems = layout.placements
        .filter((placement) => placement.row === row)
        .sort((a, b) => a.x - b.x);
      for (let index = 1; index < rowItems.length; index += 1) {
        const previous = rowItems[index - 1];
        expect(rowItems[index].x - rowItems[index].width / 2).toBeGreaterThanOrEqual(
          previous.x + previous.width / 2,
        );
      }
    }
    expect(layout.placements.length + layout.hidden.length).toBe(items.length);
  });

  it('groups co-located cut sites and stacks overlapping ORFs', () => {
    const cut = (id: string, name: string) => ({
      id,
      enzyme: { name, recognitionSeq: 'GAATTC', cutIndexTop: 1, cutIndexBottom: 5 },
      position: 10,
      strand: 1 as const,
      cutPositionTop: 11,
      cutPositionBottom: 15,
      overhangType: '5-prime' as const,
      overhangSeq: 'AATT',
      isMethylationBlocked: false,
      totalCutsInPlasmid: 1,
    });
    const markers = buildCutMarkerItems([cut('a', 'EcoRI'), cut('b', 'MfeI')]);
    expect(markers).toHaveLength(1);
    expect(markers[0].names).toEqual(['EcoRI', 'MfeI']);

    const orfs = [
      { id: 'o1', start: 0, end: 300, strand: 1 as const, frame: 1 as const, lengthBp: 300, aminoAcids: '', mwKda: 10, pI: 6 },
      { id: 'o2', start: 100, end: 400, strand: 1 as const, frame: 1 as const, lengthBp: 300, aminoAcids: '', mwKda: 10, pI: 6 },
      { id: 'o3', start: 600, end: 700, strand: -1 as const, frame: -1 as const, lengthBp: 100, aminoAcids: '', mwKda: 4, pI: 7 },
    ];
    const layout = layoutOrfTracks(orfs, 1000, false);
    expect(layout.trackCount).toBe(2);
    expect(layout.entries.find((entry) => entry.orf.id === 'o1')?.track).toBe(0);
    expect(layout.entries.find((entry) => entry.orf.id === 'o2')?.track).toBe(1);
  });

  it('grows the canvas with tracks, ORFs and the GC plot', () => {
    const base = computeLinearMapLayout({
      width: 900,
      plusTracks: 1,
      minusTracks: 0,
      orfTracks: 0,
      labelRows: 0,
      showPrimers: false,
      showGcPlot: false,
      hasTitle: true,
      labelFontSize: 11,
    });
    const dense = computeLinearMapLayout({
      width: 900,
      plusTracks: 2,
      minusTracks: 2,
      orfTracks: 2,
      labelRows: 2,
      showPrimers: true,
      showGcPlot: true,
      hasTitle: true,
      labelFontSize: 14,
    });
    expect(dense.height).toBeGreaterThan(base.height);
    expect(dense.plotWidth).toBe(840);
    expect(dense.featureBottom).toBeGreaterThan(dense.minusBottom);
  });
});

describe('Sanger coverage', () => {
  const reference = 'ACGTACGTACGTAC';

  function trace(id: string, query: string): SangerTraceData {
    return {
      id,
      fileName: `${id}.ab1`,
      calledSequence: query,
      qualityScores: Array.from({ length: query.length }, () => 38),
      baseLocations: Array.from({ length: query.length }, (_, index) => index * 8),
      trimRange: [0, query.length - 1],
      traces: { A: [], T: [], G: [], C: [] },
      alignment: {
        refStart: 0,
        refEnd: query.length,
        strand: 1,
        identityPercent: 98,
        alignedRef: reference.slice(0, query.length),
        alignedQuery: query,
        mismatches: [],
      },
    };
  }

  it('classifies match, mismatch, heterozygosity and uncovered positions', () => {
    const coverage = computeSangerCoverage(
      [trace('t1', 'ACGTTCGTTCGT'), trace('t2', 'ACGTTCGTCCGT')],
      0,
      14,
      reference,
    );
    expect(coverage.depth[0]).toBe(2);
    expect(coverage.status[0]).toBe('match');
    expect(coverage.status[4]).toBe('mismatch');
    expect(coverage.status[8]).toBe('heterozygous');
    expect(coverage.status[13]).toBe('uncovered');
    expect(coverage.maxDepth).toBe(2);
    expect(coverage.coveredBases).toBe(12);
    expect(coverage.mismatchBases).toBe(1);
    expect(coverage.heterozygousBases).toBe(1);
    expect(coverage.uncoveredBases).toBe(2);
    expect(coverage.meanDepth).toBeCloseTo(24 / 14, 5);

    const runs = coverageRuns(coverage);
    expect(runs.reduce((sum, run) => sum + (run.endOffset - run.startOffset), 0)).toBe(14);
    expect(runs.some((run) => run.status === 'uncovered')).toBe(true);
  });

  it('expands IUPAC codes for comparison', () => {
    expect(expandIupacBase('R').sort()).toEqual(['A', 'G']);
    expect(expandIupacBase('N').sort()).toEqual(['A', 'C', 'G', 'T']);
    expect(expandIupacBase('?')).toEqual([]);
  });

  it('counts deletions as covered mismatches and ignores insertions', () => {
    const deletion: SangerTraceData = {
      ...trace('del', ''),
      alignment: {
        refStart: 0,
        refEnd: 4,
        strand: 1,
        identityPercent: 75,
        alignedRef: 'ACGT',
        alignedQuery: 'A-GT',
        mismatches: [],
      },
    };
    const coverage = computeSangerCoverage([deletion], 0, 4, reference);
    expect(coverage.depth).toEqual([1, 1, 1, 1]);
    expect(coverage.status[1]).toBe('mismatch');
  });
});

describe('print HTML generation', () => {
  it('formats numbered double-stranded sequence lines', () => {
    const lines = buildSequencePrintLines('ATGC', 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      start: 0,
      end: 4,
      plus: 'ATGC',
      minus: 'TACG',
      label: '1',
      endLabel: '4',
    });
    const wrapped = buildSequencePrintLines('A'.repeat(130), 60);
    expect(wrapped.map((line) => line.label)).toEqual(['1', '61', '121']);
    expect(wrapped.map((line) => line.endLabel)).toEqual(['60', '120', '130']);
    expect(wrapped[0].plus.match(/ /g) ?? []).toHaveLength(5);
  });

  it('escapes user text and emits print CSS', () => {
    expect(escapeHtml('<b>&"</b>')).toBe('&lt;b&gt;&amp;&quot;&lt;/b&gt;');
    const html = buildPrintDocument('<p>body</p>', { title: '<Figure>', landscape: true });
    expect(html).toContain('@page { size: A4 landscape;');
    expect(html).toContain('&lt;Figure&gt;');
    expect(html).toContain('<p>body</p>');
  });

  it('wraps serialised SVG markup with a heading', () => {
    const html = buildSvgPrintHtml('<svg><rect /></svg>', { title: 'Map figure' });
    expect(html).toContain('<h1>Map figure</h1>');
    expect(html).toContain('<svg><rect /></svg>');
    expect(html).toContain('class="figure"');
  });

  it('prints sequence and features with segment annotations', () => {
    const document = doc({
      sequence: 'ATGC'.repeat(20),
      length: 80,
      features: [
        {
          ...feature('spliced', 0, 60, 1, { segments: ['0-20', '40-60'] }),
          name: 'Spliced <CDS>',
          type: 'CDS',
        },
      ],
    });
    const html = buildSequencePrintHtml(document, { bpPerLine: 30 });
    expect(html).toContain('80 bp');
    expect(html).toContain('Spliced &lt;CDS&gt;');
    expect(html).toContain('0-20, 40-60');
    expect(html).toContain('TACG');
    const withoutFeatures = buildSequencePrintHtml(document, {
      bpPerLine: 30,
      showFeatures: false,
    });
    expect(withoutFeatures).not.toContain('class="features"');
    const rows = buildFeaturePrintRows(document);
    expect(rows[0]).toMatchObject({
      location: '1..60',
      strand: '+',
      length: 60,
      segments: '0-20, 40-60',
    });
    const wrapped = buildFeaturePrintRows(
      doc({
        sequence: 'A'.repeat(100),
        length: 100,
        features: [feature('wrap', 90, 20)],
      }),
    );
    expect(wrapped[0].length).toBe(30);
  });
});

describe('protein calculations', () => {
  it('computes molecular weight in daltons and kDa', () => {
    expect(proteinMolecularWeight('MK')).toBeCloseTo(241.35142, 4);
    expect(proteinMolecularWeightKda('MK')).toBeCloseTo(0.24135142, 6);
    expect(proteinMolecularWeight('')).toBe(0);
  });

  it('computes isoelectric points from residue charge', () => {
    const basic = proteinIsoelectricPoint('KKKK');
    const acidic = proteinIsoelectricPoint('DDDD');
    expect(basic).toBeGreaterThan(9);
    expect(acidic).toBeLessThan(5);
    expect(proteinIsoelectricPoint('')).toBe(7);
    expect(proteinIsoelectricPoint('ACDEFGHIKLMNPQRSTVWY')).toBeGreaterThan(4);
  });

  it('classifies residues and clips feature spans per row', () => {
    expect(classifyResidue('A')).toBe('hydrophobic');
    expect(classifyResidue('K')).toBe('charged');
    expect(classifyResidue('S')).toBe('polar');
    expect(classifyResidue('X')).toBe('special');
    const spans = proteinFeatureSpans(
      { id: 'f', name: 'domain', type: 'domain', start: 7, end: 58, color: '#000' },
      50,
      100,
    );
    expect(spans).toEqual([
      { rowIndex: 0, startColumn: 7, endColumn: 50 },
      { rowIndex: 1, startColumn: 0, endColumn: 8 },
    ]);
  });

  it('calculates row counts and a virtual window', () => {
    expect(proteinRowCount(0, 50)).toBe(0);
    expect(proteinRowCount(101, 50)).toBe(3);
    expect(virtualProteinRowRange(100, 200, 30, 100, 2)).toEqual({
      start: 1,
      end: 12,
    });
    expect(virtualProteinRowRange(0, 100, 30, 0, 2)).toEqual({ start: 0, end: -1 });
  });
});
