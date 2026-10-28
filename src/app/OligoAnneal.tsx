// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Annealed oligo duplexes: design the pair to order for a short insert, or paste a pair
// you already have and see the duplex it gives. The product is an ordinary linear
// fragment, so the ligation and Golden Gate wizards take it like any digested insert.
import { useMemo, useState } from 'react';
import { Copy, FlaskConical, Plus } from 'lucide-react';
import type { OverhangEnd } from '../types/schema';
import {
  annealOligos,
  designAnnealedOligos,
  describeEnd,
  reverseSequence,
  type OligoAnnealingResult,
} from '../modules/cloning-primer';
import { uid } from './actions';
import { useWorkbench } from './store';
import { Badge, Button, Dialog, Field, Input, Select, Tabs } from './ui';

type Mode = 'design' | 'anneal';
type EndType = OverhangEnd['type'];

const CLEAN = (text: string) => text.toUpperCase().replace(/[^ACGTN]/g, '');

/**
 * The duplex drawn as the two strands actually lie: the top strand 5'->3' left to
 * right, the bottom strand underneath running 3'->5', and a rung for every pair.
 */
function alignment(top: string, bottom: string, offset: number, duplexLength: number, mismatches: number[]) {
  const topPad = Math.max(0, -offset);
  const bottomPad = Math.max(0, offset);
  const rungStart = Math.abs(offset);
  const rungs = Array.from({ length: duplexLength }, (_, i) => (mismatches.includes(i) ? '×' : '|')).join('');
  return [
    `5'-${' '.repeat(topPad)}${top}-3'`,
    `   ${' '.repeat(rungStart)}${rungs}`,
    `3'-${' '.repeat(bottomPad)}${reverseSequence(bottom)}-5'`,
  ].join('\n');
}

