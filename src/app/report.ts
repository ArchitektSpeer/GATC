// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Builds an experiment record out of what the workbench already knows: the construct,
// its primers, the digest the enzyme panel recommends, the virtual gel and the lineage.
// Everything here is read off the state - nothing is measured, and every rule of thumb
// says where it comes from, so the record can go into a lab notebook as it stands.
import type { CutSite, PlasmidDocument, Primer, RestrictionEnzyme, SangerTraceData } from '../types/schema';
import type { GelRunParams, GelSampleInput } from '../modules/alignment-gel';
import { recommendDoubleDigestBuffer } from '../modules/seq-engine';
import { gcPercentOf, resolveEnzyme } from '../modules/cloning-primer';
import { APP_VERSION } from './autosave';

export interface ReportInput {
  doc: PlasmidDocument;
  /** Cut sites already computed for this document, if any. */
  cutSites?: CutSite[];
  /** The enzymes the digest was actually set up with; without them no recipe is written. */
  digestEnzymes?: RestrictionEnzyme[];
  traces?: SangerTraceData[];
  gelSamples?: GelSampleInput[];
  gelParams?: GelRunParams;
  /** Volume of the digest the recipe is written for. */
  digestVolumeUl?: number;
  dnaMassUg?: number;
  includeSequence?: boolean;
  now?: Date;
}

/**
 * The enzymes this construct was actually cut with, read off its lineage. Used when the
 * caller does not name any, so the recipe describes the run that happened rather than an
 * arbitrary pair out of the enzyme set.
 */
export function digestEnzymesFromHistory(doc: PlasmidDocument): RestrictionEnzyme[] {
  for (const node of [...doc.history].reverse()) {
    const names = node.enzymesUsed ?? [];
    const enzymes = names.map((name) => resolveEnzyme(name)).filter((e): e is RestrictionEnzyme => !!e);
    if (enzymes.length) return enzymes;
  }
  return [];
}

/** One PCR the document's primers imply: a forward primer and the reverse that follows it. */
interface PcrPlan {
  forward: Primer;
  reverse: Primer;
  productLength: number;
  lowerTm: number;
}

function fixed(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return '';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => escapeCell(cell)).join(' | ')} |`),
  ].join('\n');
}

/**
 * Pair up the primers on a document: every forward primer with the nearest reverse
 * primer downstream of it. A primer pointing nowhere useful is simply left unpaired.
 */
export function pcrPlans(doc: PlasmidDocument): PcrPlan[] {
  const forwards = doc.primers.filter((p) => p.strand === 1);
  const reverses = doc.primers.filter((p) => p.strand === -1);
  const plans: PcrPlan[] = [];
  const circular = doc.topology === 'circular';
  for (const forward of forwards) {
    let best: { reverse: Primer; length: number } | null = null;
    for (const reverse of reverses) {
      let span = reverse.bindingEnd - forward.bindingStart;
      if (span <= 0 && circular) span += doc.length;
      if (span <= 0) continue;
      if (!best || span < best.length) best = { reverse, length: span };
    }
    if (!best) continue;
    plans.push({
      forward,
      reverse: best.reverse,
      // The product carries both primers' 5' tails on top of the template span.
      productLength: best.length + forward.tailSequence.length + best.reverse.tailSequence.length,
      lowerTm: Math.min(forward.tmAnnealing, best.reverse.tmAnnealing),
    });
  }
  return plans;
}

/** Extension time at a given rate, rounded up to a time a thermocycler can be set to. */
function extensionTime(productLength: number, secondsPerKb: number): string {
  const seconds = Math.max(15, Math.ceil((productLength / 1000) * secondsPerKb / 5) * 5);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

function constructSection(doc: PlasmidDocument): string {
  const gc = gcPercentOf(doc.sequence);
  const rows: string[][] = [
    ['名称', doc.name],
    ['长度', `${doc.length.toLocaleString()} bp`],
    ['拓扑', doc.topology === 'circular' ? '环状' : '线性'],
    ['GC 含量', `${fixed(gc)} %`],
    ['特征数', String(doc.features.length)],
    ['引物数', String(doc.primers.length)],
  ];
  if (doc.topology === 'linear' && doc.linearEnds) {
    const describe = (end: { type: string; sequence: string }) =>
      end.type === 'blunt' ? '平末端' : `${end.type === '5-prime' ? "5'" : "3'"} 突出 ${end.sequence}`;
    rows.push(['左末端', describe(doc.linearEnds.left)], ['右末端', describe(doc.linearEnds.right)]);
  }
  if (doc.description) rows.push(['说明', doc.description]);
  return `## 1. 构建体\n\n${table(['项目', '值'], rows)}`;
}

