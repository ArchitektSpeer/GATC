// SPDX-License-Identifier: GPL-3.0-or-later
// GATC as an MCP server: the deterministic sequence tools of src/modules, exposed
// for other agents and harnesses. Every tool is a thin wrapper around the same
// functions the workbench uses; nothing here re-implements a calculation.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PlasmidDocument, RestrictionEnzyme } from '../types/schema';
import {
  exportPlasmidToFasta,
  exportPlasmidToGenBank,
  exportPlasmidToSnapGene,
  exportPlasmidToSnapGeneJson,
  serializeProject,
} from '../modules/io-adapter';
import {
  COMMERCIAL_ENZYMES,
  autoAnnotateFeatures,
  findAllORFs,
  findCutSites,
  getEnzymeByName,
  reverseComplement,
  searchMotif,
  translateDna,
} from '../modules/seq-engine';
import {
  designMutagenesisPrimers,
  designPrimerPair,
  evaluateOligoThermodynamics,
  simulateDigestion,
  simulateGibsonAssembly,
  simulateGoldenGateAssembly,
  simulatePCR,
} from '../modules/cloning-primer';
import { alignTraceToPlasmid, parseAb1Trace } from '../modules/alignment-gel';
import { rangeError, rangeSequence } from '../lib/ranges';
import { version } from '../../package.json';
import { FileAccess, docInputSchema, range1, readDocuments, resolveDoc, summarize, toArrayBuffer } from './inputs';

export const SERVER_INSTRUCTIONS = `GATC molecular cloning tools (deterministic; no wet-lab protocols).
Coordinates: every start/end is 0-based and half-open [start, end), like Python slices. On a circular
molecule start > end means the range crosses the origin. "location" fields repeat the range as
1-based inclusive GenBank text (e.g. "101..250", or "901..1000,1..50" across the origin).
DNA input ("doc"): {path} to a file inside the allowed directories, {sequence, topology} inline, or
{document} as returned by another tool, so results can be chained (e.g. simulate_pcr -> simulate_gibson
-> write_sequence_file). Only write_sequence_file changes anything on disk.`;

type Json = Record<string, unknown>;

function result(value: Json) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function enzymesByName(names: string[]): RestrictionEnzyme[] {
  const missing: string[] = [];
  const found = names.map((n) => {
    const e = getEnzymeByName(n);
    if (!e) missing.push(n);
    return e;
  });
  if (missing.length) throw new Error(`Unknown enzyme(s): ${missing.join(', ')}`);
  return found as RestrictionEnzyme[];
}

function checkRange(doc: PlasmidDocument, start: number, end: number, allowEmpty = false) {
  const e = rangeError(doc, start, end, { allowEmpty });
  if (e) throw new Error(`Invalid range [${start}, ${end}) on ${doc.name} (${doc.length} bp, ${doc.topology}): ${e}`);
}

const conditionsSchema = z
  .object({
    naMm: z.number().min(0).max(5000).optional().describe('Monovalent cations, mM (default 50)'),
    mgMm: z.number().min(0).max(1000).optional().describe('Mg2+, mM (default 2)'),
    dntpMm: z.number().min(0).max(1000).optional().describe('dNTP, mM (default 0.8)'),
    oligoNm: z.number().positive().max(1e7).optional().describe('Oligo concentration, nM (default 250)'),
  })
  .optional()
  .describe('Reaction conditions for Tm; SantaLucia 1998 nearest neighbour with Owczarzy 2008 salt correction');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function primerOut(p: { name: string; sequence: string; bindingStart: number; bindingEnd: number; strand: 1 | -1; tailSequence: string; tmAnnealing: number; tmTotal: number; gcPercent: number; hairpinDeltaG: number; selfDimerDeltaG: number }, length: number) {
  return {
    name: p.name,
    sequence: p.sequence,
    annealing: p.sequence.slice(p.tailSequence.length),
    tail: p.tailSequence,
    bindingStart: p.bindingStart,
    bindingEnd: p.bindingEnd,
    location: range1(p.bindingStart, p.bindingEnd, length),
    strand: p.strand,
    tmAnnealing: Number(p.tmAnnealing.toFixed(2)),
    tmTotal: Number(p.tmTotal.toFixed(2)),
    gcPercent: Number(p.gcPercent.toFixed(1)),
    hairpinDeltaG: p.hairpinDeltaG,
    selfDimerDeltaG: p.selfDimerDeltaG,
  };
}

