import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { PlasmidDocument, SangerTraceData, VirtualGelLane } from '../../types/schema';
import {
  CircularPlasmidMap,
  CloningHistoryTree,
  LinearPlasmidMap,
  LinearSequenceEditor,
  MapDisplayOptionsPanel,
  MultipleAlignmentViewer,
  ProteinSequenceView,
  SangerAlignmentViewer,
  SeqVizView,
  VirtualGelSimulator,
} from './index';
import type { ProteinDocument } from './index';

const document: PlasmidDocument = {
  id: 'p1',
  name: 'pUB-GFP',
  sequence:
    'ATGCGTACGTTAGCTAGCTAGGATCCGAATTCGCTAGCTAGCATCGATCGATCGTAGCTAGCTAGCTAGCATCGATCGTAGCTAGCTAGCATCGATCGTAGCTAGCTAGC',
  topology: 'circular',
  length: 120,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  features: [
    {
      id: 'cds1',
      name: 'EGFP',
      type: 'CDS',
      start: 0,
      end: 72,
      strand: 1,
      color: '#16a34a',
      codonStart: 1,
    },
    {
      id: 'prom1',
      name: 'CMV promoter',
      type: 'promoter',
      start: 100,
      end: 25,
      strand: 1,
      color: '#7c3aed',
    },
  ],
  primers: [
    {
      id: 'pr1',
      name: 'GFP-F',
      sequence: 'ATGCGTACGTTAGCTAGCTA',
      bindingStart: 0,
      bindingEnd: 20,
      strand: 1,
      tailSequence: 'GAATTC',
      tmAnnealing: 61.2,
      tmTotal: 64.8,
      gcPercent: 50,
      has3PrimeGCClamp: true,
      hairpinDeltaG: -1.2,
      selfDimerDeltaG: -3.4,
    },
  ],
  history: [
    {
      id: 'h1',
      operation: 'import',
      timestamp: '2026-01-01T10:00:00.000Z',
      description: 'Synthetic backbone',
    },
    {
      id: 'h2',
      operation: 'gibson_assembly',
      timestamp: '2026-01-02T10:00:00.000Z',
      description: 'EGFP inserted into the backbone',
      parentSnapshots: [{ id: 'h1', name: 'Backbone', length: 3000 }],
    },
  ],
};

const trace: SangerTraceData = {
  id: 't1',
  fileName: 'read-01.ab1',
  calledSequence: 'ATGCGTACGTTAGCTAGCTA',
  qualityScores: Array.from({ length: 20 }, (_, i) => (i === 7 ? 12 : 38)),
  baseLocations: Array.from({ length: 20 }, (_, i) => i * 12),
  trimRange: [1, 18],
  traces: {
    A: Array.from({ length: 240 }, (_, i) => Math.abs(Math.sin(i / 4)) * 100),
    T: Array.from({ length: 240 }, (_, i) => Math.abs(Math.cos(i / 5)) * 80),
    G: Array.from({ length: 240 }, (_, i) => Math.abs(Math.sin(i / 7)) * 60),
    C: Array.from({ length: 240 }, (_, i) => Math.abs(Math.cos(i / 3)) * 90),
  },
  alignment: {
    refStart: 0,
    refEnd: 20,
    strand: 1,
    identityPercent: 95,
    alignedRef: 'ATGCGTACGTTAGCTAGCTA',
    alignedQuery: 'ATGCGTACGTTCGCTAGCTA',
    mismatches: [
      {
        refIndex: 11,
        queryIndex: 11,
        type: 'substitution',
        refBase: 'A',
        queryBase: 'C',
        aminoAcidImpact: 'Missense (K4Q)',
      },
    ],
  },
};

const lanes: VirtualGelLane[] = [
  {
    id: 'ladder',
    label: '1 kb ladder',
    isLadder: true,
    bands: [
      { sizeBp: 1000, conformation: 'linear', apparentBp: 1000, migrationY: 0.35, relativeIntensity: 0.7 },
      { sizeBp: 500, conformation: 'linear', apparentBp: 500, migrationY: 0.6, relativeIntensity: 0.7 },
    ],
  },
  {
    id: 'digest',
    label: 'EcoRI digest',
    bands: [
      { sizeBp: 3200, conformation: 'linear', apparentBp: 3200, migrationY: 0.12, relativeIntensity: 1 },
      { sizeBp: 1200, conformation: 'linear', apparentBp: 1200, migrationY: 0.42, relativeIntensity: 0.5 },
    ],
  },
];