function featureSection(doc: PlasmidDocument): string {
  if (!doc.features.length) return '';
  const shown = [...doc.features].sort((a, b) => a.start - b.start);
  const rows = shown.map((f) => [
    f.name,
    f.type,
    `${f.start + 1}..${f.end}`,
    f.strand === -1 ? '−' : '+',
    `${f.end - f.start > 0 ? f.end - f.start : doc.length - f.start + f.end} bp`,
  ]);
  return `## 2. 特征\n\n${table(['名称', '类型', '位置（1 起、含两端）', '链', '长度'], rows)}`;
}

function primerSection(doc: PlasmidDocument): string {
  if (!doc.primers.length) return '';
  const rows = doc.primers.map((p) => [
    p.name,
    p.sequence,
    `${p.sequence.length} nt`,
    `${fixed(p.tmAnnealing)} / ${fixed(p.tmTotal)}`,
    `${fixed(p.gcPercent)} %`,
    `${p.bindingStart + 1}..${p.bindingEnd} ${p.strand === -1 ? '←' : '→'}`,
    p.tailSequence ? `${p.tailSequence.length} nt 尾巴` : '无尾巴',
  ]);
  return [
    '## 3. 引物',
    '',
    table(['名称', '序列（5′→3′）', '长度', 'Tm 退火 / 全长 (°C)', 'GC', '结合位置', '备注'], rows),
    '',
    'Tm 按 SantaLucia 1998 最近邻参数计算，并做 Owczarzy 2004 盐校正；与各厂商自家计算器会有几度差异。',
  ].join('\n');
}

function pcrSection(doc: PlasmidDocument): string {
  const plans = pcrPlans(doc);
  if (!plans.length) return '';
  const blocks = plans.map((plan, index) => {
    const header = `### 反应 ${index + 1}：${plan.forward.name} + ${plan.reverse.name}`;
    const summary = table(
      ['项目', '值'],
      [
        ['产物长度', `${plan.productLength.toLocaleString()} bp`],
        ['较低的引物退火 Tm', `${fixed(plan.lowerTm)} °C`],
      ],
    );
    // Two rules of thumb, each the one its own supplier publishes; the Tm they are
    // applied to is this program's, not the supplier's calculator's.
    const program = table(
      ['聚合酶', '退火温度', '延伸（72 °C）', '依据'],
      [
        [
          'Taq 等常规聚合酶',
          `${fixed(plan.lowerTm - 5)} °C`,
          extensionTime(plan.productLength, 60),
          'Ta = 较低 Tm − 5 °C；1 min/kb',
        ],
        [
          'Q5 / Phusion 等高保真酶',
          `${fixed(plan.lowerTm + 3)} °C`,
          extensionTime(plan.productLength, 30),
          'Ta = 较低 Tm + 3 °C；20–30 s/kb',
        ],
      ],
    );
    return [header, '', summary, '', program].join('\n');
  });
  return [
    '## 4. PCR 推荐程序',
    '',
    '循环结构：初始变性 → (变性 / 退火 / 延伸) × 25–35 → 终延伸 72 °C 2 min → 4 °C。',
    '下表只给退火温度与延伸时间；变性温度与时间、酶量、缓冲液请按所用聚合酶说明书。',
    '表中数值是经验公式的结果，不是实测条件，首次扩增建议做温度梯度。',
    '',
    ...blocks,
  ].join('\n');
}

