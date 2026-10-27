import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlaskConical, Play, Plus, Trash2 } from 'lucide-react';
import type { PlasmidDocument, Primer } from '../types/schema';
import { COMMERCIAL_ENZYMES } from '../modules/seq-engine';
import { callBio } from './bio-client';
import { addPrimersToDoc, openProduct, resolveEnzymes } from './actions';
import { selectActiveDoc, useWorkbench, type WizardKind } from './store';
import { Badge, Button, Dialog, Field, Input, Select, Tabs } from './ui';

const TABS: Array<{ value: WizardKind; label: string }> = [
  { value: 'primers', label: '引物设计' },
  { value: 'pcr', label: 'PCR' },
  { value: 'restriction', label: '酶切连接' },
  { value: 'gibson', label: 'Gibson' },
  { value: 'golden_gate', label: 'Golden Gate' },
  { value: 'mutagenesis', label: '定点突变' },
  { value: 'gateway', label: 'Gateway' },
  { value: 'ta_topo', label: 'TA / TOPO' },
  { value: 'lic', label: 'LIC' },
  { value: 'recombinase', label: 'Cre / Flp' },
  { value: 'insert', label: '插入片段' },
];

export function CloningWizard() {
  const wizard = useWorkbench((s) => s.wizard);
  const setWizard = useWorkbench((s) => s.setWizard);
  return (
    <Dialog
      open={wizard !== null}
      onClose={() => setWizard(null)}
      width={860}
      title={
        <span className="inline-flex items-center gap-2">
          <FlaskConical size={16} /> 克隆向导
        </span>
      }
    >
      {wizard && (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <Tabs value={wizard} onChange={setWizard} items={TABS} />
          </div>
          {wizard === 'primers' && <PrimerDesignTab />}
          {wizard === 'pcr' && <PcrTab />}
          {wizard === 'restriction' && <RestrictionTab />}
          {wizard === 'gibson' && <GibsonTab />}
          {wizard === 'golden_gate' && <GoldenGateTab />}
          {wizard === 'mutagenesis' && <MutagenesisTab />}
          {wizard === 'gateway' && <GatewayTab />}
          {wizard === 'ta_topo' && <TaTopoTab />}
          {wizard === 'lic' && <LicTab />}
          {wizard === 'recombinase' && <RecombinaseTab />}
          {wizard === 'insert' && <InsertFragmentTab />}
        </div>
      )}
    </Dialog>
  );
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null;
}

function DocPicker({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  const docs = useWorkbench((s) => s.docs);
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.length} bp, {d.topology === 'circular' ? '环状' : '线性'})
          </option>
        ))}
      </Select>
    </Field>
  );
}

function useDoc(id: string): PlasmidDocument | undefined {
  return useWorkbench((s) => s.docs.find((d) => d.id === id));
}

function useActiveId(): string {
  return useWorkbench((s) => s.activeId ?? s.docs[0]?.id ?? '');
}

