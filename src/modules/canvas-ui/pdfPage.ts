// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure page geometry for vector PDF export.
 *
 * Kept separate from `exportPdf.ts` so the calculations can be unit tested in
 * Node without loading jsPDF or svg2pdf.js.
 */

export type PdfPageSize = 'a4' | 'letter' | 'fit';

export interface PdfExportOptions {
  pageSize?: PdfPageSize;
  landscape?: boolean;
  title?: string;
}

export interface PdfPageLayout {
  pageWidth: number;
  pageHeight: number;
  svgWidth: number;
  svgHeight: number;
  /** Scale applied to the SVG user units before drawing. */
  scale: number;
  offsetX: number;
  offsetY: number;
  margin: number;
  titleHeight: number;
  orientation: 'portrait' | 'landscape';
}

/** ISO A4 and US Letter, in PostScript points. */
export const PDF_PAGE_SIZES: Record<'a4' | 'letter', { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

export const PDF_PAGE_MARGIN = 24;
export const PDF_TITLE_HEIGHT = 32;
export const PDF_MIN_PAGE_SIZE = 1;

function positiveOr(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Compute page dimensions, drawing scale and placement for an SVG figure.
 *
 * `fit` (the default) makes the page exactly as large as the figure, adding a
 * title band only when a title is supplied. Fixed page sizes centre the figure
 * inside the printable area and scale it down or up to fit.
 */
export function computePdfPageLayout(
  svgWidth: number,
  svgHeight: number,
  options: PdfExportOptions = {},
): PdfPageLayout {
  const sourceWidth = positiveOr(svgWidth, 800);
  const sourceHeight = positiveOr(svgHeight, 600);
  const title = (options.title ?? '').trim();
  const titleHeight = title.length > 0 ? PDF_TITLE_HEIGHT : 0;
  const requested: PdfPageSize = options.pageSize ?? 'fit';

  if (requested === 'fit') {
    const pageWidth = Math.max(PDF_MIN_PAGE_SIZE, sourceWidth);
    const pageHeight = Math.max(PDF_MIN_PAGE_SIZE, sourceHeight + titleHeight);
    return {
      pageWidth,
      pageHeight,
      svgWidth: sourceWidth,
      svgHeight: sourceHeight,
      scale: 1,
      offsetX: 0,
      offsetY: titleHeight,
      margin: 0,
      titleHeight,
      orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
    };
  }

  const base = requested === 'letter' ? PDF_PAGE_SIZES.letter : PDF_PAGE_SIZES.a4;
  const pageWidth = options.landscape ? base.height : base.width;
  const pageHeight = options.landscape ? base.width : base.height;
  const margin = PDF_PAGE_MARGIN;
  const availableWidth = Math.max(PDF_MIN_PAGE_SIZE, pageWidth - margin * 2);
  const availableHeight = Math.max(
    PDF_MIN_PAGE_SIZE,
    pageHeight - margin * 2 - titleHeight,
  );
  const scale = Math.min(
    availableWidth / sourceWidth,
    availableHeight / sourceHeight,
  );
  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  return {
    pageWidth,
    pageHeight,
    svgWidth: sourceWidth,
    svgHeight: sourceHeight,
    scale,
    offsetX: round2(margin + (availableWidth - drawnWidth) / 2),
    offsetY: round2(margin + titleHeight + (availableHeight - drawnHeight) / 2),
    margin,
    titleHeight,
    orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
  };
}
