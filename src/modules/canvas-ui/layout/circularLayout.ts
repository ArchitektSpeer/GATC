import type { CutSite, Primer, SequenceFeature } from '../../../types/schema';
import type { LeaderSource } from '../utils';
import { layoutLeaderLabels, mod } from '../utils';

export type { FeatureTrackAssignment } from '../utils';
export { assignFeatureTracks, featureSegments } from '../utils';

export interface EnzymeLabelSource extends LeaderSource {
  kind: 'enzyme';
  enzymeName: string;
  position: number;
  cutId: string;
  totalCuts: number;
  blocked: boolean;
  overhangType: CutSite['overhangType'];
  overhangSeq: string;
  strand: 1 | -1;
}

export interface PrimerLabelSource extends LeaderSource {
  kind: 'primer';
  primerId: string;
  strand: 1 | -1;
  tm: number;
  tailLength: number;
  bindingStart: number;
  bindingEnd: number;
}

export interface FeatureLabelSource extends LeaderSource {
  kind: 'feature';
  feature: SequenceFeature;
}

export type CircularLabelSource = EnzymeLabelSource | PrimerLabelSource | FeatureLabelSource;

export interface CutLabelGroup {
  key: string;
  position: number;
  names: string[];
  blocked: boolean;
  single: boolean;
  cut: CutSite;
  cuts: CutSite[];
}

/**
 * Collapse co-located cut sites so that a multi-enzyme site occupies one label
 * row while still marking every enzyme in the group.
 */
export function groupCutSites(cutSites: CutSite[]): CutLabelGroup[] {
  const groups = new Map<string, CutSite[]>();
  for (const cut of cutSites) {
    const key = `${cut.position}`;
    const existing = groups.get(key);
    if (existing) existing.push(cut);
    else groups.set(key, [cut]);
  }
  const result: CutLabelGroup[] = [];
  for (const [key, cuts] of groups) {
    const first = cuts[0];
    const names = Array.from(new Set(cuts.map((c) => c.enzyme.name))).sort((a, b) =>
      a.localeCompare(b),
    );
    const single = cuts.some((c) => c.totalCutsInPlasmid === 1);
    const blocked = cuts.every((c) => c.isMethylationBlocked);
    result.push({
      key,
      position: first.position,
      names,
      blocked,
      single,
      cut: first,
      cuts,
    });
  }
  result.sort((a, b) => a.position - b.position);
  return result;
}

export function buildCutLabelSources(
  groups: CutLabelGroup[],
  length: number,
): EnzymeLabelSource[] {
  return groups.map((group) => ({
    id: `cut:${group.key}`,
    anchorIndex: mod(group.position, length || 1),
    text:
      group.names.length === 1
        ? `${group.names[0]} (${group.position + 1})`
        : `${group.names.join(' / ')} (${group.position + 1})`,
    kind: 'enzyme',
    enzymeName: group.names.join(' / '),
    position: group.position,
    cutId: group.cut.id,
    totalCuts: Math.max(1, group.cut.totalCutsInPlasmid),
    blocked: group.blocked,
    overhangType: group.cut.overhangType,
    overhangSeq: group.cut.overhangSeq,
    strand: group.cut.strand,
    emphasis: group.single && !group.blocked,
    muted: group.blocked,
  }));
}

export function buildPrimerLabelSources(
  primers: Primer[],
  length: number,
): PrimerLabelSource[] {
  return primers.map((primer) => {
    const anchor = mod(
      Math.floor((primer.bindingStart + primer.bindingEnd) / 2),
      length || 1,
    );
    const tailLength = primer.tailSequence.length;
    return {
      id: `primer:${primer.id}`,
      anchorIndex: anchor,
      text: tailLength > 0 ? `${primer.name} [+${tailLength}]` : primer.name,
      kind: 'primer',
      primerId: primer.id,
      strand: primer.strand,
      tm: primer.tmAnnealing,
      tailLength,
      bindingStart: primer.bindingStart,
      bindingEnd: primer.bindingEnd,
      emphasis: false,
      muted: false,
    };
  });
}

export function buildCircularLabels(
  cutSources: EnzymeLabelSource[],
  primerSources: PrimerLabelSource[],
  options: { cx: number; cy: number; radius: number; length: number; minY: number; maxY: number },
) {
  const layout = layoutLeaderLabels([...cutSources, ...primerSources], {
    ...options,
    gap: 13,
    elbowOffset: 26,
    textOffset: 60,
  });
  const cutIds = new Set(cutSources.map((c) => c.id));
  const primerIds = new Set(primerSources.map((p) => p.id));
  return layout.filter((label) => {
    if (label.item.kind === 'enzyme') return cutIds.has(label.item.id);
    if (label.item.kind === 'primer') return primerIds.has(label.item.id);
    return true;
  });
}

export interface CircularGeometry {
  size: number;
  cx: number;
  cy: number;
  outerRadius: number;
  featureOuter: number;
  featureInner: number;
  bandHeight: number;
  bandGap: number;
  trackCount: number;
  primerRadius: number;
  ringWidth: number;
}

export function computeCircularGeometry(
  size: number,
  trackCount: number,
): CircularGeometry {
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size * 0.315;
  const featureOuter = outerRadius;
  const maxBand = size * 0.20;
  const minBand = 10;
  const defaultGap = Math.max(2, size * 0.0045);
  const available = Math.max(minBand, maxBand);
  const gap =
    trackCount > 0
      ? Math.min(defaultGap, available / Math.max(1, trackCount * 5))
      : defaultGap;
  let trackHeight =
    trackCount > 0
      ? Math.max(
          1,
          Math.min(
            size * 0.03,
            (available - gap * Math.max(0, trackCount - 1)) / trackCount,
          ),
        )
      : size * 0.024;
  let resolvedGap = gap;
  const consumed = trackCount * trackHeight + Math.max(0, trackCount - 1) * resolvedGap;
  if (trackCount > 0 && consumed > available) {
    const scale = available / consumed;
    trackHeight *= scale;
    resolvedGap *= scale;
  }
  const featureInner =
    featureOuter -
    (trackCount > 0 ? trackCount * trackHeight + (trackCount - 1) * resolvedGap : 0);
  return {
    size,
    cx,
    cy,
    outerRadius,
    featureOuter,
    featureInner,
    bandHeight: trackHeight,
    bandGap: resolvedGap,
    trackCount,
    primerRadius: featureInner - Math.max(8, size * 0.02),
    ringWidth: outerRadius * 0.05,
  };
}
