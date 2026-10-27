import { describe, expect, it } from 'vitest';
import {
  computeCellWidth,
  countUngappedBases,
  displayAlignedBase,
  MSA_MAX_CELL_WIDTH,
  MSA_MIN_CELL_WIDTH,
  ungappedIndexAt,
  visibleIndexRange,
} from './layout/msaLayout';

describe('MSA layout helpers', () => {
  it('counts source residues while ignoring gaps', () => {
    const aligned = 'A--CGT-A';
    expect(countUngappedBases(aligned)).toBe(5);
    expect(countUngappedBases(aligned, 4)).toBe(2);
    expect(ungappedIndexAt(aligned, 0)).toBe(1);
    expect(ungappedIndexAt(aligned, 1)).toBeNull();
    expect(ungappedIndexAt(aligned, 4)).toBe(3);
  });

  it('renders dots for positions identical to the reference', () => {
    expect(displayAlignedBase('ACGT', 1, 'ACGT')).toBe('.');
    expect(displayAlignedBase('ACGT', 2, 'ATCT')).toBe('G');
    expect(displayAlignedBase('A-GT', 1, 'A-GT')).toBe('.');
    expect(displayAlignedBase('ACGT', 1)).toBe('C');
  });

  it('virtualises rows and columns with overscan', () => {
    const rows = visibleIndexRange(220, 440, 22, 50, 2);
    expect(rows.start).toBe(8);
    expect(rows.end).toBe(32);
    const cols = visibleIndexRange(0, 600, 12, 1000, 3);
    expect(cols.start).toBe(0);
    expect(cols.end).toBeLessThan(60);
    const tail = visibleIndexRange(9900, 600, 12, 1000, 3);
    expect(tail.end).toBe(878);
    expect(visibleIndexRange(11880, 600, 12, 1000, 3).end).toBe(1000);
    expect(visibleIndexRange(0, 600, 12, 0)).toEqual({ start: 0, end: 0 });
  });

  it('keeps cells readable and grows to fill short alignments', () => {
    expect(computeCellWidth(600, 10)).toBe(MSA_MAX_CELL_WIDTH);
    expect(computeCellWidth(600, 1000)).toBe(MSA_MIN_CELL_WIDTH);
    expect(computeCellWidth(600, 40)).toBeCloseTo(15, 6);
    expect(computeCellWidth(0, 40)).toBe(MSA_MIN_CELL_WIDTH);
  });
});
