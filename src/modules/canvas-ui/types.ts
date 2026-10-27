// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import type * as React from 'react';
import type {
  CloningHistoryNode,
  CutSite,
  ORF,
  PlasmidDocument,
  SangerTraceData,
  SelectionRange,
  SequenceFeature,
  VirtualGelLane,
} from '../../types/schema';
import type { VizTheme } from './theme';
import type { MapDisplayOptions } from './mapDisplayOptions';
import type { ProteinDocument } from './layout/proteinLayout';

export type { VizTheme };

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

export interface MapDisplayOptionsPanelProps {
  value: MapDisplayOptions;
  onChange: (value: MapDisplayOptions) => void;
  featureTypes: string[];
}

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

export interface SangerAlignmentViewerProps {
  doc: PlasmidDocument;
  traces: SangerTraceData[];
  theme?: VizTheme;
  height?: number;
  showCoverage?: boolean;
  onCoverageClick?: (position: number) => void;
}

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

export interface CloningHistoryTreeProps {
  history: CloningHistoryNode[];
  selectedId?: string | null;
  onSelectNode?: (id: string) => void;
  theme?: VizTheme;
}

export interface SeqVizViewProps {
  doc: PlasmidDocument;
  cutSites: CutSite[];
  viewer?: 'circular' | 'linear' | 'both';
  selection: SelectionRange | null;
  onSelectionChange?: (sel: SelectionRange | null) => void;
}
