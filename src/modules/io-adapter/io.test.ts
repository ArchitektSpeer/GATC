import { describe, expect, it } from 'vitest';
import {
  enrichSnapGeneBinary,
  exportPlasmidToFasta,
  exportPlasmidToGenBank,
  exportPlasmidToSnapGeneJson,
  parseBioFile,
  parseGenBankString,
  parseSnapGeneBuffer,
} from './index';
import type { PlasmidDocument } from '../../types/schema';

const SEQUENCE = 'ATGC'.repeat(30);

function buildGenBank(sequence: string): string {
  const origin = (sequence.match(/.{1,60}/g) ?? [])
    .map((line, index) => `${String(index * 60 + 1).padStart(9, ' ')} ${line.match(/.{1,10}/g)?.join(' ')}`)
    .join('\n');
  return [
    `LOCUS       wrap_test                ${sequence.length} bp ds-DNA     circular SYN 26-OCT-2026`,
    'DEFINITION  Circular test construct.',
    'FEATURES             Location/Qualifiers',
    '     misc_feature    20..40',
    '                     /label="normal_feature"',
    '                     /note="ordinary feature"',
    '                     /ApEinfo_fwdcolor="#112233"',
    '                     /ApEinfo_revcolor="#112233"',
    '     misc_feature    join(20..30,50..60)',
    '                     /label="split_feature"',
    '                     /ApEinfo_fwdcolor="#445566"',
    '                     /ApEinfo_revcolor="#445566"',
    '     CDS             complement(join(115..120,1..10))',
    '                     /label="wrapped_feature"',
    '                     /note="crosses the origin"',
    '                     /ApEinfo_fwdcolor="#FF00FF"',
    '                     /ApEinfo_revcolor="#FF00FF"',
    'ORIGIN',
    origin,
    '//',
    '',
  ].join('\n');
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function packet(type: number, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(5 + payload.length);
  const view = new DataView(result.buffer);
  view.setUint8(0, type);
  view.setUint32(1, payload.length, false);
  result.set(payload, 5);
  return result;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function cookiePacket(): Uint8Array {
  const payload = new Uint8Array(14);
  payload.set(encode('SnapGene'), 0);
  const view = new DataView(payload.buffer);
  view.setUint16(8, 1, false);
  view.setUint16(10, 1, false);
  view.setUint16(12, 1, false);
  return packet(0x09, payload);
}

function dnaPacket(sequence: string, circular: boolean): Uint8Array {
  const sequenceBytes = encode(sequence);
  const payload = new Uint8Array(1 + sequenceBytes.length);
  payload[0] = circular ? 0x01 : 0x00;
  payload.set(sequenceBytes, 1);
  return packet(0x00, payload);
}

function hexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function reverseComplement(sequence: string): string {
  const complement: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' };
  return sequence
    .split('')
    .reverse()
    .map((base) => complement[base] ?? 'N')
    .join('');
}

function buildSnapGene(sequence: string, historyXml: string, compressHistory = false): ArrayBuffer {
  const primerStart = 10;
  const primerSequence = sequence.slice(primerStart, primerStart + 20);
  const reverseStart = 40;
  const reverseSequence = reverseComplement(sequence.slice(reverseStart, reverseStart + 20));
  const notes = [
    '<Notes>',
    '<CustomMapLabel>Minimal Plasmid</CustomMapLabel>',
    '<Description>Small binary fixture.</Description>',
    '<Created UTC="12:00:00">2026.10.26</Created>',
    '<LastModified UTC="12:30:00">2026.10.26</LastModified>',
    '<TransformedInto>DH5alpha</TransformedInto>',
    '</Notes>',
  ].join('');
  const features = [
    '<Features>',
    '<Feature name="wrapped_binary" directionality="1" type="misc_feature">',
    '<Segment range="115-120" color="#00AABB" type="standard"/>',
    '<Segment range="1-10" color="#00AABB" type="standard"/>',
    '<Q name="note"><V text="wraps around the origin"/></Q>',
    '</Feature>',
    '</Features>',
  ].join('');
  const primers = [
    '<Primers>',
    '<HybridizationParams minContinuousMatchLen="10" allowMismatch="1" minMeltingTemperature="40"/>',
    `<Primer name="P1" sequence="${primerSequence}" description="fixture primer">`,
    `<BindingSite location="${primerStart}-${primerStart + 19}" boundStrand="0" annealedBases="${primerSequence}" meltingTemperature="58"/>`,
    `<BindingSite simplified="1" location="${primerStart}-${primerStart + 19}" boundStrand="0" annealedBases="${primerSequence}" meltingTemperature="58"/>`,
    '</Primer>',
    `<Primer name="P2" sequence="${reverseSequence}" description="reverse fixture primer">`,
    `<BindingSite location="${reverseStart}-${reverseStart + 19}" boundStrand="1" annealedBases="${reverseSequence}" meltingTemperature="58"/>`,
    '</Primer>',
    '</Primers>',
  ].join('');
  const historyPayload = compressHistory
    ? hexBytes(
        '789c5d90cf0e82300cc65f65e903c8e0cc38183592180fea0b345b6396b00dcb30e1ed2de80139b55fff7cfda5f5d90f39f1f460a2a6be26472a6220033d2737dabc7311410df4ba503450561a547b900494f56cc70e7911a927c6ec93ccf83810e713e33350cc0334751bfb31dfc71090271530fa5ef6d6c3b0dc2c0d1c6dbab55f5519d863388b7a6327ad522f999485a1f84745964b1b52fd23d51b38f1f06e3628660709eb077c00b6b2588e',
      )
    : encode(historyXml);
  return concat([
    cookiePacket(),
    dnaPacket(sequence, true),
    packet(0x06, encode(notes)),
    packet(0x0a, encode(features)),
    packet(0x05, encode(primers)),
    packet(0x07, historyPayload),
  ]).buffer as ArrayBuffer;
}

const HISTORY_XML = [
  '<HistoryTree>',
  '<Node name="product.dna" seqLen="120" ID="1" circular="1" operation="insertFragments">',
  '<InputSummary manipulation="insert" name1="EcoRI" name2="BamHI" val1="10" val2="20"/>',
  '<Node name="parent.dna" seqLen="100" ID="0" operation="invalid"/>',
  '</Node>',
  '</HistoryTree>',
].join('');

function findFeature(doc: PlasmidDocument, name: string) {
  const feature = doc.features.find((item) => item.name === name);
  if (!feature) throw new Error(`Missing feature ${name}`);
  return feature;
}

describe('GenBank import/export', () => {
  it('parses 0-based half-open ranges and origin-spanning joins', async () => {
    const doc = await parseGenBankString(buildGenBank(SEQUENCE));

    expect(doc.sequence).toBe(SEQUENCE);
    expect(doc.length).toBe(SEQUENCE.length);
    expect(doc.topology).toBe('circular');
    expect(doc.methylationProfile).toEqual({ dam: true, dcm: true, cpg: false });
    expect(doc.features.length).toBeGreaterThanOrEqual(2);
    expect(doc.features.every((feature) => /^#[0-9A-F]{6}$/.test(feature.color))).toBe(true);
    expect(doc.history[0]?.operation).toBe('import');

    const normal = findFeature(doc, 'normal_feature');
    expect(normal.start).toBe(19);
    expect(normal.end).toBe(40);
    expect(normal.strand).toBe(1);
    expect(normal.color).toBe('#112233');
    expect(normal.notes?.note).toEqual(['ordinary feature']);

    const wrapped = findFeature(doc, 'wrapped_feature');
    expect(wrapped.start).toBe(114);
    expect(wrapped.end).toBe(10);
    expect(wrapped.start).toBeGreaterThan(wrapped.end);
    expect(wrapped.strand).toBe(-1);
    expect(wrapped.color).toBe('#FF00FF');

    const split = findFeature(doc, 'split_feature');
    expect(split.start).toBe(19);
    expect(split.end).toBe(60);
    expect(split.color).toBe('#445566');
  });

  it('dispatches GenBank and JSON by file extension', async () => {
    const [gbkDoc] = await parseBioFile('wrap_test.gb', buildGenBank(SEQUENCE));
    expect(gbkDoc.sequence).toBe(SEQUENCE);
    expect(gbkDoc.features.length).toBeGreaterThanOrEqual(2);

    const json = exportPlasmidToSnapGeneJson(gbkDoc);
    const [jsonDoc] = await parseBioFile('wrap_test.json', json);
    expect(jsonDoc.sequence).toBe(SEQUENCE);
    expect(jsonDoc.features.length).toBe(gbkDoc.features.length);
  });

  it('round-trips GenBank while preserving ApE colour qualifiers', async () => {
    const first = await parseGenBankString(buildGenBank(SEQUENCE));
    const exported = exportPlasmidToGenBank(first);

    expect(exported).toContain('/ApEinfo_fwdcolor="#FF00FF"');
    expect(exported).toContain('/ApEinfo_revcolor="#FF00FF"');
    expect(exported).toMatch(/complement\(join\(115\.\.120,1\.\.10\)\)/);
    expect(exported).toContain('join(20..30,50..60)');

    const second = await parseGenBankString(exported);
    expect(second.sequence).toBe(first.sequence);
    expect(second.length).toBe(first.length);
    expect(second.topology).toBe(first.topology);

    const wrapped = findFeature(second, 'wrapped_feature');
    expect(wrapped.start).toBe(114);
    expect(wrapped.end).toBe(10);
    expect(wrapped.strand).toBe(-1);
    expect(wrapped.color).toBe('#FF00FF');

    const normal = findFeature(second, 'normal_feature');
    expect(normal.start).toBe(19);
    expect(normal.end).toBe(40);
    expect(normal.color).toBe('#112233');

    const split = findFeature(second, 'split_feature');
    expect(split.start).toBe(19);
    expect(split.end).toBe(60);
    expect(split.color).toBe('#445566');
  });
});

describe('FASTA import/export', () => {
  it('round-trips sequence, name and topology metadata', async () => {
    const fasta = `>fasta_fixture|test description\n${(SEQUENCE.match(/.{1,60}/g) ?? []).join('\n')}\n`;
    const [first] = await parseBioFile('fasta_fixture.fasta', fasta);
    expect(first.sequence).toBe(SEQUENCE);
    expect(first.name).toBe('fasta_fixture');

    const exported = exportPlasmidToFasta({ ...first, topology: 'circular' });
    const [second] = await parseBioFile('fasta_fixture.fasta', exported);
    expect(second.sequence).toBe(SEQUENCE);
    expect(second.name).toBe(first.name);
    expect(second.topology).toBe('circular');
  });
});

describe('SnapGene binary parsing', () => {
  it('parses a minimal cookie + DNA document', async () => {
    const minimal = concat([cookiePacket(), dnaPacket(SEQUENCE, false)]).buffer as ArrayBuffer;
    const doc = await parseSnapGeneBuffer(minimal, 'minimal_only.dna');
    expect(doc.sequence).toBe(SEQUENCE);
    expect(doc.length).toBe(SEQUENCE.length);
    expect(doc.topology).toBe('linear');
    expect(doc.name).toBe('minimal_only');
    expect(doc.features).toEqual([]);
    expect(doc.primers).toEqual([]);
    expect(doc.history[0]?.operation).toBe('import');
    expect(doc.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(doc.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(doc.methylationProfile).toEqual({ dam: true, dcm: true, cpg: false });

    const enriched = enrichSnapGeneBinary(minimal, doc);
    expect(enriched.length).toBe(SEQUENCE.length);
    expect(enriched.sequence).toBe(SEQUENCE);
  });

  it('reads linear overhang metadata from the additional properties packet', async () => {
    const properties = [
      '<AdditionalSequenceProperties>',
      '<UpstreamStickiness>-1</UpstreamStickiness>',
      '<DownstreamStickiness>0</DownstreamStickiness>',
      '<UpstreamModification>FivePrimePhosphorylated</UpstreamModification>',
      '<DownstreamModification>Unmodified</DownstreamModification>',
      '</AdditionalSequenceProperties>',
    ].join('');
    const linear = concat([
      cookiePacket(),
      dnaPacket(SEQUENCE, false),
      packet(0x08, encode(properties)),
    ]).buffer as ArrayBuffer;
    const doc = await parseSnapGeneBuffer(linear, 'linear_ends.dna');
    expect(doc.topology).toBe('linear');
    expect(doc.linearEnds?.left.type).toBe('3-prime');
    expect(doc.linearEnds?.left.phosphorylated).toBe(true);
    expect(doc.linearEnds?.right.type).toBe('blunt');
    expect(doc.linearEnds?.right.phosphorylated).toBe(false);
  });

  it('parses cookie, DNA, primers and the history tree', async () => {
    const doc = await parseSnapGeneBuffer(buildSnapGene(SEQUENCE, HISTORY_XML), 'minimal.dna');

    expect(doc.sequence).toBe(SEQUENCE);
    expect(doc.length).toBe(SEQUENCE.length);
    expect(doc.topology).toBe('circular');
    expect(doc.name).toBe('Minimal Plasmid');
    expect(doc.createdAt).toBe('2026-10-26T12:00:00.000Z');
    expect(doc.updatedAt).toBe('2026-10-26T12:30:00.000Z');
    expect(doc.methylationProfile).toEqual({ dam: true, dcm: true, cpg: false });

    const wrapped = findFeature(doc, 'wrapped_binary');
    expect(wrapped.start).toBe(114);
    expect(wrapped.end).toBe(10);
    expect(wrapped.color).toBe('#00AABB');

    expect(doc.primers).toHaveLength(2);
    const primer = doc.primers.find((item) => item.name === 'P1');
    expect(primer).toBeDefined();
    expect(primer?.sequence).toBe(SEQUENCE.slice(10, 30));
    expect(primer?.bindingStart).toBe(10);
    expect(primer?.bindingEnd).toBe(30);
    expect(primer?.strand).toBe(1);
    expect(primer?.tailSequence).toBe('');
    expect(primer?.gcPercent).toBeGreaterThan(0);
    expect(primer?.tmAnnealing).toBeGreaterThan(0);
    expect(Number.isFinite(primer?.hairpinDeltaG)).toBe(true);
    expect(Number.isFinite(primer?.selfDimerDeltaG)).toBe(true);

    const reversePrimer = doc.primers.find((item) => item.name === 'P2');
    expect(reversePrimer?.strand).toBe(-1);
    expect(reversePrimer?.bindingStart).toBe(40);
    expect(reversePrimer?.bindingEnd).toBe(60);
    expect(reversePrimer?.sequence).toBe(reverseComplement(SEQUENCE.slice(40, 60)));

    expect(doc.history[0]?.operation).toBe('import');
    const product = doc.history.find((node) => node.description.includes('product.dna'));
    expect(product).toBeDefined();
    expect(product?.operation).toBe('restriction_ligation');
    expect(product?.enzymesUsed).toEqual(expect.arrayContaining(['EcoRI', 'BamHI']));
    expect(product?.parentSnapshots?.[0]?.name).toBe('parent.dna');
    expect(product?.parentSnapshots?.[0]?.length).toBe(100);
    expect(product?.parentSnapshots?.[0]?.extractedRange).toEqual([10, 20]);
  });

  it('enriches an already parsed document idempotently', async () => {
    const buffer = buildSnapGene(SEQUENCE, HISTORY_XML);
    const first = await parseSnapGeneBuffer(buffer, 'minimal.dna');
    const enriched = enrichSnapGeneBinary(buffer, first);
    expect(enriched.sequence).toBe(first.sequence);
    expect(enriched.features.map((feature) => feature.start)).toEqual(
      first.features.map((feature) => feature.start),
    );
    expect(enriched.primers).toHaveLength(2);
    expect(enriched.history.some((node) => node.operation === 'restriction_ligation')).toBe(true);
  });

  it('round-trips primers through GenBank', async () => {
    const snapGene = await parseSnapGeneBuffer(buildSnapGene(SEQUENCE, HISTORY_XML), 'primer_roundtrip.dna');
    const exported = exportPlasmidToGenBank(snapGene);
    expect(exported).toContain('primer_bind');
    expect(exported).toContain('/note="sequence: ');

    const parsed = await parseGenBankString(exported);
    expect(parsed.primers).toHaveLength(2);
    const forwardPrimer = parsed.primers.find((item) => item.name === 'P1');
    expect(forwardPrimer?.sequence).toBe(SEQUENCE.slice(10, 30));
    expect(forwardPrimer?.bindingStart).toBe(10);
    expect(forwardPrimer?.bindingEnd).toBe(30);
    const reversePrimer = parsed.primers.find((item) => item.name === 'P2');
    expect(reversePrimer?.strand).toBe(-1);
    expect(reversePrimer?.sequence).toBe(reverseComplement(SEQUENCE.slice(40, 60)));
  });

  it('decompresses zlib-compressed history packets', async () => {
    const doc = await parseSnapGeneBuffer(
      buildSnapGene(SEQUENCE, HISTORY_XML, true),
      'compressed_history.dna',
    );
    expect(doc.history.some((node) => node.operation === 'restriction_ligation')).toBe(true);
  });

  it('accepts binary files through parseBioFile', async () => {
    const [doc] = await parseBioFile('minimal.dna', buildSnapGene(SEQUENCE, HISTORY_XML));
    expect(doc.sequence).toBe(SEQUENCE);
    expect(doc.primers).toHaveLength(2);
  });
});

describe('SnapGene JSON export', () => {
  it('serializes a complete document that can be parsed again', async () => {
    const [first] = await parseBioFile('fasta_fixture.fasta', `>json_fixture\n${SEQUENCE}\n`);
    const json = exportPlasmidToSnapGeneJson(first);
    const parsed = JSON.parse(json) as PlasmidDocument;
    expect(parsed.sequence).toBe(SEQUENCE);
    expect(parsed.name).toBe(first.name);

    const [second] = await parseBioFile('fixture.json', json);
    expect(second.sequence).toBe(first.sequence);
    expect(second.length).toBe(first.length);
    expect(second.features.length).toBe(first.features.length);
    expect(second.history[0]?.operation).toBe('import');
  });
});
