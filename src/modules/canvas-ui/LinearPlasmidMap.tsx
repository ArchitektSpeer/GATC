// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Dna } from 'lucide-react';
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
  clamp,
  contrastText,
  formatBp,
  hexToRgba,
  splitRange,
  trimNumber,
} from './utils';
import {
  isFeatureVisible,
  resolveMapDisplayOptions,
  type MapDisplayOptions,
} from './mapDisplayOptions';
import {
  assignSegmentTracks,
  segmentGapRanges,
  type FeaturePiece,
  type FeatureSegmentPlan,
  type FeatureTrackEntry,
} from './segments';
import {
  buildCutMarkerItems,
  computeGcProfile,
  computeLinearMapLayout,
  layoutLinearLabels,
  layoutOrfTracks,
  layoutRulerTicks,
  type CutMarkerItem,
  type LinearMapLayout,
} from './layout/linearMapLayout';

export interface LinearPlasmidMapProps {
  doc: PlasmidDocument;
  cutSites: CutSite[];
  orfs?: ORF[];
  selection: SelectionRange | null;
  onSelectionChange: (s: SelectionRange | null) => void;
  onFeatureClick?: (f: SequenceFeature) => void;
  displayOptions?: MapDisplayOptions;
  theme?: VizTheme;
  width?: number;
  svgRef?: React.Ref<SVGSVGElement>;
}

interface DragState {
  anchor: number;
  current: number;
  pointerId: number;
  moved: boolean;
}