describe('canvas-ui render smoke tests', () => {
  it('renders the circular map and both export helpers exist', () => {
    const html = renderToString(
      <CircularPlasmidMap
        doc={document}
        cutSites={[
          {
            id: 'cut1',
            enzyme: {
              name: 'EcoRI',
              recognitionSeq: 'GAATTC',
              cutIndexTop: 1,
              cutIndexBottom: 5,
            },
            position: 27,
            strand: 1,
            cutPositionTop: 28,
            cutPositionBottom: 32,
            overhangType: '5-prime',
            overhangSeq: 'AATT',
            isMethylationBlocked: false,
            totalCutsInPlasmid: 1,
          },
        ]}
        selection={{ start: 10, end: 30 }}
        theme="publication"
      />,
    );
    expect(html).toContain('pUB-GFP');
    expect(html).toContain('EcoRI');
    expect(html).toContain('SVG');
  });

  it('renders the virtualized linear editor', () => {
    const html = renderToString(
      <LinearSequenceEditor
        doc={document}
        cutSites={[]}
        selection={{ start: 4, end: 16 }}
        bpPerRow={60}
        translationMode="frame6"
        height={500}
      />,
    );
    expect(html).toContain('每行');
    expect(html).toContain('EGFP');
  });

  it('renders the Sanger viewer', () => {
    const html = renderToString(
      <SangerAlignmentViewer doc={document} traces={[trace]} height={560} />,
    );
    expect(html).toContain('read-01.ab1');
    expect(html).toContain('Missense');
  });

  it('renders the gel simulator', () => {
    const html = renderToString(
      <VirtualGelSimulator
        lanes={lanes}
        agarosePercent={1.2}
        voltage={110}
        minutes={40}
        mode="publication"
      />,
    );
    expect(html).toContain('Virtual agarose gel');
    expect(html).toContain('EcoRI digest');
  });

  it('renders the cloning history DAG', () => {
    const html = renderToString(
      <CloningHistoryTree history={document.history} selectedId="h2" />,
    );
    expect(html).toContain('Cloning lineage');
    expect(html).toContain('Gibson assembly');
  });

  it('renders the SeqViz wrapper', () => {
    const html = renderToString(
      <SeqVizView doc={document} cutSites={[]} selection={{ start: 2, end: 8 }} />,
    );
    expect(html).toContain('osg-seqviz-root');
    expect(html).toContain('la-vz-seqviz');
  });

  it('renders the multiple alignment viewer with names and consensus', () => {
    const html = renderToString(
      <MultipleAlignmentViewer
        rows={[
          { id: 'ref', name: 'Reference clone', aligned: 'ATGCGTACGT' },
          { id: 'var', name: 'Variant 2', aligned: 'ATGCGTTCGT' },
        ]}
        consensus="ATGCGTACGT"
        conservation={[1, 1, 1, 1, 1, 0.9, 1, 0.2, 1, 1]}
        height={420}
        colorScheme="nucleotide"
      />,
    );
    expect(html).toContain('Reference clone');
    expect(html).toContain('Variant 2');
    expect(html).toContain('CONSENSUS');
    expect(html).toContain('Consensus ATGCGTACGT');
  });

  it('collapses bases identical to the reference row to dots', () => {
    const html = renderToString(
      <MultipleAlignmentViewer
        rows={[
          { id: 'ref', name: 'Reference clone', aligned: 'ATGCGTACGT' },
          { id: 'var', name: 'Variant', aligned: 'ATGCGTTCGT' },
        ]}
        consensus="ATGCGTACGT"
        conservation={[1, 1, 1, 1, 1, 0.9, 1, 0.2, 1, 1]}
        height={420}
        referenceRowId="ref"
      />,
    );
    expect(html).toContain('>.</text>');
    expect(html).toContain('REF');
  });

  it('virtualizes a 50 x 1000 alignment in both directions', () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      id: `row-${index}`,
      name: `Clone ${index + 1}`,
      aligned: 'ACGT'.repeat(250),
    }));
    const html = renderToString(
      <MultipleAlignmentViewer
        rows={rows}
        consensus={'ACGT'.repeat(250)}
        conservation={Array.from({ length: 1000 }, () => 0.85)}
        height={480}
      />,
    );
    expect(html).toContain('Clone 1');
    expect(html).not.toContain('Clone 50');
    expect(html).not.toContain('>921<');
    const renderedRows = (html.match(/aligned sequence/g) ?? []).length;
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThan(30);
    expect(html).toContain('Consensus ACGT');
  });

  it('renders a linear map with origin-crossing, spliced and reverse features', () => {
    const splicedDoc: PlasmidDocument = {
      ...document,
      features: [
        ...document.features,
        {
          id: 'spliced1',
          name: 'SplicedGene',
          type: 'CDS',
          start: 10,
          end: 40,
          strand: 1,
          color: '#0d9488',
          notes: { segments: ['10-20', '30-40'] },
        },
        {
          id: 'rev1',
          name: 'ReverseGene',
          type: 'misc_feature',
          start: 60,
          end: 90,
          strand: -1,
          color: '#db2777',
        },
      ],
    };
    const html = renderToString(
      <LinearPlasmidMap
        doc={splicedDoc}
        cutSites={[
          {
            id: 'cut1',
            enzyme: {
              name: 'EcoRI',
              recognitionSeq: 'GAATTC',
              cutIndexTop: 1,
              cutIndexBottom: 5,
            },
            position: 27,
            strand: 1,
            cutPositionTop: 28,
            cutPositionBottom: 32,
            overhangType: '5-prime',
            overhangSeq: 'AATT',
            isMethylationBlocked: false,
            totalCutsInPlasmid: 1,
          },
        ]}
        selection={{ start: 105, end: 10 }}
        onSelectionChange={() => undefined}
        width={900}
      />,
    );
    expect(html).toContain('SplicedGene');
    expect(html).toContain('ReverseGene');
    expect(html).toContain('CMV promoter');
    expect(html).toContain('EcoRI');
    expect(html).toContain('<svg');
    expect(html).toContain('selected');
    expect(html).not.toContain('NaN');
  });

  it('hides feature types selected in displayOptions', () => {
    const hiddenDoc: PlasmidDocument = {
      ...document,
      features: [
        {
          id: 'hidden1',
          name: 'HiddenPromoterXYZ',
          type: 'promoter',
          start: 10,
          end: 90,
          strand: 1,
          color: '#7c3aed',
        },
        {
          id: 'visible1',
          name: 'VisibleCdsXYZ',
          type: 'CDS',
          start: 0,
          end: 60,
          strand: 1,
          color: '#16a34a',
        },
      ],
    };
    const hidden = renderToString(
      <LinearPlasmidMap
        doc={hiddenDoc}
        cutSites={[]}
        selection={null}
        onSelectionChange={() => undefined}
        displayOptions={{ hiddenFeatureTypes: ['promoter'] }}
        width={900}
      />,
    );
    expect(hidden).toContain('VisibleCdsXYZ');
    expect(hidden).not.toContain('HiddenPromoterXYZ');

    const visible = renderToString(
      <LinearPlasmidMap
        doc={hiddenDoc}
        cutSites={[]}
        selection={null}
        onSelectionChange={() => undefined}
        width={900}
      />,
    );
    expect(visible).toContain('HiddenPromoterXYZ');

    const circularHidden = renderToString(
      <CircularPlasmidMap
        doc={{ ...hiddenDoc, features: hiddenDoc.features.map((f) => ({ ...f, start: 0, end: 90 })) }}
        cutSites={[]}
        selection={null}
        displayOptions={{ hiddenFeatureTypes: ['promoter'] }}
      />,
    );
    expect(circularHidden).not.toContain('HiddenPromoterXYZ');
  });

  it('renders the display options panel', () => {
    const html = renderToString(
      <MapDisplayOptionsPanel
        value={{ showGcPlot: true, labelFontSize: 12 }}
        onChange={() => undefined}
        featureTypes={['CDS', 'promoter', 'terminator']}
      />,
    );
    expect(html).toContain('Map display');
    expect(html).toContain('GC plot');
    expect(html).toContain('terminator');
  });

  it('renders the protein viewer with metrics and virtualized residues', () => {
    const protein: ProteinDocument = {
      id: 'prot1',
      name: 'EGFP protein',
      sequence: 'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTL',
      description: 'Fluorescent protein',
      features: [
        {
          id: 'dom1',
          name: 'Chromophore',
          type: 'domain',
          start: 60,
          end: 70,
          color: '#16a34a',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const html = renderToString(
      <ProteinSequenceView protein={protein} selection={{ start: 2, end: 8 }} height={320} />,
    );
    expect(html).toContain('EGFP protein');
    expect(html).toContain('kDa');
    expect(html).toContain('pI');
    expect(html).toContain('M');
    expect(html).toContain('Hydrophobic');
  });

  it('draws Sanger coverage on request', () => {
    const html = renderToString(
      <SangerAlignmentViewer
        doc={document}
        traces={[trace, { ...trace, id: 't2', fileName: 'read-02.ab1' }]}
        height={560}
        showCoverage
      />,
    );
    expect(html).toContain('COVERAGE');
    expect(html).toContain('mismatch');
  });

  it('renders spliced features in the linear sequence editor', () => {
    const splicedDoc: PlasmidDocument = {
      ...document,
      features: [
        {
          id: 'spliced1',
          name: 'SplicedGene',
          type: 'CDS',
          start: 10,
          end: 40,
          strand: 1,
          color: '#0d9488',
          notes: { segments: ['10-20', '30-40'] },
        },
      ],
    };
    const html = renderToString(
      <LinearSequenceEditor
        doc={splicedDoc}
        cutSites={[]}
        selection={null}
        bpPerRow={60}
        translationMode="cds"
        height={420}
      />,
    );
    expect(html).toContain('SplicedGene');
    expect(html).toContain('intron');
  });
});
