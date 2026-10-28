// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Copy, Microscope, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CutSite, ORF, PlasmidDocument, SequenceFeature } from '../types/schema';
import { COMMERCIAL_ENZYMES, ENZYME_SETS, calcGcPercent, recommendDoubleDigestBuffer, reverseComplement, translateDna } from '../modules/seq-engine';
import { rangeLabel, rangeSequence } from '../lib/ranges';
import { evaluateOligoThermodynamics } from '../modules/cloning-primer';
import { callBio } from './bio-client';
import { digestToGel, historyNode, uid } from './actions';
import { FeatureEditor, PrimerEditor } from './editors';
import { ALL_COMMERCIAL_SET, useWorkbench, type NebBuffer } from './store';
import { Badge, Button, Input, Select, cn } from './ui';
import { t as translate, useT } from '../lib/i18n';

const BUFFERS: NebBuffer[] = ['r1.1', 'r2.1', 'r3.1', 'rCutSmart'];

export function filterCutSites(sites: CutSite[], f: ReturnType<typeof useWorkbench.getState>['enzymeFilter']): CutSite[] {
  const q = f.query.trim().toLowerCase();
  return sites.filter(
    (s) =>
      (!f.uniqueOnly || s.totalCutsInPlasmid === 1) &&
      (!f.excludeMethylationBlocked || !s.isMethylationBlocked) &&
      (!f.buffer || (s.enzyme.nebBuffers?.[f.buffer] ?? 0) >= 75) &&
      (!q || s.enzyme.name.toLowerCase().includes(q) || s.enzyme.recognitionSeq.toLowerCase().includes(q)),
  );
}

