import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import {
  BookMarked,
  Bot,
  Download,
  Globe,
  SlidersHorizontal,
  FileUp,
  FlaskConical,
  Moon,
  MonitorPlay,
  Redo2,
  Search,
  Sun,
  Undo2,
  X,
} from 'lucide-react';
import type { ORF, PlasmidDocument, VirtualGelLane } from '../types/schema';
import {
  parseBioFile,
  parseFastq,
  parseProteinFile,
  isProteinFile,
  exportPlasmidToFasta,
  exportPlasmidToGenBank,
  exportPlasmidToSnapGene,
  exportPlasmidToSnapGeneJson,
} from '../modules/io-adapter';
import { DNA_LADDERS, type LadderName } from '../modules/alignment-gel';
import {
  CircularPlasmidMap,
  LinearPlasmidMap,
  MapDisplayOptionsPanel,
  ProteinSequenceView,
  printSequenceText,
  printSvg,
  LinearSequenceEditor,
  SangerAlignmentViewer,
  VirtualGelSimulator,
  exportSvgToPdf,
  exportSvgToPng,
  exportSvgToPublicationFile,
} from '../modules/canvas-ui';
import { CopilotSidebar } from '../modules/ai-copilot/CopilotSidebar';
import { callBio } from './bio-client';
import { applyAIAction, digestToGel, historyNode, refreshCutSites, uncutPlasmidSample, uid } from './actions';
import { CloningWizard } from './CloningWizard';
import { EnzymePanel, FeaturePanel, Inspector } from './panels';
import { AlignView, BackTranslateDialog, FindDialog } from './tools';
import { HistoryView } from './history';
import { DemoPlayer, startDemo } from './demo';
import { NcbiDialog, PrimerLibraryDialog } from './library';
import { loadSampleLibrary } from './samples';
import { selectActiveDoc, useWorkbench, type ViewMode, type WizardKind } from './store';
import { Button, Select, Tabs, cn } from './ui';
import type { SequenceEdit } from '../modules/seq-engine';

// The gel model takes field strength (V/cm); the UI shows volts across a standard 20 cm tank.
const GEL_BOX_CM = 20;

const VIEWS: Array<{ value: ViewMode; label: string }> = [
  { value: 'split', label: '双视图' },
  { value: 'map', label: '环形图谱' },
  { value: 'sequence', label: '序列' },
  { value: 'enzymes', label: '酶' },
  { value: 'features', label: '特征/引物' },
  { value: 'gel', label: '虚拟电泳' },
  { value: 'sanger', label: 'Sanger 比对' },
  { value: 'align', label: '多序列比对' },
  { value: 'history', label: '历史树' },
];

type ExportFormat = 'gbk' | 'dna' | 'fasta' | 'json' | 'svg' | 'png' | 'pdf' | 'print-map' | 'print-seq';

// FASTQ reads beyond this are not shown as traces; aligning thousands in the viewer is not useful.
const MAX_FASTQ_TRACES = 200;

