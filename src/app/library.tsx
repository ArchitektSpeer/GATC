// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// NCBI accession import and the persistent primer library.
import { useMemo, useState } from 'react';
import { Download, Plus, Search, Trash2 } from 'lucide-react';
import type { PlasmidDocument, Primer } from '../types/schema';
import { fetchFromNCBI, formatRegion, parseAccessionQuery } from '../modules/io-adapter';
import type { NcbiRegion } from '../modules/io-adapter';
import type { PrimerBindingHit } from '../modules/cloning-primer';
import { evaluateOligoThermodynamics } from '../modules/cloning-primer';
import { callBio } from './bio-client';
import { addPrimersToDoc, replaceIfCurrent, uid } from './actions';
import { selectActiveDoc, useWorkbench, type LibraryPrimer } from './store';
import { Badge, Button, Dialog, Field, Input } from './ui';
import { t as translate, useT } from '../lib/i18n';

const EXAMPLES = ['L09137', 'U55762', 'NM_000546', 'NP_000537', 'U00096.3:1000-2000'];

/** What the dialog will ask NCBI for, or why it cannot ask yet. */
type Resolved =
  | { ok: true; accession: string; db: 'nuccore' | 'protein'; region?: NcbiRegion }
  | { ok: false; reason: string | null };

function resolve(input: string, start: string, end: string, minus: boolean): Resolved {
  const text = input.trim();
  if (!text) return { ok: false, reason: null };
  let parsed;
  try {
    parsed = parseAccessionQuery(text);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (!parsed) return { ok: false, reason: translate('无法识别的登录号或 NCBI 链接') };
  // The explicit range fields win over a range written into the accession.
  if (start.trim() || end.trim()) {
    const from = Number(start);
    const to = Number(end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !start.trim() || !end.trim()) {
      return { ok: false, reason: translate('区间需要同时填写起点和终点') };
    }
    if (parsed.db === 'protein') return { ok: false, reason: translate('NCBI 只能按区间截取核酸记录') };
    if (from < 1 || to < from) return { ok: false, reason: translate('区间起点从 1 开始，且终点不能小于起点') };
    if (to - from + 1 > 5_000_000) return { ok: false, reason: translate('区间超过 5 Mb 上限') };
    return { ok: true, ...parsed, region: { start: from, end: to, strand: minus ? -1 : 1 } };
  }
  return { ok: true, ...parsed };
}

export function NcbiDialog() {
  const t = useT();
  const open = useWorkbench((s) => s.tool === 'ncbi');
  const setTool = useWorkbench((s) => s.setTool);
  const [input, setInput] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [minus, setMinus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolved = resolve(input, start, end, minus);

  const hint = !resolved.ok
    ? (resolved.reason ?? t('核酸（nuccore）或蛋白（protein）均可；核酸还可只取一段区间'))
    : resolved.region
      ? `核酸库：${resolved.accession}，区间 ${formatRegion(resolved.region)}（${(
          resolved.region.end -
          resolved.region.start +
          1
        ).toLocaleString()} bp）`
      : t('{v0}库：{v1}（整条记录）', { v0: resolved.db === 'protein' ? t('蛋白') : t('核酸'), v1: resolved.accession });

  const fetchIt = async () => {
    if (!resolved.ok) return setError(resolved.reason ?? t('请输入登录号'));
    setBusy(true);
    setError(null);
    try {
      const result = await fetchFromNCBI(resolved.accession, {
        db: resolved.db,
        region: resolved.region,
      });
      const st = useWorkbench.getState();
      if ('topology' in result) st.openDocs([result]);
      else st.openProteins([result]);
      st.notify(t('已从 NCBI 导入 {v0}（{v1} {v2}）', { v0: result.name, v1: result.sequence.length.toLocaleString(), v2: 'topology' in result ? 'bp' : 'aa' }));
      setTool(null);
      setInput('');
      setStart('');
      setEnd('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => setTool(null)} title={t('从 NCBI 导入')} width={560}>
      <div className="flex flex-col gap-3">
        <Field label={t('登录号、NCBI 链接或区间')} hint={hint}>
          <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchIt()} placeholder={t('L09137.2 或 U00096.3:1000-2000')} />
        </Field>
        <Field
          label={t('只取一段（可留空）')}
          hint={t('染色体记录动辄数 Mb，按区间截取就只下载目标片段；特征坐标由 NCBI 重新编号，结果按线性片段打开')}
        >
          <div className="flex items-center gap-2">
            <Input className="w-28" inputMode="numeric" placeholder={t('起点')} value={start} onChange={(e) => setStart(e.target.value.replace(/[^\d]/g, ''))} />
            <span className="text-[var(--muted)]">..</span>
            <Input className="w-28" inputMode="numeric" placeholder={t('终点')} value={end} onChange={(e) => setEnd(e.target.value.replace(/[^\d]/g, ''))} />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={minus} onChange={(e) => setMinus(e.target.checked)} />
              {t('反向链')}
            </label>
          </div>
        </Field>
        <div className="flex flex-wrap gap-1 text-xs">
          {t('示例：')}
          {EXAMPLES.map((x) => (
            <button key={x} className="mono rounded bg-[var(--bg)] px-1.5 hover:underline" onClick={() => setInput(x)}>
              {x}
            </button>
          ))}
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex justify-end">
          <Button variant="primary" disabled={busy || !resolved.ok} onClick={fetchIt}>
            <Download size={14} /> {busy ? t('下载中…') : t('导入')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function toPrimer(doc: PlasmidDocument, lib: LibraryPrimer, hit: PrimerBindingHit): Primer {
  const seq = lib.sequence.toUpperCase();
  const annealLen = hit.end > hit.start ? hit.end - hit.start : doc.length - hit.start + hit.end;
  const full = evaluateOligoThermodynamics(seq);
  return {
    id: uid('p'),
    name: lib.name,
    sequence: seq,
    bindingStart: hit.start,
    bindingEnd: hit.end,
    strand: hit.strand,
    tailSequence: seq.slice(0, Math.max(0, seq.length - annealLen)),
    tmAnnealing: hit.tmAnnealing,
    tmTotal: full.tm,
    gcPercent: full.gcPercent,
    has3PrimeGCClamp: /[GC]$/.test(seq),
    hairpinDeltaG: full.hairpinDeltaG,
    selfDimerDeltaG: full.selfDimerDeltaG,
    mismatches: hit.mismatchPositions.length ? hit.mismatchPositions : undefined,
  };
}

/** Parses "name<TAB or space or comma>sequence" lines, or FASTA. */
function parsePrimerList(text: string): LibraryPrimer[] {
  const out: LibraryPrimer[] = [];
  if (text.trim().startsWith('>')) {
    for (const block of text.split('>').slice(1)) {
      const [head, ...rest] = block.split('\n');
      const seq = rest.join('').replace(/[^ACGTNacgtn]/g, '');
      if (seq.length >= 10) out.push({ id: uid('lp'), name: head.trim() || `Primer ${out.length + 1}`, sequence: seq.toUpperCase() });
    }
    return out;
  }
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(.+?)[\t, ]+([ACGTNacgtn]{10,})\s*$/);
    if (m) out.push({ id: uid('lp'), name: m[1].trim(), sequence: m[2].toUpperCase() });
  }
  return out;
}

export function PrimerLibraryDialog() {
  const t = useT();
  const open = useWorkbench((s) => s.tool === 'primerlib');
  const setTool = useWorkbench((s) => s.setTool);
  const library = useWorkbench((s) => s.primerLibrary);
  const setLibrary = useWorkbench((s) => s.setPrimerLibrary);
  const docs = useWorkbench((s) => s.docs);
  const activeDoc = useWorkbench(selectActiveDoc);
  const [query, setQuery] = useState('');
  const [bulk, setBulk] = useState('');
  const [mismatches, setMismatches] = useState(1);
  const [results, setResults] = useState<Array<{ lib: LibraryPrimer; doc: PlasmidDocument; hit: PrimerBindingHit }> | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? library.filter((p) => p.name.toLowerCase().includes(q) || p.sequence.toLowerCase().includes(q)) : library;
  }, [library, query]);

  const importBulk = () => {
    const items = parsePrimerList(bulk);
    if (!items.length) return useWorkbench.getState().notify(t('没有识别到引物（每行「名称 序列」或 FASTA）'));
    setLibrary([...library, ...items]);
    setBulk('');
    useWorkbench.getState().notify(t('已导入 {v0} 条引物到引物库', { v0: items.length }));
  };

  const collectFromDoc = () => {
    if (!activeDoc) return;
    const known = new Set(library.map((p) => p.sequence));
    const items = activeDoc.primers.filter((p) => !known.has(p.sequence)).map((p) => ({ id: uid('lp'), name: p.name, sequence: p.sequence, note: activeDoc.name }));
    setLibrary([...library, ...items]);
    useWorkbench.getState().notify(t('从 {v0} 收录 {v1} 条引物', { v0: activeDoc.name, v1: items.length }));
  };

  const search = async () => {
    setBusy(true);
    try {
      const found: Array<{ lib: LibraryPrimer; doc: PlasmidDocument; hit: PrimerBindingHit }> = [];
      for (const doc of docs) {
        for (const lib of shown) {
          const hits = await callBio('findPrimerBindingSites', doc, lib.sequence, { maxMismatches: mismatches });
          hits.forEach((hit) => found.push({ lib, doc, hit }));
        }
      }
      setResults(found);
    } finally {
      setBusy(false);
    }
  };

  // `doc` is the version the binding site was found on; the hit's coordinates only hold for it.
  const addToDoc = (doc: PlasmidDocument, lib: LibraryPrimer, hit: PrimerBindingHit) => {
    if (replaceIfCurrent(doc, addPrimersToDoc(doc, [toPrimer(doc, lib, hit)], t('从引物库添加 {v0}', { v0: lib.name })), t('{v0} 在搜索之后已改变，结合位置已失效，请重新查找', { v0: doc.name })))
      useWorkbench.getState().notify(t('已把 {v0} 添加到 {v1}', { v0: lib.name, v1: doc.name }));
  };

  return (
    <Dialog open={open} onClose={() => setTool(null)} title={t('引物库（{v0}）', { v0: library.length })} width={860}>
      <div className="flex flex-col gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-56" placeholder={t('按名称或序列过滤')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button size="sm" disabled={!activeDoc?.primers.length} onClick={collectFromDoc}>
            <Plus size={12} /> {t('收录当前序列的引物')}
          </Button>
          <div className="flex-1" />
          <label className="flex items-center gap-1">
            {t('允许错配')}
            <select className="rounded border border-[var(--border)] bg-[var(--panel)]" value={mismatches} onChange={(e) => setMismatches(Number(e.target.value))}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="primary" disabled={busy || !shown.length || !docs.length} onClick={search}>
            <Search size={12} /> {busy ? t('搜索中…') : t('在 {v0} 条序列中查找结合位点', { v0: docs.length })}
          </Button>
        </div>
        <div className="max-h-56 overflow-auto rounded-md border border-[var(--border)]">
          <table className="w-full">
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-t border-[var(--border)] first:border-0">
                  <td className="p-1.5 font-medium">{p.name}</td>
                  <td className="mono break-all">{p.sequence}</td>
                  <td className="text-[var(--muted)]">{p.sequence.length} nt</td>
                  <td className="text-[var(--muted)]">{p.note}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" aria-label={t('删除')} onClick={() => setLibrary(library.filter((x) => x.id !== p.id))}>
                      <Trash2 size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td className="p-4 text-center text-[var(--muted)]">{t('引物库为空。可在下方粘贴导入，或收录当前序列的引物。')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {results && (
          <div className="max-h-56 overflow-auto rounded-md border border-[var(--border)]">
            <table className="w-full">
              <tbody>
                {results.map(({ lib, doc, hit }, i) => (
                  <tr key={i} className="border-t border-[var(--border)] first:border-0">
                    <td className="p-1.5 font-medium">{lib.name}</td>
                    <td>{doc.name}</td>
                    <td className="mono">
                      {hit.start + 1}..{hit.end} {hit.strand === 1 ? '→' : '←'}
                    </td>
                    <td>{hit.mismatches ? <Badge tone="amber">{hit.mismatches} 错配</Badge> : <Badge tone="green">{t('完全匹配')}</Badge>}</td>
                    <td>{hit.tmAnnealing.toFixed(1)} °C</td>
                    <td className="text-right">
                      <Button size="sm" onClick={() => addToDoc(doc, lib, hit)}>
                        添加到序列
                      </Button>
                    </td>
                  </tr>
                ))}
                {!results.length && (
                  <tr>
                    <td className="p-4 text-center text-[var(--muted)]">{t('没有找到结合位点')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <Field label={t('批量导入（每行「名称 序列」，或 FASTA）')}>
          <textarea
            className="mono h-20 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 outline-none"
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={'M13F\tGTAAAACGACGGCCAGT\nM13R\tCAGGAAACAGCTATGAC'}
          />
        </Field>
        <div className="flex justify-end">
          <Button disabled={!bulk.trim()} onClick={importBulk}>
            {t('导入到引物库')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