function digestSection(
  doc: PlasmidDocument,
  cutSites: CutSite[],
  enzymes: RestrictionEnzyme[],
  volumeUl: number,
  massUg: number,
): string {
  if (!cutSites.length && !enzymes.length) return '';
  const byName = new Map<string, { enzyme: RestrictionEnzyme; sites: CutSite[] }>();
  for (const site of cutSites) {
    const entry = byName.get(site.enzyme.name) ?? { enzyme: site.enzyme, sites: [] };
    entry.sites.push(site);
    byName.set(site.enzyme.name, entry);
  }

  const parts: string[] = ['## 5. 酶切'];

  // Single cutters in map order: the list a cloning plan is actually read off.
  const unique = [...byName.values()]
    .filter((entry) => entry.sites.length === 1)
    .sort((a, b) => a.sites[0].cutPositionTop - b.sites[0].cutPositionTop);
  const SHOWN = 40;
  if (unique.length) {
    parts.push(
      '',
      `单切点酶 ${unique.length} 种${unique.length > SHOWN ? `，按切点位置排序，下表列出前 ${SHOWN} 种` : '，按切点位置排序'}（取自当前酶集）：`,
      '',
      table(
        ['酶', '识别序列', '切点位置（1 起）', '末端', '备注'],
        unique.slice(0, SHOWN).map((entry) => {
          const site = entry.sites[0];
          return [
            entry.enzyme.name,
            entry.enzyme.recognitionSeq,
            String(site.cutPositionTop + 1),
            site.overhangType === 'blunt'
              ? '平末端'
              : `${site.overhangType === '5-prime' ? "5'" : "3'"} 突出 ${site.overhangSeq}`,
            site.isMethylationBlocked ? '该位点被甲基化阻断' : '',
          ];
        }),
      ),
    );
  }

  // A recipe only makes sense for enzymes the run actually used, never for an
  // arbitrary pair off the list above.
  if (enzymes.length) {
    const plan = recommendDoubleDigestBuffer(enzymes);
    const enzymeUl = Math.min(enzymes.length, Math.max(1, Math.floor(volumeUl / 10)));
    const bufferUl = volumeUl / 10;
    const dnaUl = Math.min(volumeUl / 2, Math.max(1, Math.round(volumeUl / 5)));
    const waterUl = Math.max(0, volumeUl - bufferUl - enzymeUl - dnaUl);
    const recipe = table(
      ['组分', '体积', '说明'],
      [
        [`质粒 DNA（${doc.name}）`, `${dnaUl} µL`, `合计约 ${massUg} µg`],
        [
          '10× 缓冲液',
          `${bufferUl} µL`,
          plan.buffer === 'sequential' ? '无共用缓冲液，见下' : `NEB ${plan.buffer}`,
        ],
        ...enzymes.map((enzyme) => [enzyme.name, '1 µL', '约 10 U，按 ≥10 U/µg DNA 核算']),
        ['灭菌水', `${waterUl} µL`, '补足体积'],
        ['合计', `${volumeUl} µL`, ''],
      ],
    );

    const notes: string[] = [];
    if (plan.buffer === 'sequential') {
      notes.push('**没有一种缓冲液能让这些酶都保持 ≥75% 活性，需分步酶切：先切一种，纯化后换缓冲液再切下一种。**');
    } else if (enzymes.length > 1) {
      notes.push(
        `共用缓冲液：NEB ${plan.buffer}，活性 ${Object.entries(plan.activities)
          .map(([name, activity]) => `${name} ${activity}%`)
          .join(' · ')}。`,
      );
    } else {
      notes.push(`缓冲液：NEB ${plan.buffer}（活性 ${Object.values(plan.activities)[0]}%）。`);
    }
    if (plan.temperatureC.length) {
      notes.push(
        `孵育温度：${[...new Set(plan.temperatureC)].join(' / ')} °C${
          new Set(plan.temperatureC).size > 1 ? '（各酶最适温度不同，需分步或取折中并延长时间）' : ''
        }。`,
      );
    }
    const inactivation = Object.entries(plan.heatInactivation).filter(([, how]) => how);
    if (inactivation.length) {
      notes.push(`热失活：${inactivation.map(([name, how]) => `${name} ${how}`).join('；')}。`);
    }
    for (const warning of plan.starActivityWarning) notes.push(`星号活性提示：${warning}`);
    notes.push('酶的甘油会抑制反应，酶的总体积不要超过反应体积的 1/10。');

    parts.push(
      '',
      `### ${volumeUl} µL 体系（${enzymes.map((e) => e.name).join(' + ')}）`,
      '',
      recipe,
      '',
      ...notes.map((note) => `- ${note}`),
    );
  }

  return parts.length > 1 ? parts.join('\n') : '';
}

