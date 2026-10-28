// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Writes a pydna script out of real constructions, so the next step can run it and see
// whether the generated code rebuilds the same molecules GATC did.
// Usage: node scripts/crosscheck/gatc_pydna.mjs out.py meta.json plasmid.dna [...]
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [outPath, metaPath, ...files] = process.argv.slice(2);
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const io = await vite.ssrLoadModule('/src/modules/io-adapter/index.ts');
const seq = await vite.ssrLoadModule('/src/modules/seq-engine/index.ts');
const cl = await vite.ssrLoadModule('/src/modules/cloning-primer/index.ts');

const docs = [];
const notes = [];

for (const file of files) {
  const [plasmid] = await io.parseBioFile(basename(file), new Uint8Array(readFileSync(file)));
  if (!plasmid || plasmid.topology !== 'circular') continue;
  // Methylation would block some digests; the reference tools do not model it.
  const template = { ...plasmid, methylationProfile: { dam: false, dcm: false, cpg: false } };

  // A PCR with primers GATC designed itself.
  const pair = cl.designPrimerPair(template, { start: 200, end: Math.min(1000, template.length - 200) });
  const withPrimers = { ...template, primers: [pair.forward, pair.reverse] };
  const { product } = cl.simulatePCR(withPrimers, pair.forward, pair.reverse);
  docs.push(withPrimers, { ...product, primers: [pair.forward, pair.reverse] });
  notes.push(`${plasmid.name}: PCR ${product.length} bp`);

  // A single cutter, cut and closed again.
  const single = seq.COMMERCIAL_ENZYMES
    .map((enzyme) => ({ enzyme, sites: cl.findCutSites(template.sequence, enzyme, true) }))
    .find((entry) => entry.sites.length === 1 && /^[A-Za-z][A-Za-z0-9]*$/.test(entry.enzyme.name));
  if (single) {
    const fragments = cl.simulateDigestion(template, single.sites);
    const ligation = cl.simulateLigation(fragments, { circularize: true });
    if (ligation.product) {
      docs.push({
        ...ligation.product,
        id: `${template.id}-relig`,
        name: `${plasmid.name}_religated`,
        history: [
          {
            id: `${template.id}-relig-h`,
            operation: 'restriction_ligation',
            timestamp: new Date(0).toISOString(),
            description: `${single.enzyme.name} digest and religation`,
            enzymesUsed: [single.enzyme.name],
            parentSnapshots: [{ id: withPrimers.id, name: withPrimers.name, length: withPrimers.length }],
          },
        ],
      });
      notes.push(`${plasmid.name}: ${single.enzyme.name} religation`);
    }
  }
}

const script = io.exportPydnaScript(docs, {
  toGenBank: io.exportPlasmidToGenBank,
  title: 'cross-check: generated from real plasmids',
});
writeFileSync(outPath, script.code);
writeFileSync(
  metaPath,
  JSON.stringify({ documents: docs.length, reproduced: script.reproduced, literal: script.literal, warnings: script.warnings, notes }, null, 1),
);
console.log(`  wrote ${docs.length} documents, ${script.reproduced} rebuilt by pydna calls, ${script.literal} written literally`);
await vite.close();
