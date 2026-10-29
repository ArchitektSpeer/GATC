// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// A multi-step cloning plan, run as a directed acyclic graph. Each step calls the
// same engine function the matching wizard calls, so a plan that runs here is a
// plan that would run by hand; nothing is committed until the user says so.
import type {
  CutSite,
  PipelineOp,
  PipelinePlan,
  PipelineStep,
  PlasmidDocument,
  RestrictionEnzyme,
  VirtualGelLane,
} from '../types/schema';
import { findCutSites, getEnzymeByName, mutatePlasmidSequence } from '../modules/seq-engine';
import {
  annealOligos,
  bluntEnds,
  simulateDigestion,
  simulateGatewayBP,
  simulateGatewayLR,
  simulateGibsonAssembly,
  simulateGoldenGateAssembly,
  simulateLigation,
  simulatePCR,
  simulateRecombinase,
} from '../modules/cloning-primer';
import { DNA_LADDERS, simulateVirtualGel, type GelSampleInput, type LadderName } from '../modules/alignment-gel';
import { t as translate } from '../lib/i18n';

export type { PipelineOp, PipelinePlan, PipelineStep };

export interface PipelineStepResult {
  stepId: string;
  op: PipelineOp;
  label: string;
  /** The step ran and produced what it was asked for. */
  ok: boolean;
  /** Set when the step did not run at all because an input step failed. */
  skipped?: boolean;
  product?: PlasmidDocument;
  /** Everything a digest or a recombination produced, not just the kept piece. */
  alternatives?: Array<{ name: string; length: number; topology: PlasmidDocument['topology'] }>;
  lanes?: VirtualGelLane[];
  /** The same lanes as gel input, so the user can send them to the gel view. */
  gelSamples?: GelSampleInput[];
  warnings: string[];
  notes: string[];
  error?: string;
}

export interface PipelineRun {
  plan: PipelinePlan;
  /** Topological order the steps ran in. */
  order: string[];
  steps: PipelineStepResult[];
  /** Products no later step consumed — what a commit would open. */
  products: PlasmidDocument[];
  /** Every step ran and produced its product. */
  ok: boolean;
}

const OPS: PipelineOp[] = [
  'pcr',
  'digest',
  'blunt',
  'ligate',
  'gibson',
  'golden_gate',
  'anneal_oligos',
  'mutate',
  'gateway_bp',
  'gateway_lr',
  'recombinase',
  'check_digest',
];

export const PIPELINE_OP_LABELS: Record<PipelineOp, string> = {
  pcr: 'PCR 扩增',
  digest: '酶切',
  blunt: '末端补平/削平',
  ligate: '连接',
  gibson: 'Gibson 组装',
  golden_gate: 'Golden Gate 组装',
  anneal_oligos: '引物退火',
  mutate: '定点突变',
  gateway_bp: 'Gateway BP',
  gateway_lr: 'Gateway LR',
  recombinase: '位点特异性重组',
  check_digest: '鉴定酶切 + 电泳',
};

/** How many inputs each operation takes: [minimum, maximum]. */
const ARITY: Record<PipelineOp, [number, number]> = {
  pcr: [1, 1],
  digest: [1, 1],
  blunt: [1, 1],
  ligate: [1, 12],
  gibson: [2, 8],
  golden_gate: [1, 12],
  anneal_oligos: [0, 0],
  mutate: [1, 1],
  gateway_bp: [2, 2],
  gateway_lr: [2, 2],
  recombinase: [1, 4],
  check_digest: [1, 1],
};

const MAX_STEPS = 30;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const DNA_PATTERN = /^[ACGTRYSWKMBDHVN]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDna(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const dna = value.toUpperCase().replace(/\s+/g, '').replace(/U/g, 'T');
  if (!dna || dna.length > maxLength || !DNA_PATTERN.test(dna)) return null;
  return dna;
}