function PrimerTable({ primers }: { primers: Primer[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-[var(--muted)]">
        <tr>
          <th className="py-1">名称</th>
          <th>序列 5'→3'</th>
          <th>Tm 退火/全长</th>
          <th>GC%</th>
          <th>发夹/二聚体 ΔG</th>
        </tr>
      </thead>
      <tbody>
        {primers.map((p) => (
          <tr key={p.id} className="border-t border-[var(--border)] align-top">
            <td className="py-1.5 pr-2 font-medium">{p.name}</td>
            <td className="mono break-all pr-2">
              <span className="text-violet-600 dark:text-violet-400 lowercase">{p.tailSequence}</span>
              {p.sequence.slice(p.tailSequence.length)}
            </td>
            <td className="whitespace-nowrap pr-2">
              {p.tmAnnealing.toFixed(1)} / {p.tmTotal.toFixed(1)} °C
            </td>
            <td className="pr-2">{p.gcPercent.toFixed(0)}</td>
            <td className="whitespace-nowrap">
              <Badge tone={p.hairpinDeltaG < -3 ? 'red' : 'slate'}>{p.hairpinDeltaG.toFixed(1)}</Badge>{' '}
              <Badge tone={p.selfDimerDeltaG < -6 ? 'red' : 'slate'}>{p.selfDimerDeltaG.toFixed(1)}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="list-disc space-y-0.5 rounded-md bg-amber-50 py-2 pl-6 pr-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      {items.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function PrimerDesignTab() {
  const doc = useWorkbench(selectActiveDoc);
  const selection = useWorkbench((s) => s.selection);
  const replaceDoc = useWorkbench((s) => s.replaceDoc);
  const [start, setStart] = useState(selection ? selection.start + 1 : 1);
  const [end, setEnd] = useState(selection ? selection.end : 600);
  const [fwdSite, setFwdSite] = useState('');
  const [revSite, setRevSite] = useState('');
  const [fwdTail, setFwdTail] = useState('');
  const [revTail, setRevTail] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof designPair>> | null>(null);
  const { busy, error, run } = useRun();

  const siteOf = (name: string) => (name ? COMMERCIAL_ENZYMES.find((e) => e.name === name)?.recognitionSeq : undefined);
  const designPair = (d: PlasmidDocument) =>
    callBio('designPrimerPair', d, { start: start - 1, end }, {
      enzymeSiteForward: siteOf(fwdSite),
      enzymeSiteReverse: siteOf(revSite),
      forwardTail: fwdTail || undefined,
      reverseTail: revTail || undefined,
    });

  if (!doc) return null;
  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <Field label="目标起点 (1-based)">
          <Input type="number" value={start} min={1} max={doc.length} onChange={(e) => setStart(+e.target.value)} />
        </Field>
        <Field label="目标终点 (含)">
          <Input type="number" value={end} min={1} max={doc.length} onChange={(e) => setEnd(+e.target.value)} />
        </Field>
        <div />
        <Field label="正向 5' 酶切位点">
          <EnzymeSelect value={fwdSite} onChange={setFwdSite} />
        </Field>
        <Field label="反向 5' 酶切位点">
          <EnzymeSelect value={revSite} onChange={setRevSite} />
        </Field>
        <div />
        <Field label="正向 5' 自定义尾巴 / Gibson 同源臂">
          <Input className="mono" value={fwdTail} onChange={(e) => setFwdTail(e.target.value.toUpperCase().replace(/[^ACGTN]/g, ''))} />
        </Field>
        <Field label="反向 5' 自定义尾巴">
          <Input className="mono" value={revTail} onChange={(e) => setRevTail(e.target.value.toUpperCase().replace(/[^ACGTN]/g, ''))} />
        </Field>
      </Grid>
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => run(async () => setResult(await designPair(doc)))}>
          <Play size={14} /> 设计引物
        </Button>
        {result && (
          <Button
            onClick={() => {
              replaceDoc(addPrimersToDoc(doc, [result.forward, result.reverse], '设计引物对'));
              useWorkbench.getState().notify('引物已添加到当前质粒');
            }}
          >
            <Plus size={14} /> 添加到质粒
          </Button>
        )}
      </div>
      <ErrorLine error={error} />
      {result && (
        <>
          <PrimerTable primers={[result.forward, result.reverse]} />
          <div className="text-xs text-[var(--muted)]">PCR 产物 {result.productLength} bp</div>
          <Warnings items={result.warnings} />
        </>
      )}
    </div>
  );
}

function EnzymeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">（无）</option>
      {COMMERCIAL_ENZYMES.map((e) => (
        <option key={e.name} value={e.name}>
          {e.name} — {e.recognitionSeq}
        </option>
      ))}
    </Select>
  );
}

function PcrTab() {
  const activeId = useActiveId();
  const preset = usePreset();
  const [templateId, setTemplateId] = useState(preset?.docIds?.[0] ?? activeId);
  const template = useDoc(templateId);
  const presetPrimers = (preset?.primerNames ?? []).map((n) => template?.primers.find((p) => p.name === n));
  const [fwd, setFwd] = useState(presetPrimers.find((p) => p?.strand === 1)?.id ?? '');
  const [rev, setRev] = useState(presetPrimers.find((p) => p?.strand === -1)?.id ?? '');
  const [overlapIds, setOverlapIds] = useState<string[]>([]);
  const { busy, error, run } = useRun();
  const primers = template?.primers ?? [];
  const resolvePrimer = (v: string): Primer | string => primers.find((p) => p.id === v) ?? v.toUpperCase();

  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <DocPicker label="模板" value={templateId} onChange={setTemplateId} />
        <Field label="正向引物（选择已有或输入序列）">
          <PrimerInput primers={primers.filter((p) => p.strand === 1)} value={fwd} onChange={setFwd} />
        </Field>
        <Field label="反向引物">
          <PrimerInput primers={primers.filter((p) => p.strand === -1)} value={rev} onChange={setRev} />
        </Field>
      </Grid>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy || !template || !fwd || !rev}
          onClick={() =>
            run(async () => {
              const r = await callBio('simulatePCR', template!, resolvePrimer(fwd), resolvePrimer(rev));
              openProduct(r.product, r.warnings);
            })
          }
        >
          <Play size={14} /> 模拟 PCR
        </Button>
      </div>
      <div className="mt-2 border-t border-[var(--border)] pt-3">
        <div className="mb-2 text-xs font-medium text-[var(--muted)]">融合 PCR (SOE-PCR)：按顺序选择带重叠末端的线性片段，外侧引物使用上方正/反向引物</div>
        <MultiDocPicker value={overlapIds} onChange={setOverlapIds} />
        <Button
          className="mt-2"
          disabled={busy || overlapIds.length < 2 || !fwd || !rev}
          onClick={() =>
            run(async () => {
              const docs = useWorkbench.getState().docs;
              const frags = overlapIds.map((id) => docs.find((d) => d.id === id)!).filter(Boolean);
              const r = await callBio('simulateOverlapExtensionPCR', frags, resolvePrimer(fwd), resolvePrimer(rev));
              openProduct(r.product, r.warnings);
            })
          }
        >
          <Play size={14} /> 模拟融合 PCR
        </Button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function PrimerInput({ primers, value, onChange }: { primers: Primer[]; value: string; onChange: (v: string) => void }) {
  const listId = useMemo(() => `pl-${Math.random().toString(36).slice(2)}`, []);
  const label = primers.find((p) => p.id === value)?.name;
  return (
    <>
      <Input
        className="mono"
        list={listId}
        value={label ?? value}
        placeholder="ACGT... 或选择引物"
        onChange={(e) => {
          const hit = primers.find((p) => p.name === e.target.value);
          onChange(hit ? hit.id : e.target.value);
        }}
      />
      <datalist id={listId}>
        {primers.map((p) => (
          <option key={p.id} value={p.name}>
            {p.sequence}
          </option>
        ))}
      </datalist>
    </>
  );
}

function MultiDocPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const docs = useWorkbench((s) => s.docs);
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((id, i) => {
        const d = docs.find((x) => x.id === id);
        return (
          <div key={`${id}-${i}`} className="flex items-center gap-2 text-xs">
            <Badge tone="blue">{i + 1}</Badge>
            <span className="flex-1">
              {d?.name ?? '已关闭'} <span className="text-[var(--muted)]">({d?.length ?? 0} bp)</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 size={13} />
            </Button>
          </div>
        );
      })}
      <Select
        value=""
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
        className="w-full sm:w-80"
      >
        <option value="">+ 添加片段…</option>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.length} bp)
          </option>
        ))}
      </Select>
    </div>
  );
}

