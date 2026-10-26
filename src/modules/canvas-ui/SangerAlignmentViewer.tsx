import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Dna, ScanLine } from 'lucide-react';
import type { PlasmidDocument, SangerTraceData } from '../../types/schema';
import type { VizTheme } from './theme';
import { baseColor, getTheme } from './theme';
import { clamp, formatBp, niceTickStep, trimNumber } from './utils';
import {
  buildMutationList,
  buildReferenceAminoAcids,
  buildSangerWindow,
  buildTraceMapping,
  MUTATION_LABEL,
  type SangerMutationEntry,
} from './layout/sangerLayout';
import { complementBase } from './layout/linearLayout';

export interface SangerAlignmentViewerProps {
  doc: PlasmidDocument;
  traces: SangerTraceData[];
  theme?: VizTheme;
  height?: number;
}

const LABEL_WIDTH = 142;
const QUALITY_HEIGHT = 24;
const TRACE_HEIGHT = 106;
const LETTER_HEIGHT = 20;
const CANVAS_HEIGHT = QUALITY_HEIGHT + TRACE_HEIGHT + LETTER_HEIGHT;

interface ChromatogramProps {
  trace: SangerTraceData;
  windowStart: number;
  windowEnd: number;
  plotWidth: number;
  baseWidth: number;
  tokens: ReturnType<typeof getTheme>;
  mismatches: Array<{ refIndex: number; key: string }>;
  selectedKey: string | null;
  rowIndex: number;
}