function readEnzymeNames(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return null;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') return null;
    const name = raw.trim();
    if (!name || name.length > 48) return null;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

function stepLabel(step: PipelineStep): string {
  const label = typeof step.label === 'string' ? step.label.trim() : '';
  return label || translate(PIPELINE_OP_LABELS[step.op]);
}

/**
 * Check a plan against the documents it names, without running anything: ids,
 * operation parameters, missing inputs and cycles. The returned plan is a
 * normalised copy, so a validated plan never carries unexpected fields.
 */
export function validatePipelinePlan(
  plan: unknown,
  sources: PlasmidDocument[],
): { ok: true; plan: PipelinePlan } | { ok: false; error: string } {
  if (!isRecord(plan)) return { ok: false, error: translate('方案必须是一个对象') };
  if (typeof plan.name !== 'string' || !plan.name.trim()) {
    return { ok: false, error: translate('方案缺少名称') };
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { ok: false, error: translate('方案至少要有一个步骤') };
  }
  if (plan.steps.length > MAX_STEPS) {
    return { ok: false, error: translate('方案最多 {v0} 步', { v0: MAX_STEPS }) };
  }

  const byId = new Map<string, PipelineStep>();
  const steps: PipelineStep[] = [];
  for (const raw of plan.steps) {
    if (!isRecord(raw)) return { ok: false, error: translate('步骤必须是一个对象') };
    if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
      return { ok: false, error: translate('步骤 id 只能用字母、数字和 _.:- ，且不超过 64 字符') };
    }
    if (byId.has(raw.id)) return { ok: false, error: translate('步骤 id 重复：{v0}', { v0: raw.id }) };
    if (typeof raw.op !== 'string' || !(OPS as string[]).includes(raw.op)) {
      return { ok: false, error: translate('未知操作：{v0}', { v0: String(raw.op) }) };
    }
    const op = raw.op as PipelineOp;
    if (raw.inputs !== undefined && !Array.isArray(raw.inputs)) {
      return { ok: false, error: translate('步骤 {v0} 的 inputs 必须是数组', { v0: raw.id }) };
    }
    const inputs: string[] = [];
    for (const input of (raw.inputs as unknown[]) ?? []) {
      if (typeof input !== 'string' || !input.trim()) {
        return { ok: false, error: translate('步骤 {v0} 的 inputs 含空项', { v0: raw.id }) };
      }
      inputs.push(input.trim());
    }
    const [min, max] = ARITY[op];
    if (inputs.length < min || inputs.length > max) {
      return {
        ok: false,
        error: translate('步骤 {v0}（{v1}）需要 {v2} 个输入，实际 {v3} 个', {
          v0: raw.id,
          v1: translate(PIPELINE_OP_LABELS[op]),
          v2: min === max ? String(min) : `${min}–${max}`,
          v3: inputs.length,
        }),
      };
    }
    if (raw.params !== undefined && !isRecord(raw.params)) {
      return { ok: false, error: translate('步骤 {v0} 的 params 必须是对象', { v0: raw.id }) };
    }
    const params = isRecord(raw.params) ? raw.params : {};
    const paramError = checkParams(op, params, raw.id);
    if (paramError) return { ok: false, error: paramError };

    const step: PipelineStep = {
      id: raw.id,
      op,
      inputs,
      params,
      ...(typeof raw.label === 'string' && raw.label.trim() ? { label: raw.label.trim().slice(0, 120) } : {}),
    };
    byId.set(step.id, step);
    steps.push(step);
  }

  // Every input must name an earlier step or one of the documents on the bench.
  for (const step of steps) {
    for (const input of step.inputs ?? []) {
      if (byId.has(input)) continue;
      const match = resolveSource(input, sources);
      if (match === 'ambiguous') {
        return { ok: false, error: translate('步骤 {v0} 的输入 {v1} 对应多个文档，请用文档 id', { v0: step.id, v1: input }) };
      }
      if (!match) {
        return { ok: false, error: translate('步骤 {v0} 的输入 {v1} 既不是已有步骤也不是已打开的文档', { v0: step.id, v1: input }) };
      }
    }
  }

  const order = topologicalOrder(steps, byId);
  if (!order) return { ok: false, error: translate('步骤之间存在循环依赖') };

  return {
    ok: true,
    plan: {
      name: plan.name.trim().slice(0, 120),
      ...(typeof plan.goal === 'string' && plan.goal.trim() ? { goal: plan.goal.trim().slice(0, 2000) } : {}),
      steps,
    },
  };
}

