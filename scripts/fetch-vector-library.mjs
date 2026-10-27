// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Downloads the GenBank record behind every bundled vector into src/app/vectors/data/.
// Only vectors with an authoritative GenBank accession are shipped: NCBI places no
// restrictions on redistributing its records, whereas vendor-published sequences for
// pET-28a, pcDNA3.1, pQE and the like have no such record and are not included.
// Usage: node scripts/fetch-vector-library.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('../src/app/vectors/data/', import.meta.url).pathname;
const EFETCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';

// name, accession. Verified against NCBI esummary before being listed here.
const VECTORS = [
  ['pUC19', 'L09137'], ['pUC18', 'L09136'], ['pBR322', 'J01749'],
  ['pACYC184', 'X06403'], ['pACYC177', 'X06402'],
  ['pBluescript-II-SK-plus', 'X52328'], ['pBluescript-II-KS-plus', 'X52327'],
  ['pGEM-3Zf-plus', 'X65306'], ['pGEM-5Zf-plus', 'X65308'],
  ['pSP64', 'X65327'], ['pTZ19R', 'Y14835'], ['pWSK29', 'AF016889'],
  ['pGEX-4T-1', 'U13853'], ['pGEX-6P-1', 'U78872'], ['pTrc99A', 'M22744'],
  ['pBAD24', 'X81837'], ['pBAD33', 'LC760188'],
  ['pET-3a', 'LT727576'], ['pET-11a', 'LT727489'], ['pGFPuv', 'U62636'],
  ['pEGFP-N1', 'U55762'], ['pEGFP-C1', 'U55763'], ['pGL3-Basic', 'U47295'],
  ['pRS313', 'U03439'], ['pRS314', 'U03440'], ['pRS315', 'U03441'],
  ['pRS316', 'U03442'], ['pRS425', 'U03452'], ['pRS426', 'U03451'],
  ['pCAMBIA1301', 'AF234297'], ['pBI121', 'AF485783'], ['pBBR1MCS', 'U02374'],
];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let written = 0;
let skipped = 0;

for (const [name, accession] of VECTORS) {
  const file = join(OUT, `${name}.gb`);
  if (existsSync(file) && !process.argv.includes('--force')) {
    skipped += 1;
    continue;
  }
  const url = `${EFETCH}?db=nuccore&id=${accession}&rettype=gbwithparts&retmode=text`;
  // E-utilities returns a sporadic 502 under load; a couple of retries clears it.
  let text = null;
  for (let attempt = 1; attempt <= 4 && text === null; attempt += 1) {
    const res = await fetch(url);
    if (res.ok) {
      text = await res.text();
    } else if (attempt === 4) {
      throw new Error(`${accession}: HTTP ${res.status} after ${attempt} attempts`);
    } else {
      await sleep(attempt * 1500);
    }
  }
  if (!text.startsWith('LOCUS')) throw new Error(`${accession}: not a GenBank record`);
  const length = Number(/^LOCUS\s+\S+\s+(\d+)\s+bp/.exec(text)?.[1] ?? 0);
  if (!length) throw new Error(`${accession}: no length on the LOCUS line`);
  writeFileSync(file, text);
  console.log(`  ${name.padEnd(24)} ${accession.padEnd(10)} ${String(length).padStart(6)} bp`);
  written += 1;
  // NCBI asks for no more than three requests a second without an API key.
  await sleep(400);
}
console.log(`\n${written} downloaded, ${skipped} already present (use --force to refetch)`);
