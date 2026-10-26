// Cross-module workflows assembled from module primitives. Modules never call
// each other directly; this layer pipes data between them through schema types.
import type { AIToolAction, CloningHistoryNode, CutSite, PlasmidDocument, Primer, SequenceFeature } from '../types/schema';
import { COMMERCIAL_ENZYMES, getEnzymeByName } from '../modules/seq-engine';
import type { GelSampleInput } from '../modules/alignment-gel';
import { callBio } from './bio-client';
import { selectActiveDoc, useWorkbench, type WizardKind } from './store';

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

export async function refreshCutSites(doc: PlasmidDocument): Promise<CutSite[]> {
  const sites = await callBio('findCutSites', doc);
  useWorkbench.getState().setCutSites(doc.id, sites);
  return sites;
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

const methodToWizard: Partial<Record<CloningHistoryNode['operation'], WizardKind>> = {
  restriction_ligation: 'restriction',
  gibson_assembly: 'gibson',
  golden_gate: 'golden_gate',
  pcr: 'pcr',
  soe_pcr: 'pcr',
  site_directed_mutagenesis: 'mutagenesis',
  gateway_bp: 'gateway',
  gateway_lr: 'gateway',
};

/** Execute an AI Copilot action card against the active document. */
export async function applyAIAction(action: AIToolAction): Promise<void> {
  const st = useWorkbench.getState();
  const doc = selectActiveDoc(st);
  if (!doc) return;
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
      st.replaceDoc({
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
      if (p.cloningMethod === 'mutagenesis' && p.mutationSeq) {
        const r = await callBio('designMutagenesisPrimers', doc, { start: p.targetStart, end: p.targetEnd, newBases: p.mutationSeq }, COMMERCIAL_ENZYMES);
        st.replaceDoc(addPrimersToDoc(doc, [r.forward, r.reverse], 'AI 定点突变引物'));
        st.notify(`已设计突变引物 ${r.forward.name} / ${r.reverse.name}${r.warnings.length ? '；' + r.warnings.join('；') : ''}`);
        return;
      }
      const r = await callBio('designPrimerPair', doc, { start: p.targetStart, end: p.targetEnd }, { forwardTail: p.forwardTail, reverseTail: p.reverseTail });
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
