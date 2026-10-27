// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure geometry and sampling helpers for the linear map and sequence printout.
 * Everything in this module runs in Node and inside a Web Worker.
 */

import type { CutSite, ORF } from '../../../types/schema';
import type { RangeSegment } from '../utils';
import { clamp, niceTickStep, splitRange, textWidthEstimate } from '../utils';

export interface GcProfileOptions {
  windowSize?: number;
  maxSamples?: number;
  circular?: boolean;
}

export interface GcSample {
  /** 0-based centre of the sliding window. */
  position: number;
  /** Fraction in the range 0..1, or null for a window without ACGT bases. */
  gc: number | null;
}

/**
 * Sliding-window GC content. Sampling is capped so large genomes stay cheap to
 * draw; the first and last windows are always represented.
 */
export function computeGcProfile(
  sequence: string,
  options: GcProfileOptions = {},
): GcSample[] {
  const upper = sequence.toUpperCase();
  const length = upper.length;
  if (length <= 0) return [];
  const circular = options.circular ?? false;
  const maxSamples = Math.max(8, Math.round(options.maxSamples ?? 360));
  const requestedWindow =
    options.windowSize ??
    Math.max(10, Math.min(2000, Math.round(length / 40) || 10));
  const windowSize = Math.max(1, Math.min(length, Math.round(requestedWindow)));
  const step = Math.max(1, Math.ceil(length / maxSamples));
  const samples: GcSample[] = [];

  for (let center = 0; center < length; center += step) {
    let gc = 0;
    let counted = 0;
    for (let offset = 0; offset < windowSize; offset += 1) {
      const raw = center - Math.floor(windowSize / 2) + offset;
      let index = raw;
      if (circular) {
        index = ((raw % length) + length) % length;
      } else if (index < 0 || index >= length) {
        continue;
      }
      const base = upper[index];
      if (base === 'G' || base === 'C') {
        gc += 1;
        counted += 1;
      } else if (base === 'A' || base === 'T' || base === 'U') {
        counted += 1;
      }
    }
    samples.push({ position: center, gc: counted > 0 ? gc / counted : null });
  }
  return samples;
}

export interface RulerTick {
  position: number;
  major: boolean;
  label: string;
  /** Relative position along the map, 0..1. */
  fraction: number;
}

/** Ruler ticks for a linear fragment, with optional minor subdivisions. */
export function layoutRulerTicks(
  length: number,
  interval: number | 'auto',
  targetTicks = 10,
): RulerTick[] {
  if (length <= 0) return [];
  const step =
    interval === 'auto' || !Number.isFinite(interval) || interval <= 0
      ? niceTickStep(length, targetTicks)
      : Math.max(1, Math.round(interval));
  const minorStep =
    step >= 10 && step % 5 === 0
      ? step / 5
      : step >= 4
        ? Math.max(1, Math.round(step / 2))
        : 0;
  const positions = new Set<number>();
  for (let position = 0; position < length; position += step) positions.add(position);
  if (minorStep > 0 && minorStep < step) {
    for (let position = 0; position < length; position += minorStep) positions.add(position);
  }
  positions.add(0);
  return [...positions]
    .sort((a, b) => a - b)
    .map((position) => ({
      position,
      major: position % step === 0,
      label: position % step === 0 ? String(position + 1) : '',
      fraction: position / length,
    }));
}

export interface CutMarkerItem {
  id: string;
  position: number;
  text: string;
  names: string[];
  blocked: boolean;
  single: boolean;
  cuts: CutSite[];
}