const MIN_WIDTH = 420;
const DEFAULT_WIDTH = 960;

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function truncateText(text: string, limit: number): string {
  if (limit <= 1) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1))}…`;
}

function arrowPoints(
  x1: number,
  x2: number,
  y: number,
  height: number,
  direction: 1 | -1,
): string {
  const tip = direction === 1 ? x2 : x1;
  const base = tip - direction * Math.min(7, Math.max(2.5, Math.abs(x2 - x1)));
  return `${base},${y - height / 2} ${tip},${y} ${base},${y + height / 2}`;
}

export function LinearPlasmidMap({
  doc,
  cutSites,
  orfs = [],
  selection,
  onSelectionChange,
  onFeatureClick,
  displayOptions,
  theme = 'light',
  width: requestedWidth = DEFAULT_WIDTH,
  svgRef,
}: LinearPlasmidMapProps) {
  const tokens = getTheme(theme);
  const rawUid = useId();
  const uid = safeId(rawUid);
  const svgNodeRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoveredFeature, setHoveredFeature] = useState<string | null>(null);

  const resolved = useMemo(() => resolveMapDisplayOptions(displayOptions), [displayOptions]);
  const width = Math.max(MIN_WIDTH, requestedWidth);
  const sequence = doc.sequence.toUpperCase();
  const length = doc.length || sequence.length;
  const circular = doc.topology === 'circular';

  const setSvgNode = useCallback(
    (node: SVGSVGElement | null) => {
      svgNodeRef.current = node;
      if (typeof svgRef === 'function') svgRef(node);
      else if (svgRef) (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = node;
    },
    [svgRef],
  );

  const visibleFeatures = useMemo(
    () => doc.features.filter((feature) => isFeatureVisible(feature, resolved)),
    [doc.features, resolved],
  );
  const plusTracks = useMemo(
    () =>
      assignSegmentTracks(
        visibleFeatures.filter((feature) => feature.strand !== -1),
        length,
        circular,
      ),
    [visibleFeatures, length, circular],
  );
  const minusTracks = useMemo(
    () =>
      assignSegmentTracks(
        visibleFeatures.filter((feature) => feature.strand === -1),
        length,
        circular,
      ),
    [visibleFeatures, length, circular],
  );
  const orfTracks = useMemo(
    () =>
      resolved.showOrfs && orfs.length > 0
        ? layoutOrfTracks(orfs, length, circular)
        : { entries: [], trackCount: 0 },
    [resolved.showOrfs, orfs, length, circular],
  );

  const plotWidthGuess = Math.max(60, width - 60);
  const cutItems = useMemo(
    () => (resolved.showEnzymes ? buildCutMarkerItems(cutSites) : []),
    [cutSites, resolved.showEnzymes],
  );
  const enzymeLabels = useMemo(() => {
    if (!resolved.showEnzymeLabels || cutItems.length === 0) {
      return { placements: [], rowCount: 0, hidden: [] };
    }
    return layoutLinearLabels(
      cutItems.map((item) => ({ id: item.id, position: item.position, text: item.text })),
      {
        length: Math.max(1, length),
        plotWidth: plotWidthGuess,
        fontSize: resolved.labelFontSize,
        gap: Math.max(6, resolved.labelFontSize * 0.6),
        maxRows: 4,
      },
    );
  }, [cutItems, resolved.showEnzymeLabels, resolved.labelFontSize, length, plotWidthGuess]);

  const showPrimers = resolved.showPrimers;
  const layout = useMemo(
    () =>
      computeLinearMapLayout({
        width,
        plusTracks: plusTracks.lanes.length,
        minusTracks: minusTracks.lanes.length,
        orfTracks: orfTracks.trackCount,
        labelRows: enzymeLabels.rowCount,
        showPrimers: showPrimers && doc.primers.length > 0,
        showGcPlot: resolved.showGcPlot,
        hasTitle: true,
        labelFontSize: resolved.labelFontSize,
      }),
    [
      width,
      plusTracks.lanes.length,
      minusTracks.lanes.length,
      orfTracks.trackCount,
      enzymeLabels.rowCount,
      showPrimers,
      doc.primers.length,
      resolved.showGcPlot,
      resolved.labelFontSize,
    ],
  );

  const plotRight = layout.plotLeft + layout.plotWidth;
  const xFor = useCallback(
    (position: number): number => {
      if (length <= 0) return layout.plotLeft;
      return layout.plotLeft + (clamp(position, 0, length) / length) * layout.plotWidth;
    },
    [layout.plotLeft, layout.plotWidth, length],
  );

  const ticks = useMemo(
    () =>
      layoutRulerTicks(
        length,
        resolved.tickInterval,
        Math.max(4, Math.floor(layout.plotWidth / 92)),
      ),
    [length, resolved.tickInterval, layout.plotWidth],
  );
  const gcSamples = useMemo(
    () =>
      resolved.showGcPlot
        ? computeGcProfile(sequence, {
            circular,
            maxSamples: 360,
            windowSize: Math.max(10, Math.round(length / 40)),
          })
        : [],
    [resolved.showGcPlot, sequence, circular, length],
  );

  const liveSelection = useMemo<SelectionRange | null>(() => {
    if (drag) {
      const start = Math.min(drag.anchor, drag.current);
      const end = Math.max(drag.anchor, drag.current) + 1;
      return { start, end: Math.min(length, end) };
    }
    return selection;
  }, [drag, selection, length]);

  const selectionSegments = useMemo(
    () =>
      liveSelection && length > 0
        ? splitRange(liveSelection.start, liveSelection.end, length, circular)
        : [],
    [liveSelection, length, circular],
  );

  const selectionLength = selectionSegments.reduce(
    (sum, segment) => sum + (segment.end - segment.start),
    0,
  );

  const pointerToIndex = useCallback(
    (clientX: number, svg: SVGSVGElement): number | null => {
      const rect = svg.getBoundingClientRect();
      const renderedWidth = rect.width > 0 ? rect.width : svg.clientWidth || width;
      if (renderedWidth <= 0) return null;
      const localX = ((clientX - rect.left) / renderedWidth) * width;
      if (localX < layout.plotLeft - 1 || localX > plotRight + 1) return null;
      const fraction = clamp((localX - layout.plotLeft) / layout.plotWidth, 0, 1);
      return clamp(Math.round(fraction * length), 0, Math.max(0, length - 1));
    },
    [width, layout.plotLeft, layout.plotWidth, plotRight, length],
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent<SVGSVGElement>, cancelled = false) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDrag(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* Pointer capture is unavailable in some embedded browsers. */
      }
      if (cancelled) return;
      if (!current.moved) {
        onSelectionChange(null);
      } else {
        const start = Math.min(current.anchor, current.current);
        const end = Math.min(length, Math.max(current.anchor, current.current) + 1);
        onSelectionChange({ start, end });
      }
    },
    [length, onSelectionChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (length <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.height > 0) {
        const localY = ((event.clientY - rect.top) / rect.height) * layout.height;
        if (
          localY < layout.enzymeLabelTop - 6 ||
          localY > layout.featureBottom + 8
        ) {
          return;
        }
      }
      const index = pointerToIndex(event.clientX, event.currentTarget);
      if (index === null) return;
      event.preventDefault();
      const next: DragState = {
        anchor: index,
        current: index,
        pointerId: event.pointerId,
        moved: false,
      };
      dragRef.current = next;
      setDrag(next);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Optional. */
      }
    },
    [
      length,
      pointerToIndex,
      layout.height,
      layout.enzymeLabelTop,
      layout.featureBottom,
    ],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const index = pointerToIndex(event.clientX, event.currentTarget);
      if (index === null) return;
      const moved = current.moved || index !== current.anchor;
      const next: DragState = { ...current, current: index, moved };
      dragRef.current = next;
      setDrag(next);
      if (moved) {
        onSelectionChange({
          start: Math.min(next.anchor, index),
          end: Math.min(length, Math.max(next.anchor, index) + 1),
        });
      }
    },
    [length, pointerToIndex, onSelectionChange],
  );

  const title = resolved.title.trim() || doc.name || 'Untitled sequence';
  const subtitleParts: string[] = [];
  if (resolved.showLength) subtitleParts.push(`${formatBp(length)} bp`);
  subtitleParts.push(doc.topology);
  if (resolved.showFeatures) subtitleParts.push(`${visibleFeatures.length} features`);
  if (cutItems.length > 0) subtitleParts.push(`${cutSites.length} 个切点`);

  const css = `
    .osg-linear-map text { user-select: none; }
    .osg-linear-map .osg-map-feature { transition: opacity 120ms ease; }
  `;

  const renderFeatureLane = (
    lanes: FeatureTrackEntry[][],
    side: 'plus' | 'minus',
  ): React.ReactNode =>
    lanes.map((entries, lane) => {
      const y =
        side === 'plus'
          ? layout.plusBottom - (lane + 0.5) * layout.laneHeight
          : layout.minusTop + (lane + 0.5) * layout.laneHeight;
      return entries.map((entry) => {
        const { feature, plan } = entry;
        const color = feature.color || tokens.accent;
        const hovered = hoveredFeature === feature.id;
        const dimmed = hoveredFeature !== null && !hovered;
        const band = Math.max(6, layout.bandHeight - 1);
        const gaps = segmentGapRanges(plan, length, circular);
        const label = resolved.showFeatureLabels ? feature.name : '';
        return (
          <g
            key={`${side}-${feature.id}`}
            className="osg-map-feature"
            opacity={dimmed ? 0.5 : 1}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onFeatureClick?.(feature)}
            onMouseEnter={() => setHoveredFeature(feature.id)}
            onMouseLeave={() => setHoveredFeature(null)}
            style={{ cursor: onFeatureClick ? 'pointer' : 'default' }}
          >
            <title>
              {`${feature.name} · ${feature.type}\n${feature.start}–${feature.end} · ${
                feature.strand === -1 ? 'reverse' : feature.strand === 1 ? 'forward' : 'no strand'
              }${plan.multi ? `\n${plan.segments.length} segments` : ''}`}
            </title>
            {gaps.map((gap, index) => (
              <line
                key={`gap-${index}`}
                x1={xFor(gap.start)}
                y1={y}
                x2={xFor(gap.end)}
                y2={y}
                stroke={color}
                strokeWidth={1}
                strokeDasharray="2.5 2.5"
                opacity={0.55}
                pointerEvents="none"
              />
            ))}
            {plan.pieces.map((piece: FeaturePiece, index: number) => {
              const x1 = xFor(piece.start);
              const x2 = xFor(piece.end);
              const pieceWidth = Math.max(0.8, x2 - x1);
              const labelLimit = Math.floor((pieceWidth - 5) / (Math.max(7, resolved.labelFontSize - 2) * 0.58));
              const shownLabel = labelLimit > 1 ? truncateText(label, labelLimit) : '';
              return (
                <g key={`piece-${index}`}>
                  <rect
                    x={x1}
                    y={y - band / 2}
                    width={pieceWidth}
                    height={band}
                    rx={Math.min(3, pieceWidth / 2)}
                    fill={hexToRgba(color, theme === 'publication' ? 0.18 : 0.26)}
                    stroke={color}
                    strokeWidth={1}
                  />
                  {shownLabel ? (
                    <text
                      x={x1 + 3}
                      y={y + 3.2}
                      fill={contrastText(color)}
                      fontSize={Math.max(7, resolved.labelFontSize - 2)}
                      fontWeight={600}
                      pointerEvents="none"
                      opacity={0.92}
                    >
                      {shownLabel}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {plan.arrowIndex !== null ? (
              <polygon
                points={arrowPoints(
                  xFor(plan.arrowIndex) - plan.arrowDirection * 7,
                  xFor(plan.arrowIndex),
                  y,
                  band,
                  plan.arrowDirection === 1 ? 1 : -1,
                )}
                fill={color}
                pointerEvents="none"
              />
            ) : null}
          </g>
        );
      });
    });

  const gcBaseY = layout.gcBottom - 10;
  const gcHeight = Math.max(8, layout.gcBottom - layout.gcTop - 20);
  const gcPath = (() => {
    if (!resolved.showGcPlot || gcSamples.length === 0) return '';
    let started = false;
    let path = '';
    for (const sample of gcSamples) {
      if (sample.gc === null) continue;
      const x = xFor(sample.position);
      const y = gcBaseY - sample.gc * gcHeight;
      path += `${started ? ' L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      started = true;
    }
    return path;
  })();

  return (
    <div
      className="osg-linear-map"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        color: tokens.text,
        fontFamily: tokens.fontSans,
      }}
    >
      <style>{css}</style>
      <svg
        ref={setSvgNode}
        width={width}
        height={layout.height}
        viewBox={`0 0 ${width} ${layout.height}`}
        role="img"
        aria-label={`Linear map of ${doc.name}, ${length} base pairs`}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          touchAction: 'none',
          borderRadius: 14,
          background: tokens.background,
          boxShadow: theme === 'publication' ? 'none' : `0 16px 40px -32px ${tokens.shadow}`,
          cursor: drag ? 'crosshair' : 'default',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishDrag(event)}
        onPointerCancel={(event) => finishDrag(event, true)}
      >
        <defs>
          <clipPath id={`osg-lin-clip-${uid}`}>
            <rect
              x={layout.plotLeft}
              y={layout.enzymeLabelTop - 2}
              width={layout.plotWidth}
              height={Math.max(10, layout.featureBottom - layout.enzymeLabelTop + 4)}
            />
          </clipPath>
        </defs>
        <rect width={width} height={layout.height} fill={tokens.background} />
        {theme === 'publication' ? (
          <rect
            x={0.75}
            y={0.75}
            width={width - 1.5}
            height={layout.height - 1.5}
            rx={13}
            fill="none"
            stroke={tokens.border}
            strokeWidth={1.5}
          />
        ) : null}

        <text
          x={layout.marginLeft}
          y={layout.titleBaseline}
          fill={tokens.text}
          fontSize={14}
          fontWeight={700}
          letterSpacing="-0.01em"
        >
          {truncateText(title, Math.max(8, Math.floor((width - 60) / 7.8)))}
        </text>
        <text
          x={width - layout.marginRight}
          y={layout.titleBaseline}
          textAnchor="end"
          fill={tokens.muted}
          fontSize={10.5}
          fontFamily={tokens.fontMono}
        >
          {subtitleParts.join(' · ')}
        </text>

        {selectionSegments.map((segment, index) => (
          <rect
            key={`selection-${index}`}
            x={xFor(segment.start)}
            y={layout.featureTop - 4}
            width={Math.max(1, xFor(segment.end) - xFor(segment.start))}
            height={Math.max(8, layout.featureBottom - layout.featureTop + 8)}
            fill={tokens.selection}
            stroke={tokens.selectionStroke}
            strokeOpacity={0.4}
            strokeWidth={0.8}
            pointerEvents="none"
          />
        ))}

        {renderFeatureLane(plusTracks.lanes, 'plus')}
        {renderFeatureLane(minusTracks.lanes, 'minus')}

        {showPrimers
          ? doc.primers.flatMap((primer) => {
              const segments = splitRange(
                primer.bindingStart,
                primer.bindingEnd,
                length,
                circular,
              );
              const tailLength = primer.tailSequence.length;
              return segments.map((segment, index) => {
                const y = layout.primerTop + layout.primerHeight / 2;
                const x1 = xFor(segment.start);
                const x2 = xFor(segment.end);
                const tipX = primer.strand === 1 ? x2 : x1;
                const tailStart =
                  primer.strand === 1 ? segment.start - tailLength : segment.end;
                const tailEnd =
                  primer.strand === 1 ? segment.start : segment.end + tailLength;
                return (
                  <g key={`primer-${primer.id}-${index}`} pointerEvents="none">
                    {tailLength > 0 ? (
                      <line
                        x1={xFor(tailStart)}
                        y1={y - 4}
                        x2={xFor(tailEnd)}
                        y2={y - 4}
                        stroke={tokens.accent}
                        strokeWidth={1}
                        strokeDasharray="2 2"
                        opacity={0.55}
                      />
                    ) : null}
                    <line
                      x1={x1}
                      y1={y}
                      x2={x2}
                      y2={y}
                      stroke={tokens.accent}
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      opacity={0.9}
                    />
                    <polygon
                      points={`${tipX},${y} ${tipX - primer.strand * 5},${y - 2.6} ${tipX - primer.strand * 5},${y + 2.6}`}
                      fill={tokens.accent}
                    />
                    <title>
                      {`${primer.name} · Tm ${trimNumber(primer.tmAnnealing, 1)} °C\nBinding ${primer.bindingStart + 1}–${primer.bindingEnd}`}
                    </title>
                  </g>
                );
              });
            })
          : null}

        {orfTracks.entries.map((entry) => {
          const y =
            layout.orfTop + (entry.track + 0.5) * layout.orfLaneHeight;
          const color = entry.orf.strand === -1 ? tokens.strandMinus : tokens.accent;
          return entry.segments.map((segment, index) => {
            const x1 = xFor(segment.start);
            const x2 = xFor(segment.end);
            const tip = entry.orf.strand === -1 ? x1 : x2;
            return (
              <g key={`orf-${entry.orf.id}-${index}`} pointerEvents="none">
                <rect
                  x={x1}
                  y={y - 4}
                  width={Math.max(1, x2 - x1)}
                  height={8}
                  rx={2}
                  fill={hexToRgba(color, 0.16)}
                  stroke={color}
                  strokeWidth={0.8}
                />
                <polygon
                  points={`${tip},${y} ${tip - entry.orf.strand * 5},${y - 3.4} ${tip - entry.orf.strand * 5},${y + 3.4}`}
                  fill={color}
                />
                <title>
                  {`ORF ${entry.orf.id} · frame ${entry.orf.frame}\n${entry.orf.lengthBp} bp · ${trimNumber(entry.orf.mwKda, 1)} kDa · pI ${trimNumber(entry.orf.pI, 2)}`}
                </title>
              </g>
            );
          });
        })}

        <g clipPath={`url(#osg-lin-clip-${uid})`} pointerEvents="none">
          {cutItems.map((item: CutMarkerItem) => {
            const x = xFor(item.position);
            const color = item.blocked
              ? tokens.blocked
              : item.single
                ? tokens.enzymeSingle
                : tokens.enzymeMulti;
            return (
              <line
                key={`cut-line-${item.id}`}
                x1={x}
                y1={layout.enzymeLabelTop}
                x2={x}
                y2={layout.minusBottom}
                stroke={color}
                strokeWidth={item.single ? 1.3 : 0.9}
                strokeDasharray={item.blocked ? '2 2' : undefined}
                opacity={item.blocked ? 0.5 : 0.42}
              />
            );
          })}
        </g>

        <line
          x1={layout.plotLeft}
          y1={layout.rulerY}
          x2={plotRight}
          y2={layout.rulerY}
          stroke={tokens.ring}
          strokeWidth={1.1}
        />
        {resolved.showTicks
          ? ticks.map((tick) => {
              const x = xFor(tick.position);
              return (
                <g key={`tick-${tick.position}`} pointerEvents="none">
                  <line
                    x1={x}
                    y1={layout.rulerY - (tick.major ? 5 : 3)}
                    x2={x}
                    y2={layout.rulerY + (tick.major ? 5 : 3)}
                    stroke={tick.major ? tokens.faint : tokens.grid}
                    strokeWidth={tick.major ? 1 : 0.7}
                  />
                  {tick.label ? (
                    <text
                      x={x}
                      y={layout.rulerY - 8}
                      textAnchor="middle"
                      fill={tokens.muted}
                      fontSize={Math.max(7.5, Math.min(9.5, resolved.labelFontSize - 2))}
                      fontFamily={tokens.fontMono}
                    >
                      {tick.label}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}

        {resolved.showEnzymeLabels
          ? enzymeLabels.placements.map((placement) => {
              const item = cutItems.find((candidate) => candidate.id === placement.id);
              const blocked = item?.blocked ?? false;
              const color = blocked
                ? tokens.blocked
                : item?.single
                  ? tokens.enzymeSingle
                  : tokens.enzymeMulti;
              return (
                <text
                  key={`cut-label-${placement.id}`}
                  x={layout.plotLeft + placement.x}
                  y={layout.enzymeLabelTop + placement.row * layout.enzymeRowHeight + layout.enzymeRowHeight - 3}
                  textAnchor="middle"
                  fill={color}
                  fontSize={resolved.labelFontSize}
                  fontWeight={item?.single && !blocked ? 700 : 500}
                  fontFamily={tokens.fontSans}
                  opacity={blocked ? 0.7 : 1}
                  pointerEvents="none"
                >
                  {placement.text}
                </text>
              );
            })
          : null}

        {resolved.showLinearEnds && doc.topology === 'linear'
          ? renderLinearEnds()
          : null}

        {resolved.showGcPlot ? (
          <g pointerEvents="none">
            <rect
              x={layout.plotLeft}
              y={layout.gcTop}
              width={layout.plotWidth}
              height={layout.gcBottom - layout.gcTop}
              fill={theme === 'publication' ? 'none' : tokens.panelAlt}
              opacity={theme === 'publication' ? 1 : 0.45}
              rx={4}
            />
            <line
              x1={layout.plotLeft}
              y1={gcBaseY}
              x2={plotRight}
              y2={gcBaseY}
              stroke={tokens.grid}
              strokeWidth={0.8}
            />
            <line
              x1={layout.plotLeft}
              y1={gcBaseY - gcHeight * 0.5}
              x2={plotRight}
              y2={gcBaseY - gcHeight * 0.5}
              stroke={tokens.grid}
              strokeWidth={0.6}
              strokeDasharray="3 3"
            />
            {gcPath ? (
              <path
                d={gcPath}
                fill="none"
                stroke={tokens.accent}
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
            ) : null}
            <text
              x={layout.plotLeft - 6}
              y={layout.gcTop + 12}
              textAnchor="end"
              fill={tokens.muted}
              fontSize={8.5}
            >
              GC
            </text>
            <text
              x={layout.plotLeft - 6}
              y={gcBaseY + 3}
              textAnchor="end"
              fill={tokens.faint}
              fontSize={7.5}
            >
              0%
            </text>
            <text
              x={layout.plotLeft - 6}
              y={gcBaseY - gcHeight + 3}
              textAnchor="end"
              fill={tokens.faint}
              fontSize={7.5}
            >
              100%
            </text>
          </g>
        ) : null}

        <text
          x={layout.marginLeft}
          y={layout.height - 7}
          fill={tokens.muted}
          fontSize={9.5}
        >
          Drag to select · click a feature to inspect
        </text>
        <text
          x={width - layout.marginRight}
          y={layout.height - 7}
          textAnchor="end"
          fill={tokens.muted}
          fontSize={9.5}
          fontFamily={tokens.fontMono}
        >
          {selectionLength > 0
            ? `${formatBp(selectionLength)} bp selected`
            : `${formatBp(length)} bp`}
        </text>
      </svg>
    </div>
  );

  function renderLinearEnds(): React.ReactNode {
    const ends = doc.linearEnds;
    const y = layout.rulerY;
    const overhangLeft = ends?.left;
    const overhangRight = ends?.right;
    const leftLabel = overhangLeft
      ? `${overhangLeft.type === '5-prime' ? "5'" : overhangLeft.type === '3-prime' ? "3'" : 'blunt'}${overhangLeft.sequence ? ` ${overhangLeft.sequence.slice(0, 8)}` : ''}`
      : '';
    const rightLabel = overhangRight
      ? `${overhangRight.type === '5-prime' ? "5'" : overhangRight.type === '3-prime' ? "3'" : 'blunt'}${overhangRight.sequence ? ` ${overhangRight.sequence.slice(0, 8)}` : ''}`
      : '';
    return (
      <g pointerEvents="none">
        <path
          d={`M ${layout.plotLeft} ${y - 8} L ${layout.plotLeft - 6} ${y} L ${layout.plotLeft} ${y + 8}`}
          fill="none"
          stroke={tokens.faint}
          strokeWidth={1.2}
        />
        <path
          d={`M ${plotRight} ${y - 8} L ${plotRight + 6} ${y} L ${plotRight} ${y + 8}`}
          fill="none"
          stroke={tokens.faint}
          strokeWidth={1.2}
        />
        {leftLabel ? (
          <text
            x={layout.plotLeft + 2}
            y={layout.rulerY + 15}
            fill={tokens.faint}
            fontSize={8}
            fontFamily={tokens.fontMono}
          >
            {leftLabel}
          </text>
        ) : null}
        {rightLabel ? (
          <text
            x={plotRight - 2}
            y={layout.rulerY + 15}
            textAnchor="end"
            fill={tokens.faint}
            fontSize={8}
            fontFamily={tokens.fontMono}
          >
            {rightLabel}
          </text>
        ) : null}
      </g>
    );
  }
}
