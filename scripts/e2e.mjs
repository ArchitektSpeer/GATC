// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Browser functional evaluation against a running `vite preview` (default http://localhost:4173).
// Usage: node scripts/e2e.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const URL = process.env.E2E_URL ?? 'http://localhost:4173/';
const out = process.argv[2] ?? 'e2e-report';
mkdirSync(out, { recursive: true });

const results = [];
const errors = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? '' });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: String(e?.message ?? e).split('\n')[0] });
  }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
// Exports go through downloads here; a native save dialog cannot be driven headless.
await page.addInitScript(() => delete window.showSaveFilePicker);
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const view = (label) => page.getByRole('button', { name: label, exact: true }).click();
let lastToast = '';
const toast = async () => {
  const loc = page.locator('[data-toast]').first();
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-toast]');
      return !!el && el.textContent !== prev;
    },
    lastToast,
    { timeout: 15000 },
  );
  lastToast = (await loc.textContent()) ?? '';
  return lastToast;
};
const tab = (name) => page.locator('div.cursor-pointer', { hasText: new RegExp(`^${name}●?\\d`) }).first().click();
const closeDialogs = async () => {
  for (let i = 0; i < 2; i++) await page.keyboard.press('Escape');
};

await page.goto(URL);

await check('加载示例 pUC19 / pEGFP-N1', async () => {
  await page.getByText('pEGFP-N1', { exact: false }).first().waitFor({ timeout: 20000 });
  return 'tabs visible';
});

await check('Web Worker 计算酶切位点', async () => {
  await page.waitForFunction(() => !/(^|[^\d])0 个切点/.test(document.body.innerText), null, { timeout: 20000 });
  const m = (await page.locator('body').innerText()).match(/(\d+) 个切点/);
  if (!m || +m[1] === 0) throw new Error('no cut sites');
  await shot('01-split');
  return `${m[1]} 个切点`;
});

await check('环形图谱视图', async () => {
  await view('环形图谱');
  await page.locator('svg').first().waitFor();
  await shot('02-map');
});

await check('线性序列视图', async () => {
  await view('序列');
  await shot('03-sequence');
});

await check('酶列表 + 过滤（单切点）', async () => {
  await view('酶');
  await page.getByText('单切点', { exact: true }).click();
  const rows = await page.locator('tbody tr').count();
  if (!rows) throw new Error('no enzymes listed');
  await shot('04-enzymes');
  return `${rows} unique cutters`;
});

await check('酶切 EcoRI+HindIII 并跑胶', async () => {
  for (const name of ['EcoRI', 'HindIII']) {
    await page.locator('tbody tr', { hasText: name }).first().locator('input[type=checkbox]').check();
  }
  await page.getByRole('button', { name: /酶切并跑胶/ }).click();
  const t = await toast();
  await page.waitForTimeout(800);
  await shot('05-gel');
  if (!/片段/.test(t)) throw new Error(t);
  return t;
});

await check('特征 / 引物 / ORF 面板', async () => {
  await view('特征/引物');
  await page.getByRole('button', { name: /^ORF/ }).click();
  await page.waitForTimeout(800);
  const label = await page.getByRole('button', { name: /^ORF/ }).textContent();
  await shot('06-features');
  return label;
});

await check('切换到 pEGFP-N1 并 Sanger 比对', async () => {
  await tab('pEGFP-N1');
  await view('Sanger 比对');
  await page.waitForTimeout(2500);
  const text = await page.locator('main').innerText();
  await shot('07-sanger');
  if (!/Missense|Silent|Nonsense|substitution|错义/i.test(text)) throw new Error('mutation not shown');
  return (text.match(/(Missense|Silent|Nonsense)[^\n]*/i) ?? [''])[0];
});

await check('历史树', async () => {
  await view('历史树');
  await shot('08-history');
});

await check('Cmd+K 命令面板快速酶切', async () => {
  await view('双视图');
  await page.keyboard.press('Control+k');
  await page.locator('[cmdk-input]').fill('酶切 BamHI NotI');
  await page.keyboard.press('Enter');
  const t = await toast();
  if (!/片段/.test(t)) throw new Error(t);
  return t;
});

await check('克隆向导：引物设计', async () => {
  await view('双视图');
  await page.getByRole('button', { name: '克隆向导' }).click();
  await page.getByRole('button', { name: '引物设计', exact: true }).click();
  await page.getByRole('button', { name: '设计引物' }).click();
  await page.getByText('PCR 产物').waitFor({ timeout: 15000 });
  await shot('09-primers');
  return (await page.getByText('PCR 产物').textContent()) ?? '';
});