function ChromatogramCanvas({
  trace,
  windowStart,
  windowEnd,
  plotWidth,
  baseWidth,
  tokens,
  mismatches,
  selectedKey,
  rowIndex,
}: ChromatogramProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapping = useMemo(
    () => buildTraceMapping(trace, windowStart, windowEnd),
    [trace, windowStart, windowEnd],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || plotWidth <= 0) return;
    const dpr = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;
    canvas.width = Math.max(1, Math.round(plotWidth * dpr));
    canvas.height = Math.max(1, Math.round(CANVAS_HEIGHT * dpr));
    canvas.style.width = `${plotWidth}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, plotWidth, CANVAS_HEIGHT);

    const xForRef = (ref: number) =>
      (ref - windowStart + 0.5) * baseWidth;

    const peakTop = QUALITY_HEIGHT + 5;
    const peakBottom = QUALITY_HEIGHT + TRACE_HEIGHT;
    const peakAmp = TRACE_HEIGHT - 16;

    ctx.fillStyle = tokens.background;
    ctx.fillRect(0, 0, plotWidth, QUALITY_HEIGHT);
    ctx.strokeStyle = tokens.border;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, QUALITY_HEIGHT + 0.5);
    ctx.lineTo(plotWidth, QUALITY_HEIGHT + 0.5);
    ctx.stroke();

    const trimStart = trace.trimRange?.[0] ?? 0;
    const trimEnd = trace.trimRange?.[1] ?? trace.calledSequence.length - 1;
    const mappedIndices = [...mapping.keys()].sort((a, b) => a - b);
    for (const queryIndex of mappedIndices) {
      const location = mapping.get(queryIndex);
      if (!location) continue;
      if (location.ref < windowStart || location.ref >= windowEnd) continue;
      const x = xForRef(location.ref);
      const quality = trace.qualityScores[queryIndex] ?? 0;
      const trimmedOut = queryIndex < trimStart || queryIndex > trimEnd;
      if (trimmedOut) {
        ctx.fillStyle = tokens.warningSoft;
        ctx.fillRect(x - baseWidth / 2, peakTop, Math.max(0.5, baseWidth), peakAmp);
      }
      const barHeight = (clamp(quality, 0, 62) / 62) * (QUALITY_HEIGHT - 3);
      ctx.fillStyle = trimmedOut
        ? tokens.warningSoft
        : quality < 20
          ? tokens.warningSoft
          : tokens.grid;
      ctx.fillRect(x - Math.max(0.35, baseWidth * 0.31), QUALITY_HEIGHT - barHeight - 1, Math.max(0.7, baseWidth * 0.62), barHeight);
      ctx.fillStyle = quality < 20 ? tokens.warning : tokens.faint;
      if (baseWidth >= 3.5) {
        ctx.save();
        ctx.globalAlpha = 0.24;
        ctx.fillRect(
          x - baseWidth * 0.3,
          peakTop,
          Math.max(0.4, baseWidth * 0.6),
          peakAmp * (clamp(quality, 0, 62) / 62) * 0.18,
        );
        ctx.restore();
      }
    }

    const rawMax = Math.max(
      1,
      maxOf(trace.traces.A),
      maxOf(trace.traces.T),
      maxOf(trace.traces.G),
      maxOf(trace.traces.C),
    );
    const channels: Array<{ key: 'A' | 'T' | 'G' | 'C'; color: string }> = [
      { key: 'A', color: tokens.baseA },
      { key: 'C', color: tokens.baseC },
      { key: 'G', color: tokens.baseG },
      { key: 'T', color: tokens.baseT },
    ];

    const getPoints = (values: number[]): Array<{ x: number; y: number }> => {
      const points: Array<{ x: number; y: number }> = [];
      let previousX = Number.NEGATIVE_INFINITY;
      const pushPoint = (x: number, value: number) => {
        if (x <= previousX + 0.005) return;
        const y = peakBottom - clamp(value / rawMax, 0, 1) * peakAmp;
        points.push({ x, y });
        previousX = x;
      };
      for (let index = 0; index < mappedIndices.length - 1; index += 1) {
        const queryIndex = mappedIndices[index];
        const nextQueryIndex = mappedIndices[index + 1];
        const location = mapping.get(queryIndex);
        const nextLocation = mapping.get(nextQueryIndex);
        if (!location || !nextLocation) continue;
        if (
          location.ref < windowStart ||
          location.ref >= windowEnd ||
          nextLocation.ref < windowStart ||
          nextLocation.ref >= windowEnd
        ) {
          continue;
        }
        const x0 = xForRef(location.ref) - (location.gap ? baseWidth * 0.4 : 0);
        let x1 = xForRef(nextLocation.ref) + (nextLocation.gap ? baseWidth * 0.4 : 0);
        if (x1 - x0 <= 0.001) x1 = x0 + Math.max(1, baseWidth * 0.4);
        const span = x1 - x0;
        const sampleStart = trace.baseLocations[queryIndex] ?? 0;
        let sampleEnd = trace.baseLocations[nextQueryIndex] ?? sampleStart + 1;
        if (sampleEnd <= sampleStart) sampleEnd = sampleStart + 1;
        const steps = Math.min(
          56,
          Math.max(3, Math.round((sampleEnd - sampleStart) * Math.min(1, Math.max(0.25, baseWidth / 6)))),
        );
        for (let step = 0; step <= steps; step += 1) {
          const ratio = step / steps;
          const sampleIndex = Math.round(sampleStart + (sampleEnd - sampleStart) * ratio);
          pushPoint(x0 + span * ratio, values[sampleIndex] ?? 0);
        }
      }
      const lastIndex = mappedIndices[mappedIndices.length - 1];
      if (lastIndex !== undefined) {
        const location = mapping.get(lastIndex);
        if (location && location.ref >= windowStart && location.ref < windowEnd) {
          const sampleIndex = trace.baseLocations[lastIndex] ?? 0;
          pushPoint(xForRef(location.ref), values[sampleIndex] ?? 0);
        }
      }
      return points;
    };

    const drawSmooth = (points: Array<{ x: number; y: number }>, fill: boolean) => {
      if (points.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(points[0].x, fill ? peakBottom : points[0].y);
      if (fill) ctx.lineTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        const previous = points[i - 1];
        const point = points[i];
        const midX = (previous.x + point.x) / 2;
        const midY = (previous.y + point.y) / 2;
        ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
      if (fill) {
        ctx.lineTo(last.x, peakBottom);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.stroke();
      }
    };

    for (const channel of channels) {
      const points = getPoints(trace.traces[channel.key]);
      ctx.save();
      ctx.strokeStyle = channel.color;
      ctx.fillStyle = channel.color;
      ctx.lineWidth = 1.15;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.10;
      drawSmooth(points, true);
      ctx.globalAlpha = 0.92;
      drawSmooth(points, false);
      ctx.restore();
    }

    ctx.strokeStyle = tokens.border;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, peakBottom + 0.5);
    ctx.lineTo(plotWidth, peakBottom + 0.5);
    ctx.stroke();

    for (const mismatch of mismatches) {
      if (mismatch.refIndex < windowStart || mismatch.refIndex >= windowEnd) continue;
      const x = xForRef(mismatch.refIndex);
      const selected = mismatch.key === selectedKey;
      ctx.save();
      ctx.strokeStyle = tokens.warning;
      ctx.globalAlpha = selected ? 0.95 : 0.55;
      ctx.lineWidth = selected ? 1.8 : 1;
      ctx.setLineDash(selected ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, QUALITY_HEIGHT + 2);
      ctx.lineTo(x, peakBottom);
      ctx.stroke();
      ctx.restore();
      if (selected) {
        ctx.fillStyle = tokens.warningSoft;
        ctx.fillRect(x - Math.max(2, baseWidth / 2), QUALITY_HEIGHT + 2, Math.max(4, baseWidth), peakAmp);
      }
    }

    if (baseWidth >= 4.6) {
      const fontSize = Math.min(11, Math.max(7, baseWidth * 0.84));
      ctx.font = `600 ${fontSize}px ${tokens.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const queryIndex of mappedIndices) {
        const location = mapping.get(queryIndex);
        if (!location || location.ref < windowStart || location.ref >= windowEnd) continue;
        const base = trace.calledSequence[queryIndex] ?? '';
        if (!base) continue;
        const x = xForRef(location.ref);
        ctx.fillStyle = baseColor(base, tokens);
        ctx.fillText(base, x, peakBottom + LETTER_HEIGHT / 2 + 1);
      }
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 8.5px ${tokens.fontMono}`;
    ctx.fillStyle = tokens.faint;
    ctx.fillText(`Q${Math.round(average(trace.qualityScores))}`, 4, 8);

    if (trace.trimRange && trace.trimRange[0] > 0 && baseWidth >= 1) {
      const startLocation = mapping.get(Math.max(0, trimStart));
      if (startLocation) {
        ctx.fillStyle = tokens.warningSoft;
        ctx.fillRect(0, QUALITY_HEIGHT + 1, Math.max(0, xForRef(startLocation.ref)), 2);
      }
    }

  }, [
    trace,
    mapping,
    plotWidth,
    baseWidth,
    windowStart,
    windowEnd,
    tokens,
    mismatches,
    selectedKey,
    rowIndex,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: plotWidth, height: CANVAS_HEIGHT }}
      aria-label={`${trace.fileName} chromatogram`}
    />
  );
}

function maxOf(values: number[]): number {
  let max = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > max) max = values[i];
  }
  return max;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return sum / values.length;
}

export function SangerAlignmentViewer({
  doc,
  traces,
  theme = 'light',
  height = 680,
}: SangerAlignmentViewerProps) {
  const tokens = getTheme(theme);
  const plotRootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const clearTimerRef = useRef<number | null>(null);
  const [plotRootWidth, setPlotRootWidth] = useState(760);
  const [selectedMutation, setSelectedMutation] = useState<string | null>(null);

  const windowInfo = useMemo(() => buildSangerWindow(doc, traces), [doc, traces]);
  const plotWidth = Math.max(240, plotRootWidth - LABEL_WIDTH);
  const baseWidth = plotWidth / Math.max(1, windowInfo.span);
  const scale = useMemo(() => {
    const step = niceTickStep(windowInfo.span, Math.max(6, Math.floor(plotWidth / 74)));
    const ticks: number[] = [];
    for (let p = Math.ceil(windowInfo.start / step) * step; p <= windowInfo.end; p += step) {
      ticks.push(p);
    }
    return { step, ticks };
  }, [windowInfo, plotWidth]);
  const mutations = useMemo(() => buildMutationList(traces), [traces]);
  const aminoAcids = useMemo(
    () => buildReferenceAminoAcids(doc, windowInfo.start, windowInfo.end),
    [doc, windowInfo],
  );
  const referenceBases = useMemo(() => {
    const seq = doc.sequence.toUpperCase();
    const out: string[] = [];
    for (let i = windowInfo.start; i < windowInfo.end; i += 1) {
      out.push(seq[i] ?? 'N');
    }
    return out;
  }, [doc.sequence, windowInfo]);
  const meanIdentity = useMemo(() => {
    const aligned = traces.filter((trace) => trace.alignment);
    if (aligned.length === 0) return null;
    return (
      aligned.reduce((sum, trace) => sum + (trace.alignment?.identityPercent ?? 0), 0) /
      aligned.length
    );
  }, [traces]);

  useEffect(() => {
    const element = plotRootRef.current;
    if (!element) return undefined;
    const measure = () => setPlotRootWidth(Math.max(360, element.clientWidth || 760));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    },
    [],
  );

  const focusMutation = (mutation: SangerMutationEntry) => {
    setSelectedMutation(mutation.key);
    const container = scrollRef.current;
    const row = rowRefs.current[mutation.rowIndex];
    if (container && row) {
      const headerHeight = 116;
      const target = Math.max(0, row.offsetTop - headerHeight - 8);
      container.scrollTo({ top: target, behavior: 'smooth' });
    }
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => setSelectedMutation(null), 2200);
  };

  const css = `
    .osg-sanger-scroll { scrollbar-color: ${tokens.faint} transparent; }
    .osg-sanger-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
    .osg-sanger-scroll::-webkit-scrollbar-thumb { background: ${tokens.faint}; border-radius: 8px; border: 2px solid ${tokens.panel}; }
    @keyframes osg-sanger-pulse { 0%, 100% { box-shadow: inset 0 0 0 1px ${tokens.warning}; } 50% { box-shadow: inset 0 0 0 2px ${tokens.warning}; } }
    .osg-sanger-row-selected { animation: osg-sanger-pulse 1.1s ease-in-out infinite; }
  `;

  return (
    <div
      className="osg-sanger-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height,
        minHeight: 380,
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
            <ScanLine size={17} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {doc.name || 'Untitled reference'}
            </div>
            <div style={{ fontSize: 11, color: tokens.muted }}>
              {formatBp(windowInfo.start + 1)}–{formatBp(windowInfo.end)} · {traces.length} reads
              {meanIdentity !== null ? ` · ${trimNumber(meanIdentity, 1)}% identity` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
          {(['A', 'T', 'G', 'C'] as const).map((base) => (
            <span key={base} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: tokens.muted }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: baseColor(base, tokens) }} />
              {base}
            </span>
          ))}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: mutations.length > 0 ? tokens.warning : tokens.muted }}>
            <AlertTriangle size={12} />
            {mutations.length} variant{mutations.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div ref={plotRootRef} style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {traces.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                color: tokens.muted,
                background: tokens.panel,
              }}
            >
              <Dna size={30} strokeWidth={1.4} />
              <div style={{ fontSize: 13, fontWeight: 600 }}>No sequencing reads loaded</div>
              <div style={{ fontSize: 11.5 }}>Open one or more .ab1 traces to align against this reference.</div>
            </div>
          ) : (
            <div ref={scrollRef} className="osg-sanger-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: tokens.panel }}>
              <div style={{ position: 'relative', minWidth: '100%' }}>
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 4,
                    display: 'flex',
                    background: tokens.panelAlt,
                    borderBottom: `1px solid ${tokens.border}`,
                    boxShadow: `0 4px 12px -10px ${tokens.shadow}`,
                  }}
                >
                  <div style={{ width: LABEL_WIDTH, flexShrink: 0, padding: '10px 10px', borderRight: `1px solid ${tokens.border}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: tokens.muted }}>REFERENCE</div>
                    <div style={{ fontSize: 10.5, color: tokens.muted, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {doc.name}
                    </div>
                    <div style={{ fontSize: 10, color: tokens.faint, fontFamily: tokens.fontMono, marginTop: 2 }}>
                      {formatBp(windowInfo.span)} bp
                    </div>
                  </div>
                  <svg width={plotWidth} height={116} viewBox={`0 0 ${plotWidth} 116`} style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
                    <rect width={plotWidth} height={116} fill={tokens.panelAlt} />
                    {scale.ticks.map((position) => {
                      const x = (position - windowInfo.start + 0.5) * baseWidth;
                      return (
                        <g key={`scale-${position}`}>
                          <line x1={x} y1={18} x2={x} y2={26} stroke={tokens.faint} strokeWidth={0.8} />
                          <text x={x} y={12} textAnchor="middle" fill={tokens.muted} fontSize={8.5} fontFamily={tokens.fontMono}>
                            {position + 1}
                          </text>
                          <line x1={x} y1={26} x2={x} y2={100} stroke={tokens.grid} strokeWidth={0.5} />
                        </g>
                      );
                    })}
                    {Array.from({ length: windowInfo.span }, (_, offset) => {
                      const position = windowInfo.start + offset;
                      const x = (offset + 0.5) * baseWidth;
                      const base = referenceBases[offset] ?? 'N';
                      return (
                        <g key={`ref-base-${position}`}>
                          {baseWidth >= 5 ? (
                            <>
                              <text x={x} y={44} textAnchor="middle" fill={baseColor(base, tokens)} fontSize={Math.min(12, baseWidth * 0.92)} fontFamily={tokens.fontMono} fontWeight={600}>
                                {base}
                              </text>
                              <text x={x} y={61} textAnchor="middle" fill={baseColor(complementBase(base), tokens)} fontSize={Math.min(11, baseWidth * 0.82)} fontFamily={tokens.fontMono} opacity={0.7}>
                                {complementBase(base)}
                              </text>
                            </>
                          ) : (
                            <rect x={x - 0.5} y={38} width={Math.max(0.7, baseWidth * 0.7)} height={26} fill={baseColor(base, tokens)} opacity={0.24} />
                          )}
                        </g>
                      );
                    })}
                    {aminoAcids.map((codon) => {
                      const x = (codon.pos - windowInfo.start + 1.5) * baseWidth;
                      if (x < 0 || x > plotWidth) return null;
                      return (
                        <text
                          key={`ref-aa-${codon.pos}-${codon.index}`}
                          x={x}
                          y={82}
                          textAnchor="middle"
                          fill={codon.aa === 'M' ? tokens.success : codon.aa === '*' ? tokens.warning : tokens.muted}
                          fontSize={Math.max(7, Math.min(10, baseWidth * 2.6))}
                          fontFamily={tokens.fontMono}
                          fontWeight={codon.aa === 'M' || codon.aa === '*' ? 700 : 500}
                        >
                          {codon.aa}
                        </text>
                      );
                    })}
                    {mutations.map((mutation) => {
                      if (mutation.refIndex < windowInfo.start || mutation.refIndex >= windowInfo.end) return null;
                      const x = (mutation.refIndex - windowInfo.start + 0.5) * baseWidth;
                      const selected = mutation.key === selectedMutation;
                      return (
                        <g key={`ref-mut-${mutation.key}`}>
                          <line x1={x} y1={25} x2={x} y2={99} stroke={tokens.warning} strokeWidth={selected ? 1.9 : 1.1} strokeDasharray={selected ? undefined : '2 3'} opacity={selected ? 0.95 : 0.6} />
                          <circle cx={x} cy={100} r={selected ? 2.8 : 2.1} fill={tokens.warning} />
                        </g>
                      );
                    })}
                    <line x1={0} y1={100.5} x2={plotWidth} y2={100.5} stroke={tokens.border} strokeWidth={0.7} />
                    <text x={4} y={111} fill={tokens.faint} fontSize={8} fontFamily={tokens.fontMono}>
                      {windowInfo.start + 1}
                    </text>
                    <text x={plotWidth - 4} y={111} textAnchor="end" fill={tokens.faint} fontSize={8} fontFamily={tokens.fontMono}>
                      {windowInfo.end}
                    </text>
                  </svg>
                </div>

                {traces.map((trace, rowIndex) => {
                  const rowMutations = mutations
                    .filter((mutation) => mutation.traceId === trace.id)
                    .map((mutation) => ({ refIndex: mutation.refIndex, key: mutation.key }));
                  const selectedRow = rowMutations.some((m) => m.key === selectedMutation);
                  return (
                    <div
                      key={trace.id}
                      ref={(node) => {
                        rowRefs.current[rowIndex] = node;
                      }}
                      className={selectedRow ? 'osg-sanger-row-selected' : undefined}
                      style={{
                        display: 'flex',
                        borderBottom: `1px solid ${tokens.border}`,
                        background: selectedRow ? tokens.warningSoft : tokens.panel,
                        transition: 'background 160ms ease',
                      }}
                    >
                      <div
                        style={{
                          width: LABEL_WIDTH,
                          flexShrink: 0,
                          padding: '10px 10px',
                          borderRight: `1px solid ${tokens.border}`,
                          background: tokens.panel,
                          minWidth: 0,
                        }}
                      >
                        <div style={{ fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={trace.fileName}>
                          {trace.fileName}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, fontSize: 9.5, color: tokens.muted }}>
                          <Activity size={10} />
                          Q̄ {Math.round(average(trace.qualityScores))}
                          {trace.alignment ? ` · ${trimNumber(trace.alignment.identityPercent, 1)}%` : ''}
                        </div>
                        <div style={{ fontSize: 9.5, color: tokens.faint, fontFamily: tokens.fontMono, marginTop: 2 }}>
                          {formatBp(trace.calledSequence.length)} bases
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                          {rowMutations.slice(0, 4).map((mutation) => (
                            <span key={mutation.key} style={{ width: 5, height: 5, borderRadius: 99, background: tokens.warning }} />
                          ))}
                          {rowMutations.length > 4 ? (
                            <span style={{ fontSize: 8.5, color: tokens.warning }}>+{rowMutations.length - 4}</span>
                          ) : null}
                        </div>
                      </div>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <ChromatogramCanvas
                          trace={trace}
                          windowStart={windowInfo.start}
                          windowEnd={windowInfo.end}
                          plotWidth={plotWidth}
                          baseWidth={baseWidth}
                          tokens={tokens}
                          mismatches={rowMutations}
                          selectedKey={selectedMutation}
                          rowIndex={rowIndex}
                        />
                      </div>
                    </div>
                  );
                })}
                <div style={{ height: 12 }} />
              </div>
            </div>
          )}
        </div>

        {mutations.length > 0 ? (
          <aside
            style={{
              width: 286,
              flexShrink: 0,
              borderLeft: `1px solid ${tokens.border}`,
              background: tokens.panel,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${tokens.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: tokens.muted }}>VARIANTS</div>
              <div style={{ fontSize: 11, color: tokens.muted, marginTop: 3 }}>
                Click a variant to center its chromatogram.
              </div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '6px' }}>
              {mutations.map((mutation) => {
                const selected = mutation.key === selectedMutation;
                return (
                  <button
                    key={mutation.key}
                    type="button"
                    onClick={() => focusMutation(mutation)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      border: `1px solid ${selected ? tokens.warning : tokens.border}`,
                      background: selected ? tokens.warningSoft : tokens.panelAlt,
                      borderRadius: 9,
                      padding: '7px 8px',
                      marginBottom: 5,
                      cursor: 'pointer',
                      color: tokens.text,
                      fontFamily: tokens.fontSans,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700 }}>
                        {MUTATION_LABEL[mutation.type]}
                      </span>
                      <span style={{ fontSize: 9.5, color: tokens.muted, fontFamily: tokens.fontMono }}>
                        {formatBp(mutation.refIndex + 1)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, fontFamily: tokens.fontMono, fontSize: 11 }}>
                      <span style={{ color: baseColor(mutation.refBase, tokens) }}>{mutation.refBase || '–'}</span>
                      <span style={{ color: tokens.faint }}>→</span>
                      <span style={{ color: baseColor(mutation.queryBase, tokens) }}>{mutation.queryBase || '–'}</span>
                      <span style={{ marginLeft: 4, color: tokens.muted, fontFamily: tokens.fontSans, fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {mutation.fileName}
                      </span>
                    </div>
                    {mutation.impact ? (
                      <div style={{ marginTop: 3, fontSize: 9.5, color: tokens.muted }}>{mutation.impact}</div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '6px 12px', borderTop: `1px solid ${tokens.border}`, background: tokens.panel, fontSize: 9.5, color: tokens.muted }}>
        <span>Quality bars: Q20 threshold. Shaded regions mark bases outside Mott trimming.</span>
        <span style={{ fontFamily: tokens.fontMono }}>
          {formatBp(windowInfo.span)} bp window · {trimNumber(baseWidth, 2)} px/base
        </span>
      </div>
    </div>
  );
}

