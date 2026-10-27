import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Rows3 } from 'lucide-react';
import type { VizTheme } from './theme';
import { baseColor, getTheme } from './theme';
import { formatBp, hexToRgba } from './utils';
import {
  clampColumn,
  clustalColor,
  computeCellWidth,
  conservationLevel,
  conservationOpacity,
  countUngappedBases,
  displayAlignedBase,
  MSA_SCHEME_LABEL,
  rangesEqual,
  ungappedIndexAt,
  visibleIndexRange,
  type IndexRange,
  type MsaColorScheme,
} from './layout/msaLayout';

export interface MsaViewRow {
  id: string;
  name: string;
  aligned: string;
}

export interface MultipleAlignmentViewerProps {
  rows: MsaViewRow[];
  consensus: string;
  conservation: number[];
  height?: number;
  theme?: VizTheme;
  colorScheme?: MsaColorScheme;
  referenceRowId?: string;
  onColumnClick?: (column: number) => void;
}

const LABEL_WIDTH = 196;
const HEADER_HEIGHT = 56;
const ROW_HEIGHT = 22;
const CONSENSUS_HEIGHT = 26;
const OVERSCAN = 4;
const DEFAULT_VIEWPORT = { width: 960, height: 480 };

interface ViewportSize {
  width: number;
  height: number;
}

interface VirtualRange {
  rows: IndexRange;
  cols: IndexRange;
}

interface HoverCell {
  rowIndex: number;
  column: number;
  x: number;
  y: number;
}

function computeRange(
  scrollTop: number,
  scrollLeft: number,
  viewport: ViewportSize,
  cellWidth: number,
  rowCount: number,
  columnCount: number,
): VirtualRange {
  return {
    rows: visibleIndexRange(scrollTop, viewport.height, ROW_HEIGHT, rowCount, OVERSCAN),
    cols: visibleIndexRange(scrollLeft, viewport.width, cellWidth, columnCount, OVERSCAN),
  };
}