function gelSection(samples: GelSampleInput[], params?: GelRunParams): string {
  if (!samples.length) return '';
  const rows = samples.map((sample, index) => [
    String(index + 1),
    sample.label,
    sample.ladder
      ? `Marker：${sample.ladder}`
      : (sample.fragments ?? [])
          .map((f) => `${f.sizeBp.toLocaleString()} bp${f.conformation && f.conformation !== 'linear' ? `（${f.conformation === 'supercoiled' ? '超螺旋' : '开环'}）` : ''}`)
          .join('、') || '空',
  ]);
  const run = params
    ? `凝胶条件：${params.agarosePercent}% 琼脂糖${params.voltage ? `，${params.voltage} V` : ''}${params.minutes ? `，${params.minutes} min` : ''}。`
    : '';
  return ['## 6. 虚拟电泳', '', table(['泳道', '样品', '条带'], rows), '', run].filter(Boolean).join('\n');
}

function historySection(doc: PlasmidDocument): string {
  if (!doc.history.length) return '';
  const rows = doc.history.map((node) => [
    new Date(node.timestamp).toLocaleString('zh-CN'),
    node.operation,
    node.description,
    [
      node.enzymesUsed?.length ? `酶：${node.enzymesUsed.join(', ')}` : '',
      node.parentSnapshots?.length ? `亲本：${node.parentSnapshots.map((p) => `${p.name} (${p.length} bp)`).join('、')}` : '',
    ]
      .filter(Boolean)
      .join('；'),
  ]);
  return `## 7. 构建历史\n\n${table(['时间', '操作', '说明', '来源'], rows)}`;
}

function traceSection(traces: SangerTraceData[]): string {
  if (!traces.length) return '';
  const rows = traces.map((trace) => {
    const [from, to] = trace.trimRange;
    const quality = trace.qualityScores.length
      ? `平均 Q ${fixed(trace.qualityScores.reduce((a, b) => a + b, 0) / trace.qualityScores.length, 0)}`
      : '无质量值';
    const aligned = trace.alignment
      ? `${trace.alignment.refStart + 1}..${trace.alignment.refEnd} ${trace.alignment.strand === -1 ? '←' : '→'}，一致度 ${fixed(
          trace.alignment.identityPercent,
        )}%，${trace.alignment.mismatches.length} 处差异`
      : '未比对';
    return [
      trace.fileName || trace.id,
      `${trace.calledSequence.length} nt（高质量区 ${from + 1}..${to}）`,
      quality,
      aligned,
    ];
  });
  return `## 8. 测序数据\n\n${table(['样品', '读长', '质量', '与参考序列的比对'], rows)}`;
}

