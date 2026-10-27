// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Demo mode: plays through the main workflows on real sequences, one step at a time.
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, SkipForward, X } from 'lucide-react';
import type { PlasmidDocument } from '../types/schema';
import { getEnzymeByName } from '../modules/seq-engine';
import { callBio } from './bio-client';
import { addPrimersToDoc, replaceIfCurrent, digestToGel, newDocument, openProduct, uncutPlasmidSample, uid } from './actions';
import { loadDemoLibrary } from './samples/demo';
import { useWorkbench } from './store';
import { Button } from './ui';

const STEP_DELAY_MS = 4200;

interface DemoStep {
  title: string;
  text: string;
  run: () => Promise<void>;
}

const st = () => useWorkbench.getState();
const byName = (name: string): PlasmidDocument => {
  const d = st().docs.find((x) => x.name === name);
  if (!d) throw new Error(`演示需要的序列 ${name} 未打开`);
  return d;
};
const activate = (name: string, view: Parameters<ReturnType<typeof st>['setView']>[0]) => {
  st().setActive(byName(name).id);
  st().setView(view);
};
const cds = (doc: PlasmidDocument, pattern: RegExp) => {
  const f = doc.features.find((x) => x.type === 'CDS' && pattern.test(x.name)) ?? doc.features.find((x) => x.type === 'CDS');
  if (!f) throw new Error(`${doc.name} 中没有 CDS`);
  return f;
};

async function digestPair(doc: PlasmidDocument, enzymes: string[]): Promise<PlasmidDocument[]> {
  const list = enzymes.map((n) => getEnzymeByName(n)!).filter(Boolean);
  const sites = (await callBio('findCutSites', doc, list)).filter((s) => !s.isMethylationBlocked);
  return callBio('simulateDigestion', doc, sites);
}

