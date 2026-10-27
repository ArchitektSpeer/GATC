// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { VECTOR_LIBRARY, bundledVectorFiles, openVector, searchVectors } from './index';

const bundled = VECTOR_LIBRARY.filter((v) => v.bundled);
const files = bundledVectorFiles();

describe('vector catalogue', () => {
  it('ships a GenBank file for every bundled entry, and no orphans', () => {
    const expected = new Set(bundled.map((v) => `./data/${v.id}.gb`));
    const present = new Set(Object.keys(files));
    expect([...expected].filter((p) => !present.has(p))).toEqual([]);
    expect([...present].filter((p) => !expected.has(p))).toEqual([]);
  });

  it('gives every entry a unique id and accession', () => {
    expect(new Set(VECTOR_LIBRARY.map((v) => v.id)).size).toBe(VECTOR_LIBRARY.length);
    expect(new Set(VECTOR_LIBRARY.map((v) => v.accession)).size).toBe(VECTOR_LIBRARY.length);
  });

  it('names a plausible accession for every entry', () => {
    for (const v of VECTOR_LIBRARY) {
      expect(v.accession, v.name).toMatch(/^[A-Z]{1,2}\d{5,6}$/);
    }
  });

  it('records the length the GenBank file actually declares', async () => {
    for (const v of bundled) {
      const text = await files[`./data/${v.id}.gb`]();
      const declared = Number(/^LOCUS\s+\S+\s+(\d+)\s+bp/.exec(text)?.[1]);
      expect(declared, `${v.name} LOCUS line`).toBe(v.lengthBp);
      // The catalogue must point at the record it claims.
      expect(text, `${v.name} accession`).toContain(v.accession);
    }
  });

  it('opens a bundled vector offline, circular, with the sequence the record gives', async () => {
    const pUC19 = VECTOR_LIBRARY.find((v) => v.id === 'pUC19')!;
    const doc = await openVector(pUC19);
    expect(doc.id).toBe('vector-pUC19');
    expect(doc.name).toBe('pUC19');
    expect(doc.topology).toBe('circular');
    expect(doc.sequence).toHaveLength(2686);
    expect(doc.description).toContain('L09137');
    expect(doc.features.length).toBeGreaterThan(0);
  });

  it('annotates a vector that arrives with no features of its own', async () => {
    // pSP64 is an older record with little annotation; auto-annotation should still find parts.
    const doc = await openVector(VECTOR_LIBRARY.find((v) => v.id === 'pSP64')!);
    expect(doc.sequence).toHaveLength(2999);
    expect(doc.features.some((f) => /amp|bla/i.test(f.name))).toBe(true);
  });

  it('searches by name, accession and marker, and filters by category', () => {
    expect(searchVectors('pUC', 'all').map((v) => v.id)).toContain('pUC19');
    expect(searchVectors('U55762', 'all').map((v) => v.id)).toEqual(['pEGFP-N1']);
    expect(searchVectors('URA3', 'all').map((v) => v.id).sort()).toEqual(['pRS316', 'pRS426']);
    const yeast = searchVectors('', 'yeast');
    expect(yeast).toHaveLength(6);
    expect(yeast.every((v) => v.category === 'yeast')).toBe(true);
    expect(searchVectors('pUC19', 'yeast')).toEqual([]);
  });

  it('catalogues the SEVA collection by accession without shipping it', () => {
    const seva = VECTOR_LIBRARY.filter((v) => v.category === 'seva');
    expect(seva.length).toBeGreaterThan(100);
    expect(seva.every((v) => !v.bundled)).toBe(true);
    expect(seva.every((v) => v.lengthBp === 0)).toBe(true);
  });
});