function checkParams(op: PipelineOp, params: Record<string, unknown>, stepId: string): string | null {
  const bad = (message: string) => translate('步骤 {v0}：{v1}', { v0: stepId, v1: message });
  switch (op) {
    case 'pcr': {
      if (!readDna(params.forward, 200)) return bad(translate('forward 必须是 IUPAC DNA 引物序列'));
      if (!readDna(params.reverse, 200)) return bad(translate('reverse 必须是 IUPAC DNA 引物序列'));
      return null;
    }
    case 'digest':
    case 'check_digest': {
      const names = readEnzymeNames(params.enzymes, 8);
      if (!names) return bad(translate('enzymes 必须是 1–8 个酶名'));
      const missing = names.filter((name) => !getEnzymeByName(name));
      if (missing.length) return bad(translate('酶库中没有：{v0}', { v0: missing.join('、') }));
      if (op === 'digest' && params.select !== undefined) {
        const select = params.select;
        const ok =
          select === 'largest' ||
          select === 'smallest' ||
          (typeof select === 'number' && Number.isInteger(select) && select >= 0 && select < 64);
        if (!ok) return bad(translate('select 只能是 "largest"、"smallest" 或片段序号'));
      }
      if (op === 'check_digest' && params.ladder !== undefined) {
        if (typeof params.ladder !== 'string' || !(params.ladder in DNA_LADDERS)) {
          return bad(translate('ladder 不是已知 Marker'));
        }
      }
      return null;
    }
    case 'blunt': {
      if (params.method !== undefined && params.method !== 'klenow_fill_in' && params.method !== 't4_exonuclease') {
        return bad(translate('method 只能是 klenow_fill_in 或 t4_exonuclease'));
      }
      return null;
    }
    case 'golden_gate': {
      if (typeof params.enzyme !== 'string' || !params.enzyme.trim()) return bad(translate('缺少 enzyme'));
      if (!getEnzymeByName(params.enzyme.trim())) return bad(translate('酶库中没有 {v0}', { v0: params.enzyme.trim() }));
      return null;
    }
    case 'anneal_oligos': {
      if (!readDna(params.top, 200)) return bad(translate('top 必须是 IUPAC DNA 序列'));
      if (!readDna(params.bottom, 200)) return bad(translate('bottom 必须是 IUPAC DNA 序列'));
      return null;
    }
    case 'mutate': {
      const { start, end } = params;
      if (!Number.isInteger(start) || (start as number) < 0) return bad(translate('start 必须是非负整数'));
      if (!Number.isInteger(end) || (end as number) < (start as number)) return bad(translate('end 必须是不小于 start 的整数'));
      if (params.bases !== undefined && params.bases !== '' && !readDna(params.bases, 20000)) {
        return bad(translate('bases 必须是 IUPAC DNA 序列（留空表示删除）'));
      }
      if ((start as number) === (end as number) && !params.bases) return bad(translate('空区间又没有插入序列，这一步什么也不做'));
      return null;
    }
    case 'recombinase': {
      if (params.recombinase !== 'Cre' && params.recombinase !== 'Flp') {
        return bad(translate('recombinase 只能是 Cre 或 Flp'));
      }
      return null;
    }
    default:
      return null;
  }
}

/** A step id, document id or unique document name. */
function resolveSource(
  key: string,
  sources: PlasmidDocument[],
): PlasmidDocument | null | 'ambiguous' {
  const byId = sources.find((doc) => doc.id === key);
  if (byId) return byId;
  const lowered = key.toLowerCase();
  const byName = sources.filter((doc) => doc.name.toLowerCase() === lowered);
  if (byName.length > 1) return 'ambiguous';
  return byName[0] ?? null;
}

