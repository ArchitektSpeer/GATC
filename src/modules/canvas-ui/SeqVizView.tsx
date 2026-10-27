// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo } from 'react';
import SeqViz from 'seqviz';
import type { SeqVizProps } from 'seqviz';
import type { CutSite, PlasmidDocument, SelectionRange } from '../../types/schema';

export interface SeqVizViewProps {
  doc: PlasmidDocument;
  cutSites: CutSite[];
  viewer?: 'circular' | 'linear' | 'both';
  selection: SelectionRange | null;
  onSelectionChange?: (sel: SelectionRange | null) => void;
}

export function SeqVizView({
  doc,
  cutSites,
  viewer = 'both',
  selection,
  onSelectionChange,
}: SeqVizViewProps) {
  const annotations = useMemo(
    () =>
      doc.features.map((feature) => ({
        name: feature.name,
        start: feature.start,
        end: feature.end,
        direction: feature.strand === -1 ? -1 : feature.strand === 1 ? 1 : 0,
        color: feature.color,
      })),
    [doc.features],
  );

  const primers = useMemo(
    () =>
      doc.primers.map((primer) => ({
        name: primer.name,
        start: primer.bindingStart,
        end: primer.bindingEnd,
        direction: primer.strand,
        color: '#0284c7',
      })),
    [doc.primers],
  );

  const translations = useMemo(
    () =>
      doc.features
        .filter((feature) => feature.type === 'CDS')
        .map((feature) => ({
          name: feature.name,
          start: feature.start,
          end: feature.end,
          direction: feature.strand === -1 ? -1 : 1,
          color: feature.color,
        })),
    [doc.features],
  );

  const enzymes = useMemo(() => {
    const byName = new Map<
      string,
      { name: string; rseq: string; fcut: number; rcut: number; color: string }
    >();
    for (const cut of cutSites) {
      if (byName.has(cut.enzyme.name)) continue;
      byName.set(cut.enzyme.name, {
        name: cut.enzyme.name,
        rseq: cut.enzyme.recognitionSeq.toUpperCase(),
        fcut: cut.enzyme.cutIndexTop,
        rcut: cut.enzyme.cutIndexBottom,
        color: cut.isMethylationBlocked ? '#94a3b8' : '#0f172a',
      });
    }
    return [...byName.values()];
  }, [cutSites]);

  const handleSelection: NonNullable<SeqVizProps['onSelection']> = (next) => {
    if (!onSelectionChange) return;
    if (
      typeof next.start === 'number' &&
      typeof next.end === 'number' &&
      next.start !== next.end
    ) {
      onSelectionChange({ start: next.start, end: next.end });
    } else {
      onSelectionChange(null);
    }
  };

  const props: SeqVizProps = {
    seq: doc.sequence,
    seqType: 'dna',
    name: doc.name,
    viewer,
    annotations,
    primers,
    translations,
    enzymes,
    selection: selection ? { start: selection.start, end: selection.end } : undefined,
    onSelection: handleSelection,
    showComplement: true,
    showIndex: true,
    showAnnotations: true,
    rotateOnScroll: true,
    disableExternalFonts: true,
    zoom: { linear: 50, circular: 0 },
    style: {
      width: '100%',
      minHeight: 560,
      fontFamily:
        '"Inter", "Helvetica Neue", "Segoe UI", system-ui, -apple-system, sans-serif',
    },
  };

  return (
    <div
      className="osg-seqviz-root"
      style={{
        width: '100%',
        minHeight: 580,
        overflow: 'auto',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        background: '#ffffff',
        color: '#0f172a',
      }}
    >
      <SeqViz {...props} />
    </div>
  );
}