function productOut(product: PlasmidDocument | null, warnings: string[], extra: Json = {}): Json {
  return {
    ok: !!product,
    warnings,
    ...extra,
    ...(product ? { product: summarize(product, { includeSequence: true }), document: product } : {}),
  };
}

export function createGatcServer(opts: { roots: string[] }): McpServer {
  const files = new FileAccess(opts.roots);
  const server = new McpServer({ name: 'gatc', version }, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    'read_sequence_file',
    {
      title: 'Read a sequence file',
      description:
        'Read a DNA sequence or GATC project file and return its documents: name, length, topology, GC%, features, primers. ' +
        'Formats: SnapGene .dna, GenBank, FASTA, EMBL, GFF, Geneious, SBOL, .gatc projects.',
      inputSchema: {
        path: z.string().describe('File inside the allowed directories'),
        includeSequence: z.boolean().default(false).describe('Also return the full sequence of each document'),
      },
      annotations: READ_ONLY,
    },
    async ({ path: p, includeSequence }) => {
      const docs = await readDocuments(files, p);
      return result({ documents: docs.map((d) => summarize(d, { includeSequence })) });
    },
  );

  server.registerTool(
    'find_restriction_sites',
    {
      title: 'Find restriction sites',
      description:
        'Scan both strands (and across the origin of circular DNA) for restriction sites. Reports recognition position, ' +
        'top/bottom-strand cut positions, overhang, and whether Dam/Dcm methylation blocks the site under the document methylation setting.',
      inputSchema: {
        doc: docInputSchema,
        enzymes: z.array(z.string()).optional().describe('Enzyme names, e.g. ["EcoRI","BsaI"]; default: all commercial enzymes'),
        uniqueOnly: z.boolean().default(false).describe('Only enzymes that cut exactly once'),
        limit: z.number().int().min(1).max(20000).default(1000).describe('Maximum number of sites returned'),
      },
      annotations: READ_ONLY,
    },
    async ({ doc: input, enzymes, uniqueOnly, limit }) => {
      const doc = await resolveDoc(files, input);
      const all = findCutSites(doc, enzymes ? enzymesByName(enzymes) : COMMERCIAL_ENZYMES, { uniqueOnly });
      const sites = all.slice(0, limit).map((s) => ({
        enzyme: s.enzyme.name,
        recognitionSeq: s.enzyme.recognitionSeq,
        position: s.position,
        strand: s.strand,
        cutTop: s.cutPositionTop,
        cutBottom: s.cutPositionBottom,
        overhangType: s.overhangType,
        overhangSeq: s.overhangSeq,
        methylationBlocked: s.isMethylationBlocked,
        cutsInSequence: s.totalCutsInPlasmid,
      }));
      return result({ sequence: doc.name, length: doc.length, topology: doc.topology, total: all.length, truncated: all.length > limit, sites });
    },
  );

  server.registerTool(
    'digest',
    {
      title: 'Restriction digest',
      description:
        'Cut DNA with one or more enzymes and return the fragments with their sticky/blunt ends. Methylation-blocked sites are skipped and reported.',
      inputSchema: {
        doc: docInputSchema,
        enzymes: z.array(z.string()).min(1).describe('Enzyme names'),
        includeDocuments: z.boolean().default(false).describe('Return each fragment as a full document for chaining'),
      },
      annotations: READ_ONLY,
    },
    async ({ doc: input, enzymes, includeDocuments }) => {
      const doc = await resolveDoc(files, input);
      const sites = findCutSites(doc, enzymesByName(enzymes));
      const usable = sites.filter((s) => !s.isMethylationBlocked);
      const fragments = usable.length ? simulateDigestion(doc, usable) : [];
      return result({
        sequence: doc.name,
        cuts: usable.length,
        blockedByMethylation: sites.filter((s) => s.isMethylationBlocked).map((s) => `${s.enzyme.name}@${s.position}`),
        fragments: fragments.map((f) => ({
          length: f.length,
          ends: f.linearEnds ?? null,
          ...(includeDocuments ? { document: f } : {}),
        })),
        ...(fragments.length ? {} : { note: 'No usable site: the DNA is not cut' }),
      });
    },
  );

  server.registerTool(
    'design_primers',
    {
      title: 'Design a PCR primer pair',
      description:
        'Design forward and reverse primers that amplify [targetStart, targetEnd). Picks 18-28 nt annealing regions with balanced Tm and a 3\' GC clamp; ' +
        'optional 5\' tails or restriction sites. Returns full order sequences, annealing parts, Tm, hairpin and self-dimer dG (kcal/mol).',
      inputSchema: {
        doc: docInputSchema,
        targetStart: z.number().int().min(0).describe('0-based start of the region to amplify'),
        targetEnd: z.number().int().min(0).describe('0-based exclusive end'),
        targetTm: z.number().min(40).max(80).optional().describe('Annealing Tm goal, °C (default 60)'),
        forwardTail: z.string().optional().describe("5' tail added to the forward primer"),
        reverseTail: z.string().optional().describe("5' tail added to the reverse primer"),
        enzymeSiteForward: z.string().optional().describe('Restriction enzyme whose site is added to the forward primer'),
        enzymeSiteReverse: z.string().optional().describe('Restriction enzyme whose site is added to the reverse primer'),
        leaderBases: z.string().optional().describe("Protective bases 5' of an added site"),
        conditions: conditionsSchema,
      },
      annotations: READ_ONLY,
    },
    async (a) => {
      const doc = await resolveDoc(files, a.doc);
      checkRange(doc, a.targetStart, a.targetEnd);
      const site = (n?: string) => (n ? enzymesByName([n])[0].recognitionSeq : undefined);
      const r = designPrimerPair(doc, { start: a.targetStart, end: a.targetEnd }, {
        targetTm: a.targetTm,
        forwardTail: a.forwardTail,
        reverseTail: a.reverseTail,
        enzymeSiteForward: site(a.enzymeSiteForward),
        enzymeSiteReverse: site(a.enzymeSiteReverse),
        leaderBases: a.leaderBases,
        cond: a.conditions,
      });
      return result({
        forward: primerOut(r.forward, doc.length),
        reverse: primerOut(r.reverse, doc.length),
        productLength: r.productLength,
        productSequence: r.productSequence,
        warnings: r.warnings,
      });
    },
  );

  server.registerTool(
    'oligo_thermodynamics',
    {
      title: 'Oligo Tm and secondary structure',
      description: 'Tm, ΔH, ΔS, ΔG37, GC%, hairpin and self-dimer ΔG (kcal/mol) of one oligo, with ASCII drawings of the structures.',
      inputSchema: { sequence: z.string().min(2).max(500), conditions: conditionsSchema },
      annotations: READ_ONLY,
    },
    async ({ sequence, conditions }) => result({ ...evaluateOligoThermodynamics(sequence, conditions) }),
  );

  server.registerTool(
    'simulate_pcr',
    {
      title: 'Simulate PCR',
      description:
        "Find where two primers bind (3' end must anneal; 5' tails and a few mismatches allowed; circular templates across the origin) and return the product.",
      inputSchema: {
        template: docInputSchema,
        forwardPrimer: z.string().describe("Forward primer, 5'->3'"),
        reversePrimer: z.string().describe("Reverse primer, 5'->3'"),
        maxMismatches: z.number().int().min(0).max(5).optional().describe('Mismatches allowed in the annealing region (default 2)'),
      },
      annotations: READ_ONLY,
    },
    async ({ template, forwardPrimer, reversePrimer, maxMismatches }) => {
      const doc = await resolveDoc(files, template);
      const r = simulatePCR(doc, forwardPrimer, reversePrimer, { maxMismatches });
      return result(productOut(r.product, r.warnings));
    },
  );

  server.registerTool(
    'simulate_gibson',
    {
      title: 'Simulate Gibson / In-Fusion assembly',
      description: 'Join 2-8 fragments through 15-45 bp end homology (fragments may be reversed). Returns the product and every junction.',
      inputSchema: {
        fragments: z.array(docInputSchema).min(2).max(8),
        circular: z.boolean().default(true),
        minOverlap: z.number().int().min(8).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ fragments, circular, minOverlap }) => {
      const docs = await Promise.all(fragments.map((f) => resolveDoc(files, f)));
      const r = simulateGibsonAssembly(docs, { circular, minOverlap });
      return result(productOut(r.product, r.warnings, { junctions: r.junctions }));
    },
  );

  server.registerTool(
    'simulate_golden_gate',
    {
      title: 'Simulate Golden Gate assembly',
      description:
        'Cut parts with a Type IIS enzyme, join them through their overhangs and check for leftover sites. fidelityScore is a model score, not a measured success rate.',
      inputSchema: {
        parts: z.array(docInputSchema).min(1).max(30),
        enzyme: z.string().default('BsaI'),
        circular: z.boolean().default(true),
      },
      annotations: READ_ONLY,
    },
    async ({ parts, enzyme, circular }) => {
      const docs = await Promise.all(parts.map((p) => resolveDoc(files, p)));
      const r = simulateGoldenGateAssembly(docs, enzymesByName([enzyme])[0], { circular });
      return result(productOut(r.product, [...r.internalSiteWarnings, ...r.warnings], { overhangs: r.overhangs, fidelityScore: r.fidelityScore }));
    },
  );

  server.registerTool(
    'design_mutagenesis_primers',
    {
      title: 'Design site-directed mutagenesis primers',
      description:
        'Replace [start, end) with newBases: substitution, insertion (start == end) or deletion (newBases ""). Returns primers, the mutated document, and silent restriction sites that could mark the mutation.',
      inputSchema: {
        doc: docInputSchema,
        start: z.number().int().min(0),
        end: z.number().int().min(0),
        newBases: z.string().describe('Replacement bases; empty for a deletion'),
        mode: z.enum(['q5_back_to_back', 'quikchange']).default('q5_back_to_back'),
      },
      annotations: READ_ONLY,
    },
    async ({ doc: input, start, end, newBases, mode }) => {
      const doc = await resolveDoc(files, input);
      checkRange(doc, start, end, true);
      if (!/^[ACGT]*$/i.test(newBases)) throw new Error('newBases may only contain A, C, G and T');
      const r = designMutagenesisPrimers(doc, { start, end, newBases, mode }, COMMERCIAL_ENZYMES);
      return result({
        original: rangeSequence(doc, { start, end }),
        forward: primerOut(r.forward, doc.length),
        reverse: primerOut(r.reverse, doc.length),
        silentSiteSuggestions: r.silentSiteSuggestions,
        warnings: r.warnings,
        mutated: summarize(r.mutatedDoc),
        document: r.mutatedDoc,
      });
    },
  );

  server.registerTool(
    'find_orfs',
    {
      title: 'Find open reading frames',
      description: 'ORFs in all six frames (across the origin of circular DNA), with protein, molecular weight (kDa) and pI.',
      inputSchema: { doc: docInputSchema, minAminoAcids: z.number().int().min(10).max(10000).default(75) },
      annotations: READ_ONLY,
    },
    async ({ doc: input, minAminoAcids }) => {
      const doc = await resolveDoc(files, input);
      const orfs = findAllORFs(doc, minAminoAcids);
      return result({ orfs: orfs.map((o) => ({ ...o, location: range1(o.start, o.end, doc.length) })) });
    },
  );

  server.registerTool(
    'annotate_features',
    {
      title: 'Detect common features',
      description:
        'Match the built-in library of common elements (promoters, resistance genes, origins, tags, fluorescent proteins, recombination sites...) on both strands. Returns the features found; the input is not changed.',
      inputSchema: { doc: docInputSchema },
      annotations: READ_ONLY,
    },
    async ({ doc: input }) => {
      const doc = await resolveDoc(files, input);
      const found = autoAnnotateFeatures(doc);
      return result({ features: found.map((f) => ({ name: f.name, type: f.type, start: f.start, end: f.end, location: range1(f.start, f.end, doc.length), strand: f.strand, notes: f.notes ?? {} })) });
    },
  );

  server.registerTool(
    'search_motif',
    {
      title: 'Search a DNA or protein motif',
      description: 'Find an IUPAC DNA pattern on both strands (optionally with mismatches), or a protein pattern in the six-frame translation (X = any).',
      inputSchema: {
        doc: docInputSchema,
        pattern: z.string().min(1).max(1000),
        protein: z.boolean().default(false),
        maxMismatches: z.number().int().min(0).max(5).default(0),
      },
      annotations: READ_ONLY,
    },
    async ({ doc: input, pattern, protein, maxMismatches }) => {
      const doc = await resolveDoc(files, input);
      const hits = searchMotif(doc, pattern, { protein, maxMismatches, bothStrands: true });
      return result({ hits: hits.map((h) => ({ ...h, location: range1(h.start, h.end, doc.length) })) });
    },
  );

  server.registerTool(
    'translate',
    {
      title: 'Translate DNA',
      description: 'Translate [start, end) with the standard code; reverse-complemented first when strand is -1. Unknown codons become X.',
      inputSchema: {
        doc: docInputSchema,
        start: z.number().int().min(0).optional().describe('Default 0'),
        end: z.number().int().min(0).optional().describe('Default: sequence length'),
        strand: z.union([z.literal(1), z.literal(-1)]).default(1),
      },
      annotations: READ_ONLY,
    },
    async ({ doc: input, start = 0, end, strand }) => {
      const doc = await resolveDoc(files, input);
      const stop = end ?? doc.length;
      checkRange(doc, start, stop);
      let dna = rangeSequence(doc, { start, end: stop });
      if (strand === -1) dna = reverseComplement(dna);
      return result({ location: range1(start, stop, doc.length), strand, dnaLength: dna.length, protein: translateDna(dna) });
    },
  );

  server.registerTool(
    'align_sanger_trace',
    {
      title: 'Align a Sanger read to a reference',
      description:
        'Read an AB1 file, quality-trim it (Mott, Q13) and align it to the reference, including reads across the origin and on the reverse strand. ' +
        'Reports covered range, identity and each difference with its effect on CDS features. Low-quality or mixed-peak calls are flagged, not asserted.',
      inputSchema: { trace: z.string().describe('.ab1 / .abi file inside the allowed directories'), reference: docInputSchema },
      annotations: READ_ONLY,
    },
    async ({ trace: tracePath, reference }) => {
      const doc = await resolveDoc(files, reference);
      const { real, data } = await files.read(tracePath);
      const raw = await parseAb1Trace(toArrayBuffer(data), path.basename(real));
      const aligned = await alignTraceToPlasmid(raw, doc);
      const a = aligned.alignment;
      return result({
        fileName: aligned.fileName,
        readLength: aligned.calledSequence.length,
        trimRange: aligned.trimRange,
        ...(a
          ? {
              aligned: true,
              refStart: a.refStart,
              refEnd: a.refEnd,
              location: range1(a.refStart, a.refEnd, doc.length),
              strand: a.strand,
              identityPercent: a.identityPercent,
              differences: a.mismatches,
            }
          : { aligned: false, note: 'The read did not align to the reference' }),
      });
    },
  );

  server.registerTool(
    'write_sequence_file',
    {
      title: 'Write a sequence file',
      description:
        'Write a document to disk as GenBank, SnapGene .dna, FASTA, GATC JSON or a .gatc project. The only tool that changes files. ' +
        'Refuses to replace an existing file unless overwrite is true. GenBank and FASTA do not keep everything (see docs/COMPATIBILITY.md).',
      inputSchema: {
        doc: docInputSchema,
        path: z.string().describe('Target file inside the allowed directories; its directory must exist'),
        format: z.enum(['gbk', 'dna', 'fasta', 'json', 'gatc']),
        overwrite: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ doc: input, path: p, format, overwrite }) => {
      const doc = await resolveDoc(files, input);
      const target = await files.resolveForWrite(p);
      const exists = await fs.stat(target).then(() => true, () => false);
      if (exists && !overwrite) throw new Error(`${p} already exists; pass overwrite: true to replace it`);
      const content: string | Uint8Array =
        format === 'gbk'
          ? exportPlasmidToGenBank(doc)
          : format === 'dna'
            ? exportPlasmidToSnapGene(doc)
            : format === 'fasta'
              ? exportPlasmidToFasta(doc)
              : format === 'json'
                ? exportPlasmidToSnapGeneJson(doc)
                : serializeProject({ documents: [doc], workspace: { activeDocId: doc.id }, appVersion: version });
      // Write next to the target and rename, so a failure never leaves a half-written file.
      const tmp = `${target}.gatc-tmp-${process.pid}`;
      try {
        await fs.writeFile(tmp, content);
        await fs.rename(tmp, target);
      } catch (e) {
        await fs.rm(tmp, { force: true });
        throw e;
      }
      return result({ written: target, format, bytes: typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength, replaced: exists });
    },
  );

  return server;
}

