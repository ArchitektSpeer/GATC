// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
const SVG_NS = 'http://www.w3.org/2000/svg';

function ensureExtension(fileName: string, extension: string): string {
  const trimmed = fileName.trim() || 'figure';
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(extension)) return trimmed;
  return `${trimmed}${extension}`;
}

function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  if (!clone.getAttribute('width')) {
    const rect = svg.getBoundingClientRect();
    clone.setAttribute('width', String(Math.max(1, Math.round(rect.width))));
    clone.setAttribute('height', String(Math.max(1, Math.round(rect.height))));
  }
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${source}`;
}

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportSvgToPublicationFile(
  svgElement: SVGSVGElement,
  fileName: string,
): void {
  if (!svgElement) return;
  const source = serializeSvg(svgElement);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(blob, ensureExtension(fileName, '.svg'));
}

export async function exportSvgToPng(
  svgElement: SVGSVGElement,
  fileName: string,
  dpi = 300,
): Promise<void> {
  if (!svgElement) return;
  const source = serializeSvg(svgElement);
  const viewBox = svgElement.getAttribute('viewBox');
  const widthAttr = Number.parseFloat(svgElement.getAttribute('width') || '');
  const heightAttr = Number.parseFloat(svgElement.getAttribute('height') || '');
  let baseWidth = Number.isFinite(widthAttr) && widthAttr > 0 ? widthAttr : 0;
  let baseHeight = Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : 0;
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && parts[2] > 0) {
      baseWidth = parts[2];
      baseHeight = parts[3];
    }
  }
  if (baseWidth <= 0 || baseHeight <= 0) {
    const rect = svgElement.getBoundingClientRect();
    baseWidth = Math.max(1, rect.width);
    baseHeight = Math.max(1, rect.height);
  }
  const scale = Math.max(0.1, dpi) / 96;
  const outputWidth = Math.max(1, Math.round(baseWidth * scale));
  const outputHeight = Math.max(1, Math.round(baseHeight * scale));

  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'sync';
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Unable to rasterize the SVG figure'));
    });
    image.src = url;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outputWidth, outputHeight);
    ctx.drawImage(image, 0, 0, outputWidth, outputHeight);
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), 'image/png', 1),
    );
    if (!pngBlob) throw new Error('PNG encoding failed');
    triggerDownload(pngBlob, ensureExtension(fileName, '.png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
