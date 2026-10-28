// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { useId, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { FlaskConical, Microscope, Sun, Timer, Zap } from 'lucide-react';
import type { VirtualGelLane } from '../../types/schema';
import { getTheme } from './theme';
import { clamp, formatBp, trimNumber } from './utils';
import {
  bandFillColor,
  bandThickness,
  effectiveMigrationY,
  fragmentSourceOf,
  migrationMultiplier,
  normalizeGelParams,
  spreadLabels,
} from './layout/gelLayout';

export interface VirtualGelSimulatorProps {
  lanes: VirtualGelLane[];
  agarosePercent: number;
  voltage: number;
  minutes: number;
  onParamsChange?: (p: {
    agarosePercent: number;
    voltage: number;
    minutes: number;
  }) => void;
  mode?: 'uv' | 'publication';
  onModeChange?: (m: 'uv' | 'publication') => void;
}

interface HoverBand {
  laneIndex: number;
  bandIndex: number;
  x: number;
  y: number;
}

const GEL = { x: 104, y: 92, width: 752, height: 404 };

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function conformationLabel(value: VirtualGelLane['bands'][number]['conformation']): string {
  if (value === 'supercoiled') return 'supercoiled';
  if (value === 'nicked') return 'nicked / open circle';
  return 'linear';
}

