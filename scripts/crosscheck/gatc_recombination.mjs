// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Runs the Gateway / Cre-lox scenarios from ref_recombination.py through GATC.
// Usage: node scripts/crosscheck/gatc_recombination.mjs scenarios.json out.json
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [scenPath, outPath] = process.argv.slice(2);
const scen = JSON.parse(readFileSync(scenPath, 'utf8'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const io = await vite.ssrLoadModule('/src/modules/io-adapter/index.ts');
const cl = await vite.ssrLoadModule('/src/modules/cloning-primer/index.ts');

const cache = new Map();
const load = async (file) => {
  if (!cache.has(file)) {
    const buf = readFileSync(file);
    cache.set(
      file,
      file.endsWith('.dna')
        ? await io.parseSnapGeneBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), basename(file))
        : (await io.parseBioFile(basename(file), buf.toString('utf8')))[0],
    );
  }
  return cache.get(file);
};
const doc = (sequence, name, topology) => ({
  id: name, name, sequence, topology, length: sequence.length,
  createdAt: '', updatedAt: '', features: [], primers: [], history: [],
});
const safe = (fn) => {
  try { return fn(); } catch (e) { return { warnings: [String(e).slice(0, 160)] }; }
};

const out = { bp: [], lr: [], cre: [] };
for (const sc of scen.bp) {
  const donor = await load(sc.donor);
  const r = safe(() => cl.simulateGatewayBP(doc(sc.insert, 'attB-insert', 'linear'), donor));
  out.bp.push({ product: r.entryClone?.sequence ?? null, warnings: r.warnings?.slice(0, 2) });
}
for (const sc of scen.lr) {
  const donor = await load(sc.donor);
  const destination = await load(sc.destination);
  const r = safe(() => {
    const entry = cl.simulateGatewayBP(doc(sc.insert, 'attB-insert', 'linear'), donor).entryClone;
    if (!entry) return { warnings: ['BP step produced no entry clone.'] };
    return cl.simulateGatewayLR(entry, destination);
  });
  out.lr.push({ product: r.expressionClone?.sequence ?? null, warnings: r.warnings?.slice(0, 2) });
}
for (const sc of scen.cre) {
  const inputs =
    sc.kind === 'excision'
      ? [doc(sc.sequence, 'floxed', 'circular')]
      : [doc(sc.target, 'target', 'circular'), doc(sc.insert, 'donor', 'circular')];
  const r = safe(() => cl.simulateRecombinase(inputs, 'Cre'));
  // Report every product; the checker accepts a match against any pydna product.
  out.cre.push({
    product: r.products?.[0]?.sequence ?? null,
    products: r.products?.map((p) => p.sequence) ?? [],
    warnings: (r.warnings ?? []).slice(0, 2),
  });
}
writeFileSync(outPath, JSON.stringify(out));
await vite.close();
