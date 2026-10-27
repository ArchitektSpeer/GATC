/**
 * Pure layout helpers for the multiple sequence alignment viewer.
 *
 * Everything in this module is free of DOM access so it can be unit tested in
 * Node and reused from a Web Worker.
 */

export type MsaColorScheme = 'nucleotide' | 'identity' | 'clustal' | 'none';

export const MSA_SCHEME_LABEL: Record<MsaColorScheme, string> = {
  nucleotide: 'Nucleotide',
  identity: 'Identity',
  clustal: 'Clustal',
  none: 'Monochrome',
};

export const MSA_MIN_CELL_WIDTH = 12;
export const MSA_MAX_CELL_WIDTH = 22;

export interface IndexRange {
  /** First rendered index (inclusive). */
  start: number;
  /** Last rendered index (exclusive). */
  end: number;
}

const GAP = '-';

/** Clamp a column index into `[0, count - 1]`; returns 0 for an empty matrix. */
export function clampColumn(column: number, count: number): number {
  if (!Number.isFinite(column) || count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor(column)));
}

/**
 * Half-open window of items that intersect the viewport, padded by `overscan`
 * items on each side. Used for both row and column virtualisation.
 */
export function visibleIndexRange(
  offset: number,
  viewport: number,
  itemSize: number,
  count: number,
  overscan = 3,
): IndexRange {
  if (count <= 0 || itemSize <= 0 || viewport <= 0) return { start: 0, end: 0 };
  const safeOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);
  const first = Math.floor(safeOffset / itemSize);
  const last = Math.ceil((safeOffset + viewport) / itemSize);
  const start = Math.max(0, first - Math.max(0, overscan));
  const end = Math.min(count, last + Math.max(0, overscan));
  if (end <= start) return { start, end: start };
  return { start, end };
}

export function rangesEqual(a: IndexRange, b: IndexRange): boolean {
  return a.start === b.start && a.end === b.end;
}

/** Column under a horizontal content offset. */
export function columnFromOffset(
  offset: number,
  cellWidth: number,
  count: number,
): number {
  if (count <= 0 || cellWidth <= 0) return 0;
  return clampColumn(Math.floor(Math.max(0, offset) / cellWidth), count);
}

/**
 * Column width used by the aligned grid. Columns keep a readable minimum so
 * long alignments scroll horizontally instead of collapsing.
 */
export function computeCellWidth(
  viewport: number,
  count: number,
  minWidth = MSA_MIN_CELL_WIDTH,
  maxWidth = MSA_MAX_CELL_WIDTH,
): number {
  if (count <= 0) return minWidth;
  const fit = (Number.isFinite(viewport) ? Math.max(0, viewport) : 0) / count;
  return Math.max(minWidth, Math.min(maxWidth, fit));
}

/** Number of residues up to (but excluding) `endColumn`, ignoring gaps. */
export function countUngappedBases(aligned: string, endColumn?: number): number {
  const limit =
    endColumn === undefined
      ? aligned.length
      : Math.max(0, Math.min(aligned.length, Math.floor(endColumn)));
  let total = 0;
  for (let i = 0; i < limit; i += 1) {
    if (aligned[i] !== GAP) total += 1;
  }
  return total;
}

/**
 * 1-based position of the residue at `column` in the ungapped source sequence.
 * Returns `null` when the column is a gap or outside the aligned string.
 */
export function ungappedIndexAt(aligned: string, column: number): number | null {
  if (column < 0 || column >= aligned.length) return null;
  if (aligned[column] === GAP) return null;
  return countUngappedBases(aligned, column + 1);
}

/**
 * Base shown in a cell. With a reference row, positions identical to the
 * reference collapse to `.`; the reference itself therefore renders as dots.
 */
export function displayAlignedBase(
  aligned: string,
  column: number,
  reference?: string,
): string {
  const base = (aligned[column] ?? GAP).toUpperCase();
  if (reference === undefined) return base;
  const referenceBase = (reference[column] ?? GAP).toUpperCase();
  if (base === referenceBase) return '.';
  return base;
}

/** Clamp an arbitrary conservation score into the 0..1 range. */
export function conservationLevel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

const CLUSTAL_LIGHT: Record<string, string> = {
  A: '#1f6feb',
  V: '#1f6feb',
  I: '#1f6feb',
  L: '#1f6feb',
  M: '#1f6feb',
  F: '#1f6feb',
  W: '#1f6feb',
  R: '#c92a2a',
  K: '#c92a2a',
  N: '#2b8a3e',
  Q: '#2b8a3e',
  S: '#2b8a3e',
  T: '#2b8a3e',
  U: '#2b8a3e',
  D: '#9c36b5',
  E: '#9c36b5',
  C: '#c2255c',
  G: '#e8590c',
  P: '#a47b00',
  H: '#0c8599',
  Y: '#0c8599',
  B: '#5c7080',
  Z: '#5c7080',
};

const CLUSTAL_DARK: Record<string, string> = {
  A: '#7aa7ff',
  V: '#7aa7ff',
  I: '#7aa7ff',
  L: '#7aa7ff',
  M: '#7aa7ff',
  F: '#7aa7ff',
  W: '#7aa7ff',
  R: '#ff8787',
  K: '#ff8787',
  N: '#69db7c',
  Q: '#69db7c',
  S: '#69db7c',
  T: '#69db7c',
  U: '#69db7c',
  D: '#da9bf5',
  E: '#da9bf5',
  C: '#f783ac',
  G: '#ffa94d',
  P: '#f2cc60',
  H: '#66d9e8',
  Y: '#66d9e8',
  B: '#a5b4c8',
  Z: '#a5b4c8',
};

/**
 * CLUSTAL X residue colouring. Returns `null` for gaps and unknown residues so
 * the caller can fall back to the muted theme colour.
 */
export function clustalColor(base: string, dark = false): string | null {
  const table = dark ? CLUSTAL_DARK : CLUSTAL_LIGHT;
  return table[base.toUpperCase()] ?? null;
}

/** Direction of the conservation bar, expressed as a 0..1 opacity. */
export function conservationOpacity(level: number): number {
  return 0.22 + conservationLevel(level) * 0.7;
}
