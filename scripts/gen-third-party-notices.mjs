// Collects the licence of every package that ends up in a GATC build and writes
// THIRD-PARTY-NOTICES.md. MIT and BSD require their copyright and permission notice to travel
// with the binary, so the generated file is shipped inside the Tauri bundle as well.
// Re-run it after changing dependencies: node scripts/gen-third-party-notices.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'THIRD-PARTY-NOTICES.md');

// `npm ls --parseable` prints one directory per installed package, the project itself first.
const dirs = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.includes('node_modules'));

const LICENCE_FILE = /^(LICEN[CS]E|COPYING|NOTICE)([-.].*)?$/i;

// A few packages are published without a `license` field and without a licence file. Their terms
// come from the upstream repository, whose LICENSE is kept verbatim under scripts/licence-overrides
// so the determination can be audited rather than taken on trust.
const OVERRIDES = {
  '@teselagen/bio-parsers': ['MIT', 'teselagen-tg-oss.txt', 'https://github.com/TeselaGen/tg-oss/blob/master/LICENSE'],
  '@teselagen/range-utils': ['MIT', 'teselagen-tg-oss.txt', 'https://github.com/TeselaGen/tg-oss/blob/master/LICENSE'],
  '@teselagen/sequence-utils': ['MIT', 'teselagen-tg-oss.txt', 'https://github.com/TeselaGen/tg-oss/blob/master/LICENSE'],
  'emitter-component': ['MIT', 'component-emitter.txt', 'https://github.com/component/emitter/blob/master/LICENSE'],
};

// Not everything in a build arrives through npm. These three do, and their licences have to
// travel with the binary just as the npm ones do: primer3's thermodynamic code is compiled into
// src/lib/wasm/thal.wasm by scripts/build-thal.mjs, and the Biopython and NumPy wheels are
// downloaded into public/pyodide/ by scripts/vendor-pyodide.mjs and served from there. The licence
// texts are kept under scripts/licence-overrides so this file can be regenerated without a network
// and the determination can be audited.
const VENDORED = [
  {
    name: 'Primer3',
    version: 'commit 345cba9ca22f',
    declared: 'GPL-2.0-or-later',
    homepage: 'https://github.com/primer3-org/primer3',
    how: 'src/thal.c, thal_params.c, thal_util.c, thal_draw.c and thal_trace.c compiled to `src/lib/wasm/thal.wasm`',
    file: 'primer3.txt',
  },
  {
    name: 'Biopython',
    version: '1.87',
    declared: 'Biopython License Agreement / BSD-3-Clause',
    homepage: 'https://biopython.org/',
    how: 'wheel served from `public/pyodide/` and imported by `src/lib/python/bio.py`',
    file: 'biopython.txt',
  },
  {
    name: 'NumPy',
    version: '2.4.6',
    declared: 'BSD-3-Clause',
    homepage: 'https://numpy.org/',
    how: 'wheel served from `public/pyodide/`, as Biopython requires it',
    file: 'numpy.txt',
  },
].map((item) => ({
  ...item,
  text: readFileSync(join(root, 'scripts/licence-overrides', item.file), 'utf8').trim(),
}));

