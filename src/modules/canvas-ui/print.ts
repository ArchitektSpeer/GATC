/**
 * Browser printing helpers.
 *
 * Printing runs through a hidden iframe so the current page layout and scroll
 * position are never disturbed. The markup itself comes from the pure
 * functions in `printHtml.ts`.
 */

import type { PlasmidDocument } from '../../types/schema';
import {
  buildSequencePrintHtml,
  buildSvgPrintHtml,
  type PrintHtmlOptions,
  type SequencePrintOptions,
} from './printHtml';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

function openPrintFrame(html: string): void {
  if (typeof document === 'undefined') return;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', 'Print preview');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  document.body.appendChild(frame);

  const cleanup = (): void => {
    if (frame.parentNode) frame.parentNode.removeChild(frame);
  };

  const frameDocument =
    frame.contentDocument ?? frame.contentWindow?.document ?? null;
  if (!frameDocument) {
    cleanup();
    return;
  }
  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  const printWindow = frame.contentWindow;
  const schedule =
    typeof window !== 'undefined' && typeof window.setTimeout === 'function'
      ? window.setTimeout.bind(window)
      : setTimeout;
  schedule(() => {
    try {
      printWindow?.focus();
      printWindow?.print();
    } finally {
      schedule(cleanup, 1200);
    }
  }, 80);
}

function serializeSvg(svgElement: SVGSVGElement): string {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', XLINK_NS);
  return new XMLSerializer().serializeToString(clone);
}

/** Print a single SVG figure at its natural aspect ratio. */
export function printSvg(
  svgElement: SVGSVGElement,
  opts?: { title?: string; landscape?: boolean },
): void {
  if (!svgElement || typeof document === 'undefined') return;
  const markup = serializeSvg(svgElement);
  const options: PrintHtmlOptions = {
    title: opts?.title,
    landscape: opts?.landscape,
  };
  openPrintFrame(buildSvgPrintHtml(markup, options));
}

/** Print a numbered double-stranded sequence with its feature table. */
export function printSequenceText(
  doc: PlasmidDocument,
  opts?: { bpPerLine?: number; showFeatures?: boolean },
): void {
  if (!doc || typeof document === 'undefined') return;
  const options: SequencePrintOptions = {
    bpPerLine: opts?.bpPerLine,
    showFeatures: opts?.showFeatures,
    title: doc.name,
    landscape: true,
  };
  openPrintFrame(buildSequencePrintHtml(doc, options));
}
