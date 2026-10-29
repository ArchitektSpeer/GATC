// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Genome engineering: scan a locus for CRISPR target sites and check each guide against
// the sequences that are open, or design a homologous-recombination replacement with the
// primers that build it and the primers that confirm it.
import { useMemo, useState } from 'react';
import { Crosshair, Radar, Scissors } from 'lucide-react';
import {
  designGenomicReplacement,
  findCrisprSites,
  NUCLEASES,
  scanOffTargets,
  type CrisprSite,
  type GenomicReplacement,
  type OffTargetScan,
} from '../modules/cloning-primer';
import { addPrimersToDoc, replaceIfCurrent } from './actions';
import { selectActiveDoc, useWorkbench } from './store';
import { Badge, Button, Dialog, Field, Input, Select, Tabs } from './ui';
import { t as translate, useT } from '../lib/i18n';

type Tab = 'crispr' | 'hr';

export function GenomeEditingDialog() {
  const t = useT();
  const open = useWorkbench((s) => s.tool === 'genome');
  const setTool = useWorkbench((s) => s.setTool);
  const [tab, setTab] = useState<Tab>('crispr');

  return (
    <Dialog open={open} onClose={() => setTool(null)} title={t('基因组编辑（CRISPR 打靶 / 同源重组）')} width={980}>
      <div className="flex flex-col gap-3 text-xs">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'crispr', label: t('CRISPR 打靶') },
            { value: 'hr', label: t('同源重组敲除 / 敲入') },
          ]}
        />
        {tab === 'crispr' ? <CrisprPanel /> : <HomologyPanel />}
      </div>
    </Dialog>
  );
}

