import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  enrichSnapGeneBinary,
  exportPlasmidToFasta,
  exportPlasmidToGenBank,
  exportPlasmidToSnapGene,
  exportPlasmidToSnapGeneJson,
  exportProteinToFasta,
  exportProteinToGenPept,
  fetchFromNCBI,
  isProteinFile,
  normalizeAccession,
  parseBioFile,
  parseFastq,
  parseGenBankString,
  parseProteinFile,
  parseSnapGeneBuffer,
} from './index';
import type { PlasmidDocument, Primer } from '../../types/schema';
import type { ProteinDocument } from './index';

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

function fixtureContent(path: string): ArrayBuffer | string {
  const bytes = readFileSync(resolve(process.cwd(), path));
  if (path.endsWith('.gb') || path.endsWith('.gbk') || path.endsWith('.fasta')) {
    return bytes.toString('utf8');
  }
  return bytesToArrayBuffer(bytes);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
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

describe('multi-segment features', () => {
  it('exposes segment notes in biological order for joins', async () => {
    const doc = await parseGenBankString(buildGenBank(SEQUENCE));
    const split = findFeature(doc, 'split_feature');
    expect(split.notes?.segments).toEqual(['19-30', '49-60']);

    const wrapped = findFeature(doc, 'wrapped_feature');
    expect(wrapped.notes?.segments).toEqual(['0-10', '114-120']);
  });

  it('round-trips joins and complements through GenBank and .dna', async () => {
    const first = await parseGenBankString(buildGenBank(SEQUENCE));
    const genbank = await parseGenBankString(exportPlasmidToGenBank(first));
    expect(findFeature(genbank, 'split_feature').notes?.segments).toEqual(['19-30', '49-60']);
    expect(findFeature(genbank, 'wrapped_feature').notes?.segments).toEqual([
      '0-10',
      '114-120',
    ]);

    const dna = await parseSnapGeneBuffer(
      exportPlasmidToSnapGene(first).buffer as ArrayBuffer,
      'segments.dna',
    );
    expect(findFeature(dna, 'split_feature').notes?.segments).toEqual(['19-30', '49-60']);
    expect(findFeature(dna, 'wrapped_feature').notes?.segments).toEqual([
      '0-10',
      '114-120',
    ]);
    expect(findFeature(dna, 'wrapped_feature').start).toBe(114);
    expect(findFeature(dna, 'wrapped_feature').end).toBe(10);
  });

  it('still reads segment keys written before the rename to GATC', async () => {
    const first = await parseGenBankString(buildGenBank(SEQUENCE));
    const split = findFeature(first, 'split_feature');
    const { segments, ...rest } = split.notes ?? {};
    void segments;
    const legacy: PlasmidDocument = {
      ...first,
      features: first.features.map((f) => (f === split ? { ...f, notes: { ...rest, OpenSnapGene_segments: ['19-30,49-60'] } } : f)),
    };
    const text = exportPlasmidToGenBank(legacy);
    expect(text).not.toContain('OpenSnapGene');
    expect(findFeature(await parseGenBankString(text), 'split_feature').notes?.segments).toEqual(['19-30', '49-60']);
  });

  it('parses multi-Segment SnapGene features', async () => {
    const features = [
      '<Features nextValidID="1">',
      '<Feature name="binary_join" type="misc_feature" directionality="1">',
      '<Segment range="20-30" color="#224466" type="standard"/>',
      '<Segment range="50-60" color="#224466" type="standard"/>',
      '<Q name="note"><V text="two segments"/></Q>',
      '</Feature>',
      '</Features>',
    ].join('');
    const buffer = concat([
      cookiePacket(),
      dnaPacket(SEQUENCE, true),
      packet(0x0a, encode(features)),
    ]).buffer as ArrayBuffer;
    const doc = await parseSnapGeneBuffer(buffer, 'binary_segments.dna');
    const feature = findFeature(doc, 'binary_join');
    expect(feature.start).toBe(19);
    expect(feature.end).toBe(60);
    expect(feature.notes?.segments).toEqual(['19-30', '49-60']);

    const reimported = await parseSnapGeneBuffer(
      exportPlasmidToSnapGene(doc).buffer as ArrayBuffer,
      'binary_segments_roundtrip.dna',
    );
    expect(findFeature(reimported, 'binary_join').notes?.segments).toEqual([
      '19-30',
      '49-60',
    ]);
  });

  it('orders negative-strand segments by 5-prime to 3-prime', async () => {
    const genbank = buildGenBank(SEQUENCE).replace(
      'misc_feature    join(20..30,50..60)',
      'misc_feature    complement(join(20..30,50..60))',
    );
    const first = await parseGenBankString(genbank);
    const feature = findFeature(first, 'split_feature');
    expect(feature.start).toBe(19);
    expect(feature.end).toBe(60);
    expect(feature.strand).toBe(-1);
    expect(feature.notes?.segments).toEqual(['49-60', '19-30']);

    const exported = exportPlasmidToGenBank(first);
    expect(exported).toContain('complement(join(20..30,50..60))');
    const second = await parseGenBankString(exported);
    expect(findFeature(second, 'split_feature').notes?.segments).toEqual([
      '49-60',
      '19-30',
    ]);

    const ordered = await parseGenBankString(
      buildGenBank(SEQUENCE).replace(
        'join(20..30,50..60)',
        'order(20..30,50..60)',
      ),
    );
    expect(findFeature(ordered, 'split_feature').notes?.segments).toEqual([
      '19-30',
      '49-60',
    ]);

    const ascendingWrap = await parseGenBankString(
      buildGenBank(SEQUENCE).replace(
        'complement(join(115..120,1..10))',
        'complement(join(1..10,115..120))',
      ),
    );
    expect(findFeature(ascendingWrap, 'wrapped_feature').notes?.segments).toEqual([
      '114-120',
      '0-10',
    ]);
  });
});

describe('NCBI import', () => {
  const puc19 = readFileSync(resolve(process.cwd(), 'src/app/samples/pUC19.gb'), 'utf8');
  const proteinRecord = [
    'LOCUS       NP_TEST                 10 aa            linear   PRI 01-JAN-2020',
    'DEFINITION  Test RefSeq protein.',
    'FEATURES             Location/Qualifiers',
    '     Region          2..5',
    '                     /label="motif"',
    'ORIGIN',
    '        1 mktayia*kl',
    '//',
    '',
  ].join('\n');

  it('normalises accessions and NCBI URLs', () => {
    expect(normalizeAccession('L09137.2')).toEqual({
      accession: 'L09137.2',
      db: 'nuccore',
    });
    expect(normalizeAccession(' NM_000546 ')).toEqual({
      accession: 'NM_000546',
      db: 'nuccore',
    });
    expect(normalizeAccession('NP_000546.6')).toEqual({
      accession: 'NP_000546.6',
      db: 'protein',
    });
    expect(normalizeAccession('AAA12345')).toEqual({
      accession: 'AAA12345',
      db: 'protein',
    });
    expect(
      normalizeAccession('https://www.ncbi.nlm.nih.gov/nuccore/L09137.2'),
    ).toEqual({ accession: 'L09137.2', db: 'nuccore' });
    expect(
      normalizeAccession('https://www.ncbi.nlm.nih.gov/protein/NP_000546.6'),
    ).toEqual({ accession: 'NP_000546.6', db: 'protein' });
    expect(normalizeAccession('not an accession')).toBeNull();
  });

  it('fetches nucleotide records through EFetch', async () => {
    let requested = '';
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      requested = String(url);
      return new Response(puc19, { status: 200 });
    }) as unknown as typeof fetch;

    const document = (await fetchFromNCBI('L09137.2', { fetchImpl })) as PlasmidDocument;
    expect(document.sequence).toHaveLength(2686);
    expect(document.topology).toBe('circular');
    expect(requested).toContain('db=nuccore');
    expect(requested).toContain('id=L09137.2');
    expect(requested).toContain('rettype=gbwithparts');
    expect(requested).toContain('retmode=text');
  });

  it('fetches protein records through the protein database', async () => {
    let requested = '';
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      requested = String(url);
      return new Response(proteinRecord, { status: 200 });
    }) as unknown as typeof fetch;

    const protein = (await fetchFromNCBI('NP_000546.6', { fetchImpl })) as ProteinDocument;
    expect(protein.sequence).toBe('MKTAYIA*KL');
    expect(protein.features).toHaveLength(1);
    expect(protein.features[0].start).toBe(1);
    expect(protein.features[0].end).toBe(5);
    expect(requested).toContain('db=protein');
    expect(requested).toContain('rettype=gp');
  });

  it('reports missing accessions, network failures and oversized records', async () => {
    await expect(
      fetchFromNCBI('L09137.2', {
        fetchImpl: (async () => new Response('ERROR: cannot get document', { status: 400 })) as typeof fetch,
      }),
    ).rejects.toThrow(/not found/i);

    await expect(
      fetchFromNCBI('L09137.2', {
        fetchImpl: (async () => {
          throw new Error('offline');
        }) as typeof fetch,
      }),
    ).rejects.toThrow(/network error/i);

    await expect(fetchFromNCBI('not-an-accession')).rejects.toThrow(/Invalid NCBI accession/i);

    const huge = 'LOCUS       BIG_TEST           6000000 bp    DNA     linear   SYN 01-JAN-2020\n';
    await expect(
      fetchFromNCBI('L09137.2', {
        fetchImpl: (async () => new Response(huge, { status: 200 })) as typeof fetch,
      }),
    ).rejects.toThrow(/5 Mb limit/i);
  });
});

