/**
 * Protein sequence helpers: residue chemistry, molecular weight, isoelectric
 * point and row geometry for the virtualised protein viewer.
 */

export interface ProteinFeature {
  id: string;
  name: string;
  type: string;
  /** Amino-acid coordinates, 0-based half-open. */
  start: number;
  end: number;
  color: string;
  notes?: Record<string, string[]>;
}

export interface ProteinDocument {
  id: string;
  name: string;
  sequence: string;
  description?: string;
  features: ProteinFeature[];
  createdAt: string;
  updatedAt: string;
}

export type ProteinResidueClass = 'hydrophobic' | 'charged' | 'polar' | 'special';

export const PROTEIN_RESIDUE_CLASS: Record<string, ProteinResidueClass> = {
  A: 'hydrophobic',
  V: 'hydrophobic',
  I: 'hydrophobic',
  L: 'hydrophobic',
  M: 'hydrophobic',
  F: 'hydrophobic',
  W: 'hydrophobic',
  P: 'hydrophobic',
  D: 'charged',
  E: 'charged',
  K: 'charged',
  R: 'charged',
  H: 'charged',
  S: 'polar',
  T: 'polar',
  N: 'polar',
  Q: 'polar',
  C: 'polar',
  Y: 'polar',
  G: 'polar',
};

/** Average residue masses in daltons (IUPAC values). */
export const AMINO_ACID_MASS: Record<string, number> = {
  A: 71.0788,
  R: 156.1875,
  N: 114.1038,
  D: 115.0886,
  C: 103.1388,
  E: 129.1155,
  Q: 128.1307,
  G: 57.0519,
  H: 137.1411,
  I: 113.1594,
  L: 113.1594,
  K: 128.1741,
  M: 131.1926,
  F: 147.1766,
  P: 97.1167,
  S: 87.0782,
  T: 101.1051,
  W: 186.2132,
  Y: 163.176,
  V: 99.1326,
  U: 150.0388,
  O: 237.3018,
  B: 114.6,
  Z: 128.6,
  J: 113.16,
  X: 110,
  '*': 0,
};

const WATER_MASS = 18.01528;

export function classifyResidue(residue: string): ProteinResidueClass {
  return PROTEIN_RESIDUE_CLASS[residue.toUpperCase()] ?? 'special';
}

/** Molecular weight in daltons, including the terminal water loss. */
export function proteinMolecularWeight(sequence: string): number {
  const residues = sanitiseSequence(sequence);
  if (residues.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < residues.length; i += 1) {
    total += AMINO_ACID_MASS[residues[i]] ?? 110;
  }
  return total - WATER_MASS * (residues.length - 1);
}

export function proteinMolecularWeightKda(sequence: string): number {
  return proteinMolecularWeight(sequence) / 1000;
}

function sanitiseSequence(sequence: string): string {
  return sequence.toUpperCase().replace(/[^A-Z*]/g, '');
}

const PKA_SIDE_CHAIN: Record<string, number> = {
  D: 3.9,
  E: 4.1,
  C: 8.5,
  Y: 10.1,
  H: 6.5,
  K: 10.8,
  R: 12.5,
};
const PKA_N_TERMINUS = 8.6;
const PKA_C_TERMINUS = 3.6;

function chargeAtPh(sequence: string, ph: number): number {
  let positive = 1 / (1 + 10 ** (ph - PKA_N_TERMINUS));
  let negative = -1 / (1 + 10 ** (PKA_C_TERMINUS - ph));
  for (let i = 0; i < sequence.length; i += 1) {
    const residue = sequence[i];
    const pka = PKA_SIDE_CHAIN[residue];
    if (pka === undefined) continue;
    if (residue === 'D' || residue === 'E' || residue === 'C' || residue === 'Y') {
      negative -= 1 / (1 + 10 ** (pka - ph));
    } else {
      positive += 1 / (1 + 10 ** (ph - pka));
    }
  }
  return positive + negative;
}

/**
 * Isoelectric point by bisection on the summed Henderson-Hasselbalch charge.
 * Empty sequences return the neutral value 7.
 */
export function proteinIsoelectricPoint(sequence: string): number {
  const residues = sanitiseSequence(sequence);
  if (residues.length === 0) return 7;
  let low = 0;
  let high = 14;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    if (chargeAtPh(residues, mid) > 0) low = mid;
    else high = mid;
  }
  return Math.round(((low + high) / 2) * 100) / 100;
}

export interface ProteinRow {
  rowIndex: number;
  start: number;
  end: number;
}

export function proteinRowCount(sequenceLength: number, residuesPerRow: number): number {
  if (sequenceLength <= 0) return 0;
  return Math.ceil(sequenceLength / Math.max(1, Math.round(residuesPerRow)));
}

export function proteinRowAt(sequenceLength: number, residuesPerRow: number, row: number): ProteinRow {
  const perRow = Math.max(1, Math.round(residuesPerRow));
  const start = Math.max(0, row) * perRow;
  return {
    rowIndex: row,
    start,
    end: Math.min(sequenceLength, start + perRow),
  };
}

export interface ProteinFeatureSpan {
  rowIndex: number;
  /** Columns within the row, relative to the row start. */
  startColumn: number;
  endColumn: number;
}

/** Clip a protein feature into per-row spans for the virtualised renderer. */
export function proteinFeatureSpans(
  feature: ProteinFeature,
  residuesPerRow: number,
  sequenceLength?: number,
): ProteinFeatureSpan[] {
  const perRow = Math.max(1, Math.round(residuesPerRow));
  const limit =
    typeof sequenceLength === 'number' && Number.isFinite(sequenceLength)
      ? Math.max(0, sequenceLength)
      : Number.POSITIVE_INFINITY;
  const start = Math.max(0, Math.min(feature.start, feature.end));
  const end = Math.max(0, Math.min(limit, Math.max(feature.start, feature.end)));
  if (end <= start) return [];
  const firstRow = Math.floor(start / perRow);
  const lastRow = Math.floor((end - 1) / perRow);
  const spans: ProteinFeatureSpan[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const rowStart = row * perRow;
    spans.push({
      rowIndex: row,
      startColumn: Math.max(0, start - rowStart),
      endColumn: Math.min(perRow, end - rowStart),
    });
  }
  return spans;
}

/** Column groups (blocks of five residues) used by the residue grid. */
export function proteinColumnGroups(
  residuesPerRow: number,
  groupSize = 5,
): Array<{ start: number; end: number }> {
  const perRow = Math.max(1, Math.round(residuesPerRow));
  const size = Math.max(1, Math.round(groupSize));
  const groups: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < perRow; start += size) {
    groups.push({ start, end: Math.min(perRow, start + size) });
  }
  return groups;
}

export interface VirtualRowRange {
  start: number;
  end: number;
}

/** Visible row window for a fixed row height, with overscan rows. */
export function virtualProteinRowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
  overscan = 3,
): VirtualRowRange {
  if (rowCount <= 0 || rowHeight <= 0) return { start: 0, end: -1 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan;
  const last = Math.ceil((Math.max(0, scrollTop) + viewportHeight) / rowHeight) + overscan;
  return {
    start: Math.max(0, first),
    end: Math.min(rowCount - 1, last),
  };
}
