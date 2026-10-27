// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Multi-segment feature support.
 *
 * `SequenceFeature.notes.segments` carries a list of `"start-end"` strings in
 * biological order (5' -> 3'). Coordinates are 0-based, half-open document
 * coordinates; in circular documents a segment may wrap the origin.
 *
 * Features without `segments` are treated as a single segment and keep the
 * historical rendering path unchanged.
 */

import type { SequenceFeature } from '../../types/schema';
import type { RangeSegment } from './utils';
import { featureSegments, mod, splitRange } from './utils';

const SEGMENT_PATTERN = /^\s*(-?\d+)\s*-\s*(-?\d+)\s*$/;

/** Parse and validate the segment list stored on a feature. */
export function parseSegmentsNote(
  notes?: Record<string, string[]>,
): RangeSegment[] | null {
  const raw = notes?.segments;
  if (!raw || raw.length === 0) return null;
  const segments: RangeSegment[] = [];
  for (const entry of raw) {
    const match = SEGMENT_PATTERN.exec(entry);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start === end) continue;
    segments.push({ start, end });
  }
  return segments.length > 0 ? segments : null;
}

/** True when the feature declares more than one biological segment. */
export function isMultiSegmentFeature(feature: SequenceFeature): boolean {
  const segments = parseSegmentsNote(feature.notes);
  return segments !== null && segments.length > 1;
}

export interface FeaturePiece extends RangeSegment {
  /** Index of the biological segment this piece belongs to. */
  segmentIndex: number;
  /** Position of the piece within the split segment (origin crossing). */
  pieceIndex: number;
  isSegmentStart: boolean;
  isSegmentEnd: boolean;
}

export interface FeatureSegmentPlan {
  feature: SequenceFeature;
  multi: boolean;
  /** Biological segments in 5' -> 3' order (un-split document coordinates). */
  segments: RangeSegment[];
  /** Renderable pieces after splitting wrapped segments at the origin. */
  pieces: FeaturePiece[];
  /** Coordinate of the direction arrow tip, or null when none is drawn. */
  arrowIndex: number | null;
  arrowDirection: 1 | -1 | 0;
  /** Total covered bases. */
  coveredLength: number;
}

function normalizeSegment(
  segment: RangeSegment,
  length: number,
  circular: boolean,
): RangeSegment[] {
  if (length <= 0) return [];
  if (!circular) {
    const start = Math.max(0, Math.min(length, Math.min(segment.start, segment.end)));
    const end = Math.max(0, Math.min(length, Math.max(segment.start, segment.end)));
    return end > start ? [{ start, end }] : [];
  }
  return splitRange(segment.start, segment.end, length, true);
}

/**
 * Build a rendering plan for a feature, handling `notes.segments` if present.
 * The arrow is only placed on the final biological segment.
 */
export function buildFeatureSegmentPlan(
  feature: SequenceFeature,
  length: number,
  circular = true,
): FeatureSegmentPlan {
  const declared = parseSegmentsNote(feature.notes);
  const multi = declared !== null && declared.length > 1;
  const biological = multi
    ? declared
    : [{ start: feature.start, end: feature.end }];

  const segments: RangeSegment[] = [];
  const pieces: FeaturePiece[] = [];
  let lastBiologicalFirstStart = 0;
  let lastBiologicalLastEnd = 0;
  for (let segmentIndex = 0; segmentIndex < biological.length; segmentIndex += 1) {
    const raw = biological[segmentIndex];
    // Keep biological ordering: split pieces follow the 5' -> 3' direction, so a
    // segment wrapping the origin contributes its tail first and head second.
    const resolved = normalizeSegment(raw, length, circular);
    if (resolved.length === 0) continue;
    segments.push({ start: raw.start, end: raw.end });
    for (let pieceIndex = 0; pieceIndex < resolved.length; pieceIndex += 1) {
      const piece = resolved[pieceIndex];
      pieces.push({
        start: piece.start,
        end: piece.end,
        segmentIndex,
        pieceIndex,
        isSegmentStart: pieceIndex === 0,
        isSegmentEnd: pieceIndex === resolved.length - 1,
      });
    }
    lastBiologicalFirstStart = resolved[0].start;
    lastBiologicalLastEnd = resolved[resolved.length - 1].end;
  }

  if (!multi) {
    // Non-segment features must keep the exact legacy geometry.
    const legacy = featureSegments(feature, length, circular);
    const legacyPieces: FeaturePiece[] = legacy.map((segment, index) => ({
      ...segment,
      segmentIndex: 0,
      pieceIndex: index,
      isSegmentStart: index === 0,
      isSegmentEnd: index === legacy.length - 1,
    }));
    const rawStart = mod(feature.start, length || 1);
    const rawEnd = mod(feature.end, length || 1);
    const full =
      circular && length > 0 && rawStart === rawEnd && feature.start !== feature.end;
    let arrowIndex: number | null = null;
    if (!full && feature.strand === 1) {
      arrowIndex = circular ? rawEnd : Math.max(0, Math.min(length, feature.end));
    } else if (!full && feature.strand === -1) {
      arrowIndex = circular ? rawStart : Math.max(0, Math.min(length, feature.start));
    }
    return {
      feature,
      multi: false,
      segments: legacy,
      pieces: legacyPieces,
      arrowIndex,
      arrowDirection: feature.strand === 1 ? 1 : feature.strand === -1 ? -1 : 0,
      coveredLength: legacy.reduce((sum, segment) => sum + (segment.end - segment.start), 0),
    };
  }

  const coveredLength = segments.reduce(
    (sum, segment) => sum + (segment.end - segment.start),
    0,
  );
  let arrowIndex: number | null = null;
  let arrowDirection: 1 | -1 | 0 = 0;
  if (segments.length > 0 && length > 0 && !(circular && coveredLength >= length - 0.5)) {
    if (feature.strand === 1) {
      arrowIndex = circular
        ? mod(lastBiologicalLastEnd, length)
        : Math.max(0, Math.min(length, lastBiologicalLastEnd));
      arrowDirection = 1;
    } else if (feature.strand === -1) {
      arrowIndex = circular
        ? mod(lastBiologicalFirstStart, length)
        : Math.max(0, Math.min(length, lastBiologicalFirstStart));
      arrowDirection = -1;
    }
  }
  return {
    feature,
    multi,
    segments,
    pieces,
    arrowIndex,
    arrowDirection,
    coveredLength,
  };
}

