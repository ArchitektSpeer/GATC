// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Reads and writes OpenCloning's cloning-strategy JSON, the LinkML schema that lets a
// construction history travel between tools (https://github.com/OpenCloning/OpenCloning_LinkML).
// The mapping is deliberately conservative: an operation with no class in that schema is
// written as a sequence that was provided directly, and the loss is reported rather than
// papered over.
import type { CloningHistoryNode, CloningOperationType, PlasmidDocument } from '../../types/schema';
import { t as translate } from '../../lib/i18n';

/** The schema version this mapping was written against. */
export const OPENCLONING_SCHEMA_VERSION = '0.4.8';

export interface OpenCloningSourceInput {
  type: 'SourceInput' | 'AssemblyFragment';
  sequence: number;
  left_location?: string | null;
  right_location?: string | null;
  reverse_complemented?: boolean;
}

export interface OpenCloningSource {
  id: number;
  type: string;
  output_name: string | null;
  database_id: number | null;
  input: OpenCloningSourceInput[];
  [extra: string]: unknown;
}

export interface OpenCloningSequence {
  id: number;
  type: 'TextFileSequence';
  sequence_file_format: 'genbank' | 'fasta' | 'embl' | 'snapgene';
  overhang_crick_3prime: number;
  overhang_watson_3prime: number;
  file_content: string;
}

export interface OpenCloningPrimer {
  id: number;
  type: 'Primer';
  name: string;
  database_id: number | null;
  sequence: string;
}

export interface CloningStrategy {
  sequences: OpenCloningSequence[];
  sources: OpenCloningSource[];
  primers: OpenCloningPrimer[];
  description: string;
  schema_version: string;
  backend_version?: string;
  frontend_version?: string;
}

/**
 * GATC operations mapped onto the schema's Source classes. `null` means the schema has
 * no class for it, so the product is written as a directly provided sequence and the
 * step before it is lost.
 */
const SOURCE_CLASS: Record<CloningOperationType, string | null> = {
  import: 'UploadedFileSource',
  restriction_ligation: 'RestrictionAndLigationSource',
  gibson_assembly: 'GibsonAssemblySource',
  golden_gate: 'RestrictionAndLigationSource',
  gateway_bp: 'GatewaySource',
  gateway_lr: 'GatewaySource',
  pcr: 'PCRSource',
  soe_pcr: 'OverlapExtensionPCRLigationSource',
  site_directed_mutagenesis: null,
  blunting: 'PolymeraseExtensionSource',
  oligo_annealing: 'OligoHybridizationSource',
  manual_edit: null,
};

/** The reverse mapping, for reading a strategy back in. */
const OPERATION_BY_CLASS: Record<string, CloningOperationType> = {
  UploadedFileSource: 'import',
  ManuallyTypedSource: 'import',
  RepositoryIdSource: 'import',
  AddgeneIdSource: 'import',
  GenomeCoordinatesSource: 'import',
  NCBISequenceSource: 'import',
  SEVASource: 'import',
  IGEMSource: 'import',
  BenchlingUrlSource: 'import',
  SnapGenePlasmidSource: 'import',
  EuroscarfSource: 'import',
  WekWikGeneIdSource: 'import',
  OpenDNACollectionsSource: 'import',
  CollectionSource: 'import',
  RestrictionAndLigationSource: 'restriction_ligation',
  RestrictionEnzymeDigestionSource: 'restriction_ligation',
  LigationSource: 'restriction_ligation',
  GibsonAssemblySource: 'gibson_assembly',
  InFusionSource: 'gibson_assembly',
  InVivoAssemblySource: 'gibson_assembly',
  GatewaySource: 'gateway_lr',
  PCRSource: 'pcr',
  OverlapExtensionPCRLigationSource: 'soe_pcr',
  PolymeraseExtensionSource: 'blunting',
  OligoHybridizationSource: 'oligo_annealing',
  HomologousRecombinationSource: 'restriction_ligation',
  CRISPRSource: 'restriction_ligation',
  CreLoxRecombinationSource: 'restriction_ligation',
  RecombinaseSource: 'restriction_ligation',
  ReverseComplementSource: 'manual_edit',
  AnnotationSource: 'manual_edit',
};