function CrisprPanel() {
  const t = useT();
  const doc = useWorkbench(selectActiveDoc);
  const docs = useWorkbench((s) => s.docs);
  const selection = useWorkbench((s) => s.selection);
  const setTool = useWorkbench((s) => s.setTool);
  const [nucleaseId, setNucleaseId] = useState(NUCLEASES[0].id);
  const [sites, setSites] = useState<CrisprSite[] | null>(null);
  const [offTargets, setOffTargets] = useState<Record<string, OffTargetScan>>({});
  const [busy, setBusy] = useState(false);
  const [cleanOnly, setCleanOnly] = useState(false);

  const nuclease = NUCLEASES.find((n) => n.id === nucleaseId) ?? NUCLEASES[0];
  const region = selection ? { start: selection.start, end: selection.end } : undefined;

  const scan = () => {
    if (!doc) return;
    const found = findCrisprSites(doc, nuclease, { region, limit: 200 });
    setSites(found);
    setOffTargets({});
    useWorkbench
      .getState()
      .notify(
        found.length
          ? t('在{v0}中找到 {v1} 个 {v2} 靶点', { v0: region ? t('选区') : doc.name, v1: found.length, v2: nuclease.id })
          : t('没有找到 {v0} 的 PAM（{v1}）', { v0: nuclease.id, v1: nuclease.pam }),
      );
  };

  const checkOffTargets = () => {
    if (!sites?.length) return;
    setBusy(true);
    try {
      const next: Record<string, OffTargetScan> = {};
      for (const site of shown.slice(0, 50)) {
        next[site.id] = scanOffTargets(site.spacer, nuclease, docs, { maxMismatches: 3 });
      }
      setOffTargets(next);
    } finally {
      setBusy(false);
    }
  };

  const shown = (sites ?? []).filter((site) => !cleanOnly || site.warnings.length === 0);

  const toOligo = (site: CrisprSite) => {
    useWorkbench.getState().setOligoInsert(site.spacer);
    setTool('oligo');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('核酸酶')} hint={t(nuclease.source)}>
          <Select className="w-72" value={nucleaseId} onChange={(e) => setNucleaseId(e.target.value)} aria-label={t('核酸酶')}>
            {NUCLEASES.map((n) => (
              <option key={n.id} value={n.id}>
                {t(n.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Badge tone="blue">PAM {nuclease.pam}</Badge>
        <Badge tone="slate">{t('间隔序列 {n} nt', { n: nuclease.spacerLength })}</Badge>
        {nuclease.cutApproximate && <Badge tone="amber">{t('切点为近似值')}</Badge>}
        <div className="flex-1" />
        <Button size="sm" variant="primary" disabled={!doc} onClick={scan}>
          <Crosshair size={12} /> {region ? t('扫描选区') : t('扫描整条序列')}
        </Button>
      </div>
      {nuclease.note && <p className="text-[var(--muted)]">{t(nuclease.note)}</p>}
      {!doc && <p className="text-[var(--muted)]">{t('先打开一条序列。')}</p>}

      {sites && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <b>{shown.length} / {sites.length} 个靶点</b>
            <span className="text-[var(--muted)]">
              {region ? t('选区 {v0}..{v1}', { v0: region.start + 1, v1: region.end }) : doc?.name}
            </span>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={cleanOnly} onChange={(e) => setCleanOnly(e.target.checked)} />
              只看没有提示的
            </label>
            <div className="flex-1" />
            <Button size="sm" disabled={busy || !sites.length} onClick={checkOffTargets}>
              <Radar size={12} /> {busy ? t('检查中…') : t('在已打开的 {v0} 条序列中查脱靶', { v0: docs.length })}
            </Button>
          </div>
          <p className="text-[var(--muted)]">
            {t('脱靶检查只覆盖当前打开的序列，不是全基因组搜索；结果干净只代表「这里没有」，不代表基因组里没有。')}
          </p>
          <div className="max-h-[46vh] overflow-auto rounded-md border border-[var(--border)]">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[var(--panel)] text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">{t('位置')}</th>
                  <th className="px-2 py-1.5 text-left font-medium">{t('间隔序列（5′→3′）')}</th>
                  <th className="px-2 py-1.5 text-left font-medium">PAM</th>
                  <th className="px-2 py-1.5 text-left font-medium">{t('切点')}</th>
                  <th className="px-2 py-1.5 text-left font-medium">GC</th>
                  <th className="px-2 py-1.5 text-left font-medium">{t('提示 / 脱靶')}</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((site) => {
                  const scanResult = offTargets[site.id];
                  const extra = scanResult ? scanResult.hits.filter((h) => h.mismatches > 0) : null;
                  return (
                    <tr key={site.id} className="border-t border-[var(--border)] align-top">
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {site.start + 1}..{site.end} {site.strand === 1 ? '→' : '←'}
                      </td>
                      <td className="mono px-2 py-1.5">{site.spacer}</td>
                      <td className="mono px-2 py-1.5 text-[var(--muted)]">{site.pam}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[var(--muted)]">
                        {site.cutTop === site.cutBottom
                          ? t('{v0} 平末端', { v0: site.cutTop })
                          : t('{v0} / {v1} 粘性', { v0: site.cutTop, v1: site.cutBottom })}
                      </td>
                      <td className="px-2 py-1.5 text-[var(--muted)]">{site.gcPercent.toFixed(0)}%</td>
                      <td className="px-2 py-1.5">
                        {site.warnings.map((w) => (
                          <div key={w} className="text-amber-600">
                            {w}
                          </div>
                        ))}
                        {extra && (
                          <div className={extra.length ? 'text-red-600' : 'text-green-600'}>
                            {extra.length
                              ? t('{v0} 个 ≤3 错配位点（其中 {v1} 个种子区完全匹配）', { v0: extra.length, v1: extra.filter((h) => h.seedMismatches === 0).length })
                              : t('已打开的序列中无其他匹配')}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <Button size="sm" onClick={() => toOligo(site)}>
                          <Scissors size={12} /> {t('做成退火 Oligo')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-[var(--muted)]">
                      {t('没有找到 PAM 为 {v0} 的靶点。', { v0: nuclease.pam })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function HomologyPanel() {
  const t = useT();
  const docs = useWorkbench((s) => s.docs);
  const active = useWorkbench(selectActiveDoc);
  const selection = useWorkbench((s) => s.selection);
  const setTool = useWorkbench((s) => s.setTool);
  const [locusId, setLocusId] = useState('');
  const [donorId, setDonorId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [armLength, setArmLength] = useState(50);
  const [checkFlank, setCheckFlank] = useState(300);

  const locus = docs.find((d) => d.id === locusId) ?? active ?? null;
  const donor = docs.find((d) => d.id === donorId) ?? null;
  // The current selection is the obvious default for the stretch being replaced.
  const target =
    start !== '' && end !== ''
      ? { start: Number(start) - 1, end: Number(end) }
      : selection && locus?.id === active?.id
        ? { start: selection.start, end: selection.end }
        : null;

  const design: GenomicReplacement | null = useMemo(() => {
    if (!locus || !donor || !target || target.end < target.start) return null;
    try {
      return designGenomicReplacement({ locus, target, donor, armLength, checkFlank });
    } catch {
      return null;
    }
  }, [locus, donor, target?.start, target?.end, armLength, checkFlank]);

  const openProduct = () => {
    if (!design) return;
    useWorkbench.getState().openDocs([design.product]);
    useWorkbench.getState().notify(t('已生成 {v0}（{v1} bp）', { v0: design.product.name, v1: design.product.length.toLocaleString() }));
    setTool(null);
  };

  const addDonorPrimers = () => {
    if (!design || !donor) return;
    if (
      replaceIfCurrent(
        donor,
        addPrimersToDoc(donor, [design.donorPrimers.forward, design.donorPrimers.reverse], t('同源重组供体扩增引物')),
        t('{v0} 已改变，请重新设计', { v0: donor.name }),
      )
    ) {
      useWorkbench.getState().notify(t('已把两条带同源臂的引物加入 {v0}', { v0: donor.name }));
    }
  };

  const addCheckPrimers = () => {
    if (!design?.checkPrimers || !locus) return;
    if (
      replaceIfCurrent(
        locus,
        addPrimersToDoc(locus, [design.checkPrimers.forward, design.checkPrimers.reverse], t('重组鉴定引物')),
        t('{v0} 已改变，请重新设计', { v0: locus.name }),
      )
    ) {
      useWorkbench.getState().notify(t('已把鉴定引物加入 {v0}', { v0: locus.name }));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[var(--muted)]">
        {t('以「基因组局部序列 + 供体片段」为输入：用位点两侧的序列作 5′ 同源臂扩增供体，重组后目标区段被替换。目标区段长度为 0 即为定点插入（敲入）。基因组片段可用「从 NCBI 导入」按坐标区间获取。')}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('基因组位点')} hint={locus ? `${locus.length.toLocaleString()} bp` : t('选择一条打开的序列')}>
          <Select className="w-48" aria-label={t('基因组位点')} value={locus?.id ?? ''} onChange={(e) => setLocusId(e.target.value)}>
            <option value="">{t('选择…')}</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('要替换的区段（1 起、含两端）')} hint={target ? `${target.end - target.start} bp` : t('留空则用当前选区')}>
          <div className="flex items-center gap-1">
            <Input className="w-24" inputMode="numeric" placeholder={t('起点')} value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />
            <span className="text-[var(--muted)]">..</span>
            <Input className="w-24" inputMode="numeric" placeholder={t('终点')} value={end} onChange={(e) => setEnd(e.target.value.replace(/\D/g, ''))} />
          </div>
        </Field>
        <Field label={t('供体片段')} hint={donor ? `${donor.length.toLocaleString()} bp` : t('例如抗性标记盒')}>
          <Select className="w-48" aria-label={t('供体片段')} value={donorId} onChange={(e) => setDonorId(e.target.value)}>
            <option value="">{t('选择…')}</option>
            {docs
              .filter((d) => d.id !== locus?.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t('同源臂')} hint={t('酵母与 λ-Red 常用 40–60 bp')}>
          <Select className="w-24" aria-label={t('同源臂长度')} value={armLength} onChange={(e) => setArmLength(Number(e.target.value))}>
            {[30, 40, 50, 60, 80, 100].map((n) => (
              <option key={n} value={n}>
                {n} bp
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('鉴定引物外延')} hint={t('引物落在同源臂之外')}>
          <Select className="w-24" aria-label={t('鉴定引物外延')} value={checkFlank} onChange={(e) => setCheckFlank(Number(e.target.value))}>
            {[150, 300, 500, 800].map((n) => (
              <option key={n} value={n}>
                {n} bp
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {design && (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">替换 {design.replacedBp.toLocaleString()} bp</Badge>
            <Badge tone="green">插入 {design.insertedBp.toLocaleString()} bp</Badge>
            <Badge tone="slate">产物 {design.product.length.toLocaleString()} bp</Badge>
            {design.expected && (
              <Badge tone={Math.abs(design.expected.editedBp - design.expected.wildTypeBp) >= 50 ? 'green' : 'amber'}>
                鉴定 PCR：野生型 {design.expected.wildTypeBp} bp / 重组型 {design.expected.editedBp} bp
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <PrimerLine label={t('供体 F')} tail={design.donorPrimers.forward.tailSequence} primer={design.donorPrimers.forward.sequence} tm={design.donorPrimers.forward.tmAnnealing} />
            <PrimerLine label={t('供体 R')} tail={design.donorPrimers.reverse.tailSequence} primer={design.donorPrimers.reverse.sequence} tm={design.donorPrimers.reverse.tmAnnealing} />
            {design.checkPrimers && (
              <>
                <PrimerLine label={t('鉴定 F')} tail="" primer={design.checkPrimers.forward.sequence} tm={design.checkPrimers.forward.tmAnnealing} />
                <PrimerLine label={t('鉴定 R')} tail="" primer={design.checkPrimers.reverse.sequence} tm={design.checkPrimers.reverse.tmAnnealing} />
              </>
            )}
          </div>
          {design.warnings.map((w) => (
            <p key={w} className="text-amber-600">
              {w}
            </p>
          ))}
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={addDonorPrimers}>
              {t('把供体引物加入 {v0}', { v0: donor?.name ?? '' })}
            </Button>
            <Button size="sm" disabled={!design.checkPrimers} onClick={addCheckPrimers}>
              {t('把鉴定引物加入 {v0}', { v0: locus?.name ?? '' })}
            </Button>
            <Button size="sm" variant="primary" onClick={openProduct}>
              {t('打开重组后的位点')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PrimerLine({ label, tail, primer, tm }: { label: string; tail: string; primer: string; tm: number }) {
  const t = useT();
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-[var(--muted)]">{label}</span>
      <span className="mono break-all">
        {tail && <b title={t('同源臂')}>{tail}</b>}
        {primer.slice(tail.length)}
      </span>
      <span className="shrink-0 text-[var(--muted)]">
        {primer.length} nt · {tm.toFixed(1)} °C
      </span>
    </div>
  );
}
