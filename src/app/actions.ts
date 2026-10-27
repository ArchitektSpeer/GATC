// Cross-module workflows assembled from module primitives. Modules never call
// each other directly; this layer pipes data between them through schema types.
import type { AIToolAction, CloningHistoryNode, CutSite, PlasmidDocument, Primer, RestrictionEnzyme, SequenceFeature } from '../types/schema';
import { COMMERCIAL_ENZYMES, ENZYME_SETS, getEnzymeByName } from '../modules/seq-engine';
import type { GelSampleInput } from '../modules/alignment-gel';
import { callBio, callBioForDoc } from './bio-client';
import { docRevision } from './revision';
import { rangeError } from './ranges';
import { ALL_COMMERCIAL_SET, enzymeSetKey, isDocCurrent, selectActiveDoc, useWorkbench, type WizardKind } from './store';

export const uid = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

export function historyNode(
  operation: CloningHistoryNode['operation'],
  description: string,
  extra: Partial<CloningHistoryNode> = {},
): CloningHistoryNode {
  return { id: uid('h'), operation, timestamp: new Date().toISOString(), description, ...extra };
}

export function resolveEnzymes(names: string[]) {
  const found = names.map((n) => getEnzymeByName(n.trim())).filter((e): e is NonNullable<typeof e> => !!e);
  const missing = names.filter((n) => !getEnzymeByName(n.trim()));
  return { enzymes: found, missing };
}

export function allEnzymeNames(): string[] {
  return COMMERCIAL_ENZYMES.map((e) => e.name).sort((a, b) => a.localeCompare(b));
}

/** Enzymes in the currently selected enzyme set (preset, custom, or all commercial). */
export function activeEnzymes(): RestrictionEnzyme[] {
  const { enzymeSetId, customEnzymeSets } = useWorkbench.getState();
  if (enzymeSetId === ALL_COMMERCIAL_SET) return COMMERCIAL_ENZYMES;
  const set = [...ENZYME_SETS, ...customEnzymeSets].find((x) => x.id === enzymeSetId);
  return set ? resolveEnzymes(set.enzymeNames).enzymes : COMMERCIAL_ENZYMES;
}

export function newDocument(name: string, sequence: string, topology: PlasmidDocument['topology'], description?: string): PlasmidDocument {
  const now = new Date().toISOString();
  const seq = sequence.toUpperCase();
  return {
    id: uid('doc'),
    name,
    sequence: seq,
    topology,
    length: seq.length,
    createdAt: now,
    updatedAt: now,
    description,
    features: [],
    primers: [],
    history: [historyNode('manual_edit', description ?? `新建 ${name}`)],
  };
}

const cutSiteRequests = new Map<string, number>();

/**
 * Recompute cut sites of `doc` with the current enzyme set. Only the newest
 * request per document is stored, and only while `doc` is still current; returns
 * null when the result was discarded.
 */
export async function refreshCutSites(doc: PlasmidDocument): Promise<CutSite[] | null> {
  const token = (cutSiteRequests.get(doc.id) ?? 0) + 1;
  cutSiteRequests.set(doc.id, token);
  const enzymeKey = enzymeSetKey(useWorkbench.getState());
  const sites = await callBioForDoc(doc, 'findCutSites', doc, activeEnzymes());
  if (!sites || cutSiteRequests.get(doc.id) !== token || enzymeSetKey(useWorkbench.getState()) !== enzymeKey) return null;
  useWorkbench.getState().setCutSites(doc, enzymeKey, sites);
  return sites;
}

export const STALE_RESULT = '文档在计算期间已被修改，结果已丢弃，请重试';

/**
 * Store `next`, derived from `base`, only if `base` is still the current version
 * of that document. Results computed from an older version are never written
 * back; the user is told to recompute instead. Returns whether it was stored.
 */
export function replaceIfCurrent(base: PlasmidDocument, next: PlasmidDocument, staleMessage = '序列在计算之后已被修改，结果已失效，请重新计算'): boolean {
  const st = useWorkbench.getState();
  if (!isDocCurrent(base.id, docRevision(base))) {
    st.notify(staleMessage);
    return false;
  }
  st.replaceDoc(next);
  return true;
}
const MAX_EDIT_ATTEMPTS = 3;
const editQueues = new Map<string, Promise<unknown>>();

/**
 * Apply `transform` to the latest version of document `docId` and store the
 * result. Updates to one document run in order, and a result computed from a
 * version that changed in the meantime is recomputed from the newer version, so
 * no edit is lost and none is applied to stale data. Resolves to the stored
 * document, or null when the document was closed or kept changing.
 */