function download(name: string, content: string | Uint8Array<ArrayBuffer>, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const s = useWorkbench();
  const doc = selectActiveDoc(s);
  const cutSites = (doc && s.cutSites[doc.id]) || [];
  const traces = (doc && s.traces[doc.id]) || [];
  const mapRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lanes, setLanes] = useState<VirtualGelLane[]>([]);
  const [dragging, setDragging] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const [mainHeight, setMainHeight] = useState(640);
  useEffect(() => {
    const el = mainRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setMainHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const temporal = useWorkbench.temporal;
  const dark = s.theme === 'dark';

  // Initial sample library.
  useEffect(() => {
    if (useWorkbench.getState().docs.length) return;
    loadSampleLibrary().then(({ docs, traces }) => {
      const st = useWorkbench.getState();
      st.openDocs(docs);
      Object.entries(traces).forEach(([id, t]) => st.setTraces(id, t));
      temporal.getState().clear();
      if (new URLSearchParams(window.location.search).has('demo')) startDemo();
    });
  }, [temporal]);

  // Cut sites follow the active document and enzyme set (computed off the main thread).
  useEffect(() => {
    if (doc) refreshCutSites(doc);
  }, [doc, s.enzymeSetId, s.customEnzymeSets]);

  // Align any unaligned Sanger reads against their plasmid.
  useEffect(() => {
    if (!doc || !traces.some((t) => !t.alignment)) return;
    Promise.all(traces.map((t) => (t.alignment ? t : callBio('alignTraceToPlasmid', t, doc)))).then((aligned) =>
      useWorkbench.getState().setTraces(doc.id, aligned),
    );
  }, [doc, traces]);

  // Default gel: ladder + uncut active plasmid.
  useEffect(() => {
    if (doc && !s.gelSamples.length) {
      s.setGelSamples([{ id: uid('lane'), label: 'NEB 1kb Plus', ladder: 'NEB 1kb Plus' }, uncutPlasmidSample(doc)]);
    }
  }, [doc, s.gelSamples.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!s.gelSamples.length) return;
    let alive = true;
    callBio('simulateVirtualGel', s.gelSamples, { ...s.gelParams, voltage: s.gelParams.voltage / GEL_BOX_CM }).then((l) => alive && setLanes(l));
    return () => {
      alive = false;
    };
  }, [s.gelSamples, s.gelParams]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    if (!s.toast) return;
    const t = setTimeout(() => useWorkbench.getState().notify(null), 6000);
    return () => clearTimeout(t);
  }, [s.toast]);

  const openFiles = useCallback(async (files: FileList | File[]) => {
    const st = useWorkbench.getState();
    for (const file of Array.from(files)) {
      try {
        if (/\.(ab1|abi|scf)$/i.test(file.name)) {
          const active = selectActiveDoc(useWorkbench.getState());
          if (!active) throw new Error('请先打开参考质粒');
          const trace = await callBio('parseAb1Trace', await file.arrayBuffer(), file.name);
          st.setTraces(active.id, [...(useWorkbench.getState().traces[active.id] ?? []), trace]);
          st.setView('sanger');
          continue;
        }
        if (/\.(fastq|fq)$/i.test(file.name)) {
          const active = selectActiveDoc(useWorkbench.getState());
          if (!active) throw new Error('请先打开参考序列');
          const reads = parseFastq(await file.text());
          const traces = await callBio('readsToTraces', reads.slice(0, MAX_FASTQ_TRACES));
          st.setTraces(active.id, [...(useWorkbench.getState().traces[active.id] ?? []), ...traces]);
          st.setView('sanger');
          st.notify(`已载入 ${Math.min(reads.length, MAX_FASTQ_TRACES)} / ${reads.length} 条读长，正在比对到 ${active.name}`);
          continue;
        }
        const binary = /\.(dna|prot|xdna|cm5)$/i.test(file.name);
        const data = binary ? await file.arrayBuffer() : await file.text();
        if (isProteinFile(file.name, data)) {
          const proteins = await parseProteinFile(file.name, data);
          st.openProteins(proteins);
          st.notify(`已打开蛋白 ${proteins.map((p) => p.name).join(', ')}`);
          continue;
        }
        const docs = await parseBioFile(file.name, data);
        st.openDocs(docs);
        st.notify(`已打开 ${docs.map((d) => d.name).join(', ')}`);
      } catch (e) {
        st.notify(`无法读取 ${file.name}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }, []);

  const onEdit = useCallback(
    async (edit: SequenceEdit) => {
      if (!doc) return;
      const next = await callBio('mutatePlasmidSequence', doc, edit);
      useWorkbench.getState().replaceDoc(next);
    },
    [doc],
  );

  const transform = async (kind: 'revcomp' | 'origin' | 'annotate' | 'topology') => {
    if (!doc) return;
    const st = useWorkbench.getState();
    if (kind === 'revcomp') st.replaceDoc(await callBio('reverseComplementPlasmid', doc));
    if (kind === 'origin' && s.selection) st.replaceDoc(await callBio('rotateCircularOrigin', doc, s.selection.start));
    if (kind === 'annotate') {
      const found = await callBio('autoAnnotateFeatures', doc);
      st.replaceDoc({
        ...doc,
        features: [...doc.features, ...found],
        updatedAt: new Date().toISOString(),
        history: [...doc.history, historyNode('manual_edit', `自动注释 ${found.length} 个特征`)],
      });
      st.notify(`自动注释新增 ${found.length} 个特征`);
    }
    if (kind === 'topology') st.replaceDoc({ ...doc, topology: doc.topology === 'circular' ? 'linear' : 'circular' });
  };

  const exportAs = (fmt: ExportFormat) => {
    if (!doc) return;
    if (fmt === 'gbk') download(`${doc.name}.gbk`, exportPlasmidToGenBank(doc));
    if (fmt === 'dna') download(`${doc.name}.dna`, exportPlasmidToSnapGene(doc) as Uint8Array<ArrayBuffer>, 'application/octet-stream');
    if (fmt === 'fasta') download(`${doc.name}.fasta`, exportPlasmidToFasta(doc));
    if (fmt === 'json') download(`${doc.name}.json`, exportPlasmidToSnapGeneJson(doc), 'application/json');
    if (fmt === 'print-seq') return printSequenceText(doc, { bpPerLine: 60, showFeatures: true });
    const figure = fmt === 'svg' || fmt === 'png' || fmt === 'pdf' || fmt === 'print-map';
    if (figure && mapRef.current) {
      if (fmt === 'svg') exportSvgToPublicationFile(mapRef.current, `${doc.name}.svg`);
      else if (fmt === 'png') exportSvgToPng(mapRef.current, `${doc.name}.png`, 300);
      else if (fmt === 'pdf') exportSvgToPdf(mapRef.current, `${doc.name}.pdf`, { title: `${doc.name} (${doc.length} bp)` });
      else printSvg(mapRef.current, { title: `${doc.name} (${doc.length} bp)` });
    } else if (figure) {
      s.setView('map');
      s.notify('请在环形图谱视图中再次导出');
    }
  };

  // Global shortcuts: Cmd/Ctrl+K palette, Cmd/Ctrl+Z / Shift+Z undo/redo, Cmd/Ctrl+O open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useWorkbench.getState().setPaletteOpen(!useWorkbench.getState().paletteOpen);
      } else if (e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) temporal.getState().redo();
        else temporal.getState().undo();
      } else if (e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        temporal.getState().redo();
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileRef.current?.click();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        useWorkbench.getState().setTool('find');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [temporal]);

  const vizTheme = s.theme;
  // Like SnapGene's default, the map shows unique cutters with 6+ bp specific recognition sites.
  const uniqueCutters = useMemo(
    () => cutSites.filter((c) => c.totalCutsInPlasmid === 1 && c.enzyme.recognitionSeq.replace(/N/gi, '').length >= 6),
    [cutSites],
  );
  const [orfs, setOrfs] = useState<ORF[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  useEffect(() => {
    if (!doc || !s.mapOptions.showOrfs) return setOrfs([]);
    let alive = true;
    callBio('findAllORFs', doc, 75).then((r) => alive && setOrfs(r));
    return () => {
      alive = false;
    };
  }, [doc, s.mapOptions.showOrfs]);
  const linearMap = doc && (s.mapShape === 'linear' || (s.mapShape === 'auto' && doc.topology === 'linear'));
  const featureTypes = useMemo(() => [...new Set(doc?.features.map((f) => f.type) ?? [])], [doc]);
  const mapProps = doc && {
    doc,
    cutSites: uniqueCutters,
    orfs,
    selection: s.selection,
    onSelectionChange: s.setSelection,
    onFeatureClick: (f: { start: number; end: number }) => s.setSelection({ start: f.start, end: f.end }),
    theme: vizTheme,
    displayOptions: s.mapOptions,
    svgRef: mapRef,
  };
  const mapView = mapProps && (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <Select aria-label="图谱形状" value={s.mapShape} onChange={(e) => s.setMapShape(e.target.value as typeof s.mapShape)}>
          <option value="auto">自动</option>
          <option value="circular">环形</option>
          <option value="linear">线性</option>
        </Select>
        <Button size="sm" onClick={() => setOptionsOpen(!optionsOpen)} title="图谱显示选项">
          <SlidersHorizontal size={13} /> 显示
        </Button>
      </div>
      {optionsOpen && (
        <div className="absolute right-2 top-11 z-20 w-72 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 shadow-xl">
          <MapDisplayOptionsPanel value={s.mapOptions} onChange={(v) => s.setMapOptions(v)} featureTypes={featureTypes} />
        </div>
      )}
      {linearMap ? <LinearPlasmidMap {...mapProps} width={Math.max(640, mainHeight * 1.4)} /> : <CircularPlasmidMap {...mapProps} showPrimers={s.mapOptions.showPrimers !== false} />}
    </div>
  );
  const protein = s.proteins.find((p) => p.id === s.activeProteinId) ?? null;
  const seqView = doc && (
    <LinearSequenceEditor
      doc={doc}
      cutSites={uniqueCutters}
      selection={s.selection}
      onSelectionChange={s.setSelection}
      onEdit={onEdit}
      bpPerRow={60}
      translationMode="cds"
      theme={vizTheme}
      height={Math.max(320, mainHeight - 60)}
    />
  );

  return (
    <div
      className={cn('flex h-full flex-col', dark && 'dark')}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        openFiles(e.dataTransfer.files);
      }}
    >
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2">
        <div className="mr-2 flex items-baseline gap-2" title="GATC — Gene Assembly & Toolkit for Cloning">
          <span className="mono text-[17px] font-bold tracking-[0.12em]" aria-label="GATC">
            <span className="text-slate-800 dark:text-slate-200">G</span>
            <span className="text-emerald-600">A</span>
            <span className="text-red-600">T</span>
            <span className="text-blue-600">C</span>
          </span>
          <span className="hidden text-[11px] text-[var(--muted)] lg:inline">Gene Assembly &amp; Toolkit for Cloning</span>
        </div>
        <Button size="sm" onClick={() => fileRef.current?.click()} title="打开文件 (Ctrl+O)">
          <FileUp size={14} /> 打开
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept=".dna,.prot,.gb,.gbk,.gp,.genbank,.ape,.seq,.xdna,.cm5,.fasta,.fa,.fas,.faa,.embl,.gff,.ab1,.abi,.fastq,.fq,.json,.xml,.sbol,.txt,.geneious"
          onChange={(e) => e.target.files && openFiles(e.target.files)}
        />
        <ExportMenu onExport={exportAs} disabled={!doc} />
        <Button size="sm" onClick={() => s.setTool('ncbi')} title="按登录号从 NCBI 导入">
          <Globe size={14} /> NCBI
        </Button>
        <Button size="sm" onClick={() => s.setTool('primerlib')} title="引物库">
          <BookMarked size={14} /> 引物库
        </Button>
        <Button size="sm" onClick={() => s.setTool('find')} disabled={!doc} title="查找 (Ctrl+F)">
          <Search size={14} /> 查找
        </Button>
        <Button size="sm" variant="primary" onClick={() => s.setWizard('restriction')} disabled={!doc}>
          <FlaskConical size={14} /> 克隆向导
        </Button>
        <Button size="icon" variant="ghost" onClick={() => temporal.getState().undo()} title="撤销 (Ctrl+Z)">
          <Undo2 size={15} />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => temporal.getState().redo()} title="重做 (Ctrl+Shift+Z)">
          <Redo2 size={15} />
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant={s.demo ? 'primary' : 'default'} onClick={() => (s.demo ? s.setDemo(null) : startDemo())} disabled={!doc} title="自动演示主要功能">
          <MonitorPlay size={14} /> 演示
        </Button>
        <Button size="sm" variant="ghost" onClick={() => s.setPaletteOpen(true)}>
          <Search size={14} /> 命令 <kbd className="rounded border border-[var(--border)] px-1 text-[10px]">Ctrl K</kbd>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => s.setTheme(s.theme === 'dark' ? 'light' : s.theme === 'light' ? 'publication' : 'dark')}
          title={`主题：${s.theme}`}
        >
          {dark ? <Moon size={15} /> : <Sun size={15} />}
        </Button>
        <Button size="sm" variant={s.copilotOpen ? 'primary' : 'default'} onClick={() => s.setCopilotOpen(!s.copilotOpen)}>
          <Bot size={14} /> AI 导师
        </Button>
      </header>

      {/* Document tabs + view switcher */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-1.5">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {s.docs.map((d) => (
            <div
              key={d.id}
              className={cn(
                'group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs',
                d.id === s.activeId ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
              onClick={() => s.setActive(d.id)}
            >
              {d.name}
              <span className="text-[var(--muted)]">{d.length} bp</span>
              <button
                className="opacity-40 hover:opacity-100"
                onClick={(e) => (e.stopPropagation(), s.closeDoc(d.id))}
                aria-label="关闭"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {s.proteins.map((p) => (
            <div
              key={p.id}
              className={cn(
                'group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs',
                p.id === s.activeProteinId ? 'bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
              onClick={() => s.setActiveProtein(p.id)}
            >
              {p.name}
              <span className="text-[var(--muted)]">{p.sequence.length} aa</span>
              <button className="opacity-40 hover:opacity-100" onClick={(e) => (e.stopPropagation(), s.closeProtein(p.id))} aria-label="关闭">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="max-w-full overflow-x-auto">
          <Tabs value={s.view} onChange={s.setView} items={VIEWS} />
        </div>
      </div>

      {/* Main */}
      <div className="flex min-h-0 flex-1">
        <main ref={mainRef} className="min-w-0 flex-1 overflow-hidden">
          {protein ? (
            <ProteinSequenceView protein={protein} theme={vizTheme} height={Math.max(320, mainHeight - 20)} />
          ) : !doc ? (
            <div className="flex h-full items-center justify-center text-[var(--muted)]">正在加载示例质粒… 也可以拖入 .dna / .gb / .fasta / .ab1 文件</div>
          ) : (
            <div className="h-full">
              {s.view === 'split' && (
                <div className="grid h-full grid-cols-1 lg:grid-cols-2">
                  <div className="flex min-h-0 items-center justify-center overflow-auto border-r border-[var(--border)]">{mapView}</div>
                  <div className="min-h-0 overflow-hidden">{seqView}</div>
                </div>
              )}
              {s.view === 'map' && <div className="flex h-full items-center justify-center overflow-auto">{mapView}</div>}
              {s.view === 'sequence' && seqView}
              {s.view === 'enzymes' && <EnzymePanel doc={doc} sites={cutSites} />}
              {s.view === 'features' && <FeaturePanel doc={doc} />}
              {s.view === 'gel' && (
                <div className="flex h-full flex-col">
                  <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] p-2 text-xs">
                    <span className="text-[var(--muted)]">泳道：</span>
                    {s.gelSamples.map((g, i) => (
                      <span key={g.id ?? i} className="inline-flex items-center gap-1 rounded bg-[var(--bg)] px-1.5 py-0.5">
                        {g.label}
                        <button onClick={() => s.setGelSamples(s.gelSamples.filter((_, j) => j !== i))} aria-label="移除泳道">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                    <Button size="sm" onClick={() => s.addGelSample(uncutPlasmidSample(doc))}>
                      + 未酶切 {doc.name}
                    </Button>
                    <Select
                      aria-label="添加 Ladder"
                      value=""
                      onChange={(e) => {
                        const ladder = e.target.value as LadderName;
                        if (ladder) s.addGelSample({ id: uid('lane'), label: ladder, ladder });
                      }}
                    >
                      <option value="">+ Ladder…</option>
                      {(Object.keys(DNA_LADDERS) as LadderName[]).map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-3">
                    <VirtualGelSimulator
                      lanes={lanes}
                      agarosePercent={s.gelParams.agarosePercent}
                      voltage={s.gelParams.voltage}
                      minutes={s.gelParams.minutes}
                      onParamsChange={s.setGelParams}
                      mode={s.gelMode}
                      onModeChange={s.setGelMode}
                    />
                  </div>
                </div>
              )}
              {s.view === 'sanger' && <SangerAlignmentViewer doc={doc} traces={traces} theme={vizTheme} showCoverage={traces.length > 1} />}
              {s.view === 'align' && <AlignView theme={vizTheme} />}
              {s.view === 'history' && <HistoryView doc={doc} theme={vizTheme} />}
            </div>
          )}
        </main>
        {doc && !protein && (
          <aside className="hidden w-72 shrink-0 overflow-auto border-l border-[var(--border)] bg-[var(--panel)] xl:block">
            <Inspector doc={doc} />
          </aside>
        )}
        {doc && s.copilotOpen && (
          <CopilotSidebar
            doc={doc}
            cutSites={cutSites}
            selection={s.selection}
            traces={traces}
            onApplyAction={applyAIAction}
            open={s.copilotOpen}
            onClose={() => s.setCopilotOpen(false)}
          />
        )}
      </div>

      {s.toast && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          {s.toast}
        </div>
      )}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-4 border-dashed border-blue-500 bg-blue-500/10 text-lg font-semibold text-blue-700">
          释放以打开文件
        </div>
      )}

      <CloningWizard />
      <DemoPlayer />
      <FindDialog />
      <NcbiDialog />
      <PrimerLibraryDialog />
      <BackTranslateDialog />
      <CommandPalette
        doc={doc}
        onOpen={() => fileRef.current?.click()}
        onExport={exportAs}
        onTransform={transform}
      />
    </div>
  );
}

function ExportMenu({ onExport, disabled }: { onExport: (f: ExportFormat) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" disabled={disabled} onClick={() => setOpen(!open)}>
        <Download size={14} /> 导出
      </Button>
      {open && (
        <div className="absolute left-0 top-9 z-30 w-48 rounded-md border border-[var(--border)] bg-[var(--panel)] p-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
          {(
            [
              ['dna', 'SnapGene (.dna)'],
              ['gbk', 'GenBank (.gbk, SnapGene/ApE)'],
              ['fasta', 'FASTA'],
              ['json', 'JSON'],
              ['svg', '图谱 SVG（出版级）'],
              ['png', '图谱 PNG 300 dpi'],
              ['pdf', '图谱 PDF（矢量）'],
              ['print-map', '打印图谱…'],
              ['print-seq', '打印序列…'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => (onExport(k), setOpen(false))}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommandPalette({
  doc,
  onOpen,
  onExport,
  onTransform,
}: {
  doc: PlasmidDocument | null;
  onOpen: () => void;
  onExport: (f: ExportFormat) => void;
  onTransform: (k: 'revcomp' | 'origin' | 'annotate' | 'topology') => void;
}) {
  const open = useWorkbench((s) => s.paletteOpen);
  const setOpen = useWorkbench((s) => s.setPaletteOpen);
  const st = useWorkbench.getState;
  const [query, setQuery] = useState('');
  const run = (fn: () => void) => () => {
    setOpen(false);
    setQuery('');
    fn();
  };
  const enzymeQuery = useMemo(() => {
    const m = query.match(/^(?:digest|酶切)\s+(.+)$/i);
    return m ? m[1].split(/[,\s+]+/).filter(Boolean) : null;
  }, [query]);
  if (!open) return null;

  const wizards: Array<[WizardKind, string]> = [
    ['primers', '设计引物对'],
    ['pcr', 'PCR / 融合 PCR'],
    ['restriction', '酶切连接'],
    ['gibson', 'Gibson 组装'],
    ['golden_gate', 'Golden Gate 组装'],
    ['mutagenesis', '定点突变'],
    ['gateway', 'Gateway BP/LR'],
    ['ta_topo', 'TA / TOPO 克隆'],
    ['lic', 'LIC 克隆'],
    ['recombinase', 'Cre/Lox · Flp/FRT 重组'],
    ['insert', '插入片段'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div onMouseDown={(e) => e.stopPropagation()}>
        <Command label="命令面板" loop>
          <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="输入命令，或「酶切 EcoRI BamHI」…" />
          <Command.List>
            <Command.Empty>无匹配命令</Command.Empty>
            {enzymeQuery && doc && (
              <Command.Group heading="快速酶切">
                <Command.Item value={`digest ${query}`} onSelect={run(() => digestToGel(doc, enzymeQuery).then(() => st().setView('gel')))}>
                  酶切 {doc.name}：{enzymeQuery.join(' + ')} 并跑胶
                </Command.Item>
              </Command.Group>
            )}
            <Command.Group heading="视图">
              {VIEWS.map((v) => (
                <Command.Item key={v.value} onSelect={run(() => st().setView(v.value))}>
                  切换到 {v.label}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="克隆">
              {wizards.map(([k, label]) => (
                <Command.Item key={k} onSelect={run(() => st().setWizard(k))}>
                  {label}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="序列">
              <Command.Item onSelect={run(() => st().setTool('find'))}>查找序列 / 蛋白模式</Command.Item>
              <Command.Item onSelect={run(() => st().setTool('backtranslate'))}>反向翻译 / 密码子优化</Command.Item>
              <Command.Item onSelect={run(() => onTransform('annotate'))}>自动注释特征</Command.Item>
              <Command.Item onSelect={run(() => onTransform('revcomp'))}>反向互补整条序列</Command.Item>
              <Command.Item onSelect={run(() => onTransform('origin'))}>将选区起点设为新原点</Command.Item>
              <Command.Item onSelect={run(() => onTransform('topology'))}>切换环状/线性</Command.Item>
            </Command.Group>
            <Command.Group heading="文件">
              <Command.Item onSelect={run(onOpen)}>打开文件…</Command.Item>
              <Command.Item onSelect={run(() => st().setTool('ncbi'))}>从 NCBI 导入（登录号）</Command.Item>
              <Command.Item onSelect={run(() => st().setTool('primerlib'))}>引物库</Command.Item>
              <Command.Item onSelect={run(() => onExport('print-map'))}>打印图谱</Command.Item>
              <Command.Item onSelect={run(() => onExport('print-seq'))}>打印序列</Command.Item>
              <Command.Item onSelect={run(() => onExport('dna'))}>导出 SnapGene .dna</Command.Item>
              <Command.Item onSelect={run(() => onExport('gbk'))}>导出 GenBank</Command.Item>
              <Command.Item onSelect={run(() => onExport('fasta'))}>导出 FASTA</Command.Item>
              <Command.Item onSelect={run(() => onExport('svg'))}>导出图谱 SVG</Command.Item>
              <Command.Item onSelect={run(() => onExport('png'))}>导出图谱 PNG</Command.Item>
              <Command.Item onSelect={run(() => onExport('pdf'))}>导出图谱 PDF</Command.Item>
            </Command.Group>
            <Command.Group heading="其他">
              <Command.Item onSelect={run(startDemo)}>演示模式（自动演示主要功能）</Command.Item>
              <Command.Item onSelect={run(() => st().setCopilotOpen(true))}>打开 AI 实验导师</Command.Item>
              <Command.Item onSelect={run(() => useWorkbench.temporal.getState().undo())}>撤销</Command.Item>
              <Command.Item onSelect={run(() => useWorkbench.temporal.getState().redo())}>重做</Command.Item>
              <Command.Item onSelect={run(() => st().setTheme('dark'))}>深色主题</Command.Item>
              <Command.Item onSelect={run(() => st().setTheme('light'))}>浅色主题</Command.Item>
              <Command.Item onSelect={run(() => st().setTheme('publication'))}>出版白底主题</Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