function usePreset() {
  // Read once on mount: a replayed history step pre-fills the tab.
  const [preset] = useState(() => useWorkbench.getState().wizardPreset);
  return preset;
}

function RestrictionTab() {
  const activeId = useActiveId();
  const preset = usePreset();
  const [vectorId, setVectorId] = useState(preset?.docIds?.[0] ?? activeId);
  const [insertId, setInsertId] = useState(preset?.docIds?.[1] ?? preset?.docIds?.[0] ?? activeId);
  const [enzymesText, setEnzymesText] = useState(preset?.enzymes?.length ? preset.enzymes.join(', ') : 'EcoRI, BamHI');
  const [vecFrags, setVecFrags] = useState<PlasmidDocument[]>([]);
  const [insFrags, setInsFrags] = useState<PlasmidDocument[]>([]);
  const [vecPick, setVecPick] = useState(0);
  const [insPick, setInsPick] = useState(0);
  const [dephos, setDephos] = useState(false);
  const [blunt, setBlunt] = useState<'' | 'klenow_fill_in' | 't4_exonuclease'>('');
  const [result, setResult] = useState<{ compatible: boolean; destroyedSites: string[]; warnings: string[]; orientations: string[] } | null>(null);
  const vector = useDoc(vectorId);
  const insert = useDoc(insertId);
  const { busy, error, run } = useRun();

  const digest = async () => {
    const { enzymes, missing } = resolveEnzymes(enzymesText.split(/[,\s+]+/).filter(Boolean));
    if (missing.length) throw new Error(`未知酶：${missing.join(', ')}`);
    const cut = async (d: PlasmidDocument) => {
      const sites = (await callBio('findCutSites', d, enzymes)).filter((s) => !s.isMethylationBlocked);
      return sites.length ? callBio('simulateDigestion', d, sites) : [d];
    };
    const [v, i] = await Promise.all([cut(vector!), cut(insert!)]);
    const byLen = (a: PlasmidDocument, b: PlasmidDocument) => b.length - a.length;
    v.sort(byLen);
    i.sort(byLen);
    setVecFrags(v);
    setInsFrags(i);
    setVecPick(0);
    setInsPick(Math.min(1, i.length - 1));
    setResult(null);
  };

  const ligate = async () => {
    let v = vecFrags[vecPick];
    let i = insFrags[insPick];
    if (blunt) {
      [v, i] = await Promise.all([callBio('bluntEnds', v, blunt), callBio('bluntEnds', i, blunt)]);
    }
    // The same fragment picked as vector and insert means self-ligation.
    const self = vectorId === insertId && vecPick === insPick;
    const r = await callBio('simulateLigation', self ? [v] : [v, i], { circularize: true, dephosphorylatedIds: dephos ? [v.id] : [] });
    setResult(r);
    if (r.product) openProduct({ ...r.product, name: self ? `${vector!.name}_religated` : `${vector!.name}::${insert!.name}` }, r.warnings);
  };

  const fragLabel = (f: PlasmidDocument) => {
    const e = f.linearEnds;
    const end = (x?: { type: string; sequence: string; sourceEnzyme?: string }) =>
      x ? `${x.sourceEnzyme ?? ''} ${x.type === 'blunt' ? 'blunt' : x.sequence}` : '?';
    return `${f.length} bp  [${end(e?.left)} | ${end(e?.right)}]`;
  };

  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <DocPicker label="载体" value={vectorId} onChange={setVectorId} />
        <DocPicker label="插入片段来源" value={insertId} onChange={setInsertId} />
        <Field label="酶（逗号分隔，单酶切/双酶切）">
          <Input value={enzymesText} onChange={(e) => setEnzymesText(e.target.value)} />
        </Field>
      </Grid>
      <div>
        <Button variant="primary" disabled={busy || !vector || !insert} onClick={() => run(digest)}>
          <Play size={14} /> 酶切
        </Button>
      </div>
      {vecFrags.length > 0 && (
        <>
          <Grid>
            <Field label="载体骨架片段">
              <Select value={vecPick} onChange={(e) => setVecPick(+e.target.value)}>
                {vecFrags.map((f, i) => (
                  <option key={f.id} value={i}>
                    {fragLabel(f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="插入片段">
              <Select value={insPick} onChange={(e) => setInsPick(+e.target.value)}>
                {insFrags.map((f, i) => (
                  <option key={f.id} value={i}>
                    {fragLabel(f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="末端处理">
              <Select value={blunt} onChange={(e) => setBlunt(e.target.value as typeof blunt)}>
                <option value="">不处理</option>
                <option value="klenow_fill_in">Klenow 补平</option>
                <option value="t4_exonuclease">T4 削平</option>
              </Select>
            </Field>
          </Grid>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={dephos} onChange={(e) => setDephos(e.target.checked)} /> 载体去磷酸化（CIP/rSAP 防自连）
          </label>
          <div>
            <Button variant="primary" disabled={busy} onClick={() => run(ligate)}>
              <Play size={14} /> 连接
            </Button>
          </div>
        </>
      )}
      <ErrorLine error={error} />
      {result && (
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap gap-2">
            <Badge tone={result.compatible ? 'green' : 'red'}>{result.compatible ? '末端相容' : '末端不相容'}</Badge>
            {result.orientations.map((o, i) => (
              <Badge key={i} tone="blue">
                {o === 'forward' ? '正向插入' : '反向插入'}
              </Badge>
            ))}
            {result.destroyedSites.map((s) => (
              <Badge key={s} tone="amber">
                {s} 位点消失
              </Badge>
            ))}
          </div>
          <Warnings items={result.warnings} />
        </div>
      )}
    </div>
  );
}

function GibsonTab() {
  const preset = usePreset();
  const [ids, setIds] = useState<string[]>(preset?.docIds && preset.docIds.length > 1 ? preset.docIds : []);
  const [circular, setCircular] = useState(true);
  const [kit, setKit] = useState<'Gibson' | 'NEBuilder HiFi' | 'In-Fusion'>('Gibson');
  const [result, setResult] = useState<{ junctions: Array<{ leftId: string; rightId: string; overlapSeq: string; overlapTm: number; reversed: boolean }>; warnings: string[] } | null>(null);
  const [primerParts, setPrimerParts] = useState<Array<{ partId: string; forward: Primer; reverse: Primer }>>([]);
  const [designWarnings, setDesignWarnings] = useState<string[]>([]);
  const { busy, error, run } = useRun();
  const docs = useWorkbench((s) => s.docs);
  const frags = () => ids.map((id) => docs.find((d) => d.id === id)!).filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-[var(--muted)]">按组装顺序添加 2~8 个片段。已有 15~45 bp 同源臂的片段可直接组装；否则先设计带同源臂的引物。</div>
      <MultiDocPicker value={ids} onChange={setIds} />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={circular} onChange={(e) => setCircular(e.target.checked)} /> 环化产物
        </label>
        <label className="flex items-center gap-2">
          试剂盒
          <Select value={kit} onChange={(e) => setKit(e.target.value as typeof kit)}>
            <option value="Gibson">Gibson Assembly（20–40 bp 同源臂）</option>
            <option value="NEBuilder HiFi">NEBuilder HiFi（15–35 bp）</option>
            <option value="In-Fusion">In-Fusion（15 bp）</option>
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || ids.length < 2}
          onClick={() =>
            run(async () => {
              const r = await callBio('designHomologyAssemblyPrimers', frags(), kit, { circular });
              setPrimerParts(r.primers.map((x) => ({ partId: x.fragmentId, forward: x.forward, reverse: x.reverse })));
              setDesignWarnings(r.warnings);
            })
          }
        >
          设计{kit}引物
        </Button>
        <Button
          variant="primary"
          disabled={busy || ids.length < 2}
          onClick={() =>
            run(async () => {
              const r = await callBio('simulateGibsonAssembly', frags(), { circular });
              setResult(r);
              openProduct(r.product, r.warnings);
            })
          }
        >
          <Play size={14} /> 模拟组装
        </Button>
      </div>
      <ErrorLine error={error} />
      {primerParts.length > 0 && <PrimerTable primers={primerParts.flatMap((p) => [p.forward, p.reverse])} />}
      <Warnings items={designWarnings} />
      {result && (
        <>
          <table className="w-full text-xs">
            <thead className="text-left text-[var(--muted)]">
              <tr>
                <th>连接点</th>
                <th>重叠序列</th>
                <th>Tm</th>
              </tr>
            </thead>
            <tbody>
              {result.junctions.map((j, i) => (
                <tr key={i} className="border-t border-[var(--border)]">
                  <td className="py-1">
                    {docs.find((d) => d.id === j.leftId)?.name} → {docs.find((d) => d.id === j.rightId)?.name}
                    {j.reversed && <Badge tone="amber">反向互补</Badge>}
                  </td>
                  <td className="mono break-all">{j.overlapSeq}</td>
                  <td>{j.overlapTm.toFixed(1)} °C</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Warnings items={result.warnings} />
        </>
      )}
    </div>
  );
}

function GoldenGateTab() {
  const [ids, setIds] = useState<string[]>([]);
  const typeIIS = COMMERCIAL_ENZYMES.filter((e) => e.isTypeIIS);
  const [enzymeName, setEnzymeName] = useState(typeIIS.find((e) => e.name === 'BsaI')?.name ?? typeIIS[0]?.name ?? '');
  const [result, setResult] = useState<{ overhangs: string[]; fidelityScore: number; internalSiteWarnings: string[]; warnings: string[] } | null>(null);
  const { busy, error, run } = useRun();
  const docs = useWorkbench((s) => s.docs);

  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <Field label="Type IIS 酶">
          <Select value={enzymeName} onChange={(e) => setEnzymeName(e.target.value)}>
            {typeIIS.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} — {e.recognitionSeq}
              </option>
            ))}
          </Select>
        </Field>
      </Grid>
      <MultiDocPicker value={ids} onChange={setIds} />
      <div>
        <Button
          variant="primary"
          disabled={busy || ids.length < 2}
          onClick={() =>
            run(async () => {
              const enzyme = typeIIS.find((e) => e.name === enzymeName)!;
              const parts = ids.map((id) => docs.find((d) => d.id === id)!).filter(Boolean);
              const r = await callBio('simulateGoldenGateAssembly', parts, enzyme, { circular: true });
              setResult(r);
              openProduct(r.product, r.warnings);
            })
          }
        >
          <Play size={14} /> 模拟 Golden Gate
        </Button>
      </div>
      <ErrorLine error={error} />
      {result && (
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span>粘性末端：</span>
            {result.overhangs.map((o, i) => (
              <Badge key={i} tone="blue">
                <span className="mono">{o}</span>
              </Badge>
            ))}
            <Badge tone={result.fidelityScore > 0.95 ? 'green' : result.fidelityScore > 0.8 ? 'amber' : 'red'}>
              保真度 {(result.fidelityScore * 100).toFixed(1)}%
            </Badge>
          </div>
          <Warnings items={[...result.internalSiteWarnings, ...result.warnings]} />
        </div>
      )}
    </div>
  );
}

function MutagenesisTab() {
  const doc = useWorkbench(selectActiveDoc);
  const selection = useWorkbench((s) => s.selection);
  const replaceDoc = useWorkbench((s) => s.replaceDoc);
  const [start, setStart] = useState(selection ? selection.start + 1 : 1);
  const [end, setEnd] = useState(selection ? selection.end : 1);
  const [newBases, setNewBases] = useState('');
  const [mode, setMode] = useState<'quikchange' | 'q5_back_to_back'>('q5_back_to_back');
  const [result, setResult] = useState<Awaited<ReturnType<typeof callBio<'designMutagenesisPrimers'>>> | null>(null);
  const { busy, error, run } = useRun();

  useEffect(() => {
    if (selection) {
      setStart(selection.start + 1);
      setEnd(selection.end);
    }
  }, [selection]);

  if (!doc) return null;
  const original = doc.sequence.slice(Math.max(0, start - 1), Math.max(start - 1, end));
  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <Field label="突变起点 (1-based)" hint="插入：起点=终点+1">
          <Input type="number" value={start} onChange={(e) => setStart(+e.target.value)} />
        </Field>
        <Field label="突变终点 (含)">
          <Input type="number" value={end} onChange={(e) => setEnd(+e.target.value)} />
        </Field>
        <Field label="方法">
          <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="q5_back_to_back">Q5 SDM 背靠背</option>
            <option value="quikchange">QuikChange 重叠</option>
          </Select>
        </Field>
        <Field label={`原序列：${original || '（插入）'}`} hint="新序列留空 = 删除">
          <Input className="mono" value={newBases} onChange={(e) => setNewBases(e.target.value.toUpperCase().replace(/[^ACGT]/g, ''))} />
        </Field>
      </Grid>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            run(async () => setResult(await callBio('designMutagenesisPrimers', doc, { start: start - 1, end, newBases, mode }, COMMERCIAL_ENZYMES)))
          }
        >
          <Play size={14} /> 设计突变引物
        </Button>
        {result && (
          <>
            <Button onClick={() => replaceDoc(addPrimersToDoc(doc, [result.forward, result.reverse], '定点突变引物'))}>
              <Plus size={14} /> 添加引物
            </Button>
            <Button onClick={() => openProduct({ ...result.mutatedDoc, name: `${doc.name}-mut` })}>打开突变质粒</Button>
          </>
        )}
      </div>
      <ErrorLine error={error} />
      {result && (
        <>
          <PrimerTable primers={[result.forward, result.reverse]} />
          {result.silentSiteSuggestions.length > 0 && (
            <div className="text-xs">
              <div className="mb-1 font-medium">静默酶切位点筛选建议</div>
              <ul className="space-y-1">
                {result.silentSiteSuggestions.map((s, i) => (
                  <li key={i}>
                    <Badge tone={s.action === 'introduce' ? 'green' : 'amber'}>{s.action === 'introduce' ? '引入' : '消除'}</Badge>{' '}
                    <b>{s.enzyme}</b> @ {s.position + 1}：<span className="mono">{s.changedBases}</span> — {s.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Warnings items={result.warnings} />
        </>
      )}
    </div>
  );
}

function GatewayTab() {
  const activeId = useActiveId();
  const [kind, setKind] = useState<'bp' | 'lr' | 'multi'>('bp');
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [aId, setAId] = useState(activeId);
  const [bId, setBId] = useState(activeId);
  const a = useDoc(aId);
  const b = useDoc(bId);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { busy, error, run } = useRun();
  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={kind}
        onChange={setKind}
        items={[
          { value: 'bp', label: 'BP 反应 (attB × attP)' },
          { value: 'lr', label: 'LR 反应 (attL × attR)' },
          { value: 'multi', label: 'MultiSite LR（2–4 片段）' },
        ]}
      />
      {kind === 'multi' && (
        <>
          <div className="text-xs text-[var(--muted)]">按顺序添加入门克隆（attL1-attR5 / attL5-attL4 / attR4-attR3 / attL3-attL2 …）</div>
          <MultiDocPicker value={entryIds} onChange={setEntryIds} />
        </>
      )}
      <Grid>
        {kind !== 'multi' && <DocPicker label={kind === 'bp' ? 'attB 侧翼 PCR 产物' : '入门克隆 (attL)'} value={aId} onChange={setAId} />}
        <DocPicker label={kind === 'bp' ? '供体载体 (attP, pDONR)' : '目的载体 (attR)'} value={bId} onChange={setBId} />
      </Grid>
      <div>
        <Button
          variant="primary"
          disabled={busy || !a || !b}
          onClick={() =>
            run(async () => {
              if (kind === 'multi') {
                const docs = useWorkbench.getState().docs;
                const entries = entryIds.map((id) => docs.find((d) => d.id === id)!).filter(Boolean);
                const r = await callBio('simulateMultiSiteGatewayLR', entries, b!);
                setWarnings(r.warnings);
                openProduct(r.expressionClone, r.warnings);
              } else if (kind === 'bp') {
                const r = await callBio('simulateGatewayBP', a!, b!);
                setWarnings(r.warnings);
                openProduct(r.entryClone, r.warnings);
              } else {
                const r = await callBio('simulateGatewayLR', a!, b!);
                setWarnings(r.warnings);
                openProduct(r.expressionClone, r.warnings);
              }
            })
          }
        >
          <Play size={14} /> 模拟重组
        </Button>
      </div>
      <ErrorLine error={error} />
      <Warnings items={warnings} />
    </div>
  );
}

function TaTopoTab() {
  const activeId = useActiveId();
  const [vectorId, setVectorId] = useState(activeId);
  const [insertId, setInsertId] = useState(activeId);
  const [kind, setKind] = useState<'ta' | 'gc' | 'TA' | 'blunt' | 'directional'>('ta');
  const [orientation, setOrientation] = useState<'' | 'forward' | 'reverse'>('');
  const [aTail, setATail] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const vector = useDoc(vectorId);
  const insert = useDoc(insertId);
  const { busy, error, run } = useRun();
  const needsATail = kind === 'ta' || kind === 'TA';

  const simulate = async () => {
    const ins = needsATail && aTail ? await callBio('addATailing', insert!) : insert!;
    const opts = orientation ? { orientation } : undefined;
    const r =
      kind === 'ta'
        ? await callBio('simulateTACloning', vector!, ins, opts)
        : kind === 'gc'
          ? await callBio('simulateGCCloning', vector!, insert!, opts)
          : await callBio('simulateTOPOCloning', vector!, ins, kind, opts);
    setWarnings(r.warnings);
    openProduct(r.product && { ...r.product, name: `${vector!.name}::${insert!.name}` }, r.warnings);
  };

  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <DocPicker label="线性化载体（T 突出 / 平末端 / GTGG 突出）" value={vectorId} onChange={setVectorId} />
        <DocPicker label="PCR 产物" value={insertId} onChange={setInsertId} />
        <Field label="方法">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="ta">TA 克隆（T4 连接酶）</option>
            <option value="gc">GC 克隆（3′ G/C 突出）</option>
            <option value="TA">TOPO TA</option>
            <option value="blunt">Zero Blunt TOPO</option>
            <option value="directional">定向 TOPO（CACC）</option>
          </Select>
        </Field>
        <Field label="插入方向">
          <Select value={orientation} onChange={(e) => setOrientation(e.target.value as typeof orientation)}>
            <option value="">自动</option>
            <option value="forward">正向</option>
            <option value="reverse">反向</option>
          </Select>
        </Field>
      </Grid>
      {needsATail && (
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={aTail} onChange={(e) => setATail(e.target.checked)} /> 先为 PCR 产物加 3′ A 尾（Taq 产物）
        </label>
      )}
      <div>
        <Button variant="primary" disabled={busy || !vector || !insert} onClick={() => run(simulate)}>
          <Play size={14} /> 模拟克隆
        </Button>
      </div>
      <ErrorLine error={error} />
      <Warnings items={warnings} />
    </div>
  );
}

function LicTab() {
  const activeId = useActiveId();
  const doc = useWorkbench(selectActiveDoc)!;
  const selection = useWorkbench((s) => s.selection);
  const replaceDoc = useWorkbench((s) => s.replaceDoc);
  const [vectorId, setVectorId] = useState(activeId);
  const [insertId, setInsertId] = useState(activeId);
  const [primers, setPrimers] = useState<Primer[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const vector = useDoc(vectorId);
  const insert = useDoc(insertId);
  const { busy, error, run } = useRun();
  const range = selection && selection.start !== selection.end ? selection : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-medium">1. 为当前序列选区设计 LIC 引物</div>
      <div className="flex items-center gap-2">
        <Button
          disabled={busy || !range}
          onClick={() =>
            run(async () => {
              const r = await callBio('designLICPrimers', doc, range!);
              setPrimers([r.forward, r.reverse]);
            })
          }
        >
          <Play size={14} /> 设计 LIC 引物
        </Button>
        {!range && <span className="text-xs text-[var(--muted)]">先在图谱或序列中选择要扩增的区域</span>}
        {primers && (
          <Button onClick={() => replaceDoc(addPrimersToDoc(doc, primers, 'LIC 引物'))}>
            <Plus size={14} /> 添加引物
          </Button>
        )}
      </div>
      {primers && <PrimerTable primers={primers} />}
      <div className="mt-2 text-xs font-medium">2. 模拟 LIC 退火</div>
      <Grid>
        <DocPicker label="线性化 LIC 载体" value={vectorId} onChange={setVectorId} />
        <DocPicker label="带 LIC 尾的插入片段" value={insertId} onChange={setInsertId} />
      </Grid>
      <div>
        <Button
          variant="primary"
          disabled={busy || !vector || !insert}
          onClick={() =>
            run(async () => {
              const r = await callBio('simulateLIC', vector!, insert!);
              setWarnings(r.warnings);
              openProduct(r.product && { ...r.product, name: `${vector!.name}::${insert!.name}` }, r.warnings);
            })
          }
        >
          <Play size={14} /> 模拟 LIC
        </Button>
      </div>
      <ErrorLine error={error} />
      <Warnings items={warnings} />
    </div>
  );
}

function RecombinaseTab() {
  const activeId = useActiveId();
  const docs = useWorkbench((s) => s.docs);
  const [ids, setIds] = useState<string[]>([activeId]);
  const [recombinase, setRecombinase] = useState<'Cre' | 'Flp'>('Cre');
  const [events, setEvents] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sites, setSites] = useState<Record<string, string>>({});
  const { busy, error, run } = useRun();
  const picked = useMemo(() => ids.map((id) => docs.find((d) => d.id === id)).filter((d): d is PlasmidDocument => !!d), [ids, docs]);

  useEffect(() => {
    let alive = true;
    Promise.all(picked.map((d) => callBio('findRecombinationSites', d))).then((all) => {
      if (!alive) return;
      const summary: Record<string, string> = {};
      picked.forEach((d, i) => {
        summary[d.id] = all[i].length ? all[i].map((x) => `${x.site}@${x.start + 1}${x.strand === 1 ? '→' : '←'}`).join(', ') : '无';
      });
      setSites(summary);
    });
    return () => {
      alive = false;
    };
  }, [picked]);

  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <Field label="重组酶">
          <Select value={recombinase} onChange={(e) => setRecombinase(e.target.value as 'Cre' | 'Flp')}>
            <option value="Cre">Cre（lox 位点）</option>
            <option value="Flp">Flp（FRT 位点）</option>
          </Select>
        </Field>
      </Grid>
      <MultiDocPicker value={ids} onChange={setIds} />
      <ul className="text-xs text-[var(--muted)]">
        {picked.map((d) => (
          <li key={d.id}>
            <b className="text-[var(--text)]">{d.name}</b>：{sites[d.id] ?? '…'}
          </li>
        ))}
      </ul>
      <div>
        <Button
          variant="primary"
          disabled={busy || !picked.length}
          onClick={() =>
            run(async () => {
              const r = await callBio('simulateRecombinase', picked, recombinase);
              setEvents(r.events);
              setWarnings(r.warnings);
              if (!r.products.length) openProduct(null, r.warnings.length ? r.warnings : ['未发生重组']);
              r.products.forEach((p) => openProduct(p, r.events));
            })
          }
        >
          <Play size={14} /> 模拟重组
        </Button>
      </div>
      <ErrorLine error={error} />
      {events.length > 0 && (
        <ul className="list-disc pl-5 text-xs">
          {events.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <Warnings items={warnings} />
    </div>
  );
}

function InsertFragmentTab() {
  const activeId = useActiveId();
  const selection = useWorkbench((s) => s.selection);
  const [vectorId, setVectorId] = useState(activeId);
  const [insertId, setInsertId] = useState(activeId);
  const vector = useDoc(vectorId);
  const insert = useDoc(insertId);
  const sel = selection && vectorId === activeId ? selection : null;
  const [vStart, setVStart] = useState(sel ? sel.start + 1 : 1);
  const [vEnd, setVEnd] = useState(sel ? sel.end : 0);
  const [iStart, setIStart] = useState(1);
  const [iEnd, setIEnd] = useState(0);
  const [reverse, setReverse] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { busy, error, run } = useRun();

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-[var(--muted)]">
        把插入片段（全长或指定区间）放进载体的指定位置。载体区间为空（终点 = 起点 − 1）表示纯插入，否则替换该区间。坐标为 1-based 闭区间。
      </div>
      <Grid>
        <DocPicker label="载体" value={vectorId} onChange={setVectorId} />
        <DocPicker label="插入片段来源" value={insertId} onChange={setInsertId} />
        <Field label="载体替换起点">
          <Input type="number" value={vStart} onChange={(e) => setVStart(+e.target.value)} />
        </Field>
        <Field label="载体替换终点（含）" hint="填 起点−1 表示在起点前插入">
          <Input type="number" value={vEnd} onChange={(e) => setVEnd(+e.target.value)} />
        </Field>
        <Field label="插入片段起点">
          <Input type="number" value={iStart} onChange={(e) => setIStart(+e.target.value)} />
        </Field>
        <Field label="插入片段终点（含）" hint="0 = 到末尾">
          <Input type="number" value={iEnd} onChange={(e) => setIEnd(+e.target.value)} />
        </Field>
      </Grid>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> 反向插入
      </label>
      <div>
        <Button
          variant="primary"
          disabled={busy || !vector || !insert}
          onClick={() =>
            run(async () => {
              const r = await callBio(
                'simulateInsertFragment',
                vector!,
                { start: vStart - 1, end: Math.max(vStart - 1, vEnd) },
                insert!,
                { start: iStart - 1, end: iEnd > 0 ? iEnd : insert!.length },
                { reverseInsert: reverse },
              );
              setWarnings(r.warnings);
              openProduct({ ...r.product, name: `${vector!.name}::${insert!.name}` }, r.warnings);
            })
          }
        >
          <Play size={14} /> 插入
        </Button>
      </div>
      <ErrorLine error={error} />
      <Warnings items={warnings} />
    </div>
  );
}
