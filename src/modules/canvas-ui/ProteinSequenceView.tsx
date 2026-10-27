// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Fingerprint, Ruler, TestTubeDiagonal } from 'lucide-react';
import type { VizTheme } from './theme';
import { getTheme } from './theme';
import { formatBp, hexToRgba, trimNumber } from './utils';
import {
  classifyResidue,
  proteinColumnGroups,
  proteinFeatureSpans,
  proteinIsoelectricPoint,
  proteinMolecularWeightKda,
  proteinRowAt,
  proteinRowCount,
  virtualProteinRowRange,
  type ProteinDocument,
  type ProteinFeature,
  type ProteinResidueClass,
} from './layout/proteinLayout';

export type { ProteinDocument, ProteinFeature } from './layout/proteinLayout';

export interface ProteinSelection {
  start: number;
  end: number;
}

export interface ProteinSequenceViewProps {
  protein: ProteinDocument;
  selection?: ProteinSelection | null;
  onSelectionChange?: (selection: ProteinSelection | null) => void;
  theme?: VizTheme;
  residuesPerRow?: number;
  height?: number;
}

const GUTTER = 62;
const ROW_HEIGHT = 30;
const GROUP_SIZE = 5;
const GROUP_GAP = 3;

const RESIDUE_COLORS: Record<ProteinResidueClass, Record<VizTheme, string>> = {
  hydrophobic: { light: '#b45309', dark: '#fbbf24', publication: '#8c510a' },
  charged: { light: '#1d4ed8', dark: '#93c5fd', publication: '#2166ac' },
  polar: { light: '#047857', dark: '#6ee7b7', publication: '#01665e' },
  special: { light: '#64748b', dark: '#94a3b8', publication: '#666666' },
};

const CLASS_LABEL: Record<ProteinResidueClass, string> = {
  hydrophobic: 'Hydrophobic',
  charged: 'Charged',
  polar: 'Polar',
  special: 'Other',
};

interface ProteinDragState {
  anchor: number;
  pointerId: number;
  moved: boolean;
  selection: ProteinSelection | null;
}