export function updateDoc(
  docId: string,
  transform: (doc: PlasmidDocument) => PlasmidDocument | null | Promise<PlasmidDocument | null>,
): Promise<PlasmidDocument | null> {
  const run = async (): Promise<PlasmidDocument | null> => {
    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt++) {
      const current = useWorkbench.getState().docs.find((d) => d.id === docId);
      if (!current) return null;
      const revision = docRevision(current);
      const next = await transform(current);
      if (!next) return null;
      if (isDocCurrent(docId, revision)) {
        useWorkbench.getState().replaceDoc(next);
        return next;
      }
    }
    useWorkbench.getState().notify(STALE_RESULT);
    return null;
  };
  const queued = (editQueues.get(docId) ?? Promise.resolve()).then(run, run);
  editQueues.set(docId, queued.catch(() => undefined));
  return queued;
}

export function uncutPlasmidSample(doc: PlasmidDocument): GelSampleInput {
  if (doc.topology === 'linear') {
    return { id: uid('lane'), label: doc.name, fragments: [{ sizeBp: doc.length, conformation: 'linear', massNg: 200, doc }] };
  }
  return {
    id: uid('lane'),
    label: `${doc.name} (uncut)`,
    fragments: [
      { sizeBp: doc.length, conformation: 'supercoiled', massNg: 160, doc },
      { sizeBp: doc.length, conformation: 'nicked', massNg: 40, doc },
    ],
  };
}