describe('protein files', () => {
  const genPept = [
    'LOCUS       TESTPROT                 10 aa            linear   PRI 01-JAN-2020',
    'DEFINITION  Test protein with two regions.',
    'FEATURES             Location/Qualifiers',
    '     Region          2..5',
    '                     /label="motif"',
    '                     /note="short motif"',
    '     Region          join(1..3,8..10)',
    '                     /label="split_region"',
    'ORIGIN',
    '        1 mktayia*kl',
    '//',
    '',
  ].join('\n');

  function proteinCookiePacket(): Uint8Array {
    const payload = new Uint8Array(14);
    payload.set(encode('SnapGene'), 0);
    const view = new DataView(payload.buffer);
    view.setUint16(8, 2, false);
    view.setUint16(10, 1, false);
    view.setUint16(12, 1, false);
    return packet(0x09, payload);
  }

  function proteinPacket(sequence: string): Uint8Array {
    const bytes = encode(sequence);
    const payload = new Uint8Array(1 + bytes.length);
    payload[0] = 0;
    payload.set(bytes, 1);
    return packet(0x15, payload);
  }

  it('parses GenPept coordinates and qualifiers', async () => {
    const [protein] = await parseProteinFile('test.gp', genPept);
    expect(protein.name).toBe('TESTPROT');
    expect(protein.description).toBe('Test protein with two regions.');
    expect(protein.sequence).toBe('MKTAYIA*KL');
    expect(protein.features).toHaveLength(2);
    const motif = protein.features.find((feature) => feature.name === 'motif');
    expect(motif?.start).toBe(1);
    expect(motif?.end).toBe(5);
    const split = protein.features.find((feature) => feature.name === 'split_region');
    expect(split?.start).toBe(0);
    expect(split?.end).toBe(10);
    expect(split?.notes?.segments).toEqual(['0-3', '7-10']);
    expect(motif?.notes?.note).toEqual(['short motif']);
  });

  it('round-trips GenPept and FASTA exports', async () => {
    const [protein] = await parseProteinFile('test.gp', genPept);
    const [fromGenPept] = await parseProteinFile(
      'roundtrip.gp',
      exportProteinToGenPept(protein),
    );
    expect(fromGenPept.sequence).toBe(protein.sequence);
    expect(fromGenPept.features.map((feature) => feature.name)).toEqual([
      'motif',
      'split_region',
    ]);
    const split = fromGenPept.features.find((feature) => feature.name === 'split_region');
    expect(split?.notes?.segments).toEqual(['0-3', '7-10']);

    const [fromFasta] = await parseProteinFile(
      'roundtrip.faa',
      exportProteinToFasta(protein),
    );
    expect(fromFasta.name).toBe(protein.name);
    expect(fromFasta.sequence).toBe(protein.sequence);
    expect(fromFasta.description).toBe(protein.description);
  });

  it('orders negative protein joins from 5-prime to 3-prime', async () => {
    const negative = genPept.replace(
      'join(1..3,8..10)',
      'complement(join(1..3,8..10))',
    );
    const [protein] = await parseProteinFile('negative.gp', negative);
    const split = protein.features.find((feature) => feature.name === 'split_region');
    expect(split?.notes?.segments).toEqual(['7-10', '0-3']);
    expect(split?.notes?.strand).toEqual(['-1']);

    const exported = exportProteinToGenPept(protein);
    expect(exported).toContain('complement(join(1..3,8..10))');
    const [roundtrip] = await parseProteinFile('negative-roundtrip.gp', exported);
    const restored = roundtrip.features.find((feature) => feature.name === 'split_region');
    expect(restored?.notes?.segments).toEqual(['7-10', '0-3']);
  });

  it('parses SnapGene .prot files and detects them', async () => {
    const sequence = 'MKTAYIAKQR';
    const notes = [
      '<Notes>',
      '<CustomMapLabel>Prot Fixture</CustomMapLabel>',
      '<Description>Binary protein fixture.</Description>',
      '</Notes>',
    ].join('');
    const features = [
      '<Features>',
      '<Feature name="prot_feature" type="Region" directionality="1">',
      '<Segment range="1-3" color="#112233"/>',
      '<Segment range="8-10" color="#112233"/>',
      '<Q name="note"><V text="split"/></Q>',
      '</Feature>',
      '</Features>',
    ].join('');
    const buffer = concat([
      proteinCookiePacket(),
      proteinPacket(sequence),
      packet(0x06, encode(notes)),
      packet(0x0a, encode(features)),
    ]).buffer as ArrayBuffer;

    expect(isProteinFile('fixture.prot', buffer)).toBe(true);
    const [protein] = await parseProteinFile('fixture.prot', buffer);
    expect(protein.name).toBe('Prot Fixture');
    expect(protein.description).toBe('Binary protein fixture.');
    expect(protein.sequence).toBe(sequence);
    expect(protein.features).toHaveLength(1);
    expect(protein.features[0].start).toBe(0);
    expect(protein.features[0].end).toBe(10);
    expect(protein.features[0].color).toBe('#112233');
    expect(protein.features[0].notes?.segments).toEqual(['0-3', '7-10']);
  });

  it('detects protein content by extension, locus and alphabet', () => {
    expect(isProteinFile('example.faa', '>p\nMKTAYIAKQR')).toBe(true);
    expect(isProteinFile('example.fasta', '>p\nMKTAYIAKQR')).toBe(true);
    expect(isProteinFile('example.fasta', '>d\nATGCATGCATGC')).toBe(false);
    expect(
      isProteinFile('example.gp', 'LOCUS       P1          10 aa            linear   PRI\n'),
    ).toBe(true);
    expect(
      isProteinFile('example.gb', buildGenBank(SEQUENCE)),
    ).toBe(false);
  });
});