const STEPS: DemoStep[] = [
  {
    title: '载入演示序列',
    text: '从 NCBI 下载的真实记录：pBR322（J01749）、pGEX-4T-1（U13853）、mCherry（AY678264）、GFP 蛋白（P42212），以及一个在 pBR322 tet 基因两侧插入 loxP 的演示构建。',
    run: async () => {
      const { docs, proteins } = await loadDemoLibrary();
      st().openDocs(docs.filter((d) => !st().docs.some((x) => x.id === d.id)), false, { saved: true });
      st().openProteins(proteins.filter((p) => !st().proteins.some((x) => x.id === p.id)));
      activate('pBR322', 'split');
    },
  },
  {
    title: '双视图联动',
    text: '环形图谱与双链序列同步：选中 pBR322 的四环素抗性基因，图谱与序列同时高亮。',
    run: async () => {
      activate('pBR322', 'split');
      const tet = cds(byName('pBR322'), /tet/i);
      st().setSelection({ start: tet.start, end: tet.end });
    },
  },
  {
    title: '本地自动注释',
    text: '对 pGEX-4T-1 运行本地特征库扫描，自动标出 GST 标签、tac 启动子、lacIq、AmpR、ori 等常用元件。',
    run: async () => {
      activate('pGEX-4T-1', 'features');
      const doc = byName('pGEX-4T-1');
      const found = await callBio('autoAnnotateFeatures', doc);
      st().notify(`自动注释：pGEX-4T-1 共 ${doc.features.length} 个特征${found.length ? `，新增 ${found.length} 个` : '（均已注释）'}`);
    },
  },
  {
    title: '酶切位点分析',
    text: '列出 pBR322 上全部市售酶的切点，可按单切点、NEB 缓冲液、甲基化阻断和酶集过滤。',
    run: async () => {
      activate('pBR322', 'enzymes');
      st().setEnzymeFilter({ uniqueOnly: true });
    },
  },
  {
    title: '虚拟电泳',
    text: 'pBR322 未酶切（超螺旋 / 开环）、EcoRI 单切线性化、EcoRI + PstI 双切，与 NEB 1kb Plus Ladder 同胶对比。',
    run: async () => {
      st().setEnzymeFilter({ uniqueOnly: false });
      const doc = byName('pBR322');
      st().setGelSamples([{ id: uid('lane'), label: 'NEB 1kb Plus', ladder: 'NEB 1kb Plus' }, uncutPlasmidSample(doc)]);
      await digestToGel(doc, ['EcoRI']);
      await digestToGel(doc, ['EcoRI', 'PstI']);
      st().setActive(doc.id);
      st().setView('gel');
    },
  },
  {
    title: '序列查找',
    text: '在 pBR322 两条链上搜索 IUPAC 简并模式 GGATCC / GRATYC，结果直接定位到序列。',
    run: async () => {
      activate('pBR322', 'sequence');
      const hits = await callBio('searchMotif', byName('pBR322'), 'GRATYC', { bothStrands: true });
      if (hits[0]) st().setSelection({ start: hits[0].start, end: hits[0].end });
      st().notify(`GRATYC（BamHI/BglII/BstYI 兼容位点）在 pBR322 上命中 ${hits.length} 处`);
    },
  },
  {
    title: '设计克隆引物',
    text: '为 mCherry 全长 CDS 设计引物：正向引物加 BamHI 位点、反向引物加 NotI 位点，并带保护碱基；Tm 按 SantaLucia + Owczarzy 盐校正计算。',
    run: async () => {
      const doc = byName('mCherry');
      const f = cds(doc, /mcherry|red/i);
      const pair = await callBio('designPrimerPair', doc, { start: f.start, end: f.end }, { enzymeSiteForward: 'BamHI', enzymeSiteReverse: 'NotI', leaderBases: 'GCG' });
      pair.forward.name = 'mCherry-BamHI-F';
      pair.reverse.name = 'mCherry-NotI-R';
      if (!replaceIfCurrent(doc, addPrimersToDoc(doc, [pair.forward, pair.reverse], '演示：BamHI/NotI 克隆引物'))) return st().setDemo(null);
      activate('mCherry', 'features');
      st().notify(`引物 Tm ${pair.forward.tmAnnealing.toFixed(1)} / ${pair.reverse.tmAnnealing.toFixed(1)} °C，产物 ${pair.productLength} bp`);
    },
  },
  {
    title: 'PCR 扩增',
    text: '用两条引物模拟 PCR，得到两端带 BamHI / NotI 位点的 mCherry 扩增产物。',
    run: async () => {
      const doc = byName('mCherry');
      const fwd = doc.primers.find((p) => p.name === 'mCherry-BamHI-F')!;
      const rev = doc.primers.find((p) => p.name === 'mCherry-NotI-R')!;
      const r = await callBio('simulatePCR', doc, fwd, rev);
      openProduct(r.product && { ...r.product, name: 'mCherry_PCR' }, r.warnings);
    },
  },
  {
    title: '酶切连接：EGFP 换成 mCherry',
    text: 'pEGFP-N1 与 PCR 产物分别用 BamHI + NotI 双切，取载体骨架与 mCherry 片段连接，得到 pmCherry-N1，并自动校验粘性末端互补。',
    run: async () => {
      const vector = byName('pEGFP-N1');
      const insert = byName('mCherry_PCR');
      const [vFrags, iFrags] = await Promise.all([digestPair(vector, ['BamHI', 'NotI']), digestPair(insert, ['BamHI', 'NotI'])]);
      const backbone = [...vFrags].sort((a, b) => b.length - a.length)[0];
      const fragment = [...iFrags].sort((a, b) => b.length - a.length)[0];
      const r = await callBio('simulateLigation', [backbone, fragment], { circularize: true });
      openProduct(r.product && { ...r.product, name: 'pmCherry-N1' }, r.warnings);
      st().setView('map');
    },
  },
  {
    title: '鉴定酶切',
    text: '对 pmCherry-N1 做 BamHI + NotI 鉴定酶切，与原载体 pEGFP-N1 同胶比较：插入片段由 EGFP 变为 mCherry。',
    run: async () => {
      st().setGelSamples([{ id: uid('lane'), label: 'NEB 1kb Plus', ladder: 'NEB 1kb Plus' }]);
      await digestToGel(byName('pEGFP-N1'), ['BamHI', 'NotI']);
      await digestToGel(byName('pmCherry-N1'), ['BamHI', 'NotI']);
      st().setView('gel');
    },
  },
  {
    title: '定点突变',
    text: '在 pEGFP-N1 的 EGFP 第 66 位密码子设计 Q5 背靠背突变引物，并推荐可用于菌落鉴定的静默酶切位点。',
    run: async () => {
      const doc = byName('pEGFP-N1');
      const egfp = cds(doc, /egfp/i);
      const at = egfp.start + 65 * 3;
      const r = await callBio('designMutagenesisPrimers', doc, { start: at, end: at + 3, newBases: 'CAC', mode: 'q5_back_to_back' });
      if (!replaceIfCurrent(doc, addPrimersToDoc(doc, [r.forward, r.reverse], '演示：EGFP Y66H 突变引物'))) return st().setDemo(null);
      openProduct({ ...r.mutatedDoc, name: 'pEGFP-N1_Y66H' }, [`${r.silentSiteSuggestions.length} 个静默位点建议`]);
      st().setView('sequence');
      st().setSelection({ start: at, end: at + 3 });
    },
  },
  {
    title: 'Sanger 测序比对',
    text: 'pEGFP-N1 的测序峰图与参考序列比对，自动修剪低质量末端，标出错义突变与杂合双峰。',
    run: async () => activate('pEGFP-N1', 'sanger'),
  },
  {
    title: '多序列比对',
    text: '对 pUC19、pBR322 与 pGEX-4T-1 做多序列比对：三者共享 pMB1 复制起点与 bla 抗性基因区域。',
    run: async () => {
      st().setView('align');
      st().requestAlign([byName('pUC19').id, byName('pBR322').id, byName('pGEX-4T-1').id]);
    },
  },
  {
    title: 'Cre / loxP 重组',
    text: '对两侧带同向 loxP 的构建体模拟 Cre 重组：tet 基因被切除为环状小分子，载体上留下一个 loxP。',
    run: async () => {
      const r = await callBio('simulateRecombinase', [byName('pBR322-loxP-tet-loxP')], 'Cre');
      r.products.forEach((p) => openProduct(p, r.events));
      if (!r.products.length) st().notify(r.warnings.join('；') || '未发生重组');
      st().setView('map');
    },
  },
  {
    title: '蛋白与反向翻译',
    text: '打开 GFP 蛋白序列，并按大肠杆菌密码子偏好反向翻译，同时避开 EcoRI / BamHI / NotI 位点。',
    run: async () => {
      const gfp = st().proteins.find((p) => p.id === 'demo-gfp-protein');
      if (!gfp) return;
      const avoid = ['EcoRI', 'BamHI', 'NotI'].map((n) => getEnzymeByName(n)!.recognitionSeq);
      const dna = await callBio('backTranslate', gfp.sequence, 'E. coli', { strategy: 'most-frequent', avoidSites: avoid });
      openProduct(newDocument('GFP_Ecoli_optimized', dna, 'linear', '演示：GFP 反向翻译（E. coli）'));
      st().setActiveProtein(gfp.id);
    },
  },
  {
    title: '克隆历史',
    text: 'pmCherry-N1 的构建历史：PCR、酶切、连接每一步都被记录，可回到任意一步的版本或用相同参数重新模拟。',
    run: async () => activate('pmCherry-N1', 'history'),
  },
];