/** Collapse co-located cut sites so one label row represents every enzyme. */
export function buildCutMarkerItems(cutSites: CutSite[]): CutMarkerItem[] {
  const groups = new Map<string, CutSite[]>();
  for (const cut of cutSites) {
    const key = String(cut.position);
    const existing = groups.get(key);
    if (existing) existing.push(cut);
    else groups.set(key, [cut]);
  }
  const items: CutMarkerItem[] = [];
  for (const [key, cuts] of groups) {
    const first = cuts[0];
    const names = Array.from(new Set(cuts.map((cut) => cut.enzyme.name))).sort((a, b) =>
      a.localeCompare(b),
    );
    items.push({
      id: `cut:${key}`,
      position: first.position,
      text:
        names.length === 1
          ? `${names[0]} (${first.position + 1})`
          : `${names.join(' / ')} (${first.position + 1})`,
      names,
      blocked: cuts.every((cut) => cut.isMethylationBlocked),
      single: cuts.some((cut) => cut.totalCutsInPlasmid === 1),
      cuts,
    });
  }
  items.sort((a, b) => a.position - b.position);
  return items;
}

export interface LinearLabelItem {
  id: string;
  position: number;
  text: string;
}

export interface LinearLabelPlacement extends LinearLabelItem {
  /** Centre of the label in plot pixels. */
  x: number;
  row: number;
  width: number;
}

export interface LinearLabelLayout {
  placements: LinearLabelPlacement[];
  rowCount: number;
  /** Items that did not fit within the requested row count. */
  hidden: LinearLabelItem[];
}

export interface LinearLabelOptions {
  length: number;
  plotWidth: number;
  fontSize: number;
  gap?: number;
  maxRows?: number;
}

/**
 * Greedy row packing for enzyme labels along a horizontal axis. Labels are
 * placed in the first row where their estimated box does not collide with the
 * previous label of that row.
 */
export function layoutLinearLabels(
  items: LinearLabelItem[],
  options: LinearLabelOptions,
): LinearLabelLayout {
  const { length, plotWidth, fontSize } = options;
  const gap = Math.max(2, options.gap ?? 8);
  const maxRows = Math.max(1, options.maxRows ?? 4);
  if (length <= 0 || plotWidth <= 0) {
    return { placements: [], rowCount: 0, hidden: [...items] };
  }
  const sorted = [...items].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });
  const rowEnds: number[] = [];
  const placements: LinearLabelPlacement[] = [];
  const hidden: LinearLabelItem[] = [];
  for (const item of sorted) {
    const width = Math.max(
      fontSize,
      textWidthEstimate(item.text, fontSize),
    );
    const rawX = (clamp(item.position, 0, length) / length) * plotWidth;
    const half = width / 2;
    const x = clamp(rawX, half, Math.max(half, plotWidth - half));
    let row = -1;
    for (let index = 0; index < rowEnds.length; index += 1) {
      if (x - half >= rowEnds[index] + gap) {
        row = index;
        break;
      }
    }
    if (row === -1) {
      if (rowEnds.length >= maxRows) {
        hidden.push(item);
        continue;
      }
      row = rowEnds.length;
      rowEnds.push(Number.NEGATIVE_INFINITY);
    }
    rowEnds[row] = x + half;
    placements.push({ ...item, x, row, width });
  }
  return { placements, rowCount: rowEnds.length, hidden };
}

export interface OrfTrackEntry {
  orf: ORF;
  track: number;
  segments: RangeSegment[];
}

export interface OrfTrackLayout {
  entries: OrfTrackEntry[];
  trackCount: number;
}

/** Interval colouring for ORF arrows so overlapping reading frames remain legible. */
export function layoutOrfTracks(
  orfs: ORF[],
  length: number,
  circular: boolean,
): OrfTrackLayout {
  if (length <= 0 || orfs.length === 0) return { entries: [], trackCount: 0 };
  const ordered = [...orfs].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.lengthBp - a.lengthBp || a.id.localeCompare(b.id);
  });
  const tracks: RangeSegment[][] = [];
  const entries: OrfTrackEntry[] = [];
  for (const orf of ordered) {
    const segments = circular
      ? splitRange(orf.start, orf.end, length, true)
      : splitRange(orf.start, orf.end, length, false);
    if (segments.length === 0) continue;
    let track = -1;
    for (let index = 0; index < tracks.length; index += 1) {
      const collision = segments.some((segment) =>
        tracks[index].some(
          (existing) => segment.start < existing.end && existing.start < segment.end,
        ),
      );
      if (!collision) {
        track = index;
        break;
      }
    }
    if (track === -1) {
      track = tracks.length;
      tracks.push([]);
    }
    tracks[track].push(...segments);
    entries.push({ orf, track, segments });
  }
  return { entries, trackCount: tracks.length };
}

