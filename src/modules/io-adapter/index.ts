/*
 * Xdna parsing follows the publicly documented binary layout used by
 * Biopython's Bio.SeqIO.XdnaIO (Biopython License Agreement / BSD-3-Clause)
 * and the format notes published by incenp.org.
 */
import {
  anyToJson,
  fastaToJson,
  genbankToJson,
  geneiousXmlToJson,
  jsonToFasta,
  jsonToGenbank,
  sbolXmlToJson,
  snapgeneToJson,
} from '@teselagen/bio-parsers';
import type {
  CloningHistoryNode,
  CloningOperationType,
  FeatureType,
  OverhangEnd,
  PlasmidDocument,
  Primer,
  SequenceFeature,
  StrandDirection,
} from '../../types/schema';

/* -------------------------------------------------------------------------- */
/* TeselaGen parser surface                                                    */
/* -------------------------------------------------------------------------- */

interface TeselaGenLocation {
  start: number;
  end: number;
}

interface TeselaGenFeature {
  id?: string;
  name?: string;
  type?: string;
  start?: number;
  end?: number;
  strand?: number;
  color?: string;
  notes?: Record<string, unknown>;
  locations?: TeselaGenLocation[];
  bases?: string;
  arrowheadType?: string;
  [key: string]: unknown;
}

interface TeselaGenSequence {
  sequence?: string;
  name?: string;
  description?: string;
  circular?: boolean | number | string;
  size?: number;
  features?: TeselaGenFeature[];
  primers?: TeselaGenFeature[];
  parts?: TeselaGenFeature[];
  date?: string;
  [key: string]: unknown;
}

interface TeselaGenParseResult {
  success?: boolean;
  messages?: string[];
  parsedSequence?: TeselaGenSequence;
  [key: string]: unknown;
}

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

interface SnapGenePacket {
  type: number;
  data: Uint8Array;
  offset: number;
}

interface SnapGeneNotes {
  name?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  methylationProfile?: PlasmidDocument['methylationProfile'];
}

interface SnapGeneLinearEnds {
  left: OverhangEnd;
  right: OverhangEnd;
}

interface SnapGenePrimerBinding {
  start: number;
  end: number;
  strand: 1 | -1;
  annealedBases?: string;
}

/**
 * Protein annotation. Coordinates are amino-acid positions in a 0-based,
 * half-open interval, matching the global document convention.
 */
export interface ProteinFeature {
  id: string;
  name: string;
  type: string;
  start: number;
  end: number;
  color: string;
  notes?: Record<string, string[]>;
}

/** Protein document contract shared across modules without a schema entry. */
export interface ProteinDocument {
  id: string;
  name: string;
  sequence: string;
  description?: string;
  features: ProteinFeature[];
  createdAt: string;
  updatedAt: string;
}

/** A single sequencing read with Phred qualities (ASCII offset 33). */
export interface SequencingRead {
  id: string;
  name: string;
  sequence: string;
  qualities: number[];
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_FEATURE_COLORS: Record<FeatureType, string> = {
  CDS: '#EF4444',
  promoter: '#10B981',
  terminator: '#F59E0B',
  rep_origin: '#8B5CF6',
  primer_bind: '#3B82F6',
  misc_feature: '#6B7280',
  regulatory: '#0EA5E9',
  enhancer: '#EC4899',
  intron: '#A855F7',
  protein_bind: '#14B8A6',
  oriT: '#F97316',
  attachment_site: '#EAB308',
};

const FEATURE_TYPES: readonly FeatureType[] = [
  'CDS',
  'promoter',
  'terminator',
  'rep_origin',
  'primer_bind',
  'misc_feature',
  'regulatory',
  'enhancer',
  'intron',
  'protein_bind',
  'oriT',
  'attachment_site',
];

const SEGMENTS_NOTE = 'GATC_segments';
const SEGMENTS_PUBLIC_NOTE = 'segments';
const ORIGINAL_TYPE_NOTE = 'GATC_original_type';
// Keys written before the project was renamed; still recognised when reading.
const LEGACY_SEGMENTS_NOTE = 'OpenSnapGene_segments';
const LEGACY_ORIGINAL_TYPE_NOTE = 'OpenSnapGene_original_type';
const isInternalNoteKey = (key: string) =>
  key === SEGMENTS_NOTE || key === LEGACY_SEGMENTS_NOTE || key === ORIGINAL_TYPE_NOTE || key === LEGACY_ORIGINAL_TYPE_NOTE;

const OPERATION_MAP: Record<string, CloningOperationType> = {
  import: 'import',
  invalid: 'import',
  open: 'import',
  newfilefromselection: 'import',
  newfile: 'import',
  insertfragments: 'restriction_ligation',
  insertfragment: 'restriction_ligation',
  ligate: 'restriction_ligation',
  ligation: 'restriction_ligation',
  restrictiondigest: 'restriction_ligation',
  restrictionligation: 'restriction_ligation',
  digest: 'restriction_ligation',
  digestligate: 'restriction_ligation',
  restrictioncloning: 'restriction_ligation',
  gibson: 'gibson_assembly',
  gibsonassembly: 'gibson_assembly',
  goldengate: 'golden_gate',
  goldengateassembly: 'golden_gate',
  gatewaybp: 'gateway_bp',
  gatewaylr: 'gateway_lr',
  amplify: 'pcr',
  amplifyfragment: 'pcr',
  pcr: 'pcr',
  pcramplification: 'pcr',
  soepcr: 'soe_pcr',
  overlapextensionpcr: 'soe_pcr',
  overlapextension: 'soe_pcr',
  primerdirectedmutagenesis: 'site_directed_mutagenesis',
  sitedirectedmutagenesis: 'site_directed_mutagenesis',
  mutagenesis: 'site_directed_mutagenesis',
  quikchange: 'site_directed_mutagenesis',
  blunt: 'blunting',
  blunting: 'blunting',
  flip: 'manual_edit',
  changemethylation: 'manual_edit',
  edit: 'manual_edit',
  manualedit: 'manual_edit',
};

/* -------------------------------------------------------------------------- */
/* Small utilities                                                             */
/* -------------------------------------------------------------------------- */

let idCounter = 0;

function generateId(prefix: string): string {
  const time = Date.now().toString(36);
  const counter = (idCounter++).toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${time}_${counter}_${random}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mod(value: number, length: number): number {
  if (length <= 0) return 0;
  return ((value % length) + length) % length;
}

function decodeAscii(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }
  return result;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
}

function toUint8Array(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') {
    const bytes = new Uint8Array(content.length);
    for (let index = 0; index < content.length; index += 1) {
      bytes[index] = content.charCodeAt(index) & 0xff;
    }
    return bytes;
  }
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

function toArrayBuffer(content: ArrayBuffer | Uint8Array | string): ArrayBuffer {
  const bytes = toUint8Array(content);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_match, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function setExtensionlessName(fileName: string | undefined): string {
  if (!fileName) return '';
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return base.replace(/\.[^/.]+$/, '');
}

function normalizeSequence(value: unknown): string {
  if (typeof value !== 'string') {
    if (Array.isArray(value)) return value.join('').toUpperCase();
    return '';
  }
  return value.replace(/^\uFEFF/, '').toUpperCase().replace(/[^A-Z]/g, '');
}

function normalizeProteinSequence(value: string): string {
  return value.replace(/^\uFEFF/, '').toUpperCase().replace(/[^A-Z*]/g, '');
}

const DNA_COMPLEMENT: Record<string, string> = {
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
  N: 'N',
};

function complementBase(base: string): string {
  return DNA_COMPLEMENT[base] ?? 'N';
}

function reverseComplement(sequence: string): string {
  let result = '';
  for (let index = sequence.length - 1; index >= 0; index -= 1) {
    result += complementBase(sequence[index]);
  }
  return result;
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const long = /^#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/.exec(trimmed);
  if (long) return `#${long[1]}`;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(trimmed);
  if (rgb) {
    const parts = rgb.slice(1, 4).map((part) => clamp(Number(part), 0, 255));
    return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }
  return fallback;
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  const snapGene = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
    trimmed,
  );
  if (snapGene) {
    const year = Number(snapGene[1]);
    const month = Number(snapGene[2]);
    const day = Number(snapGene[3]);
    const hour = Number(snapGene[4] ?? 0);
    const minute = Number(snapGene[5] ?? 0);
    const second = Number(snapGene[6] ?? 0);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return undefined;
}

function mapFeatureType(rawType: unknown): { type: FeatureType; original?: string } {
  if (typeof rawType !== 'string' || !rawType.trim()) {
    return { type: 'misc_feature' };
  }
  const original = rawType.trim();
  const normalized = original.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const exact = FEATURE_TYPES.find((type) => type.toLowerCase() === normalized);
  if (exact) return { type: exact };

  if (normalized === 'cds' || normalized === 'coding_sequence') return { type: 'CDS', original };
  if (normalized.includes('promoter')) return { type: 'promoter', original };
  if (normalized.includes('terminator')) return { type: 'terminator', original };
  if (
    normalized === 'rep_origin' ||
    normalized === 'origin' ||
    normalized === 'ori' ||
    normalized.includes('replication_origin')
  ) {
    return { type: 'rep_origin', original };
  }
  if (normalized === 'primer' || normalized.includes('primer_bind')) {
    return { type: 'primer_bind', original };
  }
  if (normalized === 'regulatory' || normalized === 'regulatory_region') {
    return { type: 'regulatory', original };
  }
  if (normalized === 'enhancer') return { type: 'enhancer', original };
  if (normalized === 'intron') return { type: 'intron', original };
  if (normalized === 'protein_bind' || normalized.includes('protein_binding')) {
    return { type: 'protein_bind', original };
  }
  if (normalized === 'orit') return { type: 'oriT', original };
  if (
    normalized === 'attachment_site' ||
    normalized === 'attb' ||
    normalized === 'attp' ||
    normalized === 'attl' ||
    normalized === 'attr' ||
    normalized === 'loxp'
  ) {
    return { type: 'attachment_site', original };
  }
  return { type: 'misc_feature', original };
}

function mapOperation(rawOperation: unknown, hasInputs: boolean): CloningOperationType {
  if (typeof rawOperation === 'string') {
    const key = rawOperation.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (OPERATION_MAP[key]) return OPERATION_MAP[key];
  }
  return hasInputs ? 'manual_edit' : 'import';
}

function noteArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : String(item)));
  }
  if (value === undefined || value === null) return [];
  return [typeof value === 'string' ? value : String(value)];
}

/* -------------------------------------------------------------------------- */
/* Minimal XML parser (SnapGene packets are small, attribute-oriented XML)     */
/* -------------------------------------------------------------------------- */

function parseXml(xml: string): XmlNode {
  let position = 0;
  const length = xml.length;

  function skipMisc(): void {
    while (position < length) {
      while (position < length && /\s/.test(xml[position])) position += 1;
      if (xml.startsWith('<?', position)) {
        const end = xml.indexOf('?>', position + 2);
        position = end === -1 ? length : end + 2;
      } else if (xml.startsWith('<!--', position)) {
        const end = xml.indexOf('-->', position + 4);
        position = end === -1 ? length : end + 3;
      } else if (xml.startsWith('<![CDATA[', position)) {
        const end = xml.indexOf(']]>', position + 9);
        position = end === -1 ? length : end + 3;
      } else if (xml.startsWith('<!DOCTYPE', position)) {
        const end = xml.indexOf('>', position + 9);
        position = end === -1 ? length : end + 1;
      } else {
        break;
      }
    }
  }

  function parseAttributes(): Record<string, string> {
    const attrs: Record<string, string> = {};
    while (position < length) {
      while (position < length && /\s/.test(xml[position])) position += 1;
      if (position >= length) break;
      if (xml[position] === '>' || xml.startsWith('/>', position)) break;
      const nameStart = position;
      while (position < length && !/[\s=/>]/.test(xml[position])) position += 1;
      const name = xml.slice(nameStart, position);
      while (position < length && /\s/.test(xml[position])) position += 1;
      if (xml[position] !== '=') {
        if (name) attrs[name] = '';
        continue;
      }
      position += 1;
      while (position < length && /\s/.test(xml[position])) position += 1;
      const quote = xml[position];
      let value = '';
      if (quote === '"' || quote === "'") {
        position += 1;
        const valueStart = position;
        while (position < length && xml[position] !== quote) position += 1;
        value = xml.slice(valueStart, position);
        if (xml[position] === quote) position += 1;
      } else {
        const valueStart = position;
        while (position < length && !/[\s/>]/.test(xml[position])) position += 1;
        value = xml.slice(valueStart, position);
      }
      if (name) attrs[name] = decodeEntities(value);
    }
    return attrs;
  }

  function parseElement(): XmlNode {
    while (position < length && /\s/.test(xml[position])) position += 1;
    if (xml[position] !== '<') {
      throw new Error('Invalid XML: expected an element');
    }
    position += 1;
    const nameStart = position;
    while (position < length && !/[\s/>]/.test(xml[position])) position += 1;
    const tag = xml.slice(nameStart, position);
    const attrs = parseAttributes();
    const node: XmlNode = { tag, attrs, children: [], text: '' };

    while (position < length && /\s/.test(xml[position])) position += 1;
    if (xml.startsWith('/>', position)) {
      position += 2;
      return node;
    }
    if (xml[position] !== '>') {
      throw new Error(`Invalid XML: expected > after <${tag}>`);
    }
    position += 1;

    while (position < length) {
      if (xml.startsWith('</', position)) {
        const end = xml.indexOf('>', position + 2);
        if (end === -1) throw new Error('Invalid XML: unterminated closing tag');
        position = end + 1;
        return node;
      }
      if (xml.startsWith('<!--', position)) {
        const end = xml.indexOf('-->', position + 4);
        position = end === -1 ? length : end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', position)) {
        const end = xml.indexOf(']]>', position + 9);
        const content = xml.slice(position + 9, end === -1 ? length : end);
        node.text += content;
        position = end === -1 ? length : end + 3;
        continue;
      }
      if (xml.startsWith('<?', position)) {
        const end = xml.indexOf('?>', position + 2);
        position = end === -1 ? length : end + 2;
        continue;
      }
      if (xml[position] === '<') {
        node.children.push(parseElement());
      } else {
        const next = xml.indexOf('<', position);
        const text = xml.slice(position, next === -1 ? length : next);
        node.text += decodeEntities(text);
        position = next === -1 ? length : next;
      }
    }
    return node;
  }

  skipMisc();
  if (position >= length || xml[position] !== '<') {
    throw new Error('Invalid XML: no root element');
  }
  return parseElement();
}

function xmlChildren(node: XmlNode | undefined, tag: string): XmlNode[] {
  if (!node) return [];
  return node.children.filter((child) => child.tag === tag);
}

function xmlDescendants(node: XmlNode | undefined, tag: string): XmlNode[] {
  if (!node) return [];
  const result: XmlNode[] = [];
  const stack = [...node.children];
  while (stack.length) {
    const current = stack.pop() as XmlNode;
    if (current.tag === tag) result.push(current);
    stack.push(...current.children);
  }
  return result;
}

function xmlChildText(node: XmlNode | undefined, tag: string): string | undefined {
  const child = xmlChildren(node, tag)[0];
  if (!child) return undefined;
  const text = child.text.trim();
  return text || undefined;
}

function xmlChildTextLocal(node: XmlNode | undefined, name: string): string | undefined {
  const child = xmlChildrenLocal(node, name)[0];
  if (!child) return undefined;
  const text = child.text.trim();
  return text || undefined;
}

function xmlFirstText(node: XmlNode | undefined, tag: string): string | undefined {
  const child = xmlDescendants(node, tag)[0];
  if (!child) return undefined;
  const text = child.text.trim();
  return text || undefined;
}

function xmlFirstTextLocal(node: XmlNode | undefined, name: string): string | undefined {
  const child = xmlDescendantsLocal(node, name)[0];
  if (!child) return undefined;
  const text = child.text.trim();
  return text || undefined;
}

function xmlValue(node: XmlNode): string[] {
  if (node.children.length === 0) {
    const text = node.text.trim();
    return text ? [decodeEntities(text)] : [];
  }
  const values: string[] = [];
  for (const child of node.children) {
    if (child.tag !== 'V') continue;
    const value =
      child.attrs.text ??
      child.attrs.int ??
      child.attrs.predef ??
      child.attrs.bool ??
      child.text.trim();
    if (value !== undefined && value !== '') values.push(decodeEntities(String(value)));
  }
  if (values.length === 0) {
    const text = node.text.trim();
    if (text) values.push(decodeEntities(text));
  }
  return values;
}

function xmlLocalName(tag: string): string {
  const separator = tag.lastIndexOf(':');
  return separator >= 0 ? tag.slice(separator + 1) : tag;
}

function xmlChildrenLocal(node: XmlNode | undefined, name: string): XmlNode[] {
  if (!node) return [];
  return node.children.filter((child) => xmlLocalName(child.tag) === name);
}

function xmlDescendantsLocal(node: XmlNode | undefined, name: string): XmlNode[] {
  if (!node) return [];
  const result: XmlNode[] = [];
  const stack = [...node.children];
  while (stack.length) {
    const current = stack.pop() as XmlNode;
    if (xmlLocalName(current.tag) === name) result.push(current);
    stack.push(...current.children);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Inflate (RFC 1950/1951)                                                     */
/* -------------------------------------------------------------------------- */

class BitReader {
  readonly data: Uint8Array;
  position: number;
  bitBuffer = 0;
  bitCount = 0;

  constructor(data: Uint8Array, start = 0) {
    this.data = data;
    this.position = start;
  }

  readBit(): number {
    if (this.bitCount === 0) {
      if (this.position >= this.data.length) throw new Error('Unexpected end of deflate stream');
      this.bitBuffer = this.data[this.position];
      this.position += 1;
      this.bitCount = 8;
    }
    const bit = this.bitBuffer & 1;
    this.bitBuffer >>= 1;
    this.bitCount -= 1;
    return bit;
  }

  readBits(count: number): number {
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      value |= this.readBit() << index;
    }
    return value;
  }

  alignToByte(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }
}

interface HuffmanTable {
  codes: Map<number, number>[];
  maxBits: number;
}

function buildHuffman(lengths: number[]): HuffmanTable {
  const maxBits = Math.max(...lengths, 0);
  const counts = new Array<number>(maxBits + 1).fill(0);
  for (const length of lengths) {
    if (length > 0) counts[length] += 1;
  }
  const nextCode = new Array<number>(maxBits + 1).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    code = (code + counts[bits - 1]) << 1;
    nextCode[bits] = code;
  }
  const codes: Map<number, number>[] = Array.from({ length: maxBits + 1 }, () => new Map());
  lengths.forEach((length, symbol) => {
    if (length > 0) {
      codes[length].set(nextCode[length], symbol);
      nextCode[length] += 1;
    }
  });
  return { codes, maxBits };
}

function decodeSymbol(reader: BitReader, table: HuffmanTable): number {
  let code = 0;
  for (let bits = 1; bits <= table.maxBits; bits += 1) {
    code = (code << 1) | reader.readBit();
    const symbol = table.codes[bits].get(code);
    if (symbol !== undefined) return symbol;
  }
  throw new Error('Invalid Huffman code');
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
  2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
  13,
];

