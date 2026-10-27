// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Dumps GATC algorithm outputs for cross-checking against Biopython / primer3:
// restriction cut positions, enzyme definitions, primer Tm and CDS translations.
// Usage: node scripts/crosscheck/gatc_algos.mjs out.json tm-oligos.txt file1.dna|file.fasta ...
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [outPath, oligoPath, ...files] = process.argv.slice(2);
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const io = await vite.ssrLoadModule('/src/modules/io-adapter/index.ts');
const seq = await vite.ssrLoadModule('/src/modules/seq-engine/index.ts');
const thermo = await vite.ssrLoadModule('/src/modules/cloning-primer/thermo.ts');

const load = async (file) => {
  const buf = readFileSync(file);
  if (file.endsWith('.dna')) {
    return io.parseSnapGeneBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), basename(file));
  }
  const docs = await io.parseBioFile(basename(file), buf.toString('utf8'));
  return docs[0];
};

const featureDna = (doc, f) => {
  const s = doc.sequence;
  const raw = f.start < f.end ? s.slice(f.start, f.end) : s.slice(f.start) + s.slice(0, f.end);
  return f.strand === -1 ? seq.reverseComplement(raw) : raw;
};

const out = {
  enzymes: seq.ENZYME_DATABASE.map((e) => ({ name: e.name, site: e.recognitionSeq, top: e.cutIndexTop, bottom: e.cutIndexBottom, secondCut: e.secondCut })),
  cuts: {},
  translations: {},
  tm: {},
};
for (const file of files) {
  const doc = await load(file);
  const byEnzyme = {};
  for (const site of seq.findCutSites(doc, seq.ENZYME_DATABASE)) {
    (byEnzyme[site.enzyme.name] ??= new Set()).add(site.cutPositionTop);
  }
  out.cuts[basename(file)] = {
    length: doc.length,
    topology: doc.topology,
    sites: Object.fromEntries(Object.entries(byEnzyme).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])),
  };
  out.translations[basename(file)] = doc.features
    .filter((f) => f.type === 'CDS' && !f.notes?.segments && f.notes?.translation?.[0])
    .map((f) => ({
      name: f.name,
      snapgene: f.notes.translation[0].replace(/\s+/g, ''),
      gatc: seq.translateDna(featureDna(doc, f).slice((f.codonStart ?? 1) - 1)),
    }));
}
for (const oligo of readFileSync(oligoPath, 'utf8').split(/\s+/).filter(Boolean)) {
  out.tm[oligo] = thermo.meltingTemperature(oligo).tm;
}
writeFileSync(outPath, JSON.stringify(out));
await vite.close();