function topologicalOrder(steps: PipelineStep[], byId: Map<string, PipelineStep>): string[] | null {
  const order: string[] = [];
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string): boolean => {
    const mark = state.get(id);
    if (mark === 'done') return true;
    if (mark === 'open') return false;
    state.set(id, 'open');
    for (const input of byId.get(id)?.inputs ?? []) {
      if (byId.has(input) && !visit(input)) return false;
    }
    state.set(id, 'done');
    order.push(id);
    return true;
  };
  for (const step of steps) {
    if (!visit(step.id)) return null;
  }
  return order;
}

interface RunOptions {
  agarosePercent?: number;
}

/**
 * Run a validated plan over the documents on the bench. Nothing is written
 * anywhere: every product is a fresh document, and a failed step stops only the
 * steps that depend on it.
 */
export function dryRunPipeline(
  plan: PipelinePlan,
  sources: PlasmidDocument[],
  options: RunOptions = {},
): PipelineRun {
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  const order = topologicalOrder(plan.steps, byId) ?? plan.steps.map((step) => step.id);
  const produced = new Map<string, PlasmidDocument>();
  const failed = new Set<string>();
  const consumed = new Set<string>();
  const results: PipelineStepResult[] = [];

  for (const id of order) {
    const step = byId.get(id);
    if (!step) continue;
    const inputs = step.inputs ?? [];
    const upstreamFailure = inputs.find((input) => failed.has(input));
    if (upstreamFailure) {
      failed.add(id);
      results.push({
        stepId: id,
        op: step.op,
        label: stepLabel(step),
        ok: false,
        skipped: true,
        warnings: [],
        notes: [],
        error: translate('上游步骤 {v0} 没有产物，这一步未执行', { v0: upstreamFailure }),
      });
      continue;
    }

    const docs: PlasmidDocument[] = [];
    let missing: string | null = null;
    for (const input of inputs) {
      const fromStep = produced.get(input);
      if (fromStep) {
        docs.push(fromStep);
        // A verification step reads the molecule without using it up, so what it
        // looks at stays a product of the run.
        if (step.op !== 'check_digest') consumed.add(input);
        continue;
      }
      const source = resolveSource(input, sources);
      if (!source || source === 'ambiguous') {
        missing = input;
        break;
      }
      docs.push(source);
    }
    if (missing) {
      failed.add(id);
      results.push({
        stepId: id,
        op: step.op,
        label: stepLabel(step),
        ok: false,
        warnings: [],
        notes: [],
        error: translate('找不到输入 {v0}', { v0: missing }),
      });
      continue;
    }

    const result = runStep(step, docs, options.agarosePercent ?? 1);
    results.push(result);
    if (result.product) produced.set(id, result.product);
    if (!result.ok) failed.add(id);
  }

  const products: PlasmidDocument[] = [];
  for (const id of order) {
    const product = produced.get(id);
    if (product && !consumed.has(id)) products.push(product);
  }

  return {
    plan,
    order,
    steps: results,
    products,
    ok: results.every((step) => step.ok),
  };
}

function fail(step: PipelineStep, error: string, warnings: string[] = []): PipelineStepResult {
  return { stepId: step.id, op: step.op, label: stepLabel(step), ok: false, warnings, notes: [], error };
}

function describe(doc: PlasmidDocument): { name: string; length: number; topology: PlasmidDocument['topology'] } {
  return { name: doc.name, length: doc.length, topology: doc.topology };
}