let fixedLiteralTable: HuffmanTable | undefined;
let fixedDistanceTable: HuffmanTable | undefined;

function getFixedTables(): { literal: HuffmanTable; distance: HuffmanTable } {
  if (!fixedLiteralTable || !fixedDistanceTable) {
    const literalLengths: number[] = [];
    for (let symbol = 0; symbol < 288; symbol += 1) {
      if (symbol < 144) literalLengths.push(8);
      else if (symbol < 256) literalLengths.push(9);
      else if (symbol < 280) literalLengths.push(7);
      else literalLengths.push(8);
    }
    fixedLiteralTable = buildHuffman(literalLengths);
    fixedDistanceTable = buildHuffman(new Array<number>(32).fill(5));
  }
  return { literal: fixedLiteralTable, distance: fixedDistanceTable };
}

function inflateRaw(data: Uint8Array): Uint8Array {
  const reader = new BitReader(data);
  const output: number[] = [];
  let final = false;

  while (!final) {
    final = reader.readBit() === 1;
    const blockType = reader.readBits(2);
    if (blockType === 0) {
      reader.alignToByte();
      if (reader.position + 4 > data.length) throw new Error('Truncated stored deflate block');
      const length = data[reader.position] | (data[reader.position + 1] << 8);
      const inverse = data[reader.position + 2] | (data[reader.position + 3] << 8);
      reader.position += 4;
      if ((length ^ 0xffff) !== inverse) throw new Error('Invalid stored deflate block length');
      if (reader.position + length > data.length) throw new Error('Truncated stored deflate data');
      for (let index = 0; index < length; index += 1) {
        output.push(data[reader.position + index]);
      }
      reader.position += length;
    } else if (blockType === 1 || blockType === 2) {
      let literalTable: HuffmanTable;
      let distanceTable: HuffmanTable;
      if (blockType === 1) {
        const tables = getFixedTables();
        literalTable = tables.literal;
        distanceTable = tables.distance;
      } else {
        const literalCount = reader.readBits(5) + 257;
        const distanceCount = reader.readBits(5) + 1;
        const codeLengthCount = reader.readBits(4) + 4;
        const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        const codeLengths = new Array<number>(19).fill(0);
        for (let index = 0; index < codeLengthCount; index += 1) {
          codeLengths[order[index]] = reader.readBits(3);
        }
        const codeLengthTable = buildHuffman(codeLengths);
        const lengths: number[] = [];
        while (lengths.length < literalCount + distanceCount) {
          const symbol = decodeSymbol(reader, codeLengthTable);
          if (symbol <= 15) {
            lengths.push(symbol);
          } else if (symbol === 16) {
            if (lengths.length === 0) throw new Error('Invalid code length repeat');
            const previous = lengths[lengths.length - 1];
            const repeat = reader.readBits(2) + 3;
            for (let index = 0; index < repeat; index += 1) lengths.push(previous);
          } else if (symbol === 17) {
            const repeat = reader.readBits(3) + 3;
            for (let index = 0; index < repeat; index += 1) lengths.push(0);
          } else if (symbol === 18) {
            const repeat = reader.readBits(7) + 11;
            for (let index = 0; index < repeat; index += 1) lengths.push(0);
          } else {
            throw new Error('Invalid code length symbol');
          }
        }
        if (lengths.length !== literalCount + distanceCount) {
          throw new Error('Invalid deflate code lengths');
        }
        literalTable = buildHuffman(lengths.slice(0, literalCount));
        distanceTable = buildHuffman(lengths.slice(literalCount));
      }

      while (true) {
        const symbol = decodeSymbol(reader, literalTable);
        if (symbol < 256) {
          output.push(symbol);
        } else if (symbol === 256) {
          break;
        } else {
          const lengthIndex = symbol - 257;
          if (lengthIndex < 0 || lengthIndex >= LENGTH_BASE.length) {
            throw new Error('Invalid deflate length symbol');
          }
          const length = LENGTH_BASE[lengthIndex] + reader.readBits(LENGTH_EXTRA[lengthIndex]);
          const distanceSymbol = decodeSymbol(reader, distanceTable);
          if (distanceSymbol >= DISTANCE_BASE.length) {
            throw new Error('Invalid deflate distance symbol');
          }
          const distance =
            DISTANCE_BASE[distanceSymbol] + reader.readBits(DISTANCE_EXTRA[distanceSymbol]);
          if (distance > output.length) throw new Error('Invalid deflate back-reference');
          const start = output.length - distance;
          for (let index = 0; index < length; index += 1) {
            output.push(output[start + index]);
          }
        }
      }
    } else {
      throw new Error('Invalid deflate block type');
    }
  }

  return Uint8Array.from(output);
}

function decompressZlib(data: Uint8Array): Uint8Array {
  if (data.length < 2) throw new Error('Truncated zlib stream');
  const cmf = data[0];
  const flg = data[1];
  const compressionMethod = cmf & 0x0f;
  const hasDictionary = (flg & 0x20) !== 0;
  if (compressionMethod !== 8 || ((cmf << 8) | flg) % 31 !== 0) {
    throw new Error('Invalid zlib header');
  }
  const start = 2 + (hasDictionary ? 4 : 0);
  return inflateRaw(data.subarray(start));
}

function maybeDecompress(data: Uint8Array): Uint8Array {
  if (data.length >= 2 && (data[0] & 0x0f) === 8 && ((data[0] << 8) | data[1]) % 31 === 0) {
    try {
      return decompressZlib(data);
    } catch {
      // Fall through to the raw-deflate attempt below.
    }
  }
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    try {
      let offset = 10;
      const flags = data[3];
      if (flags & 0x04) {
        const extraLength = data[offset] | (data[offset + 1] << 8);
        offset += 2 + extraLength;
      }
      if (flags & 0x08) {
        while (offset < data.length && data[offset] !== 0) offset += 1;
        offset += 1;
      }
      if (flags & 0x10) {
        while (offset < data.length && data[offset] !== 0) offset += 1;
        offset += 1;
      }
      if (flags & 0x02) offset += 2;
      return inflateRaw(data.subarray(offset));
    } catch {
      // Fall through to the raw-deflate attempt below.
    }
  }
  if (data.length > 0 && data[0] !== 0x3c) {
    try {
      return inflateRaw(data);
    } catch {
      return data;
    }
  }
  return data;
}

/* -------------------------------------------------------------------------- */
/* Primer thermodynamics (SantaLucia 1998 nearest-neighbour estimate)          */
/* -------------------------------------------------------------------------- */

const STACKS: Record<string, { dh: number; ds: number }> = {
  AA: { dh: -7.9, ds: -22.2 },
  TT: { dh: -7.9, ds: -22.2 },
  AT: { dh: -7.2, ds: -20.4 },
  TA: { dh: -7.2, ds: -21.3 },
  CA: { dh: -8.5, ds: -22.7 },
  TG: { dh: -8.5, ds: -22.7 },
  GT: { dh: -8.4, ds: -22.4 },
  AC: { dh: -8.4, ds: -22.4 },
  CT: { dh: -7.8, ds: -21.0 },
  AG: { dh: -7.8, ds: -21.0 },
  GA: { dh: -8.2, ds: -22.2 },
  TC: { dh: -8.2, ds: -22.2 },
  CG: { dh: -10.6, ds: -27.2 },
  GC: { dh: -9.8, ds: -24.4 },
  GG: { dh: -8.0, ds: -19.9 },
  CC: { dh: -8.0, ds: -19.9 },
};

function duplexThermodynamics(sequence: string): { dh: number; ds: number } | undefined {
  if (sequence.length < 2) return undefined;
  let dh = 0;
  let ds = 0;
  for (let index = 0; index < sequence.length - 1; index += 1) {
    const stack = STACKS[sequence.slice(index, index + 2)];
    if (!stack) return undefined;
    dh += stack.dh;
    ds += stack.ds;
  }
  const first = sequence[0];
  const last = sequence[sequence.length - 1];
  const terminalGC = (base: string) => base === 'G' || base === 'C';
  dh += terminalGC(first) ? 0.1 : 2.3;
  ds += terminalGC(first) ? -2.8 : 4.1;
  dh += terminalGC(last) ? 0.1 : 2.3;
  ds += terminalGC(last) ? -2.8 : 4.1;
  return { dh, ds };
}

function meltTemperature(sequence: string): number {
  const clean = sequence.toUpperCase().replace(/[^ACGT]/g, '');
  if (!clean) return 0;
  if (clean.length < 2) {
    return clean === 'G' || clean === 'C' ? 4 : 2;
  }
  const thermodynamics = duplexThermodynamics(clean);
  if (!thermodynamics) return 0;
  const gasConstant = 1.987;
  const primerConcentration = 0.25e-6;
  const ct = primerConcentration / 4;
  const oneMolar =
    (thermodynamics.dh * 1000) / (thermodynamics.ds + gasConstant * Math.log(ct)) - 273.15;
  if (!Number.isFinite(oneMolar)) return 0;
  const gcFraction =
    clean.split('').filter((base) => base === 'G' || base === 'C').length / clean.length;
  const sodium = 0.05;
  const logSodium = Math.log(sodium);
  const inverse =
    1 / (oneMolar + 273.15) +
    (4.29 * gcFraction - 3.95) * 1e-5 * logSodium +
    9.4e-6 * logSodium * logSodium;
  if (!Number.isFinite(inverse) || inverse <= 0) return 0;
  return Math.round((1 / inverse - 273.15) * 100) / 100;
}

function gcPercent(sequence: string): number {
  const clean = sequence.toUpperCase().replace(/[^ACGT]/g, '');
  if (!clean) return 0;
  const gc = clean.split('').filter((base) => base === 'G' || base === 'C').length;
  return Math.round((gc / clean.length) * 10000) / 100;
}

function minimumRunDeltaG(sequence: string, minimumRun = 4): number {
  let best = 0;
  const reverse = reverseComplement(sequence);
  const length = sequence.length;
  for (let shift = -(length - minimumRun); shift <= length - minimumRun; shift += 1) {
    let runStart = -1;
    for (let index = 0; index < length; index += 1) {
      const other = index - shift;
      const paired =
        other >= 0 &&
        other < length &&
        complementBase(sequence[index]) === reverse[other];
      if (paired) {
        if (runStart === -1) runStart = index;
      } else if (runStart !== -1) {
        const run = sequence.slice(runStart, index);
        if (run.length >= minimumRun) {
          const thermo = duplexThermodynamics(run);
          if (thermo) {
            const deltaG = thermo.dh - (310.15 * thermo.ds) / 1000;
            best = Math.min(best, deltaG);
          }
        }
        runStart = -1;
      }
    }
    if (runStart !== -1) {
      const run = sequence.slice(runStart);
      if (run.length >= minimumRun) {
        const thermo = duplexThermodynamics(run);
        if (thermo) {
          const deltaG = thermo.dh - (310.15 * thermo.ds) / 1000;
          best = Math.min(best, deltaG);
        }
      }
    }
  }
  return Math.round(best * 100) / 100;
}

function hairpinDeltaG(sequence: string, minimumStem = 4, minimumLoop = 3): number {
  let best = 0;
  const length = sequence.length;
  for (let stem = minimumStem; stem <= Math.floor(length / 2); stem += 1) {
    for (let start = 0; start + stem * 2 + minimumLoop <= length; start += 1) {
      for (let loop = minimumLoop; start + stem * 2 + loop <= length; loop += 1) {
        const left = sequence.slice(start, start + stem);
        const rightStart = start + stem + loop;
        const right = sequence.slice(rightStart, rightStart + stem);
        if (reverseComplement(right) !== left) continue;
        const thermo = duplexThermodynamics(left);
        if (!thermo) continue;
        const loopPenalty = loop <= 4 ? 4.5 : loop <= 8 ? 3.5 : 2.5;
        const deltaG = thermo.dh - (310.15 * thermo.ds) / 1000 + loopPenalty;
        best = Math.min(best, deltaG);
      }
    }
  }
  return Math.round(best * 100) / 100;
}

