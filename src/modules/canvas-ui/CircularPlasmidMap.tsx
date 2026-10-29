// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Dna, FileDown, ImageDown } from 'lucide-react';
import type {
  CutSite,
  ORF,
  PlasmidDocument,
  SelectionRange,
  SequenceFeature,
} from '../../types/schema';
import type { VizTheme } from './theme';
import { getTheme } from './theme';
import {
  annularSectorPath,
  clamp,
  contrastText,
  describeArc,
  describeTextArc,
  directionalArrow,
  formatBp,
  layoutLeaderLabels,
  mod,
  niceTickStep,
  pointOnCircle,
  pointToIndex,
  splitRange,
  textWidthEstimate,
  trimNumber,
} from './utils';
import {
  buildCutLabelSources,
  buildPrimerLabelSources,
  computeCircularGeometry,
  groupCutSites,
} from './layout/circularLayout';
import type { EnzymeLabelSource, PrimerLabelSource } from './layout/circularLayout';
import { exportSvgToPng, exportSvgToPublicationFile } from './exportSvg';
import {
  assignSegmentTracks,
  segmentGapRanges,
  type FeaturePiece,
  type FeatureSegmentPlan,
} from './segments';
import {
  filterVisibleFeatures,
  resolveMapDisplayOptions,
  type MapDisplayOptions,
} from './mapDisplayOptions';
import { computeGcProfile } from './layout/linearMapLayout';
import { t as translate, useT } from '../../lib/i18n';

interface DragState {
  anchor: number;
  endUnwrapped: number;
  prevIndex: number;
  pointer: { x: number; y: number };
  pointerId: number;
  moved: boolean;
}

function dragSelection(anchor: number, endUnwrapped: number, length: number): SelectionRange {
  const delta = clamp(endUnwrapped - anchor, -length, length);
  if (length > 0 && Math.abs(delta) >= length - 1e-6) {
    return { start: 0, end: length };
  }
  if (delta >= 0) {
    return { start: mod(anchor, length), end: mod(anchor + delta, length) };
  }
  return { start: mod(anchor + delta, length), end: mod(anchor, length) };
}

