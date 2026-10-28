// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import {
  Bot,
  Download,
  SlidersHorizontal,
  FileUp,
  FlaskConical,
  Moon,
  Redo2,
  Save,
  Search,
  Sun,
  Undo2,
  Wrench,
  X,
} from 'lucide-react';
import type { ORF, PlasmidDocument, SangerTraceData, VirtualGelLane } from '../types/schema';
import {
  parseBioFile,
  parseProteinFile,
  isProteinFile,
  isProjectFile,
  parseProjectFile,
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
import { callBio, callBioForDoc, callBioSync } from './bio-client';
import { STALE_RESULT, applyAIAction, digestToGel, historyNode, refreshCutSites, replaceIfCurrent, uncutPlasmidSample, uid, updateDoc } from './actions';
import { docRevision } from './revision';
import { CloningWizard } from './CloningWizard';
import { EnzymePanel, FeaturePanel, Inspector } from './panels';
import { AlignView, BackTranslateDialog, FindDialog } from './tools';
import { HistoryView } from './history';
import { DemoPlayer, startDemo } from './demo';
import { NcbiDialog, PrimerLibraryDialog } from './library';
import { VectorLibraryDialog } from './VectorLibrary';
import { OligoAnnealDialog } from './OligoAnneal';
import { buildReportMarkdown, reportToHtml } from './report';
import { loadSampleLibrary } from './samples';
import { download, openProject, recordSave, saveFile, saveProject } from './files';
import { SessionManager, requestCloseDoc } from './session';
import { DocTabs, Menu, StatusBar, UNDO_SCOPE, VIEWS, ViewRail, Welcome } from './shell';
import { isDirty, isDocCurrent, selectActiveDoc, selectCutSites, tracesAlignedToCurrent, useWorkbench, type WizardKind } from './store';
import { Button, Select, Tabs, cn } from './ui';
import type { SequenceEdit } from '../modules/seq-engine';

// The gel model takes field strength (V/cm); the UI shows volts across a standard 20 cm tank.
const GEL_BOX_CM = 20;


type ExportFormat =
  | 'project' | 'gbk' | 'dna' | 'fasta' | 'json' | 'svg' | 'png' | 'pdf' | 'print-map' | 'print-seq'
  | 'report-md' | 'report-html';

const NO_TRACES: SangerTraceData[] = [];

const THEME_NAMES = { light: '浅色', publication: '出版白底', dark: '深色' } as const;


// FASTQ reads beyond this are not shown as traces; aligning thousands in the viewer is not useful.
const MAX_FASTQ_TRACES = 200;

export default function App() {
  const s = useWorkbench();
  const doc = selectActiveDoc(s);
  const cutSites = selectCutSites(s, doc);
  const rawTraces = (doc && s.traces[doc.id]) || NO_TRACES;
  const tracesCurrent = !!doc && tracesAlignedToCurrent(s, doc);
  // Alignments made against an earlier revision are hidden until realigned.
  const traces = useMemo(
    () => (tracesCurrent ? rawTraces : rawTraces.map(({ alignment: _stale, ...t }) => t)),
    [rawTraces, tracesCurrent],
  );
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
  const [samplesLoading, setSamplesLoading] = useState(true);
  const openSamples = useCallback(
    () =>
      loadSampleLibrary().then(({ docs, traces }) => {
        const st = useWorkbench.getState();
        st.openDocs(docs, true, { saved: true });
        Object.entries(traces).forEach(([id, t]) => !st.traces[id]?.length && st.setTraces(id, t));
      }),
    [],
  );
  useEffect(() => {
    if (useWorkbench.getState().docs.length) return setSamplesLoading(false);
    openSamples()
      .then(() => {
        temporal.getState().clear();
        if (new URLSearchParams(window.location.search).has('demo')) startDemo();
      })
      .finally(() => setSamplesLoading(false));
  }, [temporal, openSamples]);

  // Cut sites follow the active document and enzyme set (computed off the main thread).
  useEffect(() => {
    if (doc) refreshCutSites(doc);
  }, [doc, s.enzymeSetId, s.customEnzymeSets]);


  // Align Sanger reads against the current revision of their plasmid: new reads,
  // and all reads again after the plasmid was edited.
  useEffect(() => {
    if (!doc || !rawTraces.length || (tracesCurrent && rawTraces.every((t) => t.alignment))) return;
    const revision = docRevision(doc);
    Promise.all(
      rawTraces.map((t) => (tracesCurrent && t.alignment ? t : callBioForDoc(doc, 'alignTraceToPlasmid', t, doc))),
    ).then((aligned) => {
      const st = useWorkbench.getState();
      // Drop the result if the plasmid changed or reads were added meanwhile.
      if (aligned.some((t) => !t) || st.traces[doc.id] !== rawTraces) return;
      st.setTraces(doc.id, aligned as SangerTraceData[], revision);
    });
  }, [doc, rawTraces, tracesCurrent]);

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
          st.addTraces(active.id, [trace]);
          st.setView('sanger');
          continue;
        }
        if (/\.(fastq|fq)$/i.test(file.name)) {
          const active = selectActiveDoc(useWorkbench.getState());
          if (!active) throw new Error('请先打开参考序列');
          // Parsed in the worker so a large file does not block the page; only the first reads are kept.
          const { traces, total } = await callBio('fastqToTraces', await file.text(), MAX_FASTQ_TRACES);
          st.addTraces(active.id, traces);
          st.setView('sanger');
          st.notify(`已载入 ${traces.length} / ${total} 条读长，正在比对到 ${active.name}`);
          continue;
        }
        const binary = /\.(dna|prot|xdna|cm5)$/i.test(file.name);
        const data = binary ? await file.arrayBuffer() : await file.text();
        if (typeof data === 'string' && isProjectFile(file.name, data)) {
          openProject(parseProjectFile(data), file.name);
          continue;
        }
        if (isProteinFile(file.name, data)) {
          const proteins = await parseProteinFile(file.name, data);
          st.openProteins(proteins);
          st.notify(`已打开蛋白 ${proteins.map((p) => p.name).join(', ')}`);
          continue;
        }
        const docs = await parseBioFile(file.name, data);
        st.openDocs(docs, true, { saved: true });
        st.notify(`已打开 ${docs.map((d) => d.name).join(', ')}`);
      } catch (e) {
        st.notify(`无法读取 ${file.name}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }, []);

  // An edit's coordinates refer to the version the editor showed. It is applied
  // synchronously, so the next keystroke already sees the result; an edit made
  // against an older version is refused instead of landing at a shifted position.
  const onEdit = useCallback(
    (edit: SequenceEdit) => {
      if (!doc) return;
      const st = useWorkbench.getState();
      if (!isDocCurrent(doc.id, docRevision(doc))) return st.notify('序列已在别处更新，这次编辑未应用，请重试');
      st.replaceDoc(callBioSync('mutatePlasmidSequence', doc, edit));
    },
    [doc],
  );

  const transform = async (kind: 'revcomp' | 'origin' | 'annotate' | 'topology') => {
    if (!doc) return;
    const st = useWorkbench.getState();
    if (kind === 'revcomp') await updateDoc(doc.id, (d) => callBio('reverseComplementPlasmid', d));
    if (kind === 'origin' && s.selection) {
      // The new origin is a coordinate on this version; do not apply it to a newer one.
      const next = await callBioForDoc(doc, 'rotateCircularOrigin', doc, s.selection.start);
      if (next) replaceIfCurrent(doc, next);
      else st.notify(STALE_RESULT);
    }
    if (kind === 'annotate') {
      let added = 0;
      const next = await updateDoc(doc.id, async (d) => {
        const found = await callBio('autoAnnotateFeatures', d);
        added = found.length;
        return {
          ...d,
          features: [...d.features, ...found],
          updatedAt: new Date().toISOString(),
          history: [...d.history, historyNode('manual_edit', `自动注释 ${found.length} 个特征`)],
        };
      });
      if (next) st.notify(`自动注释新增 ${added} 个特征`);
    }
    if (kind === 'topology') await updateDoc(doc.id, (d) => ({ ...d, topology: d.topology === 'circular' ? 'linear' : 'circular' }));
  };

  const exportAs = (fmt: ExportFormat) => {
    if (!doc) return;
    if (fmt === 'gbk') download(`${doc.name}.gbk`, exportPlasmidToGenBank(doc));
    // .dna and JSON keep the whole document and count as saving it; GenBank and
    // FASTA drop parts of it (see docs/COMPATIBILITY.md), so they do not.
    const keep = (name: string, content: string | Uint8Array<ArrayBuffer>, type: string, ext: string) =>
      saveFile(name, content, type, ext)
        .then((outcome) => recordSave([doc.id], outcome, ` ${name}`))
        .catch((e) => s.notify(`保存失败：${e instanceof Error ? e.message : String(e)}`));
    if (fmt === 'dna') void keep(`${doc.name}.dna`, exportPlasmidToSnapGene(doc) as Uint8Array<ArrayBuffer>, 'application/octet-stream', '.dna');
    if (fmt === 'fasta') download(`${doc.name}.fasta`, exportPlasmidToFasta(doc));
    if (fmt === 'json') void keep(`${doc.name}.json`, exportPlasmidToSnapGeneJson(doc), 'application/json', '.json');
    if (fmt === 'project') void saveProject();
    if ((fmt === 'gbk' || fmt === 'fasta') && isDirty(s, doc)) s.notify(`已导出 ${fmt === 'gbk' ? 'GenBank' : 'FASTA'}；该格式不保留全部信息，「未保存」标记保留。完整保存请用 Ctrl+S`);
    if (fmt === 'print-seq') return printSequenceText(doc, { bpPerLine: 60, showFeatures: true });
    if (fmt === 'report-md' || fmt === 'report-html') {
      const markdown = buildReportMarkdown({
        doc,
        cutSites,
        traces: s.traces[doc.id] ?? [],
        gelSamples: s.gelSamples,
        gelParams: s.gelParams,
      });
      if (fmt === 'report-md') {
        download(`${doc.name}-实验记录.md`, markdown, 'text/markdown;charset=utf-8');
      } else {
        // The map only exists once it has been drawn; without it the record is still complete.
        const svg = mapRef.current?.outerHTML;
        if (!svg) s.notify('实验记录已导出，但当前视图没有图谱；切到环形图谱再导出可一并收录');
        download(
          `${doc.name}-实验记录.html`,
          reportToHtml(markdown, { title: `${doc.name} 实验记录`, mapSvg: svg }),
          'text/html;charset=utf-8',
        );
      }
      return;
    }
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
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProject();
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
    <div className="flex h-full w-full flex-col">
      <div className="relative flex shrink-0 items-center justify-end gap-2 border-b border-[var(--border)] px-2 py-1">
        <span className="text-[11px] text-[var(--muted)]">形状</span>
        <Tabs
          value={s.mapShape}
          onChange={s.setMapShape}
          items={[
            { value: 'auto', label: '自动' },
            { value: 'circular', label: '环形' },
            { value: 'linear', label: '线性' },
          ]}
        />
        <Button size="sm" variant={optionsOpen ? 'primary' : 'default'} onClick={() => setOptionsOpen(!optionsOpen)} title="图谱显示选项">
          <SlidersHorizontal size={13} /> 显示
        </Button>
        {optionsOpen && (
          <div className="absolute right-2 top-10 z-20 w-72 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 shadow-xl">
            <MapDisplayOptionsPanel value={s.mapOptions} onChange={(v) => s.setMapOptions(v)} featureTypes={featureTypes} />
          </div>
        )}
      </div>
      {/* m-auto centres the map while keeping all of it reachable by scrolling when it is larger than the pane. */}
      <div className="flex min-h-0 flex-1 overflow-auto">
        <div className="m-auto">
          {linearMap ? <LinearPlasmidMap {...mapProps} width={Math.max(640, mainHeight * 1.4)} /> : <CircularPlasmidMap {...mapProps} showPrimers={s.mapOptions.showPrimers !== false} />}
        </div>
      </div>
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
      {/* Top bar: file, edit, build, tools; search and assistant on the right */}
      <header className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-1.5">
        <div className="mr-3 flex items-baseline gap-2" title="GATC — Gene Assembly & Toolkit for Cloning">
          <span className="mono text-[17px] font-bold tracking-[0.12em]" aria-label="GATC">
            <span className="text-slate-800 dark:text-slate-200">G</span>
            <span className="text-emerald-600">A</span>
            <span className="text-red-600">T</span>
            <span className="text-blue-600">C</span>
          </span>
        </div>
        <Button size="sm" onClick={() => fileRef.current?.click()} title="打开文件 (Ctrl+O)">
          <FileUp size={14} /> 打开
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept=".gatc,.dna,.prot,.gb,.gbk,.gp,.genbank,.ape,.seq,.xdna,.cm5,.fasta,.fa,.fas,.faa,.embl,.gff,.ab1,.abi,.fastq,.fq,.json,.xml,.sbol,.txt,.geneious"
          onChange={(e) => e.target.files && openFiles(e.target.files)}
        />
        <Button size="sm" onClick={() => saveProject()} disabled={!s.docs.length} title="保存全部文档为 GATC 项目 (Ctrl+S)">
          <Save size={14} /> 保存
        </Button>
        <Menu
          label="导出"
          icon={<Download size={14} />}
          disabled={!doc}
          entries={[
            { label: 'GATC 项目 (.gatc，全部文档)', hint: 'Ctrl+S', onSelect: () => exportAs('project') },
            { label: 'SnapGene (.dna)', onSelect: () => exportAs('dna') },
            { label: 'GenBank (.gbk, SnapGene/ApE)', onSelect: () => exportAs('gbk') },
            { label: 'FASTA', onSelect: () => exportAs('fasta') },
            { label: 'JSON', onSelect: () => exportAs('json') },
            { divider: true },
            { label: '图谱 SVG（出版级）', onSelect: () => exportAs('svg') },
            { label: '图谱 PNG 300 dpi', onSelect: () => exportAs('png') },
            { label: '图谱 PDF（矢量）', onSelect: () => exportAs('pdf') },
            { divider: true },
            { label: '实验记录 Markdown（.md）', hint: '引物、PCR 程序、酶切体系、电泳、谱系', onSelect: () => exportAs('report-md') },
            { label: '实验记录网页（.html，含图谱，可打印/存 PDF）', onSelect: () => exportAs('report-html') },
            { divider: true },
            { label: '打印图谱…', onSelect: () => exportAs('print-map') },
            { label: '打印序列…', onSelect: () => exportAs('print-seq') },
          ]}
        />
        <div className="mx-1.5 h-5 w-px bg-[var(--border)]" />
        <Button size="icon" variant="ghost" onClick={() => temporal.getState().undo()} title={`撤销 (Ctrl+Z)\n${UNDO_SCOPE}`} aria-label="撤销">
          <Undo2 size={15} />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => temporal.getState().redo()} title={`重做 (Ctrl+Shift+Z)\n${UNDO_SCOPE}`} aria-label="重做">
          <Redo2 size={15} />
        </Button>
        <div className="mx-1.5 h-5 w-px bg-[var(--border)]" />
        <Button size="sm" variant="primary" onClick={() => s.setWizard('restriction')} disabled={!doc} title="PCR、酶切连接、Gibson、Golden Gate、定点突变等">
          <FlaskConical size={14} /> 克隆向导
        </Button>
        <Menu
          label="工具"
          icon={<Wrench size={14} />}
          entries={[
            { label: '查找序列 / 蛋白模式', hint: 'Ctrl+F', disabled: !doc, onSelect: () => s.setTool('find') },
            { label: '载体库', hint: '32 个内置载体', onSelect: () => s.setTool('vectors') },
            { label: '引物库', onSelect: () => s.setTool('primerlib') },
            { label: '寡核苷酸退火', hint: '两条引物退火成短双链片段', onSelect: () => s.setTool('oligo') },
            { label: '从 NCBI 导入（登录号）', onSelect: () => s.setTool('ncbi') },
            { label: '反向翻译 / 密码子优化', onSelect: () => s.setTool('backtranslate') },
            { divider: true },
            { label: '自动注释特征', disabled: !doc, onSelect: () => transform('annotate') },
            { label: '反向互补整条序列', disabled: !doc, onSelect: () => transform('revcomp') },
            { label: '将选区起点设为新原点', disabled: !doc || !s.selection, onSelect: () => transform('origin') },
            { label: '切换环状/线性', disabled: !doc, onSelect: () => transform('topology') },
            { divider: true },
            { label: s.demo ? '退出演示模式' : '演示模式（自动演示主要功能）', disabled: !doc && !s.demo, onSelect: () => (s.demo ? s.setDemo(null) : startDemo()) },
          ]}
        />
        <div className="flex-1" />
        <button
          className="hidden h-7 w-60 items-center gap-2 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--muted)] hover:border-blue-400 md:flex"
          onClick={() => s.setPaletteOpen(true)}
          title="命令面板 (Ctrl+K)：搜索命令、切换视图，或输入「酶切 EcoRI BamHI」"
        >
          <Search size={13} />
          <span className="flex-1 truncate text-left">搜索命令…</span>
          <kbd className="rounded border border-[var(--border)] px-1 text-[10px]">Ctrl K</kbd>
        </button>
        <Button size="icon" variant="ghost" className="md:hidden" onClick={() => s.setPaletteOpen(true)} aria-label="命令面板">
          <Search size={15} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => s.setTheme(s.theme === 'dark' ? 'light' : s.theme === 'light' ? 'publication' : 'dark')}
          title={`主题：${THEME_NAMES[s.theme]}（点击切换）`}
        >
          {dark ? <Moon size={15} /> : <Sun size={15} />}
        </Button>
        <Button size="sm" variant={s.copilotOpen ? 'primary' : 'default'} onClick={() => s.setCopilotOpen(!s.copilotOpen)} disabled={!doc}>
          <Bot size={14} /> AI 导师
        </Button>
      </header>

      <DocTabs onOpen={() => fileRef.current?.click()} onClose={requestCloseDoc} />

      {/* Main: view rail, the active view, document inspector, assistant */}
      <div className="flex min-h-0 flex-1">
        <ViewRail value={s.view} onChange={s.setView} disabled={!doc || !!protein} />
        <main ref={mainRef} className="min-w-0 flex-1 overflow-hidden bg-[var(--bg)]">
          {protein ? (
            <ProteinSequenceView protein={protein} theme={vizTheme} height={Math.max(320, mainHeight - 20)} />
          ) : !doc ? (
            <Welcome loading={samplesLoading} onOpen={() => fileRef.current?.click()} onNcbi={() => s.setTool('ncbi')} onSamples={openSamples} />
          ) : (
            <div className="h-full">
              {s.view === 'split' && (
                <div className="grid h-full grid-cols-1 lg:grid-cols-2">
                  <div className="min-h-0 overflow-hidden border-r border-[var(--border)] bg-[var(--panel)]">{mapView}</div>
                  <div className="min-h-0 overflow-hidden bg-[var(--panel)]">{seqView}</div>
                </div>
              )}
              {s.view === 'map' && <div className="h-full bg-[var(--panel)]">{mapView}</div>}
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
          <aside className="hidden w-72 shrink-0 overflow-auto border-l border-[var(--border)] bg-[var(--panel)] xl:block" aria-label="文档信息">
            <Inspector doc={doc} />
          </aside>
        )}
        {doc && s.copilotOpen && (
          <CopilotSidebar
            // One conversation per document: its action cards can only apply to that document.
            key={doc.id}
            doc={doc}
            cutSites={cutSites}
            selection={s.selection}
            traces={traces}
            onApplyAction={(action) => applyAIAction(action, doc.id)}
            open={s.copilotOpen}
            onClose={() => s.setCopilotOpen(false)}
          />
        )}
      </div>

      <StatusBar doc={doc} cutSites={cutSites} uniqueCutters={uniqueCutters.length} selection={s.selection} />

      {s.toast && (
        <div
          data-toast
          role="status"
          className="fixed bottom-10 left-1/2 z-50 max-w-[min(90vw,720px)] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-xs leading-relaxed text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
        >
          {s.toast}
        </div>
      )}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-4 border-dashed border-blue-500 bg-blue-500/10 text-lg font-semibold text-blue-700">
          释放以打开文件
        </div>
      )}

      <SessionManager />
      <CloningWizard />
      <DemoPlayer />
      <FindDialog />
      <NcbiDialog />
      <PrimerLibraryDialog />
      <VectorLibraryDialog />
      <OligoAnnealDialog />
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
              <Command.Item onSelect={run(() => onExport('project'))}>保存项目 (.gatc)</Command.Item>
              <Command.Item onSelect={run(() => st().setTool('ncbi'))}>从 NCBI 导入（登录号）</Command.Item>
              <Command.Item onSelect={run(() => st().setTool('vectors'))}>载体库（内置质粒）</Command.Item>
              <Command.Item onSelect={run(() => st().setTool('primerlib'))}>引物库</Command.Item>
              <Command.Item onSelect={run(() => st().setTool('oligo'))}>寡核苷酸退火（短片段直接连接）</Command.Item>
              <Command.Item onSelect={run(() => onExport('report-md'))}>导出实验记录 Markdown</Command.Item>
              <Command.Item onSelect={run(() => onExport('report-html'))}>导出实验记录网页（含图谱）</Command.Item>
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