function runStep(
  step: PipelineStep,
  docs: PlasmidDocument[],
  agarosePercent: number,
): PipelineStepResult {
  const params = step.params ?? {};
  const base = { stepId: step.id, op: step.op, label: stepLabel(step) };
  try {
    switch (step.op) {
      case 'pcr': {
        const forward = readDna(params.forward, 200) ?? '';
        const reverse = readDna(params.reverse, 200) ?? '';
        const { product, warnings } = simulatePCR(docs[0], forward, reverse);
        if (!product) return fail(step, warnings.join('；') || translate('引物无法在模板上定位'), warnings);
        return {
          ...base,
          ok: true,
          product: { ...product, name: step.label?.trim() || product.name },
          warnings,
          notes: [translate('产物 {v0} bp，模板 {v1}', { v0: product.length, v1: docs[0].name })],
        };
      }
      case 'digest': {
        const names = readEnzymeNames(params.enzymes, 8) ?? [];
        const chosen = names
          .map((name) => getEnzymeByName(name))
          .filter((enzyme): enzyme is RestrictionEnzyme => !!enzyme);
        const cuts = findCutSites(docs[0], chosen);
        if (!cuts.length) {
          return fail(step, translate('{v0} 在 {v1} 上没有切点', { v0: names.join(' + '), v1: docs[0].name }));
        }
        const fragments = simulateDigestion(docs[0], cuts);
        const kept = pickFragment(fragments, params.select);
        if (!kept) return fail(step, translate('第 {v0} 个片段不存在，共 {v1} 个', { v0: String(params.select), v1: fragments.length }));
        return {
          ...base,
          ok: true,
          product: kept,
          alternatives: fragments.map(describe),
          warnings: [],
          notes: [
            translate('{v0} 个切点，{v1} 个片段：{v2}', {
              v0: cuts.length,
              v1: fragments.length,
              v2: fragments.map((fragment) => `${fragment.length} bp`).join(' / '),
            }),
            translate('取 {v0}（{v1} bp）送入下一步', { v0: kept.name, v1: kept.length }),
          ],
        };
      }
      case 'blunt': {
        const method = (params.method as 'klenow_fill_in' | 't4_exonuclease') ?? 'klenow_fill_in';
        if (docs[0].topology !== 'linear') return fail(step, translate('只有线性片段才有末端可处理'));
        const product = bluntEnds(docs[0], method);
        return {
          ...base,
          ok: true,
          product,
          warnings: [],
          notes: [translate('{v0}：{v1} bp → {v2} bp', { v0: method, v1: docs[0].length, v2: product.length })],
        };
      }
      case 'ligate': {
        const circularize = params.circularize !== false;
        const { product, compatible, destroyedSites, warnings } = simulateLigation(docs, { circularize });
        if (!product) return fail(step, warnings.join('；') || translate('末端不相容，无法连接'), warnings);
        const notes = [translate('{v0} 个片段 → {v1} bp {v2}', { v0: docs.length, v1: product.length, v2: product.topology === 'circular' ? translate('环状') : translate('线性') })];
        if (!compatible) notes.push(translate('末端并非严格相容，已按最接近的路径连接'));
        if (destroyedSites.length) notes.push(translate('连接后消失的位点：{v0}', { v0: destroyedSites.join('、') }));
        return { ...base, ok: true, product, warnings, notes };
      }
      case 'gibson': {
        const circular = params.circular !== false;
        const { product, junctions, warnings } = simulateGibsonAssembly(docs, {
          circular,
          ...(Number.isInteger(params.minOverlap) ? { minOverlap: params.minOverlap as number } : {}),
          ...(Number.isInteger(params.maxOverlap) ? { maxOverlap: params.maxOverlap as number } : {}),
        });
        if (!product) return fail(step, warnings.join('；') || translate('片段之间找不到同源重叠'), warnings);
        return {
          ...base,
          ok: true,
          product,
          warnings,
          notes: [
            translate('{v0} 个片段 → {v1} bp', { v0: docs.length, v1: product.length }),
            ...junctions.map((junction) =>
              translate('接口 {v0} bp，Tm {v1} °C', { v0: junction.overlapSeq.length, v1: junction.overlapTm.toFixed(1) }),
            ),
          ],
        };
      }
      case 'golden_gate': {
        const enzyme = getEnzymeByName(String(params.enzyme).trim());
        if (!enzyme) return fail(step, translate('酶库中没有 {v0}', { v0: String(params.enzyme) }));
        const { product, overhangs, fidelityScore, internalSiteWarnings, warnings } = simulateGoldenGateAssembly(
          docs,
          enzyme,
          { circular: params.circular !== false },
        );
        if (!product) return fail(step, [...warnings, ...internalSiteWarnings].join('；') || translate('粘性末端不成环'), warnings);
        return {
          ...base,
          ok: true,
          product,
          warnings: [...warnings, ...internalSiteWarnings],
          notes: [
            translate('{v0} 个元件 → {v1} bp', { v0: docs.length, v1: product.length }),
            translate('接头 {v0}，保真度 {v1}', { v0: overhangs.join(' / ') || '—', v1: fidelityScore.toFixed(2) }),
          ],
        };
      }
      case 'anneal_oligos': {
        const top = readDna(params.top, 200) ?? '';
        const bottom = readDna(params.bottom, 200) ?? '';
        const result = annealOligos(top, bottom, { phosphorylated: params.phosphorylated === true });
        const product = step.label?.trim() ? { ...result.duplex, name: step.label.trim() } : result.duplex;
        const notes = [
          translate('配对 {v0} bp，Tm {v1} °C', { v0: result.duplexLength, v1: result.tm.toFixed(1) }),
        ];
        if (result.mismatchPositions.length) {
          notes.push(translate('配对区有 {v0} 个错配', { v0: result.mismatchPositions.length }));
        }
        if (result.alternatives > 0) {
          notes.push(translate('还有 {v0} 种同样好的配对方式，设计不唯一', { v0: result.alternatives }));
        }
        return { ...base, ok: true, product, warnings: result.warnings, notes };
      }
      case 'mutate': {
        const start = params.start as number;
        const end = params.end as number;
        const bases = typeof params.bases === 'string' ? (readDna(params.bases, 20000) ?? '') : '';
        if (end > docs[0].length) {
          return fail(step, translate('区间 [{v0}, {v1}) 超出 {v2} 的 {v3} bp', { v0: start, v1: end, v2: docs[0].name, v3: docs[0].length }));
        }
        const product = mutatePlasmidSequence(docs[0], { type: 'replace', start, end, bases });
        return {
          ...base,
          ok: true,
          product,
          warnings: [],
          notes: [
            translate('[{v0}, {v1}) 换成 {v2} nt：{v3} bp → {v4} bp', {
              v0: start,
              v1: end,
              v2: bases.length,
              v3: docs[0].length,
              v4: product.length,
            }),
          ],
        };
      }
      case 'gateway_bp': {
        const { entryClone, byproduct, warnings } = simulateGatewayBP(docs[0], docs[1]);
        if (!entryClone) return fail(step, warnings.join('；') || translate('没有找到成对的 attB / attP 位点'), warnings);
        return {
          ...base,
          ok: true,
          product: entryClone,
          ...(byproduct ? { alternatives: [describe(byproduct)] } : {}),
          warnings,
          notes: [translate('入门克隆 {v0} bp', { v0: entryClone.length })],
        };
      }
      case 'gateway_lr': {
        const { expressionClone, byproduct, warnings } = simulateGatewayLR(docs[0], docs[1]);
        if (!expressionClone) return fail(step, warnings.join('；') || translate('没有找到成对的 attL / attR 位点'), warnings);
        return {
          ...base,
          ok: true,
          product: expressionClone,
          ...(byproduct ? { alternatives: [describe(byproduct)] } : {}),
          warnings,
          notes: [translate('表达克隆 {v0} bp', { v0: expressionClone.length })],
        };
      }
      case 'recombinase': {
        const recombinase = params.recombinase as 'Cre' | 'Flp';
        const { products, events, warnings } = simulateRecombinase(docs, recombinase);
        if (!products.length) return fail(step, warnings.join('；') || translate('没有找到可配对的识别位点'), warnings);
        const [first, ...rest] = products;
        return {
          ...base,
          ok: true,
          product: first,
          ...(rest.length ? { alternatives: rest.map(describe) } : {}),
          warnings,
          notes: [...events, translate('取 {v0}（{v1} bp）送入下一步', { v0: first.name, v1: first.length })],
        };
      }
      case 'check_digest': {
        const names = readEnzymeNames(params.enzymes, 8) ?? [];
        const chosen = names
          .map((name) => getEnzymeByName(name))
          .filter((enzyme): enzyme is RestrictionEnzyme => !!enzyme);
        const cuts: CutSite[] = findCutSites(docs[0], chosen);
        const fragments = cuts.length ? simulateDigestion(docs[0], cuts) : [];
        const ladder = (typeof params.ladder === 'string' ? params.ladder : '1 kb DNA Ladder') as LadderName;
        const samples: GelSampleInput[] = [
          { label: translate('Marker'), ladder: ladder in DNA_LADDERS ? ladder : ('1 kb DNA Ladder' as LadderName) },
          {
            label: `${docs[0].name} / ${names.join(' + ')}`,
            fragments: (fragments.length ? fragments : [docs[0]]).map((fragment) => ({
              sizeBp: fragment.length,
              conformation: fragment.topology === 'circular' ? ('supercoiled' as const) : ('linear' as const),
              doc: fragment,
            })),
          },
        ];
        const lanes = simulateVirtualGel(samples, { agarosePercent });
        const notes = cuts.length
          ? [translate('预期条带：{v0}', { v0: fragments.map((fragment) => `${fragment.length} bp`).join(' / ') })]
          : [translate('{v0} 在 {v1} 上没有切点，这组酶无法鉴定', { v0: names.join(' + '), v1: docs[0].name })];
        const closeBands = tooClose(fragments.map((fragment) => fragment.length));
        if (closeBands) notes.push(translate('{v0} 与 {v1} bp 在胶上几乎重合，分辨不开', { v0: closeBands[0], v1: closeBands[1] }));
        return {
          ...base,
          ok: cuts.length > 0,
          lanes,
          gelSamples: samples,
          warnings: [],
          notes,
          ...(cuts.length ? {} : { error: translate('没有切点') }),
        };
      }
      default:
        return fail(step, translate('未实现的操作'));
    }
  } catch (error) {
    return fail(step, error instanceof Error ? error.message : String(error));
  }
}

