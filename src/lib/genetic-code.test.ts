// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// The generated table has to still be the one Biopython carries; if it is not,
// run `npm run gen:genetic-code`.
import { describe, expect, it } from 'vitest';
import { codonTableSync } from './python';
import { GENETIC_CODE, SYNONYMOUS_CODONS, translateCodon } from './genetic-code';

describe('genetic code', () => {
  it('matches Bio.Data.CodonTable codon for codon', () => {
    expect(GENETIC_CODE).toEqual(codonTableSync());
  });

  it('covers every codon once, with three stops', () => {
    expect(Object.keys(GENETIC_CODE)).toHaveLength(64);
    expect(Object.values(GENETIC_CODE).filter((residue) => residue === '*')).toHaveLength(3);
    expect(translateCodon('atg')).toBe('M');
    expect(translateCodon('NNN')).toBe('X');
  });

  it('groups the synonymous codons of each residue', () => {
    expect(SYNONYMOUS_CODONS.M).toEqual(['ATG']);
    expect(SYNONYMOUS_CODONS.L.sort()).toEqual(['CTA', 'CTC', 'CTG', 'CTT', 'TTA', 'TTG']);
    expect(SYNONYMOUS_CODONS['*'].sort()).toEqual(['TAA', 'TAG', 'TGA']);
  });
});
