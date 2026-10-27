// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Remaining engine checks: pairwise alignment, single-fragment cloning (TA/TOPO/LIC/GC),
// mutagenesis primers, gel ladder read-back, and an LR reaction on a real entry vector whose
// att sites are not annotated.
// Usage: node scripts/crosscheck/gatc_misc.mjs out.json entryVector.dna destVector.dna
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [outPath, entryPath, destPath] = process.argv.slice(2);
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const io = await vite.ssrLoadModule('/src/modules/io-adapter/index.ts');
const seq = await vite.ssrLoadModule('/src/modules/seq-engine/index.ts');
const cl = await vite.ssrLoadModule('/src/modules/cloning-primer/index.ts');
const ag = await vite.ssrLoadModule('/src/modules/alignment-gel/index.ts');

const load = async (file) => {
  const buf = readFileSync(file);
  return io.parseSnapGeneBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), basename(file));
};
const bare = (doc) => ({ ...doc, features: [], primers: [] });
const linear = (name, sequence, left, right) => ({
  id: name, name, sequence, topology: 'linear', length: sequence.length,
  createdAt: '', updatedAt: '', features: [], primers: [], history: [],
  linearEnds: { left, right },
});
const end = (type, sequence) => ({ type, sequence, phosphorylated: true });
const safe = (fn) => {
  try { return fn(); } catch (e) { return { product: null, warnings: [String(e).slice(0, 160)] }; }
};

const out = {};

// 1. Pairwise alignment with the same affine-gap scoring Biopython will be given.
const PAIRS = [
  ['ACGTACGTAGCTAGCTTGCA', 'ACGTACGTTGCTAGCTTGCA'],
  ['ATGGCGAATTCGGCATTAGCAGGATTACCGTA', 'ATGGCGAATTCGGCTTAGCAGGATTACCGTA'],
  ['TTTTTTACGTACGTACGTAAAAAA', 'ACGTACGTACGT'],
  ['GATTACAGATTACAGATTACA', 'GATTACAGATTACA'],
  ['ACGT'.repeat(25), `${'ACGT'.repeat(12)}GGGG${'ACGT'.repeat(12)}`],
];
const SCORING = { match: 2, mismatch: -1, gapOpen: -5, gapExtend: -1 };
out.pairwise = PAIRS.map(([a, b]) => {
  const global = ag.pairwiseAlign(a, b, { ...SCORING, mode: 'global', type: 'dna' });
  const local = ag.pairwiseAlign(a, b, { ...SCORING, mode: 'local', type: 'dna' });
  return { a, b, globalScore: global.score, localScore: local.score, identity: global.identityPercent };
});

// 2. Single-fragment cloning: the product is the vector plus the insert in the chosen orientation.
const vectorTA = linear('pTA', 'GGATCCAAAGGGTTTCCCAAAGGGTTTCCC', end('3-prime', 'T'), end('3-prime', 'T'));
const insertTA = linear('amplicon', 'ATGCGTACGTTAGCACCATTGGCACGT', end('3-prime', 'A'), end('3-prime', 'A'));
const vectorGC = linear('pGC', vectorTA.sequence, end('3-prime', 'G'), end('3-prime', 'G'));
const insertGC = linear('gc-amplicon', insertTA.sequence, end('3-prime', 'C'), end('3-prime', 'C'));
const vectorBlunt = linear('pBlunt', vectorTA.sequence, end('blunt', ''), end('blunt', ''));
const insertBlunt = linear('blunt-amplicon', insertTA.sequence, end('blunt', ''), end('blunt', ''));
const vectorDir = linear('pDir', `GTGG${vectorTA.sequence}`, end('5-prime', 'GTGG'), end('blunt', ''));
const insertDir = linear('dir-amplicon', `CACC${insertTA.sequence}`, end('blunt', ''), end('blunt', ''));
const licTails = cl.LIC_DEFAULT_TAILS;
const vectorLic = linear('pLIC', `${licTails.reverse}${vectorTA.sequence}`, end('5-prime', licTails.reverse), end('5-prime', licTails.forward));
const insertLic = linear('lic-amplicon', `${licTails.forward}${insertTA.sequence}`, end('5-prime', licTails.forward), end('5-prime', licTails.reverse));