/**
 * pydna, and so OpenCloning, records a linear molecule's ends as the 3' overhang of each
 * strand: the crick strand's 3' end is the left end of the molecule. A 5' overhang on the
 * top strand is therefore a negative crick overhang, and so on.
 */
export function overhangNumbers(doc: PlasmidDocument): {
  crick3: number;
  watson3: number;
  fullSequence: string;
} {
  const ends = doc.topology === 'linear' ? doc.linearEnds : undefined;
  if (!ends) return { crick3: 0, watson3: 0, fullSequence: doc.sequence };
  const left = ends.left;
  const right = ends.right;
  const crick3 = left.type === '5-prime' ? -left.sequence.length : left.type === '3-prime' ? left.sequence.length : 0;
  const watson3 = right.type === '3-prime' ? right.sequence.length : right.type === '5-prime' ? -right.sequence.length : 0;
  // pydna's "full sequence" spans both strands; GATC's sequence is the top strand only,
  // so the bases that live solely on the bottom strand are added back here.
  const leftExtra = left.type === '3-prime' ? reverseComplementDna(left.sequence) : '';
  const rightExtra = right.type === '5-prime' ? reverseComplementDna(right.sequence) : '';
  return { crick3, watson3, fullSequence: `${leftExtra}${doc.sequence}${rightExtra}` };
}

const COMPLEMENT: Record<string, string> = {
  A: 'T', C: 'G', G: 'C', T: 'A', U: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
};

function reverseComplementDna(sequence: string): string {
  let out = '';
  for (let index = sequence.length - 1; index >= 0; index -= 1) {
    const base = sequence[index].toUpperCase();
    out += COMPLEMENT[base] ?? 'N';
  }
  return out;
}

export interface StrategyExport {
  strategy: CloningStrategy;
  json: string;
  warnings: string[];
}

/**
 * Write the open documents and their construction history as a cloning strategy.
 * A step whose parents are not among the documents being exported keeps its own
 * sequence but loses its edges, and that is reported.
 */
