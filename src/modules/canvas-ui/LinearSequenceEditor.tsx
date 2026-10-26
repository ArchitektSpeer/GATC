import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Dna, Keyboard, MousePointer2 } from 'lucide-react';
import type {
  CutSite,
  PlasmidDocument,
  SelectionRange,
  SequenceFeature,
} from '../../types/schema';
import type { VizTheme } from './theme';
import { baseColor, getTheme } from './theme';
import {
  clamp,
  formatBp,
  hexToRgba,
  mod,
  splitRange,
  trimNumber,
} from './utils';
import {
  AMINO_ACID_NAME,
  buildCutRowMap,
  buildFeatureRowMap,
  buildPrimerRowMap,
  buildTranslationCodons,
  buildTranslationRowMap,
  complementBase,
  getLinearTrackLayout,
} from './layout/linearLayout';

export interface LinearSequenceEditorProps {
  doc: PlasmidDocument;
  cutSites: CutSite[];
  selection: SelectionRange | null;
  onSelectionChange?: (sel: SelectionRange | null) => void;
  onEdit?: (
    edit:
      | { type: 'insert'; position: number; bases: string }
      | { type: 'delete'; start: number; end: number }
      | { type: 'replace'; start: number; end: number; bases: string },
  ) => void;
  bpPerRow?: 50 | 60 | 80 | 100;
  translationMode?: 'none' | 'cds' | 'frame3' | 'frame6';
  theme?: VizTheme;
  height?: number;
  aaDisplay?: 'single' | 'three';
}

const GUTTER = 58;
const RIGHT_PAD = 12;

function primerPolygon(
  x1: number,
  x2: number,
  y: number,
  thickness: number,
  direction: 1 | -1,
): string {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const head = Math.max(5, Math.min(thickness * 2.1, Math.abs(right - left)));
  if (direction === 1) {
    return [
      `${left},${y - thickness / 2}`,
      `${Math.max(left, right - head)},${y - thickness / 2}`,
      `${right},${y}`,
      `${Math.max(left, right - head)},${y + thickness / 2}`,
      `${left},${y + thickness / 2}`,
    ].join(' ');
  }
  return [
    `${Math.min(right, left + head)},${y - thickness / 2}`,
    `${right},${y - thickness / 2}`,
    `${right},${y + thickness / 2}`,
    `${Math.min(right, left + head)},${y + thickness / 2}`,
    `${left},${y}`,
  ].join(' ');
}

function featureArrowPoints(
  x1: number,
  x2: number,
  y: number,
  height: number,
  direction: 1 | -1,
): string {
  const tip = direction === 1 ? x2 : x1;
  const base = tip - direction * Math.min(6, Math.max(2, Math.abs(x2 - x1)));
  return `${base},${y - height / 2} ${tip},${y} ${base},${y + height / 2}`;
}

function aaLabel(aa: string, display: 'single' | 'three'): string {
  if (display === 'single') return aa;
  return AMINO_ACID_NAME[aa] ?? aa;
}