await check('克隆向导：PCR 产物生成', async () => {
  await page.getByRole('button', { name: '添加到质粒' }).click();
  await toast();
  await page.getByRole('button', { name: 'PCR', exact: true }).click();
  const inputs = page.locator('input[placeholder^="ACGT"]');
  const opts = await page.locator('datalist option').evaluateAll((os) => os.map((o) => o.getAttribute('value')));
  await inputs.nth(0).fill(opts[0]);
  await inputs.nth(1).fill(opts[opts.length - 1]);
  await page.getByRole('button', { name: '模拟 PCR' }).click();
  const t = await toast();
  if (!/已生成/.test(t)) throw new Error(t);
  return t;
});

await check('克隆向导：酶切连接（EcoRI 自连）', async () => {
  await closeDialogs();
  await tab('pUC19');
  await page.getByRole('button', { name: '克隆向导' }).click();
  await page.getByRole('button', { name: '酶切连接', exact: true }).click();
  await page.getByLabel('酶（逗号分隔，单酶切/双酶切）').fill('EcoRI');
  await page.getByRole('button', { name: '酶切', exact: true }).click();
  await page.getByRole('button', { name: '连接', exact: true }).click();
  const t = await toast();
  await shot('10-ligation');
  if (!/已生成 pUC19_religated \(2686 bp\)/.test(t)) throw new Error(t);
  return t;
});

await check('克隆向导：定点突变', async () => {
  await closeDialogs();
  await tab('pEGFP-N1');
  await page.getByRole('button', { name: '克隆向导' }).click();
  await page.getByRole('button', { name: '定点突变', exact: true }).click();
  await page.getByLabel('突变起点 (1-based)').fill('871');
  await page.getByLabel('突变终点 (含)').fill('873');
  await page.locator('label', { hasText: '原序列' }).locator('input').fill('TGG');
  await page.getByRole('button', { name: '设计突变引物' }).click();
  await page.getByText('Tm 退火/全长').waitFor({ timeout: 15000 });
  await shot('11-mutagenesis');
  const sug = await page.getByText('静默酶切位点筛选建议').count();
  return sug ? 'primers + silent-site suggestions' : 'primers (no silent-site suggestion)';
});

await check('AI 导师抽屉（BYOK 设置）', async () => {
  await closeDialogs();
  await page.getByRole('button', { name: 'AI 导师' }).click();
  await page.waitForTimeout(500);
  await shot('12-copilot');
});

await check('撤销/重做', async () => {
  await closeDialogs();
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
});

await check('深色主题', async () => {
  await closeDialogs();
  await page.locator('button[title^="主题"]').click();
  await page.locator('button[title^="主题"]').click();
  await page.waitForTimeout(300);
  await shot('13-dark');
});

await check('打开真实 SnapGene .dna（含引物与历史树）', async () => {
  await closeDialogs();
  await page.locator('input[type=file]').setInputFiles('test-data/pIB2-SEC13-mEGFP.dna');
  const t = await toast();
  if (!/pIB2-SEC13-mEGFP/.test(t)) throw new Error(t);
  await view('历史树');
  await page.waitForTimeout(500);
  await shot('14-dna-history');
  return t;
});

await check('导出 GenBank', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.getByRole('button', { name: '导出' }).click();
    await page.getByText('GenBank (.gbk').click();
  })()]);
  const path = `${out}/${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  return dl.suggestedFilename();
});

const downloadVia = async (label) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.getByRole('button', { name: '导出' }).click();
    await page.getByText(label).click();
  })()]);
  const path = `${out}/${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  return path;
};

await check('导出 SnapGene .dna 并重新打开', async () => {
  await closeDialogs();
  await tab('pUC19');
  const path = await downloadVia('SnapGene (.dna)');
  const bytes = readFileSync(path);
  if (bytes[0] !== 0x09 || bytes.subarray(5, 13).toString() !== 'SnapGene') throw new Error('missing SnapGene cookie');
  await page.locator('input[type=file]').setInputFiles(path);
  const t = await toast();
  if (!/已打开 pUC19/.test(t)) throw new Error(t);
  return `${bytes.length} bytes, reopened`;
});