describe('FASTQ import', () => {
  it('parses multiple Phred+33 records', () => {
    const reads = parseFastq(
      [
        '@read1 first read',
        'ACGT',
        '+',
        'IIII',
        '@read2',
        'NNNN',
        '+read2',
        '!!!!',
        '',
      ].join('\n'),
    );
    expect(reads).toHaveLength(2);
    expect(reads[0].name).toBe('read1 first read');
    expect(reads[0].sequence).toBe('ACGT');
    expect(reads[0].qualities).toEqual([40, 40, 40, 40]);
    expect(reads[1].qualities).toEqual([0, 0, 0, 0]);
  });

  it('rejects malformed FASTQ input', () => {
    expect(() => parseFastq('read1\nACGT\n+\nIIII\n')).toThrow(/header must start with @/);
    expect(() => parseFastq('@read1\nACGT\n+\nIII\n')).toThrow(/quality length/);
    expect(() => parseFastq('@read1\nACXT\n+\nIIII\n')).toThrow(/non-nucleotide/);
    expect(() => parseFastq('   \n')).toThrow(/no records/);
  });

  it('imports .fastq through parseBioFile and rejects .gz', async () => {
    const [document] = await parseBioFile('reads.fastq', '@read1\nACGT\n+\nIIII\n');
    expect(document.name).toBe('read1');
    expect(document.sequence).toBe('ACGT');
    expect(document.topology).toBe('linear');

    await expect(parseBioFile('reads.fastq.gz', 'anything')).rejects.toThrow(/not supported/i);
  });
});