export function exportCloningStrategy(
  docs: PlasmidDocument[],
  options: { description?: string; toGenBank: (doc: PlasmidDocument) => string; appVersion?: string } = {
    toGenBank: () => '',
  },
): StrategyExport {
  const warnings: string[] = [];
  const idByDoc = new Map<string, number>();
  docs.forEach((doc, index) => idByDoc.set(doc.id, index + 1));
  let nextId = docs.length + 1;

  const primers: OpenCloningPrimer[] = [];
  const primerIdByKey = new Map<string, number>();
  for (const doc of docs) {
    for (const primer of doc.primers) {
      const key = `${primer.name}:${primer.sequence}`;
      if (primerIdByKey.has(key)) continue;
      // The schema only allows unambiguous bases in a primer.
      if (!/^[ACGTacgt]+$/.test(primer.sequence)) {
        warnings.push(translate('引物 {v0} 含非 ACGT 碱基，OpenCloning 的 Primer 不接受，已略过。', { v0: primer.name }));
        continue;
      }
      const id = nextId;
      nextId += 1;
      primerIdByKey.set(key, id);
      primers.push({ id, type: 'Primer', name: primer.name, database_id: null, sequence: primer.sequence });
    }
  }

  const sequences: OpenCloningSequence[] = [];
  const sources: OpenCloningSource[] = [];

  for (const doc of docs) {
    const id = idByDoc.get(doc.id)!;
    const { crick3, watson3, fullSequence } = overhangNumbers(doc);
    void fullSequence;
    sequences.push({
      id,
      type: 'TextFileSequence',
      sequence_file_format: 'genbank',
      overhang_crick_3prime: crick3,
      overhang_watson_3prime: watson3,
      file_content: options.toGenBank(doc),
    });

    const node = lastMeaningfulNode(doc.history);
    const operation = node?.operation ?? 'import';
    const mapped = SOURCE_CLASS[operation];
    const parents = (node?.parentSnapshots ?? [])
      .map((snapshot) => idByDoc.get(snapshot.id))
      .filter((value): value is number => typeof value === 'number');
    const missing = (node?.parentSnapshots ?? []).length - parents.length;
    if (missing > 0) {
      warnings.push(
        translate('{v0}：{v1} 个亲本不在导出范围内，这一步的来源连边会丢失（把亲本一起打开再导出即可保留）。', { v0: doc.name, v1: missing }),
      );
    }

    if (!mapped) {
      warnings.push(
        translate('{v0}：{v1} 在 OpenCloning 模型里没有对应的操作类型，已写成「直接给出的序列」，谱系到此截断。', { v0: doc.name, v1: operation }),
      );
      sources.push({
        id,
        type: 'ManuallyTypedSource',
        output_name: doc.name,
        database_id: null,
        input: [],
        user_input: doc.sequence,
        circular: doc.topology === 'circular',
        overhang_crick_3prime: crick3,
        overhang_watson_3prime: watson3,
      });
      continue;
    }

    const source: OpenCloningSource = {
      id,
      type: mapped,
      output_name: doc.name,
      database_id: null,
      input: parents.map((sequence) => ({ type: 'SourceInput', sequence })),
    };
    if (mapped === 'UploadedFileSource') {
      source.sequence_file_format = 'genbank';
      source.file_name = `${doc.name}.gb`;
      source.circularize = doc.topology === 'circular';
    }
    if (mapped === 'RestrictionAndLigationSource') {
      // The schema requires the enzymes; without them the record would not validate.
      source.restriction_enzymes = node?.enzymesUsed?.length ? [...node.enzymesUsed] : ['unknown'];
      if (!node?.enzymesUsed?.length) {
        warnings.push(translate('{v0}：这一步没有记录所用的酶，已写成 unknown。', { v0: doc.name }));
      }
      source.circular = doc.topology === 'circular';
    }
    if (mapped === 'GibsonAssemblySource' || mapped === 'OverlapExtensionPCRLigationSource') {
      source.circular = doc.topology === 'circular';
    }
    if (mapped === 'GatewaySource') {
      source.reaction_type = operation === 'gateway_bp' ? 'BP' : 'LR';
    }
    if (mapped === 'PCRSource') {
      source.add_primer_features = false;
      // The two primers go in alongside the template, as inputs of the reaction.
      for (const name of node?.primersUsed ?? []) {
        const primer = doc.primers.find((p) => p.name === name);
        const primerId = primer ? primerIdByKey.get(`${primer.name}:${primer.sequence}`) : undefined;
        if (primerId) source.input.push({ type: 'SourceInput', sequence: primerId });
      }
    }
    if (mapped === 'OligoHybridizationSource') {
      source.overhang_crick_3prime = crick3;
    }
    sources.push(source);
  }

  const strategy: CloningStrategy = {
    sequences,
    sources,
    primers,
    description: options.description ?? '',
    schema_version: OPENCLONING_SCHEMA_VERSION,
    backend_version: undefined,
    frontend_version: options.appVersion ? `GATC ${options.appVersion}` : undefined,
  };
  return { strategy, json: `${JSON.stringify(strategy, null, 1)}\n`, warnings };
}

/** The newest history node that says how the document was made. */
function lastMeaningfulNode(history: CloningHistoryNode[]): CloningHistoryNode | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].operation !== 'manual_edit') return history[index];
  }
  return history[history.length - 1];
}

/** Cheap check that a .json file is a cloning strategy rather than some other JSON. */
export function isCloningStrategyFile(name: string, text: string): boolean {
  if (!/\.json$/i.test(name)) return false;
  if (!/"sequences"\s*:/.test(text) || !/"sources"\s*:/.test(text)) return false;
  try {
    const parsed = JSON.parse(text) as Partial<CloningStrategy>;
    return Array.isArray(parsed.sequences) && Array.isArray(parsed.sources);
  } catch {
    return false;
  }
}

