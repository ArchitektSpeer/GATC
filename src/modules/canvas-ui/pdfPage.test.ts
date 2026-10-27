// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  computePdfPageLayout,
  PDF_PAGE_MARGIN,
  PDF_PAGE_SIZES,
  PDF_TITLE_HEIGHT,
} from './pdfPage';

describe('PDF page geometry', () => {
  it('fits the page to the SVG by default', () => {
    const layout = computePdfPageLayout(800, 600);
    expect(layout.pageWidth).toBe(800);
    expect(layout.pageHeight).toBe(600);
    expect(layout.scale).toBe(1);
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBe(0);
    expect(layout.margin).toBe(0);
    expect(layout.orientation).toBe('landscape');
  });

  it('reserves a title band in fit mode', () => {
    const layout = computePdfPageLayout(640, 480, { title: 'Figure 1' });
    expect(layout.pageWidth).toBe(640);
    expect(layout.pageHeight).toBe(480 + PDF_TITLE_HEIGHT);
    expect(layout.titleHeight).toBe(PDF_TITLE_HEIGHT);
    expect(layout.offsetY).toBe(PDF_TITLE_HEIGHT);
    expect(layout.scale).toBe(1);
  });

  it('fits an SVG into A4 and keeps its aspect ratio', () => {
    const layout = computePdfPageLayout(900, 600, { pageSize: 'a4' });
    expect(layout.pageWidth).toBe(PDF_PAGE_SIZES.a4.width);
    expect(layout.pageHeight).toBe(PDF_PAGE_SIZES.a4.height);
    expect(layout.orientation).toBe('portrait');
    expect(layout.scale).toBeGreaterThan(0);
    const drawnWidth = layout.svgWidth * layout.scale;
    const drawnHeight = layout.svgHeight * layout.scale;
    expect(drawnWidth / drawnHeight).toBeCloseTo(900 / 600, 6);
    expect(drawnWidth).toBeLessThanOrEqual(
      PDF_PAGE_SIZES.a4.width - PDF_PAGE_MARGIN * 2 + 0.001,
    );
    expect(drawnHeight).toBeLessThanOrEqual(
      PDF_PAGE_SIZES.a4.height - PDF_PAGE_MARGIN * 2 + 0.001,
    );
    expect(layout.offsetX).toBeGreaterThanOrEqual(PDF_PAGE_MARGIN);
    expect(layout.offsetY).toBeGreaterThanOrEqual(PDF_PAGE_MARGIN);
  });

  it('swaps dimensions for landscape Letter pages', () => {
    const layout = computePdfPageLayout(400, 400, {
      pageSize: 'letter',
      landscape: true,
    });
    expect(layout.pageWidth).toBe(PDF_PAGE_SIZES.letter.height);
    expect(layout.pageHeight).toBe(PDF_PAGE_SIZES.letter.width);
    expect(layout.orientation).toBe('landscape');
  });

  it('subtracts the title band from the printable area', () => {
    const plain = computePdfPageLayout(400, 2000, { pageSize: 'a4' });
    const titled = computePdfPageLayout(400, 2000, {
      pageSize: 'a4',
      title: 'Chromatogram',
    });
    expect(titled.titleHeight).toBe(PDF_TITLE_HEIGHT);
    expect(titled.scale).toBeLessThan(plain.scale);
    expect(titled.offsetY).toBeGreaterThanOrEqual(PDF_TITLE_HEIGHT);
  });

  it('falls back to sane dimensions for invalid input', () => {
    const layout = computePdfPageLayout(Number.NaN, -10);
    expect(layout.pageWidth).toBe(800);
    expect(layout.pageHeight).toBe(600);
    expect(layout.scale).toBe(1);
  });
});
