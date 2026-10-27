// Plays demo mode end to end and records each step (screenshot + status).
// Usage: node scripts/demo-check.mjs <outDir>   (expects vite preview on :4173, or E2E_URL)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = (process.env.E2E_URL ?? 'http://127.0.0.1:4173/') + '?demo=1';
const out = process.argv[2] ?? 'demo-report';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(URL);

// Reads the demo card without Playwright auto-waiting, so polling stays cheap.
const state = () =>
  page.evaluate(() => {
    const card = document.querySelector('[aria-label="演示模式"]');
    if (!card) return null;
    const m = card.textContent.match(/演示 (\d+) \/ (\d+)/);
    return {
      step: m ? +m[1] : 0,
      total: m ? +m[2] : 0,
      title: card.querySelector('.font-semibold')?.textContent ?? '',
      busy: card.textContent.includes('运行中'),
      error: card.querySelector('p.text-red-600')?.textContent ?? null,
      toast: document.querySelector('.fixed.bottom-4')?.textContent ?? '',
    };
  });

const steps = [];
let recorded = 0;
const deadline = Date.now() + 240_000;
while (Date.now() < deadline) {
  const s = await state();
  if (s && s.step > recorded && !s.busy) {
    recorded = s.step;
    await page.screenshot({ path: `${out}/demo-${String(s.step).padStart(2, '0')}.png` });
    steps.push({ step: s.step, title: s.title, ok: !s.error, error: s.error, toast: s.toast });
    if (s.step === s.total) break;
  }
  await page.waitForTimeout(150);
}
await browser.close();

for (const s of steps) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.step}. ${s.title}${s.error ? '  ERROR: ' + s.error : ''}${s.toast ? '  | ' + s.toast.slice(0, 120) : ''}`);
const passed = steps.filter((s) => s.ok).length;
console.log(`\n${passed}/${steps.length} demo steps ok; console errors: ${errors.length}`);
errors.slice(0, 8).forEach((e) => console.log('  ! ' + e.slice(0, 200)));
writeFileSync(`${out}/demo-report.json`, JSON.stringify({ steps, consoleErrors: errors }, null, 2));
