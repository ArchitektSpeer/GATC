// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Opens a vector from the built-in catalogue. Bundled records are code-split, so the
// GenBank text for a vector is only downloaded when that vector is opened; the catalogue
// itself is small enough to load with the app.
import type { PlasmidDocument } from '../../types/schema';
import { fetchFromNCBI } from '../../modules/io-adapter';
import { loadSample } from '../samples';
import { VECTOR_LIBRARY, type VectorCategory, type VectorEntry } from './catalog';

export { VECTOR_LIBRARY, VECTOR_CATEGORIES } from './catalog';
export type { VectorEntry, VectorCategory } from './catalog';

const FILES = import.meta.glob('./data/*.gb', { query: '?raw', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

/** Every bundled vector, keyed by id, for tests and for the integrity check below. */
export function bundledVectorFiles(): Record<string, () => Promise<string>> {
  return FILES;
}

export async function openVector(entry: VectorEntry): Promise<PlasmidDocument> {
  const doc = entry.bundled ? await fromBundle(entry) : await fromNCBI(entry);
  return {
    ...doc,
    // A stable id keeps a reopened vector from stacking up as duplicate tabs.
    id: `vector-${entry.id}`,
    name: entry.name,
    description: entry.notes ? `${entry.notes}（GenBank ${entry.accession}）` : `GenBank ${entry.accession}`,
  };
}

async function fromBundle(entry: VectorEntry): Promise<PlasmidDocument> {
  const read = FILES[`./data/${entry.id}.gb`];
  if (!read) throw new Error(`${entry.name} 标记为内置，但缺少 data/${entry.id}.gb`);
  return loadSample(await read(), entry.name);
}

async function fromNCBI(entry: VectorEntry): Promise<PlasmidDocument> {
  const fetched = await fetchFromNCBI(entry.accession, { db: 'nuccore' });
  if (!('topology' in fetched)) {
    throw new Error(`${entry.accession} 返回的不是核酸记录`);
  }
  // GenBank marks few plasmid records as circular even when they are.
  return { ...fetched, topology: 'circular' };
}

export function searchVectors(query: string, category: VectorCategory | 'all'): VectorEntry[] {
  const q = query.trim().toLowerCase();
  return VECTOR_LIBRARY.filter((v) => {
    if (category !== 'all' && v.category !== category) return false;
    if (!q) return true;
    return (
      v.name.toLowerCase().includes(q) ||
      v.accession.toLowerCase().includes(q) ||
      v.notes.toLowerCase().includes(q) ||
      v.markers.some((m) => m.toLowerCase().includes(q))
    );
  });
}
