// SPDX-License-Identifier: GPL-3.0-or-later
// Browser walk-through of the phase-A completion check (design.md appendix A):
// open, edit, force-close, reopen and recover, save, open the saved project again.
// Usage: npm run build && npx vite preview & node scripts/session-check.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.E2E_URL ?? 'http://localhost:4173/';
const results = [];
const check = async (name, fn) => {
  try {
    results.push({ name, ok: true, detail: (await fn()) ?? '' });
  } catch (e) {
    results.push({ name, ok: false, detail: String(e?.message ?? e).split('\n')[0] });
  }
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
// Exercise the download path; the save-dialog path is covered by unit tests.
await context.addInitScript(() => delete window.showSaveFilePicker);
const errors = [];
const watch = (page) => page.on('pageerror', (e) => errors.push(String(e)));

const readSnapshots = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('gatc-autosave', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('snapshots', { keyPath: 'sessionId' });
        req.onsuccess = () => {
          const get = req.result.transaction('snapshots').objectStore('snapshots').getAll();
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );

const palette = async (page, command) => {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/输入命令/).fill(command);
  await page.getByRole('option', { name: command, exact: true }).click();
};

let page = await context.newPage();
watch(page);
await page.goto(URL);
await page.getByText('pEGFP-N1').first().waitFor({ timeout: 20000 });

await check('启动时全部已保存', async () => {
  await page.getByText('全部已保存').waitFor({ timeout: 5000 });
});

let snapshot;
await check('编辑后出现未保存标记并自动备份', async () => {
  await palette(page, '反向互补整条序列');
  try {
    await page.getByLabel('未保存').first().waitFor({ timeout: 5000 });
  } catch (e) {
    await page.screenshot({ path: process.env.SHOT ?? join(tmpdir(), 'gatc-session-check-fail.png') });
    throw new Error(`${e.message.split('\n')[0]}; page says: ${(await page.locator('body').innerText()).slice(0, 300).replace(/\s+/g, ' ')}`);
  }
  await page.getByText(/1 个未保存 · 已自动备份/).waitFor({ timeout: 10000 });
  const snaps = await readSnapshots(page);
  if (snaps.length !== 1) throw new Error(`expected 1 snapshot, got ${snaps.length}`);
  snapshot = snaps[0];
  return `snapshot of ${snapshot.names.join(', ')}`;
});

await check('关闭有修改的标签页时提醒', async () => {
  const dirtyTab = page.locator('div.cursor-pointer', { has: page.getByLabel('未保存') }).first();
  await dirtyTab.getByLabel('关闭').click();
  await page.getByText('有未保存的修改').waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: '取消' }).click();
});

await check('关闭页面时浏览器提醒', async () => {
  const dialog = new Promise((resolve) => page.once('dialog', (d) => resolve(d)));
  await page.close({ runBeforeUnload: true });
  const d = await Promise.race([dialog, new Promise((_, rej) => setTimeout(() => rej(new Error('no beforeunload dialog')), 3000))]);
  if (d.type() !== 'beforeunload') throw new Error(`dialog type ${d.type()}`);
  // Stay, then force-close without the prompt to simulate a crash.
  await d.dismiss();
  await page.close({ runBeforeUnload: false });
});

page = await context.newPage();
watch(page);
await page.goto(URL);
await page.getByText('pEGFP-N1').first().waitFor({ timeout: 20000 });

await check('重新打开后提示恢复', async () => {
  await page.getByText('发现上次未正常关闭').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await page.getByText(/已恢复 \d+ 个文档/).waitFor({ timeout: 5000 });
  await page.getByLabel('未保存').first().waitFor({ timeout: 3000 });
});

let savedPath;
await check('保存项目后内容与恢复前一致', async () => {
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await download;
  savedPath = await file.path();
  const saved = JSON.parse(readFileSync(savedPath, 'utf8'));
  const before = JSON.parse(snapshot.project);
  const pick = ({ id, name, sequence, features, primers, topology }) => ({ id, name, sequence, features, primers, topology });
  // Only documents with unsaved changes are recovered; clean ones are reloaded from their source.
  const byId = (p) => JSON.stringify(p.documents.filter((d) => snapshot.dirtyIds.includes(d.id)).map(pick).sort((x, y) => x.id.localeCompare(y.id)));
  if (byId(saved) !== byId(before)) {
    const diff = before.documents.filter((d) => snapshot.dirtyIds.includes(d.id)).flatMap((b) => {
      const a = saved.documents.find((d) => d.id === b.id);
      return Object.keys(pick(b)).filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b[k])).map((k) => `${b.name}.${k}`);
    });
    throw new Error(`saved documents differ from the snapshot: ${diff.join(', ')}`);
  }
  await page.getByText('全部已保存').waitFor({ timeout: 5000 });
  return `${file.suggestedFilename()} (${saved.documents.length} docs, schema v${saved.schemaVersion})`;
});

await check('下载保存无法确认时，本次会话内保留恢复数据', async () => {
  await page.waitForTimeout(4000);
  const snaps = await readSnapshots(page);
  if (snaps.length !== 1) throw new Error(`expected the snapshot to be kept, found ${snaps.length}`);
});

await check('导入测序数据计入未保存', async () => {
  const fastq = Array.from({ length: 3 }, (_, i) => `@read${i}\nGCTGGCGAAAGGGGGATGTGCTGCAAGGCG\n+\nIIIIIIIIIIIIIIIIIIIIIIIIIIIIII\n`).join('');
  await page.locator('input[type=file]').setInputFiles({ name: 'reads.fastq', mimeType: 'text/plain', buffer: Buffer.from(fastq) });
  await page.getByText(/1 个未保存/).waitFor({ timeout: 10000 });
  await page.keyboard.press('Control+s');
  await page.getByText('全部已保存').waitFor({ timeout: 5000 });
});

await check('正常关闭后恢复数据被清除', async () => {
  await page.close({ runBeforeUnload: true });
  page = await context.newPage();
  watch(page);
  await page.goto(URL);
  await page.getByText('pEGFP-N1').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  if (await page.getByText('发现上次未正常关闭').count()) throw new Error('recovery banner shown after a clean close');
  const snaps = await readSnapshots(page);
  if (snaps.length) throw new Error(`${snaps.length} snapshots left`);
});

await check('再次打开保存的项目文件', async () => {
  const before = await page.locator('div.cursor-pointer').count();
  await page.locator('input[type=file]').setInputFiles({ name: 'walkthrough.gatc', mimeType: 'application/json', buffer: readFileSync(savedPath) });
  await page.getByText(/已打开项目 walkthrough\.gatc/).waitFor({ timeout: 5000 });
  const after = await page.locator('div.cursor-pointer').count();
  return `${after - before} tabs added`;
});

await browser.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
