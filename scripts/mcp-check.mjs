// SPDX-License-Identifier: GPL-3.0-or-later
// Starts the built MCP server over stdio, as an external harness would, and calls its tools.
// Usage: npm run mcp:build && node scripts/mcp-check.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'gatc-mcp-'));
const transport = new StdioClientTransport({ command: process.execPath, args: ['dist-mcp/gatc-mcp.mjs', '--root', 'test-data', '--root', out], stderr: 'pipe' });
const client = new Client({ name: 'gatc-mcp-check', version: '1' });
await client.connect(transport);

const results = [];
const check = async (name, fn) => {
  try {
    results.push({ name, ok: true, detail: (await fn()) ?? '' });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e?.message ?? e).split('\n')[0] });
  }
};
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content?.[0]?.text ?? 'tool error');
  return r.structuredContent;
};
const pUC = { path: 'addgene-plasmid.dna' };

await check('tools/list', async () => {
  const { tools } = await client.listTools();
  const writers = tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name);
  if (writers.join() !== 'write_sequence_file') throw new Error(`unexpected writable tools: ${writers}`);
  return `${tools.length} tools; instructions ${client.getInstructions()?.length ?? 0} chars`;
});
await check('read_sequence_file (.dna)', async () => {
  const r = await call('read_sequence_file', { path: 'addgene-plasmid.dna' });
  const d = r.documents[0];
  return `${d.name}: ${d.length} bp ${d.topology}, ${d.features.length} features, ${d.primers.length} primers`;
});
await check('find_restriction_sites (unique)', async () => {
  const r = await call('find_restriction_sites', { doc: pUC, uniqueOnly: true });
  return `${r.total} unique cutters, e.g. ${r.sites.slice(0, 3).map((s) => `${s.enzyme}@${s.position}`).join(', ')}`;
});
await check('design_primers -> simulate_pcr chain', async () => {
  const p = await call('design_primers', { doc: pUC, targetStart: 100, targetEnd: 700 });
  const pcr = await call('simulate_pcr', { template: pUC, forwardPrimer: p.forward.sequence, reversePrimer: p.reverse.sequence });
  if (pcr.product.length !== p.productLength) throw new Error(`PCR ${pcr.product.length} bp vs designed ${p.productLength} bp`);
  return `Tm ${p.forward.tmAnnealing}/${p.reverse.tmAnnealing} °C, product ${pcr.product.length} bp`;
});
await check('align_sanger_trace (.ab1)', async () => {
  const r = await call('align_sanger_trace', { trace: 'example1.ab1', reference: { path: 'pIB2-SEC13-mEGFP.dna' } });
  return r.aligned ? `${r.location} strand ${r.strand}, ${r.identityPercent}% identity, ${r.differences.length} differences` : r.note;
});
await check('write_sequence_file refuses to overwrite', async () => {
  const doc = { sequence: 'ATGAAATAG', topology: 'linear', name: 'tiny' };
  const target = join(out, 'tiny.gbk');
  await call('write_sequence_file', { doc, path: target, format: 'gbk' });
  const again = await client.callTool({ name: 'write_sequence_file', arguments: { doc, path: target, format: 'gbk' } });
  if (!again.isError) throw new Error('second write was not refused');
  return `${readFileSync(target, 'utf8').split('\n')[0].slice(0, 40)}…`;
});
await check('paths outside the roots are refused', async () => {
  const r = await client.callTool({ name: 'read_sequence_file', arguments: { path: '/etc/passwd' } });
  if (!r.isError) throw new Error('read outside the roots succeeded');
  return r.content[0].text.slice(0, 60);
});

await client.close();
rmSync(out, { recursive: true, force: true });
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