await check('导出图谱 PDF（矢量）', async () => {
  await closeDialogs();
  await view('环形图谱');
  await page.locator('svg').first().waitFor();
  const path = await downloadVia('图谱 PDF');
  const head = readFileSync(path).subarray(0, 5).toString();
  if (head !== '%PDF-') throw new Error(`not a PDF: ${head}`);
  return `${readFileSync(path).length} bytes`;
});

await check('查找序列（Ctrl+F, IUPAC）', async () => {
  await closeDialogs();
  await tab('pUC19');
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+f');
  await page.getByPlaceholder('GAATTC').fill('GGATCC');
  await page.getByText(/第 1 \/ \d+ 个命中/).waitFor({ timeout: 10000 });
  const exact = (await page.getByText(/个命中/).textContent()) ?? '';
  await page.getByPlaceholder('GAATTC').fill('GRATYC');
  await page.waitForTimeout(600);
  const iupac = (await page.getByText(/个命中|无命中/).textContent()) ?? '';
  await shot('15-find');
  return `BamHI ${exact}; GRATYC ${iupac}`;
});

await check('添加 / 编辑特征（可撤销）', async () => {
  await closeDialogs();
  await view('特征/引物');
  const before = await page.locator('tbody tr').count();
  await page.getByRole('button', { name: '添加特征' }).click();
  await page.getByLabel('名称').fill('E2E test feature');
  await page.getByLabel('起点 (1-based)').fill('100');
  await page.getByLabel('终点 (含)').fill('250');
  await page.locator('.fixed.inset-0').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('E2E test feature').waitFor();
  const after = await page.locator('tbody tr').count();
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const undone = await page.getByText('E2E test feature').count();
  if (after !== before + 1 || undone !== 0) throw new Error(`rows ${before}->${after}, after undo ${undone}`);
  return `${before} → ${after} → undo ${before}`;
});

await check('酶集切换（预设 / 全部市售）', async () => {
  await closeDialogs();
  await view('酶');
  const select = page.getByLabel('酶集');
  const options = await select.locator('option').allTextContents();
  const all = await page.locator('tbody tr').count();
  await select.selectOption({ index: 1 });
  await page.waitForTimeout(1200);
  const preset = await page.locator('tbody tr').count();
  await shot('16-enzyme-sets');
  await select.selectOption({ index: 0 });
  return `${options.length} sets; ${options[0]}: ${all} rows; ${options[1]}: ${preset} rows`;
});

await check('多序列比对', async () => {
  await closeDialogs();
  await view('多序列比对');
  await page.getByRole('button', { name: '多序列比对', exact: true }).last().click();
  await page.getByText(/同一性矩阵/).waitFor({ timeout: 60000 });
  const info = (await page.getByText(/同一性矩阵/).textContent()) ?? '';
  await shot('17-msa');
  return info.trim();
});

await check('反向翻译 / 密码子优化', async () => {
  await closeDialogs();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/输入命令/).fill('反向翻译');
  await page.getByText('反向翻译 / 密码子优化').click();
  await page.getByPlaceholder(/^MVSKGEEL/).fill('MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK');
  await page.getByRole('button', { name: '反向翻译', exact: true }).click();
  const info = (await page.getByText(/CAI/).textContent({ timeout: 10000 })) ?? '';
  await page.getByRole('button', { name: '作为新序列打开' }).click();
  const t = await toast();
  if (!/backtranslated/.test(t)) throw new Error(t);
  return info.trim();
});

await check('NCBI 导入：区间解析（不联网）', async () => {
  await closeDialogs();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/输入命令/).fill('NCBI');
  await page.getByText('从 NCBI 导入（登录号）').click();
  const box = page.getByPlaceholder(/L09137\.2 或/);
  await box.fill('U00096.3:1300-1000');
  await page.getByText(/区间 complement\(1000\.\.1300\)/).waitFor({ timeout: 5000 });
  const hint = (await page.getByText(/区间 complement/).textContent()) ?? '';
  // An out-of-range region has to say why, not fail silently at fetch time.
  await box.fill('U00096.3:0-100');
  await page.getByText(/区间起点从 1 开始|positions start at 1/).waitFor({ timeout: 5000 });
  await shot('18-ncbi-region');
  await closeDialogs();
  return hint.trim();
});