function buildPrimer(
  name: string,
  fullSequence: string,
  annealingSequence: string,
  bindingStart: number,
  bindingEnd: number,
  strand: 1 | -1,
  mismatches?: number[],
): Primer {
  const sequence = normalizeSequence(fullSequence || annealingSequence);
  const annealing = normalizeSequence(annealingSequence || sequence);
  let tail = '';
  if (sequence.length > annealing.length && sequence.endsWith(annealing)) {
    tail = sequence.slice(0, sequence.length - annealing.length);
  } else if (sequence.length > annealing.length && sequence.startsWith(annealing)) {
    tail = sequence.slice(annealing.length);
  } else if (sequence.length > annealing.length) {
    tail = sequence.slice(0, sequence.length - annealing.length);
  }
  return {
    id: generateId('primer'),
    name: name || 'Primer',
    sequence,
    bindingStart,
    bindingEnd,
    strand,
    tailSequence: tail,
    tmAnnealing: meltTemperature(annealing),
    tmTotal: meltTemperature(sequence),
    gcPercent: gcPercent(sequence),
    has3PrimeGCClamp: /[GC]$/.test(sequence),
    hairpinDeltaG: hairpinDeltaG(sequence.slice(0, 160)),
    selfDimerDeltaG: minimumRunDeltaG(sequence.slice(0, 160)),
    ...(mismatches && mismatches.length > 0 ? { mismatches } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* TeselaGen -> PlasmidDocument                                                */
/* -------------------------------------------------------------------------- */

function normalizeTeselaGenLocations(
  feature: TeselaGenFeature,
  sequenceLength: number,
  circular: boolean,
): { start: number; end: number; segments: TeselaGenLocation[] } {
  const rawLocations =
    feature.locations && feature.locations.length > 0
      ? feature.locations
      : feature.start !== undefined && feature.end !== undefined
        ? [{ start: Number(feature.start), end: Number(feature.end) }]
        : [];

  const converted: TeselaGenLocation[] = [];
  for (const location of rawLocations) {
    let start = Number(location.start);
    let endInclusive = Number(location.end);
    if (!Number.isFinite(start) || !Number.isFinite(endInclusive)) continue;
    if (sequenceLength > 0) {
      if (!circular) {
        start = clamp(start, 0, Math.max(0, sequenceLength - 1));
        endInclusive = clamp(endInclusive, 0, Math.max(0, sequenceLength - 1));
      } else {
        start = mod(start, sequenceLength);
        endInclusive = mod(endInclusive, sequenceLength);
      }
    } else {
      start = Math.max(0, start);
      endInclusive = Math.max(start, endInclusive);
    }
    const end = endInclusive + 1;
    converted.push({ start, end });
  }

  if (converted.length === 0) {
    return { start: 0, end: 0, segments: [] };
  }
  if (converted.length === 1) {
    const location = converted[0];
    if (circular && sequenceLength > 0 && location.start > location.end) {
      return { start: location.start, end: mod(location.end, sequenceLength), segments: converted };
    }
    return { start: location.start, end: location.end, segments: converted };
  }

  const sorted = [...converted].sort((a, b) => a.start - b.start);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (
    circular &&
    sequenceLength > 0 &&
    first.start === 0 &&
    last.end === sequenceLength &&
    last.start > first.end
  ) {
    return { start: last.start, end: first.end, segments: converted };
  }
  const ownWrap = converted.find((location) => location.start > location.end);
  if (ownWrap) return { start: ownWrap.start, end: ownWrap.end, segments: converted };
  const start = Math.min(...converted.map((location) => location.start));
  const end = Math.max(...converted.map((location) => location.end));
  return { start, end, segments: converted };
}

function publicSegmentsForLocations(
  locations: TeselaGenLocation[],
  strand: StrandDirection,
  circular: boolean,
  sequenceLength: number,
): TeselaGenLocation[] {
  const usable = locations.filter(
    (location) =>
      Number.isFinite(location.start) &&
      Number.isFinite(location.end) &&
      location.start >= 0 &&
      location.end >= 0 &&
      (sequenceLength === 0 ||
        (location.start <= sequenceLength && location.end <= sequenceLength)),
  );
  if (usable.length === 0) return [];
  if (usable.length === 1) {
    const location = usable[0];
    if (circular && sequenceLength > 0 && location.start > location.end) {
      const split: TeselaGenLocation[] = [];
      if (location.start < sequenceLength) {
        split.push({ start: location.start, end: sequenceLength });
      }
      if (location.end > 0) split.push({ start: 0, end: location.end });
      return strand === -1 ? [...split].reverse() : split;
    }
    return usable;
  }
  const ordered = strand === -1 ? [...usable].reverse() : [...usable];
  return ordered.filter((location) => location.start !== location.end);
}

function convertTeselaGenFeature(
  feature: TeselaGenFeature,
  sequenceLength: number,
  circular: boolean,
): SequenceFeature | undefined {
  const rawType = typeof feature.type === 'string' ? feature.type : 'misc_feature';
  const mapped = mapFeatureType(rawType);
  const notes: Record<string, string[]> = {};
  if (feature.notes && typeof feature.notes === 'object') {
    for (const [key, value] of Object.entries(feature.notes)) {
      if (isInternalNoteKey(key) || key === SEGMENTS_PUBLIC_NOTE) continue;
      const values = noteArray(value);
      if (values.length > 0) notes[key] = values;
    }
  }
  if (mapped.original && mapped.original.toLowerCase() !== mapped.type.toLowerCase()) {
    notes[ORIGINAL_TYPE_NOTE] = [mapped.original];
  }

  const location = normalizeTeselaGenLocations(feature, sequenceLength, circular);
  if (location.start === location.end && location.segments.length === 0) return undefined;

  const strand: StrandDirection =
    Number(feature.strand) === -1 ? -1 : Number(feature.strand) === 0 ? 0 : 1;
  const locations =
    location.segments.length > 0
      ? location.segments
      : [{ start: location.start, end: location.end }];
  if (location.segments.length > 1) {
    notes[SEGMENTS_NOTE] = [
      location.segments.map((segment) => `${segment.start}-${segment.end}`).join(','),
    ];
  }
  const publicSegments = publicSegmentsForLocations(
    locations,
    strand,
    circular,
    sequenceLength,
  );
  if (publicSegments.length > 1) {
    notes[SEGMENTS_PUBLIC_NOTE] = publicSegments.map(
      (segment) => `${segment.start}-${segment.end}`,
    );
  }

  const color = normalizeColor(
    feature.color ||
      notes.color?.[0] ||
      notes.ApEinfo_fwdcolor?.[0] ||
      notes.ApEinfo_revcolor?.[0],
    DEFAULT_FEATURE_COLORS[mapped.type],
  );
  const name =
    (typeof feature.name === 'string' && feature.name.trim()) ||
    notes.label?.[0] ||
    notes.ApEinfo_label?.[0] ||
    mapped.type;
  const codonStartRaw = Number.parseInt(notes.codon_start?.[0] ?? '', 10);
  const translation = notes.translation?.[0]?.replace(/\s+/g, '');

  return {
    id: generateId('feature'),
    name,
    type: mapped.type,
    start: location.start,
    end: location.end,
    strand,
    color,
    ...(codonStartRaw === 1 || codonStartRaw === 2 || codonStartRaw === 3
      ? { codonStart: codonStartRaw }
      : {}),
    ...(Object.keys(notes).length > 0 ? { notes } : {}),
    ...(translation ? { translation } : {}),
  };
}

function templateSlice(sequence: string, start: number, end: number, circular: boolean): string {
  const length = sequence.length;
  if (length === 0) return '';
  if (!circular) {
    const safeStart = clamp(start, 0, length);
    const safeEnd = clamp(end, safeStart, length);
    return sequence.slice(safeStart, safeEnd);
  }
  const safeStart = mod(start, length);
  let safeEnd = end;
  if (safeEnd < 0) safeEnd = mod(safeEnd, length);
  if (safeEnd > length) safeEnd = length;
  if (safeStart <= safeEnd) return sequence.slice(safeStart, safeEnd);
  return sequence.slice(safeStart) + sequence.slice(0, safeEnd);
}

function convertTeselaGenPrimer(
  primer: TeselaGenFeature,
  sequence: string,
  circular: boolean,
): Primer | undefined {
  const length = sequence.length;
  const start = Number(primer.start);
  const endInclusive = Number(primer.end);
  if (!Number.isFinite(start) || !Number.isFinite(endInclusive)) return undefined;

  let bindingStart = start;
  let bindingEnd = endInclusive + 1;
  if (!circular) {
    bindingStart = clamp(bindingStart, 0, Math.max(0, length));
    bindingEnd = clamp(bindingEnd, bindingStart, length);
  } else if (length > 0) {
    bindingStart = mod(bindingStart, length);
    bindingEnd = bindingEnd > length ? mod(bindingEnd, length) : bindingEnd;
  }
  if (bindingStart === bindingEnd) return undefined;

  let fullSequence = '';
  if (typeof primer.bases === 'string' && primer.bases.trim()) {
    fullSequence = primer.bases;
  }
  const notes = primer.notes ?? {};
  if (!fullSequence) {
    for (const key of ['sequence', 'Sequence', 'bases', 'primer_seq', 'annealedBases']) {
      const values = noteArray(notes[key]);
      if (values.length > 0 && values[0]) {
        fullSequence = values[0];
        break;
      }
    }
  }
  if (!fullSequence) {
    const noteText = noteArray(notes.note).join(' ');
    const noteSequence = /(?:primer\s+)?sequence\s*:\s*([A-Za-z]+)/i.exec(noteText)?.[1];
    if (noteSequence) fullSequence = noteSequence;
  }
  const strand: 1 | -1 = Number(primer.strand) === -1 ? -1 : 1;
  const template = templateSlice(sequence, bindingStart, bindingEnd, circular);
  const annealing = strand === 1 ? template : reverseComplement(template);
  if (!fullSequence) fullSequence = annealing;
  const name =
    (typeof primer.name === 'string' && primer.name.trim()) ||
    noteArray(notes.label)[0] ||
    'Primer';
  return buildPrimer(name, fullSequence, annealing, bindingStart, bindingEnd, strand);
}

function normalizeParsedSequence(
  parsed: TeselaGenSequence,
  options: {
    fileName?: string;
    createdAt?: string;
    updatedAt?: string;
    methylationProfile?: PlasmidDocument['methylationProfile'];
    topology?: 'circular' | 'linear';
  } = {},
): PlasmidDocument {
  const sequence = normalizeSequence(parsed.sequence);
  const circular =
    options.topology !== undefined
      ? options.topology === 'circular'
      : parsed.circular === true ||
        parsed.circular === 1 ||
        parsed.circular === 'circular' ||
        parsed.circular === 'true';
  const now = nowIso();
  const createdAt = options.createdAt ?? normalizeDate(parsed.date) ?? now;
  const updatedAt = options.updatedAt ?? createdAt;
  const description =
    typeof parsed.description === 'string' && parsed.description.trim()
      ? stripHtml(parsed.description)
      : undefined;
  const features: SequenceFeature[] = [];
  const sourceFeatures = [
    ...(Array.isArray(parsed.features) ? parsed.features : []),
    ...(Array.isArray(parsed.parts) ? parsed.parts : []),
  ];
  for (const feature of sourceFeatures) {
    if (!feature || typeof feature !== 'object') continue;
    const converted = convertTeselaGenFeature(feature, sequence.length, circular);
    if (converted) features.push(converted);
  }
  const primers: Primer[] = [];
  for (const primer of Array.isArray(parsed.primers) ? parsed.primers : []) {
    if (!primer || typeof primer !== 'object') continue;
    const converted = convertTeselaGenPrimer(primer, sequence, circular);
    if (converted) primers.push(converted);
  }

  return {
    id: generateId('plasmid'),
    name:
      (typeof parsed.name === 'string' && parsed.name.trim()) ||
      (options.fileName ? setExtensionlessName(options.fileName) : '') ||
      'Untitled Sequence',
    sequence,
    topology: circular ? 'circular' : 'linear',
    length: sequence.length,
    createdAt,
    updatedAt,
    ...(description ? { description } : {}),
    methylationProfile: options.methylationProfile ?? { dam: true, dcm: true, cpg: false },
    features,
    primers,
    history: [
      {
        id: generateId('history'),
        operation: 'import',
        timestamp: updatedAt,
        description: `Imported ${options.fileName ?? 'sequence'}`,
      },
    ],
  };
}

function teselaGenResultsToDocuments(
  results: unknown,
  options: { fileName?: string } = {},
): PlasmidDocument[] {
  if (!Array.isArray(results)) return [];
  const documents: PlasmidDocument[] = [];
  for (const result of results as TeselaGenParseResult[]) {
    if (!result || result.success === false || !result.parsedSequence) continue;
    documents.push(normalizeParsedSequence(result.parsedSequence, options));
  }
  return documents;
}

/* -------------------------------------------------------------------------- */
/* SnapGene binary packets                                                     */
/* -------------------------------------------------------------------------- */

function readPackets(buffer: ArrayBuffer | Uint8Array): SnapGenePacket[] {
  const bytes = toUint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packets: SnapGenePacket[] = [];
  let offset = 0;
  while (offset + 5 <= bytes.byteLength) {
    const type = view.getUint8(offset);
    const size = view.getUint32(offset + 1, false);
    const dataStart = offset + 5;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.byteLength) throw new Error('Truncated SnapGene packet');
    packets.push({ type, data: bytes.subarray(dataStart, dataEnd), offset });
    offset = dataEnd;
  }
  return packets;
}

function validateSnapGeneCookie(packets: SnapGenePacket[]): void {
  if (packets.length === 0 || packets[0].type !== 0x09) {
    throw new Error('Invalid SnapGene file: missing cookie packet');
  }
  const cookie = packets[0].data;
  if (cookie.byteLength !== 14 || decodeAscii(cookie.subarray(0, 8)) !== 'SnapGene') {
    throw new Error('Invalid SnapGene file: bad cookie');
  }
}

function findSnapGeneDnaPacket(packets: SnapGenePacket[]): {
  sequence: string;
  circular: boolean;
  flags: number;
} {
  const dnaPackets = packets.filter((packet) => packet.type === 0x00 || packet.type === 0x15);
  if (dnaPackets.length === 0) {
    const compressed = packets.find((packet) => packet.type === 0x01);
    if (compressed) {
      const inflated = maybeDecompress(compressed.data);
      if (inflated.byteLength >= 1) {
        return {
          sequence: normalizeSequence(decodeAscii(inflated.subarray(1))),
          circular: (inflated[0] & 0x01) !== 0,
          flags: inflated[0],
        };
      }
    }
    throw new Error('Invalid SnapGene file: missing DNA packet');
  }
  const packet = dnaPackets[0];
  if (packet.data.byteLength < 1) throw new Error('Invalid SnapGene DNA packet');
  const flags = packet.data[0];
  return {
    sequence: normalizeSequence(decodeAscii(packet.data.subarray(1))),
    circular: (flags & 0x01) !== 0,
    flags,
  };
}

function parseSnapGeneNotes(xml: string, fallback: SnapGeneNotes = {}): SnapGeneNotes {
  const notes: SnapGeneNotes = { ...fallback };
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch {
    return notes;
  }
  const name = xmlChildText(root, 'CustomMapLabel') ?? xmlChildText(root, 'Name');
  const description =
    xmlChildText(root, 'Description') ??
    xmlChildText(root, 'Comments') ??
    xmlChildText(root, 'Comment');
  const dateWithTime = (tag: string): string | undefined => {
    const element = xmlChildren(root, tag)[0];
    if (!element) return undefined;
    const date = element.text.trim();
    if (!date) return undefined;
    return element.attrs.UTC ? `${date} ${element.attrs.UTC}` : date;
  };
  const created = dateWithTime('Created');
  const modified = dateWithTime('LastModified');
  const transformedInto = xmlChildText(root, 'TransformedInto') ?? '';
  if (name) notes.name = stripHtml(name);
  if (description) notes.description = stripHtml(description);
  const createdAt = normalizeDate(created);
  const updatedAt = normalizeDate(modified);
  if (createdAt) notes.createdAt = createdAt;
  if (updatedAt) notes.updatedAt = updatedAt;

  const lower = xml.toLowerCase();
  const damOff =
    /\bdam\s*[-\u2212](?=[\s,;/<]|$)/i.test(transformedInto) ||
    /\bdam\s*[-\u2212](?=[\s,;/<]|$)/.test(lower);
  const dcmOff =
    /\bdcm\s*[-\u2212](?=[\s,;/<]|$)/i.test(transformedInto) ||
    /\bdcm\s*[-\u2212](?=[\s,;/<]|$)/.test(lower);
  const cpgOff =
    /\bcpg\s*[-\u2212](?=[\s,;/<]|$)/i.test(transformedInto) ||
    /\bcpg\s*[-\u2212](?=[\s,;/<]|$)/.test(lower);
  if (damOff || dcmOff || cpgOff) {
    notes.methylationProfile = {
      dam: !damOff,
      dcm: !dcmOff,
      cpg: !cpgOff,
    };
  }
  return notes;
}

function parseSnapGeneLinearEnds(
  packets: SnapGenePacket[],
): SnapGeneLinearEnds | undefined {
  const packet = packets.find((item) => item.type === 0x08);
  if (!packet) return undefined;
  let root: XmlNode;
  try {
    root = parseXml(decodeUtf8(packet.data));
  } catch {
    return undefined;
  }
  const number = (tag: string): number => {
    const parsed = Number.parseInt(xmlChildText(root, tag) ?? '0', 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const end = (stickinessTag: string, modificationTag: string): OverhangEnd => {
    const stickiness = number(stickinessTag);
    const modification = xmlChildText(root, modificationTag) ?? '';
    return {
      type: stickiness > 0 ? '5-prime' : stickiness < 0 ? '3-prime' : 'blunt',
      sequence: '',
      phosphorylated: /phosphorylat/i.test(modification),
    };
  };
  return {
    left: end('UpstreamStickiness', 'UpstreamModification'),
    right: end('DownstreamStickiness', 'DownstreamModification'),
  };
}

function snapGeneFeatureLocations(
  segments: XmlNode[],
  sequenceLength: number,
  circular: boolean,
): TeselaGenLocation[] {
  const locations: TeselaGenLocation[] = [];
  for (const segment of segments) {
    if (segment.attrs.type === 'gap') continue;
    const range =
      segment.attrs.range ??
      (segment.attrs.start && segment.attrs.end
        ? `${segment.attrs.start}-${segment.attrs.end}`
        : undefined);
    if (!range) continue;
    const match = /^(-?\d+)-(-?\d+)$/.exec(range.trim());
    if (!match) continue;
    let start = Number(match[1]) - 1;
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (!circular) start = clamp(start, 0, Math.max(0, sequenceLength - 1));
    else if (sequenceLength > 0) start = mod(start, sequenceLength);
    locations.push({ start, end });
  }
  return locations;
}

function mergeFeatureLocations(
  locations: TeselaGenLocation[],
  sequenceLength: number,
  circular: boolean,
): { start: number; end: number } {
  if (locations.length === 0) return { start: 0, end: 0 };
  if (locations.length === 1) return locations[0];
  const sorted = [...locations].sort((a, b) => a.start - b.start);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (
    circular &&
    sequenceLength > 0 &&
    first.start === 0 &&
    last.end === sequenceLength &&
    last.start > first.end
  ) {
    return { start: last.start, end: first.end };
  }
  const wrap = locations.find((location) => location.start > location.end);
  if (wrap) return wrap;
  return {
    start: Math.min(...locations.map((location) => location.start)),
    end: Math.max(...locations.map((location) => location.end)),
  };
}

function parseSnapGeneFeatures(
  xml: string,
  sequenceLength: number,
  circular: boolean,
): SequenceFeature[] {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch {
    return [];
  }
  const featureNodes = root.tag === 'Feature' ? [root] : xmlChildren(root, 'Feature');
  const features: SequenceFeature[] = [];
  for (const node of featureNodes) {
    const mapped = mapFeatureType(node.attrs.type ?? 'misc_feature');
    const notes: Record<string, string[]> = {};
    for (const qualifier of xmlChildren(node, 'Q')) {
      const key = qualifier.attrs.name;
      if (!key || isInternalNoteKey(key) || key === SEGMENTS_PUBLIC_NOTE) continue;
      const values = xmlValue(qualifier).map((value) => stripHtml(value));
      if (values.length > 0) notes[key] = values;
    }
    if (mapped.original && mapped.original.toLowerCase() !== mapped.type.toLowerCase()) {
      notes[ORIGINAL_TYPE_NOTE] = [mapped.original];
    }

    const segments = xmlChildren(node, 'Segment');
    const locations = snapGeneFeatureLocations(segments, sequenceLength, circular);
    if (locations.length === 0) continue;
    const merged = mergeFeatureLocations(locations, sequenceLength, circular);
    const start = merged.start;
    let end = merged.end;
    if (!circular && sequenceLength > 0) end = clamp(end, start, sequenceLength);
    if (locations.length > 1) {
      notes[SEGMENTS_NOTE] = [locations.map((location) => `${location.start}-${location.end}`).join(',')];
    }

    let color = '';
    for (const segment of segments) {
      if (segment.attrs.color) {
        color = segment.attrs.color;
        break;
      }
    }
    color = normalizeColor(color || notes.color?.[0], DEFAULT_FEATURE_COLORS[mapped.type]);

    const directionality = Number.parseInt(node.attrs.directionality ?? '0', 10);
    const directionNote = notes.direction?.[0]?.toUpperCase();
    let strand: StrandDirection = 1;
    if (directionality === 2) strand = -1;
    else if (directionality === 0) strand = 0;
    else if (directionality === 3) strand = 0;
    if (directionNote === 'NONE') strand = 0;
    if (directionNote === 'BOTH') strand = 0;

    const publicSegments = publicSegmentsForLocations(
      locations,
      strand,
      circular,
      sequenceLength,
    );
    if (publicSegments.length > 1) {
      notes[SEGMENTS_PUBLIC_NOTE] = publicSegments.map(
        (segment) => `${segment.start}-${segment.end}`,
      );
    }

    const name =
      node.attrs.name?.trim() ||
      notes.label?.[0] ||
      mapped.type;
    const codonStartRaw = Number.parseInt(notes.codon_start?.[0] ?? '', 10);
    const translation = notes.translation?.[0]?.replace(/\s+/g, '');
    features.push({
      id: generateId('feature'),
      name: stripHtml(name),
      type: mapped.type,
      start,
      end,
      strand,
      color,
      ...(codonStartRaw === 1 || codonStartRaw === 2 || codonStartRaw === 3
        ? { codonStart: codonStartRaw }
        : {}),
      ...(Object.keys(notes).length > 0 ? { notes } : {}),
      ...(translation ? { translation } : {}),
    });
  }
  return features;
}

function parseSnapGenePrimerBindings(primerNode: XmlNode): SnapGenePrimerBinding[] {
  const bindings: SnapGenePrimerBinding[] = [];
  const seen = new Set<string>();
  for (const site of xmlChildren(primerNode, 'BindingSite')) {
    const location =
      site.attrs.location ??
      (site.attrs.start && site.attrs.end
        ? `${site.attrs.start}-${site.attrs.end}`
        : undefined);
    if (!location) continue;
    const match = /^(-?\d+)-(-?\d+)$/.exec(location.trim());
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]) + 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const strand: 1 | -1 = site.attrs.boundStrand === '1' ? -1 : 1;
    const key = `${start}:${end}:${strand}`;
    if (site.attrs.simplified === '1' && seen.has(key)) continue;
    seen.add(key);
    bindings.push({
      start,
      end,
      strand,
      ...(site.attrs.annealedBases ? { annealedBases: site.attrs.annealedBases } : {}),
    });
  }
  return bindings;
}

function parseSnapGenePrimers(xml: string, sequence: string, circular: boolean): Primer[] {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch {
    return [];
  }
  const primerNodes = root.tag === 'Primer' ? [root] : xmlChildren(root, 'Primer');
  const primers: Primer[] = [];
  const seen = new Set<string>();
  for (const node of primerNodes) {
    const bindings = parseSnapGenePrimerBindings(node);
    if (bindings.length === 0) continue;
    const binding = bindings[0];
    let bindingStart = binding.start;
    let bindingEnd = binding.end;
    const length = sequence.length;
    if (length > 0) {
      if (circular) {
        bindingStart = mod(bindingStart, length);
        if (bindingEnd > length) bindingEnd = mod(bindingEnd, length);
      } else {
        bindingStart = clamp(bindingStart, 0, length);
        bindingEnd = clamp(bindingEnd, bindingStart, length);
      }
    }
    if (bindingStart === bindingEnd) continue;

    const fullSequence = node.attrs.sequence ?? '';
    const template = templateSlice(sequence, bindingStart, bindingEnd, circular);
    const annealing =
      binding.annealedBases && binding.annealedBases.trim()
        ? normalizeSequence(binding.annealedBases)
        : binding.strand === 1
          ? template
          : reverseComplement(template);
    const key = `${node.attrs.name ?? ''}|${fullSequence}|${bindingStart}|${bindingEnd}|${binding.strand}`;
    if (seen.has(key)) continue;
    seen.add(key);
    primers.push(
      buildPrimer(
        node.attrs.name ?? 'Primer',
        fullSequence || annealing,
        annealing,
        bindingStart,
        bindingEnd,
        binding.strand,
      ),
    );
  }
  return primers;
}

function snapshotTimestamps(packets: SnapGenePacket[]): Map<number, string> {
  const timestamps = new Map<number, string>();
  for (const packet of packets) {
    if (packet.type !== 0x0b || packet.data.byteLength < 4) continue;
    const view = new DataView(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength);
    const id = view.getUint32(0, false);
    let offset = 4;
    let found: string | undefined;
    while (offset + 5 <= packet.data.byteLength) {
      const type = packet.data[offset];
      const size = view.getUint32(offset + 1, false);
      const start = offset + 5;
      const end = start + size;
      if (end > packet.data.byteLength) break;
      const payload = maybeDecompress(packet.data.subarray(start, end));
      const text = decodeUtf8(payload);
      if (type === 0x1d || type === 0x1e || text.includes('<LastModified>')) {
        const modified = /<LastModified[^>]*>([^<]+)<\/LastModified>/.exec(text)?.[1];
        const created = /<Created[^>]*>([^<]+)<\/Created>/.exec(text)?.[1];
        found = normalizeDate(modified) ?? normalizeDate(created) ?? found;
      }
      offset = end;
    }
    if (found) timestamps.set(id, found);
  }
  return timestamps;
}

interface HistoryNodeDescriptor {
  node: XmlNode;
  parent?: HistoryNodeDescriptor;
  inputs: HistoryNodeDescriptor[];
  inputSummaries: XmlNode[];
  index: number;
}

function collectHistoryDescriptors(root: XmlNode): HistoryNodeDescriptor[] {
  const treeRoot =
    root.tag === 'HistoryTree'
      ? root
      : xmlDescendants(root, 'HistoryTree')[0] ?? root;
  const result: HistoryNodeDescriptor[] = [];
  let index = 0;

  function visit(node: XmlNode, parent?: HistoryNodeDescriptor): HistoryNodeDescriptor {
    const descriptor: HistoryNodeDescriptor = {
      node,
      parent,
      inputs: [],
      inputSummaries: xmlChildren(node, 'InputSummary'),
      index,
    };
    index += 1;
    for (const child of xmlChildren(node, 'Node')) {
      descriptor.inputs.push(visit(child, descriptor));
    }
    result.push(descriptor);
    return descriptor;
  }

  if (treeRoot.tag === 'Node') {
    visit(treeRoot);
    return result;
  }
  for (const child of xmlChildren(treeRoot, 'Node')) visit(child);
  return result;
}

function historyEnzymes(descriptor: HistoryNodeDescriptor): string[] | undefined {
  const names = new Set<string>();
  for (const summary of descriptor.inputSummaries) {
    for (const key of ['name1', 'name2', 'enzyme', 'enzymes']) {
      const value = summary.attrs[key];
      if (!value) continue;
      for (const name of value.split(/[,;\s]+/)) {
        if (name.length >= 3) names.add(name);
      }
    }
  }
  for (const child of descriptor.node.children) {
    if (child.tag === 'Enzyme' && child.attrs.name) names.add(child.attrs.name);
    if (
      child.tag === 'Parameter' &&
      child.attrs.name?.toLowerCase() === 'enzyme' &&
      child.attrs.val
    ) {
      names.add(child.attrs.val);
    }
  }
  return names.size > 0 ? [...names] : undefined;
}

function historyPrimers(descriptor: HistoryNodeDescriptor): string[] | undefined {
  const names = new Set<string>();
  for (const oligo of xmlChildren(descriptor.node, 'Oligo')) {
    if (oligo.attrs.name) names.add(oligo.attrs.name);
  }
  for (const primersNode of xmlChildren(descriptor.node, 'Primers')) {
    for (const primer of xmlChildren(primersNode, 'Primer')) {
      if (primer.attrs.name) names.add(primer.attrs.name);
    }
  }
  for (const primer of xmlChildren(descriptor.node, 'Primer')) {
    if (primer.attrs.name) names.add(primer.attrs.name);
  }
  return names.size > 0 ? [...names] : undefined;
}

function parseSnapGeneHistory(
  xml: string,
  baseDoc: PlasmidDocument,
  timestamps: Map<number, string>,
): CloningHistoryNode[] {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch {
    return [];
  }
  if (
    root.tag !== 'HistoryTree' &&
    root.tag !== 'Node' &&
    xmlDescendants(root, 'HistoryTree').length === 0
  ) {
    return [];
  }
  const descriptors = collectHistoryDescriptors(root);
  const ids = new Map<HistoryNodeDescriptor, string>();
  for (const descriptor of descriptors) ids.set(descriptor, generateId('history'));
  const nodes: CloningHistoryNode[] = [];
  for (const descriptor of descriptors) {
    const attributes = descriptor.node.attrs;
    const operation = mapOperation(attributes.operation, descriptor.inputs.length > 0);
    const nodeId = ids.get(descriptor) as string;
    const numericId = Number.parseInt(attributes.ID ?? '', 10);
    const timestamp =
      (Number.isFinite(numericId) ? timestamps.get(numericId) : undefined) ??
      normalizeDate(attributes.timestamp) ??
      normalizeDate(attributes.date) ??
      normalizeDate(attributes.created) ??
      baseDoc.updatedAt;
    const inputNames = descriptor.inputs
      .map((input) => input.node.attrs.name)
      .filter((name): name is string => Boolean(name));
    const name = attributes.name?.trim() || 'Sequence';
    const operationLabel = attributes.operation?.trim() || operation;
    const description = `${name} - ${operationLabel}${inputNames.length ? ` from ${inputNames.join(' + ')}` : ''}`;
    const parentSnapshots = descriptor.inputs.map((input, inputIndex) => {
      const inputId = ids.get(input) as string;
      const length = Number.parseInt(input.node.attrs.seqLen ?? input.node.attrs.seqLength ?? '', 10);
      const summary = descriptor.inputSummaries[inputIndex];
      const rangeStart = Number.parseInt(summary?.attrs.val1 ?? '', 10);
      const rangeEnd = Number.parseInt(summary?.attrs.val2 ?? '', 10);
      const extractedRange =
        Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeStart >= 0 && rangeEnd >= 0
          ? ([Math.min(rangeStart, rangeEnd), Math.max(rangeStart, rangeEnd)] as [number, number])
          : undefined;
      return {
        id: inputId,
        name: input.node.attrs.name ?? 'Sequence',
        length: Number.isFinite(length) ? length : baseDoc.length,
        ...(extractedRange ? { extractedRange } : {}),
      };
    });
    const enzymesUsed = historyEnzymes(descriptor);
    const primersUsed = historyPrimers(descriptor);
    nodes.push({
      id: nodeId,
      operation,
      timestamp,
      description,
      ...(enzymesUsed ? { enzymesUsed } : {}),
      ...(primersUsed ? { primersUsed } : {}),
      ...(parentSnapshots.length > 0 ? { parentSnapshots } : {}),
    });
  }
  return nodes;
}

function applySnapGeneFeatures(
  baseDoc: PlasmidDocument,
  features: SequenceFeature[],
): PlasmidDocument {
  if (features.length === 0) return baseDoc;
  return { ...baseDoc, features };
}

function applySnapGenePrimers(baseDoc: PlasmidDocument, primers: Primer[]): PlasmidDocument {
  if (primers.length === 0) return baseDoc;
  return { ...baseDoc, primers };
}

function applySnapGeneHistory(
  baseDoc: PlasmidDocument,
  history: CloningHistoryNode[],
): PlasmidDocument {
  if (history.length === 0) return baseDoc;
  if (history.some((node) => node.operation === 'import')) {
    return { ...baseDoc, history };
  }
  const importNode: CloningHistoryNode =
    (Array.isArray(baseDoc.history) ? baseDoc.history : []).find(
      (node) => node.operation === 'import',
    ) ??
    ({
      id: generateId('history'),
      operation: 'import',
      timestamp: baseDoc.updatedAt,
      description: `Imported ${baseDoc.name}`,
    } satisfies CloningHistoryNode);
  return { ...baseDoc, history: [importNode, ...history] };
}

function extractHistoryXml(packet: SnapGenePacket): string | undefined {
  const candidates: Uint8Array[] = [packet.data];
  if (packet.type === 0x0b && packet.data.byteLength > 4) {
    candidates.push(packet.data.subarray(4));
  }
  for (const candidate of candidates) {
    const payload = maybeDecompress(candidate);
    const text = decodeUtf8(payload);
    let start = text.indexOf('<HistoryTree');
    let closing = '</HistoryTree>';
    if (start === -1) {
      start = text.indexOf('<Node');
      closing = '</Node>';
    }
    if (start === -1) continue;
    const end = text.lastIndexOf(closing);
    return end === -1 ? text.slice(start) : text.slice(start, end + closing.length);
  }
  return undefined;
}

function snapGeneHistoryFromPackets(
  packets: SnapGenePacket[],
  baseDoc: PlasmidDocument,
): CloningHistoryNode[] {
  const timestamps = snapshotTimestamps(packets);
  const history: CloningHistoryNode[] = [];
  for (const packet of packets) {
    if (packet.type !== 0x07 && packet.type !== 0x0b) continue;
    const xml = extractHistoryXml(packet);
    if (xml) history.push(...parseSnapGeneHistory(xml, baseDoc, timestamps));
  }
  return history;
}

function parseSnapGeneDocumentFromPackets(
  packets: SnapGenePacket[],
  fileName: string,
): PlasmidDocument {
  const dna = findSnapGeneDnaPacket(packets);
  let notes: SnapGeneNotes = {};
  for (const packet of packets) {
    if (packet.type === 0x06) notes = parseSnapGeneNotes(decodeUtf8(packet.data), notes);
  }
  const features: SequenceFeature[] = [];
  for (const packet of packets) {
    if (packet.type === 0x0a) {
      features.push(...parseSnapGeneFeatures(decodeUtf8(packet.data), dna.sequence.length, dna.circular));
    }
  }
  const primers: Primer[] = [];
  for (const packet of packets) {
    if (packet.type === 0x05) {
      primers.push(...parseSnapGenePrimers(decodeUtf8(packet.data), dna.sequence, dna.circular));
    }
  }
  const linearEnds = dna.circular ? undefined : parseSnapGeneLinearEnds(packets);
  const now = nowIso();
  const doc: PlasmidDocument = {
    id: generateId('plasmid'),
    name: notes.name ?? (fileName ? setExtensionlessName(fileName) : 'Untitled Sequence'),
    sequence: dna.sequence,
    topology: dna.circular ? 'circular' : 'linear',
    length: dna.sequence.length,
    createdAt: notes.createdAt ?? now,
    updatedAt: notes.updatedAt ?? notes.createdAt ?? now,
    ...(notes.description ? { description: notes.description } : {}),
    methylationProfile: notes.methylationProfile ?? { dam: true, dcm: true, cpg: false },
    ...(linearEnds ? { linearEnds } : {}),
    features,
    primers,
    history: [
      {
        id: generateId('history'),
        operation: 'import',
        timestamp: notes.updatedAt ?? notes.createdAt ?? now,
        description: `Imported ${fileName || 'sequence'}`,
      },
    ],
  };
  const history = snapGeneHistoryFromPackets(packets, doc);
  if (history.length > 0) {
    const hasImport = history.some((node) => node.operation === 'import');
    doc.history = hasImport ? history : [doc.history[0], ...history];
  }
  return doc;
}

function parseSegmentsNote(value: string | undefined): TeselaGenLocation[] {
  if (!value) return [];
  const segments: TeselaGenLocation[] = [];
  for (const part of value.split(',')) {
    const match = /^(\d+)-(\d+)$/.exec(part.trim());
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      segments.push({ start, end });
    }
  }
  return segments;
}

function parseSegmentNoteValues(values: string[] | undefined): TeselaGenLocation[] {
  if (!values || values.length === 0) return [];
  const segments: TeselaGenLocation[] = [];
  for (const value of values) {
    segments.push(...parseSegmentsNote(value));
  }
  return segments;
}

function splitFeatureSpan(
  start: number,
  end: number,
  circular: boolean,
  sequenceLength: number,
): TeselaGenLocation[] {
  if (start === end) return [];
  if (circular && sequenceLength > 0 && start > end) {
    const segments: TeselaGenLocation[] = [];
    if (start < sequenceLength) segments.push({ start, end: sequenceLength });
    if (end > 0) segments.push({ start: 0, end });
    return segments;
  }
  return [{ start, end: Math.max(start, end) }];
}

function featureSegmentLocations(
  feature: SequenceFeature,
  circular: boolean,
  sequenceLength: number,
): TeselaGenLocation[] {
  const publicSegments = parseSegmentNoteValues(feature.notes?.[SEGMENTS_PUBLIC_NOTE]);
  const legacySegments = parseSegmentNoteValues(feature.notes?.[SEGMENTS_NOTE] ?? feature.notes?.[LEGACY_SEGMENTS_NOTE]);
  const stored =
    publicSegments.length > 0
      ? feature.strand === -1
        ? [...publicSegments].reverse()
        : publicSegments
      : legacySegments;
  const usable = stored.filter(
    (segment) =>
      segment.start >= 0 &&
      segment.end <= sequenceLength &&
      segment.start < segment.end,
  );
  if (usable.length > 0) {
    const span = segmentSpan(
      usable,
      feature.start,
      feature.end,
      circular,
      sequenceLength,
    );
    if (span.start === feature.start && span.end === feature.end) return usable;
  }
  return splitFeatureSpan(feature.start, feature.end, circular, sequenceLength);
}

function segmentSpan(
  segments: TeselaGenLocation[],
  featureStart: number,
  featureEnd: number,
  circular: boolean,
  sequenceLength: number,
): { start: number; end: number } {
  if (segments.length === 0) return { start: featureStart, end: featureEnd };
  if (segments.length > 1) {
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (circular && sequenceLength > 0 && first.start === 0 && last.end === sequenceLength && last.start > first.end) {
      return { start: last.start, end: first.end };
    }
  }
  const wrap = segments.find((segment) => segment.start > segment.end && circular);
  if (wrap) return { start: wrap.start, end: wrap.end };
  return {
    start: Math.min(...segments.map((segment) => segment.start)),
    end: Math.max(...segments.map((segment) => segment.end)),
  };
}

function featureToTeselaGen(
  feature: SequenceFeature,
  circular: boolean,
  sequenceLength: number,
): TeselaGenFeature {
  const notes: Record<string, string[]> = {};
  if (feature.notes) {
    for (const [key, values] of Object.entries(feature.notes)) {
      if (
        isInternalNoteKey(key) ||
        key === SEGMENTS_PUBLIC_NOTE
      ) {
        continue;
      }
      if (key === 'label') continue;
      const cleaned = values.filter((value) => value !== undefined && value !== null);
      if (cleaned.length > 0) notes[key] = cleaned;
    }
  }
  const color = normalizeColor(feature.color, DEFAULT_FEATURE_COLORS[feature.type]);
  notes.ApEinfo_fwdcolor = [color];
  notes.ApEinfo_revcolor = [color];
  if (feature.codonStart) notes.codon_start = [String(feature.codonStart)];
  if (feature.translation) notes.translation = [feature.translation];

  let locations: TeselaGenLocation[] = featureSegmentLocations(
    feature,
    circular,
    sequenceLength,
  )
    .filter((segment) => segment.start < segment.end)
    .map((segment) => ({ start: segment.start, end: segment.end - 1 }));
  if (locations.length === 0) {
    if (feature.start > feature.end && circular && sequenceLength > 0) {
      locations = [{ start: feature.start, end: sequenceLength - 1 }];
      if (feature.end > 0) locations.push({ start: 0, end: feature.end - 1 });
    } else {
      locations = [{ start: feature.start, end: Math.max(feature.start, feature.end - 1) }];
    }
  }

  const first = locations[0];
  return {
    id: feature.id,
    name: feature.name,
    type: feature.type,
    start: first.start,
    end: first.end,
    strand: feature.strand === -1 ? -1 : 1,
    color,
    notes,
    ...(locations.length > 1 ? { locations } : {}),
    ...(feature.codonStart ? { codonStart: feature.codonStart } : {}),
    ...(feature.translation ? { translation: feature.translation } : {}),
  };
}

function primerToTeselaGen(
  primer: Primer,
  circular: boolean,
  sequenceLength: number,
): TeselaGenFeature {
  const locations: TeselaGenLocation[] = [];
  if (primer.bindingStart > primer.bindingEnd && circular && sequenceLength > 0) {
    locations.push({ start: primer.bindingStart, end: sequenceLength - 1 });
    if (primer.bindingEnd > 0) locations.push({ start: 0, end: primer.bindingEnd - 1 });
  } else if (primer.bindingEnd > primer.bindingStart) {
    locations.push({ start: primer.bindingStart, end: primer.bindingEnd - 1 });
  }
  const first = locations[0] ?? { start: primer.bindingStart, end: primer.bindingStart };
  const color = DEFAULT_FEATURE_COLORS.primer_bind;
  return {
    id: primer.id,
    name: primer.name,
    type: 'primer_bind',
    start: first.start,
    end: first.end,
    strand: primer.strand,
    color,
    bases: primer.sequence,
    notes: {
      ApEinfo_fwdcolor: [color],
      ApEinfo_revcolor: [color],
    },
    ...(locations.length > 1 ? { locations } : {}),
  };
}

function documentToTeselaGen(doc: PlasmidDocument): TeselaGenSequence {
  const circular = doc.topology === 'circular';
  const features = doc.features.map((feature) =>
    featureToTeselaGen(feature, circular, doc.length),
  );
  const primers = doc.primers.map((primer) => primerToTeselaGen(primer, circular, doc.length));
  return {
    name: doc.name,
    sequence: doc.sequence,
    circular,
    size: doc.length,
    description: doc.description ?? '',
    isDNA: true,
    features,
    primers,
    parts: [],
    date: doc.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* SnapGene binary writing                                                     */
/* -------------------------------------------------------------------------- */

const SNAP_GENE_EXPORT_VERSION = 14;
const SNAP_GENE_IMPORT_VERSION = 14;

const SNAP_GENE_OPERATIONS: Record<CloningOperationType, string> = {
  import: 'invalid',
  restriction_ligation: 'restrictionCloning',
  gibson_assembly: 'gibsonAssembly',
  golden_gate: 'goldenGateAssembly',
  gateway_bp: 'gatewayBPCloning',
  gateway_lr: 'gatewayLRCloning',
  pcr: 'amplifyFragment',
  soe_pcr: 'amplifyFragment',
  site_directed_mutagenesis: 'primerDirectedMutagenesis',
  blunting: 'replace',
  manual_edit: 'replace',
};

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function snapGenePacket(type: number, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(5 + payload.byteLength);
  const view = new DataView(result.buffer);
  view.setUint8(0, type);
  view.setUint32(1, payload.byteLength, false);
  result.set(payload, 5);
  return result;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function snapGeneDateParts(iso: string): { date: string; time: string } {
  const parsed = new Date(iso);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${date.getUTCFullYear()}.${date.getUTCMonth() + 1}.${date.getUTCDate()}`,
    time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
  };
}

function buildSnapGeneCookie(): Uint8Array {
  const payload = new Uint8Array(14);
  payload.set(encodeAscii('SnapGene'), 0);
  const view = new DataView(payload.buffer);
  view.setUint16(8, 1, false);
  view.setUint16(10, SNAP_GENE_EXPORT_VERSION, false);
  view.setUint16(12, SNAP_GENE_IMPORT_VERSION, false);
  return snapGenePacket(0x09, payload);
}

function encodeAscii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function buildSnapGeneDnaPacket(
  sequence: string,
  circular: boolean,
  methylation: PlasmidDocument['methylationProfile'],
): Uint8Array {
  let flags = 0x02; // Double-stranded DNA.
  if (circular) flags |= 0x01;
  if (methylation?.dam) flags |= 0x04;
  if (methylation?.dcm) flags |= 0x08;
  const sequenceBytes = encodeAscii(sequence);
  const payload = new Uint8Array(1 + sequenceBytes.byteLength);
  payload[0] = flags;
  payload.set(sequenceBytes, 1);
  return snapGenePacket(0x00, payload);
}

function buildSnapGeneNotesPacket(doc: PlasmidDocument): Uint8Array {
  const created = snapGeneDateParts(doc.createdAt);
  const modified = snapGeneDateParts(doc.updatedAt ?? doc.createdAt);
  const lines = ['<Notes>', '<Type>Synthetic</Type>', '<ConfirmedExperimentally>0</ConfirmedExperimentally>'];
  lines.push(`<CustomMapLabel>${escapeXmlText(doc.name)}</CustomMapLabel>`);
  lines.push('<UseCustomMapLabel>1</UseCustomMapLabel>');
  if (doc.description && doc.description.trim()) {
    lines.push(`<Description>${escapeXmlText(doc.description)}</Description>`);
  }
  lines.push(`<Created UTC="${created.time}">${created.date}</Created>`);
  lines.push(`<LastModified UTC="${modified.time}">${modified.date}</LastModified>`);
  lines.push('<SequenceClass>UNA</SequenceClass>');
  const methylation = doc.methylationProfile ?? { dam: true, dcm: true, cpg: false };
  const disabled: string[] = [];
  if (!methylation.dam) disabled.push('dam-');
  if (!methylation.dcm) disabled.push('dcm-');
  if (!methylation.cpg && disabled.length > 0) disabled.push('cpg-');
  const transformedInto = disabled.length > 0 ? disabled.join(' ') : 'unspecified';
  lines.push(`<TransformedInto>${escapeXmlText(transformedInto)}</TransformedInto>`);
  lines.push('</Notes>');
  return snapGenePacket(0x06, encodeUtf8(lines.join('')));
}

function snapGeneFeatureSegments(
  feature: SequenceFeature,
  circular: boolean,
  sequenceLength: number,
): TeselaGenLocation[] {
  const stored = featureSegmentLocations(feature, circular, sequenceLength).filter(
    (segment) =>
      segment.start >= 0 &&
      segment.end <= sequenceLength &&
      segment.start < segment.end,
  );
  if (stored.length > 0) return stored;
  if (feature.start === feature.end) return [];
  if (circular && feature.start > feature.end) {
    const segments: TeselaGenLocation[] = [];
    if (feature.start < sequenceLength) {
      segments.push({ start: feature.start, end: sequenceLength });
    }
    if (feature.end > 0) segments.push({ start: 0, end: feature.end });
    return segments;
  }
  if (feature.end < feature.start) return [];
  return [{ start: feature.start, end: feature.end }];
}

function buildSnapGeneFeatureXml(
  feature: SequenceFeature,
  circular: boolean,
  sequenceLength: number,
): string | undefined {
  const segments = snapGeneFeatureSegments(feature, circular, sequenceLength);
  if (segments.length === 0) return undefined;

  const originalType = (feature.notes?.[ORIGINAL_TYPE_NOTE] ?? feature.notes?.[LEGACY_ORIGINAL_TYPE_NOTE])?.[0]?.trim();
  const type = originalType || feature.type;
  const directionality = feature.strand === -1 ? 2 : feature.strand === 1 ? 1 : 0;
  const attributes = [
    `name="${escapeXmlAttribute(feature.name)}"`,
    `type="${escapeXmlAttribute(type)}"`,
    `directionality="${directionality}"`,
  ];
  const parts: string[] = [`<Feature ${attributes.join(' ')}>`];
  const color = normalizeColor(feature.color, DEFAULT_FEATURE_COLORS[feature.type]);
  for (const segment of segments) {
    parts.push(
      `<Segment range="${segment.start + 1}-${segment.end}" color="${escapeXmlAttribute(color)}" type="standard"/>`,
    );
  }

  const notes = feature.notes ?? {};
  let wroteCodonStart = false;
  let wroteTranslation = false;
  for (const [key, values] of Object.entries(notes)) {
    if (
      isInternalNoteKey(key) ||
      key === SEGMENTS_PUBLIC_NOTE
    ) {
      continue;
    }
    if (key === 'codon_start') wroteCodonStart = true;
    if (key === 'translation') wroteTranslation = true;
    if (!values || values.length === 0) continue;
    const qualifier = [`<Q name="${escapeXmlAttribute(key)}">`];
    for (const value of values) {
      qualifier.push(`<V text="${escapeXmlAttribute(value)}"/>`);
    }
    qualifier.push('</Q>');
    parts.push(qualifier.join(''));
  }
  if (feature.codonStart && !wroteCodonStart) {
    parts.push(`<Q name="codon_start"><V int="${feature.codonStart}"/></Q>`);
  }
  if (feature.translation && !wroteTranslation) {
    parts.push(
      `<Q name="translation"><V text="${escapeXmlAttribute(feature.translation)}"/></Q>`,
    );
  }
  parts.push('</Feature>');
  return parts.join('');
}

function buildSnapGeneFeaturesPacket(doc: PlasmidDocument, sequenceLength: number): Uint8Array {
  const circular = doc.topology === 'circular';
  const features: string[] = [];
  let featureId = 0;
  for (const feature of doc.features) {
    const xml = buildSnapGeneFeatureXml(feature, circular, sequenceLength);
    if (xml) {
      features.push(xml.replace('<Feature ', `<Feature recentID="${featureId}" `));
      featureId += 1;
    }
  }
  const xml = [
    '<?xml version="1.0"?>',
    `<Features nextValidID="${featureId}">`,
    ...features,
    '</Features>',
  ].join('');
  return snapGenePacket(0x0a, encodeUtf8(xml));
}

function buildSnapGenePrimersPacket(doc: PlasmidDocument): Uint8Array {
  const sequence = normalizeSequence(doc.sequence);
  const circular = doc.topology === 'circular';
  const primers: string[] = [];
  let primerId = 0;
  for (const primer of doc.primers) {
    if (primer.bindingStart === primer.bindingEnd || sequence.length === 0) continue;
    const bindingEnd = primer.bindingEnd === 0 ? sequence.length : primer.bindingEnd;
    const location = `${primer.bindingStart}-${bindingEnd - 1}`;
    const template = templateSlice(
      sequence,
      primer.bindingStart,
      bindingEnd,
      circular,
    );
    let annealed = primer.strand === -1 ? reverseComplement(template) : template;
    if (!annealed || !normalizeSequence(primer.sequence).endsWith(annealed)) {
      const bindingLength =
        primer.bindingEnd > primer.bindingStart
          ? primer.bindingEnd - primer.bindingStart
          : sequence.length - primer.bindingStart + primer.bindingEnd;
      annealed = primer.sequence.slice(Math.max(0, primer.sequence.length - bindingLength));
    }
    annealed = normalizeSequence(annealed);
    const boundStrand = primer.strand === -1 ? 1 : 0;
    const meltingTemperature = Number.isFinite(primer.tmAnnealing)
      ? Math.round(primer.tmAnnealing)
      : undefined;
    const siteAttributes = [
      `location="${location}"`,
      `boundStrand="${boundStrand}"`,
      ...(annealed ? [`annealedBases="${escapeXmlAttribute(annealed)}"`] : []),
      ...(meltingTemperature !== undefined ? [`meltingTemperature="${meltingTemperature}"`] : []),
    ];
    const components = annealed
      ? `<Component hybridizedRange="${location}" bases="${escapeXmlAttribute(annealed)}"/>`
      : '';
    primers.push(
      [
        `<Primer recentID="${primerId}" name="${escapeXmlAttribute(primer.name)}" sequence="${escapeXmlAttribute(primer.sequence)}">`,
        `<BindingSite ${siteAttributes.join(' ')}>${components}</BindingSite>`,
        '</Primer>',
      ].join(''),
    );
    primerId += 1;
  }
  const xml = [
    '<?xml version="1.0"?>',
    `<Primers nextValidID="${primerId}">`,
    '<HybridizationParams minContinuousMatchLen="10" allowMismatch="1" minMeltingTemperature="40"/>',
    ...primers,
    '</Primers>',
  ].join('');
  return snapGenePacket(0x05, encodeUtf8(xml));
}

function buildSnapGenePropertiesPacket(doc: PlasmidDocument): Uint8Array | undefined {
  if (!doc.linearEnds) return undefined;
  const stickiness = (type: OverhangEnd['type']): number =>
    type === '5-prime' ? 1 : type === '3-prime' ? -1 : 0;
  const modification = (end: OverhangEnd): string =>
    end.phosphorylated ? 'FivePrimePhosphorylated' : 'Unmodified';
  const xml = [
    '<AdditionalSequenceProperties>',
    `<UpstreamStickiness>${stickiness(doc.linearEnds.left.type)}</UpstreamStickiness>`,
    `<DownstreamStickiness>${stickiness(doc.linearEnds.right.type)}</DownstreamStickiness>`,
    `<UpstreamModification>${modification(doc.linearEnds.left)}</UpstreamModification>`,
    `<DownstreamModification>${modification(doc.linearEnds.right)}</DownstreamModification>`,
    '</AdditionalSequenceProperties>',
  ].join('');
  return snapGenePacket(0x08, encodeUtf8(xml));
}

function buildSnapGeneHistoryPacket(doc: PlasmidDocument): Uint8Array | undefined {
  const history = Array.isArray(doc.history) ? doc.history : [];
  if (history.length === 0) return undefined;
  const reversed = [...history].reverse();
  const ids = new Map<CloningHistoryNode, number>();
  reversed.forEach((node, index) => ids.set(node, reversed.length - 1 - index));
  const circular = doc.topology === 'circular';
  const sequenceLength = normalizeSequence(doc.sequence).length;
  const buildNode = (node: CloningHistoryNode, depth: number): string => {
    const id = ids.get(node) ?? 0;
    const child = depth + 1 < reversed.length ? reversed[depth + 1] : undefined;
    const operation = SNAP_GENE_OPERATIONS[node.operation] ?? 'replace';
    const attributes = [
      `name="${escapeXmlAttribute(doc.name)}"`,
      'type="DNA"',
      `seqLen="${sequenceLength}"`,
      'strandedness="double"',
      `ID="${id}"`,
      `circular="${circular ? 1 : 0}"`,
      ...(depth > 0 ? ['resurrectable="1"'] : []),
      `operation="${operation}"`,
      ...(node.timestamp ? [`timestamp="${escapeXmlAttribute(node.timestamp)}"`] : []),
    ];
    const parts: string[] = [`<Node ${attributes.join(' ')}>`];
    const enzymes = node.enzymesUsed ?? [];
    if (child || enzymes.length > 0) {
      const summaryAttributes = ['manipulation="insert"'];
      if (enzymes[0]) summaryAttributes.push(`name1="${escapeXmlAttribute(enzymes[0])}"`);
      if (enzymes[1]) summaryAttributes.push(`name2="${escapeXmlAttribute(enzymes[1])}"`);
      parts.push(`<InputSummary ${summaryAttributes.join(' ')}/>`);
    }
    for (const primerName of node.primersUsed ?? []) {
      const primer = doc.primers.find((item) => item.name === primerName);
      if (primer) {
        parts.push(
          `<Oligo name="${escapeXmlAttribute(primer.name)}" sequence="${escapeXmlAttribute(primer.sequence)}"/>`,
        );
      }
    }
    if (child) {
      parts.push(buildNode(child, depth + 1));
    }
    parts.push('</Node>');
    return parts.join('');
  };
  const xml = ['<HistoryTree>', buildNode(reversed[0], 0), '</HistoryTree>'].join('');
  return snapGenePacket(0x07, encodeUtf8(xml));
}

/**
 * Export a document as a SnapGene `.dna` binary file. The writer emits the
 * cookie, DNA, features, primers, notes, additional-properties and history
 * packets so that the sequence, annotations and cloning provenance survive a
 * round trip through SnapGene or this module's parser.
 */
export function exportPlasmidToSnapGene(doc: PlasmidDocument): Uint8Array {
  const sequence = normalizeSequence(doc.sequence);
  const circular = doc.topology === 'circular';
  const packets: Uint8Array[] = [
    buildSnapGeneCookie(),
    buildSnapGeneDnaPacket(sequence, circular, doc.methylationProfile),
    buildSnapGeneNotesPacket(doc),
    buildSnapGeneFeaturesPacket(doc, sequence.length),
    buildSnapGenePrimersPacket(doc),
  ];
  const properties = buildSnapGenePropertiesPacket(doc);
  if (properties) packets.push(properties);
  const history = buildSnapGeneHistoryPacket(doc);
  if (history) packets.push(history);
  return concatBytes(packets);
}

/* -------------------------------------------------------------------------- */
/* FASTQ sequencing reads                                                      */
/* -------------------------------------------------------------------------- */

function fastqSequenceIsValid(sequence: string): boolean {
  return /^[ACGTUNRYSWKMBDHVacgtunryswkmbdhv]+$/.test(sequence);
}

/**
 * Parse a FASTQ file (Phred+33 qualities). Multiple records and both
 * four-line and wrapped records are accepted. Invalid records raise an Error.
 */
export function parseFastq(text: string): SequencingRead[] {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const reads: SequencingRead[] = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === '') index += 1;
    if (index >= lines.length) break;

    const header = lines[index].trim();
    if (!header.startsWith('@')) {
      throw new Error(`Invalid FASTQ format: record ${reads.length + 1} header must start with @`);
    }
    const name = header.slice(1).trim();
    if (!name) {
      throw new Error(`Invalid FASTQ format: record ${reads.length + 1} has an empty name`);
    }
    index += 1;

    const sequenceParts: string[] = [];
    while (index < lines.length && !lines[index].startsWith('+')) {
      sequenceParts.push(lines[index].trim());
      index += 1;
    }
    if (index >= lines.length) {
      throw new Error(`Invalid FASTQ format: record "${name}" is missing the + separator`);
    }
    const sequence = sequenceParts.join('').replace(/\s+/g, '');
    if (!sequence) {
      throw new Error(`Invalid FASTQ format: record "${name}" has an empty sequence`);
    }
    if (!fastqSequenceIsValid(sequence)) {
      throw new Error(
        `Invalid FASTQ format: record "${name}" contains non-nucleotide characters`,
      );
    }
    index += 1;

    let qualityText = '';
    while (index < lines.length && qualityText.length < sequence.length) {
      qualityText += lines[index].trim();
      index += 1;
    }
    if (qualityText.length !== sequence.length) {
      throw new Error(
        `Invalid FASTQ format: record "${name}" quality length ${qualityText.length} does not match sequence length ${sequence.length}`,
      );
    }
    const qualities: number[] = [];
    for (let position = 0; position < qualityText.length; position += 1) {
      const code = qualityText.charCodeAt(position);
      if (code < 33 || code > 126) {
        throw new Error(
          `Invalid FASTQ format: record "${name}" contains a quality character outside the Phred+33 range`,
        );
      }
      qualities.push(code - 33);
    }
    reads.push({
      id: generateId('read'),
      name,
      sequence: sequence.toUpperCase(),
      qualities,
    });
  }

  if (reads.length === 0) {
    throw new Error('Invalid FASTQ format: no records found');
  }
  return reads;
}

function fastqToDocuments(text: string, fileName: string): PlasmidDocument[] {
  return parseFastq(text).map((read) =>
    normalizeParsedSequence(
      {
        name: read.name,
        sequence: read.sequence,
        circular: false,
      },
      { fileName },
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Plain text, DNASTAR and Serial Cloner format support                       */
/* -------------------------------------------------------------------------- */

function extractPlainSequence(
  text: string,
): { sequence: string; header: string } | undefined {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let best = '';
  let bestHeader = '';
  let current: string[] = [];
  let currentHeader: string[] = [];
  let headerLines: string[] = [];

  const flush = (): void => {
    const joined = current.join('');
    if (joined.length > best.length) {
      best = joined;
      bestHeader = headerLines.join(' ').trim();
    }
    current = [];
    currentHeader = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const letters = trimmed.replace(/[\s\d]/g, '');
    if (letters.length > 0 && /^[ACGTUNRYSWKMBDHVacgtunryswkmbdhv]+$/.test(letters)) {
      current.push(letters);
    } else {
      if (current.length > 0) {
        headerLines = currentHeader;
        flush();
      }
      if (trimmed && !/^\s*[#;]/.test(trimmed)) {
        currentHeader.push(trimmed);
      }
    }
  }
  if (current.length > 0) {
    headerLines = currentHeader;
    flush();
  }
  if (best.length < 4) return undefined;
  return { sequence: best.toUpperCase(), header: bestHeader };
}

/**
 * Parse the plain-text sequence layout written by DNASTAR Lasergene.
 * SeqMan/SeqBuilder files may carry a descriptive header and use a line
 * containing only `^^` to mark the start of the sequence.
 */
function parseDnastarText(text: string, fileName: string): PlasmidDocument[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const marker = lines.findIndex((line) => line.trim() === '^^');
  const headerText = marker >= 0 ? lines.slice(0, marker).join('\n') : normalized;
  const body = marker >= 0 ? lines.slice(marker + 1).join('\n') : normalized;
  const extracted = extractPlainSequence(body);
  if (!extracted) {
    throw new Error(`Unable to parse DNASTAR sequence file: ${fileName}`);
  }
  const quotedName = /"([^"\n]+)"/.exec(headerText)?.[1];
  const name = quotedName || setExtensionlessName(fileName);
  const circular = /\bcircular\b/i.test(headerText);
  return [
    normalizeParsedSequence(
      {
        name,
        sequence: extracted.sequence,
        circular,
        ...(headerText.trim() ? { description: headerText.trim() } : {}),
      },
      { fileName },
    ),
  ];
}

/*
 * Xdna reader. The binary layout follows the public description used by
 * Biopython's Bio.SeqIO.XdnaIO module (Biopython License Agreement /
 * BSD 3-Clause License) and the format notes published by incenp.org.
 */
function readPascalString(
  bytes: Uint8Array,
  offset: number,
): { value: string; next: number } {
  if (offset >= bytes.byteLength) {
    throw new Error('Invalid Xdna file: truncated Pascal string');
  }
  const length = bytes[offset];
  const start = offset + 1;
  const end = start + length;
  if (end > bytes.byteLength) {
    throw new Error('Invalid Xdna file: truncated Pascal string');
  }
  return { value: decodeAscii(bytes.subarray(start, end)), next: end };
}

function readXdnaOverhang(
  bytes: Uint8Array,
  offset: number,
): { end: OverhangEnd; next: number } {
  const text = readPascalString(bytes, offset);
  const parsed = Number.parseInt(text.value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed === 0) {
    return {
      end: { type: 'blunt', sequence: '', phosphorylated: false },
      next: text.next,
    };
  }
  const length = Math.abs(parsed);
  const start = text.next;
  const end = start + length;
  if (end > bytes.byteLength) {
    throw new Error('Invalid Xdna file: truncated overhang sequence');
  }
  return {
    end: {
      type: parsed > 0 ? '5-prime' : '3-prime',
      sequence: decodeAscii(bytes.subarray(start, end)).toUpperCase(),
      phosphorylated: false,
    },
    next: end,
  };
}

function parseXdnaColor(value: string): string {
  const [red, green, blue] = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10));
  if (
    Number.isFinite(red) &&
    Number.isFinite(green) &&
    Number.isFinite(blue)
  ) {
    return `#${[red, green, blue]
      .map((component) => clamp(component, 0, 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`;
  }
  return '#6B7280';
}

function parseXdnaFeatureDescription(
  description: string,
): { note?: string; qualifiers: Record<string, string[]> } {
  const qualifiers: Record<string, string[]> = {};
  for (const rawLine of description.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([^=]+)="([^"]*)"?$/.exec(line);
    if (match) {
      const key = match[1].trim();
      if (key) {
        if (!qualifiers[key]) qualifiers[key] = [];
        qualifiers[key].push(match[2]);
      }
    } else if (!line.includes('"')) {
      if (!qualifiers.note) qualifiers.note = [];
      qualifiers.note.push(line);
    }
  }
  return {
    ...(qualifiers.note ? { note: qualifiers.note[0] } : {}),
    qualifiers,
  };
}

function parseXdnaBuffer(
  buffer: ArrayBuffer | Uint8Array | string,
  fileName: string,
): PlasmidDocument {
  const bytes = toUint8Array(buffer);
  if (bytes.byteLength < 112) {
    throw new Error('Invalid Xdna file: header is shorter than 112 bytes');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0];
  if (version !== 0) {
    throw new Error(`Unsupported Xdna version: ${version}`);
  }
  const sequenceType = bytes[1];
  if (sequenceType < 1 || sequenceType > 4) {
    throw new Error(`Invalid Xdna file: unknown sequence type ${sequenceType}`);
  }
  if (sequenceType === 4) {
    throw new Error('Invalid Xdna file: protein Xdna documents are not DNA sequences');
  }
  const topology = bytes[2];
  const sequenceLength = view.getUint32(28, false);
  const commentLength = view.getUint32(96, false);
  const sequenceStart = 112;
  const sequenceEnd = sequenceStart + sequenceLength;
  const commentEnd = sequenceEnd + commentLength;
  if (commentEnd > bytes.byteLength) {
    throw new Error('Invalid Xdna file: truncated sequence or comment section');
  }
  const sequence = normalizeSequence(decodeAscii(bytes.subarray(sequenceStart, sequenceEnd)));
  const comment = decodeUtf8(bytes.subarray(sequenceEnd, commentEnd)).trim();
  const nameFromComment = comment.split(/\s+/)[0] ?? '';

  const features: TeselaGenFeature[] = [];
  let linearEnds: { left: OverhangEnd; right: OverhangEnd } | undefined;
  let offset = commentEnd;
  if (offset < bytes.byteLength) {
    offset += 1; // Annotation section marker.
    const right = readXdnaOverhang(bytes, offset);
    const left = readXdnaOverhang(bytes, right.next);
    offset = left.next;
    if (topology === 0) {
      linearEnds = { left: left.end, right: right.end };
    }
    if (offset >= bytes.byteLength) {
      throw new Error('Invalid Xdna file: truncated annotation section');
    }
    let featureCount = bytes[offset];
    offset += 1;
    while (featureCount > 0) {
      featureCount -= 1;
      const name = readPascalString(bytes, offset);
      const description = readPascalString(bytes, name.next);
      const type = readPascalString(bytes, description.next);
      const start = readPascalString(bytes, type.next);
      const end = readPascalString(bytes, start.next);
      offset = end.next;
      if (offset + 4 > bytes.byteLength) {
        throw new Error('Invalid Xdna file: truncated feature flags');
      }
      const flags = bytes.subarray(offset, offset + 4);
      offset += 4;
      const color = readPascalString(bytes, offset);
      offset = color.next;
      const parsed = parseXdnaFeatureDescription(description.value);
      const forward = flags[0] !== 0;
      let startValue = Number.parseInt(start.value, 10);
      let endValue = Number.parseInt(end.value, 10);
      if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) continue;
      if (!forward) {
        const swapped = startValue;
        startValue = endValue;
        endValue = swapped;
      }
      features.push({
        name: name.value || type.value || 'Feature',
        type: type.value || 'misc_feature',
        start: Math.max(0, startValue - 1),
        end: Math.max(0, endValue - 1),
        strand: forward ? 1 : -1,
        color: parseXdnaColor(color.value),
        notes: parsed.qualifiers,
      });
    }
  }

  const document = normalizeParsedSequence(
    {
      name: nameFromComment || setExtensionlessName(fileName),
      sequence,
      circular: topology === 1,
      ...(comment ? { description: comment } : {}),
      features,
    },
    { fileName },
  );
  return linearEnds ? { ...document, linearEnds } : document;
}

function isXdnaMagic(content: ArrayBuffer | string): boolean {
  if (typeof content === 'string') return false;
  const bytes = new Uint8Array(content);
  if (bytes.byteLength < 116) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0];
  const type = bytes[1];
  const topology = bytes[2];
  const length = view.getUint32(28, false);
  const commentLength = view.getUint32(96, false);
  return (
    version === 0 &&
    type >= 1 &&
    type <= 4 &&
    topology <= 1 &&
    length > 0 &&
    112 + length + commentLength <= bytes.byteLength
  );
}

/* -------------------------------------------------------------------------- */
/* XML sequence formats                                                        */
/* -------------------------------------------------------------------------- */

function stripXmlNamespacePrefixes(xml: string): string {
  return xml.replace(/<(\/?)([A-Za-z_][\w.-]*):/g, '<$1');
}

function parseSbolText(text: string, fileName: string): PlasmidDocument[] {
  let root: XmlNode;
  try {
    root = parseXml(text);
  } catch {
    return [];
  }
  const components =
    xmlLocalName(root.tag) === 'DnaComponent'
      ? [root]
      : xmlDescendantsLocal(root, 'DnaComponent');
  if (components.length === 0) return [];
  const documents: PlasmidDocument[] = [];
  for (const component of components) {
    const dnaSequence = xmlDescendantsLocal(component, 'DnaSequence')[0];
    const nucleotides =
      xmlChildTextLocal(dnaSequence, 'nucleotides') ??
      xmlChildTextLocal(component, 'nucleotides') ??
      xmlFirstTextLocal(component, 'elements');
    if (!nucleotides) continue;
    const name =
      xmlChildTextLocal(component, 'name') ??
      xmlChildTextLocal(component, 'displayId') ??
      setExtensionlessName(fileName);
    const features: TeselaGenFeature[] = [];
    for (const annotation of xmlDescendantsLocal(component, 'SequenceAnnotation')) {
      const start = Number.parseInt(
        xmlChildTextLocal(annotation, 'bioStart') ??
          annotation.attrs.bioStart ??
          xmlChildTextLocal(annotation, 'start') ??
          annotation.attrs.start ??
          '',
        10,
      );
      const end = Number.parseInt(
        xmlChildTextLocal(annotation, 'bioEnd') ??
          annotation.attrs.bioEnd ??
          xmlChildTextLocal(annotation, 'end') ??
          annotation.attrs.end ??
          '',
        10,
      );
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      const strandText = (
        xmlChildTextLocal(annotation, 'strand') ??
        annotation.attrs.strand ??
        '+'
      ).trim();
      const notes: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(annotation.attrs)) {
        if (/about$|resource$|label$/i.test(key) && value) notes.about = [value];
      }
      const label =
        xmlChildTextLocal(annotation, 'name') ??
        xmlChildTextLocal(annotation, 'displayId') ??
        notes.about?.[0];
      features.push({
        name: label || 'SBOL feature',
        type: 'misc_feature',
        start: Math.max(0, start - 1),
        end: Math.max(0, Math.max(start, end) - 1),
        strand: strandText === '-' ? -1 : 1,
        color: DEFAULT_FEATURE_COLORS.misc_feature,
        ...(Object.keys(notes).length > 0 ? { notes } : {}),
      });
    }
    documents.push(
      normalizeParsedSequence(
        {
          name,
          sequence: nucleotides,
          circular: false,
          features,
        },
        { fileName },
      ),
    );
  }
  return documents;
}

async function parseXmlSequenceText(
  text: string,
  fileName: string,
  extension: string,
): Promise<PlasmidDocument[]> {
  if (/<geneious|geneiousDocument/i.test(text)) {
    const results = (await geneiousXmlToJson(text, {})) as TeselaGenParseResult[];
    return teselaGenResultsToDocuments(results, { fileName });
  }
  const sbolLike = /DnaComponent|<sbol|<rdf:RDF|<SBOL/i.test(text);
  if (sbolLike || extension === 'sbol' || extension === 'rdf') {
    const direct = parseSbolText(text, fileName);
    if (direct.length > 0) return direct;
    let results = (await sbolXmlToJson(text, {})) as TeselaGenParseResult[];
    let documents = teselaGenResultsToDocuments(results, { fileName });
    if (documents.length === 0) {
      const stripped = stripXmlNamespacePrefixes(text);
      results = (await sbolXmlToJson(stripped, {})) as TeselaGenParseResult[];
      documents = teselaGenResultsToDocuments(results, { fileName });
    }
    if (documents.length > 0) return documents;
  }
  try {
    const results = (await anyToJson(text, { fileName })) as TeselaGenParseResult[];
    const documents = teselaGenResultsToDocuments(results, { fileName });
    if (documents.length > 0) return documents;
  } catch {
    // Fall through to the descriptive error below.
  }
  throw new Error(`Unable to parse XML sequence file: ${fileName}`);
}

/* -------------------------------------------------------------------------- */
/* Protein files                                                               */
/* -------------------------------------------------------------------------- */

interface FlatFileFeature {
  type: string;
  location: string;
  qualifiers: Record<string, string[]>;
}

interface FlatFileRecord {
  locus: string;
  declaredLength?: number;
  molecule?: string;
  definition?: string;
  accession?: string;
  features: FlatFileFeature[];
  sequence: string;
}

const PROTEIN_COLORS: Record<string, string> = {
  CDS: '#EF4444',
  Region: '#8B5CF6',
  domain: '#8B5CF6',
  Domain: '#8B5CF6',
  motif: '#10B981',
  Motif: '#10B981',
  signal_peptide: '#F59E0B',
  transit_peptide: '#F59E0B',
  chain: '#3B82F6',
  propeptide: '#0EA5E9',
  misc_feature: '#6B7280',
};

function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

interface LocationPart {
  start: number;
  end: number;
  strand: 1 | -1;
}

function parseLocationParts(location: string, strand: 1 | -1 = 1): LocationPart[] {
  const value = location.replace(/\s+/g, '');
  const complement = /^complement\((.*)\)$/i.exec(value);
  if (complement) {
    return parseLocationParts(complement[1], strand === 1 ? -1 : 1);
  }
  const group = /^(?:join|order)\((.*)\)$/i.exec(value);
  if (group) {
    return splitTopLevelCommas(group[1]).flatMap((part) =>
      parseLocationParts(part, strand),
    );
  }
  const cleaned = value.replace(/^[<>]/, '').replace(/[<>]$/, '');
  const range = /^(\d+)(?:\^(\d+)|\.\.(\d+))?$/.exec(cleaned);
  if (!range) return [];
  const startOneBased = Number(range[1]);
  const endOneBased = Number(range[3] ?? range[2] ?? range[1]);
  if (!Number.isFinite(startOneBased) || !Number.isFinite(endOneBased)) return [];
  const start = Math.max(0, Math.min(startOneBased, endOneBased) - 1);
  const end = Math.max(startOneBased, endOneBased);
  return [{ start, end, strand }];
}

function collectFlatFileField(
  lines: string[],
  startIndex: number,
  keyword: string,
): { value: string; next: number } {
  const first = lines[startIndex];
  let value = first.slice(keyword.length).trim();
  let index = startIndex + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\S/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed) break;
    value += ` ${trimmed}`;
    index += 1;
  }
  return { value: value.trim(), next: index };
}

function parseFlatFileRecords(text: string): FlatFileRecord[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const chunks = normalized
    .split(/^\/\/\s*$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  const records: FlatFileRecord[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const locusLine = lines.find((line) => /^\s*LOCUS\s/i.test(line));
    if (!locusLine) continue;
    const locusMatch = /^\s*LOCUS\s+(\S+)(?:\s+(\d+)\s+(\S+))?/i.exec(locusLine);
    const locus = locusMatch?.[1] ?? 'Protein';
    const declaredLength = locusMatch?.[2] ? Number(locusMatch[2]) : undefined;
    const molecule = locusMatch?.[3];
    let definition: string | undefined;
    let accession: string | undefined;
    for (let index = 0; index < lines.length; index += 1) {
      if (/^DEFINITION\s/i.test(lines[index])) {
        definition = collectFlatFileField(lines, index, 'DEFINITION').value;
      } else if (/^VERSION\s/i.test(lines[index])) {
        accession = lines[index].slice(7).trim().split(/\s+/)[0];
      } else if (/^ACCESSION\s/i.test(lines[index]) && !accession) {
        accession = lines[index].slice(9).trim().split(/\s+/)[0];
      }
    }

    const features: FlatFileFeature[] = [];
    const featuresIndex = lines.findIndex((line) => /^FEATURES\s/i.test(line));
    if (featuresIndex >= 0) {
      let current: FlatFileFeature | undefined;
      let currentQualifier: { key: string; values: string[] } | undefined;
      let lastWasLocation = false;
      let inQuotedValue = false;
      let quotedBuffer = '';
      for (let index = featuresIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^(ORIGIN|CONTIG|BASE COUNT|WGS|WGS_SCAFLD)\b/i.test(line.trim())) break;
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (inQuotedValue) {
          quotedBuffer += ` ${trimmed}`;
          if (trimmed.endsWith('"')) {
            inQuotedValue = false;
            const value = quotedBuffer.replace(/"\s*$/, '').replace(/^"/, '');
            if (current && currentQualifier) {
              currentQualifier.values.push(value);
              current.qualifiers[currentQualifier.key] = currentQualifier.values;
            }
            currentQualifier = undefined;
            quotedBuffer = '';
          }
          continue;
        }
        if (trimmed.startsWith('/')) {
          const qualifier = /^\/([^\s=]+)(?:=(.*))?$/.exec(trimmed);
          if (!qualifier || !current) continue;
          const key = qualifier[1];
          let value = (qualifier[2] ?? '').trim();
          if (value.startsWith('"')) {
            if (value.length > 1 && value.endsWith('"') && !value.endsWith('\\"')) {
              value = value.slice(1, -1);
              if (!current.qualifiers[key]) current.qualifiers[key] = [];
              current.qualifiers[key].push(value);
              currentQualifier = undefined;
            } else {
              quotedBuffer = value;
              currentQualifier = { key, values: current.qualifiers[key] ?? [] };
              inQuotedValue = true;
            }
          } else {
            if (!current.qualifiers[key]) current.qualifiers[key] = [];
            current.qualifiers[key].push(value.replace(/^"|"$/g, ''));
            currentQualifier = undefined;
          }
          lastWasLocation = false;
          continue;
        }
        const featureLine = /^ {5}(\S+)\s+(.+)$/.exec(line);
        if (featureLine && !line.startsWith(' '.repeat(21))) {
          current = {
            type: featureLine[1],
            location: featureLine[2].trim(),
            qualifiers: {},
          };
          features.push(current);
          lastWasLocation = true;
          continue;
        }
        if (current && lastWasLocation && !trimmed.startsWith('/')) {
          current.location += trimmed;
          continue;
        }
        if (current && currentQualifier) {
          currentQualifier.values.push(trimmed);
          continue;
        }
      }
      if (inQuotedValue && current && currentQualifier) {
        current.qualifiers[currentQualifier.key] = currentQualifier.values;
      }
    }

    const originIndex = lines.findIndex((line) => /^ORIGIN\b/i.test(line));
    let sequence = '';
    if (originIndex >= 0) {
      for (let index = originIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\/\//.test(line.trim())) break;
        sequence += line.replace(/[^A-Za-z*]/g, '');
      }
    }
    records.push({
      locus,
      declaredLength,
      molecule,
      ...(definition ? { definition } : {}),
      ...(accession ? { accession } : {}),
      features,
      sequence: sequence.toUpperCase(),
    });
  }
  return records;
}

function proteinFeatureName(
  feature: FlatFileFeature,
  fallbackType: string,
): string {
  for (const key of ['label', 'gene', 'product', 'region_name', 'note']) {
    const value = feature.qualifiers[key]?.[0];
    if (value) return value;
  }
  return fallbackType;
}

function proteinFeatureColor(feature: FlatFileFeature, type: string): string {
  const fromQualifier = normalizeColor(feature.qualifiers.color?.[0], '');
  if (fromQualifier) return fromQualifier;
  const colorNote = feature.qualifiers.note?.join(' ');
  const match = colorNote ? /color:\s*(#[0-9a-fA-F]{3,8})/.exec(colorNote) : undefined;
  if (match) return normalizeColor(match[1], '#6B7280');
  return PROTEIN_COLORS[type] ?? PROTEIN_COLORS[type.toLowerCase()] ?? '#6B7280';
}

function makeProteinFeature(
  rawType: string,
  location: string,
  qualifiers: Record<string, string[]>,
  fallbackName?: string,
): ProteinFeature | undefined {
  const parts = parseLocationParts(location);
  if (parts.length === 0) return undefined;
  const starts = parts.map((part) => part.start);
  const ends = parts.map((part) => part.end);
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  const type = rawType || 'misc_feature';
  const notes: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(qualifiers)) {
    const cleaned = values.filter((value) => value !== undefined && value !== '');
    if (cleaned.length > 0) notes[key] = cleaned;
  }
  if (parts.length > 1) {
    const strand = parts.some((part) => part.strand === -1) ? -1 : 1;
    const ordered = strand === -1 ? [...parts].reverse() : parts;
    notes[SEGMENTS_PUBLIC_NOTE] = ordered.map((part) => `${part.start}-${part.end}`);
  }
  if (parts.some((part) => part.strand === -1)) notes.strand = ['-1'];
  const feature: ProteinFeature = {
    id: generateId('protein_feature'),
    name: fallbackName || proteinFeatureName({ type, location, qualifiers }, type),
    type,
    start,
    end,
    color: proteinFeatureColor({ type, location, qualifiers }, type),
    ...(Object.keys(notes).length > 0 ? { notes } : {}),
  };
  return feature;
}

function parseGenPeptText(text: string, fileName: string): ProteinDocument[] {
  const records = parseFlatFileRecords(text);
  if (records.length === 0) {
    throw new Error(`Unable to parse protein flat file: ${fileName}`);
  }
  const documents: ProteinDocument[] = [];
  const now = nowIso();
  for (const record of records) {
    const features: ProteinFeature[] = [];
    for (const feature of record.features) {
      const converted = makeProteinFeature(
        feature.type,
        feature.location,
        feature.qualifiers,
      );
      if (converted) features.push(converted);
    }
    const sequence = record.sequence.replace(/[^A-Z*]/g, '');
    documents.push({
      id: generateId('protein'),
      name: record.locus || record.accession || setExtensionlessName(fileName) || 'Protein',
      sequence,
      ...(record.definition ? { description: record.definition } : {}),
      features,
      createdAt: now,
      updatedAt: now,
    });
  }
  return documents;
}

function parseProteinFastaText(text: string, fileName: string): ProteinDocument[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const documents: ProteinDocument[] = [];
  const now = nowIso();
  let current: { name: string; description: string; chunks: string[] } | undefined;
  const flush = (): void => {
    if (!current) return;
    const sequence = current.chunks.join('').replace(/[^A-Za-z*]/g, '').toUpperCase();
    if (sequence.length > 0) {
      documents.push({
        id: generateId('protein'),
        name: current.name || setExtensionlessName(fileName) || 'Protein',
        sequence,
        ...(current.description ? { description: current.description } : {}),
        features: [],
        createdAt: now,
        updatedAt: now,
      });
    }
    current = undefined;
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) {
      flush();
      const header = trimmed.slice(1).trim();
      const [name, ...rest] = header.split(/\s+/);
      current = {
        name: name || setExtensionlessName(fileName) || 'Protein',
        description: rest.join(' '),
        chunks: [],
      };
    } else if (current && trimmed) {
      current.chunks.push(trimmed);
    }
  }
  flush();
  if (documents.length === 0) {
    throw new Error(`Unable to parse protein FASTA file: ${fileName}`);
  }
  return documents;
}

function parseSnapGeneProteinFeatures(
  xml: string,
  sequenceLength: number,
): ProteinFeature[] {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch {
    return [];
  }
  const featureNodes = root.tag === 'Feature' ? [root] : xmlChildren(root, 'Feature');
  const features: ProteinFeature[] = [];
  for (const node of featureNodes) {
    const notes: Record<string, string[]> = {};
    for (const qualifier of xmlChildren(node, 'Q')) {
      const key = qualifier.attrs.name;
      if (!key || isInternalNoteKey(key) || key === SEGMENTS_PUBLIC_NOTE) continue;
      const values = xmlValue(qualifier).map((value) => stripHtml(value));
      if (values.length > 0) notes[key] = values;
    }
    const segments = xmlChildren(node, 'Segment')
      .filter((segment) => segment.attrs.type !== 'gap')
      .map((segment) => /^(-?\d+)-(-?\d+)$/.exec(segment.attrs.range ?? ''))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => ({
        start: Math.max(0, Number(match[1]) - 1),
        end: Math.min(sequenceLength, Number(match[2])),
      }))
      .filter((segment) => segment.start < segment.end);
    if (segments.length === 0) continue;
    const directionality = Number.parseInt(node.attrs.directionality ?? '1', 10);
    const strand: 1 | -1 = directionality === 2 ? -1 : 1;
    const ordered = strand === -1 ? [...segments].reverse() : segments;
    if (segments.length > 1) {
      notes[SEGMENTS_PUBLIC_NOTE] = ordered.map(
        (segment) => `${segment.start}-${segment.end}`,
      );
    }
    if (strand === -1) notes.strand = ['-1'];
    let color = '';
    for (const segment of xmlChildren(node, 'Segment')) {
      if (segment.attrs.color) {
        color = segment.attrs.color;
        break;
      }
    }
    const rawType = node.attrs.type?.trim() || 'misc_feature';
    features.push({
      id: generateId('protein_feature'),
      name: node.attrs.name?.trim() || notes.label?.[0] || rawType,
      type: rawType,
      start: Math.min(...segments.map((segment) => segment.start)),
      end: Math.max(...segments.map((segment) => segment.end)),
      color: normalizeColor(
        color || notes.color?.[0],
        PROTEIN_COLORS[rawType] ?? '#6B7280',
      ),
      ...(Object.keys(notes).length > 0 ? { notes } : {}),
    });
  }
  return features;
}

function parseSnapGeneProteinBuffer(
  buffer: ArrayBuffer | Uint8Array | string,
  fileName: string,
): ProteinDocument[] {
  const bytes = toUint8Array(buffer);
  let packets: SnapGenePacket[];
  try {
    packets = readPackets(bytes);
    validateSnapGeneCookie(packets);
  } catch (error) {
    throw new Error(
      `Invalid SnapGene protein file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const cookie = packets[0].data;
  const sequenceType = new DataView(
    cookie.buffer,
    cookie.byteOffset,
    cookie.byteLength,
  ).getUint16(8, false);

  let sequence = '';
  for (const packet of packets) {
    if (packet.type === 0x15) {
      if (packet.data.byteLength === 0) continue;
      sequence = normalizeProteinSequence(decodeAscii(packet.data.subarray(1)));
      break;
    }
  }
  if (!sequence && sequenceType !== 1 && sequenceType !== 7) {
    const dnaPacket = packets.find((packet) => packet.type === 0x00);
    if (dnaPacket && dnaPacket.data.byteLength > 1) {
      sequence = normalizeProteinSequence(decodeAscii(dnaPacket.data.subarray(1)));
    }
  }
  if (!sequence) {
    if (sequenceType !== 2) {
      throw new Error('Invalid protein file: the SnapGene cookie declares a DNA sequence');
    }
    throw new Error('Invalid SnapGene protein file: missing protein sequence packet');
  }

  let notes: SnapGeneNotes = {};
  for (const packet of packets) {
    if (packet.type === 0x06) notes = parseSnapGeneNotes(decodeUtf8(packet.data), notes);
  }
  const features: ProteinFeature[] = [];
  for (const packet of packets) {
    if (packet.type === 0x0a) {
      features.push(...parseSnapGeneProteinFeatures(decodeUtf8(packet.data), sequence.length));
    }
  }
  const now = nowIso();
  return [
    {
      id: generateId('protein'),
      name: notes.name || setExtensionlessName(fileName) || 'Protein',
      sequence,
      ...(notes.description ? { description: notes.description } : {}),
      features,
      createdAt: notes.createdAt ?? now,
      updatedAt: notes.updatedAt ?? notes.createdAt ?? now,
    },
  ];
}

/**
 * Parse a protein file. SnapGene `.prot`, GenPept/GenBank protein flat files
 * and protein FASTA are supported. The returned documents use amino-acid
 * coordinates in the global 0-based, half-open convention.
 */
export async function parseProteinFile(
  fileName: string,
  data: string | ArrayBuffer,
): Promise<ProteinDocument[]> {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const extension = baseName.includes('.')
    ? baseName.slice(baseName.lastIndexOf('.') + 1).toLowerCase()
    : '';
  const bytes = toUint8Array(data);
  const hasSnapGeneMagic =
    bytes.byteLength >= 13 &&
    bytes[0] === 0x09 &&
    decodeAscii(bytes.subarray(5, 13)) === 'SnapGene';

  if (hasSnapGeneMagic) {
    return parseSnapGeneProteinBuffer(bytes, fileName);
  }

  const text =
    typeof data === 'string'
      ? data.replace(/^\uFEFF/, '')
      : decodeUtf8(bytes).replace(/^\uFEFF/, '');
  const trimmed = text.trim();

  if (/^LOCUS\s/i.test(trimmed)) {
    const locusLine = /^LOCUS[^\n]*/i.exec(trimmed)?.[0] ?? '';
    const isProteinLocus = /\b(aa|protein)\b/i.test(locusLine);
    if (!isProteinLocus && extension !== 'gp' && extension !== 'genpept' && extension !== 'genep') {
      throw new Error(`Not a protein flat file: ${fileName}`);
    }
    return parseGenPeptText(text, fileName);
  }

  if (trimmed.startsWith('>')) {
    return parseProteinFastaText(text, fileName);
  }

  if (extension === 'prot') {
    throw new Error(`Invalid SnapGene protein file: ${fileName}`);
  }

  if (/^[A-Za-z*.\s\d-]+$/.test(trimmed) && /[A-Za-z]/.test(trimmed)) {
    const sequence = trimmed.replace(/[^A-Za-z*]/g, '').toUpperCase();
    if (sequence.length > 0) {
      const now = nowIso();
      return [
        {
          id: generateId('protein'),
          name: setExtensionlessName(fileName) || 'Protein',
          sequence,
          features: [],
          createdAt: now,
          updatedAt: now,
        },
      ];
    }
  }

  throw new Error(`Unsupported protein file: ${fileName}`);
}

/**
 * Decide whether a file should be routed to the protein importer. The
 * extension, the SnapGene cookie sequence type, the GenBank LOCUS molecule
 * type and the sequence alphabet are all considered.
 */
export function isProteinFile(fileName: string, data: string | ArrayBuffer): boolean {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const extension = baseName.includes('.')
    ? baseName.slice(baseName.lastIndexOf('.') + 1).toLowerCase()
    : '';
  if (
    extension === 'prot' ||
    extension === 'gp' ||
    extension === 'genpept' ||
    extension === 'genep' ||
    extension === 'faa' ||
    extension === 'pep' ||
    extension === 'protein' ||
    extension === 'pro'
  ) {
    return true;
  }
  const bytes = toUint8Array(data);
  if (
    bytes.byteLength >= 13 &&
    bytes[0] === 0x09 &&
    decodeAscii(bytes.subarray(5, 13)) === 'SnapGene'
  ) {
    const cookie = bytes.subarray(5, 19);
    if (cookie.byteLength >= 10) {
      const sequenceType = new DataView(
        cookie.buffer,
        cookie.byteOffset,
        cookie.byteLength,
      ).getUint16(8, false);
      return sequenceType === 2;
    }
    return false;
  }
  const text =
    typeof data === 'string'
      ? data.replace(/^\uFEFF/, '')
      : decodeUtf8(bytes).replace(/^\uFEFF/, '');
  const locus = /^\s*LOCUS[^\n]*/im.exec(text)?.[0];
  if (locus) return /\b(aa|protein)\b/i.test(locus);
  const sequence = text
    .replace(/^>.*$/gm, '')
    .replace(/[^A-Za-z*]/g, '')
    .toUpperCase();
  if (/[EFIJLOPQZX*]/.test(sequence)) return true;
  if (sequence.length < 4) return false;
  const nonDna = sequence.replace(/[ACGTUNRYSWKMBDHV]/g, '').length;
  return sequence.length >= 20 && nonDna / sequence.length > 0.15;
}

function formatFastaSequence(sequence: string, width = 60): string {
  const chunks: string[] = [];
  for (let index = 0; index < sequence.length; index += width) {
    chunks.push(sequence.slice(index, index + width));
  }
  return chunks.join('\n');
}

/** Export a protein document as FASTA. */
export function exportProteinToFasta(protein: ProteinDocument): string {
  const header = protein.description?.trim()
    ? `>${protein.name} ${protein.description.replace(/\s+/g, ' ').trim()}`
    : `>${protein.name}`;
  const sequence = protein.sequence.replace(/[^A-Za-z*]/g, '').toUpperCase();
  return `${header}\n${formatFastaSequence(sequence)}\n`;
}

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

function flatFileDate(iso: string): string {
  const parsed = new Date(iso);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${day}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function wrapFlatFileLine(prefix: string, value: string, width = 68): string[] {
  const lines: string[] = [];
  let remaining = value.replace(/\s+/g, ' ').trim();
  if (!remaining) return lines;
  while (remaining.length > width) {
    let cut = remaining.lastIndexOf(' ', width);
    if (cut <= 0) cut = width;
    lines.push(prefix + remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  lines.push(prefix + remaining);
  return lines;
}

function proteinFeatureLocation(feature: ProteinFeature): string {
  const segments = parseSegmentNoteValues(feature.notes?.[SEGMENTS_PUBLIC_NOTE]);
  if (segments.length === 0) segments.push({ start: feature.start, end: feature.end });
  const strand = feature.notes?.strand?.[0] === '-1' ? -1 : 1;
  const ordered = strand === -1 ? [...segments].reverse() : segments;
  const locationText = ordered
    .map((segment) => `${segment.start + 1}..${Math.max(segment.start + 1, segment.end)}`)
    .join(',');
  const joined = ordered.length > 1 ? `join(${locationText})` : locationText;
  return strand === -1 ? `complement(${joined})` : joined;
}

/** Export a protein document as GenPept/GenBank protein flat file text. */
export function exportProteinToGenPept(protein: ProteinDocument): string {
  const sequence = protein.sequence.replace(/[^A-Za-z*]/g, '').toUpperCase();
  const name = protein.name.replace(/\s+/g, '_').slice(0, 16) || 'Protein';
  const lines: string[] = [
    `LOCUS       ${name.padEnd(16)} ${String(sequence.length).padStart(7)} aa            linear   UNK ${flatFileDate(protein.updatedAt)}`,
  ];
  if (protein.description?.trim()) {
    lines.push(...wrapFlatFileLine('DEFINITION  ', protein.description));
  }
  lines.push('FEATURES             Location/Qualifiers');
  for (const feature of protein.features) {
    const location = proteinFeatureLocation(feature);
    const type = (feature.type || 'misc_feature').replace(/\s+/g, '_');
    lines.push(`     ${type.padEnd(16)}${location}`);
    lines.push(`                     /label="${feature.name.replace(/"/g, "'")}"`);
    for (const [key, values] of Object.entries(feature.notes ?? {})) {
      if (
        isInternalNoteKey(key) ||
        key === SEGMENTS_PUBLIC_NOTE ||
        key === 'label' ||
        key === 'strand'
      ) {
        continue;
      }
      for (const value of values) {
        if (value === undefined || value === null || value === '') continue;
        lines.push(`                     /${key}="${String(value).replace(/"/g, "'")}"`);
      }
    }
    lines.push(`                     /note="color: ${feature.color}"`);
  }
  lines.push('ORIGIN');
  for (let offset = 0; offset < sequence.length; offset += 60) {
    const block = sequence.slice(offset, offset + 60);
    const groups: string[] = [];
    for (let index = 0; index < block.length; index += 10) {
      groups.push(block.slice(index, index + 10).toLowerCase());
    }
    lines.push(`${String(offset + 1).padStart(9)} ${groups.join(' ')}`);
  }
  lines.push('//', '');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* NCBI E-utilities import                                                     */
/* -------------------------------------------------------------------------- */

const NCBI_MAX_SEQUENCE_LENGTH = 5_000_000;

const PROTEIN_ACCESSION_PATTERNS: RegExp[] = [
  /^(?:NP|XP|WP|YP|AP|ZP)_\d+(?:\.\d+)?$/i,
  /^[A-Z]{3}\d{5}(?:\.\d+)?$/i,
  /^[A-Z]{3}_\d{5,}(?:\.\d+)?$/i,
];

const DNA_ACCESSION_PATTERNS: RegExp[] = [
  /^[A-Z]{1,2}_?\d{5,9}(?:\.\d+)?$/i,
  /^(?:NZ|NC|NT|NW)_[A-Z]{2}_?\d{6,}(?:\.\d+)?$/i,
  /^[A-Z]{4,6}\d{6,}(?:\.\d+)?$/i,
];

function accessionFromInput(input: string): { accession: string; hint?: 'nuccore' | 'protein' } | null {
  const raw = input.trim();
  if (!raw) return null;
  let candidate = raw;
  let hint: 'nuccore' | 'protein' | undefined;

  const urlMatch = /ncbi\.nlm\.nih\.gov\/(nuccore|nucleotide|protein|genbank|sviewer|nucest|nucgss)\/([^/?#\s]+)/i.exec(
    raw,
  );
  if (urlMatch) {
    hint = /protein/i.test(urlMatch[1]) ? 'protein' : 'nuccore';
    candidate = decodeURIComponent(urlMatch[2]);
  } else {
    try {
      const url = new URL(raw);
      const id = url.searchParams.get('id') ?? url.searchParams.get('acc');
      if (id) {
        candidate = id;
        if (/protein/i.test(url.pathname) || url.searchParams.get('db') === 'protein') {
          hint = 'protein';
        } else if (/nuccore|nucleotide/i.test(url.pathname) || url.searchParams.get('db') === 'nuccore') {
          hint = 'nuccore';
        }
      } else {
        const segments = url.pathname.split('/').filter(Boolean);
        candidate = segments[segments.length - 1] ?? raw;
        if (/protein/i.test(url.pathname)) hint = 'protein';
      }
    } catch {
      // Not a URL; treat the input as a bare accession below.
    }
  }

  candidate = candidate.split('|').filter(Boolean).pop() ?? candidate;
  const queryId = /[?&](?:id|acc)=([^&#\s]+)/i.exec(raw)?.[1];
  if (queryId && !/\d/.test(candidate)) {
    candidate = decodeURIComponent(queryId);
  }
  if (!hint) {
    if (/[?&]db=protein\b/i.test(raw) || /\/protein\//i.test(raw)) hint = 'protein';
    else if (/[?&]db=nuccore\b/i.test(raw) || /\/nuccore\//i.test(raw)) hint = 'nuccore';
  }
  candidate = candidate
    .replace(/[.,;]+$/, '')
    .replace(/^accession[:#\s]*/i, '')
    .trim();
  if (!/^[A-Za-z0-9_.]+$/.test(candidate)) return null;
  if (!/\d/.test(candidate)) return null;
  const accession = candidate.toUpperCase();

  if (hint === 'protein') return { accession, hint };
  if (PROTEIN_ACCESSION_PATTERNS.some((pattern) => pattern.test(accession))) {
    return { accession, hint: 'protein' };
  }
  if (DNA_ACCESSION_PATTERNS.some((pattern) => pattern.test(accession))) {
    return { accession, hint: 'nuccore' };
  }
  return null;
}

/**
 * Normalise an accession or an NCBI web URL into a bare accession and the
 * database that should be queried.
 */
export function normalizeAccession(
  input: string,
): { accession: string; db: 'nuccore' | 'protein' } | null {
  if (typeof input !== 'string') return null;
  const parsed = accessionFromInput(input);
  if (!parsed) return null;
  const db = parsed.hint ?? 'nuccore';
  return { accession: parsed.accession, db };
}

function ncbiFailureMessage(accession: string, status: number, body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (
    status === 400 ||
    status === 404 ||
    /cannot get|not found|invalid accession|no items found|error reading/i.test(compact)
  ) {
    return `NCBI accession not found: ${accession}`;
  }
  return `NCBI request failed for ${accession} (HTTP ${status})${compact ? `: ${compact.slice(0, 200)}` : ''}`;
}

/**
 * Fetch a nucleotide or protein record from NCBI using the EFetch endpoint.
 * The response is parsed with this module's GenBank/protein parsers.
 */
export async function fetchFromNCBI(
  accession: string,
  opts: {
    db?: 'nuccore' | 'protein';
    fetchImpl?: typeof fetch;
    apiKey?: string;
  } = {},
): Promise<PlasmidDocument | ProteinDocument> {
  const normalized = normalizeAccession(accession);
  if (!normalized) {
    throw new Error(`Invalid NCBI accession: ${accession}`);
  }
  const db = opts.db ?? normalized.db;
  const id = normalized.accession;
  const fetchImpl =
    opts.fetchImpl ??
    (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  if (!fetchImpl) {
    throw new Error('NCBI import is unavailable: no fetch implementation was provided');
  }

  const parameters = new URLSearchParams({
    db,
    id,
    rettype: db === 'protein' ? 'gp' : 'gbwithparts',
    retmode: 'text',
  });
  if (opts.apiKey) parameters.set('api_key', opts.apiKey);
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${parameters.toString()}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'text/plain' },
    });
  } catch (error) {
    throw new Error(
      `NCBI network error while fetching ${id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const status = typeof response.status === 'number' ? response.status : 200;
  if (response.ok === false || status >= 400) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    throw new Error(ncbiFailureMessage(id, status, body));
  }
  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    throw new Error(
      `NCBI network error while reading ${id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!text.trim()) {
    throw new Error(`NCBI accession not found: ${id}`);
  }
  if (!/^\s*LOCUS\s/im.test(text)) {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (/cannot get|not found|error|invalid|no items/i.test(compact)) {
      throw new Error(`NCBI accession not found: ${id}`);
    }
    throw new Error(`NCBI returned an invalid record for ${id}: ${compact.slice(0, 200)}`);
  }

  const locusLine = /^\s*LOCUS[^\n]*/im.exec(text)?.[0] ?? '';
  const declaredLength = Number(/\b(\d+)\s+(?:bp|aa)\b/i.exec(locusLine)?.[1] ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > NCBI_MAX_SEQUENCE_LENGTH) {
    throw new Error(
      `NCBI sequence ${id} exceeds the 5 Mb limit (${declaredLength} ${db === 'protein' ? 'aa' : 'bp'})`,
    );
  }

  if (db === 'protein') {
    const proteins = await parseProteinFile(`${id}.gp`, text);
    const protein = proteins[0];
    if (!protein) throw new Error(`NCBI accession not found: ${id}`);
    if (protein.sequence.length > NCBI_MAX_SEQUENCE_LENGTH) {
      throw new Error(
        `NCBI sequence ${id} exceeds the 5 Mb limit (${protein.sequence.length} aa)`,
      );
    }
    return protein;
  }

  const document = await parseGenBankString(text);
  if (document.sequence.length > NCBI_MAX_SEQUENCE_LENGTH) {
    throw new Error(
      `NCBI sequence ${id} exceeds the 5 Mb limit (${document.sequence.length} bp)`,
    );
  }
  return document;
}



/**
 * Enrich a parsed SnapGene document with the data carried by SnapGene's
 * proprietary TLV packets (primers, features, notes and cloning history).
 * The parser works directly on the binary packet stream and never mutates
 * the supplied document.
 */
export function enrichSnapGeneBinary(
  buffer: ArrayBuffer | Uint8Array,
  baseDoc: PlasmidDocument,
): PlasmidDocument {
  const packets = readPackets(buffer);
  validateSnapGeneCookie(packets);
  const dna = findSnapGeneDnaPacket(packets);
  const sequence = dna.sequence.length > 0 ? dna.sequence : baseDoc.sequence;
  const circular = baseDoc.topology === 'circular' || dna.circular;
  const length = sequence.length;
  const linearEnds = circular ? undefined : parseSnapGeneLinearEnds(packets);
  let doc: PlasmidDocument = {
    ...baseDoc,
    sequence,
    topology: circular ? 'circular' : 'linear',
    length,
    ...(linearEnds ? { linearEnds } : {}),
  };

  const features: SequenceFeature[] = [];
  const primers: Primer[] = [];
  let notes: SnapGeneNotes = {};
  for (const packet of packets) {
    if (packet.type === 0x06) notes = parseSnapGeneNotes(decodeUtf8(packet.data), notes);
    if (packet.type === 0x0a) {
      features.push(...parseSnapGeneFeatures(decodeUtf8(packet.data), length, circular));
    }
    if (packet.type === 0x05) {
      primers.push(...parseSnapGenePrimers(decodeUtf8(packet.data), sequence, circular));
    }
  }

  doc = applySnapGeneFeatures(doc, features);
  doc = applySnapGenePrimers(doc, primers);
  if (notes.createdAt || notes.updatedAt) {
    doc = {
      ...doc,
      createdAt: notes.createdAt ?? doc.createdAt,
      updatedAt: notes.updatedAt ?? notes.createdAt ?? doc.updatedAt,
    };
  }
  if (notes.description && !doc.description) doc = { ...doc, description: notes.description };
  if (notes.name) doc = { ...doc, name: notes.name };
  if (notes.methylationProfile) doc = { ...doc, methylationProfile: notes.methylationProfile };

  const history = snapGeneHistoryFromPackets(packets, doc);
  return applySnapGeneHistory(doc, history);
}

/**
 * Parse a SnapGene `.dna` file. The TeselaGen parser supplies the standard
 * sequence/feature view; the TLV enrichment pass restores primers and the
 * construction history tree.
 */
export async function parseSnapGeneBuffer(
  buffer: ArrayBuffer,
  fileName = 'Untitled.dna',
): Promise<PlasmidDocument> {
  const bytes = toUint8Array(buffer);
  let baseDoc: PlasmidDocument | undefined;
  try {
    // The bundled parser ships a Buffer polyfill. Marking the view lets it use
    // the array-like bytes directly in Node and in Web Workers.
    const parserInput = bytes as Uint8Array & { _isBuffer?: boolean };
    Object.defineProperty(parserInput, '_isBuffer', {
      value: true,
      configurable: true,
      enumerable: false,
    });
    // In browsers the parser reads through FileReader and requires a Blob.
    const input = typeof FileReader !== 'undefined' ? new Blob([bytes as Uint8Array<ArrayBuffer>]) : parserInput;
    const results = (await snapgeneToJson(input, { fileName })) as TeselaGenParseResult[];
    const documents = teselaGenResultsToDocuments(results, { fileName });
    if (documents.length > 0 && documents[0].sequence.length > 0) {
      baseDoc = documents[0];
    }
  } catch {
    baseDoc = undefined;
  }

  if (!baseDoc) {
    const packets = readPackets(bytes);
    validateSnapGeneCookie(packets);
    baseDoc = parseSnapGeneDocumentFromPackets(packets, fileName);
    return baseDoc;
  }
  const enriched = enrichSnapGeneBinary(bytes, baseDoc);
  if (/[\\/]/.test(enriched.name)) {
    const fallbackName = setExtensionlessName(fileName);
    if (fallbackName) return { ...enriched, name: fallbackName };
  }
  return enriched;
}

/**
 * Parse a GenBank flat file (single record).
 */
export async function parseGenBankString(gbkText: string): Promise<PlasmidDocument> {
  const cleaned = gbkText.replace(/^\uFEFF/, '');
  const results = genbankToJson(cleaned, {}) as TeselaGenParseResult[];
  const documents = teselaGenResultsToDocuments(results, { fileName: 'sequence.gb' });
  if (documents.length === 0) {
    throw new Error('Unable to parse GenBank data');
  }
  applyRawGenBankSegmentNotes(documents, cleaned);
  return documents[0];
}

/**
 * Parse a file based on its extension (and a small amount of content sniffing
 * for files with no extension). Text content may be passed as a string and
 * binary SnapGene content as an ArrayBuffer.
 */
export async function parseBioFile(
  fileName: string,
  content: ArrayBuffer | string,
): Promise<PlasmidDocument[]> {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const extension = baseName.includes('.')
    ? baseName.slice(baseName.lastIndexOf('.') + 1).toLowerCase()
    : '';

  if (extension === 'gz') {
    throw new Error(
      `Compressed .gz files are not supported: ${fileName}. Decompress the file before importing.`,
    );
  }

  if (content instanceof ArrayBuffer && content.byteLength >= 2) {
    const magic = new Uint8Array(content, 0, 2);
    if (magic[0] === 0x1f && magic[1] === 0x8b) {
      throw new Error(
        `Compressed .gz files are not supported: ${fileName}. Decompress the file before importing.`,
      );
    }
  }

  if (extension === 'dna' || extension === 'snapgene') {
    const buffer = toArrayBuffer(content);
    return [await parseSnapGeneBuffer(buffer, fileName)];
  }

  if (
    extension === 'xdna' ||
    extension === 'xdgn' ||
    extension === 'xprt'
  ) {
    return [parseXdnaBuffer(content, fileName)];
  }

  if (content instanceof ArrayBuffer && isSnapGeneMagic(content)) {
    return [await parseSnapGeneBuffer(toArrayBuffer(content), fileName)];
  }

  if (content instanceof ArrayBuffer && isXdnaMagic(content)) {
    return [parseXdnaBuffer(content, fileName)];
  }

  if (extension === 'ab1' || extension === 'scf') {
    throw new Error(`Unsupported binary sequencing format: .${extension}`);
  }

  if (extension === 'prot') {
    throw new Error(
      `Protein file ${fileName} must be imported with the protein parser (parseProteinFile).`,
    );
  }

  const text =
    typeof content === 'string'
      ? content.replace(/^\uFEFF/, '')
      : decodeUtf8(new Uint8Array(content)).replace(/^\uFEFF/, '');
  const trimmed = text.trim();

  if (extension === 'json' || (!extension && trimmed.startsWith('{'))) {
    return parseJsonDocuments(text, fileName);
  }

  if (extension === 'fastq' || extension === 'fq') {
    return fastqToDocuments(text, fileName);
  }

  if (
    extension === 'fasta' ||
    extension === 'fa' ||
    extension === 'fas' ||
    extension === 'fna' ||
    extension === 'ffn'
  ) {
    return parseFastaText(text, fileName);
  }

  if (
    extension === 'gb' ||
    extension === 'gbk' ||
    extension === 'gbff' ||
    extension === 'gbank' ||
    extension === 'gbs' ||
    extension === 'gbwithparts' ||
    extension === 'gen' ||
    extension === 'genbank' ||
    extension === 'ape'
  ) {
    return parseGenBankText(text, fileName);
  }

  if (extension === 'sbol' || extension === 'rdf' || extension === 'xml') {
    return parseXmlSequenceText(text, fileName, extension);
  }

  if (extension === 'geneious') {
    if (/<geneious|geneiousDocument/i.test(text)) {
      return parseXmlSequenceText(text, fileName, extension);
    }
    if (looksLikeGenBankText(trimmed)) return parseGenBankText(text, fileName);
    throw new Error(
      `Geneious archive files are not supported directly: ${fileName}. Export as GenBank and import that file.`,
    );
  }

  if (extension === 'cm5') {
    if (looksLikeGenBankText(trimmed)) return parseGenBankText(text, fileName);
    throw new Error(
      `Clone Manager .cm5 files use a proprietary binary format that cannot be decoded: ${fileName}. Export the molecule as GenBank (.gb) or FASTA and import that instead.`,
    );
  }

  if (extension === 'seq') {
    if (looksLikeGenBankText(trimmed)) return parseGenBankText(text, fileName);
    if (trimmed.startsWith('>')) return parseFastaText(text, fileName);
    if (/seq:seq/i.test(text) && /jbei/i.test(text)) {
      return parseXmlSequenceText(text, fileName, 'xml');
    }
    return parseDnastarText(text, fileName);
  }

  if (!extension && isSnapGeneMagic(text)) {
    return [await parseSnapGeneBuffer(toArrayBuffer(content), fileName)];
  }

  if (!extension && isXdnaMagic(content)) {
    return [parseXdnaBuffer(content, fileName)];
  }

  if (!extension) {
    if (trimmed.startsWith('>')) return parseFastaText(text, fileName);
    if (looksLikeGenBankText(trimmed)) return parseGenBankText(text, fileName);
    if (isSnapGeneMagic(text)) {
      return [await parseSnapGeneBuffer(toArrayBuffer(content), fileName)];
    }
  }

  if (looksLikeGenBankText(trimmed)) return parseGenBankText(text, fileName);
  if (trimmed.startsWith('>')) return parseFastaText(text, fileName);

  const plain = extractPlainSequence(text);
  if (plain) {
    return [
      normalizeParsedSequence(
        {
          name: setExtensionlessName(fileName) || 'Untitled Sequence',
          sequence: plain.sequence,
          circular: /\bcircular\b/i.test(text.slice(0, 500)),
        },
        { fileName },
      ),
    ];
  }

  try {
    const results = await anyToJson(text, { fileName });
    const documents = teselaGenResultsToDocuments(results, { fileName });
    if (documents.length > 0) return documents;
  } catch {
    // Fall through to a descriptive error.
  }
  throw new Error(`Unsupported or invalid sequence file: ${fileName}`);
}

function looksLikeGenBankText(text: string): boolean {
  return /^\s*LOCUS\s/m.test(text);
}

function isSnapGeneMagic(content: ArrayBuffer | string): boolean {
  if (typeof content === 'string') return content.startsWith('SnapGene');
  const bytes = new Uint8Array(content);
  return (
    bytes.byteLength >= 13 &&
    bytes[0] === 0x09 &&
    decodeAscii(bytes.subarray(5, 13)) === 'SnapGene'
  );
}

function parseFastaText(text: string, fileName: string): PlasmidDocument[] {
  let circularHint = false;
  const header = /^\s*>\s*([^\r\n]*)/.exec(text)?.[1] ?? '';
  if (/\bcircular\b/i.test(header)) circularHint = true;
  const results = fastaToJson(text as unknown as [string], {
    fileName,
  }) as TeselaGenParseResult[];
  const documents = teselaGenResultsToDocuments(results, { fileName });
  return documents.map((doc) => {
    const description = cleanFastaDescription(doc.description);
    const parsedCircular = /\bcircular\b/i.test(doc.description ?? '') || circularHint;
    return {
      ...doc,
      ...(description ? { description } : {}),
      topology: parsedCircular ? 'circular' : doc.topology,
    };
  });
}

function cleanFastaDescription(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const tokens = description
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !/^(circular|linear)$/i.test(token));
  const cleaned = tokens.join(' ').trim();
  return cleaned || undefined;
}

function parseGenBankText(text: string, fileName: string): PlasmidDocument[] {
  const cleaned = text.replace(/^\uFEFF/, '');
  const results = genbankToJson(cleaned, {}) as TeselaGenParseResult[];
  const documents = teselaGenResultsToDocuments(results, { fileName });
  if (documents.length === 0) throw new Error(`Unable to parse GenBank file: ${fileName}`);
  applyRawGenBankSegmentNotes(documents, cleaned);
  return documents;
}

function rawGenBankSegments(location: string): string[] | undefined {
  const parts = parseLocationParts(location);
  if (parts.length < 2) return undefined;
  const strand = parts.some((part) => part.strand === -1) ? -1 : 1;
  const ordered = strand === -1 ? [...parts].reverse() : parts;
  return ordered.map((part) => `${part.start}-${part.end}`);
}

function applyRawGenBankSegmentNotes(
  documents: PlasmidDocument[],
  text: string,
): void {
  let records: FlatFileRecord[];
  try {
    records = parseFlatFileRecords(text);
  } catch {
    return;
  }
  if (records.length !== documents.length) return;
  documents.forEach((document, recordIndex) => {
    const record = records[recordIndex];
    if (!record || record.features.length !== document.features.length) return;
    document.features.forEach((feature, featureIndex) => {
      const raw = record.features[featureIndex];
      if (!raw) return;
      const segments = rawGenBankSegments(raw.location);
      if (!segments) return;
      feature.notes = { ...(feature.notes ?? {}), segments };
    });
  });
}

function parseJsonDocuments(text: string, fileName: string): PlasmidDocument[] {
  const parsed = JSON.parse(text) as unknown;
  const candidates: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && 'document' in parsed
      ? [(parsed as { document: unknown }).document]
      : [parsed];
  const documents: PlasmidDocument[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Partial<PlasmidDocument> & TeselaGenSequence;
    if (typeof record.sequence === 'string' && Array.isArray(record.features) && 'topology' in record) {
      documents.push(finalizeDocument(record as PlasmidDocument, fileName));
    } else if (typeof record.sequence === 'string') {
      documents.push(normalizeParsedSequence(record, { fileName }));
    }
  }
  if (documents.length === 0) throw new Error(`Unable to parse JSON sequence file: ${fileName}`);
  return documents;
}

function finalizeDocument(doc: PlasmidDocument, fileName: string): PlasmidDocument {
  const sequence = normalizeSequence(doc.sequence);
  const circular = doc.topology === 'circular';
  const now = nowIso();
  const features = (Array.isArray(doc.features) ? doc.features : [])
    .map((feature) => {
      const mapped = mapFeatureType(feature.type);
      const start = clamp(Number(feature.start) || 0, 0, Math.max(0, sequence.length));
      const end = clamp(Number(feature.end) || start, 0, sequence.length);
      const color = normalizeColor(feature.color, DEFAULT_FEATURE_COLORS[mapped.type]);
      return {
        ...feature,
        id: feature.id || generateId('feature'),
        type: mapped.type,
        name: feature.name || mapped.type,
        start,
        end,
        strand: feature.strand === -1 || feature.strand === 0 ? feature.strand : 1,
        color,
      } satisfies SequenceFeature;
    })
    .filter((feature) => !(feature.start === feature.end && sequence.length > 0));
  const primers: Primer[] = (Array.isArray(doc.primers) ? doc.primers : []).map((primer) => ({
    ...primer,
    id: primer.id || generateId('primer'),
    sequence: normalizeSequence(primer.sequence),
    tailSequence: normalizeSequence(primer.tailSequence ?? ''),
    strand: primer.strand === -1 ? (-1 as const) : (1 as const),
  }));
  const history =
    Array.isArray(doc.history) && doc.history.length > 0
      ? doc.history.map((node) => ({
          ...node,
          id: node.id || generateId('history'),
          timestamp: normalizeDate(node.timestamp) ?? now,
          description: node.description || node.operation,
        }))
      : [
          {
            id: generateId('history'),
            operation: 'import' as const,
            timestamp: now,
            description: `Imported ${fileName}`,
          },
        ];
  if (!history.some((node) => node.operation === 'import')) {
    history.unshift({
      id: generateId('history'),
      operation: 'import',
      timestamp: doc.createdAt || now,
      description: `Imported ${fileName}`,
    });
  }
  return {
    ...doc,
    id: doc.id || generateId('plasmid'),
    name: doc.name || setExtensionlessName(fileName) || 'Untitled Sequence',
    sequence,
    topology: circular ? 'circular' : 'linear',
    length: sequence.length,
    createdAt: normalizeDate(doc.createdAt) ?? now,
    updatedAt: normalizeDate(doc.updatedAt) ?? normalizeDate(doc.createdAt) ?? now,
    methylationProfile: doc.methylationProfile ?? { dam: true, dcm: true, cpg: false },
    features,
    primers,
    history,
  };
}

/**
 * Export a document as a SnapGene/ApE-friendly GenBank flat file. Every
 * feature carries `/ApEinfo_fwdcolor` and `/ApEinfo_revcolor` qualifiers so
 * colours survive a round trip through either application.
 */
export function exportPlasmidToGenBank(doc: PlasmidDocument): string {
  const teselaGen = documentToTeselaGen(doc);
  const comments = doc.history.map(
    (node) => `${node.operation}: ${node.description.replace(/\s+/g, ' ')}`,
  );
  const result = jsonToGenbank(
    {
      ...teselaGen,
      comments,
    },
    {
      inclusive1BasedStart: false,
      inclusive1BasedEnd: false,
      reformatSeqName: true,
    },
  );
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error('Unable to export sequence as GenBank');
  }
  return result;
}

/**
 * Export a document as FASTA. The library header includes the sequence length
 * and topology tokens, both of which are understood by the parser above.
 */
export function exportPlasmidToFasta(doc: PlasmidDocument): string {
  const teselaGen = documentToTeselaGen(doc);
  return jsonToFasta(
    {
      ...teselaGen,
      features: [],
      primers: [],
      parts: [],
    },
    {
      sequence: doc.sequence,
      size: doc.length,
    },
  );
}

/**
 * Export the complete PlasmidDocument contract as formatted JSON. The output
 * can be read back with parseBioFile('*.json', content).
 */
export function exportPlasmidToSnapGeneJson(doc: PlasmidDocument): string {
  return JSON.stringify(doc, null, 2);
}