export interface StrategyImport {
  /** The GenBank text of every sequence, with the lineage the strategy recorded. */
  files: Array<{ name: string; content: string; history: CloningHistoryNode[] }>;
  primers: Array<{ name: string; sequence: string }>;
  description: string;
  warnings: string[];
}

/**
 * Read a cloning strategy. The GenBank text of each sequence is handed back for the
 * caller's own parser, together with the history nodes rebuilt from the sources, so
 * nothing here has to know how GATC parses a file.
 */
export function importCloningStrategy(text: string): StrategyImport {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(translate('不是合法的 JSON：{v0}', { v0: error instanceof Error ? error.message : String(error) }));
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('不是 OpenCloning 克隆策略文件');
  const strategy = parsed as Partial<CloningStrategy>;
  if (!Array.isArray(strategy.sequences) || !Array.isArray(strategy.sources)) {
    throw new Error('不是 OpenCloning 克隆策略文件：缺少 sequences 或 sources');
  }
  if (strategy.schema_version && strategy.schema_version !== OPENCLONING_SCHEMA_VERSION) {
    warnings.push(
      translate('文件的 schema 版本是 {v0}，本程序按 {v1} 读取；字段若有变动可能读不全。', { v0: strategy.schema_version, v1: OPENCLONING_SCHEMA_VERSION }),
    );
  }

  const primers = (strategy.primers ?? []).map((primer) => ({
    name: primer.name || `primer_${primer.id}`,
    sequence: String(primer.sequence ?? '').toUpperCase(),
  }));
  const nameById = new Map<number, string>();
  for (const source of strategy.sources) {
    if (source?.output_name) nameById.set(source.id, source.output_name);
  }
  for (const primer of strategy.primers ?? []) nameById.set(primer.id, primer.name);

  const sourceById = new Map<number, OpenCloningSource>();
  for (const source of strategy.sources) sourceById.set(source.id, source);

  const files: StrategyImport['files'] = [];
  for (const sequence of strategy.sequences) {
    if (sequence.sequence_file_format && sequence.sequence_file_format !== 'genbank') {
      warnings.push(translate('序列 {v0} 的格式是 {v1}，按原样交给解析器。', { v0: sequence.id, v1: sequence.sequence_file_format }));
    }
    const source = sourceById.get(sequence.id);
    const name = source?.output_name || `sequence_${sequence.id}`;
    const history: CloningHistoryNode[] = [];
    if (source) {
      const operation = OPERATION_BY_CLASS[source.type];
      if (!operation) warnings.push(translate('未知的来源类型 {v0}（序列 {v1}），已记作手工编辑。', { v0: source.type, v1: sequence.id }));
      const enzymes = Array.isArray(source.restriction_enzymes)
        ? (source.restriction_enzymes as string[])
        : undefined;
      const inputs = Array.isArray(source.input) ? source.input : [];
      history.push({
        id: `oc-${source.id}`,
        operation: operation ?? 'manual_edit',
        timestamp: new Date(0).toISOString(),
        description: `${source.type}${source.output_name ? ` → ${source.output_name}` : ''}`,
        enzymesUsed: enzymes,
        primersUsed: inputs
          .map((entry) => nameById.get(entry.sequence))
          .filter((value): value is string => typeof value === 'string' && primers.some((p) => p.name === value)),
        parentSnapshots: inputs
          .filter((entry) => !primers.some((p) => p.name === nameById.get(entry.sequence)))
          .map((entry) => ({
            id: `oc-seq-${entry.sequence}`,
            name: nameById.get(entry.sequence) ?? `sequence_${entry.sequence}`,
            length: 0,
          })),
      });
    }
    files.push({ name, content: sequence.file_content ?? '', history });
  }

  return { files, primers, description: strategy.description ?? '', warnings };
}