function selectionBp(selection: SelectionRange | null, length: number): number {
  if (!selection || length <= 0) return 0;
  return splitRange(selection.start, selection.end, length, true).reduce(
    (sum, segment) => sum + (segment.end - segment.start),
    0,
  );
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function baseNameOf(doc: PlasmidDocument): string {
  return (doc.name || 'plasmid').trim().replace(/[^\w.-]+/g, '_') || 'plasmid';
}

export interface CircularPlasmidMapProps {
  doc: PlasmidDocument;
  cutSites: CutSite[];
  orfs?: ORF[];
  selection: SelectionRange | null;
  onSelectionChange?: (sel: SelectionRange | null) => void;
  onFeatureClick?: (f: SequenceFeature) => void;
  displayOptions?: MapDisplayOptions;
  theme?: VizTheme;
  size?: number;
  showPrimers?: boolean;
  svgRef?: React.Ref<SVGSVGElement>;
}

interface FeatureArc {
  key: string;
  feature: SequenceFeature;
  plan: FeatureSegmentPlan;
  piece: FeaturePiece;
  radius: number;
  start: number;
  end: number;
  full: boolean;
  arrow: { index: number; direction: 1 | -1 } | null;
}

interface FeatureLabel {
  feature: SequenceFeature;
  pathId: string;
  path: string;
  radius: number;
  fontSize: number;
}

export function CircularPlasmidMap({
  doc,
  cutSites,
  orfs = [],
  selection,
  onSelectionChange,
  onFeatureClick,
  displayOptions,
  theme = 'light',
  size: requestedSize = 760,
  showPrimers = true,
  svgRef,
}: CircularPlasmidMapProps) {
  const t = useT();
  const tokens = getTheme(theme);
  const size = Math.max(360, requestedSize);
  // The ring is square but the enzyme and primer names need a column either side, so the
  // canvas is wider than tall. Without the gutters the names are clipped to an ellipsis.
  const width = Math.round(size * 1.3);
  const length = doc.length || doc.sequence.length;
  const circular = doc.topology === 'circular';
  const rawUid = useId();
  const uid = safeId(rawUid);
  const svgNodeRef = useRef<SVGSVGElement | null>(null);
  const [hoveredFeature, setHoveredFeature] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const resolvedDisplay = useMemo(
    () => (displayOptions ? resolveMapDisplayOptions(displayOptions) : null),
    [displayOptions],
  );
  const visibleFeatures = useMemo(
    () =>
      resolvedDisplay
        ? filterVisibleFeatures(doc.features, resolvedDisplay)
        : doc.features,
    [doc.features, resolvedDisplay],
  );

  const setSvgNode = useCallback(
    (node: SVGSVGElement | null) => {
      svgNodeRef.current = node;
      if (typeof svgRef === 'function') {
        svgRef(node);
      } else if (svgRef) {
        (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = node;
      }
    },
    [svgRef],
  );

  const assignment = useMemo(
    () => assignSegmentTracks(visibleFeatures, length, circular),
    [visibleFeatures, length, circular],
  );
  const geometry = useMemo(
    () => computeCircularGeometry(size, assignment.lanes.length, width),
    [size, width, assignment.lanes.length],
  );
  const centerFontSize = clamp(geometry.featureInner * 0.14, 9.5, 17);
  const centerNameChars = Math.max(
    7,
    Math.floor((geometry.featureInner * 1.4) / (centerFontSize * 0.58)),
  );

  const activeCutSites = resolvedDisplay && !resolvedDisplay.showEnzymes ? [] : cutSites;
  const primerVisible = showPrimers && (resolvedDisplay ? resolvedDisplay.showPrimers : true);
  const cutGroups = useMemo(() => groupCutSites(activeCutSites), [activeCutSites]);
  const cutSources = useMemo(
    () => buildCutLabelSources(cutGroups, length),
    [cutGroups, length],
  );
  const primerSources = useMemo(
    () => (primerVisible ? buildPrimerLabelSources(doc.primers, length) : []),
    [doc.primers, length, primerVisible],
  );

  const leaderLayout = useMemo(() => {
    const cutLabelSources =
      resolvedDisplay && !resolvedDisplay.showEnzymeLabels ? [] : cutSources;
    const all = [...cutLabelSources, ...primerSources];
    if (all.length === 0) return [];
    const sources = all.sort((a, b) => a.anchorIndex - b.anchorIndex);
    const textOffset = Math.max(30, Math.min(52, size * 0.055));
    return layoutLeaderLabels(sources, {
      cx: geometry.cx,
      cy: geometry.cy,
      radius: geometry.outerRadius + 2,
      length,
      minY: 16,
      maxY: size - 16,
      gap: 13,
      elbowOffset: Math.max(18, textOffset * 0.5),
      textOffset,
    });
  }, [cutSources, primerSources, geometry, length, size, resolvedDisplay]);

  const tickStep =
    resolvedDisplay && resolvedDisplay.tickInterval !== 'auto'
      ? resolvedDisplay.tickInterval
      : niceTickStep(length, 16);
  const showTicks = resolvedDisplay ? resolvedDisplay.showTicks : true;

  const featureArcs = useMemo(() => {
    const arcs: FeatureArc[] = [];
    const labels: FeatureLabel[] = [];
    const showLabels = resolvedDisplay ? resolvedDisplay.showFeatureLabels : true;
    for (let lane = 0; lane < assignment.lanes.length; lane += 1) {
      const radius =
        geometry.featureOuter -
        lane * (geometry.bandHeight + geometry.bandGap) -
        geometry.bandHeight / 2;
      for (const entry of assignment.lanes[lane]) {
        const feature = entry.feature;
        const plan = entry.plan;
        const lastSegmentIndex =
          plan.pieces.length > 0
            ? plan.pieces[plan.pieces.length - 1].segmentIndex
            : -1;
        let widest: FeaturePiece | null = null;
        for (const piece of plan.pieces) {
          const span = piece.end - piece.start;
          if (!widest || span > widest.end - widest.start) widest = piece;
          const full = length > 0 && span >= length - 0.5;
          let arrow: FeatureArc['arrow'] = null;
          if (
            plan.arrowIndex !== null &&
            !full &&
            piece.segmentIndex === lastSegmentIndex
          ) {
            if (feature.strand === 1 && piece.isSegmentEnd) {
              arrow = { index: plan.arrowIndex, direction: 1 };
            } else if (feature.strand === -1 && piece.isSegmentStart) {
              arrow = { index: plan.arrowIndex, direction: -1 };
            }
          }
          arcs.push({
            key: `${feature.id}:${piece.segmentIndex}:${piece.pieceIndex}`,
            feature,
            plan,
            piece,
            radius,
            start: piece.start,
            end: piece.end,
            full,
            arrow,
          });
        }
        if (showLabels && widest && length > 0) {
          const span = widest.end - widest.start;
          if (span < length - 0.5) {
            const spanDeg = (span / Math.max(1, length)) * 360;
            const arcLength = (span / Math.max(1, length)) * 2 * Math.PI * radius;
            const labelScale = resolvedDisplay
              ? resolvedDisplay.labelFontSize / 11
              : 1;
            const fontSize = clamp(
              Math.min(10, Math.max(8, geometry.bandHeight * 0.58)) * labelScale,
              6.5,
              16,
            );
            const needed = textWidthEstimate(feature.name, fontSize) + 12;
            if (spanDeg >= 8 && spanDeg <= 300 && arcLength > needed) {
              const pathId = `osg-feature-${uid}-${safeId(feature.id)}`;
              labels.push({
                feature,
                pathId,
                path: describeTextArc(
                  geometry.cx,
                  geometry.cy,
                  radius,
                  widest.start,
                  widest.end,
                  Math.max(1, length),
                ),
                radius,
                fontSize,
              });
            }
          }
        }
      }
    }
    return { arcs, labels };
  }, [assignment, geometry, length, uid, resolvedDisplay]);

  const liveSelection = useMemo<SelectionRange | null>(() => {
    if (drag) return dragSelection(drag.anchor, drag.endUnwrapped, length);
    return selection;
  }, [drag, selection, length]);

  const selectionSegments = useMemo(
    () =>
      liveSelection && length > 0
        ? splitRange(liveSelection.start, liveSelection.end, length, circular)
        : [],
    [liveSelection, length, circular],
  );

  const selectedBp = useMemo(
    () => selectionBp(liveSelection, length),
    [liveSelection, length],
  );

  const stats = useMemo(() => {
    let gc = 0;
    let counted = 0;
    const upper = doc.sequence.toUpperCase();
    for (let i = 0; i < upper.length; i += 1) {
      const char = upper[i];
      if (char === 'G' || char === 'C') gc += 1;
      if ('ACGT'.includes(char)) counted += 1;
    }
    return {
      gc: counted > 0 ? (gc / counted) * 100 : 0,
      features: visibleFeatures.length,
      primers: primerVisible ? doc.primers.length : 0,
      cuts: activeCutSites.length,
    };
  }, [doc.sequence, visibleFeatures.length, doc.primers.length, primerVisible, activeCutSites.length]);

  const gcSamples = useMemo(
    () =>
      resolvedDisplay?.showGcPlot
        ? computeGcProfile(doc.sequence.toUpperCase(), {
            circular,
            maxSamples: 240,
            windowSize: Math.max(10, Math.round(length / 40)),
          })
        : [],
    [resolvedDisplay, doc.sequence, circular, length],
  );
  const showOrfs = orfs.length > 0 && (!resolvedDisplay || resolvedDisplay.showOrfs);

  const pointerToLocal = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
      const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * size;
      return { x, y };
    },
    [size, width],
  );

  const notifySelection = useCallback(
    (anchor: number, endUnwrapped: number) => {
      if (!onSelectionChange || length <= 0) return;
      const next = dragSelection(anchor, endUnwrapped, length);
      onSelectionChange({
        start: Math.round(next.start),
        end: Math.round(next.end),
      });
    },
    [onSelectionChange, length],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (length <= 0) return;
      const local = pointerToLocal(event);
      const distance = Math.hypot(local.x - geometry.cx, local.y - geometry.cy);
      if (distance < geometry.featureInner - size * 0.04 || distance > geometry.outerRadius + size * 0.02) {
        return;
      }
      event.preventDefault();
      const index = pointToIndex(local.x, local.y, geometry.cx, geometry.cy, length);
      const next: DragState = {
        anchor: mod(index, length),
        endUnwrapped: index,
        prevIndex: index,
        pointer: local,
        pointerId: event.pointerId,
        moved: false,
      };
      dragRef.current = next;
      setDrag(next);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Pointer capture is unavailable in some embedded browsers. */
      }
    },
    [length, pointerToLocal, geometry, size],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId || length <= 0) return;
      const local = pointerToLocal(event);
      const index = pointToIndex(local.x, local.y, geometry.cx, geometry.cy, length);
      let delta = index - current.prevIndex;
      if (delta > length / 2) delta -= length;
      if (delta < -length / 2) delta += length;
      const endUnwrapped = clamp(
        current.endUnwrapped + delta,
        current.anchor - length,
        current.anchor + length,
      );
      const moved = Math.abs(endUnwrapped - current.anchor) > 0.35;
      const next: DragState = {
        ...current,
        endUnwrapped,
        prevIndex: index,
        pointer: local,
        moved: current.moved || moved,
      };
      dragRef.current = next;
      setDrag(next);
      notifySelection(next.anchor, next.endUnwrapped);
    },
    [length, pointerToLocal, geometry, notifySelection],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<SVGSVGElement>, cancelled = false) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDrag(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* No capture to release. */
      }
      if (cancelled) return;
      if (!current.moved) {
        onSelectionChange?.(null);
      } else {
        notifySelection(current.anchor, current.endUnwrapped);
      }
    },
    [onSelectionChange, notifySelection],
  );

  const handleFeatureClick = useCallback(
    (feature: SequenceFeature) => {
      onFeatureClick?.(feature);
    },
    [onFeatureClick],
  );

  const fileBase = baseNameOf(doc);
  const centerTitle =
    (resolvedDisplay?.title ?? '').trim() || doc.name || 'Untitled plasmid';
  const centerShowLength = resolvedDisplay ? resolvedDisplay.showLength : true;
  const dragBubble = useMemo(() => {
    if (!drag) return null;
    const next = dragSelection(drag.anchor, drag.endUnwrapped, length);
    const delta = clamp(drag.endUnwrapped - drag.anchor, -length, length);
    const angle = (Math.abs(delta) / Math.max(1, length)) * 360;
    const bp = selectionBp(next, length);
    if (bp <= 0) return null;
    const bubbleWidth = 166;
    const height = 52;
    const flipX = drag.pointer.x > width - bubbleWidth - 18;
    const flipY = drag.pointer.y < 90;
    return {
      x: drag.pointer.x + (flipX ? -16 - bubbleWidth : 16),
      y: drag.pointer.y + (flipY ? 18 : -height - 18),
      width: bubbleWidth,
      height,
      bp,
      angle,
      label: `${Math.round(next.start) + 1}–${Math.round(next.end)}`,
    };
  }, [drag, length, width]);

  const css = `
    .osg-circular-root button { font-family: ${tokens.fontSans}; }
    .osg-circular-root svg text { user-select: none; }
    .osg-circular-root .osg-leader { transition: opacity 120ms ease; }
  `;

  return (
    <div
      className="osg-circular-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        color: tokens.text,
        fontFamily: tokens.fontSans,
      }}
    >
      <style>{css}</style>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '4px 2px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 9,
              background: tokens.accentSoft,
              color: tokens.accent,
              flexShrink: 0,
            }}
          >
            <Dna size={17} strokeWidth={1.9} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {doc.name || 'Untitled plasmid'}
            </div>
            <div style={{ fontSize: 11.5, color: tokens.muted }}>
              {t('{v0} bp · {v1} · GC {v2}% · {v3} 个特征', { v0: formatBp(length), v1: t(circular ? '环状' : '线性'), v2: trimNumber(stats.gc), v3: stats.features })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <button
            type="button"
            onClick={() => {
              const svg = svgNodeRef.current;
              if (svg) exportSvgToPublicationFile(svg, `${fileBase}-map.svg`);
            }}
            style={toolbarButton(tokens)}
            title="Download a vector SVG suitable for journal figure assembly"
          >
            <FileDown size={14} /> SVG
          </button>
          <button
            type="button"
            onClick={() => {
              const svg = svgNodeRef.current;
              if (svg) {
                void exportSvgToPng(svg, `${fileBase}-map.png`, 300).catch(
                  () => undefined,
                );
              }
            }}
            style={toolbarButton(tokens)}
            title="Download a 300 dpi PNG with a white background"
          >
            <ImageDown size={14} /> PNG 300 dpi
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', maxWidth: width, margin: '0 auto' }}>
        <svg
          ref={setSvgNode}
          width={width}
          height={size}
          viewBox={`0 0 ${width} ${size}`}
          role="img"
          aria-label={`Circular map of ${doc.name}, ${length} base pairs`}
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            touchAction: 'none',
            borderRadius: 18,
            boxShadow: theme === 'publication' ? 'none' : `0 18px 50px -30px ${tokens.shadow}`,
            background: tokens.background,
            cursor: drag ? 'grabbing' : 'default',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => endDrag(event)}
          onPointerCancel={(event) => endDrag(event, true)}
        >
          <defs>
            <radialGradient id={`osg-bg-${uid}`} cx="42%" cy="34%" r="76%">
              <stop offset="0%" stopColor={tokens.panel} />
              <stop offset="68%" stopColor={tokens.background} />
              <stop offset="100%" stopColor={theme === 'dark' ? '#050a13' : tokens.background} />
            </radialGradient>
            <radialGradient id={`osg-hub-${uid}`} cx="38%" cy="32%" r="80%">
              <stop offset="0%" stopColor={tokens.panel} stopOpacity="0.98" />
              <stop offset="100%" stopColor={tokens.panelAlt} stopOpacity="0.94" />
            </radialGradient>
            {featureArcs.labels.map((label) => (
              <path key={label.pathId} id={label.pathId} d={label.path} />
            ))}
          </defs>

          <rect width={width} height={size} rx={18} fill={`url(#osg-bg-${uid})`} />
          {theme === 'publication' ? (
            <rect
              x={0.75}
              y={0.75}
              width={width - 1.5}
              height={size - 1.5}
              rx={17}
              fill="none"
              stroke={tokens.border}
              strokeWidth={1.5}
            />
          ) : null}

          <circle
            cx={geometry.cx}
            cy={geometry.cy}
            r={geometry.featureInner * 0.74}
            fill={`url(#osg-hub-${uid})`}
            stroke={tokens.border}
            strokeWidth={1}
          />

          {showTicks
            ? Array.from(
                { length: Math.max(1, Math.floor(length / tickStep)) },
                (_, i) => {
                  const index = i * tickStep;
                  if (index >= length) return null;
                  const angle = -90 + (360 * index) / Math.max(1, length);
                  const major = i % 5 === 0;
                  const outer = pointOnCircle(
                    geometry.cx,
                    geometry.cy,
                    geometry.outerRadius + (major ? 7 : 4),
                    angle,
                  );
                  const inner = pointOnCircle(
                    geometry.cx,
                    geometry.cy,
                    geometry.outerRadius + 1,
                    angle,
                  );
                  return (
                    <line
                      key={`tick-${index}`}
                      x1={inner.x}
                      y1={inner.y}
                      x2={outer.x}
                      y2={outer.y}
                      stroke={major ? tokens.faint : tokens.grid}
                      strokeWidth={major ? 1.2 : 0.8}
                    />
                  );
                },
              )
            : null}

          <circle
            cx={geometry.cx}
            cy={geometry.cy}
            r={geometry.outerRadius + 1.5}
            fill="none"
            stroke={tokens.ring}
            strokeWidth={1.1}
          />
          <circle
            cx={geometry.cx}
            cy={geometry.cy}
            r={Math.max(8, geometry.featureInner - 5)}
            fill="none"
            stroke={tokens.ring}
            strokeWidth={1}
            opacity={0.7}
          />

          {selectionSegments.map((segment, index) => {
            const full = segment.end - segment.start >= length - 0.5 && length > 0;
            const inner = Math.max(4, geometry.featureInner - 8);
            const outer = geometry.outerRadius + 6;
            if (full) {
              return (
                <circle
                  key={`selection-${index}`}
                  cx={geometry.cx}
                  cy={geometry.cy}
                  r={(inner + outer) / 2}
                  fill="none"
                  stroke={tokens.selection}
                  strokeWidth={outer - inner}
                  pointerEvents="none"
                />
              );
            }
            return (
              <path
                key={`selection-${index}`}
                d={annularSectorPath(
                  geometry.cx,
                  geometry.cy,
                  inner,
                  outer,
                  segment.start,
                  segment.end,
                  length,
                )}
                fill={tokens.selection}
                stroke={tokens.selectionStroke}
                strokeWidth={0.9}
                strokeOpacity={0.55}
                pointerEvents="none"
              />
            );
          })}

          <g>
            {featureArcs.arcs.map((arc) => {
              const hovered = hoveredFeature === arc.feature.id;
              const dimmed = hoveredFeature !== null && !hovered;
              const color = arc.feature.color || tokens.accent;
              const arrow =
                arc.arrow && !arc.full
                  ? directionalArrow(
                      arc.arrow.index,
                      arc.radius,
                      Math.max(1, length),
                      arc.arrow.direction,
                      Math.max(5, geometry.bandHeight * 0.72),
                      geometry.cx,
                      geometry.cy,
                    )
                  : null;
              return (
                <g
                  key={arc.key}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => handleFeatureClick(arc.feature)}
                  onMouseEnter={() => setHoveredFeature(arc.feature.id)}
                  onMouseLeave={() => setHoveredFeature(null)}
                  style={{ cursor: onFeatureClick ? 'pointer' : 'default' }}
                >
                  {arc.piece.segmentIndex === 0 && arc.piece.pieceIndex === 0
                    ? segmentGapRanges(arc.plan, length, circular).map((gap, index) => (
                        <path
                          key={`feature-gap-${arc.feature.id}-${index}`}
                          d={describeArc(
                            geometry.cx,
                            geometry.cy,
                            arc.radius,
                            gap.start,
                            gap.end,
                            Math.max(1, length),
                          )}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.1}
                          strokeDasharray="2.5 2.5"
                          opacity={0.5}
                          pointerEvents="none"
                        />
                      ))
                    : null}
                  {arc.full ? (
                    <circle
                      cx={geometry.cx}
                      cy={geometry.cy}
                      r={arc.radius}
                      fill="none"
                      stroke={color}
                      strokeWidth={geometry.bandHeight}
                      opacity={dimmed ? 0.55 : 0.92}
                      strokeLinecap="butt"
                    />
                  ) : (
                    <path
                      d={describeArc(
                        geometry.cx,
                        geometry.cy,
                        arc.radius,
                        arc.start,
                        arc.end,
                        Math.max(1, length),
                      )}
                      fill="none"
                      stroke={color}
                      strokeWidth={geometry.bandHeight}
                      opacity={dimmed ? 0.55 : 0.92}
                      strokeLinecap="butt"
                    />
                  )}
                  {arc.full ? (
                    <circle
                      cx={geometry.cx}
                      cy={geometry.cy}
                      r={arc.radius}
                      fill="none"
                      stroke={theme === 'publication' ? '#ffffff' : '#ffffff'}
                      strokeWidth={0.55}
                      opacity={0.24}
                      pointerEvents="none"
                    />
                  ) : (
                    <path
                      d={describeArc(
                        geometry.cx,
                        geometry.cy,
                        arc.radius,
                        arc.start,
                        arc.end,
                        Math.max(1, length),
                      )}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={0.55}
                      opacity={0.24}
                      pointerEvents="none"
                    />
                  )}
                  {arrow ? (
                    <polygon
                      points={arrow.points}
                      fill={color}
                      stroke={theme === 'publication' ? tokens.text : 'transparent'}
                      strokeWidth={theme === 'publication' ? 0.4 : 0}
                    />
                  ) : null}
                  <title>
                    {`${arc.feature.name} · ${arc.feature.type}\n${arc.feature.start}–${arc.feature.end} · ${arc.feature.strand === -1 ? 'reverse' : arc.feature.strand === 1 ? 'forward' : 'no strand'}`}
                  </title>
                </g>
              );
            })}
          </g>

          {featureArcs.labels.map((label) => (
            <text
              key={label.pathId}
              fill={contrastText(label.feature.color || tokens.accent)}
              fontSize={label.fontSize}
              fontWeight={600}
              letterSpacing="0.02em"
              pointerEvents="none"
              style={{ paintOrder: 'stroke' }}
            >
              <textPath href={`#${label.pathId}`} startOffset="50%" textAnchor="middle">
                {label.feature.name}
              </textPath>
            </text>
          ))}

          {primerVisible
            ? doc.primers.map((primer) => {
                const segments = splitRange(
                  primer.bindingStart,
                  primer.bindingEnd,
                  length,
                  circular,
                );
                return segments.map((segment, index) => {
                  const arrowIndex = primer.strand === 1 ? segment.end : segment.start;
                  const arrow = directionalArrow(
                    arrowIndex,
                    geometry.primerRadius,
                    Math.max(1, length),
                    primer.strand,
                    Math.max(5, size * 0.012),
                    geometry.cx,
                    geometry.cy,
                  );
                  return (
                    <g key={`primer-${primer.id}-${index}`} pointerEvents="none">
                      <path
                        d={describeArc(
                          geometry.cx,
                          geometry.cy,
                          geometry.primerRadius,
                          segment.start,
                          segment.end,
                          Math.max(1, length),
                        )}
                        fill="none"
                        stroke={tokens.accent}
                        strokeWidth={Math.max(2.5, size * 0.005)}
                        strokeLinecap="round"
                        opacity={0.88}
                      />
                      <polygon points={arrow.points} fill={tokens.accent} />
                    </g>
                  );
                });
              })
            : null}

          {primerVisible
            ? doc.primers.flatMap((primer) => {
                const tailLength = primer.tailSequence.length;
                if (tailLength <= 0) return [];
                const tailStart =
                  primer.strand === 1 ? primer.bindingStart - tailLength : primer.bindingEnd;
                const tailEnd =
                  primer.strand === 1 ? primer.bindingStart : primer.bindingEnd + tailLength;
                return splitRange(tailStart, tailEnd, length, circular).map((segment, index) => (
                  <path
                    key={`primer-tail-${primer.id}-${index}`}
                    d={describeArc(
                      geometry.cx,
                      geometry.cy,
                      geometry.primerRadius + size * 0.012,
                      segment.start,
                      segment.end,
                      Math.max(1, length),
                    )}
                    fill="none"
                    stroke={tokens.accent}
                    strokeWidth={1.1}
                    strokeDasharray="2.5 2.5"
                    opacity={0.55}
                    pointerEvents="none"
                  />
                ));
              })
            : null}

          {showOrfs ? (
            <g pointerEvents="none">
              {orfs.map((orf) => {
                const radius = Math.max(
                  10,
                  geometry.primerRadius - Math.max(9, size * 0.026),
                );
                return splitRange(orf.start, orf.end, length, circular).map(
                  (segment, index) => {
                    const arrowIndex =
                      orf.strand === 1 ? segment.end : segment.start;
                    const arrow = directionalArrow(
                      arrowIndex,
                      radius,
                      Math.max(1, length),
                      orf.strand,
                      Math.max(4, size * 0.011),
                      geometry.cx,
                      geometry.cy,
                    );
                    return (
                      <g key={`orf-${orf.id}-${index}`}>
                        <path
                          d={describeArc(
                            geometry.cx,
                            geometry.cy,
                            radius,
                            segment.start,
                            segment.end,
                            Math.max(1, length),
                          )}
                          fill="none"
                          stroke={tokens.enzymeMulti}
                          strokeWidth={2}
                          strokeDasharray="4 2"
                          opacity={0.55}
                        />
                        <polygon points={arrow.points} fill={tokens.enzymeMulti} opacity={0.7} />
                        <title>
                          {`ORF ${orf.id} · frame ${orf.frame}\n${orf.lengthBp} bp · ${trimNumber(orf.mwKda, 1)} kDa · pI ${trimNumber(orf.pI, 2)}`}
                        </title>
                      </g>
                    );
                  },
                );
              })}
            </g>
          ) : null}

          {activeCutSites.map((cut) => {
            const angle = -90 + (360 * mod(cut.position, Math.max(1, length))) / Math.max(1, length);
            const blocked = cut.isMethylationBlocked;
            const single = cut.totalCutsInPlasmid === 1;
            const color = blocked
              ? tokens.blocked
              : single
                ? tokens.enzymeSingle
                : tokens.enzymeMulti;
            const p0 = pointOnCircle(
              geometry.cx,
              geometry.cy,
              geometry.outerRadius + 2,
              angle,
            );
            const p1 = pointOnCircle(
              geometry.cx,
              geometry.cy,
              geometry.outerRadius + (single ? 11 : 8),
              angle,
            );
            return (
              <line
                key={`cut-tick-${cut.id}`}
                x1={p0.x}
                y1={p0.y}
                x2={p1.x}
                y2={p1.y}
                stroke={color}
                strokeWidth={single ? 2 : 1.1}
                strokeDasharray={blocked ? '2 2' : undefined}
                opacity={blocked ? 0.7 : 0.95}
                pointerEvents="none"
              />
            );
          })}

          {leaderLayout.map((label) => {
            const isPrimer = label.item.kind === 'primer';
            const blocked = label.item.kind === 'enzyme' && label.item.blocked;
            const stroke = blocked
              ? tokens.blocked
              : isPrimer
                ? tokens.accent
                : label.emphasis
                  ? tokens.enzymeSingle
                  : tokens.enzymeMulti;
            const title =
              label.item.kind === 'enzyme'
                ? `${label.item.enzymeName} · recognition at ${label.item.position + 1}\nOverhang: ${label.item.overhangType} ${label.item.overhangSeq || '—'}\nTotal cuts: ${label.item.totalCuts}`
                : `${label.item.primerId}\nTm ${label.item.tm.toFixed(1)} °C · tail ${label.item.tailLength} nt`;
            const labelScale = resolvedDisplay
              ? resolvedDisplay.labelFontSize / 11
              : 1;
            const fontSize = (label.emphasis ? 10.6 : 10) * labelScale;
            const available =
              label.side === 'right' ? width - label.textX - 8 : label.textX - 8;
            const maxChars = Math.max(5, Math.floor(available / (fontSize * 0.58)));
            const displayText = truncate(label.item.text, maxChars);
            return (
              <g key={label.item.id} className="osg-leader" opacity={blocked ? 0.72 : 1}>
                <polyline
                  points={`${label.anchor.x.toFixed(2)},${label.anchor.y.toFixed(2)} ${label.elbow.x.toFixed(2)},${label.elbow.y.toFixed(2)} ${label.textX.toFixed(2)},${label.textY.toFixed(2)}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={label.emphasis ? 1.15 : 0.9}
                  strokeOpacity={blocked ? 0.45 : 0.55}
                  strokeLinejoin="round"
                />
                <circle
                  cx={label.anchor.x}
                  cy={label.anchor.y}
                  r={label.emphasis ? 2.4 : 1.9}
                  fill={stroke}
                  fillOpacity={blocked ? 0.6 : 0.95}
                />
                <text
                  x={label.textX + (label.side === 'right' ? 4 : -4)}
                  y={label.textY + 3.4}
                  textAnchor={label.textAnchor}
                  fill={stroke}
                  fontSize={fontSize}
                  fontWeight={label.emphasis ? 700 : 500}
                  fontFamily={isPrimer ? tokens.fontMono : tokens.fontSans}
                  letterSpacing="0.01em"
                  style={{ paintOrder: 'stroke' }}
                  stroke={tokens.background}
                  strokeWidth={3}
                  strokeOpacity={0.82}
                >
                  {displayText}
                </text>
                <title>{title}</title>
              </g>
            );
          })}

          {resolvedDisplay?.showGcPlot && gcSamples.length > 0 ? (
            (() => {
              const baseRadius = geometry.featureInner * 0.55;
              const amplitude = geometry.featureInner * 0.16;
              const points = gcSamples
                .filter((sample) => sample.gc !== null)
                .map((sample) => {
                  const angle = -90 + (360 * sample.position) / Math.max(1, length);
                  const point = pointOnCircle(
                    geometry.cx,
                    geometry.cy,
                    baseRadius + (sample.gc ?? 0) * amplitude,
                    angle,
                  );
                  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
                })
                .join(' ');
              return (
                <g pointerEvents="none">
                  <circle
                    cx={geometry.cx}
                    cy={geometry.cy}
                    r={baseRadius}
                    fill="none"
                    stroke={tokens.faint}
                    strokeWidth={0.7}
                    strokeDasharray="2 3"
                    opacity={0.7}
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke={tokens.accent}
                    strokeWidth={1.3}
                    strokeLinejoin="round"
                    opacity={0.82}
                  />
                  <title>GC content, sliding window</title>
                </g>
              );
            })()
          ) : null}

          <g pointerEvents="none">
            <text
              x={geometry.cx}
              y={geometry.cy - 18}
              textAnchor="middle"
              fill={tokens.text}
              fontFamily={tokens.fontSans}
              fontSize={centerFontSize}
              fontWeight={700}
              letterSpacing="-0.015em"
            >
              {truncate(centerTitle, centerNameChars)}
            </text>
            {centerShowLength ? (
              <text
                x={geometry.cx}
                y={geometry.cy + 4}
                textAnchor="middle"
                fill={tokens.muted}
                fontFamily={tokens.fontMono}
                fontSize={Math.max(9.5, Math.min(12.5, centerFontSize * 0.82))}
                letterSpacing="0.02em"
              >
                {formatBp(length)} bp
              </text>
            ) : null}
            <line
              x1={geometry.cx - 42}
              y1={geometry.cy + 15}
              x2={geometry.cx + 42}
              y2={geometry.cy + 15}
              stroke={tokens.border}
              strokeWidth={1}
            />
            <text
              x={geometry.cx}
              y={geometry.cy + 32}
              textAnchor="middle"
              fill={tokens.muted}
              fontFamily={tokens.fontSans}
              fontSize={10.5}
            >
              {selectedBp > 0
                ? t('已选 {v0} bp', { v0: formatBp(selectedBp) })
                : t('{v0} 个切点 · {v1} 条引物', { v0: stats.cuts, v1: stats.primers })}
            </text>
            <text
              x={geometry.cx}
              y={geometry.cy + 48}
              textAnchor="middle"
              fill={tokens.faint}
              fontFamily={tokens.fontSans}
              fontSize={9.5}
              letterSpacing="0.08em"
            >
              {t(circular ? '环状' : '线性')}
            </text>
          </g>

          <g pointerEvents="none">
            <path
              d={describeArc(
                geometry.cx,
                geometry.cy,
                geometry.outerRadius + 18,
                0.002,
                0.028,
                Math.max(1, length),
              )}
              fill="none"
              stroke={tokens.faint}
              strokeWidth={1}
            />
            <polygon
              points={directionalArrow(
                mod(length * 0.028, length),
                geometry.outerRadius + 18,
                Math.max(1, length),
                1,
                5,
                geometry.cx,
                geometry.cy,
              ).points}
              fill={tokens.faint}
            />
          </g>

          {dragBubble ? (
            <g transform={`translate(${dragBubble.x} ${dragBubble.y})`} pointerEvents="none">
              <rect
                width={dragBubble.width}
                height={dragBubble.height}
                rx={9}
                fill={tokens.tooltipBackground}
                stroke={tokens.border}
                strokeOpacity={0.4}
                opacity={0.97}
              />
              <text
                x={12}
                y={19}
                fill={tokens.tooltipText}
                fontFamily={tokens.fontMono}
                fontSize={12}
                fontWeight={700}
              >
                {formatBp(dragBubble.bp)} bp
              </text>
              <text
                x={dragBubble.width - 12}
                y={19}
                textAnchor="end"
                fill={tokens.tooltipText}
                fontFamily={tokens.fontSans}
                fontSize={10.5}
                opacity={0.72}
              >
                {trimNumber(dragBubble.angle, 1)}°
              </text>
              <text
                x={12}
                y={38}
                fill={tokens.tooltipText}
                fontFamily={tokens.fontMono}
                fontSize={10}
                opacity={0.78}
              >
                {dragBubble.label}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          fontSize: 10.5,
          color: tokens.muted,
          padding: '0 4px',
        }}
      >
        <span>{t('在环上拖动可选择区段，点击特征查看详情。')}</span>
        <span style={{ fontFamily: tokens.fontMono }}>
          {t('{v0} 个切点 · {v1} 条引物 · {v2} 个特征', { v0: stats.cuts, v1: stats.primers, v2: stats.features })}
        </span>
      </div>
    </div>
  );
}

function toolbarButton(tokens: ReturnType<typeof getTheme>): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11.5,
    fontWeight: 600,
    color: tokens.text,
    background: tokens.panel,
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    padding: '6px 10px',
    cursor: 'pointer',
    boxShadow: tokens.mode === 'publication' ? 'none' : `0 1px 2px ${tokens.shadow}`,
  };
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1))}…`;
}

