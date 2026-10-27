// Captures the main views at two widths for a quick look at layout and legibility.
// Usage: node scripts/ui-shots.mjs <outDir>   (expects a preview server; override with E2E_URL)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.E2E_URL ?? 'http://127.0.0.1:4173/';
const out = process.argv[2] ?? 'ui-shots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];

for (const [name, size] of [['wide', { width: 1600, height: 1000 }], ['narrow', { width: 1180, height: 820 }]]) {
  const page = await browser.newPage({ viewport: size });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL);
  await page.waitForTimeout(1200);
  // Load the bundled sample so the views have content.
  const sample = page.getByRole('button', { name: /pUC19|示例|打开/ }).first();
  if (await sample.count()) await sample.click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}-start.png` });
  for (const view of ['双视图', '环形图谱', '序列', '酶', '特征/引物', '虚拟电泳']) {
    const tab = page.getByRole('button', { name: view }).first();
    if (!(await tab.count())) continue;
    await tab.click().catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${name}-${view}.png` });
  }
  await page.close();
}
await browser.close();
console.log(`shots in ${out}; console errors: ${errors.length}`);
errors.slice(0, 5).forEach((e) => console.log('  ! ' + e.slice(0, 160)));
