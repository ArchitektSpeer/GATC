// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Display options shared by the circular and linear maps.
 *
 * The option objects are intentionally plain and serialisable so they can be
 * stored in the application state or persisted with an exported figure.
 */

import type { SequenceFeature } from '../../types/schema';

export interface MapDisplayOptions {
  /** Feature types that should not be drawn. */
  hiddenFeatureTypes?: string[];
  showFeatures?: boolean;
  showEnzymes?: boolean;
  showPrimers?: boolean;
  showOrfs?: boolean;
  showFeatureLabels?: boolean;
  showEnzymeLabels?: boolean;
  labelFontSize?: number;
  showTicks?: boolean;
  tickInterval?: number | 'auto';
  /** Sliding-window GC content curve. */
  showGcPlot?: boolean;
  /** Sticky-end chevrons for linear fragments. */
  showLinearEnds?: boolean;
  title?: string;
  showLength?: boolean;
}

export interface ResolvedMapDisplayOptions {
  hiddenFeatureTypes: string[];
  showFeatures: boolean;
  showEnzymes: boolean;
  showPrimers: boolean;
  showOrfs: boolean;
  showFeatureLabels: boolean;
  showEnzymeLabels: boolean;
  labelFontSize: number;
  showTicks: boolean;
  tickInterval: number | 'auto';
  showGcPlot: boolean;
  showLinearEnds: boolean;
  title: string;
  showLength: boolean;
}

export const MIN_LABEL_FONT_SIZE = 7;
export const MAX_LABEL_FONT_SIZE = 20;

export const DEFAULT_MAP_DISPLAY_OPTIONS: ResolvedMapDisplayOptions = {
  hiddenFeatureTypes: [],
  showFeatures: true,
  showEnzymes: true,
  showPrimers: true,
  showOrfs: true,
  showFeatureLabels: true,
  showEnzymeLabels: true,
  labelFontSize: 11,
  showTicks: true,
  tickInterval: 'auto',
  showGcPlot: false,
  showLinearEnds: true,
  title: '',
  showLength: true,
};

function finiteBoolean(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function resolveTickInterval(value: number | 'auto' | undefined): number | 'auto' {
  if (value === undefined || value === 'auto') return 'auto';
  if (!Number.isFinite(value) || value <= 0) return 'auto';
  return Math.max(1, Math.round(value));
}

/** Fill defaults and clamp values into their valid ranges. */
export function resolveMapDisplayOptions(
  options?: MapDisplayOptions | null,
): ResolvedMapDisplayOptions {
  if (!options) return { ...DEFAULT_MAP_DISPLAY_OPTIONS };
  const fontSize =
    typeof options.labelFontSize === 'number' && Number.isFinite(options.labelFontSize)
      ? Math.min(
          MAX_LABEL_FONT_SIZE,
          Math.max(MIN_LABEL_FONT_SIZE, Math.round(options.labelFontSize)),
        )
      : DEFAULT_MAP_DISPLAY_OPTIONS.labelFontSize;
  return {
    hiddenFeatureTypes: Array.isArray(options.hiddenFeatureTypes)
      ? options.hiddenFeatureTypes.filter((type) => typeof type === 'string')
      : [],
    showFeatures: finiteBoolean(options.showFeatures, true),
    showEnzymes: finiteBoolean(options.showEnzymes, true),
    showPrimers: finiteBoolean(options.showPrimers, true),
    showOrfs: finiteBoolean(options.showOrfs, true),
    showFeatureLabels: finiteBoolean(options.showFeatureLabels, true),
    showEnzymeLabels: finiteBoolean(options.showEnzymeLabels, true),
    labelFontSize: fontSize,
    showTicks: finiteBoolean(options.showTicks, true),
    tickInterval: resolveTickInterval(options.tickInterval),
    showGcPlot: finiteBoolean(options.showGcPlot, false),
    showLinearEnds: finiteBoolean(options.showLinearEnds, true),
    title: typeof options.title === 'string' ? options.title : '',
    showLength: finiteBoolean(options.showLength, true),
  };
}

/** True when a feature passes the hidden-type and visibility filters. */
export function isFeatureVisible(
  feature: SequenceFeature,
  options: ResolvedMapDisplayOptions,
): boolean {
  if (!options.showFeatures) return false;
  return !options.hiddenFeatureTypes.includes(feature.type);
}

export function filterVisibleFeatures(
  features: SequenceFeature[],
  options: ResolvedMapDisplayOptions,
): SequenceFeature[] {
  return features.filter((feature) => isFeatureVisible(feature, options));
}

/**
 * Resolve a visibility option while preserving the legacy `showPrimers` prop:
 * an explicit `displayOptions.showPrimers` wins, otherwise the prop decides.
 */
export function resolvePrimerVisibility(
  propValue: boolean,
  options: ResolvedMapDisplayOptions | null,
): boolean {
  return options ? options.showPrimers : propValue;
}