describe('additional import formats', () => {
  it('parses ApE and Vector NTI GenBank variants', async () => {
    const [ape] = await parseBioFile('construct.ape', buildGenBank(SEQUENCE));
    expect(ape.sequence).toBe(SEQUENCE);
    expect(findFeature(ape, 'normal_feature').color).toBe('#112233');

    const vectorNti = buildGenBank(SEQUENCE).replace(
      'DEFINITION  Circular test construct.',
      'DEFINITION  Circular test construct.\nCOMMENT     Vector NTI(R) Advanced 11.5 export',
    );
    const [vnti] = await parseBioFile('vector.nti.gb', vectorNti);
    expect(vnti.sequence).toBe(SEQUENCE);
    expect(findFeature(vnti, 'split_feature').notes?.segments).toEqual(['19-30', '49-60']);
  });

  it('parses DNASTAR .seq files with a header', async () => {
    const sequence = 'ATGCGATCGGACTGACTAGCTACGTACG';
    const text = [
      'DNASTAR SeqBuilder',
      '"dnastar_fixture" (1,28)',
      ' Contig Length: 28 bases',
      'FEATURES Location/Qualifiers',
      ' contig 1..28',
      ' /Note="DNASTAR contig"',
      '^^',
      sequence,
      '',
    ].join('\n');
    const [document] = await parseBioFile('dnastar_fixture.seq', text);
    expect(document.name).toBe('dnastar_fixture');
    expect(document.sequence).toBe(sequence);
    expect(document.length).toBe(28);
  });

  it('parses Serial Cloner .xdna files', async () => {
    const sequence = SEQUENCE;
    const comment = 'xdna_fixture Serial Cloner test';
    const header = new Uint8Array(112);
    header[0] = 0;
    header[1] = 1;
    header[2] = 1;
    header[111] = 0xff;
    const view = new DataView(header.buffer);
    view.setUint32(28, sequence.length, false);
    view.setUint32(96, comment.length, false);

    const pascal = (value: string): Uint8Array => {
      const bytes = encode(value);
      const result = new Uint8Array(1 + bytes.length);
      result[0] = bytes.length;
      result.set(bytes, 1);
      return result;
    };

    const buffer = concat([
      header,
      encode(sequence),
      encode(comment),
      new Uint8Array([0]),
      pascal('0'),
      pascal('0'),
      new Uint8Array([1]),
      pascal('xdnaFeature'),
      pascal('free text\rgene="abc"'),
      pascal('CDS'),
      pascal('2'),
      pascal('6'),
      new Uint8Array([1, 1, 0, 1]),
      pascal('17,34,51'),
    ]).buffer as ArrayBuffer;

    const [document] = await parseBioFile('fixture.xdna', buffer);
    expect(document.name).toBe('xdna_fixture');
    expect(document.sequence).toBe(sequence);
    expect(document.topology).toBe('circular');
    expect(document.features).toHaveLength(1);
    expect(document.features[0].start).toBe(1);
    expect(document.features[0].end).toBe(6);
    expect(document.features[0].strand).toBe(1);
    expect(document.features[0].color).toBe('#112233');
    expect(document.features[0].notes?.gene).toEqual(['abc']);
    expect(document.features[0].notes?.note).toEqual(['free text']);

    const minimal = concat([header, encode(sequence), encode(comment)]).buffer as ArrayBuffer;
    const [minimalDocument] = await parseBioFile('minimal.xdna', minimal);
    expect(minimalDocument.sequence).toBe(sequence);
    expect(minimalDocument.features).toEqual([]);

    const linearHeader = header.slice();
    linearHeader[2] = 0;
    const linear = concat([
      linearHeader,
      encode(sequence),
      encode(comment),
      new Uint8Array([0]),
      pascal('2'),
      encode('AA'),
      pascal('0'),
      new Uint8Array([0]),
    ]).buffer as ArrayBuffer;
    const [linearDocument] = await parseBioFile('linear.xdna', linear);
    expect(linearDocument.topology).toBe('linear');
    expect(linearDocument.linearEnds?.right).toEqual({
      type: '5-prime',
      sequence: 'AA',
      phosphorylated: false,
    });
    expect(linearDocument.linearEnds?.left).toEqual({
      type: 'blunt',
      sequence: '',
      phosphorylated: false,
    });
  });

  it('rejects Clone Manager .cm5 with a clear message', async () => {
    await expect(
      parseBioFile('molecule.cm5', new Uint8Array([1, 2, 3, 4]).buffer),
    ).rejects.toThrow(/Clone Manager/);
  });

  it('parses Benchling, Geneious and plain GenBank exports', async () => {
    for (const fileName of ['benchling.gb', 'geneious.gb', 'export.gbff']) {
      const [document] = await parseBioFile(fileName, buildGenBank(SEQUENCE));
      expect(document.sequence).toBe(SEQUENCE);
      expect(document.features.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('parses SBOL XML', async () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      '<sbol:DnaComponent xmlns:sbol="http://sbols.org/v1#">',
      '<sbol:displayId>SBOL1</sbol:displayId>',
      '<sbol:name>sbol_fixture</sbol:name>',
      '<sbol:dnaSequence><sbol:DnaSequence>',
      '<sbol:nucleotides>ATGCATGCATGC</sbol:nucleotides>',
      '</sbol:DnaSequence></sbol:dnaSequence>',
      '<sbol:annotation><sbol:SequenceAnnotation>',
      '<sbol:bioStart>2</sbol:bioStart>',
      '<sbol:bioEnd>6</sbol:bioEnd>',
      '<sbol:strand>+</sbol:strand>',
      '</sbol:SequenceAnnotation></sbol:annotation>',
      '</sbol:DnaComponent>',
      '</rdf:RDF>',
    ].join('\n');
    const [document] = await parseBioFile('fixture.sbol', xml);
    expect(document.name).toBe('sbol_fixture');
    expect(document.sequence).toBe('ATGCATGCATGC');
    expect(document.features).toHaveLength(1);
    expect(document.features[0].start).toBe(1);
    expect(document.features[0].end).toBe(6);
  });

  it('parses plain text sequences', async () => {
    const [document] = await parseBioFile(
      'plain_sequence.txt',
      'a short description\nATGCATGCATGCATGC\n',
    );
    expect(document.name).toBe('plain_sequence');
    expect(document.sequence).toBe('ATGCATGCATGCATGC');
    expect(document.topology).toBe('linear');
    expect(document.features).toEqual([]);
  });
});

describe('SnapGene binary export', () => {
  const fixtures = [
    'test-data/addgene-plasmid-50004-sequence-74675.dna',
    'test-data/addgene-plasmid.dna',
    'test-data/GFPuv_025_fwdfeature_revfeature_circular.dna',
    'test-data/pIB2-SEC13-mEGFP.dna',
    'src/app/samples/pEGFP-N1.gb',
    'src/app/samples/pUC19.gb',
  ];

  it.each(fixtures)('round-trips %s through .dna', async (path) => {
    const [first] = await parseBioFile(path, fixtureContent(path));
    const exported = exportPlasmidToSnapGene(first);
    const [second] = await parseBioFile('roundtrip.dna', bytesToArrayBuffer(exported));

    expect(second.name).toBe(first.name);
    expect(second.sequence).toBe(first.sequence);
    expect(second.length).toBe(first.length);
    expect(second.topology).toBe(first.topology);
    expect(second.features).toHaveLength(first.features.length);
    expect(
      second.features.map((feature) => ({
        name: feature.name,
        type: feature.type,
        start: feature.start,
        end: feature.end,
        strand: feature.strand,
        color: feature.color,
      })),
    ).toEqual(
      first.features.map((feature) => ({
        name: feature.name,
        type: feature.type,
        start: feature.start,
        end: feature.end,
        strand: feature.strand,
        color: feature.color,
      })),
    );
    expect(second.primers.map((primer) => ({ name: primer.name, sequence: primer.sequence }))).toEqual(
      first.primers.map((primer) => ({ name: primer.name, sequence: primer.sequence })),
    );
  });

  it('preserves features that cross the origin', async () => {
    const first = await parseGenBankString(buildGenBank(SEQUENCE));
    const wrapped = findFeature(first, 'wrapped_feature');
    expect(wrapped.start).toBe(114);
    expect(wrapped.end).toBe(10);
    expect(wrapped.strand).toBe(-1);

    const exported = exportPlasmidToSnapGene(first);
    const [second] = await parseBioFile('wrapped.dna', bytesToArrayBuffer(exported));

    const restored = findFeature(second, 'wrapped_feature');
    expect(restored.start).toBe(114);
    expect(restored.end).toBe(10);
    expect(restored.strand).toBe(-1);
    expect(restored.color).toBe('#FF00FF');
    expect(restored.type).toBe('CDS');
    expect(second.features).toHaveLength(first.features.length);
  });

  it('preserves primers that cross the origin', async () => {
    const [base] = await parseBioFile('wrap_primer.fasta', `>wrap_primer\n${SEQUENCE}\n`);
    const primer: Primer = {
      id: 'primer_wrap',
      name: 'wrap_primer',
      sequence: SEQUENCE.slice(110) + SEQUENCE.slice(0, 10),
      bindingStart: 110,
      bindingEnd: 10,
      strand: 1,
      tailSequence: '',
      tmAnnealing: 60,
      tmTotal: 60,
      gcPercent: 50,
      has3PrimeGCClamp: false,
      hairpinDeltaG: 0,
      selfDimerDeltaG: 0,
    };
    const doc: PlasmidDocument = {
      ...base,
      topology: 'circular',
      primers: [primer],
    };
    const exported = exportPlasmidToSnapGene(doc);
    const [second] = await parseBioFile('wrap_primer.dna', bytesToArrayBuffer(exported));

    expect(second.primers).toHaveLength(1);
    expect(second.primers[0].name).toBe('wrap_primer');
    expect(second.primers[0].sequence).toBe(primer.sequence);
    expect(second.primers[0].bindingStart).toBe(110);
    expect(second.primers[0].bindingEnd).toBe(10);
    expect(second.primers[0].strand).toBe(1);
  });

  it('writes linear overhang metadata', async () => {
    const [base] = await parseBioFile(fixtures[4], fixtureContent(fixtures[4]));
    const linear: PlasmidDocument = {
      ...base,
      topology: 'linear',
      linearEnds: {
        left: { type: '5-prime', sequence: 'AATT', phosphorylated: true },
        right: { type: 'blunt', sequence: '', phosphorylated: false },
      },
    };
    const exported = exportPlasmidToSnapGene(linear);
    const [second] = await parseBioFile('linear_ends.dna', bytesToArrayBuffer(exported));

    expect(second.topology).toBe('linear');
    expect(second.linearEnds?.left.type).toBe('5-prime');
    expect(second.linearEnds?.left.phosphorylated).toBe(true);
    expect(second.linearEnds?.right.type).toBe('blunt');
    expect(second.linearEnds?.right.phosphorylated).toBe(false);
  });

  it('writes disabled Dam and Dcm methylation', async () => {
    const [base] = await parseBioFile(fixtures[4], fixtureContent(fixtures[4]));
    const unmethylated: PlasmidDocument = {
      ...base,
      methylationProfile: { dam: false, dcm: false, cpg: false },
    };
    const exported = exportPlasmidToSnapGene(unmethylated);
    const [second] = await parseBioFile('unmethylated.dna', bytesToArrayBuffer(exported));

    expect(second.methylationProfile).toEqual({ dam: false, dcm: false, cpg: false });
  });

  it('writes a self-consistent packet stream beginning with the cookie', async () => {
    const [doc] = await parseBioFile(fixtures[0], fixtureContent(fixtures[0]));
    const bytes = exportPlasmidToSnapGene(doc);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes[0]).toBe(0x09);
    expect(view.getUint32(1, false)).toBe(14);
    expect(new TextDecoder().decode(bytes.subarray(5, 13))).toBe('SnapGene');
    expect(view.getUint16(13, false)).toBe(1);

    const types: number[] = [];
    let offset = 0;
    while (offset < bytes.length) {
      expect(offset + 5).toBeLessThanOrEqual(bytes.length);
      const size = view.getUint32(offset + 1, false);
      expect(offset + 5 + size).toBeLessThanOrEqual(bytes.length);
      types.push(bytes[offset]);
      offset += 5 + size;
    }
    expect(offset).toBe(bytes.length);
    expect(types[0]).toBe(0x09);
    expect(types).toContain(0x00);
    expect(types).toContain(0x06);
    expect(types).toContain(0x0a);
    expect(types).toContain(0x05);

    const dnaPacketOffset = 19;
    const dnaSize = view.getUint32(dnaPacketOffset + 1, false);
    expect(dnaSize).toBe(doc.length + 1);
    expect(bytes[dnaPacketOffset + 5] & 0x01).toBe(1);
  });
});
