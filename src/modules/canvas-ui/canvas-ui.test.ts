// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type {
  CloningHistoryNode,
  CutSite,
  PlasmidDocument,
  SequenceFeature,
} from '../../types/schema';
import {
  assignFeatureTracks,
  featureSegments,
  layoutLeaderLabels,
  splitRange,
} from './utils';
import { computeCircularGeometry, groupCutSites } from './layout/circularLayout';
import {
  buildCdsCodons,
  buildFeatureRowMap,
  buildTranslationCodons,
  reverseComplement,
  translateCodon,
} from './layout/linearLayout';
import {
  buildSangerWindow,
  mapAlignedQueryToReference,
} from './layout/sangerLayout';
import {
  effectiveMigrationY,
  migrationMultiplier,
} from './layout/gelLayout';
import {
  layoutHistoryTree,
  relatedNodeIds,
  wrapText,
} from './layout/historyLayout';

function feature(
  id: string,
  start: number,
  end: number,
  strand: 1 | -1 | 0 = 1,
  type: SequenceFeature['type'] = 'misc_feature',
): SequenceFeature {
  return {
    id,
    name: id,
    type,
    start,
    end,
    strand,
    color: '#0284c7',
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

describe('range utilities', () => {
  it('splits an origin-spanning range', () => {
    expect(splitRange(900, 100, 1000, true)).toEqual([
      { start: 900, end: 1000 },
      { start: 0, end: 100 },
    ]);
  });

  it('treats an explicit full-circle range as the whole sequence', () => {
    expect(splitRange(0, 1000, 1000, true)).toEqual([{ start: 0, end: 1000 }]);
    expect(splitRange(120, 120, 1000, true)).toEqual([]);
  });

  it('splits wrapped feature coordinates', () => {
    expect(featureSegments(feature('wrap', 950, 50), 1000, true)).toEqual([
      { start: 950, end: 1000 },
      { start: 0, end: 50 },
    ]);
  });
});

describe('circular interval track assignment', () => {
  it('keeps overlapping features in separate concentric lanes', () => {
    const features = [
      feature('a', 100, 300),
      feature('b', 200, 400),
      feature('c', 500, 600),
      feature('d', 950, 50),
    ];
    const assignment = assignFeatureTracks(features, 1000, true);
    expect(assignment.lanes.length).toBe(2);
    expect(assignment.laneById.get('a')).toBe(0);
    expect(assignment.laneById.get('b')).toBe(1);
    expect(assignment.laneById.get('c')).toBe(0);
    expect(assignment.laneById.get('d')).toBe(0);

    for (const lane of assignment.lanes) {
      for (let i = 0; i < lane.length; i += 1) {
        for (let j = i + 1; j < lane.length; j += 1) {
          const left = featureSegments(lane[i], 1000, true);
          const right = featureSegments(lane[j], 1000, true);
          for (const a of left) {
            for (const b of right) {
              expect(a.start < b.end && b.start < a.end).toBe(false);
            }
          }
        }
      }
    }
  });

  it('detects overlap across the origin', () => {
    const assignment = assignFeatureTracks(
      [feature('wrap', 900, 100), feature('cross', 50, 150)],
      1000,
      true,
    );
    expect(assignment.lanes.length).toBe(2);
  });

  it('drops overflow labels rather than allowing text collisions', () => {
    const items = Array.from({ length: 120 }, (_, i) => ({
      id: `dense-${i}`,
      anchorIndex: (i * 7) % 300,
      text: `Site ${i}`,
    }));
    const labels = layoutLeaderLabels(items, {
      cx: 300,
      cy: 300,
      radius: 210,
      length: 300,
      minY: 12,
      maxY: 588,
      gap: 14,
    });
    expect(labels.length).toBeLessThan(items.length);
    for (const side of ['left', 'right'] as const) {
      const sideLabels = labels.filter((label) => label.side === side).sort((a, b) => a.textY - b.textY);
      for (let i = 1; i < sideLabels.length; i += 1) {
        expect(sideLabels[i].textY - sideLabels[i - 1].textY).toBeGreaterThanOrEqual(13.99);
      }
    }
  });

  it('keeps geometry valid for densely packed feature lanes', () => {
    const geometry = computeCircularGeometry(760, 200);
    expect(geometry.featureInner).toBeGreaterThan(0);
    expect(geometry.primerRadius).toBeGreaterThan(0);
    expect(geometry.bandHeight).toBeGreaterThan(0);
  });

  it('groups co-located cut sites', () => {
    const cut = (id: string, name: string): CutSite => ({
      id,
      enzyme: {
        name,
        recognitionSeq: 'GAATTC',
        cutIndexTop: 1,
        cutIndexBottom: 5,
      },
      position: 120,
      strand: 1,
      cutPositionTop: 121,
      cutPositionBottom: 125,
      overhangType: '5-prime',
      overhangSeq: 'AATT',
      isMethylationBlocked: id === 'b',
      totalCutsInPlasmid: 1,
    });
    const groups = groupCutSites([cut('a', 'EcoRI'), cut('b', 'MfeI')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].names).toEqual(['EcoRI', 'MfeI']);
    expect(groups[0].single).toBe(true);
  });
});

describe('leader-line collision relaxation', () => {
  it('separates labels vertically on both sides', () => {
    const items = Array.from({ length: 18 }, (_, i) => ({
      id: `label-${i}`,
      anchorIndex: (i * 13) % 200,
      text: `EcoRI (${i})`,
      emphasis: i === 0,
    }));
    const labels = layoutLeaderLabels(items, {
      cx: 300,
      cy: 300,
      radius: 210,
      length: 200,
      minY: 12,
      maxY: 588,
      gap: 14,
    });
    expect(labels).toHaveLength(items.length);
    for (const side of ['left', 'right'] as const) {
      const sideLabels = labels.filter((label) => label.side === side).sort((a, b) => a.textY - b.textY);
      for (let i = 1; i < sideLabels.length; i += 1) {
        expect(sideLabels[i].textY - sideLabels[i - 1].textY).toBeGreaterThanOrEqual(13.99);
      }
      for (const label of sideLabels) {
        expect(label.textY).toBeGreaterThanOrEqual(12);
        expect(label.textY).toBeLessThanOrEqual(588);
        expect(label.textAnchor).toBe(side === 'right' ? 'start' : 'end');
      }
    }
  });
});

describe('translation engine', () => {
  it('translates codons including stops', () => {
    expect(translateCodon('ATG')).toBe('M');
    expect(translateCodon('TAA')).toBe('*');
    expect(reverseComplement('ATGAAATAG')).toBe('CTATTTCAT');
  });

  it('respects CDS frame and strand', () => {
    const plus = buildCdsCodons(
      'ATGAAATAG',
      feature('cds', 0, 9, 1, 'CDS'),
      9,
      false,
    );
    expect(plus.map((codon) => codon.aa)).toEqual(['M', 'K', '*']);
    const minus = buildCdsCodons(
      'ATGAAATAG',
      feature('cds', 0, 9, -1, 'CDS'),
      9,
      false,
    );
    expect(minus.map((codon) => codon.aa)).toEqual(['L', 'F', 'H']);
  });

  it('builds three and six reading frames', () => {
    const sequence = 'ATGAAATAGCCCGGGTTTAAA';
    const three = buildTranslationCodons(sequence, [], sequence.length, false, 'frame3');
    const six = buildTranslationCodons(sequence, [], sequence.length, false, 'frame6');
    expect(three).toHaveLength(19);
    expect(six).toHaveLength(38);
  });

  it('marks the true end of a feature only in its final row', () => {
    const map = buildFeatureRowMap([feature('f', 50, 250)], 100, 1000, false);
    expect(map.get(0)?.[0].isTrueStart).toBe(true);
    expect(map.get(0)?.[0].isTrueEnd).toBe(false);
    expect(map.get(1)?.[0].isTrueEnd).toBe(false);
    expect(map.get(2)?.[0].isTrueEnd).toBe(true);
  });
});

describe('Sanger alignment mapping', () => {
  it('maps aligned query bases onto reference coordinates', () => {
    const mapping = mapAlignedQueryToReference('A-CGT', 'ATCGT', 100);
    expect(mapping.get(0)).toEqual({ ref: 100, gap: false });
    expect(mapping.get(1)).toEqual({ ref: 101, gap: true });
    expect(mapping.get(2)).toEqual({ ref: 101, gap: false });
    expect(mapping.get(3)).toEqual({ ref: 102, gap: false });
    expect(mapping.get(4)).toEqual({ ref: 103, gap: false });
  });

  it('computes a clamped reference window', () => {
    const document = doc({ sequence: 'A'.repeat(1000), length: 1000 });
    const window = buildSangerWindow(document, [
      {
        id: 'trace',
        fileName: 'read.ab1',
        calledSequence: 'A'.repeat(150),
        qualityScores: [],
        baseLocations: [],
        trimRange: [0, 100],
        traces: { A: [], T: [], G: [], C: [] },
        alignment: {
          refStart: 100,
          refEnd: 300,
          strand: 1,
          identityPercent: 99,
          alignedRef: 'A'.repeat(200),
          alignedQuery: 'A'.repeat(200),
          mismatches: [],
        },
      },
    ]);
    expect(window.start).toBe(100);
    expect(window.end).toBe(300);
    expect(window.span).toBe(200);
  });
});

describe('gel mobility model', () => {
  it('increases migration with voltage and time', () => {
    const base = { agarosePercent: 1, voltage: 80, minutes: 30 };
    expect(migrationMultiplier({ ...base, voltage: 140 })).toBeGreaterThan(
      migrationMultiplier(base),
    );
    expect(migrationMultiplier({ ...base, minutes: 60 })).toBeGreaterThan(
      migrationMultiplier(base),
    );
  });

  it('reduces migration in denser gels and clamps the result', () => {
    const light = { agarosePercent: 0.8, voltage: 120, minutes: 45 };
    const dense = { ...light, agarosePercent: 2.5 };
    expect(migrationMultiplier(dense)).toBeLessThan(migrationMultiplier(light));
    expect(effectiveMigrationY(0.8, { ...light, voltage: 300, minutes: 240 })).toBeLessThanOrEqual(1);
    expect(effectiveMigrationY(0, light)).toBeGreaterThanOrEqual(0.02);
  });
});

describe('cloning history DAG layout', () => {
  const history: CloningHistoryNode[] = [
    {
      id: 'n1',
      operation: 'import',
      timestamp: '2026-01-01T10:00:00.000Z',
      description: 'Backbone vector',
    },
    {
      id: 'n2',
      operation: 'pcr',
      timestamp: '2026-01-02T10:00:00.000Z',
      description: 'Insert amplified with Q5 polymerase',
      primersUsed: ['F1', 'R1'],
      parentSnapshots: [{ id: 'p1', name: 'Template', length: 500, extractedRange: [100, 400] }],
    },
    {
      id: 'n3',
      operation: 'gibson_assembly',
      timestamp: '2026-01-03T10:00:00.000Z',
      description: 'Backbone and insert joined by Gibson assembly',
      enzymesUsed: ['EcoRI'],
      parentSnapshots: [
        { id: 'n1', name: 'Backbone', length: 3000 },
        { id: 'n2', name: 'Insert', length: 300 },
      ],
    },
  ];

  it('places parents above children', () => {
    const layout = layoutHistoryTree(history);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(byId.get('p1')?.layer).toBe(0);
    expect(byId.get('n1')?.layer).toBe(0);
    expect(byId.get('n2')?.layer).toBe(1);
    expect(byId.get('n3')?.layer).toBe(2);
    expect(layout.edges).toHaveLength(3);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('finds ancestors and descendants of a selected node', () => {
    const layout = layoutHistoryTree(history);
    const related = relatedNodeIds(layout, 'n3');
    expect(related).not.toBeNull();
    expect(related?.has('n1')).toBe(true);
    expect(related?.has('n2')).toBe(true);
    expect(related?.has('p1')).toBe(true);
  });

  it('wraps long node descriptions', () => {
    const lines = wrapText('a '.repeat(80).trim(), 20, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
  });
});