/** Floating control bar; demo steps run real computations against the workbench. */
export function DemoPlayer() {
  const demo = useWorkbench((s) => s.demo);
  const setDemo = useWorkbench((s) => s.setDemo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(-1);

  // Run the current step once; leaving the demo resets so a restart replays step 1.
  useEffect(() => {
    if (!demo) {
      ran.current = -1;
      return;
    }
    if (ran.current === demo.step) return;
    ran.current = demo.step;
    setBusy(true);
    setError(null);
    STEPS[demo.step]
      .run()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [demo]);

  // Auto-advance after the step settles.
  useEffect(() => {
    if (!demo?.playing || busy) return;
    const t = setTimeout(() => {
      const cur = useWorkbench.getState().demo;
      if (!cur) return;
      if (cur.step + 1 < STEPS.length) setDemo({ ...cur, step: cur.step + 1 });
      else setDemo({ ...cur, playing: false });
    }, STEP_DELAY_MS);
    return () => clearTimeout(t);
  }, [demo, busy, setDemo]);

  if (!demo) return null;
  const step = STEPS[demo.step];
  const last = demo.step + 1 >= STEPS.length;
  return (
    <div className="fixed bottom-16 left-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-2xl" role="region" aria-label="演示模式">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--muted)]">
        演示 {demo.step + 1} / {STEPS.length}
        <div className="h-1 flex-1 overflow-hidden rounded bg-[var(--bg)]">
          <div className="h-full bg-blue-600 transition-all" style={{ width: `${((demo.step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>
      <div className="text-sm font-semibold">{step.title}</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{step.text}</p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" variant="primary" onClick={() => setDemo({ ...demo, playing: !demo.playing })} disabled={last && !demo.playing}>
          {demo.playing ? <Pause size={12} /> : <Play size={12} />} {demo.playing ? '暂停' : '继续'}
        </Button>
        <Button size="sm" disabled={busy || last} onClick={() => setDemo({ ...demo, step: demo.step + 1 })}>
          <SkipForward size={12} /> 下一步
        </Button>
        <div className="flex-1" />
        {busy && <span className="text-[11px] text-[var(--muted)]">运行中…</span>}
        <Button size="sm" variant="ghost" onClick={() => setDemo(null)} aria-label="退出演示">
          <X size={13} />
        </Button>
      </div>
    </div>
  );
}

export function startDemo() {
  const s = useWorkbench.getState();
  s.setCopilotOpen(false);
  s.setWizard(null);
  s.setTool(null);
  s.setDemo({ step: 0, playing: true });
}