await check('寡核苷酸退火：设计并生成双链片段', async () => {
  await closeDialogs();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/输入命令/).fill('退火');
  await page.getByText('寡核苷酸退火（短片段直接连接）').click();
  await page.getByPlaceholder('GTCAGGGTTCTGGATATCTG').fill('GGTCAGGGTTCTGGATATCTG');
  const ends = page.locator('.fixed.inset-0 input.mono');
  await ends.nth(0).fill('CACC');
  await ends.nth(1).fill('AAAC');
  await page.getByText(/21 bp 配对/).waitFor({ timeout: 5000 });
  const badges = (await page.locator('.fixed.inset-0').innerText()).match(/21 bp 配对[\s\S]{0,80}/)?.[0] ?? '';
  await shot('19-oligo-anneal');
  await page.getByRole('button', { name: /作为双链片段打开/ }).click();
  const t = await toast();
  if (!/已生成双链片段/.test(t)) throw new Error(t);
  return `${badges.replace(/\s+/g, ' ')} | ${t}`;
});

await check('导出实验记录（Markdown + 网页）', async () => {
  await closeDialogs();
  await tab('pUC19');
  const md = await downloadVia('实验记录 Markdown');
  const text = readFileSync(md, 'utf8');
  for (const needed of ['# 实验记录：pUC19', '## 1. 构建体', '2,686 bp', '依据与声明']) {
    if (!text.includes(needed)) throw new Error(`report is missing ${needed}`);
  }
  await view('环形图谱');
  await page.locator('svg').first().waitFor();
  const html = await downloadVia('实验记录网页');
  const page2 = readFileSync(html, 'utf8');
  if (!page2.startsWith('<!doctype html>')) throw new Error('not an HTML document');
  if (!/<figure><svg/.test(page2)) throw new Error('the map was not embedded');
  await shot('20-report');
  return `${text.length} chars markdown, ${page2.length} chars html`;
});

await check('MoClo 矩阵：语法表与元件设计', async () => {
  await closeDialogs();
  await tab('pUC19');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/输入命令/).fill('组合克隆');
  await page.getByText('组合克隆（MoClo / Golden Gate 矩阵）').click();
  const dialog = page.locator('.fixed.inset-0').last();
  // The published plant fusion sites have to be on screen, exactly as the paper gives them.
  await dialog.getByText('A1', { exact: true }).waitFor({ timeout: 5000 });
  const text = await dialog.innerText();
  for (const site of ['GGAG', 'TGAC', 'TCCC', 'TACT', 'CCAT', 'AATG', 'AGGT', 'AGCC', 'TTCG', 'GCTT', 'GGTA', 'CGCT']) {
    if (!text.includes(site)) throw new Error(`fusion site ${site} is missing from the syntax table`);
  }
  if (!/接头表已对照原文核对/.test(text)) throw new Error('the verified-source badge is missing');

  // pUC19 is not a MoClo part, and the tool must say so rather than pretend.
  await dialog.getByRole('button', { name: /按接头自动归位/ }).click();
  const t = await toast();
  if (!/没有符合/.test(t)) throw new Error(t);

  // Domestication: designing the primer pair that would make pUC19's lacZ a CDS part.
  await dialog.getByLabel('要做成的位置').selectOption('B3-B4');
  await dialog.getByText('GGTCTCAAATG').first().waitFor({ timeout: 5000 });
  await shot('21-moclo');

  // Switching to the yeast toolkit must flag that its table is second-hand.
  await dialog.getByLabel('标准语法').selectOption('ytk');
  await dialog.getByText(/接头表取自第三方实现/).waitFor({ timeout: 5000 });
  const ytk = await dialog.innerText();
  for (const site of ['CCCT', 'AACG', 'TATG', 'ATCC', 'GCTG', 'TACA', 'GAGT', 'CCGA']) {
    if (!ytk.includes(site)) throw new Error(`YTK site ${site} is missing`);
  }
  await closeDialogs();
  return `12 plant sites + 8 YTK sites shown; ${t}`;
});

