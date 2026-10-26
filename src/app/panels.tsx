import { useEffect, useMemo, useState } from 'react';
import { Microscope, Trash2 } from 'lucide-react';
import type { CutSite, ORF, PlasmidDocument } from '../types/schema';
import { calcGcPercent, translateDna } from '../modules/seq-engine';
import { evaluateOligoThermodynamics } from '../modules/cloning-primer';
import { callBio } from './bio-client';
import { digestToGel, historyNode } from './actions';
import { useWorkbench, type NebBuffer } from './store';
import { Badge, Button, Input, Select, cn } from './ui';

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
  const filter = useWorkbench((s) => s.enzymeFilter);
  const setFilter = useWorkbench((s) => s.setEnzymeFilter);
  const setSelection = useWorkbench((s) => s.setSelection);
  const setView = useWorkbench((s) => s.setView);
  const [picked, setPicked] = useState<string[]>([]);

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
        <Input className="w-40" placeholder="搜索酶 / 识别序列" value={filter.query} onChange={(e) => setFilter({ query: e.target.value })} />
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
          <option value="">任意 Buffer</option>
          {BUFFERS.map((b) => (
            <option key={b} value={b}>
              NEB {b} ≥75%
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button
          variant="primary"
          size="sm"
          disabled={!picked.length}
          onClick={async () => {
            await digestToGel(doc, picked);
            setView('gel');
          }}
        >
          <Microscope size={13} /> 酶切并跑胶 ({picked.length})
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--panel)] text-left text-[var(--muted)]">
            <tr>
              <th className="w-8 p-2" />
              <th>酶</th>
              <th>识别序列</th>
              <th>切点数</th>
              <th>位置 (切口)</th>
              <th>末端</th>
              <th>甲基化</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([name, list]) => {
              const e = list[0].enzyme;
              return (
                <tr key={name} className="border-t border-[var(--border)] align-top hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="p-2">
                    <input type="checkbox" checked={picked.includes(name)} onChange={() => toggle(name)} />
                  </td>
                  <td className={cn('py-2 font-medium', list.length === 1 && 'font-bold')}>
                    {name} {e.isTypeIIS && <Badge tone="blue">IIS</Badge>}
                  </td>
                  <td className="mono py-2">{e.recognitionSeq}</td>
                  <td className="py-2">{list[0].totalCutsInPlasmid}</td>
                  <td className="py-2">
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
                  <td className="mono py-2">
                    {list[0].overhangType === 'blunt' ? 'blunt' : `${list[0].overhangType === '5-prime' ? "5'" : "3'"} ${list[0].overhangSeq}`}
                  </td>
                  <td className="py-2">
                    {list.some((s) => s.isMethylationBlocked) ? <Badge tone="red">阻断</Badge> : <Badge tone="green">可切</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!groups.length && <div className="p-6 text-center text-xs text-[var(--muted)]">没有符合条件的酶切位点</div>}
      </div>
    </div>
  );
}

export function FeaturePanel({ doc }: { doc: PlasmidDocument }) {
  const setSelection = useWorkbench((s) => s.setSelection);
  const replaceDoc = useWorkbench((s) => s.replaceDoc);
  const [orfs, setOrfs] = useState<ORF[]>([]);
  const [tab, setTab] = useState<'features' | 'primers' | 'orfs'>('features');

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
      history: [...doc.history, historyNode('manual_edit', '删除特征')],
    });
  const removePrimer = (id: string) =>
    replaceDoc({ ...doc, primers: doc.primers.filter((p) => p.id !== id), updatedAt: new Date().toISOString() });

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-[var(--border)] p-2">
        {(
          [
            ['features', `特征 (${doc.features.length})`],
            ['primers', `引物 (${doc.primers.length})`],
            ['orfs', `ORF (${orfs.length})`],
          ] as const
        ).map(([k, label]) => (
          <Button key={k} size="sm" variant={tab === k ? 'primary' : 'ghost'} onClick={() => setTab(k)}>
            {label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <tbody>
            {tab === 'features' &&
              doc.features.map((f) => (
                <tr key={f.id} className="cursor-pointer border-t border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelection({ start: f.start, end: f.end })}>
                  <td className="p-2">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ background: f.color }} />
                  </td>
                  <td className="font-medium">{f.name}</td>
                  <td className="text-[var(--muted)]">{f.type}</td>
                  <td className="mono">
                    {f.start + 1}..{f.end} {f.strand === -1 ? '←' : f.strand === 1 ? '→' : ''}
                  </td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), removeFeature(f.id))} aria-label="删除">
                      <Trash2 size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
            {tab === 'primers' &&
              doc.primers.map((p) => (
                <tr key={p.id} className="cursor-pointer border-t border-[var(--border)] align-top hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelection({ start: p.bindingStart, end: p.bindingEnd })}>
                  <td className="p-2 font-medium">{p.name}</td>
                  <td className="mono break-all">{p.sequence}</td>
                  <td className="whitespace-nowrap">{p.tmAnnealing.toFixed(1)} °C</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), removePrimer(p.id))} aria-label="删除">
                      <Trash2 size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
            {tab === 'orfs' &&
              orfs.map((o) => (
                <tr key={o.id} className="cursor-pointer border-t border-[var(--border)] hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setSelection({ start: o.start, end: o.end })}>
                  <td className="p-2">
                    <Badge tone="blue">{o.frame > 0 ? `+${o.frame}` : o.frame}</Badge>
                  </td>
                  <td className="mono">
                    {o.start + 1}..{o.end}
                  </td>
                  <td>{Math.round(o.lengthBp / 3) - 1} aa</td>
                  <td>{o.mwKda.toFixed(1)} kDa</td>
                  <td>pI {o.pI.toFixed(2)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function selectionSeq(doc: PlasmidDocument, start: number, end: number): string {
  return start <= end ? doc.sequence.slice(start, end) : doc.sequence.slice(start) + doc.sequence.slice(0, end);
}

export function Inspector({ doc }: { doc: PlasmidDocument }) {
  const selection = useWorkbench((s) => s.selection);
  const highlight = useWorkbench((s) => s.highlight);
  const replaceDoc = useWorkbench((s) => s.replaceDoc);
  const sel = selection && selection.start !== selection.end ? selectionSeq(doc, selection.start, selection.end) : '';
  const thermo = useMemo(() => (sel.length >= 8 && sel.length <= 60 ? evaluateOligoThermodynamics(sel) : null), [sel]);
  const methyl = doc.methylationProfile ?? { dam: true, dcm: true, cpg: false };

  return (
    <div className="flex flex-col gap-4 p-3 text-xs">
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">质粒</h3>
        <div className="grid grid-cols-2 gap-y-1">
          <span className="text-[var(--muted)]">名称</span>
          <span className="font-medium">{doc.name}</span>
          <span className="text-[var(--muted)]">长度</span>
          <span>{doc.length.toLocaleString()} bp</span>
          <span className="text-[var(--muted)]">拓扑</span>
          <span>{doc.topology === 'circular' ? '环状' : '线性'}</span>
          <span className="text-[var(--muted)]">GC</span>
          <span>{calcGcPercent(doc.sequence).toFixed(1)}%</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-3">
          {(['dam', 'dcm', 'cpg'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={methyl[k]}
                onChange={(e) => replaceDoc({ ...doc, methylationProfile: { ...methyl, [k]: e.target.checked } })}
              />
              {k.toUpperCase()}
            </label>
          ))}
        </div>
      </section>
      {highlight && (
        <section className="rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <b>AI 高亮 {highlight.start + 1}–{highlight.end}</b>：{highlight.reason}
        </section>
      )}
      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">选区</h3>
        {sel ? (
          <div className="flex flex-col gap-1.5">
            <div>
              {selection!.start + 1} – {selection!.end}（{sel.length} bp）GC {calcGcPercent(sel).toFixed(1)}%
            </div>
            {thermo && (
              <div className="grid grid-cols-2 gap-y-0.5">
                <span className="text-[var(--muted)]">Tm (SantaLucia)</span>
                <span>{thermo.tm.toFixed(1)} °C</span>
                <span className="text-[var(--muted)]">ΔG37</span>
                <span>{thermo.deltaG37.toFixed(2)} kcal/mol</span>
                <span className="text-[var(--muted)]">发夹 ΔG</span>
                <span>{thermo.hairpinDeltaG.toFixed(2)}</span>
                <span className="text-[var(--muted)]">自二聚体 ΔG</span>
                <span>{thermo.selfDimerDeltaG.toFixed(2)}</span>
              </div>
            )}
            <div className="mono max-h-32 overflow-auto break-all rounded bg-[var(--bg)] p-1.5">{sel.length > 600 ? sel.slice(0, 600) + '…' : sel}</div>
            {sel.length % 3 === 0 && sel.length <= 3000 && (
              <div className="mono max-h-24 overflow-auto break-all rounded bg-[var(--bg)] p-1.5 text-emerald-700 dark:text-emerald-400">{translateDna(sel)}</div>
            )}
            <Button size="sm" onClick={() => navigator.clipboard?.writeText(sel)}>
              复制序列
            </Button>
          </div>
        ) : (
          <div className="text-[var(--muted)]">在图谱或序列中拖拽选择区间</div>
        )}
      </section>
    </div>
  );
}