export function EnzymePanel({ doc, sites }: { doc: PlasmidDocument; sites: CutSite[] }) {
  const t = useT();
  const filter = useWorkbench((s) => s.enzymeFilter);
  const setFilter = useWorkbench((s) => s.setEnzymeFilter);
  const setSelection = useWorkbench((s) => s.setSelection);
  const setView = useWorkbench((s) => s.setView);
  const [picked, setPicked] = useState<string[]>([]);
  const enzymeSetId = useWorkbench((s) => s.enzymeSetId);
  const customSets = useWorkbench((s) => s.customEnzymeSets);
  const setEnzymeSet = useWorkbench((s) => s.setEnzymeSet);
  const saveCustomSet = useWorkbench((s) => s.saveCustomEnzymeSet);
  const deleteCustomSet = useWorkbench((s) => s.deleteCustomEnzymeSet);
  const isCustom = customSets.some((c) => c.id === enzymeSetId);
  const digestPlan = useMemo(() => {
    if (picked.length < 2) return null;
    const enzymes = picked.map((n) => sites.find((x) => x.enzyme.name === n)?.enzyme).filter((e): e is NonNullable<typeof e> => !!e);
    try {
      return enzymes.length >= 2 ? recommendDoubleDigestBuffer(enzymes) : null;
    } catch {
      return null;
    }
  }, [picked, sites]);

  const saveSet = () => {
    const name = window.prompt(t('将勾选的 {v0} 种酶保存为酶集，名称：', { v0: picked.length }), t('我的酶集'));
    if (!name?.trim()) return;
    saveCustomSet({ id: uid('set'), name: name.trim(), description: t('自定义酶集'), enzymeNames: picked });
  };

  const groups = useMemo(() => {
    const m = new Map<string, CutSite[]>();
    for (const s of filterCutSites(sites, filter)) {
      const list = m.get(s.enzyme.name) ?? [];
      list.push(s);
      m.set(s.enzyme.name, list);
    }
    return [...m.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
  }, [sites, filter]);

  const toggle = (name: string) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] p-2">
        <Select aria-label={t('酶集')} value={enzymeSetId} onChange={(e) => setEnzymeSet(e.target.value)} title={t('用于扫描与图谱显示的酶集')}>
          <option value={ALL_COMMERCIAL_SET}>全部市售酶 ({COMMERCIAL_ENZYMES.length})</option>
          <optgroup label={t('预设酶集')}>
            {ENZYME_SETS.map((es) => (
              <option key={es.id} value={es.id} title={es.description}>
                {es.name} ({es.enzymeNames.length})
              </option>
            ))}
          </optgroup>
          {customSets.length > 0 && (
            <optgroup label={t('自定义酶集')}>
              {customSets.map((es) => (
                <option key={es.id} value={es.id}>
                  {es.name} ({es.enzymeNames.length})
                </option>
              ))}
            </optgroup>
          )}
        </Select>
        {isCustom && (
          <Button size="sm" variant="ghost" onClick={() => deleteCustomSet(enzymeSetId)} aria-label={t('删除酶集')} title={t('删除此自定义酶集')}>
            <Trash2 size={12} />
          </Button>
        )}
        <div className="w-48">
          <Input placeholder={t('搜索酶 / 识别序列')} value={filter.query} onChange={(e) => setFilter({ query: e.target.value })} />
        </div>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={filter.uniqueOnly} onChange={(e) => setFilter({ uniqueOnly: e.target.checked })} /> 单切点
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={filter.excludeMethylationBlocked}
            onChange={(e) => setFilter({ excludeMethylationBlocked: e.target.checked })}
          />{' '}
          排除甲基化阻断
        </label>
        <Select value={filter.buffer ?? ''} onChange={(e) => setFilter({ buffer: (e.target.value || null) as NebBuffer | null })}>
          <option value="">{t('任意 Buffer')}</option>
          {BUFFERS.map((b) => (
            <option key={b} value={b}>
              NEB {b} ≥75%
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button size="sm" disabled={!picked.length} onClick={saveSet}>
          {t('保存为酶集')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!picked.length}
          onClick={async () => {
            await digestToGel(doc, picked);
            setView('gel');
          }}
        >
          <Microscope size={13} /> {t('酶切并跑胶 ({v0})', { v0: picked.length })}
        </Button>
      </div>
      {digestPlan && (
        <div className="border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs">
          <b>{t('双酶切推荐：')}</b>
          {digestPlan.buffer === 'sequential' ? <Badge tone="amber">{t('分步酶切')}</Badge> : <Badge tone="green">NEB {digestPlan.buffer}</Badge>}{' '}
          {Object.entries(digestPlan.activities)
            .map(([n, a]) => `${n} ${a}%`)
            .join(' · ')}
          {digestPlan.temperatureC.length > 0 && <> · {[...new Set(digestPlan.temperatureC)].join('/')} °C</>}
          {[...digestPlan.starActivityWarning, ...digestPlan.notes].map((n, i) => (
            <div key={i} className="text-[var(--muted)]">
              {n}
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
          <thead className="sticky top-0 z-10 bg-[var(--panel)] text-left text-[var(--muted)] shadow-[0_1px_0_var(--border)]">
            <tr>
              <th className="w-8" />
              <th className="whitespace-nowrap">{t('酶')}</th>
              <th className="whitespace-nowrap">{t('识别序列')}</th>
              <th className="whitespace-nowrap text-right">{t('切点数')}</th>
              <th className="w-full">{t('切口位置（点击定位）')}</th>
              <th className="whitespace-nowrap">{t('末端')}</th>
              <th className="whitespace-nowrap">{t('甲基化')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([name, list]) => {
              const e = list[0].enzyme;
              return (
                <tr key={name} className={cn('border-t border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800/40', picked.includes(name) && 'bg-blue-50/60 dark:bg-blue-950/30')}>
                  <td>
                    <input type="checkbox" aria-label={t('选择 {v0}', { v0: name })} checked={picked.includes(name)} onChange={() => toggle(name)} />
                  </td>
                  <td className={cn('whitespace-nowrap font-medium', list.length === 1 && 'font-bold')}>
                    {name} {e.isTypeIIS && <Badge tone="blue">IIS</Badge>}
                  </td>
                  <td className="mono whitespace-nowrap">{e.recognitionSeq}</td>
                  <td className="text-right tabular-nums">{list[0].totalCutsInPlasmid}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {list.map((s) => (
                        <button
                          key={s.id}
                          className={cn('mono rounded px-1 hover:bg-blue-100 dark:hover:bg-blue-900/40', s.isMethylationBlocked && 'text-slate-400 line-through')}
                          onClick={() => setSelection({ start: s.position, end: (s.position + e.recognitionSeq.length) % doc.length || doc.length })}
                          title={`strand ${s.strand}`}
                        >
                          {s.cutPositionTop + 1}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="mono whitespace-nowrap">
                    {list[0].overhangType === 'blunt' ? t('平末端') : `${list[0].overhangType === '5-prime' ? "5'" : "3'"} ${list[0].overhangSeq}`}
                  </td>
                  <td className="whitespace-nowrap">
                    {list.some((s) => s.isMethylationBlocked) ? <Badge tone="red">{t('阻断')}</Badge> : <Badge tone="green">{t('可切')}</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!groups.length && <div className="p-6 text-center text-xs text-[var(--muted)]">{t('没有符合条件的酶切位点')}</div>}
      </div>
    </div>
  );
}

export function FeaturePanel({ doc }: { doc: PlasmidDocument }) {
  const t = useT();
  const setSelection = useWorkbench((s) => s.setSelection);
  const replaceDoc = useWorkbench((s) => s.replaceDoc);
  const [orfs, setOrfs] = useState<ORF[]>([]);
  const [tab, setTab] = useState<'features' | 'primers' | 'orfs'>('features');
  // undefined: closed; null: new feature; otherwise the feature being edited.
  const [editing, setEditing] = useState<SequenceFeature | null | undefined>(undefined);
  const [addingPrimer, setAddingPrimer] = useState(false);

  useEffect(() => {
    let alive = true;
    callBio('findAllORFs', doc, 75).then((r) => alive && setOrfs(r));
    return () => {
      alive = false;
    };
  }, [doc]);

  const removeFeature = (id: string) =>
    replaceDoc({
      ...doc,
      features: doc.features.filter((f) => f.id !== id),
      updatedAt: new Date().toISOString(),
      history: [...doc.history, historyNode('manual_edit', t('删除特征'))],
    });
  const removePrimer = (id: string) =>
    replaceDoc({ ...doc, primers: doc.primers.filter((p) => p.id !== id), updatedAt: new Date().toISOString() });
  const addOrfAsFeature = (o: ORF) =>
    replaceDoc({
      ...doc,
      features: [...doc.features, { id: `f-${o.id}`, name: `ORF ${o.start + 1}..${o.end}`, type: 'CDS', start: o.start, end: o.end, strand: o.strand, color: '#3b82f6', translation: o.aminoAcids }],
      updatedAt: new Date().toISOString(),
      history: [...doc.history, historyNode('manual_edit', t('将 ORF 添加为 CDS 特征'))],
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-[var(--border)] p-2">
        {(
          [
            ['features', t('特征 ({v0})', { v0: doc.features.length })],
            ['primers', t('引物 ({v0})', { v0: doc.primers.length })],
            ['orfs', `ORF (${orfs.length})`],
          ] as const
        ).map(([k, label]) => (
          <Button key={k} size="sm" variant={tab === k ? 'primary' : 'ghost'} onClick={() => setTab(k)}>
            {label}
          </Button>
        ))}
        <div className="flex-1" />
        {tab === 'features' && (
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus size={12} /> {t('添加特征')}
          </Button>
        )}
        {tab === 'primers' && (
          <Button size="sm" onClick={() => setAddingPrimer(true)}>
            <Plus size={12} /> {t('添加引物')}
          </Button>
        )}
      </div>
      <FeatureEditor doc={doc} feature={editing ?? null} open={editing !== undefined} onClose={() => setEditing(undefined)} />
      <PrimerEditor doc={doc} open={addingPrimer} onClose={() => setAddingPrimer(false)} />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
          <thead className="sticky top-0 z-10 bg-[var(--panel)] text-left text-[var(--muted)] shadow-[0_1px_0_var(--border)]">
            {tab === 'features' && (
              <tr>
                <th className="w-6" />
                <th>{t('名称')}</th>
                <th>{t('类型')}</th>
                <th>{t('位置')}</th>
                <th>{t('方向')}</th>
                <th className="w-20" />
              </tr>
            )}
            {tab === 'primers' && (
              <tr>
                <th>{t('名称')}</th>
                <th>{t('序列 5′→3′')}</th>
                <th>{t('结合位置')}</th>
                <th className="whitespace-nowrap">{t('退火 Tm')}</th>
                <th className="w-12" />
              </tr>
            )}
            {tab === 'orfs' && (
              <tr>
                <th>{t('读框')}</th>
                <th>{t('位置')}</th>
                <th>{t('长度')}</th>
                <th>{t('分子量')}</th>
                <th>pI</th>
                <th className="w-12" />
              </tr>
            )}
          </thead>
          <tbody>
            {tab === 'features' &&
              doc.features.map((f) => (
                <tr key={f.id} className="cursor-pointer border-t border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelection({ start: f.start, end: f.end })}>
                  <td>
                    <span className="inline-block h-3 w-3 rounded-sm align-middle" style={{ background: f.color }} />
                  </td>
                  <td className="font-medium">{f.name}</td>
                  <td className="text-[var(--muted)]">{f.type}</td>
                  <td className="mono whitespace-nowrap">{rangeLabel(f.start, f.end, doc.length)}</td>
                  <td className="whitespace-nowrap text-[var(--muted)]">{f.strand === -1 ? t('← 负链') : f.strand === 1 ? t('→ 正链') : '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), setEditing(f))} aria-label={t('编辑')}>
                      <Pencil size={12} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), removeFeature(f.id))} aria-label={t('删除')}>
                      <Trash2 size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
            {tab === 'primers' &&
              doc.primers.map((p) => (
                <tr key={p.id} className="cursor-pointer border-t border-[var(--border)] align-top hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelection({ start: p.bindingStart, end: p.bindingEnd })}>
                  <td className="whitespace-nowrap font-medium">{p.name}</td>
                  <td className="mono break-all">
                    {p.tailSequence && <span className="text-[var(--muted)]">{p.tailSequence.toLowerCase()}</span>}
                    {p.sequence.slice(p.tailSequence.length)}
                  </td>
                  <td className="mono whitespace-nowrap">
                    {rangeLabel(p.bindingStart, p.bindingEnd, doc.length)} {p.strand === -1 ? '←' : '→'}
                  </td>
                  <td className="whitespace-nowrap">{p.tmAnnealing.toFixed(1)} °C</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), removePrimer(p.id))} aria-label={t('删除')}>
                      <Trash2 size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
            {tab === 'orfs' &&
              orfs.map((o) => (
                <tr key={o.id} className="cursor-pointer border-t border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelection({ start: o.start, end: o.end })}>
                  <td>
                    <Badge tone="blue">{o.frame > 0 ? `+${o.frame}` : o.frame}</Badge>
                  </td>
                  <td className="mono whitespace-nowrap">{rangeLabel(o.start, o.end, doc.length)}</td>
                  <td>{Math.round(o.lengthBp / 3) - 1} aa</td>
                  <td>{o.mwKda.toFixed(1)} kDa</td>
                  <td>{o.pI.toFixed(2)}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), addOrfAsFeature(o))} aria-label={t('添加为特征')}>
                      <Plus size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InspectorCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--border)] p-2.5">
      <h3 className="mb-2 text-[11px] font-semibold text-[var(--muted)]">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[var(--muted)]">{k}</dt>
          <dd className="tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Inspector({ doc }: { doc: PlasmidDocument }) {
  const t = useT();
  const selection = useWorkbench((s) => s.selection);
  const highlight = useWorkbench((s) => s.highlight);
  const replaceDoc = useWorkbench((s) => s.replaceDoc);
  const sel = selection && selection.start !== selection.end ? rangeSequence(doc, selection) : '';
  const thermo = useMemo(() => (sel.length >= 8 && sel.length <= 60 ? evaluateOligoThermodynamics(sel) : null), [sel]);
  const methyl = doc.methylationProfile ?? { dam: true, dcm: true, cpg: false };
  // Whole-sequence GC only changes with the sequence, not with the selection.
  const gc = useMemo(() => calcGcPercent(doc.sequence), [doc.sequence]);

  const copy = (text: string, what: string) =>
    navigator.clipboard?.writeText(text).then(
      () => useWorkbench.getState().notify(t('已复制{v0}（{v1} 个字符）', { v0: what, v1: text.length.toLocaleString() })),
      () => useWorkbench.getState().notify(t('无法访问剪贴板')),
    );

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <InspectorCard title={t('序列')}>
        <div className="mb-2 break-words text-[13px] font-semibold">{doc.name}</div>
        <Facts
          rows={[
            [t('长度'), `${doc.length.toLocaleString()} bp`],
            [t('拓扑'), doc.topology === 'circular' ? t('环状') : t('线性')],
            ['GC', `${gc.toFixed(1)}%`],
            [t('特征 / 引物'), `${doc.features.length} / ${doc.primers.length}`],
          ]}
        />
        <div className="mt-3 text-[11px] text-[var(--muted)]" title={t('影响酶切位点是否被甲基化阻断的判断')}>
          {t('宿主甲基化')}
        </div>
        <div className="mt-1 flex gap-1.5">
          {(['dam', 'dcm', 'cpg'] as const).map((k) => (
            <label
              key={k}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5',
                methyl[k] ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300' : 'border-[var(--border)] text-[var(--muted)]',
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={methyl[k]}
                onChange={(e) => replaceDoc({ ...doc, methylationProfile: { ...methyl, [k]: e.target.checked } })}
              />
              {k === 'cpg' ? 'CpG' : k[0].toUpperCase() + k.slice(1)}
            </label>
          ))}
        </div>
      </InspectorCard>
      {highlight && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <b>AI 高亮 {highlight.start + 1}–{highlight.end}</b>：{highlight.reason}
        </section>
      )}
      <InspectorCard title={t('选区')}>
        {sel ? (
          <div className="flex flex-col gap-2">
            <Facts
              rows={[
                [t('位置'), `${selection!.start + 1} – ${selection!.end}`],
                [t('长度'), `${sel.length.toLocaleString()} bp`],
                ['GC', `${calcGcPercent(sel).toFixed(1)}%`],
                ...(thermo
                  ? ([
                      ['Tm', `${thermo.tm.toFixed(1)} °C`],
                      ['ΔG37', `${thermo.deltaG37.toFixed(2)} kcal/mol`],
                      [t('发夹 ΔG'), thermo.hairpinDeltaG.toFixed(2)],
                      [t('自二聚体 ΔG'), thermo.selfDimerDeltaG.toFixed(2)],
                    ] as Array<[string, string]>)
                  : []),
              ]}
            />
            {thermo && <div className="text-[10px] text-[var(--muted)]">{t('Tm：SantaLucia 1998 + Owczarzy 盐校正，50 mM Na⁺、2 mM Mg²⁺、0.8 mM dNTP')}</div>}
            <div className="mono max-h-32 overflow-auto break-all rounded-md bg-[var(--bg)] p-1.5">{sel.length > 600 ? sel.slice(0, 600) + '…' : sel}</div>
            {sel.length % 3 === 0 && sel.length <= 3000 && (
              <div>
                <div className="mb-0.5 text-[11px] text-[var(--muted)]">{t('翻译（正链，第 1 框）')}</div>
                <div className="mono max-h-24 overflow-auto break-all rounded-md bg-[var(--bg)] p-1.5 text-emerald-700 dark:text-emerald-400">{translateDna(sel)}</div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" className="justify-center" onClick={() => copy(sel, t('序列'))}>
                <Copy size={12} /> {t('复制')}
              </Button>
              <Button size="sm" className="justify-center" onClick={() => copy(reverseComplement(sel), t('反向互补序列'))}>
                <Copy size={12} /> {t('反向互补')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="leading-relaxed text-[var(--muted)]">{t('在图谱上拖动，或在序列中拖选碱基；点击特征可选中整个特征。')}</div>
        )}
      </InspectorCard>
    </div>
  );
}