export function MultipleAlignmentViewer({
  rows,
  consensus,
  conservation,
  height = 620,
  theme = 'light',
  colorScheme = 'nucleotide',
  referenceRowId,
  onColumnClick,
}: MultipleAlignmentViewerProps) {
  const tokens = getTheme(theme);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const labelInnerRef = useRef<HTMLDivElement | null>(null);
  const consensusInnerRef = useRef<HTMLDivElement | null>(null);

  const [viewport, setViewport] = useState<ViewportSize>(DEFAULT_VIEWPORT);
  const viewportRef = useRef(viewport);
  const scrollPosRef = useRef({ top: 0, left: 0 });

  const rowCount = rows.length;
  const columnCount = useMemo(() => {
    let count = Math.max(consensus.length, conservation.length);
    for (const row of rows) count = Math.max(count, row.aligned.length);
    return count;
  }, [rows, consensus.length, conservation.length]);

  const cellWidth = useMemo(
    () => computeCellWidth(viewport.width, columnCount),
    [viewport.width, columnCount],
  );
  const contentWidth = columnCount * cellWidth;
  const innerWidth = Math.max(contentWidth, viewport.width);

  const cellWidthRef = useRef(cellWidth);
  const rowCountRef = useRef(rowCount);
  const columnCountRef = useRef(columnCount);

  const [range, setRange] = useState<VirtualRange>(() =>
    computeRange(0, 0, DEFAULT_VIEWPORT, cellWidth, rowCount, columnCount),
  );
  const rangeRef = useRef(range);

  const [hover, setHover] = useState<HoverCell | null>(null);
  const hoverRef = useRef<HoverCell | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const referenceAligned = useMemo(
    () => rows.find((row) => row.id === referenceRowId)?.aligned,
    [rows, referenceRowId],
  );
  const ungappedLengths = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.id, countUngappedBases(row.aligned));
    return map;
  }, [rows]);
  const meanConservation = useMemo(() => {
    if (columnCount <= 0) return 0;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < conservation.length && i < columnCount; i += 1) {
      sum += conservationLevel(conservation[i]);
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  }, [conservation, columnCount]);

  const syncPanes = useCallback((top: number, left: number) => {
    if (labelInnerRef.current) {
      labelInnerRef.current.style.transform = `translate3d(0, ${-top}px, 0)`;
    }
    if (consensusInnerRef.current) {
      consensusInnerRef.current.style.transform = `translate3d(${-left}px, 0, 0)`;
    }
  }, []);

  useEffect(() => {
    viewportRef.current = viewport;
    cellWidthRef.current = cellWidth;
    rowCountRef.current = rowCount;
    columnCountRef.current = columnCount;
  }, [viewport, cellWidth, rowCount, columnCount]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const measure = () => {
      const width = Math.max(240, element.clientWidth || DEFAULT_VIEWPORT.width);
      const nextHeight = Math.max(120, element.clientHeight || DEFAULT_VIEWPORT.height);
      setViewport((previous) =>
        Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - nextHeight) < 0.5
          ? previous
          : { width, height: nextHeight },
      );
      syncPanes(scrollPosRef.current.top, scrollPosRef.current.left);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [syncPanes]);

  useEffect(() => {
    const { top, left } = scrollPosRef.current;
    const next = computeRange(top, left, viewport, cellWidth, rowCount, columnCount);
    if (
      !rangesEqual(next.rows, rangeRef.current.rows) ||
      !rangesEqual(next.cols, rangeRef.current.cols)
    ) {
      rangeRef.current = next;
      setRange(next);
    }
  }, [viewport, cellWidth, rowCount, columnCount]);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const top = element.scrollTop;
      const left = element.scrollLeft;
      scrollPosRef.current = { top, left };
      syncPanes(top, left);
      const next = computeRange(
        top,
        left,
        viewportRef.current,
        cellWidthRef.current,
        rowCountRef.current,
        columnCountRef.current,
      );
      if (
        !rangesEqual(next.rows, rangeRef.current.rows) ||
        !rangesEqual(next.cols, rangeRef.current.cols)
      ) {
        rangeRef.current = next;
        setRange(next);
      }
    },
    [syncPanes],
  );

  const locate = useCallback(
    (clientX: number, clientY: number): { column: number; rowIndex: number } | null => {
      const element = scrollRef.current;
      if (!element || columnCount <= 0) return null;
      const rect = element.getBoundingClientRect();
      const x = clientX - rect.left + element.scrollLeft;
      if (x < 0 || x > contentWidth) return null;
      const column = clampColumn(Math.floor(x / cellWidth), columnCount);
      const y = clientY - rect.top + element.scrollTop - HEADER_HEIGHT;
      if (y < 0) return { column, rowIndex: -1 };
      const rowIndex = Math.floor(y / ROW_HEIGHT);
      if (rowIndex < 0 || rowIndex >= rowCount) return { column, rowIndex: -1 };
      return { column, rowIndex };
    },
    [cellWidth, columnCount, contentWidth, rowCount],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = locate(event.clientX, event.clientY);
      if (!point || point.rowIndex < 0) {
        if (hoverRef.current) {
          hoverRef.current = null;
          setHover(null);
        }
        return;
      }
      const root = rootRef.current;
      let relativeX = 0;
      let relativeY = 0;
      let rootWidth = viewportRef.current.width;
      if (root) {
        const rect = root.getBoundingClientRect();
        relativeX = event.clientX - rect.left;
        relativeY = event.clientY - rect.top;
        rootWidth = rect.width || rootWidth;
      }
      const left = Math.min(
        Math.max(8, relativeX + 16),
        Math.max(8, rootWidth - 252),
      );
      const top = Math.min(Math.max(8, relativeY + 16), Math.max(8, height - 104));
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${left}px`;
        tooltipRef.current.style.top = `${top}px`;
      }
      const current = hoverRef.current;
      if (
        !current ||
        current.rowIndex !== point.rowIndex ||
        current.column !== point.column
      ) {
        const next: HoverCell = {
          rowIndex: point.rowIndex,
          column: point.column,
          x: left,
          y: top,
        };
        hoverRef.current = next;
        setHover(next);
      }
    },
    [height, locate],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onColumnClick || columnCount <= 0) return;
      const element = scrollRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left + element.scrollLeft;
      if (x < 0 || x > contentWidth) return;
      onColumnClick(clampColumn(Math.floor(x / cellWidth), columnCount));
    },
    [cellWidth, columnCount, contentWidth, onColumnClick],
  );

  const hoveredRow = hover ? rows[hover.rowIndex] : undefined;
  const hoveredColumn = hover ? hover.column : -1;
  const fontSize = Math.min(12, Math.max(7.5, cellWidth * 0.84));
  const rulerFont = Math.max(7.5, Math.min(9, cellWidth * 0.7));
  const isDark = theme === 'dark';

  const css = `
    .osg-msa-scroll { scrollbar-color: ${tokens.faint} transparent; }
    .osg-msa-scroll::-webkit-scrollbar { width: 11px; height: 11px; }
    .osg-msa-scroll::-webkit-scrollbar-thumb { background: ${tokens.faint}; border-radius: 8px; border: 3px solid ${tokens.panel}; }
    .osg-msa-scroll::-webkit-scrollbar-corner { background: ${tokens.panel}; }
  `;

  const renderCell = (row: MsaViewRow, rowIndex: number, column: number) => {
    const raw = row.aligned[column] ?? '-';
    const base = raw.toUpperCase();
    const shown = referenceAligned !== undefined
      ? displayAlignedBase(row.aligned, column, referenceAligned)
      : raw;
    const isGap = base === '-' || base === '';
    let color = tokens.text;
    let tint: string | null = null;
    if (shown === '.') {
      color = tokens.faint;
    } else if (isGap) {
      color = tokens.faint;
    } else if (colorScheme === 'nucleotide') {
      color = baseColor(base, tokens);
      tint = hexToRgba(color, theme === 'publication' ? 0.08 : 0.11);
    } else if (colorScheme === 'identity') {
      const consensusBase = (consensus[column] ?? '').toUpperCase();
      color = base === consensusBase ? tokens.success : tokens.warning;
      tint = hexToRgba(color, 0.1);
    } else if (colorScheme === 'clustal') {
      const mapped = clustalColor(base, isDark);
      color = mapped ?? tokens.muted;
      if (mapped) tint = hexToRgba(mapped, 0.12);
    } else {
      color = tokens.text;
    }
    const x = column * cellWidth;
    const hovered = hover !== null && hover.rowIndex === rowIndex && hover.column === column;
    return (
      <g key={`${row.id}:${column}`}>
        {tint ? (
          <rect x={x} y={1} width={cellWidth} height={ROW_HEIGHT - 2} fill={tint} rx={2} />
        ) : null}
        {hovered ? (
          <rect
            x={x + 0.5}
            y={1}
            width={Math.max(0.8, cellWidth - 1)}
            height={ROW_HEIGHT - 2}
            fill="none"
            stroke={tokens.accent}
            strokeWidth={1.2}
            rx={2}
          />
        ) : null}
        <text
          x={x + cellWidth / 2}
          y={ROW_HEIGHT / 2 + fontSize * 0.36}
          textAnchor="middle"
          fill={color}
          fontSize={fontSize}
          fontFamily={tokens.fontMono}
          fontWeight={shown === '.' || isGap ? 500 : 600}
          opacity={shown === '.' ? 0.75 : 1}
        >
          {isGap && shown !== '.' ? '–' : shown}
        </text>
      </g>
    );
  };

  return (
    <div
      ref={rootRef}
      className="osg-msa-root"
      role="region"
      aria-label="Multiple sequence alignment"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height,
        minHeight: 320,
        fontFamily: tokens.fontSans,
        color: tokens.text,
        background: tokens.background,
        border: `1px solid ${tokens.border}`,
        borderRadius: 16,
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
          padding: '10px 14px',
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
            <Rows3 size={17} />
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
              Multiple alignment
            </div>
            <div style={{ fontSize: 11, color: tokens.muted }}>
              {formatBp(rowCount)} sequences · {formatBp(columnCount)} columns
              {referenceAligned !== undefined ? ' · reference mode' : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: tokens.muted }}>
            <span style={{ fontWeight: 700, letterSpacing: '0.06em', color: tokens.text }}>
              {MSA_SCHEME_LABEL[colorScheme] ?? 'Nucleotide'}
            </span>
            coloring
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: tokens.muted }}>
            Conservation
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 54,
                height: 6,
                borderRadius: 99,
                background: `linear-gradient(90deg, ${tokens.faint}, ${tokens.muted}, ${tokens.accent})`,
              }}
            />
            0–1
          </span>
          {colorScheme === 'nucleotide'
            ? (['A', 'T', 'G', 'C'] as const).map((base) => (
                <span
                  key={base}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10.5,
                    color: tokens.muted,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: baseColor(base, tokens) }} />
                  {base}
                </span>
              ))
            : null}
          {colorScheme === 'identity' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 10.5, color: tokens.muted }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: tokens.success }} />
                match
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: tokens.warning }} />
                mismatch
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: LABEL_WIDTH,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: `1px solid ${tokens.border}`,
            background: tokens.panel,
            minHeight: 0,
          }}
        >
          <div
            style={{
              height: HEADER_HEIGHT,
              flexShrink: 0,
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderBottom: `1px solid ${tokens.border}`,
              background: tokens.panelAlt,
            }}
          >
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', color: tokens.muted }}>
              ALIGNMENT
            </div>
            <div style={{ fontSize: 10.5, color: tokens.muted, marginTop: 3 }}>
              {formatBp(rowCount)} rows · {formatBp(columnCount)} cols
            </div>
            <div style={{ fontSize: 9, color: tokens.faint, marginTop: 2 }}>
              columns are 1-based
            </div>
          </div>

          <div style={{ position: 'relative', flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <div
              ref={labelInnerRef}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: rowCount * ROW_HEIGHT }}
            >
              {Array.from({ length: Math.max(0, range.rows.end - range.rows.start) }, (_, offset) => {
                const rowIndex = range.rows.start + offset;
                const row = rows[rowIndex];
                if (!row) return null;
                const isReference = row.id === referenceRowId;
                const length = ungappedLengths.get(row.id) ?? 0;
                return (
                  <div
                    key={row.id}
                    title={`${row.name} · ${formatBp(length)} residues`}
                    style={{
                      position: 'absolute',
                      top: rowIndex * ROW_HEIGHT,
                      left: 0,
                      right: 0,
                      height: ROW_HEIGHT,
                      boxSizing: 'border-box',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '0 10px',
                      borderBottom: `1px solid ${tokens.grid}`,
                      background:
                        hover?.rowIndex === rowIndex
                          ? tokens.accentSoft
                          : isReference
                            ? tokens.accentSoft
                            : rowIndex % 2 === 0
                              ? tokens.panel
                              : tokens.background,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: isReference ? 700 : 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {row.name}
                    </span>
                    {isReference ? (
                      <span
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          color: tokens.accent,
                          border: `1px solid ${tokens.accent}`,
                          borderRadius: 4,
                          padding: '0 3px',
                          flexShrink: 0,
                        }}
                      >
                        REF
                      </span>
                    ) : null}
                    <span style={{ fontSize: 8.5, color: tokens.faint, fontFamily: tokens.fontMono, flexShrink: 0 }}>
                      {formatBp(length)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            style={{
              height: CONSENSUS_HEIGHT,
              flexShrink: 0,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              borderTop: `1px solid ${tokens.border}`,
              background: tokens.panelAlt,
            }}
          >
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: tokens.muted }}>
              CONSENSUS
            </span>
            <span style={{ fontSize: 9, color: tokens.faint }}>
              {Math.round(meanConservation * 100)}% mean
            </span>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div
            ref={scrollRef}
            className="osg-msa-scroll"
            onScroll={handleScroll}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => {
              hoverRef.current = null;
              setHover(null);
            }}
            onClick={handleClick}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              background: tokens.panel,
              position: 'relative',
            }}
          >
            <div style={{ position: 'relative', width: innerWidth, height: HEADER_HEIGHT + rowCount * ROW_HEIGHT }}>
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 3,
                  height: HEADER_HEIGHT,
                  background: tokens.panelAlt,
                  borderBottom: `1px solid ${tokens.border}`,
                  boxShadow: `0 4px 12px -10px ${tokens.shadow}`,
                }}
              >
                <svg
                  width={innerWidth}
                  height={HEADER_HEIGHT}
                  viewBox={`0 0 ${innerWidth} ${HEADER_HEIGHT}`}
                  style={{ display: 'block' }}
                  aria-hidden="true"
                >
                  <rect width={innerWidth} height={HEADER_HEIGHT} fill={tokens.panelAlt} />
                  {Array.from(
                    { length: Math.max(0, range.cols.end - range.cols.start) },
                    (_, offset) => {
                      const column = range.cols.start + offset;
                      const x = column * cellWidth;
                      const level = conservationLevel(conservation[column] ?? 0);
                      const barHeight = level * (HEADER_HEIGHT - 27);
                      return (
                        <g key={`cons-${column}`}>
                          {column % 10 === 0 ? (
                            <g>
                              <line
                                x1={x + 0.5}
                                y1={14}
                                x2={x + 0.5}
                                y2={19}
                                stroke={tokens.faint}
                                strokeWidth={0.8}
                              />
                              <text
                                x={x + cellWidth / 2}
                                y={10}
                                textAnchor="middle"
                                fill={tokens.muted}
                                fontSize={rulerFont}
                                fontFamily={tokens.fontMono}
                              >
                                {column + 1}
                              </text>
                              <line
                                x1={x + 0.5}
                                y1={19}
                                x2={x + 0.5}
                                y2={HEADER_HEIGHT - 2}
                                stroke={tokens.grid}
                                strokeWidth={0.6}
                              />
                            </g>
                          ) : null}
                          {barHeight > 0.3 ? (
                            <rect
                              x={x + Math.max(0.6, cellWidth * 0.12)}
                              y={HEADER_HEIGHT - 4 - barHeight}
                              width={Math.max(0.8, cellWidth * 0.76)}
                              height={barHeight}
                              rx={Math.min(2, cellWidth * 0.15)}
                              fill={level >= 0.66 ? tokens.accent : level >= 0.33 ? tokens.muted : tokens.faint}
                              opacity={conservationOpacity(level)}
                            />
                          ) : null}
                          {column === hoveredColumn ? (
                            <rect
                              x={x}
                              y={0}
                              width={cellWidth}
                              height={HEADER_HEIGHT}
                              fill={tokens.selection}
                            />
                          ) : null}
                        </g>
                      );
                    },
                  )}
                  <line
                    x1={0}
                    y1={HEADER_HEIGHT - 1.5}
                    x2={innerWidth}
                    y2={HEADER_HEIGHT - 1.5}
                    stroke={tokens.border}
                    strokeWidth={1}
                  />
                </svg>
              </div>

              {rowCount === 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    top: HEADER_HEIGHT,
                    left: 0,
                    right: 0,
                    height: Math.max(160, viewport.height - HEADER_HEIGHT),
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    color: tokens.muted,
                    background: tokens.panel,
                  }}
                >
                  <Rows3 size={28} strokeWidth={1.4} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>No aligned sequences</div>
                  <div style={{ fontSize: 11.5 }}>Provide aligned rows, a consensus and conservation scores.</div>
                </div>
              ) : null}

              {Array.from({ length: Math.max(0, range.rows.end - range.rows.start) }, (_, offset) => {
                const rowIndex = range.rows.start + offset;
                const row = rows[rowIndex];
                if (!row) return null;
                const isReference = row.id === referenceRowId;
                return (
                  <svg
                    key={row.id}
                    width={innerWidth}
                    height={ROW_HEIGHT}
                    viewBox={`0 0 ${innerWidth} ${ROW_HEIGHT}`}
                    style={{
                      position: 'absolute',
                      top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT,
                      left: 0,
                      display: 'block',
                      cursor: onColumnClick ? 'pointer' : 'default',
                    }}
                    aria-label={`${row.name} aligned sequence`}
                  >
                    <rect
                      width={innerWidth}
                      height={ROW_HEIGHT}
                      fill={
                        hover?.rowIndex === rowIndex
                          ? tokens.accentSoft
                          : isReference
                            ? tokens.accentSoft
                            : rowIndex % 2 === 0
                              ? tokens.panel
                              : tokens.background
                      }
                    />
                    <line
                      x1={0}
                      y1={ROW_HEIGHT - 0.5}
                      x2={innerWidth}
                      y2={ROW_HEIGHT - 0.5}
                      stroke={tokens.grid}
                      strokeWidth={0.7}
                    />
                    {Array.from(
                      { length: Math.max(0, range.cols.end - range.cols.start) },
                      (_unused, columnOffset) => {
                        const column = range.cols.start + columnOffset;
                        return renderCell(row, rowIndex, column);
                      },
                    )}
                  </svg>
                );
              })}
            </div>
          </div>

          <div
            style={{
              height: CONSENSUS_HEIGHT,
              flexShrink: 0,
              overflow: 'hidden',
              position: 'relative',
              borderTop: `1px solid ${tokens.border}`,
              background: tokens.panelAlt,
            }}
          >
            <div
              ref={consensusInnerRef}
              style={{ position: 'absolute', top: 0, left: 0, width: innerWidth, height: CONSENSUS_HEIGHT }}
            >
              <svg
                width={innerWidth}
                height={CONSENSUS_HEIGHT}
                viewBox={`0 0 ${innerWidth} ${CONSENSUS_HEIGHT}`}
                style={{ display: 'block' }}
                aria-label="Consensus sequence"
              >
                <title>{`Consensus ${consensus}`}</title>
                <rect width={innerWidth} height={CONSENSUS_HEIGHT} fill={tokens.panelAlt} />
                {Array.from(
                  { length: Math.max(0, range.cols.end - range.cols.start) },
                  (_, columnOffset) => {
                    const column = range.cols.start + columnOffset;
                    const raw = consensus[column] ?? '';
                    const base = raw.toUpperCase();
                    const isGap = base === '-' || base === '';
                    const color = isGap
                      ? tokens.faint
                      : /[ACGTU]/.test(base)
                        ? baseColor(base, tokens)
                        : tokens.muted;
                    return (
                      <g key={`consensus-${column}`}>
                        {column === hoveredColumn ? (
                          <rect
                            x={column * cellWidth}
                            y={0}
                            width={cellWidth}
                            height={CONSENSUS_HEIGHT}
                            fill={tokens.selection}
                          />
                        ) : null}
                        <text
                          x={column * cellWidth + cellWidth / 2}
                          y={CONSENSUS_HEIGHT / 2 + Math.min(11, cellWidth * 0.8) * 0.36}
                          textAnchor="middle"
                          fill={color}
                          fontSize={Math.min(11, Math.max(7.5, cellWidth * 0.8))}
                          fontFamily={tokens.fontMono}
                          fontWeight={700}
                        >
                          {isGap ? '–' : raw}
                        </text>
                      </g>
                    );
                  },
                )}
                <line
                  x1={0}
                  y1={0.5}
                  x2={innerWidth}
                  y2={0.5}
                  stroke={tokens.border}
                  strokeWidth={1}
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          padding: '6px 12px',
          borderTop: `1px solid ${tokens.border}`,
          background: tokens.panel,
          fontSize: 9.5,
          color: tokens.muted,
          flexShrink: 0,
        }}
      >
        <span>
          Hover a residue for its ungapped source coordinate.
          {referenceAligned !== undefined
            ? ' Dots mark bases identical to the reference row.'
            : onColumnClick
              ? ' Click a column to inspect it.'
              : ''}
        </span>
        <span style={{ fontFamily: tokens.fontMono }}>
          {formatBp(rowCount)} × {formatBp(columnCount)} · {cellWidth.toFixed(1)} px/column
        </span>
      </div>

      {hover && hoveredRow ? (
        <div
          ref={tooltipRef}
          style={{
            position: 'absolute',
            left: hover.x,
            top: hover.y,
            width: 236,
            padding: '8px 10px',
            borderRadius: 10,
            background: tokens.tooltipBackground,
            color: tokens.tooltipText,
            boxShadow: `0 8px 24px -10px ${tokens.shadow}`,
            border: `1px solid ${tokens.border}`,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {hoveredRow.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontFamily: tokens.fontMono, fontSize: 10.5 }}>
            <span>col {formatBp(hover.column + 1)}</span>
            <span style={{ opacity: 0.6 }}>·</span>
            <span>{(() => {
              const raw = hoveredRow.aligned[hover.column] ?? '-';
              return raw === '-' ? 'gap' : raw;
            })()}</span>
            {referenceAligned !== undefined ? (
              <>
                <span style={{ opacity: 0.6 }}>·</span>
                <span style={{ opacity: 0.8 }}>
                  ref {referenceAligned[hover.column] ?? '-'}
                </span>
              </>
            ) : null}
          </div>
          <div style={{ marginTop: 3, fontSize: 9.5, opacity: 0.85 }}>
            {(() => {
              const index = ungappedIndexAt(hoveredRow.aligned, hover.column);
              const total = ungappedLengths.get(hoveredRow.id) ?? 0;
              if (index === null) {
                const before = countUngappedBases(hoveredRow.aligned, hover.column);
                return `Gap after residue ${formatBp(before)} of ${formatBp(total)}`;
              }
              return `Residue ${formatBp(index)} of ${formatBp(total)} in source`;
            })()}
          </div>
        </div>
      ) : null}
    </div>
  );
}