await check('CRISPR 打靶：靶点扫描与脱靶检查', async () => {
  await closeDialogs();
  await tab('pEGFP-N1');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/输入命令/).fill('基因组编辑');
  await page.getByText('基因组编辑（CRISPR 打靶 / 同源重组）').click();
  const dialog = page.locator('.fixed.inset-0').last();
  await dialog.getByRole('button', { name: /扫描整条序列/ }).click();
  const found = await toast();
  if (!/找到 \d+ 个 SpCas9 靶点/.test(found)) throw new Error(found);
  const rows = await dialog.locator('tbody tr').count();
  if (!rows) throw new Error('no target rows');

  // Every listed spacer must be 20 nt and sit next to an NGG PAM.
  const first = await dialog.locator('tbody tr').first().innerText();
  const spacer = first.match(/\b[ACGT]{20}\b/)?.[0];
  const pam = first.match(/\b[ACGT]{3}\b/g)?.find((x) => /GG$/.test(x));
  if (!spacer || !pam) throw new Error(`row does not show a spacer and an NGG PAM: ${first.replace(/\n/g, ' ')}`);

  await dialog.getByRole('button', { name: /查脱靶/ }).click();
  await dialog.getByText(/已打开的序列中无其他匹配|错配位点/).first().waitFor({ timeout: 30000 });
  await shot('22-crispr');

  // Cas12a has its PAM on the other side and a staggered cut, which the UI must say.
  await dialog.getByLabel('核酸酶').selectOption('Cas12a');
  await dialog.getByText('切点为近似值').waitFor({ timeout: 5000 });
  if (!/PAM TTTV/.test(await dialog.innerText())) throw new Error('Cas12a PAM not shown');

  // Handing a spacer to the annealing tool has to arrive there.
  await dialog.getByLabel('核酸酶').selectOption('SpCas9');
  await dialog.getByRole('button', { name: /扫描整条序列/ }).click();
  await dialog.locator('tbody tr').first().waitFor({ timeout: 10000 });
  await dialog.locator('tbody tr').first().getByRole('button', { name: /做成退火 Oligo/ }).click();
  const oligo = page.locator('.fixed.inset-0').last();
  await oligo.getByText('寡核苷酸退火', { exact: false }).first().waitFor({ timeout: 5000 });
  const handed = await oligo.locator('textarea').first().inputValue();
  if (handed.length !== 20) throw new Error(`spacer did not arrive in the oligo tool: "${handed}"`);
  await closeDialogs();
  return `${rows} 个靶点，spacer ${spacer} PAM ${pam}`;
});

await check('同源重组：敲除设计与鉴定引物', async () => {
  await closeDialogs();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/输入命令/).fill('基因组编辑');
  await page.getByText('基因组编辑（CRISPR 打靶 / 同源重组）').click();
  const dialog = page.locator('.fixed.inset-0').last();
  await dialog.getByRole('button', { name: '同源重组敲除 / 敲入' }).click();
  await dialog.getByLabel('基因组位点').selectOption({ label: 'pEGFP-N1' });
  await dialog.getByLabel('供体片段').selectOption({ label: 'pUC19' });
  await dialog.getByPlaceholder('起点').fill('1000');
  await dialog.getByPlaceholder('终点').fill('1600');
  await dialog.getByText(/替换 601 bp/).waitFor({ timeout: 10000 });
  const text = await dialog.innerText();
  const sizes = text.match(/野生型 (\d+) bp \/ 重组型 (\d+) bp/);
  if (!sizes) throw new Error('diagnostic PCR sizes are missing');
  // The diagnostic product grows by the whole donor minus the 601 bp it replaces.
  if (Number(sizes[2]) - Number(sizes[1]) !== 2686 - 601) {
    throw new Error(`size difference is wrong: ${sizes[0]}`);
  }
  await shot('23-homologous-recombination');
  await dialog.getByRole('button', { name: /打开重组后的位点/ }).click();
  const t = await toast();
  if (!/已生成 pEGFP-N1_HR_pUC19/.test(t)) throw new Error(t);
  return `${sizes[0]}；${t}`;
});

await check('序列视图：酶名与特征名不重叠', async () => {
  await closeDialogs();
  await tab('pUC19');
  await view('序列');
  await page.waitForTimeout(1200);
  // Scroll to the MCS, where the cut sites and the features are at their densest.
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(800);
  const report = await page.evaluate(() => {
    const boxes = [];
    for (const t of document.querySelectorAll('svg text')) {
      const text = (t.textContent || '').trim();
      // Single bases and amino-acid letters are allowed to sit in their own grid.
      if (text.length < 2) continue;
      const r = t.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Rotated text (the circular map) reports a box that is not its ink.
      if (t.getAttribute('transform')) continue;
      boxes.push({ text, x: r.x, y: r.y, w: r.width, h: r.height });
    }
    const hits = [];
    const pad = 2; // the glyph box carries ascender and descender padding
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y + pad < b.y + b.h - pad && b.y + pad < a.y + a.h - pad) {
          hits.push(`${a.text} / ${b.text}`);
        }
      }
    }
    return { labels: boxes.length, hits };
  });
  if (report.hits.length) throw new Error(`${report.hits.length} overlapping labels: ${report.hits.slice(0, 5).join(' | ')}`);
  await shot('24-sequence-labels');
  return `${report.labels} labels, none overlapping`;
});