function truncate(text: string, limit: number): string {
  if (limit <= 1) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(1, limit - 1))}…`;
}

export function ProteinSequenceView({
  protein,
  selection,
  onSelectionChange,
  theme = 'light',
  residuesPerRow = 50,
  height = 620,
}: ProteinSequenceViewProps) {
  const tokens = getTheme(theme);
  const sequence = protein.sequence.toUpperCase();
  const length = sequence.length;
  const perRow = Math.max(10, Math.min(120, Math.round(residuesPerRow)));
  const rowCount = proteinRowCount(length, perRow);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ProteinDragState | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(760);
  const [dragSelection, setDragSelection] = useState<ProteinSelection | null>(null);
  const [internalSelection, setInternalSelection] = useState<ProteinSelection | null>(
    selection ?? null,
  );

  useEffect(() => {
    setInternalSelection(selection ?? null);
  }, [selection?.start, selection?.end]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const measure = () => setViewportWidth(Math.max(320, element.clientWidth || 760));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const stats = useMemo(
    () => ({
      length,
      mwKda: proteinMolecularWeightKda(sequence),
      pI: proteinIsoelectricPoint(sequence),
      featureCount: protein.features.length,
    }),
    [length, sequence, protein.features.length],
  );

  const plotWidth = Math.max(180, viewportWidth - GUTTER - 14);
  const groups = proteinColumnGroups(perRow, GROUP_SIZE);
  const totalGap = Math.max(0, groups.length - 1) * GROUP_GAP;
  const cell = Math.max(2, (plotWidth - totalGap) / perRow);
  const scrollHeight = Math.max(160, height - 64 - 30);

  const xForColumn = useCallback(
    (column: number): number => {
      if (column <= 0) return GUTTER;
      if (column >= perRow) return GUTTER + plotWidth;
      const group = Math.floor(column / GROUP_SIZE);
      return GUTTER + column * cell + Math.min(group, groups.length - 1) * GROUP_GAP;
    },
    [cell, groups.length, perRow, plotWidth],
  );

  const liveSelection = dragSelection ?? internalSelection;
  const selectionLength =
    liveSelection && liveSelection.end > liveSelection.start
      ? liveSelection.end - liveSelection.start
      : 0;

  const visible = virtualProteinRowRange(
    scrollTop,
    scrollHeight,
    ROW_HEIGHT,
    rowCount,
    3,
  );

  const featureSpansByRow = useMemo(() => {
    const map = new Map<number, Array<{ feature: ProteinFeature; startColumn: number; endColumn: number }>>();
    for (const feature of protein.features) {
      const spans = proteinFeatureSpans(feature, perRow, length);
      for (const span of spans) {
        const list = map.get(span.rowIndex);
        const entry = {
          feature,
          startColumn: span.startColumn,
          endColumn: span.endColumn,
        };
        if (list) list.push(entry);
        else map.set(span.rowIndex, [entry]);
      }
    }
    return map;
  }, [protein.features, perRow, length]);

  const positionFromPointer = useCallback(
    (clientX: number, clientY: number): number | null => {
      const element = scrollRef.current;
      if (!element || length <= 0) return null;
      const rect = element.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top + element.scrollTop;
      if (localX < GUTTER - 4) return null;
      const row = Math.floor(localY / ROW_HEIGHT);
      if (row < 0 || row >= rowCount) return null;
      let column = 0;
      for (let index = 0; index < perRow; index += 1) {
        if (localX >= xForColumn(index) - GROUP_GAP) column = index;
        else break;
      }
      const position = row * perRow + column;
      return Math.max(0, Math.min(length - 1, position));
    },
    [length, rowCount, perRow, xForColumn],
  );

  const startSelection = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const position = positionFromPointer(event.clientX, event.clientY);
      if (position === null) return;
      event.preventDefault();
      const next = { start: position, end: position + 1 };
      dragRef.current = {
        anchor: position,
        pointerId: event.pointerId,
        moved: false,
        selection: next,
      };
      setDragSelection(next);
      setInternalSelection(next);
      onSelectionChange?.(next);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* Pointer capture is optional. */
      }
    },
    [onSelectionChange, positionFromPointer],
  );

  const moveSelection = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const position = positionFromPointer(event.clientX, event.clientY);
      if (position === null) return;
      if (position === current.anchor && !current.moved) return;
      current.moved = true;
      const next = {
        start: Math.min(current.anchor, position),
        end: Math.max(current.anchor, position) + 1,
      };
      current.selection = next;
      setDragSelection(next);
      setInternalSelection(next);
      onSelectionChange?.(next);
    },
    [onSelectionChange, positionFromPointer],
  );

  const finishSelection = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      dragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* No capture to release. */
      }
      if (cancelled) {
        setDragSelection(null);
        return;
      }
      setDragSelection(null);
      if (current.moved && current.selection) {
        onSelectionChange?.(current.selection);
      }
    },
    [onSelectionChange],
  );

  const css = `
    .osg-protein-scroll { scrollbar-color: ${tokens.faint} transparent; }
    .osg-protein-scroll::-webkit-scrollbar { width: 11px; }
    .osg-protein-scroll::-webkit-scrollbar-thumb { background: ${tokens.faint}; border-radius: 8px; border: 3px solid ${tokens.panel}; }
    .osg-protein-scroll:focus { outline: none; }
    .osg-protein-scroll:focus-visible { box-shadow: inset 0 0 0 2px ${tokens.accent}; }
  `;

  const classCounts = useMemo(() => {
    const counts: Record<ProteinResidueClass, number> = {
      hydrophobic: 0,
      charged: 0,
      polar: 0,
      special: 0,
    };
    for (const residue of sequence) counts[classifyResidue(residue)] += 1;
    return counts;
  }, [sequence]);

  return (
    <div
      className="osg-protein-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height,
        minHeight: 280,
        fontFamily: tokens.fontSans,
        color: tokens.text,
        background: tokens.background,
        border: `1px solid ${tokens.border}`,
        borderRadius: 14,
        overflow: 'hidden',
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
          padding: '9px 13px',
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.panel,
          flexShrink: 0,
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
            <TestTubeDiagonal size={17} strokeWidth={1.9} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {protein.name || 'Untitled protein'}
            </div>
            <div style={{ fontSize: 11, color: tokens.muted }}>
              {formatBp(length)} aa · {trimNumber(stats.mwKda, 2)} kDa · pI{' '}
              {trimNumber(stats.pI, 2)} · {stats.featureCount} features
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {(['hydrophobic', 'charged', 'polar'] as ProteinResidueClass[]).map((kind) => (
            <span
              key={kind}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                color: tokens.muted,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: RESIDUE_COLORS[kind][theme],
                }}
              />
              {CLASS_LABEL[kind]} {classCounts[kind]}
            </span>
          ))}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10.5,
              color: selectionLength > 0 ? tokens.accent : tokens.muted,
              fontFamily: tokens.fontMono,
            }}
          >
            <Ruler size={11} />
            {selectionLength > 0
              ? `${formatBp(selectionLength)} aa selected`
              : `${perRow} per row`}
          </span>
        </div>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div
          ref={scrollRef}
          className="osg-protein-scroll"
          tabIndex={0}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          onPointerDown={startSelection}
          onPointerMove={moveSelection}
          onPointerUp={(event) => finishSelection(event)}
          onPointerCancel={(event) => finishSelection(event, true)}
          style={{
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            background: tokens.panel,
            touchAction: 'pan-y',
            cursor: 'text',
          }}
        >
          <div
            style={{
              position: 'relative',
              height: Math.max(ROW_HEIGHT, rowCount * ROW_HEIGHT),
              minWidth: viewportWidth,
            }}
          >
            {Array.from(
              { length: Math.max(0, visible.end - visible.start + 1) },
              (_, offset) => {
                const rowIndex = visible.start + offset;
                if (rowIndex < 0 || rowIndex >= rowCount) return null;
                const row = proteinRowAt(length, perRow, rowIndex);
                if (row.end <= row.start) return null;
                const rowSpans = featureSpansByRow.get(rowIndex) ?? [];
                const selectionSegments =
                  liveSelection === null
                    ? []
                    : [
                        {
                          start: Math.max(liveSelection.start, row.start),
                          end: Math.min(liveSelection.end, row.end),
                        },
                      ].filter((segment) => segment.end > segment.start);
                return (
                  <svg
                    key={rowIndex}
                    width={viewportWidth}
                    height={ROW_HEIGHT}
                    viewBox={`0 0 ${viewportWidth} ${ROW_HEIGHT}`}
                    style={{
                      position: 'absolute',
                      top: rowIndex * ROW_HEIGHT,
                      left: 0,
                      display: 'block',
                    }}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={viewportWidth}
                      height={ROW_HEIGHT}
                      fill={rowIndex % 2 === 0 ? tokens.panel : tokens.background}
                    />
                    <rect x={0} y={0} width={GUTTER - 1} height={ROW_HEIGHT} fill={tokens.panelAlt} />
                    <line
                      x1={GUTTER - 1}
                      y1={0}
                      x2={GUTTER - 1}
                      y2={ROW_HEIGHT}
                      stroke={tokens.border}
                      strokeWidth={1}
                    />
                    <text
                      x={GUTTER - 8}
                      y={17}
                      textAnchor="end"
                      fill={tokens.muted}
                      fontSize={9}
                      fontFamily={tokens.fontMono}
                      fontWeight={600}
                    >
                      {row.start + 1}
                    </text>

                    {selectionSegments.map((segment, index) => (
                      <rect
                        key={`sel-${index}`}
                        x={xForColumn(segment.start - row.start)}
                        y={7}
                        width={Math.max(
                          1,
                          xForColumn(segment.end - row.start) -
                            xForColumn(segment.start - row.start),
                        )}
                        height={ROW_HEIGHT - 10}
                        fill={tokens.selection}
                        stroke={tokens.selectionStroke}
                        strokeOpacity={0.35}
                        strokeWidth={0.7}
                        pointerEvents="none"
                      />
                    ))}

                    {rowSpans.map((span, index) => {
                      const width = Math.max(
                        1,
                        xForColumn(span.endColumn) - xForColumn(span.startColumn),
                      );
                      return (
                        <g key={`feature-${span.feature.id}-${index}`} pointerEvents="none">
                          <title>
                            {`${span.feature.name} · ${span.feature.type}\n${span.feature.start + 1}–${span.feature.end} aa`}
                          </title>
                          <rect
                            x={xForColumn(span.startColumn)}
                            y={2}
                            width={width}
                            height={5}
                            rx={2}
                            fill={span.feature.color || tokens.accent}
                            opacity={0.9}
                          />
                          {width > 26 ? (
                            <text
                              x={xForColumn(span.startColumn) + 2}
                              y={ROW_HEIGHT - 1}
                              fill={hexToRgba(span.feature.color || tokens.accent, 0.95)}
                              fontSize={7}
                              fontWeight={600}
                            >
                              {truncate(span.feature.name, Math.floor((width - 6) / 4.4))}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}

                    <g pointerEvents="none">
                      {groups.map((group) => {
                        const startColumn = group.start;
                        if (startColumn >= row.end - row.start) return null;
                        if (startColumn % 10 !== 0) return null;
                        const labelPosition = row.start + startColumn + 1;
                        return (
                          <text
                            key={`ruler-${group.start}`}
                            x={xForColumn(startColumn) + 1}
                            y={10}
                            fill={tokens.faint}
                            fontSize={7}
                            fontFamily={tokens.fontMono}
                          >
                            {labelPosition}
                          </text>
                        );
                      })}
                    </g>

                    <g pointerEvents="none">
                      {Array.from(
                        { length: Math.max(0, row.end - row.start) },
                        (_, offset) => {
                          const column = offset;
                          const residue = sequence[row.start + offset] ?? '';
                          if (!residue) return null;
                          const kind = classifyResidue(residue);
                          return (
                            <text
                              key={`residue-${row.start + offset}`}
                              x={xForColumn(column) + cell / 2}
                              y={ROW_HEIGHT - 10}
                              textAnchor="middle"
                              fill={RESIDUE_COLORS[kind][theme]}
                              fontSize={Math.max(6.5, Math.min(13, cell * 1.05))}
                              fontFamily={tokens.fontMono}
                              fontWeight={kind === 'special' ? 500 : 600}
                            >
                              {residue}
                            </text>
                          );
                        },
                      )}
                    </g>
                  </svg>
                );
              },
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          padding: '5px 12px',
          borderTop: `1px solid ${tokens.border}`,
          background: tokens.panel,
          fontSize: 9.5,
          color: tokens.muted,
        }}
      >
        <span>
          <Fingerprint size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Drag across residues to select · {formatBp(length)} aa
        </span>
        <span style={{ fontFamily: tokens.fontMono }}>
          第 {Math.min(rowCount, Math.floor(scrollTop / ROW_HEIGHT) + 1)} / {rowCount || 1} 行
        </span>
      </div>
    </div>
  );
}