export function VirtualGelSimulator({
  lanes,
  agarosePercent,
  voltage,
  minutes,
  onParamsChange,
  mode,
  onModeChange,
}: VirtualGelSimulatorProps) {
  const [localMode, setLocalMode] = useState<'uv' | 'publication'>('uv');
  const activeMode = mode ?? localMode;
  const tokens = getTheme(activeMode === 'uv' ? 'dark' : 'publication');
  const params = useMemo(
    () => normalizeGelParams({ agarosePercent, voltage, minutes }),
    [agarosePercent, voltage, minutes],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rawUid = useId();
  const uid = safeId(rawUid);
  const [hover, setHover] = useState<HoverBand | null>(null);

  const laneWidth = GEL.width / Math.max(1, lanes.length);
  const multiplier = useMemo(() => migrationMultiplier(params), [params]);

  /** Where a band sits on the gel, in the picture's own coordinates. */
  const bandY = (migrationY: number) => GEL.y + 58 + effectiveMigrationY(migrationY, params) * (GEL.height - 76);
  /**
   * A ladder's sizes crowd together at both ends of the gel, so the numbers are pushed
   * apart until none covers another; a leader is drawn wherever one had to move.
   */
  const ladderLabelY = useMemo(() => {
    const map = new Map<number, number[]>();
    lanes.forEach((lane, laneIndex) => {
      if (!lane.isLadder) return;
      const desired = lane.bands.map((band) => bandY(band.migrationY) + 2.8);
      map.set(laneIndex, spreadLabels(desired, 8, GEL.y + 58, GEL.y + GEL.height - 8));
    });
    return map;
  }, [lanes, params]);

  const update = (partial: Partial<typeof params>) => {
    onParamsChange?.(normalizeGelParams({ ...params, ...partial }));
  };

  const chooseMode = (nextMode: 'uv' | 'publication') => {
    if (mode === undefined) setLocalMode(nextMode);
    onModeChange?.(nextMode);
  };

  const showBand = (
    event: React.MouseEvent<SVGGElement>,
    laneIndex: number,
    bandIndex: number,
  ) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      laneIndex,
      bandIndex,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const hoveredLane = hover ? lanes[hover.laneIndex] : undefined;
  const hoveredBand = hoveredLane?.bands[hover?.bandIndex ?? -1];
  const source = hoveredBand?.fragmentDoc
    ? fragmentSourceOf(hoveredBand.fragmentDoc)
    : null;

  const css = `
    .osg-gel-range { -webkit-appearance: none; appearance: none; width: 100%; height: 5px; border-radius: 999px; outline: none; cursor: pointer; }
    .osg-gel-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: ${tokens.panel}; border: 2px solid ${tokens.accent}; box-shadow: 0 1px 3px ${tokens.shadow}; cursor: pointer; }
    .osg-gel-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: ${tokens.panel}; border: 2px solid ${tokens.accent}; box-shadow: 0 1px 3px ${tokens.shadow}; cursor: pointer; }
    .osg-gel-mode { transition: background 160ms ease, color 160ms ease, border-color 160ms ease; }
  `;

  const tooltipWidth = 264;
  const rootWidth = rootRef.current?.clientWidth ?? 960;
  const rootHeight = rootRef.current?.clientHeight ?? 720;
  const tooltipLeft = hover
    ? clamp(hover.x + 16, 8, Math.max(8, rootWidth - tooltipWidth - 8))
    : 0;
  const tooltipTop = hover
    ? hover.y + 150 > rootHeight
      ? Math.max(8, hover.y - 142)
      : hover.y + 16
    : 0;

  return (
    <div
      ref={rootRef}
      className="osg-gel-root"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        width: '100%',
        fontFamily: tokens.fontSans,
        color: tokens.text,
        background: tokens.background,
        border: `1px solid ${tokens.border}`,
        borderRadius: 18,
        padding: 14,
        boxSizing: 'border-box',
      }}
    >
      <style>{css}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 10,
              background: tokens.accentSoft,
              color: tokens.accent,
              flexShrink: 0,
            }}
          >
            <FlaskConical size={18} />
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Virtual agarose gel</div>
            <div style={{ fontSize: 11, color: tokens.muted }}>
              {trimNumber(params.agarosePercent, 1)}% agarose · {params.voltage} V · {params.minutes} min · {lanes.length} lanes
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'inline-flex',
            padding: 3,
            borderRadius: 10,
            border: `1px solid ${tokens.border}`,
            background: tokens.panelAlt,
            gap: 2,
          }}
        >
          <button
            type="button"
            className="osg-gel-mode"
            onClick={() => chooseMode('uv')}
            style={modeButton(tokens, activeMode === 'uv')}
          >
            <Sun size={13} /> UV
          </button>
          <button
            type="button"
            className="osg-gel-mode"
            onClick={() => chooseMode('publication')}
            style={modeButton(tokens, activeMode === 'publication')}
          >
            <Microscope size={13} /> Publication
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
          padding: 12,
          border: `1px solid ${tokens.border}`,
          borderRadius: 12,
          background: tokens.panel,
        }}
      >
        <Slider
          icon={<FlaskConical size={13} />}
          label="Agarose"
          value={params.agarosePercent}
          min={0.5}
          max={3}
          step={0.1}
          display={`${trimNumber(params.agarosePercent, 1)}%`}
          tokens={tokens}
          onChange={(value) => update({ agarosePercent: value })}
        />
        <Slider
          icon={<Zap size={13} />}
          label="Voltage"
          value={params.voltage}
          min={20}
          max={250}
          step={5}
          display={`${params.voltage} V`}
          tokens={tokens}
          onChange={(value) => update({ voltage: value })}
        />
        <Slider
          icon={<Timer size={13} />}
          label="Run time"
          value={params.minutes}
          min={10}
          max={180}
          step={5}
          display={`${params.minutes} min`}
          tokens={tokens}
          onChange={(value) => update({ minutes: value })}
        />
      </div>

      <div style={{ position: 'relative', width: '100%' }}>
        <svg
          viewBox="0 0 960 540"
          width="100%"
          role="img"
          aria-label="Simulated agarose gel electrophoresis"
          style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 14 }}
        >
          <defs>
            <linearGradient id={`osg-gel-buffer-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={activeMode === 'uv' ? '#071726' : '#f8fafc'} />
              <stop offset="100%" stopColor={activeMode === 'uv' ? '#0b2136' : '#eef2f6'} />
            </linearGradient>
            <linearGradient id={`osg-gel-slab-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={activeMode === 'uv' ? '#10283a' : '#f1f5f9'} />
              <stop offset="100%" stopColor={activeMode === 'uv' ? '#0a1c2b' : '#e6ebf1'} />
            </linearGradient>
            <pattern id={`osg-gel-grain-${uid}`} width="18" height="18" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="5" r="0.65" fill={activeMode === 'uv' ? '#94e6e1' : '#64748b'} opacity="0.16" />
              <circle cx="13" cy="14" r="0.5" fill={activeMode === 'uv' ? '#94e6e1' : '#64748b'} opacity="0.12" />
            </pattern>
            <filter id={`osg-gel-glow-${uid}`} x="-30%" y="-80%" width="160%" height="260%">
              <feGaussianBlur stdDeviation="2.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <clipPath id={`osg-gel-clip-${uid}`}>
              <rect x={GEL.x} y={GEL.y} width={GEL.width} height={GEL.height} rx={10} />
            </clipPath>
          </defs>

          <rect width="960" height="540" rx="14" fill={activeMode === 'uv' ? '#040b14' : '#ffffff'} />
          <rect x="26" y="24" width="908" height="492" rx="16" fill={`url(#osg-gel-buffer-${uid})`} stroke={activeMode === 'uv' ? '#1b3a52' : '#d9dee5'} strokeWidth="1.2" />
          <text x="48" y="52" fill={activeMode === 'uv' ? '#7fa7bc' : '#64748b'} fontSize="9.5" fontWeight="700" letterSpacing="0.16em">
            {activeMode === 'uv' ? 'UV TRANSILLUMINATOR · 302 nm' : 'AGAROSE GEL · REVERSE-PHASE VIEW'}
          </text>
          <text x="912" y="52" textAnchor="end" fill={activeMode === 'uv' ? '#7fa7bc' : '#64748b'} fontSize="9.5" fontFamily={tokens.fontMono}>
            {trimNumber(multiplier, 2)}× mobility
          </text>

          <rect x="52" y="156" width="13" height="168" rx="4" fill={activeMode === 'uv' ? '#142d40' : '#e2e8f0'} stroke={activeMode === 'uv' ? '#2a5068' : '#cbd5e1'} />
          <text x="58.5" y="145" textAnchor="middle" fill={activeMode === 'uv' ? '#7dd3fc' : '#64748b'} fontSize="15" fontWeight="700">−</text>
          <rect x="895" y="156" width="13" height="168" rx="4" fill={activeMode === 'uv' ? '#3a1620' : '#e2e8f0'} stroke={activeMode === 'uv' ? '#6b2634' : '#cbd5e1'} />
          <text x="901.5" y="145" textAnchor="middle" fill={activeMode === 'uv' ? '#fb7185' : '#b91c1c'} fontSize="15" fontWeight="700">+</text>

          <rect x={GEL.x} y={GEL.y} width={GEL.width} height={GEL.height} rx="10" fill={`url(#osg-gel-slab-${uid})`} stroke={activeMode === 'uv' ? '#1d4258' : '#cfd6de'} strokeWidth="1.2" />
          <rect x={GEL.x} y={GEL.y} width={GEL.width} height={GEL.height} rx="10" fill={`url(#osg-gel-grain-${uid})`} />
          <g clipPath={`url(#osg-gel-clip-${uid})`}>
            {lanes.map((lane, laneIndex) => {
              const laneX = GEL.x + laneIndex * laneWidth;
              return (
                <g key={`lane-bg-${lane.id}`}>
                  <rect
                    x={laneX}
                    y={GEL.y}
                    width={laneWidth}
                    height={GEL.height}
                    fill={
                      activeMode === 'uv'
                        ? laneIndex % 2 === 0
                          ? 'rgba(94, 234, 212, 0.018)'
                          : 'transparent'
                        : laneIndex % 2 === 0
                          ? 'rgba(148, 163, 184, 0.045)'
                          : 'transparent'
                    }
                  />
                  <line
                    x1={laneX}
                    y1={GEL.y + 8}
                    x2={laneX}
                    y2={GEL.y + GEL.height - 8}
                    stroke={activeMode === 'uv' ? 'rgba(125, 211, 252, 0.08)' : 'rgba(100, 116, 139, 0.11)'}
                    strokeWidth="0.7"
                  />
                </g>
              );
            })}

            <g>
              <line x1={GEL.x + 12} y1={GEL.y + 44} x2={GEL.x + GEL.width - 12} y2={GEL.y + 44} stroke={activeMode === 'uv' ? 'rgba(125, 211, 252, 0.14)' : 'rgba(100, 116, 139, 0.16)'} strokeWidth="0.8" />
              <text x={GEL.x + 15} y={GEL.y + 39} fill={activeMode === 'uv' ? '#5f8ba1' : '#94a3b8'} fontSize="7.5" letterSpacing="0.12em">
                WELLS
              </text>
            </g>

            {lanes.map((lane, laneIndex) => {
              const laneX = GEL.x + laneIndex * laneWidth;
              const center = laneX + laneWidth / 2;
              const wellWidth = laneWidth * 0.64;
              return (
                <g key={`lane-${lane.id}`}>
                  <rect
                    x={center - wellWidth / 2}
                    y={GEL.y + 16}
                    width={wellWidth}
                    height={10}
                    rx={2}
                    fill={activeMode === 'uv' ? '#02070d' : '#cbd5e1'}
                    stroke={activeMode === 'uv' ? '#21445a' : '#b6c0ca'}
                    strokeWidth="0.8"
                  />
                  {lane.isLadder ? (
                    <text x={center} y={GEL.y + 38} textAnchor="middle" fill={activeMode === 'uv' ? '#7dd3fc' : '#475569'} fontSize="7" fontWeight="700">
                      LADDER
                    </text>
                  ) : null}
                </g>
              );
            })}

            {lanes.map((lane, laneIndex) => {
              const laneX = GEL.x + laneIndex * laneWidth;
              const center = laneX + laneWidth / 2;
              const bandWidth = Math.max(4, laneWidth * 0.72);
              return lane.bands.map((band, bandIndex) => {
                const y = GEL.y + 58 + effectiveMigrationY(band.migrationY, params) * (GEL.height - 76);
                const height = bandThickness(band.sizeBp);
                const color = bandFillColor(laneIndex, band.relativeIntensity, activeMode);
                const hovered = hover?.laneIndex === laneIndex && hover?.bandIndex === bandIndex;
                return (
                  <g
                    key={`${lane.id}-${bandIndex}`}
                    onMouseEnter={(event) => showBand(event, laneIndex, bandIndex)}
                    onMouseMove={(event) => showBand(event, laneIndex, bandIndex)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'crosshair' }}
                  >
                    <rect
                      x={center - bandWidth / 2 - (hovered ? 2 : 0)}
                      y={y - height / 2 - (hovered ? 1.5 : 0)}
                      width={bandWidth + (hovered ? 4 : 0)}
                      height={height + (hovered ? 3 : 0)}
                      rx={height / 2}
                      fill={color}
                      opacity={hovered ? 1 : clamp(0.48 + band.relativeIntensity * 0.52, 0.42, 1)}
                      filter={activeMode === 'uv' ? `url(#osg-gel-glow-${uid})` : undefined}
                      stroke={hovered ? (activeMode === 'uv' ? '#f0fdfa' : '#0f172a') : 'none'}
                      strokeWidth={hovered ? 1 : 0}
                    />
                    {lane.isLadder && band.sizeBp >= 100
                      ? (() => {
                          const labelY = ladderLabelY.get(laneIndex)?.[bandIndex] ?? y + 2.8;
                          const labelX = center + bandWidth / 2 + 7;
                          const moved = Math.abs(labelY - (y + 2.8)) > 1;
                          return (
                            <g pointerEvents="none">
                              {moved ? (
                                <polyline
                                  points={`${center + bandWidth / 2 + 1},${y} ${labelX - 2},${labelY - 2.4}`}
                                  fill="none"
                                  stroke={activeMode === 'uv' ? '#8aa9ba' : '#94a3b8'}
                                  strokeWidth="0.5"
                                  opacity={0.5}
                                />
                              ) : null}
                              <text
                                x={labelX}
                                y={labelY}
                                fill={activeMode === 'uv' ? '#8aa9ba' : '#64748b'}
                                fontSize="7"
                                fontFamily={tokens.fontMono}
                                opacity={0.8}
                              >
                                {band.sizeBp}
                              </text>
                            </g>
                          );
                        })()
                      : null}
                    <title>{`${lane.label} · ${formatBp(band.sizeBp)} bp`}</title>
                  </g>
                );
              });
            })}
          </g>

          {lanes.map((lane, laneIndex) => {
            const laneX = GEL.x + laneIndex * laneWidth;
            const center = laneX + laneWidth / 2;
            return (
              <text
                key={`lane-label-${lane.id}`}
                x={center + 2}
                y={GEL.y - 10}
                transform={`rotate(-38 ${center + 2} ${GEL.y - 10})`}
                textAnchor="start"
                fill={activeMode === 'uv' ? '#8fb3c4' : '#475569'}
                fontSize={lanes.length > 14 ? 7 : 8.5}
                fontWeight={lane.isLadder ? 700 : 500}
              >
                {lane.label}
              </text>
            );
          })}

          <g pointerEvents="none">
            <line x1="930" y1={GEL.y + 60} x2="930" y2={GEL.y + GEL.height - 44} stroke={activeMode === 'uv' ? '#3d6a82' : '#94a3b8'} strokeWidth="1" strokeDasharray="3 4" />
            <polygon
              points={`926,${GEL.y + GEL.height - 50} 934,${GEL.y + GEL.height - 50} 930,${GEL.y + GEL.height - 40}`}
              fill={activeMode === 'uv' ? '#3d6a82' : '#94a3b8'}
            />
            <text x="938" y={GEL.y + GEL.height / 2} fill={activeMode === 'uv' ? '#5f8ba1' : '#94a3b8'} fontSize="7.5" letterSpacing="0.12em" transform={`rotate(90 938 ${GEL.y + GEL.height / 2})`} textAnchor="middle">
              MIGRATION
            </text>
          </g>

          <text x={GEL.x} y="522" fill={activeMode === 'uv' ? '#5f8ba1' : '#94a3b8'} fontSize="8.5" fontFamily={tokens.fontMono}>
            {trimNumber(params.agarosePercent, 1)}% · {params.voltage} V · {params.minutes} min
          </text>
          <text x={GEL.x + GEL.width} y="522" textAnchor="end" fill={activeMode === 'uv' ? '#5f8ba1' : '#94a3b8'} fontSize="8.5">
            {activeMode === 'uv' ? 'Fluorescence detection' : 'Coomassie / reverse-phase contrast'}
          </text>
        </svg>

        {hover && hoveredLane && hoveredBand ? (
          <div
            style={{
              position: 'absolute',
              left: tooltipLeft,
              top: tooltipTop,
              width: tooltipWidth,
              pointerEvents: 'none',
              background: tokens.tooltipBackground,
              color: tokens.tooltipText,
              border: `1px solid ${tokens.border}`,
              borderRadius: 10,
              padding: '9px 10px',
              boxShadow: `0 14px 34px -18px ${tokens.shadow}`,
              fontSize: 10.5,
              lineHeight: 1.5,
              zIndex: 5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: tokens.fontMono, fontWeight: 700, fontSize: 13 }}>
                {formatBp(hoveredBand.sizeBp)} bp
              </span>
              <span style={{ opacity: 0.68 }}>{hoveredLane.label}</span>
            </div>
            <div style={{ opacity: 0.78, marginTop: 2 }}>
              Apparent {formatBp(Math.round(hoveredBand.apparentBp))} bp · {trimNumber(hoveredBand.relativeIntensity * 100, 1)}% mass
            </div>
            <div style={{ opacity: 0.78 }}>
              {conformationLabel(hoveredBand.conformation)}
              {hoveredBand.fragmentDoc ? ` · ${formatBp(hoveredBand.fragmentDoc.length)} bp fragment` : ''}
            </div>
            {source ? (
              <>
                <div style={{ marginTop: 4, opacity: 0.72 }}>
                  Source {source.rangeLabel} · {formatBp(source.length)} bp
                </div>
                <div style={{ opacity: 0.72 }}>Left {source.leftOverhang}</div>
                <div style={{ opacity: 0.72 }}>Right {source.rightOverhang}</div>
              </>
            ) : (
              <div style={{ marginTop: 4, opacity: 0.55 }}>No linked fragment document</div>
            )}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 9.5, color: tokens.muted }}>
        <span>Hover any band for size, mass fraction, source coordinates and overhangs.</span>
        <span style={{ fontFamily: tokens.fontMono }}>
          {lanes.reduce((sum, lane) => sum + lane.bands.length, 0)} bands
        </span>
      </div>
    </div>
  );
}