/** Digest `doc` with the named enzymes, append the lane to the virtual gel and return fragments. */
export async function digestToGel(doc: PlasmidDocument, enzymeNames: string[]): Promise<PlasmidDocument[]> {
  const st = useWorkbench.getState();
  const { enzymes, missing } = resolveEnzymes(enzymeNames);
  if (!enzymes.length) {
    st.notify(`未找到酶：${enzymeNames.join(', ')}`);
    return [];
  }
  const sites = await callBio('findCutSites', doc, enzymes);
  const usable = sites.filter((s) => !s.isMethylationBlocked);
  const fragments = usable.length ? await callBio('simulateDigestion', doc, usable) : [doc];
  const total = fragments.reduce((a, f) => a + f.length, 0) || 1;
  st.addGelSample({
    id: uid('lane'),
    label: enzymes.map((e) => e.name).join(' + '),
    fragments: usable.length
      ? fragments.map((f) => ({ sizeBp: f.length, conformation: 'linear' as const, massNg: (200 * f.length) / total, doc: f }))
      : uncutPlasmidSample(doc).fragments,
  });
  const blocked = sites.length - usable.length;
  st.notify(
    [
      `${enzymes.map((e) => e.name).join('+')}：${fragments.length} 个片段 (${fragments.map((f) => f.length).join(', ')} bp)`,
      blocked ? `${blocked} 个位点被甲基化阻断` : '',
      missing.length ? `未知酶：${missing.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('；'),
  );
  return fragments;
}

export function addPrimersToDoc(doc: PlasmidDocument, primers: Primer[], description: string): PlasmidDocument {
  return {
    ...doc,
    primers: [...doc.primers, ...primers],
    updatedAt: new Date().toISOString(),
    history: [...doc.history, historyNode('manual_edit', description, { primersUsed: primers.map((p) => p.name) })],
  };
}

export function openProduct(product: PlasmidDocument | null, warnings: string[] = []) {
  const st = useWorkbench.getState();
  if (!product) {
    st.notify(`模拟失败：${warnings.join('；') || '未生成产物'}`);
    return;
  }
  st.openDocs([product]);
  st.setView('split');
  st.notify(`已生成 ${product.name} (${product.length} bp)${warnings.length ? '；' + warnings.join('；') : ''}`);
}

export const methodToWizard: Partial<Record<CloningHistoryNode['operation'], WizardKind>> = {
  restriction_ligation: 'restriction',
  gibson_assembly: 'gibson',
  golden_gate: 'golden_gate',
  pcr: 'pcr',
  soe_pcr: 'pcr',
  site_directed_mutagenesis: 'mutagenesis',
  gateway_bp: 'gateway',
  gateway_lr: 'gateway',
};

const FEATURE_TYPES = new Set<string>([
  'CDS', 'promoter', 'terminator', 'rep_origin', 'primer_bind', 'misc_feature', 'regulatory',
  'enhancer', 'intron', 'protein_bind', 'oriT', 'attachment_site',
]);

/** Why an AI action cannot be applied to `doc` as it is now, or null. Coordinates are 0-based, half-open. */
export function aiActionError(action: AIToolAction, doc: PlasmidDocument): string | null {
  switch (action.type) {
    case 'HIGHLIGHT_RANGE':
      return rangeError(doc, action.payload.start, action.payload.end);
    case 'ADD_FEATURES':
      for (const f of action.payload.features ?? []) {
        const e = rangeError(doc, f.start, f.end);
        if (e) return `特征 ${f.name ?? ''}：${e}`;
        if (!FEATURE_TYPES.has(f.type)) return `特征 ${f.name ?? ''}：未知类型 ${String(f.type)}`;
        if (f.strand !== 1 && f.strand !== -1 && f.strand !== 0) return `特征 ${f.name ?? ''}：链方向无效`;
      }
      return null;
    case 'DESIGN_PRIMERS': {
      const p = action.payload;
      const mutation = p.cloningMethod === 'mutagenesis';
      return rangeError(doc, p.targetStart, p.targetEnd, { allowEmpty: mutation });
    }
    default:
      return null;
  }
}

/**
 * Execute an AI Copilot action card. `docId` is the document the conversation
 * is about; the action is refused when that is no longer the active document or
 * its coordinates do not fit the document as it is now.
 */
export async function applyAIAction(action: AIToolAction, docId: string): Promise<void> {
  const st = useWorkbench.getState();
  const doc = selectActiveDoc(st);
  if (!doc || doc.id !== docId) return st.notify('该建议针对的文档已不是当前文档，未执行');
  const invalid = aiActionError(action, doc);
  if (invalid) return st.notify(`AI 建议的坐标与当前序列不符，未执行：${invalid}`);
  switch (action.type) {
    case 'HIGHLIGHT_RANGE': {
      const { start, end, reason } = action.payload;
      st.setSelection({ start, end });
      st.setHighlight({ start, end, reason });
      st.notify(`高亮 ${start + 1}–${end}：${reason}`);
      return;
    }
    case 'ADD_FEATURES': {
      const features: SequenceFeature[] = action.payload.features.map((f) => ({ ...f, id: uid('f') }));
      replaceIfCurrent(doc, {
        ...doc,
        features: [...doc.features, ...features],
        updatedAt: new Date().toISOString(),
        history: [...doc.history, historyNode('manual_edit', `AI 添加 ${features.length} 个特征`)],
      });
      st.notify(`已添加特征：${features.map((f) => f.name).join(', ')}`);
      return;
    }
    case 'RUN_DIGESTION': {
      await digestToGel(doc, action.payload.enzymeNames);
      st.setView('gel');
      return;
    }
    case 'DESIGN_PRIMERS': {
      const p = action.payload;
      if (p.cloningMethod === 'mutagenesis') {
        // An empty mutationSeq is a deletion of the target range.
        if (p.mutationSeq === undefined) return st.notify('AI 建议的定点突变缺少新序列，未执行');
        const r = await callBioForDoc(doc, 'designMutagenesisPrimers', doc, { start: p.targetStart, end: p.targetEnd, newBases: p.mutationSeq }, COMMERCIAL_ENZYMES);
        if (!r) return st.notify(STALE_RESULT);
        st.replaceDoc(addPrimersToDoc(doc, [r.forward, r.reverse], 'AI 定点突变引物'));
        st.notify(`已设计突变引物 ${r.forward.name} / ${r.reverse.name}${r.warnings.length ? '；' + r.warnings.join('；') : ''}`);
        return;
      }
      const r = await callBioForDoc(doc, 'designPrimerPair', doc, { start: p.targetStart, end: p.targetEnd }, { forwardTail: p.forwardTail, reverseTail: p.reverseTail });
      if (!r) return st.notify(STALE_RESULT);
      st.replaceDoc(addPrimersToDoc(doc, [r.forward, r.reverse], `AI ${p.cloningMethod} 引物`));
      st.setSelection({ start: p.targetStart, end: p.targetEnd });
      st.notify(`引物 Tm ${r.forward.tmAnnealing.toFixed(1)} / ${r.reverse.tmAnnealing.toFixed(1)} °C，产物 ${r.productLength} bp`);
      return;
    }
    case 'SIMULATE_CLONING': {
      st.setWizard(methodToWizard[action.payload.method] ?? 'restriction');
      return;
    }
  }
}
