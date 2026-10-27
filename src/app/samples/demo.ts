// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
// Demo library: real NCBI records (pBR322 J01749, pGEX-4T-1 U13853, mCherry AY678264,
// GFP protein P42212) plus one construct derived from pBR322 for the Cre/loxP demo.
import type { PlasmidDocument } from '../../types/schema';
import type { ProteinDocument } from '../../modules/io-adapter';
import { autoAnnotateFeatures, mutatePlasmidSequence } from '../../modules/seq-engine';
import { loadSample } from './index';
import pBR322Gb from './demo/pBR322.gb?raw';
import pGEXGb from './demo/pGEX-4T-1.gb?raw';
import mCherryGb from './demo/mCherry.gb?raw';
import gfpFasta from './demo/GFP_Aequorea.fasta?raw';

const LOXP = 'ATAACTTCGTATAGCATACATTATACGAAGTTAT';

/** pBR322 with directly repeated loxP sites flanking the tetracycline resistance gene. */
function floxTet(pBR322: PlasmidDocument): PlasmidDocument {
  const tet = pBR322.features.find((f) => f.type === 'CDS' && /tet/i.test(f.name)) ?? { start: 85, end: 1276 };
  // Insert downstream first so the upstream coordinate stays valid.
  let doc = mutatePlasmidSequence(pBR322, { type: 'insert', position: tet.end, bases: LOXP });
  doc = mutatePlasmidSequence(doc, { type: 'insert', position: tet.start, bases: LOXP });
  const now = new Date().toISOString();
  const loxp = (start: number) => ({ id: `loxp-${start}`, name: 'loxP', type: 'protein_bind' as const, start, end: start + LOXP.length, strand: 1 as const, color: '#ec4899' });
  return {
    ...doc,
    id: 'demo-pBR322-flox',
    name: 'pBR322-loxP-tet-loxP',
    description: '演示构建：在 pBR322 的 tet 基因两侧插入同向 loxP',
    createdAt: now,
    updatedAt: now,
    features: [...doc.features.filter((f) => f.name !== 'loxP'), loxp(tet.start), loxp(tet.end + LOXP.length)],
  };
}

function proteinFromFasta(text: string): ProteinDocument {
  const [head, ...lines] = text.trim().split('\n');
  const now = new Date().toISOString();
  return {
    id: 'demo-gfp-protein',
    name: 'GFP (P42212)',
    description: head.slice(1),
    sequence: lines.join('').replace(/\s/g, ''),
    features: [{ id: 'gfp-chromophore', name: 'Chromophore (S65-Y66-G67)', type: 'site', start: 64, end: 67, color: '#22c55e' }],
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadDemoLibrary(): Promise<{ docs: PlasmidDocument[]; proteins: ProteinDocument[] }> {
  const [pBR322, pGEX, mCherryRaw] = await Promise.all([
    loadSample(pBR322Gb, 'pBR322'),
    loadSample(pGEXGb, 'pGEX-4T-1'),
    loadSample(mCherryGb, 'mCherry'),
  ]);
  const mCherry: PlasmidDocument = { ...mCherryRaw, topology: 'linear' };
  const floxed = floxTet(pBR322);
  // loadSample annotates; keep the floxed copy's annotations in sync with its new coordinates.
  const extra = autoAnnotateFeatures(floxed).filter((f) => !floxed.features.some((g) => g.start === f.start && g.end === f.end));
  return {
    docs: [
      { ...pBR322, id: 'demo-pBR322' },
      { ...pGEX, id: 'demo-pGEX-4T-1' },
      { ...mCherry, id: 'demo-mCherry' },
      { ...floxed, features: [...floxed.features, ...extra] },
    ],
    proteins: [proteinFromFasta(gfpFasta)],
  };
}