export interface FeatureTrackEntry {
  feature: SequenceFeature;
  plan: FeatureSegmentPlan;
}

export interface SegmentTrackAssignment {
  lanes: FeatureTrackEntry[][];
  laneById: Map<string, number>;
  plans: Map<string, FeatureSegmentPlan>;
}

/**
 * Greedy interval-graph colouring identical in spirit to `assignFeatureTracks`
 * but aware of multi-segment features: introns do not occupy a track.
 */
export function assignSegmentTracks(
  features: SequenceFeature[],
  length: number,
  circular = true,
): SegmentTrackAssignment {
  const lanes: FeatureTrackEntry[][] = [];
  const laneSegments: RangeSegment[][] = [];
  const laneById = new Map<string, number>();
  const plans = new Map<string, FeatureSegmentPlan>();
  if (length <= 0) return { lanes, laneById, plans };

  const entries = features.map((feature) => ({
    feature,
    plan: buildFeatureSegmentPlan(feature, length, circular),
  }));
  entries.sort((a, b) => {
    const aStart = a.plan.pieces.length > 0 ? a.plan.pieces[0].start : 0;
    const bStart = b.plan.pieces.length > 0 ? b.plan.pieces[0].start : 0;
    if (aStart !== bStart) return aStart - bStart;
    if (a.plan.coveredLength !== b.plan.coveredLength) {
      return b.plan.coveredLength - a.plan.coveredLength;
    }
    return a.feature.id.localeCompare(b.feature.id);
  });

  for (const entry of entries) {
    const { feature, plan } = entry;
    if (plan.pieces.length === 0) continue;
    plans.set(feature.id, plan);
    let lane = -1;
    for (let i = 0; i < lanes.length; i += 1) {
      const occupied = laneSegments[i];
      const collision = plan.pieces.some((piece) =>
        occupied.some((existing) => piece.start < existing.end && existing.start < piece.end),
      );
      if (!collision) {
        lane = i;
        break;
      }
    }
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
      laneSegments.push([]);
    }
    lanes[lane].push(entry);
    laneSegments[lane].push(...plan.pieces);
    laneById.set(feature.id, lane);
  }
  return { lanes, laneById, plans };
}

/**
 * Gaps between consecutive biological segments, expressed as renderable
 * ranges. Used to draw intron connectors in linear views. Origin-split pieces
 * of the same biological segment are skipped, and minus-strand features take
 * the gap between the downstream end of one segment and the upstream end of
 * the previous one.
 */
export function segmentGapRanges(
  plan: FeatureSegmentPlan,
  length: number,
  circular: boolean,
): RangeSegment[] {
  if (!plan.multi || plan.pieces.length < 2 || length <= 0) return [];
  const gaps: RangeSegment[] = [];
  for (let i = 0; i < plan.pieces.length - 1; i += 1) {
    const current = plan.pieces[i];
    const next = plan.pieces[i + 1];
    if (current.segmentIndex === next.segmentIndex) continue;
    const from = plan.feature.strand === -1 ? next.end : current.end;
    const to = plan.feature.strand === -1 ? current.start : next.start;
    if (circular) {
      const span = mod(to - from, length);
      if (span <= 0) continue;
      gaps.push(...splitRange(from, from + span, length, true));
    } else if (to > from) {
      gaps.push({ start: from, end: to });
    }
  }
  return gaps;
}