function EndFields({
  label,
  hint,
  type,
  sequence,
  onType,
  onSequence,
}: {
  label: string;
  hint: string;
  type: EndType;
  sequence: string;
  onType: (t: EndType) => void;
  onSequence: (s: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <Select className="w-28" value={type} onChange={(e) => onType(e.target.value as EndType)}>
          <option value="5-prime">5′ 突出</option>
          <option value="3-prime">3′ 突出</option>
          <option value="blunt">平末端</option>
        </Select>
        <Input
          className="mono w-40"
          disabled={type === 'blunt'}
          placeholder={type === 'blunt' ? '—' : 'AATT'}
          value={sequence}
          onChange={(e) => onSequence(CLEAN(e.target.value))}
        />
      </div>
    </Field>
  );
}

export function OligoAnnealDialog() {
  const open = useWorkbench((s) => s.tool === 'oligo');
  const setTool = useWorkbench((s) => s.setTool);
  const docs = useWorkbench((s) => s.docs);
  const [mode, setMode] = useState<Mode>('design');
  const [insert, setInsert] = useState('');
  const [leftType, setLeftType] = useState<EndType>('5-prime');
  const [leftSeq, setLeftSeq] = useState('');
  const [rightType, setRightType] = useState<EndType>('5-prime');
  const [rightSeq, setRightSeq] = useState('');
  const [phosphorylated, setPhosphorylated] = useState(false);
  const [name, setName] = useState('');
  const [topOligo, setTopOligo] = useState('');
  const [bottomOligo, setBottomOligo] = useState('');
  const [mismatchBudget, setMismatchBudget] = useState(0);

  // Fragments that already carry ends: a digested vector can hand over its overhangs.
  const cutFragments = useMemo(
    () => docs.filter((d) => d.topology === 'linear' && d.linearEnds),
    [docs],
  );

  const outcome = useMemo((): { result: OligoAnnealingResult; top: string; bottom: string } | { error: string } | null => {
    try {
      if (mode === 'design') {
        const core = CLEAN(insert);
        if (core.length < 2) return null;
        const design = designAnnealedOligos({
          insert: core,
          leftOverhang: { type: leftType, sequence: leftType === 'blunt' ? '' : leftSeq },
          rightOverhang: { type: rightType, sequence: rightType === 'blunt' ? '' : rightSeq },
          phosphorylated,
          name: name.trim() || undefined,
        });
        return { result: design.result, top: design.top, bottom: design.bottom };
      }
      const top = CLEAN(topOligo);
      const bottom = CLEAN(bottomOligo);
      if (top.length < 4 || bottom.length < 4) return null;
      const result = annealOligos(top, bottom, {
        maxMismatches: mismatchBudget,
        phosphorylated,
        name: name.trim() || undefined,
      });
      return { result, top, bottom };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [mode, insert, leftType, leftSeq, rightType, rightSeq, phosphorylated, name, topOligo, bottomOligo, mismatchBudget]);

  const ok = outcome && 'result' in outcome ? outcome : null;

  const takeEnds = (id: string) => {
    const fragment = cutFragments.find((d) => d.id === id);
    if (!fragment?.linearEnds) return;
    // Going round the circle, the insert sits between the vector's right end and its
    // left end, so it has to present the ends that face it.
    const { left, right } = fragment.linearEnds;
    setLeftType(right.type);
    setLeftSeq(right.sequence);
    setRightType(left.type);
    setRightSeq(left.sequence);
    useWorkbench.getState().notify(`已套用 ${fragment.name} 的末端：${describeEnd(right)} / ${describeEnd(left)}`);
  };

  const openFragment = () => {
    if (!ok) return;
    useWorkbench.getState().openDocs([ok.result.duplex]);
    useWorkbench.getState().notify(
      `已生成双链片段 ${ok.result.duplex.name}（${ok.result.duplexLength} bp 配对，${describeEnd(ok.result.left)} / ${describeEnd(ok.result.right)}）`,
    );
    setTool(null);
  };

  const saveOligos = () => {
    if (!ok) return;
    const stem = (name.trim() || ok.result.duplex.name).replace(/\s+/g, '_');
    const st = useWorkbench.getState();
    st.setPrimerLibrary([
      ...st.primerLibrary,
      { id: uid('lp'), name: `${stem}_top`, sequence: ok.top, note: '退火寡核苷酸' },
      { id: uid('lp'), name: `${stem}_bottom`, sequence: ok.bottom, note: '退火寡核苷酸' },
    ]);
    st.notify('两条寡核苷酸已存入引物库');
  };

  const copyOligos = async () => {
    if (!ok) return;
    const stem = (name.trim() || ok.result.duplex.name).replace(/\s+/g, '_');
    try {
      await navigator.clipboard.writeText(`${stem}_top\t${ok.top}\n${stem}_bottom\t${ok.bottom}\n`);
      useWorkbench.getState().notify('已复制「名称 + 序列」两行，可直接粘贴到订购单');
    } catch {
      useWorkbench.getState().notify('浏览器拒绝了剪贴板访问；请手动复制');
    }
  };

  return (
    <Dialog open={open} onClose={() => setTool(null)} title="寡核苷酸退火（短片段直接连接）" width={760}>
      <div className="flex flex-col gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={mode}
            onChange={setMode}
            items={[
              { value: 'design', label: '设计要订的引物' },
              { value: 'anneal', label: '已有两条引物' },
            ]}
          />
          <div className="flex-1" />
          <Input className="w-40" placeholder="片段名称（可选）" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <p className="text-[var(--muted)]">
          两条部分互补的引物退火即得一段带末端的双链片段，不需要 PCR。sgRNA 间隔序列、短 linker、接头、标签都这么连。
          产物是普通线性片段，可直接送入酶切连接或 Golden Gate 向导。
        </p>

        {mode === 'design' ? (
          <div className="flex flex-col gap-3">
            <Field label="要插入的双链核心序列（上链 5′→3′）" hint="只写配对的部分，突出末端在下面单独填">
              <textarea
                className="mono h-16 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 outline-none"
                value={insert}
                onChange={(e) => setInsert(CLEAN(e.target.value))}
                placeholder="GTCAGGGTTCTGGATATCTG"
              />
            </Field>
            {cutFragments.length > 0 && (
              <Field label="从已酶切的片段取末端" hint="选一个酶切后的载体骨架，自动填入它两端对应的突出末端">
                <Select value="" onChange={(e) => e.target.value && takeEnds(e.target.value)}>
                  <option value="">选择片段…</option>
                  {cutFragments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}（{describeEnd(d.linearEnds!.left)} / {describeEnd(d.linearEnds!.right)}）
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="flex flex-wrap gap-4">
              <EndFields label="左端" hint="5′ 突出的碱基属于上链" type={leftType} sequence={leftSeq} onType={setLeftType} onSequence={setLeftSeq} />
              <EndFields label="右端" hint="5′ 突出的碱基属于下链" type={rightType} sequence={rightSeq} onType={setRightType} onSequence={setRightSeq} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="上链引物（5′→3′）">
              <textarea
                className="mono h-14 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 outline-none"
                value={topOligo}
                onChange={(e) => setTopOligo(CLEAN(e.target.value))}
                placeholder="CACCGGTCAGGGTTCTGGATATCTG"
              />
            </Field>
            <Field label="下链引物（5′→3′）">
              <textarea
                className="mono h-14 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 outline-none"
                value={bottomOligo}
                onChange={(e) => setBottomOligo(CLEAN(e.target.value))}
                placeholder="AAACCAGATATCCAGAACCCTGAC"
              />
            </Field>
            <label className="flex items-center gap-2">
              配对区允许错配
              <Select className="w-16" value={mismatchBudget} onChange={(e) => setMismatchBudget(Number(e.target.value))}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        )}

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={phosphorylated} onChange={(e) => setPhosphorylated(e.target.checked)} />
          引物已 5′ 磷酸化（订购时加磷酸修饰，或用 T4 PNK 处理）
        </label>

        {outcome && 'error' in outcome && <p className="rounded-md bg-red-500/10 px-3 py-2 text-red-600">{outcome.error}</p>}

        {ok && (
          <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">{ok.result.duplexLength} bp 配对</Badge>
              <Badge tone="blue">Tm {ok.result.tm.toFixed(1)} °C</Badge>
              <Badge tone="slate">左 {describeEnd(ok.result.left)}</Badge>
              <Badge tone="slate">右 {describeEnd(ok.result.right)}</Badge>
              {ok.result.mismatchPositions.length > 0 && <Badge tone="amber">{ok.result.mismatchPositions.length} 处错配</Badge>}
            </div>
            <pre className="mono overflow-x-auto rounded bg-[var(--bg)] p-2 text-[11px] leading-5">
              {alignment(ok.top, ok.bottom, ok.result.offset, ok.result.duplexLength, ok.result.mismatchPositions)}
            </pre>
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <span className="w-14 shrink-0 text-[var(--muted)]">上链</span>
                <span className="mono break-all">{ok.top}</span>
                <span className="shrink-0 text-[var(--muted)]">{ok.top.length} nt</span>
              </div>
              <div className="flex gap-2">
                <span className="w-14 shrink-0 text-[var(--muted)]">下链</span>
                <span className="mono break-all">{ok.bottom}</span>
                <span className="shrink-0 text-[var(--muted)]">{ok.bottom.length} nt</span>
              </div>
            </div>
            {ok.result.warnings.length > 0 && (
              <ul className="list-inside list-disc text-[var(--muted)]">
                {ok.result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" disabled={!ok} onClick={copyOligos}>
            <Copy size={12} /> 复制订购单两行
          </Button>
          <Button size="sm" disabled={!ok} onClick={saveOligos}>
            <Plus size={12} /> 存入引物库
          </Button>
          <Button size="sm" variant="primary" disabled={!ok} onClick={openFragment}>
            <FlaskConical size={12} /> 作为双链片段打开
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
