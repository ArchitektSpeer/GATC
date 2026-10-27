// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure print-HTML generation.
 *
 * Kept free of DOM access so the markup can be unit tested in Node and reused
 * by a worker that renders printable documents.
 */

import type { PlasmidDocument, SequenceFeature } from '../../types/schema';
import { complementBase } from './layout/linearLayout';

export interface PrintHtmlOptions {
  title?: string;
  landscape?: boolean;
}

export interface SequencePrintOptions {
  bpPerLine?: number;
  showFeatures?: boolean;
  title?: string;
  landscape?: boolean;
}

export interface SequencePrintLine {
  /** 0-based inclusive start of the line. */
  start: number;
  /** 0-based exclusive end of the line. */
  end: number;
  plus: string;
  minus: string;
  /** 1-based label shown at the start of the line. */
  label: string;
  /** 1-based inclusive end label. */
  endLabel: string;
}

export interface FeaturePrintRow {
  name: string;
  type: string;
  location: string;
  strand: string;
  length: number;
  segments: string;
}

const DEFAULT_BP_PER_LINE = 60;
const GROUP_SIZE = 10;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Group bases into readable blocks separated by thin spaces. */
export function formatGroupedBases(bases: string, groupSize = GROUP_SIZE): string {
  if (bases.length === 0) return '';
  const groups: string[] = [];
  for (let index = 0; index < bases.length; index += groupSize) {
    groups.push(bases.slice(index, index + groupSize));
  }
  return groups.join(' ');
}

/** Split a sequence into numbered forward/reverse-complement lines. */
export function buildSequencePrintLines(
  sequence: string,
  bpPerLine = DEFAULT_BP_PER_LINE,
): SequencePrintLine[] {
  const perLine = Math.max(10, Math.round(bpPerLine));
  const upper = sequence.toUpperCase();
  const lines: SequencePrintLine[] = [];
  for (let start = 0; start < upper.length; start += perLine) {
    const end = Math.min(upper.length, start + perLine);
    const plus = upper.slice(start, end);
    let minus = '';
    for (let index = plus.length - 1; index >= 0; index -= 1) {
      minus = complementBase(plus[index]) + minus;
    }
    lines.push({
      start,
      end,
      plus: formatGroupedBases(plus),
      minus: formatGroupedBases(minus),
      label: String(start + 1),
      endLabel: String(end),
    });
  }
  return lines;
}

function featureLength(feature: SequenceFeature, documentLength: number): number {
  if (feature.end >= feature.start) return feature.end - feature.start;
  return Math.max(0, documentLength - feature.start) + feature.end;
}

function strandLabel(strand: SequenceFeature['strand']): string {
  if (strand === 1) return '+';
  if (strand === -1) return '−';
  return '·';
}

/** Feature rows for the printed annotation table. */
export function buildFeaturePrintRows(doc: PlasmidDocument): FeaturePrintRow[] {
  const documentLength = doc.length || doc.sequence.length;
  return doc.features.map((feature) => {
    const segments = feature.notes?.segments;
    return {
      name: feature.name,
      type: feature.type,
      location: `${feature.start + 1}..${feature.end}`,
      strand: strandLabel(feature.strand),
      length: featureLength(feature, documentLength),
      segments: segments && segments.length > 0 ? segments.join(', ') : '',
    };
  });
}

