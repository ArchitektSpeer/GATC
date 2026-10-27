// NCBI accession import and the persistent primer library.
import { useMemo, useState } from 'react';
import { Download, Plus, Search, Trash2 } from 'lucide-react';
import type { PlasmidDocument, Primer } from '../types/schema';
import { fetchFromNCBI, normalizeAccession } from '../modules/io-adapter';
import type { PrimerBindingHit } from '../modules/cloning-primer';
import { evaluateOligoThermodynamics } from '../modules/cloning-primer';
import { callBio } from './bio-client';
import { addPrimersToDoc, uid } from './actions';
import { selectActiveDoc, useWorkbench, type LibraryPrimer } from './store';
import { Badge, Button, Dialog, Field, Input } from './ui';

const EXAMPLES = ['L09137', 'U55762', 'NM_000546', 'NP_000537'];

export function NcbiDialog() {
  const open = useWorkbench((s) => s.tool === 'ncbi');
  const setTool = useWorkbench((s) => s.setTool);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = input.trim() ? normalizeAccession(input.trim()) : null;

  const fetchIt = async () => {
    if (!parsed) return setError('无法识别的登录号或 NCBI 链接');
    setBusy(true);
    setError(null);
    try {
      const result = await fetchFromNCBI(parsed.accession, { db: parsed.db });
      const st = useWorkbench.getState();
      if ('topology' in result) st.openDocs([result]);
      else st.openProteins([result]);
      st.notify(`已从 NCBI 导入 ${result.name}（${result.sequence.length.toLocaleString()} ${'topology' in result ? 'bp' : 'aa'}）`);
      setTool(null);
      setInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => setTool(null)} title="从 NCBI 导入" width={560}>
      <div className="flex flex-col gap-3">
        <Field label="登录号或 NCBI 链接" hint={parsed ? `${parsed.db === 'protein' ? '蛋白' : '核酸'}库：${parsed.accession}` : '核酸（nuccore）或蛋白（protein）均可'}>
          <Input autoFocus value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchIt()} placeholder="L09137.2" />
        </Field>
        <div className="flex flex-wrap gap-1 text-xs">
          示例：
          {EXAMPLES.map((x) => (
            <button key={x} className="mono rounded bg-[var(--bg)] px-1.5 hover:underline" onClick={() => setInput(x)}>
              {x}
            </button>
          ))}
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex justify-end">
          <Button variant="primary" disabled={busy || !parsed} onClick={fetchIt}>
            <Download size={14} /> {busy ? '下载中…' : '导入'}
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
    if (!items.length) return useWorkbench.getState().notify('没有识别到引物（每行「名称 序列」或 FASTA）');
    setLibrary([...library, ...items]);
    setBulk('');
    useWorkbench.getState().notify(`已导入 ${items.length} 条引物到引物库`);
  };

  const collectFromDoc = () => {
    if (!activeDoc) return;
    const known = new Set(library.map((p) => p.sequence));
    const items = activeDoc.primers.filter((p) => !known.has(p.sequence)).map((p) => ({ id: uid('lp'), name: p.name, sequence: p.sequence, note: activeDoc.name }));
    setLibrary([...library, ...items]);
    useWorkbench.getState().notify(`从 ${activeDoc.name} 收录 ${items.length} 条引物`);
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

  const addToDoc = (doc: PlasmidDocument, lib: LibraryPrimer, hit: PrimerBindingHit) => {
    const st = useWorkbench.getState();
    const current = st.docs.find((d) => d.id === doc.id) ?? doc;
    st.replaceDoc(addPrimersToDoc(current, [toPrimer(current, lib, hit)], `从引物库添加 ${lib.name}`));
    st.notify(`已把 ${lib.name} 添加到 ${doc.name}`);
  };

  return (
    <Dialog open={open} onClose={() => setTool(null)} title={`引物库（${library.length}）`} width={860}>
      <div className="flex flex-col gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-56" placeholder="按名称或序列过滤" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button size="sm" disabled={!activeDoc?.primers.length} onClick={collectFromDoc}>
            <Plus size={12} /> 收录当前序列的引物
          </Button>
          <div className="flex-1" />
          <label className="flex items-center gap-1">
            允许错配
            <select className="rounded border border-[var(--border)] bg-[var(--panel)]" value={mismatches} onChange={(e) => setMismatches(Number(e.target.value))}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="primary" disabled={busy || !shown.length || !docs.length} onClick={search}>
            <Search size={12} /> {busy ? '搜索中…' : `在 ${docs.length} 条序列中查找结合位点`}
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
                    <Button size="sm" variant="ghost" aria-label="删除" onClick={() => setLibrary(library.filter((x) => x.id !== p.id))}>
                      <Trash2 size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td className="p-4 text-center text-[var(--muted)]">引物库为空。可在下方粘贴导入，或收录当前序列的引物。</td>
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
                    <td>{hit.mismatches ? <Badge tone="amber">{hit.mismatches} 错配</Badge> : <Badge tone="green">完全匹配</Badge>}</td>
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
                    <td className="p-4 text-center text-[var(--muted)]">没有找到结合位点</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <Field label="批量导入（每行「名称 序列」，或 FASTA）">
          <textarea
            className="mono h-20 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 outline-none"
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            placeholder={'M13F\tGTAAAACGACGGCCAGT\nM13R\tCAGGAAACAGCTATGAC'}
          />
        </Field>
        <div className="flex justify-end">
          <Button disabled={!bulk.trim()} onClick={importBulk}>
            导入到引物库
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
