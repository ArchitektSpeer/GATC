// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Qiu Shui
// SPDX-License-Identifier: GPL-3.0-or-later
// Renders the promotional banners in docs/promo/promo.html to PNG at 2x.
// The page embeds a real screenshot, so refresh that first with scripts/ui-shots.mjs.
// Usage: node scripts/promo-shots.mjs [pageDir]
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'docs/promo');
const page_ = resolve(dir, 'promo.html');
if (!existsSync(page_)) throw new Error(`no promo.html in ${dir}`);

const browser = await chromium.launch();
// Wider than the widest banner so nothing is clipped before the per-sheet screenshot.
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(`file://${page_}`);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);

const ids = await page.$$eval('.sheet[id]', (nodes) => nodes.map((n) => n.id));
for (const id of ids) {
  await page.locator(`#${id}`).screenshot({ path: `${dir}/${id}.png` });
  const box = await page.locator(`#${id}`).boundingBox();
  console.log(`${id}.png  ${box.width}x${box.height} css, rendered at 2x`);
}
await browser.close();
