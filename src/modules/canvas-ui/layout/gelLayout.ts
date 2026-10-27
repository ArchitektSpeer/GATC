// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import type { PlasmidDocument, VirtualGelLane } from '../../../types/schema';
import { clamp } from '../utils';

export interface GelParams {
  agarosePercent: number;
  voltage: number;
  minutes: number;
}

export function normalizeGelParams(params: GelParams): GelParams {
  return {
    agarosePercent: clamp(params.agarosePercent, 0.5, 3),
    voltage: clamp(params.voltage, 10, 300),
    minutes: clamp(params.minutes, 1, 240),
  };
}

/**
 * Relative mobility from agarose concentration and run parameters. The result
 * multiplies the supplied normalized migration distance of each band.
 */
export function migrationMultiplier(params: GelParams): number {
  const { agarosePercent, voltage, minutes } = normalizeGelParams(params);
  const run = clamp(0.16 + (voltage / 120) * 0.6 * (minutes / 45), 0, 1);
  const gel = Math.pow(1.0 / agarosePercent, 0.22);
  return clamp(0.4 + run * 0.85 * gel, 0.22, 1.28);
}

export function effectiveMigrationY(
  migrationY: number,
  params: GelParams,
): number {
  return clamp(migrationY * migrationMultiplier(params), 0.02, 1);
}

export function bandThickness(sizeBp: number): number {
  const log = Math.log10(Math.max(10, sizeBp));
  return clamp(2.3 + log / 1.15, 2.6, 9.5);
}

export interface FragmentSource {
  rangeLabel: string;
  leftOverhang: string;
  rightOverhang: string;
  length: number;
}

export function fragmentSourceOf(doc: PlasmidDocument | undefined): FragmentSource | null {
  if (!doc) return null;
  let range: [number, number] | null = null;
  for (let i = doc.history.length - 1; i >= 0 && !range; i -= 1) {
    const snapshots = doc.history[i].parentSnapshots ?? [];
    for (const snapshot of snapshots) {
      if (snapshot.extractedRange) {
        range = snapshot.extractedRange;
        break;
      }
    }
  }
  const left = doc.linearEnds?.left;
  const right = doc.linearEnds?.right;
  const describe = (
    end: typeof left | undefined,
  ): string => {
    if (!end) return '—';
    if (end.type === 'blunt') return 'blunt';
    return `${end.type} ${end.sequence || '—'}${end.phosphorylated ? ' (5′-P)' : ''}`;
  };
  return {
    rangeLabel: range ? `${range[0] + 1}–${range[1]}` : `1–${doc.length}`,
    leftOverhang: describe(left),
    rightOverhang: describe(right),
    length: doc.length,
  };
}

export function bandFillColor(
  laneIndex: number,
  intensity: number,
  mode: 'uv' | 'publication',
): string {
  const palette = [
    '#5eead4',
    '#a7f3d0',
    '#fde68a',
    '#f9a8d4',
    '#c4b5fd',
    '#93c5fd',
    '#fca5a5',
    '#bae6fd',
  ];
  if (mode === 'publication') {
    const alpha = 0.45 + clamp(intensity, 0, 1) * 0.5;
    return `rgba(24, 39, 56, ${alpha.toFixed(2)})`;
  }
  return palette[laneIndex % palette.length];
}

export function laneTotalMass(lane: VirtualGelLane): number {
  return lane.bands.reduce(
    (sum, band) => sum + Math.max(0, band.sizeBp) * Math.max(0.1, band.relativeIntensity),
    0,
  );
}

export function totalLaneCount(lanes: VirtualGelLane[]): number {
  return Math.max(1, lanes.length);
}