interface SliderProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  tokens: ReturnType<typeof getTheme>;
  onChange: (value: number) => void;
}

function Slider({
  icon,
  label,
  value,
  min,
  max,
  step,
  display,
  tokens,
  onChange,
}: SliderProps) {
  const percent = clamp(((value - min) / Math.max(0.0001, max - min)) * 100, 0, 100);
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 10.5 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: tokens.muted }}>
          {icon}
          {label}
        </span>
        <span style={{ fontFamily: tokens.fontMono, fontWeight: 700, color: tokens.text }}>{display}</span>
      </span>
      <input
        className="osg-gel-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          background: `linear-gradient(90deg, ${tokens.accent} 0%, ${tokens.accent} ${percent}%, ${tokens.faint} ${percent}%, ${tokens.faint} 100%)`,
        }}
      />
    </label>
  );
}

function modeButton(
  tokens: ReturnType<typeof getTheme>,
  active: boolean,
): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: `1px solid ${active ? tokens.border : 'transparent'}`,
    background: active ? tokens.panel : 'transparent',
    color: active ? tokens.text : tokens.muted,
    borderRadius: 7,
    padding: '5px 9px',
    fontSize: 10.5,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: tokens.fontSans,
    boxShadow: active ? `0 1px 2px ${tokens.shadow}` : 'none',
  };
}

