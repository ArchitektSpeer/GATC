// Cloning history with replay: restore the sequence as it was after a step, or
// reopen the step's wizard with its recorded enzymes and parent fragments.
import { useMemo, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import type { CloningHistoryNode, PlasmidDocument } from '../types/schema';
import { CloningHistoryTree } from '../modules/canvas-ui';
import { methodToWizard, openProduct, uid } from './actions';
import { useWorkbench, type WorkbenchState } from './store';
import { Badge, Button } from './ui';

const OPERATION_LABEL: Record<CloningHistoryNode['operation'], string> = {
  import: '导入',
  restriction_ligation: '酶切连接',
  gibson_assembly: 'Gibson 组装',
  golden_gate: 'Golden Gate',
  gateway_bp: 'Gateway BP',
  gateway_lr: 'Gateway LR',
  pcr: 'PCR',
  soe_pcr: '融合 PCR',
  site_directed_mutagenesis: '定点突变',
  blunting: '末端补平/削平',
  manual_edit: '编辑',
};

/**
 * Finds the document as it stood right after history step `index`, searching the
 * live state first and then the undo snapshots (newest first).
 */
function snapshotAfterStep(doc: PlasmidDocument, index: number): PlasmidDocument | null {
  const wanted = index + 1;
  if (doc.history.length === wanted) return doc;
  const past = useWorkbench.temporal.getState().pastStates as Array<Partial<WorkbenchState>>;
  for (let i = past.length - 1; i >= 0; i--) {
    const old = past[i].docs?.find((d) => d.id === doc.id);
    if (old && old.history.length === wanted && old.history[index]?.id === doc.history[index].id) return old;
  }
  return null;
}

export function HistoryView({ doc, theme }: { doc: PlasmidDocument; theme: 'light' | 'dark' | 'publication' }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const docs = useWorkbench((s) => s.docs);
  const openWizard = useWorkbench((s) => s.openWizard);
  // Re-read snapshots when the undo stack changes.
  const pastCount = useWorkbench.temporal.getState().pastStates.length;
  const index = doc.history.findIndex((h) => h.id === selectedId);
  const node = index >= 0 ? doc.history[index] : null;

  const snapshot = useMemo(() => (index >= 0 ? snapshotAfterStep(doc, index) : null), [doc, index, pastCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Parents recorded on the node that are still open, matched by id then by name.
  const openParents = useMemo(
    () =>
      (node?.parentSnapshots ?? [])
        .map((p) => docs.find((d) => d.id === p.id) ?? docs.find((d) => d.name === p.name))
        .filter((d): d is PlasmidDocument => !!d),
    [node, docs],
  );
  const wizard = node ? methodToWizard[node.operation] : undefined;

  const restore = () => {
    if (!snapshot || !node) return;
    openProduct({ ...snapshot, id: uid('doc'), name: `${doc.name}@步骤${index + 1}` });
  };

  const replay = () => {
    if (!wizard || !node) return;
    openWizard(wizard, {
      enzymes: node.enzymesUsed,
      docIds: openParents.length ? openParents.map((d) => d.id) : [doc.id],
      primerNames: node.primersUsed,
    });
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto p-3">
        <CloningHistoryTree history={doc.history} selectedId={selectedId} onSelectNode={setSelectedId} theme={theme} />
      </div>
      <aside className="w-72 shrink-0 overflow-auto border-l border-[var(--border)] p-3 text-xs">
        {!node ? (
          <div className="text-[var(--muted)]">
            <History size={14} className="mb-1 inline" /> 点击历史树中的一个步骤，可回到该步骤后的序列版本，或用相同参数重新模拟。
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <Badge tone="blue">
                步骤 {index + 1} · {OPERATION_LABEL[node.operation]}
              </Badge>
              <div className="mt-1.5 font-medium">{node.description}</div>
              <div className="text-[var(--muted)]">{new Date(node.timestamp).toLocaleString()}</div>
            </div>
            {!!node.enzymesUsed?.length && <div>酶：{node.enzymesUsed.join(', ')}</div>}
            {!!node.primersUsed?.length && <div>引物：{node.primersUsed.join(', ')}</div>}
            {!!node.parentSnapshots?.length && (
              <div>
                来源：
                <ul className="list-disc pl-4">
                  {node.parentSnapshots.map((p) => (
                    <li key={p.id}>
                      {p.name} ({p.length} bp){openParents.some((d) => d.id === p.id || d.name === p.name) ? '' : ' · 未打开'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button disabled={!snapshot} onClick={restore} title={snapshot ? '' : '本次会话中没有该步骤的快照（例如从文件导入的历史）'}>
              <RotateCcw size={13} /> 打开该步骤后的版本
            </Button>
            {wizard && (
              <Button variant="primary" onClick={replay}>
                用相同参数重新模拟
              </Button>
            )}
            {!snapshot && <div className="text-[var(--muted)]">从文件导入的历史只记录步骤信息，没有中间序列。</div>}
          </div>
        )}
      </aside>
    </div>
  );
}
