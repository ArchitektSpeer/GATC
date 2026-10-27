// Runs the scenarios written by ref_cloning.py through GATC's cloning engine.
// Usage: node scripts/crosscheck/gatc_cloning.mjs scenarios.json out.json
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [scenPath, outPath] = process.argv.slice(2);
const scen = JSON.parse(readFileSync(scenPath, 'utf8'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const io = await vite.ssrLoadModule('/src/modules/io-adapter/index.ts');
const seq = await vite.ssrLoadModule('/src/modules/seq-engine/index.ts');
const cl = await vite.ssrLoadModule('/src/modules/cloning-primer/index.ts');

const NO_METHYLATION = { dam: false, dcm: false, cpg: false };
const cache = new Map();
const load = async (file) => {
  if (!cache.has(file)) {
    const buf = readFileSync(file);
    const doc = file.endsWith('.dna')
      ? await io.parseSnapGeneBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), basename(file))
      : (await io.parseBioFile(basename(file), buf.toString('utf8')))[0];
    cache.set(file, { ...doc, methylationProfile: NO_METHYLATION });
  }
  return cache.get(file);
};
const byName = new Map(seq.ENZYME_DATABASE.map((e) => [e.name, e]));
const missing = new Set();
const enzymes = (names) => names.map((n) => byName.get(n) ?? (missing.add(n), seq.getEnzymeByName(n))).filter(Boolean);
const digest = (doc, names) =>
  cl.simulateDigestion(doc, seq.findCutSites({ ...doc, methylationProfile: NO_METHYLATION }, enzymes(names)));
const linear = (sequence, name) => ({
  id: name, name, sequence, topology: 'linear', length: sequence.length,
  createdAt: '', updatedAt: '', features: [], primers: [], history: [],
  methylationProfile: NO_METHYLATION,
});
const safe = (fn) => {
  try { return fn(); } catch (e) { return { product: null, warnings: [String(e).slice(0, 160)] }; }
};

const out = { digest: [], pcr: [], restriction_cloning: [], gibson: [] };
for (const sc of scen.digest) {
  const frags = digest(await load(sc.file), sc.enzymes);
  out.digest.push({ lengths: frags.map((f) => f.length), sequences: frags.map((f) => f.sequence) });
}
for (const sc of scen.pcr) {
  const r = safe(() => cl.simulatePCR(cache.get(sc.file) ?? null, sc.fwd, sc.rev));
  out.pcr.push({ product: r.product?.sequence ?? null, warnings: r.warnings?.slice(0, 2) });
}
for (const sc of scen.restriction_cloning) {
  const r = safe(() => {
    const pcrProduct = cl.simulatePCR(cache.get(sc.insert), sc.fwd, sc.rev).product;
    const insert = [...digest({ ...pcrProduct, methylationProfile: NO_METHYLATION }, sc.enzymes)].sort((a, b) => b.length - a.length)[0];
    const vector = [...digest(cache.get(sc.vector), sc.enzymes)].sort((a, b) => b.length - a.length)[0];
    return cl.simulateLigation([vector, insert], { circularize: true });
  });
  out.restriction_cloning.push({ product: r.product?.sequence ?? null, warnings: r.warnings?.slice(0, 2) });
}
for (const sc of scen.gibson) {
  const r = safe(() => cl.simulateGibsonAssembly(sc.fragments.map((s, i) => linear(s, `frag${i}`)), { circular: true }));
  out.gibson.push({ product: r.product?.sequence ?? null, warnings: r.warnings?.slice(0, 2) });
}
out.missingEnzymes = [...missing];
out.golden_gate = [];
for (const sc of scen.golden_gate ?? []) {
  const r = safe(() =>
    cl.simulateGoldenGateAssembly(sc.parts.map((s, i) => linear(s, `part${i}`)), byName.get('BsaI'), { circular: true }),
  );
  out.golden_gate.push({ product: r.product?.sequence ?? null, warnings: (r.warnings ?? r.internalSiteWarnings)?.slice(0, 2) });
}
writeFileSync(outPath, JSON.stringify(out));
await vite.close();
