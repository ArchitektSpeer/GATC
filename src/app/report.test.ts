// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeAll, describe, expect, it } from 'vitest';
import type { PlasmidDocument } from '../types/schema';
import { designPrimerPair, findCutSites, resolveEnzyme } from '../modules/cloning-primer';
import { loadSampleLibrary } from './samples';
import { buildReportMarkdown, digestEnzymesFromHistory, pcrPlans, reportToHtml } from './report';

let pUC19: PlasmidDocument;

beforeAll(async () => {
  const lib = await loadSampleLibrary();
  [pUC19] = lib.docs;
});

/** pUC19 with a primer pair across the lacZ fragment, as a cloning run would leave it. */
function withPrimers(): PlasmidDocument {
  const pair = designPrimerPair(pUC19, { start: 400, end: 1200 });
  return { ...pUC19, primers: [pair.forward, pair.reverse] };
}

describe('experiment record', () => {
  it('states the construct, its features and the sequence', () => {
    const markdown = buildReportMarkdown({ doc: pUC19, now: new Date('2026-10-28T09:00:00Z') });
    expect(markdown).toMatch(/^# 实验记录：pUC19/m);
    expect(markdown).toContain('2,686 bp');
    expect(markdown).toContain('环状');
    expect(markdown).toMatch(/## 2\. 特征/);
    // Every table is a real Markdown table with a separator row.
    expect(markdown).toMatch(/\| --- \|/);
    expect(markdown).toContain('## 附录：序列');
    expect(markdown).toContain(`>pUC19 2686 bp circular`);
    // The sequence is wrapped at 60 columns and complete.
    const block = /```\n>[^\n]*\n([\s\S]*?)```/.exec(markdown)![1];
    expect(block.replace(/\n/g, '')).toBe(pUC19.sequence);
    expect(block.split('\n')[0]).toHaveLength(60);
    expect(markdown).toContain('SantaLucia');
    expect(markdown).toContain('未经实验验证');
  });

  it('leaves out what the workspace does not have', () => {
    const markdown = buildReportMarkdown({ doc: { ...pUC19, features: [], history: [] }, includeSequence: false });
    expect(markdown).not.toContain('## 2. 特征');
    expect(markdown).not.toContain('## 3. 引物');
    expect(markdown).not.toContain('## 4. PCR');
    expect(markdown).not.toContain('## 6. 虚拟电泳');
    expect(markdown).not.toContain('## 7. 构建历史');
    expect(markdown).not.toContain('## 附录：序列');
    expect(markdown).toContain('## 1. 构建体');
  });

  it('pairs the primers and gives each polymerase its own annealing rule', () => {
    const doc = withPrimers();
    const plans = pcrPlans(doc);
    expect(plans).toHaveLength(1);
    expect(plans[0].productLength).toBeGreaterThan(700);
    expect(plans[0].productLength).toBeLessThan(900);

    const markdown = buildReportMarkdown({ doc });
    expect(markdown).toContain('## 4. PCR 推荐程序');
    const lower = plans[0].lowerTm;
    expect(markdown).toContain(`${(lower - 5).toFixed(1)} °C`);
    expect(markdown).toContain(`${(lower + 3).toFixed(1)} °C`);
    // An 800 bp product: 48 s at 1 min/kb, rounded up to a settable 50 s; half that
    // for a high-fidelity enzyme.
    expect(plans[0].productLength).toBe(800);
    expect(markdown).toContain('| 50 s | Ta = 较低 Tm − 5 °C；1 min/kb |');
    expect(markdown).toContain('| 25 s | Ta = 较低 Tm + 3 °C；20–30 s/kb |');
    expect(markdown).toContain('不是实测条件');
  });

  const ecoRI = () => resolveEnzyme('EcoRI')!;
  const hindIII = () => resolveEnzyme('HindIII')!;
  const twoEnzymeCuts = () => [
    ...findCutSites(pUC19.sequence, ecoRI(), true),
    ...findCutSites(pUC19.sequence, hindIII(), true),
  ];

  it('writes a digest recipe whose buffer comes from the enzyme data', () => {
    const markdown = buildReportMarkdown({
      doc: pUC19,
      cutSites: twoEnzymeCuts(),
      digestEnzymes: [ecoRI(), hindIII()],
      digestVolumeUl: 50,
      dnaMassUg: 1,
    });
    expect(markdown).toContain('## 5. 酶切');
    expect(markdown).toContain('EcoRI');
    expect(markdown).toContain('GAATTC');
    // The recipe adds up to the volume asked for, and the enzymes stay within a tenth of it.
    expect(markdown).toContain('### 50 µL 体系（EcoRI + HindIII）');
    expect(markdown).toContain('| 10× 缓冲液 | 5 µL |');
    expect(markdown).toContain('| 合计 | 50 µL |');
    expect(markdown).toMatch(/NEB (r[123]\.1|rCutSmart)/);
    expect(markdown).toContain('孵育温度');
    expect(markdown).toContain('不要超过反应体积的 1/10');
  });

  it('lists the single cutters in map order and writes no recipe for enzymes nobody chose', () => {
    const markdown = buildReportMarkdown({ doc: pUC19, cutSites: twoEnzymeCuts(), includeSequence: false });
    expect(markdown).toContain('## 5. 酶切');
    expect(markdown).toContain('单切点酶 2 种');
    // HindIII cuts at 447 and EcoRI at 396, so EcoRI comes first.
    expect(markdown.indexOf('| EcoRI |')).toBeLessThan(markdown.indexOf('| HindIII |'));
    expect(markdown).not.toContain('µL 体系');
  });

  it('takes the digest enzymes from the construct lineage when none are given', () => {
    const doc: PlasmidDocument = {
      ...pUC19,
      history: [
        ...pUC19.history,
        {
          id: 'h-digest',
          operation: 'restriction_ligation',
          timestamp: new Date('2026-10-28T08:00:00Z').toISOString(),
          description: 'Digestion of pUC19 with EcoRI + HindIII',
          enzymesUsed: ['EcoRI', 'HindIII', 'NotAnEnzyme'],
        },
      ],
    };
    expect(digestEnzymesFromHistory(doc).map((e) => e.name)).toEqual(['EcoRI', 'HindIII']);
    const markdown = buildReportMarkdown({ doc, cutSites: twoEnzymeCuts(), includeSequence: false });
    expect(markdown).toContain('### 50 µL 体系（EcoRI + HindIII）');
  });

  it('lists the gel lanes and the run conditions', () => {
    const markdown = buildReportMarkdown({
      doc: pUC19,
      gelSamples: [
        { label: 'Marker', ladder: 'NEB 1kb Plus' },
        { label: '双酶切', fragments: [{ sizeBp: 2000 }, { sizeBp: 686, conformation: 'supercoiled' }] },
      ],
      gelParams: { agarosePercent: 1.2, voltage: 100, minutes: 45 },
    });
    expect(markdown).toContain('## 6. 虚拟电泳');
    expect(markdown).toContain('Marker：NEB 1kb Plus');
    expect(markdown).toContain('2,000 bp');
    expect(markdown).toContain('686 bp（超螺旋）');
    expect(markdown).toContain('1.2% 琼脂糖，100 V，45 min');
  });

  it('escapes a pipe in the data instead of breaking the table', () => {
    const doc: PlasmidDocument = {
      ...pUC19,
      features: [{ ...pUC19.features[0], name: 'odd|name' }],
    };
    const markdown = buildReportMarkdown({ doc, includeSequence: false });
    expect(markdown).toContain('odd\\|name');
  });
});

describe('the HTML flavour', () => {
  it('renders headings, tables, lists and fenced blocks, and drops the map in', () => {
    const markdown = buildReportMarkdown({ doc: withPrimers() });
    const html = reportToHtml(markdown, { title: 'pUC19 实验记录', mapSvg: '<svg id="map"></svg>' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>pUC19 实验记录</title>');
    expect(html).toContain('<h1>实验记录：pUC19</h1>');
    expect(html).toContain('<table><thead><tr><th>');
    // No separator row leaks into the body.
    expect(html).not.toContain('<td>---</td>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<pre>&gt;pUC19');
    expect(html).toContain('<figure><svg id="map"></svg></figure>');
    expect(html).toContain('<strong>');
  });

  it('escapes HTML that came in with the data', () => {
    const doc: PlasmidDocument = { ...pUC19, name: '<script>x</script>', features: [], history: [] };
    const html = reportToHtml(buildReportMarkdown({ doc, includeSequence: false }), { title: doc.name });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('works without a map', () => {
    const html = reportToHtml(buildReportMarkdown({ doc: pUC19, includeSequence: false }), { title: 'x' });
    expect(html).not.toContain('<figure>');
    expect(html).toContain('<h2>1. 构建体</h2>');
  });
});