out.single_fragment = {
  ta_forward: safe(() => cl.simulateTACloning(vectorTA, insertTA, { orientation: 'forward' })),
  ta_reverse: safe(() => cl.simulateTACloning(vectorTA, insertTA, { orientation: 'reverse' })),
  ta_blunt_vector_rejected: safe(() => cl.simulateTACloning(vectorBlunt, insertTA)),
  gc_forward: safe(() => cl.simulateGCCloning(vectorGC, insertGC, { orientation: 'forward' })),
  gc_wrong_overhang_rejected: safe(() => cl.simulateGCCloning(vectorTA, insertGC)),
  topo_blunt: safe(() => cl.simulateTOPOCloning(vectorBlunt, insertBlunt, 'blunt')),
  topo_directional: safe(() => cl.simulateTOPOCloning(vectorDir, insertDir, 'directional')),
  topo_directional_no_cacc: safe(() => cl.simulateTOPOCloning(vectorDir, insertBlunt, 'directional')),
  lic: safe(() => cl.simulateLIC(vectorLic, insertLic)),
  lic_mismatched_tails: safe(() => cl.simulateLIC(vectorTA, insertTA)),
};
out.single_fragment_inputs = {
  vector: vectorTA.sequence,
  insert: insertTA.sequence,
  vectorDir: vectorDir.sequence,
  insertDir: insertDir.sequence,
  vectorLic: vectorLic.sequence,
  insertLic: insertLic.sequence,
};
for (const [key, value] of Object.entries(out.single_fragment)) {
  out.single_fragment[key] = {
    product: value.product?.sequence ?? null,
    orientation: value.orientation ?? null,
    warnings: (value.warnings ?? []).slice(0, 2),
  };
  void key;
}

// 3. Site-directed mutagenesis: the designed primers and the mutated sequence.
const cds = 'ATGGCTAGCAAAGGCGAAGAACTGTTTACCGGCGTTGTTCCGATTCTGGTTGAACTGGATGGCGATGTTAAC';
const template = {
  id: 'mut', name: 'mut-template', sequence: `GGCACTTAGCCTA${cds}TTAGGCCATTAAGCTTGGCAC`,
  topology: 'circular', length: 0, createdAt: '', updatedAt: '',
  features: [{ id: 'cds', name: 'gene', type: 'CDS', start: 13, end: 13 + cds.length, strand: 1, color: '#2563eb' }],
  primers: [], history: [],
};
template.length = template.sequence.length;
const MUTATIONS = [
  { kind: 'substitution', position: 13 + 9, replacement: 'GAT' },
  { kind: 'substitution', position: 13 + 30, replacement: 'TAA' },
  { kind: 'deletion', position: 13 + 15, length: 3 },
  { kind: 'insertion', position: 13 + 21, insertion: 'CATCATCAT' },
];
out.mutagenesis = MUTATIONS.map((mutation) => {
  // designMutagenesisPrimers takes the replaced interval; a deletion and an insertion are
  // expressed as a replacement of that interval by nothing or by the inserted bases.
  const spec =
    mutation.kind === 'substitution'
      ? { start: mutation.position, end: mutation.position + mutation.replacement.length, newBases: mutation.replacement }
      : mutation.kind === 'deletion'
        ? { start: mutation.position, end: mutation.position + mutation.length, newBases: '' }
        : { start: mutation.position, end: mutation.position, newBases: mutation.insertion };
  const designed = safe(() => cl.designMutagenesisPrimers(template, spec));
  const edit =
    mutation.kind === 'substitution'
      ? { type: 'replace', start: mutation.position, end: mutation.position + mutation.replacement.length, bases: mutation.replacement }
      : mutation.kind === 'deletion'
        ? { type: 'delete', start: mutation.position, end: mutation.position + mutation.length }
        : { type: 'insert', position: mutation.position, bases: mutation.insertion };
  const mutated = safe(() => ({ product: seq.mutatePlasmidSequence(template, edit) }));
  return {
    mutation,
    forward: designed.forward?.sequence ?? null,
    reverse: designed.reverse?.sequence ?? null,
    forwardTm: designed.forward?.tmAnnealing ?? null,
    mutatedSequence: mutated.product?.sequence ?? null,
    cdsStart: mutated.product?.features?.find((f) => f.name === 'gene')?.start ?? null,
    cdsEnd: mutated.product?.features?.find((f) => f.name === 'gene')?.end ?? null,
    warnings: (designed.warnings ?? []).slice(0, 2),
  };
});

// 4. Virtual gel: a fragment's size read back off the ladder it ran beside.
const GEL_SIZES = [250, 500, 1000, 2000, 3000, 5000, 8000];
const gelParams = { agarosePercent: 1, voltage: 5, minutes: 45 };
const lanes = ag.simulateVirtualGel(
  [
    { label: 'ladder', ladder: 'NEB 1kb Plus' },
    { label: 'sample', fragments: GEL_SIZES.map((sizeBp) => ({ sizeBp, conformation: 'linear', massNg: 50 })) },
  ],
  gelParams,
);
out.gel = {
  params: gelParams,
  ladder: lanes[0].bands.map((band) => ({ sizeBp: band.sizeBp, migration: band.migrationY })),
  sample: lanes[1].bands.map((band) => ({ sizeBp: band.sizeBp, migration: band.migrationY })),
};

// 5. LR on a real entry vector with its annotations removed, so the att sites must be found
//    from the sequence alone.
const entryDoc = await load(entryPath);
const destDoc = await load(destPath);
const lr = safe(() => cl.simulateGatewayLR(bare(entryDoc), bare(destDoc)));
out.unannotated_lr = {
  entry: entryDoc.sequence,
  destination: destDoc.sequence,
  product: lr.expressionClone?.sequence ?? null,
  warnings: (lr.warnings ?? []).slice(0, 3),
};

writeFileSync(outPath, JSON.stringify(out));
await vite.close();
