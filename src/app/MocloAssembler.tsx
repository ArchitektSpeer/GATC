// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Modular cloning: put the open level-0 parts into the positions of a published
// fusion-site syntax, check that each one really carries the overhangs its position
// calls for, and build one Golden Gate product per combination.
import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Sparkles, Wand2, X } from 'lucide-react';
import type { PlasmidDocument } from '../types/schema';
import {
  checkPartInSlot,
  checkSlotChain,
  combinatorialAssembly,
  designSlotPrimers,
  fusionSitesOf,
  identifySlots,
  MOCLO_STANDARDS,
  resolveEnzyme,
  type CombinatorialProduct,
  type MocloSlot,
  type MocloStandard,
  type SlotPrimerDesign,
} from '../modules/cloning-primer';
import { addPrimersToDoc, replaceIfCurrent } from './actions';
import { selectActiveDoc, useWorkbench } from './store';
import { Badge, Button, Dialog, Field, Select } from './ui';

/** The acceptor is not one of the standard's positions; its sites come from the vector itself. */
const ACCEPTOR = '__acceptor__';

function slotKey(slot: MocloSlot): string {
  return slot.id;
}

export function MocloAssemblerDialog() {
  const open = useWorkbench((s) => s.tool === 'moclo');
  const setTool = useWorkbench((s) => s.setTool);
  const docs = useWorkbench((s) => s.docs);
  const [standardId, setStandardId] = useState(MOCLO_STANDARDS[0].id);
  const [assigned, setAssigned] = useState<Record<string, string[]>>({});
  const [limit, setLimit] = useState(24);
  const [results, setResults] = useState<CombinatorialProduct[] | null>(null);
  const [failures, setFailures] = useState<Array<{ combination: string[]; reason: string }>>([]);
  const [notAttempted, setNotAttempted] = useState(0);
  const [busy, setBusy] = useState(false);

  const standard = MOCLO_STANDARDS.find((s) => s.id === standardId) ?? MOCLO_STANDARDS[0];
  const enzyme = resolveEnzyme(standard.enzyme);
  const byId = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const partsIn = (key: string): PlasmidDocument[] =>
    (assigned[key] ?? []).map((id) => byId.get(id)).filter((d): d is PlasmidDocument => !!d);

  /** Positions that have at least one part, in the order the standard lists them. */
  const used = standard.slots.filter((s) => (assigned[slotKey(s)] ?? []).length > 0);
  const acceptors = partsIn(ACCEPTOR);

  const chain = useMemo(() => {
    if (!enzyme || !used.length) return null;
    const acceptorSites = acceptors[0] ? fusionSitesOf(acceptors[0], enzyme) : null;
    const ordered: MocloSlot[] = acceptorSites
      ? [
          {
            id: '受体载体',
            code: 'VECTOR',
            label: acceptors[0].name,
            upstream: acceptorSites.upstream,
            downstream: acceptorSites.downstream,
          },
          ...used,
        ]
      : used;
    return { ...checkSlotChain(ordered, { circular: !!acceptorSites }), hasAcceptor: !!acceptorSites };
  }, [enzyme, used, acceptors]);

  const checks = useMemo(() => {
    if (!enzyme) return [];
    return used.flatMap((s) => partsIn(slotKey(s)).map((part) => checkPartInSlot(part, s, standard)));
  }, [enzyme, used, assigned, standard]);
  const errors = checks.filter((c) => !c.ok);

  const combinationCount = used.reduce(
    (count, s) => count * (assigned[slotKey(s)] ?? []).length,
    acceptors.length || 1,
  );

  const add = (key: string, id: string) => {
    if (!id) return;
    setAssigned((prev) => ({ ...prev, [key]: [...new Set([...(prev[key] ?? []), id])] }));
    setResults(null);
  };
  const remove = (key: string, id: string) => {
    setAssigned((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((x) => x !== id) }));
    setResults(null);
  };

  /** Read every open document's overhangs and drop it into the position it fits. */
  const autoAssign = () => {
    const next: Record<string, string[]> = {};
    let placed = 0;
    for (const doc of docs) {
      const matches = identifySlots(doc, standard);
      if (matches.length) {
        const key = slotKey(matches[0].slot);
        next[key] = [...(next[key] ?? []), doc.id];
        placed += 1;
      }
    }
    setAssigned(next);
    setResults(null);
    useWorkbench
      .getState()
      .notify(
        placed
          ? `按接头归位 ${placed} 个元件；受体载体请手动指定`
          : `打开的序列里没有符合 ${standard.name} 接头的元件`,
      );
  };

  const build = () => {
    if (!enzyme) return;
    setBusy(true);
    try {
      const groups = [
        ...(acceptors.length ? [{ label: '受体载体', parts: acceptors }] : []),
        ...used.map((s) => ({ label: `${s.id} ${s.code}`, parts: partsIn(slotKey(s)) })),
      ];
      const outcome = combinatorialAssembly(groups, enzyme, { limit, namePrefix: 'MoClo' });
      setResults(outcome.products);
      setFailures(outcome.failures);
      setNotAttempted(outcome.notAttempted);
      useWorkbench
        .getState()
        .notify(
          `组合装配完成：${outcome.products.length} 个产物${outcome.failures.length ? `，${outcome.failures.length} 个组合装不起来` : ''}`,
        );
    } finally {
      setBusy(false);
    }
  };

  const openAll = () => {
    if (!results?.length) return;
    useWorkbench.getState().openDocs(results.map((r) => r.product));
    useWorkbench.getState().notify(`已打开 ${results.length} 个组合产物`);
    setTool(null);
  };

  return (
    <Dialog open={open} onClose={() => setTool(null)} title="组合克隆（MoClo / Golden Gate 矩阵）" width={960}>
      <div className="flex flex-col gap-3 text-xs">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="标准语法" hint={standard.source}>
            <Select
              aria-label="标准语法"
              value={standardId}
              onChange={(e) => {
                setStandardId(e.target.value);
                setAssigned({});
                setResults(null);
              }}
            >
              {MOCLO_STANDARDS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Badge tone="blue">{standard.enzyme}</Badge>
          {standard.verifiedAgainstPublication ? (
            <Badge tone="green">接头表已对照原文核对</Badge>
          ) : (
            <Badge tone="amber">接头表取自第三方实现，未对照原文</Badge>
          )}
          <div className="flex-1" />
          <Button size="sm" onClick={autoAssign} disabled={!docs.length}>
            <Wand2 size={12} /> 按接头自动归位
          </Button>
        </div>

        {standard.note && <p className="text-[var(--muted)]">{standard.note}</p>}

        <div className="max-h-[42vh] overflow-auto rounded-md border border-[var(--border)]">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[var(--panel)] text-[var(--muted)]">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">位置</th>
                <th className="px-2 py-1.5 text-left font-medium">接头</th>
                <th className="px-2 py-1.5 text-left font-medium">候选元件（放几个就组合几种）</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--border)] bg-[var(--bg)]">
                <td className="px-2 py-1.5">
                  <div className="font-medium">受体载体</div>
                  <div className="text-[10px] text-[var(--muted)]">骨架</div>
                </td>
                <td className="mono px-2 py-1.5 text-[var(--muted)]">
                  {acceptors[0] && enzyme
                    ? (() => {
                        const sites = fusionSitesOf(acceptors[0], enzyme);
                        return sites ? `${sites.upstream} → ${sites.downstream}` : '读不出接头';
                      })()
                    : '由所选载体决定'}
                </td>
                <td className="px-2 py-1.5">
                  <PartPicker label="受体载体" docs={docs} chosen={assigned[ACCEPTOR] ?? []} onAdd={(id) => add(ACCEPTOR, id)} onRemove={(id) => remove(ACCEPTOR, id)} byId={byId} />
                </td>
              </tr>
              {standard.slots.map((s) => {
                const chosen = assigned[slotKey(s)] ?? [];
                const bad = checks.filter((c) => c.slot.id === s.id && !c.ok);
                return (
                  <tr key={s.id} className="border-t border-[var(--border)] align-top">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{s.id}</div>
                      <div className="text-[10px] text-[var(--muted)]">{s.label}</div>
                    </td>
                    <td className="mono whitespace-nowrap px-2 py-1.5 text-[var(--muted)]">
                      {s.upstream} → {s.downstream}
                    </td>
                    <td className="px-2 py-1.5">
                      <PartPicker label={s.id} docs={docs} chosen={chosen} onAdd={(id) => add(slotKey(s), id)} onRemove={(id) => remove(slotKey(s), id)} byId={byId} />
                      {bad.map((c) =>
                        c.problems
                          .filter((p) => p.severity === 'error')
                          .map((p) => (
                            <div key={`${c.part.id}-${p.message}`} className="mt-1 text-[11px] text-red-600">
                              {p.message}
                            </div>
                          )),
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {chain && (
          <div className="flex flex-col gap-1">
            {chain.ok ? (
              <p className="flex items-center gap-1 text-green-600">
                <Check size={12} /> 接头首尾相接{chain.hasAcceptor ? '并可环化' : '（未指定受体载体，产物为线性）'}
              </p>
            ) : (
              chain.gaps.map((gap) => (
                <p key={gap} className="flex items-start gap-1 text-amber-600">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {gap}
                </p>
              ))
            )}
          </div>
        )}

        <Domestication standard={standard} />

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
          <span className="text-[var(--muted)]">
            将生成 <b className="text-[var(--text)]">{used.length >= 1 && acceptors.length ? combinationCount : 0}</b> 个组合
          </span>
          <label className="flex items-center gap-1">
            上限
            <Select aria-label="组合上限" className="w-20" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[8, 24, 48, 96, 384].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !enzyme || used.length < 1 || !acceptors.length || errors.length > 0}
            onClick={build}
          >
            <Sparkles size={12} /> {busy ? '装配中…' : '生成全部组合'}
          </Button>
        </div>
        {errors.length > 0 && <p className="text-red-600">有 {errors.length} 个元件的接头与所在位置不符，先修正再装配。</p>}

        {results && (
          <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-2">
            <div className="flex items-center gap-2">
              <b>{results.length} 个产物</b>
              {notAttempted > 0 && <Badge tone="amber">还有 {notAttempted} 个组合未尝试（受上限限制）</Badge>}
              {failures.length > 0 && <Badge tone="red">{failures.length} 个组合装不起来</Badge>}
              <div className="flex-1" />
              <Button size="sm" variant="primary" disabled={!results.length} onClick={openAll}>
                全部打开为标签页
              </Button>
            </div>
            <div className="max-h-48 overflow-auto rounded-md border border-[var(--border)]">
              <table className="w-full border-collapse">
                <tbody>
                  {results.map((r) => (
                    <tr key={r.product.name} className="border-t border-[var(--border)] first:border-0">
                      <td className="px-2 py-1 font-medium">{r.product.name}</td>
                      <td className="px-2 py-1 text-[var(--muted)]">{r.product.length.toLocaleString()} bp</td>
                      <td className="px-2 py-1">
                        <Badge tone={r.fidelityScore >= 0.8 ? 'green' : r.fidelityScore >= 0.6 ? 'amber' : 'red'}>
                          保真度 {r.fidelityScore.toFixed(2)}
                        </Badge>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <Button
                          size="sm"
                          onClick={() => {
                            useWorkbench.getState().openDocs([r.product]);
                            setTool(null);
                          }}
                        >
                          打开
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {failures.map((f) => (
                    <tr key={f.combination.join('-')} className="border-t border-[var(--border)]">
                      <td className="px-2 py-1 text-[var(--muted)]">{f.combination.join(' + ')}</td>
                      <td className="px-2 py-1 text-red-600" colSpan={3}>
                        {f.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function PartPicker({
  docs,
  chosen,
  byId,
  label,
  onAdd,
  onRemove,
}: {
  docs: PlasmidDocument[];
  chosen: string[];
  byId: Map<string, PlasmidDocument>;
  label: string;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {chosen.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 rounded bg-[var(--bg)] px-1.5 py-0.5">
          {byId.get(id)?.name ?? id}
          <button aria-label="移除" className="text-[var(--muted)] hover:text-red-600" onClick={() => onRemove(id)}>
            <X size={10} />
          </button>
        </span>
      ))}
      <Select
        aria-label={`添加元件到 ${label}`}
        className="w-36"
        value=""
        onChange={(e) => {
          onAdd(e.target.value);
          e.target.value = '';
        }}
      >
        <option value="">+ 添加…</option>
        {docs
          .filter((d) => !chosen.includes(d.id))
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
      </Select>
    </div>
  );
}

/**
 * Turn a stretch of the active sequence into a part for one position: the primers get
 * the enzyme site and the position's fusion sites as tails. This is the step that makes
 * an ordinary gene usable in the matrix above.
 */
function Domestication({ standard }: { standard: MocloStandard }) {
  const doc = useWorkbench(selectActiveDoc);
  const selection = useWorkbench((s) => s.selection);
  const [slotId, setSlotId] = useState(standard.slots[0].id);
  const slot = standard.slots.find((s) => s.id === slotId) ?? standard.slots[0];
  const range = selection
    ? { start: selection.start, end: selection.end }
    : doc
      ? { start: 0, end: doc.length }
      : null;

  const design: SlotPrimerDesign | null = useMemo(
    () => (doc && range && range.end > range.start ? designSlotPrimers(doc, range, slot, standard) : null),
    [doc, range?.start, range?.end, slot, standard],
  );

  const addToDoc = () => {
    if (!doc || !design) return;
    if (
      replaceIfCurrent(
        doc,
        addPrimersToDoc(doc, [design.forward, design.reverse], `为 ${slot.id} 位设计引物`),
        `${doc.name} 已改变，请重新设计`,
      )
    ) {
      useWorkbench.getState().notify(`已把 ${slot.id} 位的两条引物加入 ${doc.name}`);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="把当前序列做成元件（domestication）"
          hint={
            doc
              ? selection
                ? `选区 ${selection.start + 1}..${selection.end}（${selection.end - selection.start} bp）`
                : `未选区，按整条 ${doc.name} 计算；在序列或图谱上拖选可改范围`
              : '先打开一条序列'
          }
        >
          <Select aria-label="要做成的位置" className="w-64" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
            {standard.slots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} {s.code} — {s.upstream} → {s.downstream}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex-1" />
        <Button size="sm" disabled={!design} onClick={addToDoc}>
          加入当前序列的引物
        </Button>
      </div>
      {design && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <span className="w-8 shrink-0 text-[var(--muted)]">F</span>
            <span className="mono break-all">
              <b>{design.forward.tailSequence}</b>
              {design.forward.sequence.slice(design.forward.tailSequence.length)}
            </span>
            <span className="shrink-0 text-[var(--muted)]">{design.forward.tmAnnealing.toFixed(1)} °C</span>
          </div>
          <div className="flex gap-2">
            <span className="w-8 shrink-0 text-[var(--muted)]">R</span>
            <span className="mono break-all">
              <b>{design.reverse.tailSequence}</b>
              {design.reverse.sequence.slice(design.reverse.tailSequence.length)}
            </span>
            <span className="shrink-0 text-[var(--muted)]">{design.reverse.tmAnnealing.toFixed(1)} °C</span>
          </div>
          {design.warnings.map((w) => (
            <p key={w} className={design.internalSites && w.includes('domestication') ? 'text-red-600' : 'text-[var(--muted)]'}>
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