const packages = [];
for (const dir of dirs) {
  let meta;
  try {
    meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const override = OVERRIDES[meta.name];
  const declared =
    override?.[0] ??
    (typeof meta.license === 'string'
      ? meta.license
      : (meta.license?.type ?? meta.licenses?.[0]?.type ?? 'see package'));
  let text = null;
  try {
    const file = readdirSync(dir).find((name) => LICENCE_FILE.test(name));
    if (file) text = readFileSync(join(dir, file), 'utf8').trim();
  } catch {
    // Unreadable package directory; recorded below without a text.
  }
  if (!text && override) {
    text = `${readFileSync(join(root, 'scripts/licence-overrides', override[1]), 'utf8').trim()}

[Not declared in the published package; taken from ${override[2]}]`;
  }
  const repo = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url;
  // `repository` is often a bare "owner/name" shorthand, which is not a link.
  const url = [meta.homepage, repo?.replace(/^git\+/, '').replace(/\.git$/, '')].find((candidate) =>
    /^https?:\/\//.test(candidate ?? ''),
  );
  packages.push({
    name: meta.name ?? dir.split('node_modules/').pop(),
    version: meta.version ?? '?',
    declared,
    homepage: url ?? null,
    text,
  });
}
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

// Most of these are the same MIT text with a different copyright line, so group by exact text:
// every distinct notice is reproduced once, next to the packages it covers.
const groups = new Map();
for (const pkg of [...packages, ...VENDORED]) {
  if (!pkg.text) continue;
  const key = createHash('sha256').update(pkg.text).digest('hex');
  if (!groups.has(key)) groups.set(key, { text: pkg.text, members: [] });
  groups.get(key).members.push(pkg);
}
const ordered = [...groups.values()].sort(
  (a, b) => b.members.length - a.members.length || a.members[0].name.localeCompare(b.members[0].name),
);
const missing = packages.filter((pkg) => !pkg.text);

const spdx = [...new Set(packages.map((pkg) => pkg.declared))].sort();
const lines = [];
lines.push('# Third-party notices');
lines.push('');
lines.push(
  'GATC is distributed under the GNU General Public License v3.0 or later (see `LICENSE`).',
  'A build also contains the npm packages listed here, and the three components below them that',
  'are compiled or downloaded from source rather than installed from npm. Their licences are',
  'reproduced in full below, as those licences require. Nothing in this file changes the terms of',
  'GATC itself.',
);
lines.push('');
lines.push(
  `Generated by \`scripts/gen-third-party-notices.mjs\` from the production dependency tree:`,
  `**${packages.length} packages**, licensed as ${spdx.join(', ')}.`,
);
lines.push('');
lines.push('## Packages');
lines.push('');
lines.push('| Package | Version | Licence |');
lines.push('|---|---|---|');
for (const pkg of packages) {
  const name = pkg.homepage ? `[${pkg.name}](${pkg.homepage})` : pkg.name;
  lines.push(`| ${name} | ${pkg.version} | ${pkg.declared} |`);
}
lines.push('');
lines.push('## Components built or downloaded from source');
lines.push('');
lines.push('| Component | Version | Licence | How it enters a build |');
lines.push('|---|---|---|---|');
for (const item of VENDORED) {
  lines.push(
    `| [${item.name}](${item.homepage}) | ${item.version} | ${item.declared} | ${item.how} |`,
  );
}
lines.push('');
lines.push('## Licence texts');
lines.push('');
for (const [index, group] of ordered.entries()) {
  const names = group.members
    .map((pkg) => (pkg.file ? `${pkg.name} ${pkg.version}` : `\`${pkg.name}@${pkg.version}\``))
    .join(', ');
  lines.push(`### ${index + 1}. ${group.members[0].declared} — ${group.members.length} package(s)`);
  lines.push('');
  lines.push(names);
  lines.push('');
  lines.push('```');
  lines.push(group.text);
  lines.push('```');
  lines.push('');
}
if (missing.length) {
  lines.push('## Packages shipping no licence file');
  lines.push('');
  lines.push(
    'These declare a licence in their `package.json` but carry no licence file of their own;',
    'the declared SPDX identifier applies.',
  );
  lines.push('');
  for (const pkg of missing) lines.push(`- \`${pkg.name}@${pkg.version}\` — ${pkg.declared}`);
  lines.push('');
}

writeFileSync(out, `${lines.join('\n')}\n`);
console.log(
  `THIRD-PARTY-NOTICES.md: ${packages.length} packages + ${VENDORED.length} built from source,` +
    ` ${ordered.length} distinct licence texts, ${missing.length} without a licence file`,
);