function pickFragment(fragments: PlasmidDocument[], select: unknown): PlasmidDocument | null {
  if (!fragments.length) return null;
  if (typeof select === 'number') return fragments[select] ?? null;
  const sorted = [...fragments].sort((a, b) => a.length - b.length);
  if (select === 'smallest') return sorted[0];
  return sorted[sorted.length - 1];
}

/** Two band sizes within 10% of each other cannot be told apart on an agarose gel. */
function tooClose(sizes: number[]): [number, number] | null {
  const sorted = [...sizes].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] < sorted[i] * 0.1) return [sorted[i - 1], sorted[i]];
  }
  return null;
}

/** The run as a table a user can paste into a protocol or a lab notebook. */
export function pipelineToMarkdown(run: PipelineRun): string {
  const lines: string[] = [`# ${run.plan.name}`, ''];
  if (run.plan.goal) lines.push(run.plan.goal, '');
  lines.push(`| # | ${translate('步骤')} | ${translate('操作')} | ${translate('输入')} | ${translate('结果')} |`, '| --- | --- | --- | --- | --- |');
  const byId = new Map(run.plan.steps.map((step) => [step.id, step]));
  run.steps.forEach((result, index) => {
    const inputs = (byId.get(result.stepId)?.inputs ?? []).join(', ') || '—';
    const outcome = result.ok
      ? [result.product ? `${result.product.length} bp` : '', ...result.notes].filter(Boolean).join('；')
      : `${translate('失败')}：${result.error ?? ''}`;
    lines.push(`| ${index + 1} | ${result.label} | ${translate(PIPELINE_OP_LABELS[result.op])} | ${inputs} | ${outcome.replace(/\|/g, '/')} |`);
  });
  lines.push('');
  if (run.products.length) {
    lines.push(`## ${translate('终产物')}`, '');
    for (const product of run.products) {
      lines.push(`- ${product.name} — ${product.length} bp, ${product.topology === 'circular' ? translate('环状') : translate('线性')}`);
    }
    lines.push('');
  }
  const warnings = run.steps.flatMap((step) => step.warnings.map((warning) => `${step.label}: ${warning}`));
  if (warnings.length) {
    lines.push(`## ${translate('提示')}`, '');
    for (const warning of warnings) lines.push(`- ${warning}`);
    lines.push('');
  }
  lines.push(translate('以上为计算推演，不能替代湿实验验证。'));
  return lines.join('\n');
}
