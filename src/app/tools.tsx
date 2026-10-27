// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
// Sequence tools: motif search, back-translation and the multiple-alignment view.
import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import type { PlasmidDocument } from '../types/schema';
import { CODON_USAGE, codonAdaptationIndex, type CodonUsageOrganism, type MotifHit } from '../modules/seq-engine';
import type { MsaResult } from '../modules/alignment-gel';
import { MultipleAlignmentViewer } from '../modules/canvas-ui';
import { callBio } from './bio-client';
import { newDocument, openProduct, resolveEnzymes } from './actions';
import { selectActiveDoc, useWorkbench } from './store';
import { Badge, Button, Dialog, Field, Input, Select, cn } from './ui';

export function FindDialog() {
  const open = useWorkbench((s) => s.tool === 'find');
  const setTool = useWorkbench((s) => s.setTool);
  const doc = useWorkbench(selectActiveDoc);
  const setSelection = useWorkbench((s) => s.setSelection);
  const [pattern, setPattern] = useState('');
  const [protein, setProtein] = useState(false);
  const [mismatches, setMismatches] = useState(0);
  const [hits, setHits] = useState<MotifHit[] | null>(null);
  const [current, setCurrent] = useState(0);

  // Searching (and moving the selection to the first hit) only while the dialog is open.
  useEffect(() => {
    const q = pattern.trim();
    if (!open || !doc || q.length < (protein ? 2 : 3)) {
      setHits(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      callBio('searchMotif', doc, q, { maxMismatches: protein ? 0 : mismatches, bothStrands: true, protein }).then((r) => {
        if (!alive) return;
        setHits(r);
        setCurrent(0);
        if (r[0]) setSelection({ start: r[0].start, end: r[0].end });
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, doc, pattern, protein, mismatches, setSelection]);

  const go = (i: number) => {
    if (!hits?.length) return;
    const k = (i + hits.length) % hits.length;
    setCurrent(k);
    setSelection({ start: hits[k].start, end: hits[k].end });
  };

  return (
    <Dialog open={open} onClose={() => setTool(null)} title="查找序列" width={620}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Field label={protein ? '氨基酸模式（X 为任意）' : 'DNA 模式（支持 IUPAC：N R Y W S …）'}>
              <Input
                autoFocus
                className="mono"
                value={pattern}
                onChange={(e) => setPattern(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && go(current + (e.shiftKey ? -1 : 1))}
                placeholder={protein ? 'MVSKGEE' : 'GAATTC'}
              />
            </Field>
          </div>
          <Field label="类型">
            <Select value={protein ? 'protein' : 'dna'} onChange={(e) => setProtein(e.target.value === 'protein')}>
              <option value="dna">DNA</option>
              <option value="protein">蛋白（6 框翻译）</option>
            </Select>
          </Field>
          {!protein && (
            <Field label="允许错配">
              <Select value={mismatches} onChange={(e) => setMismatches(Number(e.target.value))}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {hits && (
          <div className="flex items-center gap-2 text-xs">
            <span>{hits.length ? `第 ${current + 1} / ${hits.length} 个命中` : '无命中'}</span>
            <Button size="sm" disabled={!hits.length} onClick={() => go(current - 1)}>
              上一个
            </Button>
            <Button size="sm" disabled={!hits.length} onClick={() => go(current + 1)}>
              下一个
            </Button>
          </div>
        )}
        {!!hits?.length && (
          <div className="max-h-64 overflow-auto rounded-md border border-[var(--border)]">
            <table className="w-full text-xs">
              <tbody>
                {hits.map((h, i) => (
                  <tr
                    key={`${h.start}-${h.strand}`}
                    className={cn('cursor-pointer border-t border-[var(--border)] first:border-0', i === current && 'bg-blue-50 dark:bg-blue-950/40')}
                    onClick={() => go(i)}
                  >
                    <td className="mono p-1.5">
                      {h.start + 1}..{h.end}
                    </td>
                    <td>{h.strand === 1 ? '→' : '←'}</td>
                    <td className="mono">{h.matched}</td>
                    <td>{h.mismatches > 0 && <Badge tone="amber">{h.mismatches} 错配</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}

const ORGANISMS = Object.keys(CODON_USAGE) as CodonUsageOrganism[];

export function BackTranslateDialog() {
  const open = useWorkbench((s) => s.tool === 'backtranslate');
  const setTool = useWorkbench((s) => s.setTool);
  const [protein, setProtein] = useState('');
  const [organism, setOrganism] = useState<CodonUsageOrganism>('E. coli');
  const [strategy, setStrategy] = useState<'most-frequent' | 'weighted'>('most-frequent');
  const [avoid, setAvoid] = useState('EcoRI, BamHI, XhoI, NotI');
  const [error, setError] = useState<string | null>(null);
  // A result keeps the settings it was computed with; editing the inputs does not relabel it.
  const [computed, setComputed] = useState<{ dna: string; organism: CodonUsageOrganism; strategy: typeof strategy; aa: string } | null>(null);
  const aa = protein.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY*]/g, '');
  const result = computed?.dna ?? null;
  const outdated = !!computed && (computed.aa !== aa || computed.organism !== organism || computed.strategy !== strategy);
  const cai = useMemo(() => (computed ? codonAdaptationIndex(computed.dna, computed.organism) : null), [computed]);

  const run = async () => {
    setError(null);
    const names = avoid.split(/[,\s]+/).filter(Boolean);
    const { enzymes, missing } = resolveEnzymes(names);
    if (missing.length) return setError(`未知酶：${missing.join(', ')}`);
    try {
      const dna = await callBio('backTranslate', aa, organism, { strategy, avoidSites: enzymes.map((e) => e.recognitionSeq), seed: 1 });
      setComputed({ dna, organism, strategy, aa });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onClose={() => setTool(null)} title="反向翻译 / 密码子优化" width={720}>
      <div className="flex flex-col gap-3">
        <Field label={`蛋白序列（${aa.length} aa）`}>
          <textarea
            className="mono h-28 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/40"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            placeholder="MVSKGEELFTGVVPILVELDGDVNGHKF…"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="宿主">
            <Select value={organism} onChange={(e) => setOrganism(e.target.value as CodonUsageOrganism)}>
              {ORGANISMS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          </Field>
          <Field label="策略">
            <Select value={strategy} onChange={(e) => setStrategy(e.target.value as typeof strategy)}>
              <option value="most-frequent">最高频密码子</option>
              <option value="weighted">按使用频率加权</option>
            </Select>
          </Field>
          <Field label="避开酶切位点">
            <Input value={avoid} onChange={(e) => setAvoid(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" disabled={aa.length < 2} onClick={run}>
            <Play size={14} /> 反向翻译
          </Button>
          {computed && (
            <Button
              onClick={() => {
                const { dna, organism: host, strategy: how } = computed;
                openProduct(newDocument(`backtranslated_${host.replace(/[^A-Za-z]/g, '')}`, dna, 'linear', `反向翻译（${host}，${how}）`));
                setTool(null);
              }}
            >
              作为新序列打开
            </Button>
          )}
          {outdated && <span className="self-center text-xs text-amber-600">输入或设置已修改，下方结果仍是上次计算（{computed.organism}，{computed.strategy}），请重新运行</span>}
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        {result && (
          <>
            <div className="text-xs text-[var(--muted)]">
              {result.length} bp · CAI {cai?.toFixed(3)} · GC {((100 * (result.match(/[GC]/g)?.length ?? 0)) / result.length).toFixed(1)}%
            </div>
            <div className="mono max-h-40 overflow-auto break-all rounded bg-[var(--bg)] p-2 text-xs">{result}</div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function regionOf(doc: PlasmidDocument, useSelection: boolean, sel: { start: number; end: number } | null): string {
  if (!useSelection || !sel || sel.start === sel.end) return doc.sequence;
  return sel.start < sel.end ? doc.sequence.slice(sel.start, sel.end) : doc.sequence.slice(sel.start) + doc.sequence.slice(0, sel.end);
}

export function AlignView({ theme }: { theme: 'light' | 'dark' | 'publication' }) {
  const docs = useWorkbench((s) => s.docs);
  const activeId = useWorkbench((s) => s.activeId);
  const selection = useWorkbench((s) => s.selection);
  const [ids, setIds] = useState<string[]>(() => docs.slice(0, 3).map((d) => d.id));
  const [useSelection, setUseSelection] = useState(false);
  const [scheme, setScheme] = useState<'nucleotide' | 'identity' | 'clustal' | 'none'>('nucleotide');
  const [diffOnly, setDiffOnly] = useState(false);
  const [result, setResult] = useState<MsaResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const toggle = (id: string) => setIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const alignRequest = useWorkbench((s) => s.alignRequest);
  useEffect(() => {
    if (!alignRequest) return;
    setIds(alignRequest.ids);
    run(alignRequest.ids);
  }, [alignRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (wanted: string[] = ids) => {
    const docs = useWorkbench.getState().docs;
    const picked = wanted.map((id) => docs.find((d) => d.id === id)).filter((d): d is PlasmidDocument => !!d);
    if (picked.length < 2) return setError('至少选择 2 条序列');
    const inputs = picked.map((d) => ({ id: d.id, name: d.name, sequence: regionOf(d, useSelection && d.id === activeId, selection) }));
    const total = inputs.reduce((a, x) => a + x.sequence.length, 0);
    if (total > 120_000) return setError(`序列总长 ${total.toLocaleString()} bp 过大（上限 120 kb），请缩小范围`);
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      setResult(await callBio('multipleSequenceAlignment', inputs));
      setElapsed(performance.now() - t0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] p-2 text-xs">
        {docs.map((d) => (
          <label key={d.id} className="flex items-center gap-1 rounded bg-[var(--bg)] px-1.5 py-0.5">
            <input type="checkbox" checked={ids.includes(d.id)} onChange={() => toggle(d.id)} />
            {d.name}
          </label>
        ))}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={useSelection} onChange={(e) => setUseSelection(e.target.checked)} /> 当前序列只用选区
        </label>
        <div className="flex-1" />
        <Select value={scheme} onChange={(e) => setScheme(e.target.value as typeof scheme)}>
          <option value="nucleotide">按碱基着色</option>
          <option value="identity">按一致性着色</option>
          <option value="clustal">Clustal 配色</option>
          <option value="none">不着色</option>
        </Select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} /> 只显示差异
        </label>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => run()}>
          <Play size={13} /> {busy ? '比对中…' : '多序列比对'}
        </Button>
      </div>
      {error && <div className="p-2 text-xs text-red-600">{error}</div>}
      {result ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <MultipleAlignmentViewer
              rows={result.rows}
              consensus={result.consensus}
              conservation={result.conservation}
              theme={theme}
              colorScheme={scheme}
              referenceRowId={diffOnly ? result.rows[0]?.id : undefined}
              height={420}
            />
          </div>
          <div className="overflow-auto border-t border-[var(--border)] p-2 text-xs">
            <div className="mb-1 text-[var(--muted)]">
              {result.rows.length} 条序列 · {result.columns.toLocaleString()} 列 · {elapsed.toFixed(0)} ms · 同一性矩阵 (%)
            </div>
            <table className="mono">
              <tbody>
                <tr>
                  <td />
                  {result.rows.map((r) => (
                    <td key={r.id} className="px-2 font-semibold">
                      {r.name}
                    </td>
                  ))}
                </tr>
                {result.rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="pr-2 font-semibold">{r.name}</td>
                    {result.identityMatrix[i].map((v, j) => (
                      <td key={j} className="px-2 text-right">
                        {v.toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-[var(--muted)]">选择 2 条以上序列后点击「多序列比对」</div>
      )}
    </div>
  );
}
