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
  await page.waitForFunction(() => !/\b0 cut sites\b/.test(document.body.innerText), null, { timeout: 20000 });
  const m = (await page.locator('body').innerText()).match(/(\d+) cut sites/);
  if (!m || +m[1] === 0) throw new Error('no cut sites');
  await shot('01-split');
  return `${m[1]} cut sites`;
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

await browser.close();
const report = { url: URL, passed: results.filter((r) => r.ok).length, total: results.length, results, consoleErrors: errors.slice(0, 30) };
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms} ms)  ${r.detail}`);
console.log(`\n${report.passed}/${report.total} passed; console errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log('  ! ' + e.slice(0, 200)));
