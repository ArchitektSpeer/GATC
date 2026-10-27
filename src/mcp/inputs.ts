// SPDX-License-Identifier: GPL-3.0-or-later
// Inputs shared by the MCP tools: sandboxed file access and document arguments.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { PlasmidDocument, SequenceFeature } from '../types/schema';
import { isProjectFile, loadProject, parseBioFile, parseProjectFile } from '../modules/io-adapter';
import { calcGcPercent } from '../modules/seq-engine';

/** Largest file the server reads, and the longest sequence it accepts inline. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_SEQUENCE = 10_000_000;

/**
 * File access limited to a set of root directories. Paths are resolved against
 * the first root, symlinks are followed, and anything that ends up outside every
 * root is refused.
 */
export class FileAccess {
  readonly roots: string[];

  constructor(roots: string[]) {
    if (!roots.length) throw new Error('At least one root directory is required');
    this.roots = roots.map((r) => path.resolve(r));
  }

  /** `real` must already be symlink-resolved; it is compared with the resolved roots. */
  private async check(real: string, shown: string): Promise<void> {
    const roots = await Promise.all(this.roots.map((r) => fs.realpath(r).catch(() => r)));
    if (!roots.some((root) => real === root || real.startsWith(root + path.sep))) {
      throw new Error(`Path is outside the allowed directories (${this.roots.join(', ')}): ${shown}`);
    }
  }

  /** Absolute, symlink-resolved path of an existing file inside the roots. */
  async resolveExisting(p: string): Promise<string> {
    const abs = path.resolve(this.roots[0], p);
    const real = await fs.realpath(abs).catch(() => {
      throw new Error(`File not found: ${p}`);
    });
    await this.check(real, p);
    return real;
  }

  /** Absolute path for a new or replaced file; its directory must exist inside the roots. */
  async resolveForWrite(p: string): Promise<string> {
    const abs = path.resolve(this.roots[0], p);
    const dir = await fs.realpath(path.dirname(abs)).catch(() => {
      throw new Error(`Directory does not exist: ${path.dirname(p)}`);
    });
    const target = path.join(dir, path.basename(abs));
    await this.check(target, p);
    // Replacing a symlink would write wherever it points; refuse instead.
    const stat = await fs.lstat(target).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error(`Refusing to write through a symbolic link: ${p}`);
    return target;
  }

  async read(p: string): Promise<{ real: string; data: Buffer }> {
    const real = await this.resolveExisting(p);
    const stat = await fs.stat(real);
    if (!stat.isFile()) throw new Error(`Not a file: ${p}`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB: ${p}`);
    return { real, data: await fs.readFile(real) };
  }
}

const BINARY = /\.(dna|prot|xdna|cm5|ab1|abi)$/i;

export function toArrayBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** Every DNA document in a sequence or project file. */
export async function readDocuments(files: FileAccess, p: string): Promise<PlasmidDocument[]> {
  const { real, data } = await files.read(p);
  const name = path.basename(real);
  if (BINARY.test(name)) return parseBioFile(name, toArrayBuffer(data));
  const text = data.toString('utf8');
  if (isProjectFile(name, text)) return parseProjectFile(text).project.documents;
  return parseBioFile(name, text);
}

/* ------------------------------ Document input ----------------------------- */

const IUPAC_DNA = /^[ACGTURYSWKMBDHVN]*$/;

export const docInputSchema = z
  .union([
    z.object({
      path: z.string().describe('Sequence or project file (.dna, .gb/.gbk, .fasta, .embl, .gff, .gatc, ...) inside the allowed directories'),
      index: z.number().int().min(0).optional().describe('Which document when the file holds several (default 0)'),
    }),
    z.object({
      sequence: z.string().describe('DNA sequence, IUPAC letters; whitespace is ignored'),
      topology: z.enum(['circular', 'linear']).default('linear'),
      name: z.string().optional(),
    }),
    z.object({
      document: z.record(z.string(), z.unknown()).describe('A full document as returned in the "document" field of another GATC tool'),
    }),
  ])
  .describe('The DNA to work on: a file, an inline sequence, or a document returned by another tool');

export type DocInput = z.infer<typeof docInputSchema>;

let inlineCounter = 0;

export function inlineDocument(sequence: string, topology: 'circular' | 'linear', name?: string): PlasmidDocument {
  const seq = sequence.replace(/\s+/g, '').toUpperCase().replace(/U/g, 'T');
  if (!IUPAC_DNA.test(seq)) throw new Error('Sequence contains characters that are not IUPAC DNA letters');
  if (!seq.length) throw new Error('Sequence is empty');
  if (seq.length > MAX_SEQUENCE) throw new Error(`Sequence is longer than ${MAX_SEQUENCE} bp`);
  const now = new Date().toISOString();
  return {
    id: `inline-${++inlineCounter}`,
    name: name ?? 'sequence',
    sequence: seq,
    topology,
    length: seq.length,
    createdAt: now,
    updatedAt: now,
    features: [],
    primers: [],
    history: [],
  };
}

export async function resolveDoc(files: FileAccess, input: DocInput): Promise<PlasmidDocument> {
  if ('path' in input) {
    const docs = await readDocuments(files, input.path);
    const i = input.index ?? 0;
    if (!docs[i]) throw new Error(`${input.path} holds ${docs.length} document(s); index ${i} does not exist`);
    return docs[i];
  }
  if ('sequence' in input) return inlineDocument(input.sequence, input.topology, input.name);
  // Validated like a document inside a project file.
  return loadProject({ format: 'gatc-project', schemaVersion: 1, documents: [input.document] }).project.documents[0];
}

/* --------------------------------- Output --------------------------------- */

/** 1-based inclusive text for a 0-based half-open range, as GenBank writes it. */
export function range1(start: number, end: number, length: number): string {
  if (start === end) return `^${start}`;
  return start < end ? `${start + 1}..${end}` : `${start + 1}..${length},1..${end}`;
}

function featureSummary(f: SequenceFeature, length: number) {
  return { name: f.name, type: f.type, start: f.start, end: f.end, location: range1(f.start, f.end, length), strand: f.strand };
}

/** What a client usually needs to know about a document, without the full sequence. */
export function summarize(doc: PlasmidDocument, opts: { includeSequence?: boolean } = {}) {
  return {
    name: doc.name,
    length: doc.length,
    topology: doc.topology,
    gcPercent: Number(calcGcPercent(doc.sequence).toFixed(2)),
    ...(doc.description ? { description: doc.description } : {}),
    ...(doc.linearEnds ? { linearEnds: doc.linearEnds } : {}),
    features: doc.features.map((f) => featureSummary(f, doc.length)),
    primers: doc.primers.map((p) => ({
      name: p.name,
      sequence: p.sequence,
      bindingStart: p.bindingStart,
      bindingEnd: p.bindingEnd,
      strand: p.strand,
      tmAnnealing: Number(p.tmAnnealing.toFixed(1)),
    })),
    historySteps: doc.history.length,
    ...(opts.includeSequence ? { sequence: doc.sequence } : {}),
  };
}