export interface LinearMapLayoutInput {
  width: number;
  plusTracks: number;
  minusTracks: number;
  orfTracks: number;
  labelRows: number;
  showPrimers: boolean;
  showGcPlot: boolean;
  hasTitle: boolean;
  labelFontSize: number;
}

export interface LinearMapLayout {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  plotLeft: number;
  plotWidth: number;
  titleBaseline: number;
  enzymeLabelTop: number;
  enzymeRowHeight: number;
  primerTop: number;
  primerHeight: number;
  plusTop: number;
  plusBottom: number;
  laneHeight: number;
  bandHeight: number;
  rulerY: number;
  minusTop: number;
  minusBottom: number;
  orfTop: number;
  orfBottom: number;
  orfLaneHeight: number;
  gcTop: number;
  gcBottom: number;
  featureTop: number;
  featureBottom: number;
  footerY: number;
}

const TOP_MARGIN = 12;
const TITLE_HEIGHT = 26;
const TITLE_GAP = 8;
const LANE_HEIGHT = 15;
const BAND_HEIGHT = 11;
const PRIMER_HEIGHT = 12;
const ORF_LANE_HEIGHT = 14;
const GC_HEIGHT = 58;
const BOTTOM_MARGIN = 24;

export function computeLinearMapLayout(input: LinearMapLayoutInput): LinearMapLayout {
  const width = Math.max(320, input.width);
  const marginLeft = 30;
  const marginRight = 30;
  const plotWidth = Math.max(60, width - marginLeft - marginRight);
  const labelFontSize = Math.max(7, input.labelFontSize);
  const enzymeRowHeight = labelFontSize + 4;
  const titleHeight = input.hasTitle ? TITLE_HEIGHT + TITLE_GAP : 0;
  const enzymeLabelTop = TOP_MARGIN + titleHeight;
  const labelBandHeight =
    input.labelRows > 0 ? input.labelRows * enzymeRowHeight + 6 : 0;
  const primerHeight = input.showPrimers ? PRIMER_HEIGHT : 0;
  const primerTop = enzymeLabelTop + labelBandHeight;
  const plusTop = primerTop + primerHeight + (primerHeight > 0 ? 4 : 0);
  const plusBottom = plusTop + Math.max(0, input.plusTracks) * LANE_HEIGHT;
  const rulerY = plusBottom + 26;
  const minusTop = rulerY + 9;
  const minusBottom = minusTop + Math.max(0, input.minusTracks) * LANE_HEIGHT;
  const orfTop = minusBottom + (input.orfTracks > 0 ? 10 : 0);
  const orfBottom = orfTop + Math.max(0, input.orfTracks) * ORF_LANE_HEIGHT;
  const gcTop = orfBottom + (input.showGcPlot ? 14 : 0);
  const gcBottom = gcTop + (input.showGcPlot ? GC_HEIGHT : 0);
  return {
    width,
    height: gcBottom + BOTTOM_MARGIN,
    marginLeft,
    marginRight,
    plotLeft: marginLeft,
    plotWidth,
    titleBaseline: TOP_MARGIN + 12,
    enzymeLabelTop,
    enzymeRowHeight,
    primerTop,
    primerHeight,
    plusTop,
    plusBottom,
    laneHeight: LANE_HEIGHT,
    bandHeight: BAND_HEIGHT,
    rulerY,
    minusTop,
    minusBottom,
    orfTop,
    orfBottom,
    orfLaneHeight: ORF_LANE_HEIGHT,
    gcTop,
    gcBottom,
    featureTop: plusTop,
    featureBottom: orfBottom > orfTop ? orfBottom : minusBottom,
    footerY: gcBottom + 16,
  };
}
