/**
 * Vector PDF export for SVG figures.
 *
 * jsPDF and svg2pdf.js are loaded lazily so importing this module stays cheap
 * and Node-side consumers (for example unit tests) never touch DOM-only code.
 */

import { triggerDownload } from './exportSvg';
import {
  computePdfPageLayout,
  type PdfExportOptions,
} from './pdfPage';

export type { PdfExportOptions, PdfPageLayout } from './pdfPage';
export {
  computePdfPageLayout,
  PDF_PAGE_SIZES,
  PDF_PAGE_MARGIN,
  PDF_TITLE_HEIGHT,
} from './pdfPage';

function ensurePdfExtension(fileName: string): string {
  const trimmed = fileName.trim() || 'figure';
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
}

interface SvgSize {
  width: number;
  height: number;
}

function measureSvgSize(svgElement: SVGSVGElement): SvgSize {
  const widthAttr = Number.parseFloat(svgElement.getAttribute('width') ?? '');
  const heightAttr = Number.parseFloat(svgElement.getAttribute('height') ?? '');
  if (Number.isFinite(widthAttr) && widthAttr > 0 && Number.isFinite(heightAttr) && heightAttr > 0) {
    return { width: widthAttr, height: heightAttr };
  }
  const viewBox = svgElement.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (
      parts.length === 4 &&
      Number.isFinite(parts[2]) &&
      Number.isFinite(parts[3]) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return { width: parts[2], height: parts[3] };
    }
  }
  if (typeof svgElement.getBoundingClientRect === 'function') {
    const rect = svgElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
  }
  return { width: 800, height: 600 };
}

/**
 * Render an SVG element into a vector PDF and download it.
 *
 * Geometry is computed by {@link computePdfPageLayout}; no rasterisation step
 * is involved. Inline presentation attributes and styles are exported by
 * svg2pdf.js, while class-based page CSS is not.
 */
export async function exportSvgToPdf(
  svgElement: SVGSVGElement,
  fileName: string,
  opts: PdfExportOptions = {},
): Promise<void> {
  if (!svgElement) return;
  const { width, height } = measureSvgSize(svgElement);
  const layout = computePdfPageLayout(width, height, opts);
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
  ]);

  const doc = new jsPDF({
    orientation: layout.orientation,
    unit: 'pt',
    format: [layout.pageWidth, layout.pageHeight],
    compress: true,
  });

  const title = (opts.title ?? '').trim();
  if (title) {
    const inset = layout.margin > 0 ? layout.margin : 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.text(title, inset, inset + 11);
  }

  await svg2pdf(svgElement, doc, {
    x: layout.offsetX,
    y: layout.offsetY,
    width: layout.svgWidth * layout.scale,
    height: layout.svgHeight * layout.scale,
  });

  const blob = doc.output('blob');
  triggerDownload(blob, ensurePdfExtension(fileName));
}
