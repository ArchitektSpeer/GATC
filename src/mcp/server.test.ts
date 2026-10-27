// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseBioFile } from '../modules/io-adapter';
import { findCutSites, getEnzymeByName } from '../modules/seq-engine';
import { createGatcServer } from './server';

const DATA = resolve(__dirname, '../../test-data');
let out: string;
let client: Client;

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error((r.content as Array<{ text: string }>)[0].text);
  return r.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function callError(name: string, args: Record<string, unknown>): Promise<string> {
  const r = await client.callTool({ name, arguments: args });
  expect(r.isError).toBe(true);
  return (r.content as Array<{ text: string }>)[0].text;
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'gatc-mcp-test-'));
  const server = createGatcServer({ roots: [DATA, out] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
});

afterAll(async () => {
  await client.close();
  rmSync(out, { recursive: true, force: true });
});

describe('GATC MCP server', () => {
  it('lists its tools; only write_sequence_file is marked as writing', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(15);
    expect(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name)).toEqual(['write_sequence_file']);
    expect(client.getInstructions()).toMatch(/0-based and half-open/);
  });

  it('reports the same cut sites as the workbench', async () => {
    const r = await call('find_restriction_sites', { doc: { path: 'addgene-plasmid.dna' }, enzymes: ['EcoRI', 'BamHI', 'BsaI'] });
    const [doc] = await parseBioFile('addgene-plasmid.dna', readFileSync(join(DATA, 'addgene-plasmid.dna')).buffer as ArrayBuffer);
    const direct = findCutSites(doc, ['EcoRI', 'BamHI', 'BsaI'].map((n) => getEnzymeByName(n)!));
    expect(r.total).toBe(direct.length);
    expect(r.sites.map((s: { enzyme: string; position: number }) => `${s.enzyme}@${s.position}`)).toEqual(direct.map((s) => `${s.enzyme.name}@${s.position}`));
  });

  it('chains documents between tools', async () => {
    const insert = 'GGTCTCAAATG' + 'ACGT'.repeat(10) + 'GCTTAGAGACC';
    const pcr = await call('simulate_pcr', {
      template: { sequence: 'TTTT' + insert + 'TTTT', topology: 'linear' },
      forwardPrimer: insert.slice(0, 20),
      reversePrimer: 'GGTCTCTAAGCACGTACGTA',
    });
    expect(pcr.ok).toBe(true);
    const digest = await call('digest', { doc: { document: pcr.document }, enzymes: ['BsaI'] });
    expect(digest.fragments.length).toBe(3);
  });

  it('describes ranges across the origin in both conventions', async () => {
    const r = await call('translate', { doc: { sequence: 'GAAATAGATG', topology: 'circular' }, start: 7, end: 6 });
    expect(r.location).toBe('8..10,1..6');
    expect(r.protein).toBe('MEI'); // ATG + GAA + ATA
  });

  it('rejects invalid input with a clear message', async () => {
    expect(await callError('design_primers', { doc: { sequence: 'ACGT'.repeat(50) }, targetStart: 150, targetEnd: 100 })).toMatch(/线性|linear/);
    expect(await callError('translate', { doc: { sequence: 'ACGTXZ' } })).toMatch(/IUPAC/);
    expect(await callError('digest', { doc: { sequence: 'GAATTC' }, enzymes: ['NotAnEnzyme'] })).toMatch(/Unknown enzyme/);
  });

  it('never reads or writes outside the allowed directories', async () => {
    expect(await callError('read_sequence_file', { path: '/etc/hostname' })).toMatch(/outside/);
    expect(await callError('read_sequence_file', { path: '../package.json' })).toMatch(/outside/);
    // A symlink inside a root that points outside it is followed and refused.
    symlinkSync('/etc/hostname', join(out, 'escape.fasta'));
    expect(await callError('read_sequence_file', { path: join(out, 'escape.fasta') })).toMatch(/outside/);
    expect(await callError('write_sequence_file', { doc: { sequence: 'ACGT' }, path: '/tmp/gatc-should-not-exist.gbk', format: 'gbk' })).toMatch(/outside/);
    expect(await callError('write_sequence_file', { doc: { sequence: 'ACGT' }, path: join(out, 'escape.fasta'), format: 'fasta', overwrite: true })).toMatch(/symbolic link/);
  });

  it('writes files that read back, and refuses to overwrite unless asked', async () => {
    const target = join(out, 'pUC-copy.dna');
    await call('write_sequence_file', { doc: { path: 'addgene-plasmid.dna' }, path: target, format: 'dna' });
    const back = await call('read_sequence_file', { path: target });
    const original = await call('read_sequence_file', { path: 'addgene-plasmid.dna', includeSequence: true });
    expect(back.documents[0].length).toBe(original.documents[0].length);
    expect(await callError('write_sequence_file', { doc: { path: target }, path: target, format: 'dna' })).toMatch(/already exists/);
    const replaced = await call('write_sequence_file', { doc: { sequence: 'ACGT', name: 'x' }, path: target, format: 'gatc', overwrite: true });
    expect(replaced.replaced).toBe(true);
    expect(JSON.parse(readFileSync(target, 'utf8')).format).toBe('gatc-project');
  });

  it('reads documents from a .gatc project', async () => {
    const target = join(out, 'two.gatc');
    writeFileSync(target, readFileSync(resolve(__dirname, '../modules/io-adapter/migrations/fixtures/v1-project.gatc')));
    const r = await call('read_sequence_file', { path: target });
    expect(r.documents[0].name).toBe('MCS demo');
    expect(r.documents[0].features[0].location).toBe('61..69,1..10') // 69 bp circle;
  });
});
