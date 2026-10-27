// Parses .dna files with GATC's io-adapter and dumps the same normalized JSON as
// ref_snapgene.py; also re-exports each document as .dna for the reverse check.
// Usage: node scripts/crosscheck/gatc_dump.mjs out.json exportDir file1.dna ...
import { createServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const [outPath, exportDir, ...files] = process.argv.slice(2);
mkdirSync(exportDir, { recursive: true });
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const io = await vite.ssrLoadModule('/src/modules/io-adapter/index.ts');

const parts = (f, n) => {
  const seg = f.notes?.segments;
  if (seg?.length) return seg.map((s) => s.split('-').map(Number));
  return f.start <= f.end || f.start === f.end ? [[f.start, f.end]] : [[f.start, n], [0, f.end]];
};

const out = {};
for (const file of files) {
  try {
    const buf = readFileSync(file);
    const doc = await io.parseSnapGeneBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), basename(file));
    out[file] = {
      sequence: doc.sequence,
      topology: doc.topology,
      features: doc.features.map((f) => ({ type: f.notes?.GATC_original_type?.[0] ?? f.type, label: f.name, strand: f.strand, parts: parts(f, doc.length) })),
      primers: doc.primers.map((p) => ({ type: 'primer_bind', label: p.name, strand: p.strand, parts: [[p.bindingStart, p.bindingEnd]] })),
    };
    writeFileSync(`${exportDir}/${basename(file)}`, io.exportPlasmidToSnapGene(doc));
  } catch (e) {
    out[file] = { error: String(e?.stack ?? e).slice(0, 400) };
  }
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
await vite.close();