/** The whole record, as Markdown. */
export function buildReportMarkdown(input: ReportInput): string {
  const {
    doc,
    cutSites = [],
    digestEnzymes = digestEnzymesFromHistory(input.doc),
    traces = [],
    gelSamples = [],
    gelParams,
    digestVolumeUl = 50,
    dnaMassUg = 1,
    includeSequence = true,
    now = new Date(),
  } = input;

  const sections = [
    `# 实验记录：${doc.name}`,
    '',
    `生成时间：${now.toLocaleString('zh-CN')} · GATC ${APP_VERSION} · 本文由软件根据当前工作区自动生成`,
    '',
    constructSection(doc),
    featureSection(doc),
    primerSection(doc),
    pcrSection(doc),
    digestSection(doc, cutSites, digestEnzymes, digestVolumeUl, dnaMassUg),
    gelSection(gelSamples, gelParams),
    historySection(doc),
    traceSection(traces),
  ].filter(Boolean);

  if (includeSequence) {
    const wrapped = doc.sequence.replace(/(.{60})/g, '$1\n').trimEnd();
    sections.push(
      ['## 附录：序列', '', '```', `>${doc.name} ${doc.length} bp ${doc.topology}`, wrapped, '```'].join('\n'),
    );
  }

  sections.push(
    [
      '## 依据与声明',
      '',
      '- 熔解温度：SantaLucia JR 1998, *PNAS* **95**: 1460–1465；盐校正 Owczarzy R et al. 2004, *Biochemistry* **43**: 3537–3554。',
      '- 限制性内切酶识别序列与切点：REBASE（Roberts RJ, Vincze T, Posfai J, Macelis D 2023, *Nucleic Acids Res* **51**: D629–D630）。',
      '- 缓冲液活性与孵育条件：NEB 公布的双酶切兼容性数据。',
      '- PCR 退火温度与延伸时间是经验公式的结果，不是实测条件。',
      '- 虚拟电泳迁移率是模型估计，用于判断条带是否可分辨，不能当作定量结果。',
      '',
      '本记录由 GATC 生成，内容取自当前工作区，未经实验验证。',
    ].join('\n'),
  );

  return `${sections.join('\n\n')}\n`;
}

/* -------------------------------------------------------------------------- */
/* A printable HTML flavour                                                   */
/* -------------------------------------------------------------------------- */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Renders the Markdown this module produces - headings, tables, lists, fenced blocks
 * and paragraphs - and nothing else, so no Markdown library is needed.
 */
export function reportToHtml(markdown: string, opts: { title: string; mapSvg?: string } = { title: 'GATC 实验记录' }): string {
  const out: string[] = [];
  const lines = markdown.split('\n');
  let index = 0;
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('```')) {
      closeList();
      const block: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        block.push(lines[index]);
        index += 1;
      }
      index += 1;
      out.push(`<pre>${escapeHtml(block.join('\n'))}</pre>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      // The map goes right after the construct heading, where a reader expects it.
      if (opts.mapSvg && /^##\s+1\./.test(line)) out.push(`<figure>${opts.mapSvg}</figure>`);
      index += 1;
      continue;
    }
    if (line.startsWith('- ')) {
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      index += 1;
      continue;
    }
    if (line.startsWith('|')) {
      closeList();
      const rows: string[][] = [];
      while (index < lines.length && lines[index].startsWith('|')) {
        const cells = lines[index].slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
        index += 1;
      }
      const [head, ...body] = rows;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }
    if (!line.trim()) {
      closeList();
      index += 1;
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
    index += 1;
  }
  closeList();

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 54rem; padding: 2rem 1.25rem 4rem; background: #fff; color: #18181b;
         font: 15px/1.65 -apple-system, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 1.7rem; margin: 0 0 .5rem; }
  h2 { font-size: 1.2rem; margin: 2rem 0 .5rem; padding-bottom: .3rem; border-bottom: 1px solid #e4e4e7; }
  h3 { font-size: 1rem; margin: 1.3rem 0 .4rem; }
  table { border-collapse: collapse; width: 100%; margin: .6rem 0; font-size: 13px; }
  th, td { border: 1px solid #e4e4e7; padding: .35rem .5rem; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; font-weight: 600; }
  pre { overflow-x: auto; background: #f4f4f5; border-radius: 6px; padding: .75rem;
        font: 12px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  code { background: #f4f4f5; border-radius: 3px; padding: 0 .25em; font-family: ui-monospace, Menlo, Consolas, monospace; }
  ul { padding-left: 1.2rem; }
  li { margin: .2rem 0; }
  figure { margin: 1rem 0; text-align: center; }
  figure svg { max-width: 100%; height: auto; }
  @media print { body { max-width: none; padding: 0; } h2 { break-after: avoid; } table { break-inside: avoid; } }
</style>
</head>
<body>
${out.join('\n')}
</body>
</html>
`;
}