export function LinearSequenceEditor({
  doc,
  cutSites,
  selection,
  onSelectionChange,
  onEdit,
  bpPerRow = 60,
  translationMode = 'cds',
  theme = 'light',
  height = 620,
  aaDisplay = 'single',
}: LinearSequenceEditorProps) {
  const tokens = getTheme(theme);
  const sequence = doc.sequence.toUpperCase();
  const length = doc.length || sequence.length;
  const circular = doc.topology === 'circular';
  const layout = useMemo(() => getLinearTrackLayout(translationMode), [translationMode]);
  const totalRows = Math.max(1, Math.ceil(length / bpPerRow));
  const scrollHeight = Math.max(240, height - 54);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const latestScrollRef = useRef(0);
  const dragInfoRef = useRef<{
    anchor: number;
    pointerId: number;
    moved: boolean;
    lastPos: number;
  } | null>(null);
  const dragSelectionRef = useRef<SelectionRange | null>(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(960);
  const [cursor, setCursor] = useState(0);
  const [keyboardAnchor, setKeyboardAnchor] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [dragSelection, setDragSelection] = useState<SelectionRange | null>(null);

  useEffect(() => {
    setCursor((previous) => clamp(previous, 0, Math.max(0, length)));
  }, [length]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const measure = () => {
      setViewportWidth(Math.max(360, element.clientWidth || 960));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafRef.current);
      }
    },
    [],
  );

  const plotWidth = Math.max(160, viewportWidth - GUTTER - RIGHT_PAD);
  const cell = plotWidth / bpPerRow;
  const plotRight = GUTTER + plotWidth;
  const baseFont = Math.max(6.5, Math.min(14, cell * 0.92));
  const chordFont = Math.max(6, Math.min(9.5, cell * 2.1));

  const visibleStart = Math.max(0, Math.floor(scrollTop / layout.rowHeight) - 2);
  const visibleEnd = Math.min(
    totalRows - 1,
    Math.ceil((scrollTop + scrollHeight) / layout.rowHeight) + 2,
  );

  const featureRowMap = useMemo(
    () => buildFeatureRowMap(doc.features, bpPerRow, length, circular),
    [doc.features, bpPerRow, length, circular],
  );
  const cutRowMap = useMemo(
    () => buildCutRowMap(cutSites, bpPerRow),
    [cutSites, bpPerRow],
  );
  const primerRowMap = useMemo(
    () => buildPrimerRowMap(doc.primers, bpPerRow),
    [doc.primers, bpPerRow],
  );
  const featureById = useMemo(() => {
    const map = new Map<string, SequenceFeature>();
    for (const feature of doc.features) map.set(feature.id, feature);
    return map;
  }, [doc.features]);
  const translationCodons = useMemo(
    () => buildTranslationCodons(sequence, doc.features, length, circular, translationMode),
    [sequence, doc.features, length, circular, translationMode],
  );
  const translationRowMap = useMemo(
    () => buildTranslationRowMap(translationCodons, bpPerRow),
    [translationCodons, bpPerRow],
  );

  const selectionSegments = useMemo(
    () =>
      selection && length > 0
        ? splitRange(selection.start, selection.end, length, circular)
        : [],
    [selection, length, circular],
  );
  const liveSelection = dragSelection ?? selection;
  const liveSelectionSegments = dragSelection
    ? splitRange(dragSelection.start, dragSelection.end, length, circular)
    : selectionSegments;
  const liveSelectionLength = useMemo(
    () => liveSelectionSegments.reduce((sum, segment) => sum + (segment.end - segment.start), 0),
    [liveSelectionSegments],
  );

  const scrollToVisible = useCallback((position: number) => {
    const element = scrollRef.current;
    if (!element) return;
    const row = Math.floor(position / bpPerRow);
    const top = row * layout.rowHeight;
    if (top < element.scrollTop) {
      element.scrollTop = Math.max(0, top - layout.rowHeight);
    } else if (top + layout.rowHeight > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + layout.rowHeight * 2 - element.clientHeight;
    }
  }, [bpPerRow, layout.rowHeight]);

  const notifySelection = useCallback(
    (next: SelectionRange | null) => {
      onSelectionChange?.(next);
    },
    [onSelectionChange],
  );

  const positionFromPointer = useCallback(
    (clientX: number, clientY: number): number => {
      const element = scrollRef.current;
      if (!element) return cursor;
      const rect = element.getBoundingClientRect();
      const localX = clientX - rect.left - GUTTER;
      const localY = clientY - rect.top + element.scrollTop;
      const row = clamp(Math.floor(localY / layout.rowHeight), 0, totalRows - 1);
      const column = clamp(Math.floor(localX / cell), 0, bpPerRow - 1);
      return clamp(row * bpPerRow + column, 0, Math.max(0, length - 1));
    },
    [cell, cursor, layout.rowHeight, length, totalRows],
  );

  const handleRowPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (length <= 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      if (localX < GUTTER || localX > plotRight) return;
      event.preventDefault();
      scrollRef.current?.focus();
      const pos = positionFromPointer(event.clientX, event.clientY);
      dragInfoRef.current = {
        anchor: pos,
        pointerId: event.pointerId,
        moved: false,
        lastPos: pos,
      };
      dragSelectionRef.current = { start: pos, end: pos + 1 };
      setDragSelection(dragSelectionRef.current);
      setCursor(pos);
      try {
        scrollRef.current?.setPointerCapture(event.pointerId);
      } catch {
        /* Pointer capture is optional. */
      }
    },
    [length, plotRight, positionFromPointer],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const info = dragInfoRef.current;
      if (!info || info.pointerId !== event.pointerId) return;
      const pos = positionFromPointer(event.clientX, event.clientY);
      if (pos === info.lastPos) return;
      info.lastPos = pos;
      info.moved = true;
      const start = Math.min(info.anchor, pos);
      const end = Math.max(info.anchor, pos) + 1;
      const next: SelectionRange = { start, end };
      dragSelectionRef.current = next;
      setDragSelection(next);
      setCursor(end);
      notifySelection(next);
    },
    [notifySelection, positionFromPointer],
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
      const info = dragInfoRef.current;
      if (!info || info.pointerId !== event.pointerId) return;
      dragInfoRef.current = null;
      try {
        scrollRef.current?.releasePointerCapture(event.pointerId);
      } catch {
        /* No capture to release. */
      }
      if (cancelled) {
        setDragSelection(null);
        dragSelectionRef.current = null;
        return;
      }
      if (info.moved && dragSelectionRef.current) {
        setCursor(dragSelectionRef.current.end);
        notifySelection(dragSelectionRef.current);
      } else {
        setCursor(info.anchor);
        notifySelection(null);
      }
      setDragSelection(null);
      dragSelectionRef.current = null;
    },
    [notifySelection],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const activeSelection = liveSelection;
      if (event.key === 'Escape') {
        setKeyboardAnchor(null);
        notifySelection(null);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const from = keyboardAnchor ?? cursor;
        const next = clamp(cursor + direction, 0, Math.max(0, length));
        setCursor(next);
        if (event.shiftKey) {
          setKeyboardAnchor(from);
          notifySelection({
            start: Math.min(from, next),
            end: Math.max(from, next),
          });
        } else {
          setKeyboardAnchor(null);
          if (activeSelection) notifySelection(null);
        }
        scrollToVisible(next);
        return;
      }
      if (!onEdit) return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        if (activeSelection) {
          onEdit({
            type: 'delete',
            start: activeSelection.start,
            end: activeSelection.end,
          });
          setCursor(activeSelection.start);
          setKeyboardAnchor(null);
          notifySelection(null);
          return;
        }
        if (event.key === 'Backspace') {
          const start = circular ? mod(cursor - 1, Math.max(1, length)) : Math.max(0, cursor - 1);
          if (start === cursor) return;
          onEdit({ type: 'delete', start, end: cursor });
          setCursor(start);
          scrollToVisible(start);
        } else {
          if (cursor >= length) return;
          const end = circular ? mod(cursor + 1, Math.max(1, length)) : cursor + 1;
          onEdit({ type: 'delete', start: cursor, end });
          scrollToVisible(cursor);
        }
        return;
      }
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
      const base = event.key.toUpperCase();
      if (!/^[ACGTURYSWKMBDHVN]$/.test(base)) return;
      event.preventDefault();
      if (activeSelection) {
        onEdit({
          type: 'replace',
          start: activeSelection.start,
          end: activeSelection.end,
          bases: base,
        });
        const next = activeSelection.start + 1;
        setCursor(next);
        setKeyboardAnchor(null);
        notifySelection(null);
        scrollToVisible(next);
      } else {
        onEdit({ type: 'insert', position: cursor, bases: base });
        const next = mod(cursor + 1, Math.max(1, length + 1));
        setCursor(next);
        scrollToVisible(next);
      }
    },
    [
      liveSelection,
      notifySelection,
      cursor,
      length,
      onEdit,
      circular,
      scrollToVisible,
    ],
  );

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    latestScrollRef.current = event.currentTarget.scrollTop;
    if (rafRef.current !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      setScrollTop(latestScrollRef.current);
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const next = latestScrollRef.current;
      setScrollTop((previous) =>
        Math.floor(previous / layout.rowHeight) === Math.floor(next / layout.rowHeight)
          ? previous
          : next,
      );
    });
  }, [layout.rowHeight]);

  const toolbar = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexWrap: 'wrap',
        padding: '0 2px 8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 8,
            color: tokens.accent,
            background: tokens.accentSoft,
            flexShrink: 0,
          }}
        >
          <Dna size={16} />
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
            {doc.name || 'Untitled sequence'}
          </div>
          <div style={{ fontSize: 11, color: tokens.muted }}>
            {formatBp(length)} bp · {bpPerRow} bp per row · {totalRows} rows
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 10.5,
          color: tokens.muted,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <MousePointer2 size={12} /> drag to select
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Keyboard size={12} /> {onEdit ? 'type ACGT to edit' : 'read only'}
        </span>
        {liveSelection ? (
          <span style={{ fontFamily: tokens.fontMono, color: tokens.accent }}>
            {formatBp(liveSelectionLength)} bp
          </span>
        ) : null}
      </div>
    </div>
  );

  if (length <= 0) {
    return (
      <div
        style={{
          border: `1px solid ${tokens.border}`,
          borderRadius: 14,
          background: tokens.panel,
          padding: 28,
          color: tokens.muted,
          fontFamily: tokens.fontSans,
          fontSize: 13,
        }}
      >
        No sequence is available for this document.
      </div>
    );
  }

  const css = `
    .osg-linear-root * { box-sizing: border-box; }
    .osg-linear-scroll { scrollbar-color: ${tokens.faint} transparent; }
    .osg-linear-scroll::-webkit-scrollbar { width: 11px; height: 11px; }
    .osg-linear-scroll::-webkit-scrollbar-thumb { background: ${tokens.faint}; border-radius: 8px; border: 3px solid ${tokens.panel}; }
    .osg-linear-scroll:focus { outline: none; }
    .osg-linear-scroll:focus-visible { box-shadow: inset 0 0 0 2px ${tokens.accent}; }
    @keyframes osg-linear-caret { 0%, 46% { opacity: 1; } 54%, 100% { opacity: 0.12; } }
    .osg-linear-caret { animation: osg-linear-caret 1.05s steps(1) infinite; }
  `;

  return (
    <div
      className="osg-linear-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height,
        fontFamily: tokens.fontSans,
        color: tokens.text,
      }}
    >
      <style>{css}</style>
      {toolbar}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div
          ref={scrollRef}
          className="osg-linear-scroll"
          tabIndex={0}
          onScroll={handleScroll}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => finishDrag(event)}
          onPointerCancel={(event) => finishDrag(event, true)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            border: `1px solid ${focused ? tokens.accent : tokens.border}`,
            borderRadius: 14,
            background: tokens.panel,
            transition: 'border-color 140ms ease',
            touchAction: 'pan-y',
          }}
        >
          <div
            style={{
              position: 'relative',
              height: Math.max(layout.rowHeight, totalRows * layout.rowHeight),
              minWidth: viewportWidth,
            }}
          >
            {Array.from({ length: Math.max(0, visibleEnd - visibleStart + 1) }, (_, offset) => {
              const row = visibleStart + offset;
              if (row >= totalRows) return null;
              const rowStart = row * bpPerRow;
              const rowEnd = Math.min(length, rowStart + bpPerRow);
              const rowFeatures = featureRowMap.get(row) ?? [];
              const rowCuts = cutRowMap.get(row) ?? [];
              const rowPrimers = primerRowMap.get(row) ?? [];
              const rowCodons = translationRowMap.get(row) ?? [];
              const selectionRects = liveSelectionSegments
                .map((segment) => ({
                  start: Math.max(rowStart, segment.start),
                  end: Math.min(rowEnd, segment.end),
                }))
                .filter((segment) => segment.end > segment.start);

              const step = cell >= 5.5 ? 10 : 20;
              const rulerPositions: number[] = [];
              for (let p = Math.ceil(rowStart / step) * step; p < rowEnd; p += step) {
                rulerPositions.push(p);
              }

              return (
                <svg
                  key={row}
                  width={viewportWidth}
                  height={layout.rowHeight}
                  viewBox={`0 0 ${viewportWidth} ${layout.rowHeight}`}
                  style={{
                    position: 'absolute',
                    top: row * layout.rowHeight,
                    left: 0,
                    display: 'block',
                    cursor: 'text',
                  }}
                  onPointerDown={handleRowPointerDown}
                >
                  <rect
                    x={0}
                    y={0}
                    width={viewportWidth}
                    height={layout.rowHeight}
                    fill={row % 2 === 0 ? tokens.panel : tokens.background}
                  />
                  <rect x={0} y={0} width={GUTTER - 1} height={layout.rowHeight} fill={tokens.panelAlt} />
                  <line
                    x1={GUTTER - 1}
                    y1={0}
                    x2={GUTTER - 1}
                    y2={layout.rowHeight}
                    stroke={tokens.border}
                    strokeWidth={1}
                  />

                  <g pointerEvents="none">
                    <text x={9} y={layout.cutCenter + 3} fill={tokens.muted} fontSize={7.5} fontWeight={700} letterSpacing="0.08em">CUT</text>
                    <text x={9} y={layout.plusY + 4} fill={tokens.strandPlus} fontSize={9} fontWeight={700}>5′</text>
                    <text x={24} y={layout.plusY + 4} fill={tokens.muted} fontSize={7.5}>plus</text>
                    <text x={9} y={layout.minusY + 4} fill={tokens.strandMinus} fontSize={9} fontWeight={700}>3′</text>
                    <text x={24} y={layout.minusY + 4} fill={tokens.muted} fontSize={7.5}>minus</text>
                    {translationMode === 'none' ? null : translationMode === 'cds' ? (
                      <text x={9} y={layout.translationTop + 12} fill={tokens.muted} fontSize={7.5} fontWeight={700} letterSpacing="0.08em">AA</text>
                    ) : (
                      Array.from({ length: layout.translationLines }, (_, line) => {
                        const positive = translationMode === 'frame3' || line < 3;
                        const label = positive ? `F${line + 1}` : `R${line - 2}`;
                        return (
                          <text
                            key={`frame-label-${line}`}
                            x={9}
                            y={layout.translationTop + line * layout.translationLineHeight + 11}
                            fill={tokens.muted}
                            fontSize={7}
                            fontWeight={700}
                          >
                            {label}
                          </text>
                        );
                      })
                    )}
                    <text x={9} y={layout.featureTop + 14} fill={tokens.muted} fontSize={7.5} fontWeight={700} letterSpacing="0.08em">FTR</text>
                  </g>

                  <g pointerEvents="none">
                    {rulerPositions.map((position) => {
                      const x = GUTTER + (position - rowStart + 0.5) * cell;
                      return (
                        <g key={`ruler-${position}`}>
                          <line
                            x1={GUTTER + (position - rowStart) * cell}
                            y1={layout.minusY + 8}
                            x2={GUTTER + (position - rowStart) * cell}
                            y2={layout.rowHeight - 2}
                            stroke={tokens.grid}
                            strokeWidth={0.7}
                          />
                          <text x={x} y={9} textAnchor="middle" fill={tokens.faint} fontSize={7} fontFamily={tokens.fontMono}>
                            {position + 1}
                          </text>
                        </g>
                      );
                    })}
                    <line x1={GUTTER} y1={layout.cutTop - 1} x2={plotRight} y2={layout.cutTop - 1} stroke={tokens.grid} strokeWidth={0.6} />
                    <line x1={GUTTER} y1={layout.cutBottom + 1} x2={plotRight} y2={layout.cutBottom + 1} stroke={tokens.grid} strokeWidth={0.6} />
                    <line x1={GUTTER} y1={layout.featureTop - 3} x2={plotRight} y2={layout.featureTop - 3} stroke={tokens.grid} strokeWidth={0.6} />
                  </g>

                  {selectionRects.map((segment, index) => (
                    <rect
                      key={`sel-${row}-${index}`}
                      x={GUTTER + (segment.start - rowStart) * cell}
                      y={layout.cutTop - 2}
                      width={Math.max(0.5, (segment.end - segment.start) * cell)}
                      height={layout.featureTop + layout.featureHeight - layout.cutTop + 4}
                      fill={tokens.selection}
                      pointerEvents="none"
                    />
                  ))}

                  {rowCuts.map((cut) => {
                    const blocked = cut.isMethylationBlocked;
                    const single = cut.totalCutsInPlasmid === 1;
                    const topPos = mod(cut.cutPositionTop, Math.max(1, length));
                    const bottomPos = mod(cut.cutPositionBottom, Math.max(1, length));
                    const topX = clamp(GUTTER + (topPos - rowStart) * cell, GUTTER, plotRight);
                    const bottomX = clamp(GUTTER + (bottomPos - rowStart) * cell, GUTTER, plotRight);
                    const color = blocked ? tokens.blocked : single ? tokens.enzymeSingle : tokens.enzymeMulti;
                    const center = (topX + bottomX) / 2;
                    return (
                      <g key={`cut-${row}-${cut.id}`} pointerEvents="none">
                        <line x1={topX} y1={layout.cutTop} x2={topX} y2={layout.cutCenter} stroke={blocked ? tokens.blocked : tokens.cutTop} strokeWidth={single ? 1.5 : 1.1} strokeDasharray={blocked ? '2 2' : undefined} />
                        <line x1={bottomX} y1={layout.cutCenter} x2={bottomX} y2={layout.cutBottom} stroke={blocked ? tokens.blocked : tokens.cutBottom} strokeWidth={single ? 1.5 : 1.1} strokeDasharray={blocked ? '2 2' : undefined} />
                        <line x1={topX} y1={layout.cutCenter} x2={bottomX} y2={layout.cutCenter} stroke={color} strokeWidth={0.9} opacity={0.7} />
                        {single && cell >= 5 ? (
                          <text x={center} y={layout.cutTop - 3} textAnchor="middle" fill={color} fontSize={7} fontWeight={700}>
                            {cut.enzyme.name}
                          </text>
                        ) : null}
                        <title>
                          {`${cut.enzyme.name} · ${cut.overhangType} ${cut.overhangSeq || 'blunt'}\nTop ${cut.cutPositionTop + 1} · bottom ${cut.cutPositionBottom + 1}${blocked ? '\nBlocked by methylation' : ''}`}
                        </title>
                      </g>
                    );
                  })}

                  {rowPrimers.map((primer, index) => {
                    const segments = splitRange(
                      primer.bindingStart,
                      primer.bindingEnd,
                      length,
                      circular,
                    );
                    return segments.map((segment, segmentIndex) => {
                      if (segment.end <= rowStart || segment.start >= rowEnd) return null;
                      const clippedStart = Math.max(segment.start, rowStart);
                      const clippedEnd = Math.min(segment.end, rowEnd);
                      const x1 = GUTTER + (clippedStart - rowStart) * cell;
                      const x2 = GUTTER + (clippedEnd - rowStart) * cell;
                      const y =
                        primer.strand === 1
                          ? layout.cutTop + 3 + (index % 2) * 4
                          : layout.cutBottom - 3 - (index % 2) * 4;
                      const terminalVisible =
                        primer.strand === 1
                          ? segment.end <= rowEnd
                          : segment.start >= rowStart;
                      const direction = primer.strand;
                      const tipX = direction === 1 ? x2 : x1;
                      const tailLength = primer.tailSequence.length;
                      const tailX1 =
                        direction === 1 ? x1 - tailLength * cell : x2;
                      const tailX2 =
                        direction === 1 ? x1 : x2 + tailLength * cell;
                      const connectorX = direction === 1 ? x1 : x2;
                      return (
                        <g key={`primer-${row}-${primer.id}-${segmentIndex}`} pointerEvents="none">
                          {tailLength > 0 ? (
                            <g opacity={0.55}>
                              <line
                                x1={connectorX}
                                y1={y}
                                x2={connectorX}
                                y2={y - 5}
                                stroke={tokens.accent}
                                strokeWidth={1}
                              />
                              <line
                                x1={tailX1}
                                y1={y - 5}
                                x2={tailX2}
                                y2={y - 5}
                                stroke={tokens.accent}
                                strokeWidth={1}
                                strokeDasharray="2 2"
                              />
                            </g>
                          ) : null}
                          <polygon
                            points={primerPolygon(x1, x2, y, 3.6, direction)}
                            fill={tokens.accent}
                            opacity={0.92}
                          />
                          {terminalVisible ? (
                            <polygon
                              points={`${tipX},${y} ${tipX - direction * 5},${y - 3.6} ${tipX - direction * 5},${y + 3.6}`}
                              fill={tokens.accent}
                            />
                          ) : null}
                          {cell >= 6 && clippedEnd - clippedStart > 2 ? (
                            <text x={x1 + 2} y={y - 7} fill={tokens.accent} fontSize={7} fontWeight={600}>
                              {primer.name}
                            </text>
                          ) : null}
                          <title>
                            {`${primer.name} · Tm ${primer.tmAnnealing.toFixed(1)} °C\nBinding ${primer.bindingStart + 1}–${primer.bindingEnd}${tailLength > 0 ? `\n5′ tail ${primer.tailSequence}` : ''}`}
                          </title>
                        </g>
                      );
                    });
                  })}

                  <g pointerEvents="none">
                    {Array.from({ length: rowEnd - rowStart }, (_, offset) => {
                      const position = rowStart + offset;
                      const x = GUTTER + (offset + 0.5) * cell;
                      const plus = sequence[position] ?? '';
                      const minus = plus ? complementBase(plus) : '';
                      return (
                        <g key={`base-${position}`}>
                          {plus ? (
                            <text
                              x={x}
                              y={layout.plusY + baseFont * 0.35}
                              textAnchor="middle"
                              fill={baseColor(plus, tokens)}
                              fontSize={baseFont}
                              fontFamily={tokens.fontMono}
                              fontWeight={plus === 'N' ? 500 : 600}
                            >
                              {plus}
                            </text>
                          ) : null}
                          {minus ? (
                            <text
                              x={x}
                              y={layout.minusY + baseFont * 0.35}
                              textAnchor="middle"
                              fill={baseColor(minus, tokens)}
                              fontSize={baseFont}
                              fontFamily={tokens.fontMono}
                              opacity={0.86}
                            >
                              {minus}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
                  </g>

                  {translationMode !== 'none' ? (
                    <g pointerEvents="none">
                      {rowCodons.map((codon, index) => {
                        const x = GUTTER + (codon.pos - rowStart + 1.5) * cell;
                        if (x < GUTTER - 2 || x > plotRight + 2) return null;
                        if (translationMode === 'cds') {
                          const feature = codon.featureId
                            ? featureById.get(codon.featureId)
                            : undefined;
                          const color = feature?.color || tokens.accent;
                          const lineY = layout.translationTop + 18;
                          const aa = aaLabel(codon.aa, aaDisplay);
                          const aaColor =
                            codon.aa === 'M'
                              ? tokens.success
                              : codon.aa === '*'
                                ? tokens.warning
                                : tokens.text;
                          return (
                            <g key={`aa-${codon.featureId}-${codon.pos}-${index}`}>
                              <rect
                                x={GUTTER + (codon.pos - rowStart) * cell}
                                y={layout.translationTop + 1}
                                width={3 * cell}
                                height={19}
                                rx={2}
                                fill={hexToRgba(color, 0.10)}
                              />
                              {3 * cell >= 13 || codon.index % 5 === 1 ? (
                                <text
                                  x={GUTTER + (codon.pos - rowStart) * cell + 1.5}
                                  y={layout.translationTop + 8}
                                  fill={tokens.faint}
                                  fontSize={6.2}
                                  fontFamily={tokens.fontMono}
                                >
                                  {codon.index}
                                </text>
                              ) : null}
                              <text
                                x={x}
                                y={lineY}
                                textAnchor="middle"
                                fill={aaColor}
                                fontSize={aaDisplay === 'single' ? Math.min(9.5, cell * 1.3) : chordFont}
                                fontFamily={tokens.fontMono}
                                fontWeight={codon.aa === 'M' || codon.aa === '*' ? 700 : 500}
                              >
                                {aa}
                              </text>
                              <title>{`${codon.codon} → ${AMINO_ACID_NAME[codon.aa] ?? codon.aa} · codon ${codon.index}`}</title>
                            </g>
                          );
                        }
                        const lineIndex =
                          codon.frame > 0 ? codon.frame - 1 : 3 + Math.abs(codon.frame) - 1;
                        const y =
                          layout.translationTop + lineIndex * layout.translationLineHeight + 11;
                        const aaColor =
                          codon.aa === 'M'
                            ? tokens.success
                            : codon.aa === '*'
                              ? tokens.warning
                              : tokens.text;
                        return (
                          <text
                            key={`frame-${codon.frame}-${codon.pos}-${index}`}
                            x={x}
                            y={y}
                            textAnchor="middle"
                            fill={aaColor}
                            fontSize={aaDisplay === 'single' ? Math.min(8.5, cell * 1.2) : Math.min(7, cell * 1.7)}
                            fontFamily={tokens.fontMono}
                            fontWeight={codon.aa === 'M' || codon.aa === '*' ? 700 : 500}
                            opacity={codon.aa === '*' ? 0.95 : 0.82}
                          >
                            {aaLabel(codon.aa, aaDisplay)}
                          </text>
                        );
                      })}
                    </g>
                  ) : null}

                  <g>
                    {rowFeatures.map((entry, index) => {
                      const x1 = GUTTER + (entry.segment.start - rowStart) * cell;
                      const x2 = GUTTER + (entry.segment.end - rowStart) * cell;
                      const width = Math.max(0.8, x2 - x1);
                      const color = entry.feature.color || tokens.accent;
                      const y = layout.featureTop + layout.featureHeight / 2;
                      const height = Math.min(16, layout.featureHeight);
                      const showText = width > 26 && cell > 2.2;
                      const maxChars = Math.max(1, Math.floor((width - 8) / (8 * 0.58)));
                      const label =
                        entry.feature.name.length > maxChars
                          ? `${entry.feature.name.slice(0, Math.max(1, maxChars - 1))}…`
                          : entry.feature.name;
                      return (
                        <g key={`feature-${row}-${entry.feature.id}-${index}`}>
                          <title>
                            {`${entry.feature.name} · ${entry.feature.type}\n${entry.feature.start}–${entry.feature.end} · ${entry.feature.strand === -1 ? 'reverse' : entry.feature.strand === 1 ? 'forward' : 'no strand'}`}
                          </title>
                          <rect
                            x={x1}
                            y={y - height / 2}
                            width={width}
                            height={height}
                            rx={Math.min(5, width / 2)}
                            fill={hexToRgba(color, theme === 'publication' ? 0.20 : 0.24)}
                            stroke={color}
                            strokeWidth={1}
                          />
                          {entry.feature.strand === 1 && entry.isTrueEnd ? (
                            <polygon
                              points={featureArrowPoints(Math.max(x1, x2 - 7), x2, y, height, 1)}
                              fill={color}
                            />
                          ) : entry.feature.strand === -1 && entry.isTrueStart ? (
                            <polygon
                              points={featureArrowPoints(x1, Math.min(x2, x1 + 7), y, height, -1)}
                              fill={color}
                            />
                          ) : null}
                          {showText ? (
                            <text
                              x={x1 + 4}
                              y={y + 3.4}
                              fill={tokens.text}
                              fontSize={8.5}
                              fontWeight={600}
                              pointerEvents="none"
                            >
                              {label}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}
                  </g>

                  {cursor >= rowStart &&
                  (cursor < rowEnd || (row === totalRows - 1 && cursor === length)) ? (
                    <g pointerEvents="none" className="osg-linear-caret">
                      <line
                        x1={GUTTER + (cursor - rowStart) * cell}
                        y1={layout.cutTop - 1}
                        x2={GUTTER + (cursor - rowStart) * cell}
                        y2={layout.featureTop + layout.featureHeight}
                        stroke={tokens.accent}
                        strokeWidth={1.5}
                      />
                      <polygon
                        points={`${GUTTER + (cursor - rowStart) * cell - 3.5},${layout.cutTop - 4} ${GUTTER + (cursor - rowStart) * cell + 3.5},${layout.cutTop - 4} ${GUTTER + (cursor - rowStart) * cell},${layout.cutTop + 1}`}
                        fill={tokens.accent}
                      />
                    </g>
                  ) : null}
                </svg>
              );
            })}
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          paddingTop: 6,
          fontSize: 10,
          color: tokens.muted,
        }}
      >
        <span>
          Row {Math.min(totalRows, Math.floor(scrollTop / layout.rowHeight) + 1)} / {totalRows}
          {' · '}
          {trimNumber((Math.min(length, scrollTop / layout.rowHeight * bpPerRow + bpPerRow) / Math.max(1, length)) * 100)}% · {formatBp(length)} bp
        </span>
        <span>Selection {liveSelection ? `${formatBp(liveSelectionLength)} bp` : 'none'}</span>
      </div>
    </div>
  );
}