function printStyles(landscape: boolean): string {
  return `
    @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 14mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Inter", "Helvetica Neue", "Segoe UI", system-ui, sans-serif;
      color: #111111;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1 { font-size: 15pt; font-weight: 700; margin: 0 0 2mm; letter-spacing: -0.01em; }
    .meta { font-size: 8.5pt; color: #555555; margin: 0 0 4mm; }
    .figure { display: block; margin: 0 auto; max-width: 100%; }
    .figure svg { display: block; width: 100%; height: auto; }
    .seq { font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace; font-size: 8pt; line-height: 1.25; }
    .seq-line { display: flex; align-items: baseline; white-space: pre; }
    .seq-pos { width: 15mm; flex: 0 0 15mm; color: #555555; text-align: right; padding-right: 3mm; }
    .seq-pos.end { text-align: left; padding-left: 3mm; }
    .seq-bases { white-space: pre; letter-spacing: 0.02em; }
    .seq-minus { color: #444444; }
    .features { margin-top: 6mm; font-size: 8pt; width: 100%; border-collapse: collapse; }
    .features th { text-align: left; font-weight: 700; border-bottom: 0.4pt solid #999999; padding: 1mm 1.5mm; }
    .features td { border-bottom: 0.2pt solid #dddddd; padding: 0.9mm 1.5mm; vertical-align: top; }
    .features td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .legend { margin-top: 3mm; font-size: 7.5pt; color: #666666; }
  `;
}

/** Assemble a complete printable HTML document. */
export function buildPrintDocument(
  body: string,
  options: PrintHtmlOptions = {},
  extraCss = '',
): string {
  const title = (options.title ?? '').trim();
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title || 'GATC figure')}</title>
<style>${printStyles(options.landscape ?? false)}${extraCss}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Printable HTML for a serialised SVG figure. */
export function buildSvgPrintHtml(
  svgMarkup: string,
  options: PrintHtmlOptions = {},
): string {
  const title = (options.title ?? '').trim();
  const heading = title ? `<h1>${escapeHtml(title)}</h1>` : '';
  return buildPrintDocument(
    `${heading}<div class="figure">${svgMarkup}</div>`,
    { ...options, title },
  );
}

function renderFeatureTable(doc: PlasmidDocument): string {
  const rows = buildFeaturePrintRows(doc);
  if (rows.length === 0) return '<p class="legend">No annotated features.</p>';
  const body = rows
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.name)}</td>
  <td>${escapeHtml(row.type)}</td>
  <td>${escapeHtml(row.location)}</td>
  <td class="num">${escapeHtml(row.strand)}</td>
  <td class="num">${row.length}</td>
  <td>${escapeHtml(row.segments)}</td>
</tr>`,
    )
    .join('\n');
  return `<table class="features">
<thead><tr><th>Feature</th><th>Type</th><th>Location</th><th>Strand</th><th>Length (bp)</th><th>Segments</th></tr></thead>
<tbody>
${body}
</tbody>
</table>`;
}

/** Printable HTML with double-stranded numbered sequence and feature table. */
export function buildSequencePrintHtml(
  doc: PlasmidDocument,
  options: SequencePrintOptions = {},
): string {
  const lines = buildSequencePrintLines(
    doc.sequence,
    options.bpPerLine ?? DEFAULT_BP_PER_LINE,
  );
  const title = (options.title ?? doc.name ?? '').trim();
  const heading = title ? `<h1>${escapeHtml(title)}</h1>` : '';
  const meta = `${doc.length || doc.sequence.length} bp · ${doc.topology} · ${doc.features.length} feature${
    doc.features.length === 1 ? '' : 's'
  }`;
  const sequenceHtml = lines
    .map(
      (line) => `<div class="seq-line"><span class="seq-pos">${line.label}</span><span class="seq-bases">${escapeHtml(line.plus)}</span><span class="seq-pos end">${line.endLabel}</span></div>
<div class="seq-line seq-minus"><span class="seq-pos"></span><span class="seq-bases">${escapeHtml(line.minus)}</span><span class="seq-pos end"></span></div>`,
    )
    .join('\n');
  const features =
    options.showFeatures === false ? '' : renderFeatureTable(doc);
  const body = `${heading}
<p class="meta">${escapeHtml(meta)}</p>
<div class="seq">
${sequenceHtml}
</div>
${features}`;
  return buildPrintDocument(body, {
    title,
    landscape: options.landscape ?? true,
  });
}
