// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
export type VizTheme = 'light' | 'dark' | 'publication';

export interface VizThemeTokens {
  mode: VizTheme;
  background: string;
  panel: string;
  panelAlt: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  grid: string;
  ring: string;
  accent: string;
  accentSoft: string;
  selection: string;
  selectionStroke: string;
  warning: string;
  warningSoft: string;
  success: string;
  baseA: string;
  baseT: string;
  baseG: string;
  baseC: string;
  baseN: string;
  cutTop: string;
  cutBottom: string;
  enzymeSingle: string;
  enzymeMulti: string;
  blocked: string;
  featureStroke: string;
  strandPlus: string;
  strandMinus: string;
  gelBackground: string;
  gelSurface: string;
  gelBand: string;
  gelGlow: string;
  tooltipBackground: string;
  tooltipText: string;
  shadow: string;
  fontSans: string;
  fontMono: string;
}

const SANS =
  '"Inter", "Helvetica Neue", "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO =
  '"JetBrains Mono", "SFMono-Regular", "Roboto Mono", Menlo, Consolas, monospace';

export const THEMES: Record<VizTheme, VizThemeTokens> = {
  light: {
    mode: 'light',
    background: '#f7f9fc',
    panel: '#ffffff',
    panelAlt: '#f1f5f9',
    text: '#0f172a',
    muted: '#64748b',
    faint: '#cbd5e1',
    border: '#e2e8f0',
    grid: '#e8edf4',
    ring: '#cbd5e1',
    accent: '#0284c7',
    accentSoft: 'rgba(2, 132, 199, 0.14)',
    selection: 'rgba(2, 132, 199, 0.17)',
    selectionStroke: '#0369a1',
    warning: '#ea580c',
    warningSoft: 'rgba(234, 88, 12, 0.16)',
    success: '#15803d',
    baseA: '#15803d',
    baseT: '#b91c1c',
    baseG: '#334155',
    baseC: '#1d4ed8',
    baseN: '#78716c',
    cutTop: '#dc2626',
    cutBottom: '#2563eb',
    enzymeSingle: '#0f172a',
    enzymeMulti: '#64748b',
    blocked: '#94a3b8',
    featureStroke: 'rgba(15, 23, 42, 0.30)',
    strandPlus: '#0f172a',
    strandMinus: '#64748b',
    gelBackground: '#0b1120',
    gelSurface: '#172033',
    gelBand: '#d7f9ed',
    gelGlow: '#5eead4',
    tooltipBackground: '#0f172a',
    tooltipText: '#f8fafc',
    shadow: 'rgba(15, 23, 42, 0.16)',
    fontSans: SANS,
    fontMono: MONO,
  },
  dark: {
    mode: 'dark',
    background: '#070c16',
    panel: '#0d1524',
    panelAlt: '#111c30',
    text: '#e5edf9',
    muted: '#93a4bd',
    faint: '#26364f',
    border: '#1d2c43',
    grid: '#162238',
    ring: '#334763',
    accent: '#38bdf8',
    accentSoft: 'rgba(56, 189, 248, 0.14)',
    selection: 'rgba(56, 189, 248, 0.20)',
    selectionStroke: '#7dd3fc',
    warning: '#fb923c',
    warningSoft: 'rgba(251, 146, 60, 0.18)',
    success: '#4ade80',
    baseA: '#4ade80',
    baseT: '#fb7185',
    baseG: '#cbd5e1',
    baseC: '#60a5fa',
    baseN: '#a8a29e',
    cutTop: '#f87171',
    cutBottom: '#60a5fa',
    enzymeSingle: '#e2e8f0',
    enzymeMulti: '#93a4bd',
    blocked: '#64748b',
    featureStroke: 'rgba(226, 232, 240, 0.26)',
    strandPlus: '#e2e8f0',
    strandMinus: '#93a4bd',
    gelBackground: '#040812',
    gelSurface: '#0e2033',
    gelBand: '#ccfbf1',
    gelGlow: '#2dd4bf',
    tooltipBackground: '#e2e8f0',
    tooltipText: '#0b1120',
    shadow: 'rgba(0, 0, 0, 0.55)',
    fontSans: SANS,
    fontMono: MONO,
  },
  publication: {
    mode: 'publication',
    background: '#ffffff',
    panel: '#ffffff',
    panelAlt: '#f5f5f4',
    text: '#111111',
    muted: '#4b5563',
    faint: '#d6d3d1',
    border: '#d4d4d4',
    grid: '#eeeeee',
    ring: '#a8a8a8',
    accent: '#0f4c81',
    accentSoft: 'rgba(15, 76, 129, 0.10)',
    selection: 'rgba(15, 76, 129, 0.12)',
    selectionStroke: '#0f4c81',
    warning: '#b45309',
    warningSoft: 'rgba(180, 83, 9, 0.12)',
    success: '#166534',
    baseA: '#0072b2',
    baseT: '#d55e00',
    baseG: '#000000',
    baseC: '#009e73',
    baseN: '#555555',
    cutTop: '#b2182b',
    cutBottom: '#2166ac',
    enzymeSingle: '#111111',
    enzymeMulti: '#555555',
    blocked: '#9ca3af',
    featureStroke: 'rgba(0, 0, 0, 0.55)',
    strandPlus: '#111111',
    strandMinus: '#555555',
    gelBackground: '#ffffff',
    gelSurface: '#f4f4f4',
    gelBand: '#1f2937',
    gelGlow: '#111827',
    tooltipBackground: '#ffffff',
    tooltipText: '#111111',
    shadow: 'rgba(0, 0, 0, 0.13)',
    fontSans: SANS,
    fontMono: MONO,
  },
};

export function getTheme(theme: VizTheme = 'light'): VizThemeTokens {
  return THEMES[theme] ?? THEMES.light;
}

export function baseColor(base: string, theme: VizThemeTokens): string {
  switch (base.toUpperCase()) {
    case 'A':
      return theme.baseA;
    case 'T':
    case 'U':
      return theme.baseT;
    case 'G':
      return theme.baseG;
    case 'C':
      return theme.baseC;
    default:
      return theme.baseN;
  }
}

export const OPERATION_LABEL: Record<string, string> = {
  import: 'Import',
  restriction_ligation: 'Restriction / Ligation',
  gibson_assembly: 'Gibson Assembly',
  golden_gate: 'Golden Gate',
  gateway_bp: 'Gateway BP',
  gateway_lr: 'Gateway LR',
  pcr: 'PCR',
  soe_pcr: 'SOE-PCR',
  site_directed_mutagenesis: 'Site-directed Mutagenesis',
  blunting: 'Blunting',
  oligo_annealing: 'Oligo Annealing',
  manual_edit: 'Manual Edit',
};

export const OPERATION_TINT: Record<string, string> = {
  import: '#64748b',
  restriction_ligation: '#0284c7',
  gibson_assembly: '#7c3aed',
  golden_gate: '#c2410c',
  gateway_bp: '#0f766e',
  gateway_lr: '#0e7490',
  pcr: '#be123c',
  soe_pcr: '#a21caf',
  site_directed_mutagenesis: '#b45309',
  blunting: '#475569',
  oligo_annealing: '#0d9488',
  manual_edit: '#15803d',
};

export const FEATURE_PALETTE = [
  '#0284c7',
  '#7c3aed',
  '#0891b2',
  '#16a34a',
  '#d97706',
  '#db2777',
  '#4f46e5',
  '#0d9488',
];