await check('虚拟电泳：Marker 条带标注不重叠', async () => {
  await closeDialogs();
  await view('虚拟电泳');
  await page.waitForTimeout(1500);
  const report = await page.evaluate(() => {
    const boxes = [];
    for (const t of document.querySelectorAll('svg text')) {
      const text = (t.textContent || '').trim();
      if (!/^\d{2,6}$/.test(text)) continue; // the ladder sizes
      if (t.getAttribute('transform')) continue;
      const r = t.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      boxes.push({ text, x: r.x, y: r.y, w: r.width, h: r.height });
    }
    const hits = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y + 2 < b.y + b.h - 2 && b.y + 2 < a.y + a.h - 2) hits.push(`${a.text}/${b.text}`);
      }
    }
    return { sizes: boxes.length, hits };
  });
  if (report.sizes < 10) throw new Error(`only ${report.sizes} ladder labels were drawn`);
  if (report.hits.length) throw new Error(`${report.hits.length} overlapping ladder labels: ${report.hits.slice(0, 5).join(' | ')}`);
  await shot('26-gel-ladder');
  return `${report.sizes} ladder sizes, none overlapping`;
});

await check('对话框：主按钮在矮窗口里也够得着', async () => {
  await closeDialogs();
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/输入命令/).fill('组合克隆');
  await page.getByText('组合克隆（MoClo / Golden Gate 矩阵）', { exact: true }).click();
  const button = page.locator('.fixed.inset-0').last().getByRole('button', { name: /生成全部组合/ });
  const box = await button.boundingBox();
  if (!box) throw new Error('the generate button is not rendered');
  if (box.y + box.height > 760) throw new Error(`the generate button is below the fold at ${Math.round(box.y + box.height)}`);
  await shot('27-dialog-footer');
  await closeDialogs();
  await page.setViewportSize({ width: 1600, height: 1000 });
  return `primary action at ${Math.round(box.y + box.height)} of 760`;
});

await check('OpenCloning 策略与 pydna 脚本导出，并把策略读回来', async () => {
  await closeDialogs();
  await tab('pUC19');
  const strategyPath = await downloadVia('OpenCloning 克隆策略');
  const strategy = JSON.parse(readFileSync(strategyPath, 'utf8'));
  if (!Array.isArray(strategy.sequences) || !strategy.sequences.length) throw new Error('no sequences in the strategy');
  if (strategy.sequences.length !== strategy.sources.length) throw new Error('sequences and sources do not pair up');
  for (const sequence of strategy.sequences) {
    if (!/^LOCUS/.test(sequence.file_content)) throw new Error(`sequence ${sequence.id} carries no GenBank text`);
  }
  if (!strategy.schema_version) throw new Error('no schema_version');

  const scriptPath = await downloadVia('pydna 脚本');
  const script = readFileSync(scriptPath, 'utf8');
  for (const needed of ['from pydna.amplify import pcr', 'def check(', 'all steps reproduced']) {
    if (!script.includes(needed)) throw new Error(`the script is missing ${needed}`);
  }

  // Reading the strategy back has to reopen every sequence it holds.
  const before = await page.locator('div.cursor-pointer').count();
  await page.locator('input[type=file]').setInputFiles(strategyPath);
  const t = await toast();
  if (!/已导入 OpenCloning 克隆策略/.test(t)) throw new Error(t);
  const after = await page.locator('div.cursor-pointer').count();
  if (after <= before) throw new Error('no documents were opened from the strategy');
  await shot('25-opencloning');
  return `${strategy.sequences.length} sequences round-tripped; ${script.length} chars of python`;
});

await browser.close();
const report = { url: URL, passed: results.filter((r) => r.ok).length, total: results.length, results, consoleErrors: errors.slice(0, 30) };
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms} ms)  ${r.detail}`);
console.log(`\n${report.passed}/${report.total} passed; console errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log('  ! ' + e.slice(0, 200)));
